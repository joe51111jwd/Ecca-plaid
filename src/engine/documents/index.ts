/**
 * Document reader: bytes in, a typed and explained reading out.
 *
 *   readDocument({ bytes, contentType, declaredKind }) → { status, detectedKind, extraction, reviewReasons }
 *
 * Status:
 *  - `extracted`     the parser read the document and nothing needs a person. The document may still be
 *                    not acceptable as proof (`notAcceptable`, e.g. a Medicaid notice); that is a finding.
 *  - `needs_review`  a person must look: low confidence, an unverified layout, a scan or photo with no text
 *                    layer, a declared/detected mismatch, anything uncertain. Never a silent yes.
 *  - `unreadable`    the file cannot be read at all (corrupt, encrypted, empty, unsupported type).
 *
 * Pure apart from pdfjs parsing the bytes in memory: no network, no file system, no clock.
 */
import { z } from "zod";
import { invalid } from "@/lib/errors";
import { checkAwardLetterDates, checkNames, findSuspiciousInstructions, type NameCheck } from "./checks";
import { classifyDocument, type Classification } from "./classify";
import { extractDocument } from "./extract";
import { detectFileType, type FileType } from "./file-type";
import { DocumentReadError, extractPdfText } from "./pdf-text";
import { redactText } from "./redact";
import { documentTextFromString, flat, fullText, hasSyntheticBanner, stripSyntheticBanner, type DocumentText } from "./text";
import {
  DEFAULT_DOCUMENT_POLICY,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentReaderPolicy,
  type Extraction,
  type NotAcceptableReason,
  type ReviewReason,
  type ReviewReasonCode,
} from "./types";

export type DocumentReadStatus = "extracted" | "needs_review" | "unreadable";

export interface DocumentReadResult {
  status: DocumentReadStatus;
  /** What the classifier concluded; `unknown` when nothing could be read. */
  detectedKind: DocumentKind;
  declaredKind: DocumentKind | null;
  classification: Classification | null;
  extraction: Extraction | null;
  /** Every reason a person must look, from reading, classification and extraction (de-duplicated by code). */
  reviewReasons: ReviewReason[];
  /** Read, but not usable as the proof asked for. Copied from the extraction for convenience. */
  notAcceptable: NotAcceptableReason[];
  fileType: FileType;
  textSource: "pdf_text" | "plain" | "none";
  pageCount: number | null;
  /** True when the document carries the synthetic-fixture banner. */
  synthetic: boolean;
  /** Present when `household` was given: how each person named on the document matched. */
  nameChecks: NameCheck[] | null;
  extractedBy: "parser" | null;
}

const householdPersonSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(200),
  middleName: z.string().max(200).nullish(),
  lastName: z.string().max(200).nullish(),
});

const policySchema = z
  .object({
    minFieldConfidence: z.number().min(0).max(1),
    autoAcceptUnverifiedLayouts: z.object({ tf0001SnapTanf: z.boolean(), ssiNoticeOfAward: z.boolean(), taxReturnTranscript: z.boolean() }).partial(),
    boundaryMarginDays: z.number().int().min(0).max(60),
    syntheticPolicy: z.enum(["tag", "reject"]),
    maxPdfBytes: z.number().int().positive(),
    maxPdfPages: z.number().int().positive().max(1000),
    minTextCharsPerPage: z.number().int().min(1),
  })
  .partial();

export const readDocumentInputSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  contentType: z.string().max(200).default(""),
  declaredKind: z.enum(DOCUMENT_KINDS as [DocumentKind, ...DocumentKind[]]).nullish(),
  /** `YYYY-MM-DD`. When given, award-letter dates are checked against the 12-month window. */
  referenceDate: z.iso.date().nullish(),
  /** When given, every person the document names is matched against these members. */
  household: z.array(householdPersonSchema).max(60).nullish(),
  policy: policySchema.optional(),
});
export type ReadDocumentInput = z.input<typeof readDocumentInputSchema>;

const REASON_MESSAGES: Partial<Record<ReviewReasonCode, string>> = {
  no_text_layer: "The file is a scan or photo with no readable text layer; a person must read it.",
  partial_text_layer: "Some pages have no readable text layer.",
  pages_truncated: "The file has more pages than the reader reads; the rest were not read.",
  file_truncated: "The PDF file is cut off; only part of it could be read.",
  kind_mismatch: "The document is not the kind the family said it was.",
  synthetic_fixture: "The document is a synthetic test sample and cannot be used as real evidence.",
  suspicious_instructions: "The document contains text addressed to a computer system; a person must check it.",
  language_unsupported: "The document is not in English; a person must read it.",
};

function reason(code: ReviewReasonCode, message?: string): ReviewReason {
  return { code, message: message ?? REASON_MESSAGES[code] ?? code };
}

function dedupe<T extends { code: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));
}

function resolvePolicy(p: z.infer<typeof policySchema> | undefined): DocumentReaderPolicy {
  return {
    ...DEFAULT_DOCUMENT_POLICY,
    ...p,
    autoAcceptUnverifiedLayouts: { ...DEFAULT_DOCUMENT_POLICY.autoAcceptUnverifiedLayouts, ...p?.autoAcceptUnverifiedLayouts },
  };
}

function baseResult(fileType: FileType, declaredKind: DocumentKind | null): DocumentReadResult {
  return {
    status: "needs_review",
    detectedKind: "unknown",
    declaredKind,
    classification: null,
    extraction: null,
    reviewReasons: [],
    notAcceptable: [],
    fileType,
    textSource: "none",
    pageCount: null,
    synthetic: false,
    nameChecks: null,
    extractedBy: null,
  };
}

const READ_FAILURE_REASON: Record<DocumentReadError["reason"], ReviewReasonCode> = {
  empty: "unreadable_file",
  not_pdf: "unsupported_file_type",
  too_large: "unreadable_file",
  encrypted: "encrypted_pdf",
  corrupt: "unreadable_file",
  timeout: "unreadable_file",
};

/** Reads an uploaded file. Never throws for anything about the file's contents; throws only on bad input. */
export async function readDocument(input: ReadDocumentInput): Promise<DocumentReadResult> {
  const parsed = readDocumentInputSchema.safeParse(input);
  if (!parsed.success) throw invalid("Invalid document read request", { issues: parsed.error.issues.map((i) => i.message) });
  const { bytes, declaredKind, referenceDate, household } = parsed.data;
  const policy = resolvePolicy(parsed.data.policy);
  const fileType = detectFileType(bytes, parsed.data.contentType);
  const result = baseResult(fileType, declaredKind ?? null);

  if (fileType === "jpeg" || fileType === "png" || fileType === "heic" || fileType === "webp") {
    result.reviewReasons.push(reason("no_text_layer", "The file is a photo or image; it has no text layer and is read by a person."));
    return result;
  }
  // Plain text is not an accepted upload (anyone can type a W-2); `readDocumentText` serves tests and demos.
  if (fileType !== "pdf") {
    result.status = "unreadable";
    result.reviewReasons.push(reason("unsupported_file_type", "The file type is not supported; upload a PDF or a photo."));
    return result;
  }

  try {
    const pdf = await extractPdfText(bytes, { maxBytes: policy.maxPdfBytes, maxPages: policy.maxPdfPages, minTextCharsPerPage: policy.minTextCharsPerPage });
    result.pageCount = pdf.pageCount;
    if (!pdf.hasTextLayer) {
      result.reviewReasons.push(reason("no_text_layer"));
      result.synthetic = hasSyntheticBanner(pdf);
      return result;
    }
    const extra: ReviewReason[] = [];
    if (pdf.truncated) extra.push(reason("file_truncated"));
    if (pdf.pagesRead < pdf.pageCount) extra.push(reason("pages_truncated"));
    if (pdf.pagesWithoutText.length > 0) extra.push(reason("partial_text_layer", `Pages without readable text: ${pdf.pagesWithoutText.join(", ")}.`));
    return finish(result, pdf, extra, policy, referenceDate ?? null, household ?? null);
  } catch (e) {
    if (!(e instanceof DocumentReadError)) throw e;
    result.status = "unreadable";
    result.reviewReasons.push(reason(READ_FAILURE_REASON[e.reason], e.message));
    return result;
  }
}

/** Reads already-extracted plain text (tests, demos, a reviewer pasting text). Same rules as a PDF. */
export function readDocumentText(
  text: string,
  opts: Omit<ReadDocumentInput, "bytes" | "contentType"> = {},
): DocumentReadResult {
  const parsed = readDocumentInputSchema.omit({ bytes: true, contentType: true }).safeParse(opts);
  if (!parsed.success) throw invalid("Invalid document read request", { issues: parsed.error.issues.map((i) => i.message) });
  const result = baseResult("text", parsed.data.declaredKind ?? null);
  return finish(result, documentTextFromString(text), [], resolvePolicy(parsed.data.policy), parsed.data.referenceDate ?? null, parsed.data.household ?? null);
}

function finish(
  result: DocumentReadResult,
  rawDoc: DocumentText,
  extra: ReviewReason[],
  policy: DocumentReaderPolicy,
  referenceDate: string | null,
  household: z.infer<typeof householdPersonSchema>[] | null,
): DocumentReadResult {
  result.textSource = rawDoc.source;
  result.synthetic = hasSyntheticBanner(rawDoc);
  const doc = stripSyntheticBanner(rawDoc);
  const reasons: ReviewReason[] = [...extra];
  if (result.synthetic && policy.syntheticPolicy === "reject") reasons.push(reason("synthetic_fixture"));

  const classification = classifyDocument(doc);
  result.classification = { ...classification, signals: classification.signals.map(redactText) };
  result.detectedKind = classification.kind;
  if (classification.language === "es") reasons.push(reason("language_unsupported"));
  if (classification.kind !== "unknown" && classification.confidence < policy.minFieldConfidence) {
    reasons.push(reason("low_confidence", "The document type was recognised from heuristic labels only."));
  }
  if (result.declaredKind && result.declaredKind !== "unknown" && classification.kind !== "unknown" && result.declaredKind !== classification.kind) {
    reasons.push(reason("kind_mismatch", `The family said this was a ${result.declaredKind.replace(/_/g, " ")}, but it reads as a ${classification.kind.replace(/_/g, " ")}.`));
  }
  if (findSuspiciousInstructions(flat(fullText(doc))).length > 0) reasons.push(reason("suspicious_instructions"));

  const extraction = extractDocument(doc, classification, policy);
  result.extraction = extraction;
  result.extractedBy = "parser";
  reasons.push(...extraction.reviewReasons);

  if (referenceDate && extraction.award) {
    reasons.push(...checkAwardLetterDates(extraction.award.letterDate, extraction.award.benefitPeriod?.end ?? null, referenceDate, policy.boundaryMarginDays));
  }
  if (household) {
    const { checks, reasons: nameReasons } = checkNames(extraction, household);
    result.nameChecks = checks;
    reasons.push(...nameReasons);
  }

  result.reviewReasons = dedupe(reasons);
  result.notAcceptable = dedupe(extraction.notAcceptable);
  result.status = result.reviewReasons.length > 0 ? "needs_review" : "extracted";
  return result;
}

export { classifyDocument } from "./classify";
export type { Classification } from "./classify";
export { extractDocument } from "./extract";
export { extractPdfText, DocumentReadError, isDocumentReadError } from "./pdf-text";
export type { PdfTextResult } from "./pdf-text";
export { documentTextFromString, normalizeText, SYNTHETIC_BANNER } from "./text";
export type { DocumentText, TextLine, TextPage } from "./text";
export { parseDocumentDate, findDates, parseMonthYear } from "./dates";
export { parseMoneyCents } from "./money";
export { redactText, redactSsns, maskIdentifier, containsFullSsn, findFullSsns } from "./redact";
export { matchPersonName, matchNameToHousehold, normalizeFullName } from "./names";
export type { NameMatch, NameMatchGrade, HouseholdPerson, HouseholdNameMatch, PersonName } from "./names";
export { checkAwardLetterDates, checkNames, findSuspiciousInstructions } from "./checks";
export type { NameCheck } from "./checks";
export { detectFileType } from "./file-type";
export type { FileType } from "./file-type";
export * from "./types";
