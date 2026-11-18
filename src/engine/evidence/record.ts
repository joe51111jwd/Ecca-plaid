import { KeyObject } from "node:crypto";
import type { z } from "zod";
import { canonicalJson, ed25519Sign, ed25519Verify, publicKeyFromJwk, sha256Hex } from "@/lib/crypto";
import { invalid } from "@/lib/errors";
import { APPROVAL_RULED_OUT, EVIDENCE_COPY_VERSION, METHOD_LABEL, METHOD_NOT_DETERMINED, PROGRAM_LABEL, decisionSummary, methodCitation, reliedOnStatement, type LimitFacts } from "./copy";
import { formatMoney } from "./format";
import { EVIDENCE_POLICY } from "./policy";
import { evidenceInputSchema, type ParsedEvidenceInput } from "./schema";
import { initialsOf, isSensitiveFieldName, removeSsnPatterns, sanitizeFilename } from "./text";
import {
  EVIDENCE_CANONICALIZATION,
  EVIDENCE_RECORD_TYPE,
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_SIGNATURE_ALG,
  type EvidenceIncomeTreatment,
  type EvidenceInput,
  type EvidenceJwk,
  type EvidenceJwks,
  type EvidenceMemberRole,
  type EvidenceMethodBasis,
  type EvidencePublicKey,
  type EvidenceRecord,
  type EvidenceRecordActor,
  type EvidenceRecordConsent,
  type EvidenceSigningKey,
  type EvidenceVerification,
  type EvidenceVerifyFailure,
  type SignedEvidence,
} from "./types";

/* ------------------------------------------------------------------------------------------ issues */

/**
 * `missing_audit_field`: something an auditor needs is absent (threshold source, table version or effective
 * date; consent version or timestamp; a file or report hash for a decided verification; reviewer identity or
 * notes). `inconsistent`: the input contradicts itself (totals, bounds, references, order of events).
 * `decision_contradicts_record`: the decision cannot follow from the facts supplied. `invalid`: wrong shape or format.
 */
export type EvidenceIssueCode = "invalid" | "missing_audit_field" | "inconsistent" | "decision_contradicts_record";

export interface EvidenceIssue {
  /** Where in `EvidenceInput`, e.g. `documents[2].sha256`. */
  path: string;
  code: EvidenceIssueCode;
  message: string;
}

/** `details` of the `validation_failed` AppError thrown by `buildEvidenceRecord`. */
export interface EvidenceInputErrorDetails {
  reason: "evidence_input_invalid";
  issues: EvidenceIssue[];
  /** The same issues keyed by path (first message per path), the shape `actionError` understands. */
  fields: Record<string, string>;
}

/* Input paths an auditor cannot do without. A problem at one of them is reported as `missing_audit_field`. */
const AUDIT_FIELD_PATHS: readonly RegExp[] = [
  /^threshold(\.(source|tableVersion|effectiveDate))?$/,
  /^consent(\.(copyVersion|copySha256|grantedAt))?$/,
  /^decision\.decidedBy(\.(type|reviewerId|reviewerName|notes))?$/,
  /^documents\[\d+\]\.sha256$/,
  /^rails\[\d+\]\.reportSha256$/,
];

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out === "" ? "(input)" : out;
}

function issuesFromZod(error: z.ZodError): EvidenceIssue[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    // Messages written in schema.ts are complete; anything else is zod's own wording for a missing or mistyped value.
    const message = /received undefined$/.test(issue.message) ? "is required" : issue.message.replace(/^Invalid input: /, "must be: ");
    return { path, code: AUDIT_FIELD_PATHS.some((pattern) => pattern.test(path)) ? "missing_audit_field" : "invalid", message };
  });
}

function refuse(issues: EvidenceIssue[]): never {
  const fields: Record<string, string> = {};
  for (const issue of issues) fields[issue.path] ??= issue.message;
  const details: EvidenceInputErrorDetails = { reason: "evidence_input_invalid", issues, fields };
  const shown = issues.slice(0, 5).map((issue) => `${issue.path} ${issue.message}`);
  const more = issues.length > shown.length ? ` (and ${issues.length - shown.length} more)` : "";
  throw invalid(`The evidence record cannot be built: ${shown.join("; ")}${more}`, details);
}

/* ----------------------------------------------------------------------------- cross-field rules */

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of ids) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

type ParsedIncome = NonNullable<ParsedEvidenceInput["income"]>;

/** Income as the record carries it: every line with a treatment, and the range resolved. */
interface CarriedIncome {
  year: number;
  totalCountedCents: number;
  lowerBoundCents: number;
  upperBoundCents: number;
  lines: Array<Omit<ParsedIncome["items"][number], "treatment" | "counted"> & { treatment: EvidenceIncomeTreatment }>;
}

/** The method-specific detail the record will carry, and the figures derived from the input. */
interface Detail {
  decided: boolean;
  income: CarriedIncome | null;
  categorical: ParsedEvidenceInput["categorical"];
  incomeDetailOmitted: boolean;
  statutoryUpperBoundCents: number;
}

function isSafe(value: bigint): boolean {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
}

/**
 * The largest reading at the statutory 300 percent: the ceiling above which nobody can be found eligible.
 * At a cap of 300 percent a reading is its own statutory figure. Under a stricter cap each reading has to
 * state it (or the caller states the bound itself); it is never estimated.
 */
function statutoryUpperBound(threshold: ParsedEvidenceInput["threshold"], add: (path: string, code: EvidenceIssueCode, message: string) => void): number {
  if (threshold.statutoryUpperBoundCents !== null) return threshold.statutoryUpperBoundCents;
  let highest = threshold.statutoryThresholdCents;
  threshold.readings.forEach((reading, index) => {
    if (reading.statutoryThresholdCents === null && threshold.capPct !== 300) {
      add(`threshold.readings[${index}].statutoryThresholdCents`, "invalid", "is required when the cap is below 300 percent (or give threshold.statutoryUpperBoundCents)");
    }
    highest = Math.max(highest, reading.statutoryThresholdCents ?? reading.thresholdCents);
  });
  return highest;
}

/**
 * Decides what method-specific detail the record carries (the data-minimization rule: a decided verification
 * carries only the detail its method rests on) and resolves the income lines and range.
 */
function resolveDetail(input: ParsedEvidenceInput, add: (path: string, code: EvidenceIssueCode, message: string) => void): Detail {
  const { decision } = input;
  const decided = decision.status === "eligible" || decision.status === "ineligible";
  const carryIncome = !(decided && decision.method === "categorical");
  const carryCategorical = !(decided && decision.method === "direct");

  let income: CarriedIncome | null = null;
  if (carryIncome && input.income !== null) {
    let counted = 0n;
    let open = 0n;
    const lines = input.income.items.map((item, index) => {
      const { treatment: stated, counted: flag, ...rest } = item;
      const fromFlag = flag === null ? null : flag ? ("counted" as const) : ("excluded" as const);
      if (stated === null && fromFlag === null) add(`income.items[${index}].treatment`, "invalid", "is required: counted, excluded or review (or counted: true or false)");
      if (stated !== null && flag !== null && (stated === "counted") !== flag) add(`income.items[${index}].counted`, "inconsistent", `contradicts treatment "${stated}"`);
      const treatment = stated ?? fromFlag ?? "excluded";
      if (treatment === "counted") counted += BigInt(item.annualAmountCents);
      if (treatment === "review") open += BigInt(item.annualAmountCents);
      return { ...rest, treatment };
    });
    const total = BigInt(input.income.totalCountedCents);
    if (counted !== total) {
      add("income.totalCountedCents", "inconsistent", `is ${formatMoney(input.income.totalCountedCents)} but the counted lines add up to ${counted.toString()} cents`);
    }
    const lower = input.income.lowerBoundCents ?? input.income.totalCountedCents;
    const defaultUpper = total + (open > 0n ? open : 0n);
    if (input.income.upperBoundCents === null && !isSafe(defaultUpper)) add("income.upperBoundCents", "invalid", "is required: the counted and open lines together are too large to add up");
    const upper = input.income.upperBoundCents ?? (isSafe(defaultUpper) ? Number(defaultUpper) : input.income.totalCountedCents);
    if (lower > input.income.totalCountedCents) add("income.lowerBoundCents", "inconsistent", "is greater than totalCountedCents");
    if (upper < input.income.totalCountedCents) add("income.upperBoundCents", "inconsistent", "is less than totalCountedCents");
    income = { year: input.income.year, totalCountedCents: input.income.totalCountedCents, lowerBoundCents: lower, upperBoundCents: upper, lines };
  }

  return {
    decided,
    income,
    categorical: carryCategorical ? input.categorical : null,
    incomeDetailOmitted: !carryIncome && input.income !== null,
    statutoryUpperBoundCents: statutoryUpperBound(input.threshold, add),
  };
}

function crossFieldIssues(input: ParsedEvidenceInput, detail: Detail, add: (path: string, code: EvidenceIssueCode, message: string) => void): void {
  const { decision, household, threshold, documents, rails, consent, additionalConsents } = input;
  const { decided, income, categorical } = detail;

  /* Identity of things that are referenced elsewhere. */
  const memberIds = new Set(household.members.map((member) => member.id));
  const documentIds = new Set(documents.map((document) => document.id));
  const railIds = new Set(rails.map((rail) => rail.id));
  const consentIds = new Set([consent.id, ...additionalConsents.map((entry) => entry.id)]);
  for (const repeated of duplicates(household.members.map((member) => member.id))) add("household.members", "inconsistent", `lists member ${repeated} more than once`);
  for (const repeated of duplicates(documents.map((document) => document.id))) add("documents", "inconsistent", `lists document ${repeated} more than once`);
  for (const repeated of duplicates(rails.map((rail) => rail.id))) add("rails", "inconsistent", `lists data connection ${repeated} more than once`);
  for (const repeated of duplicates([consent.id, ...additionalConsents.map((entry) => entry.id)])) add("additionalConsents", "inconsistent", `repeats consent ${repeated}`);
  for (const repeated of duplicates(threshold.readings.map((reading) => reading.id))) add("threshold.readings", "inconsistent", `lists reading ${repeated} more than once`);

  /* Household: the statute has the SGO verify family size, so the roster and the size must tell one story. */
  if (household.members.length === 0) add("household.members", "invalid", "is required: everyone residing with the student, including the student");
  else if (household.size !== household.members.length) add("household.size", "inconsistent", `is ${household.size} but the roster lists ${household.members.length} ${household.members.length === 1 ? "person" : "persons"}`);
  if (household.members.length > 0 && !household.members.some((member) => member.role === "student")) add("household.members", "invalid", "must include at least one member with role student");
  household.members.forEach((member, index) => {
    if (member.firstName === "" && member.lastName === "") add(`household.members[${index}]`, "invalid", "needs a first name or a last name");
    if (member.role === "student" && (member.firstName === "" || member.lastName === "")) add(`household.members[${index}]`, "invalid", "is a student and needs both a first and a last name, so an auditor can match the file to the applicant");
  });

  /* Decision. */
  const applicationYear = Number(decision.applicationDate.slice(0, 4));
  if (decision.incomeYear !== applicationYear - 1) add("decision.incomeYear", "inconsistent", `must be the calendar year before the application date (${applicationYear - 1})`);
  if (decision.status === "needs_review" && decision.reasons.length === 0) add("decision.reasons", "invalid", "must say why the verification needs review");
  if (decided && decision.method === null) add("decision.method", "invalid", "is required for a decided verification: direct or categorical");
  if (decision.decidedAt > input.generatedAt) add("decision.decidedAt", "inconsistent", "is later than generatedAt");
  if (decision.expiresAt !== null && decision.expiresAt <= decision.decidedAt) add("decision.expiresAt", "inconsistent", "is not later than decidedAt");
  if (consent.grantedAt > decision.decidedAt) add("consent.grantedAt", "inconsistent", "is later than the decision: consent has to come first");
  additionalConsents.forEach((entry, index) => {
    if (entry.grantedAt > input.generatedAt) add(`additionalConsents[${index}].grantedAt`, "inconsistent", "is later than generatedAt");
  });

  /* Threshold: a provisional table is always labeled, and the readings explain every number shown. */
  if (threshold.source === "hud_provisional" && !threshold.provisional) add("threshold.provisional", "inconsistent", "must be true while the table is HUD-derived");
  if (threshold.source === "irs_published" && threshold.provisional) add("threshold.provisional", "inconsistent", "must be false for an IRS-published table");
  if (threshold.statutoryThresholdCents < threshold.thresholdCents) add("threshold.statutoryThresholdCents", "inconsistent", "is lower than the limit applied; a cap can only lower the statutory limit");
  if (threshold.capPct === 300 && threshold.statutoryThresholdCents !== threshold.thresholdCents) add("threshold.statutoryThresholdCents", "inconsistent", "must equal thresholdCents when the cap is the statutory 300 percent");
  if (threshold.readings.length > 0) {
    const limits = threshold.readings.map((reading) => reading.thresholdCents);
    const lowest = Math.min(...limits);
    const highest = Math.max(...limits);
    if (threshold.lowerBoundCents !== lowest) add("threshold.lowerBoundCents", "inconsistent", `must equal the smallest reading (${formatMoney(lowest)})`);
    if (threshold.upperBoundCents !== highest) add("threshold.upperBoundCents", "inconsistent", `must equal the largest reading (${formatMoney(highest)})`);
    if (threshold.readingsAgree !== (lowest === highest)) add("threshold.readingsAgree", "inconsistent", lowest === highest ? "must be true: every reading gives the same limit" : "must be false: the readings give different limits");
    if (!limits.includes(threshold.thresholdCents)) add("threshold.thresholdCents", "inconsistent", "must equal the limit of one of the readings");
    if (detail.statutoryUpperBoundCents < highest) add("threshold.statutoryUpperBoundCents", "inconsistent", "is lower than the largest reading; a cap can only lower the statutory limit");
  }

  /* Evidence items. */
  documents.forEach((document, index) => {
    const at = `documents[${index}]`;
    if (document.memberId !== null && !memberIds.has(document.memberId)) add(`${at}.memberId`, "inconsistent", "is not on the household roster");
    if (document.uploadedAt > input.generatedAt) add(`${at}.uploadedAt`, "inconsistent", "is later than generatedAt");
    if (document.purgedAt !== null && document.purgedAt < document.uploadedAt) add(`${at}.purgedAt`, "inconsistent", "is earlier than uploadedAt");
    if (document.purgedAt !== null && document.purgedAt > input.generatedAt) add(`${at}.purgedAt`, "inconsistent", "is later than generatedAt");
    document.extractedFields.forEach((field, fieldIndex) => {
      if ((field.value === null) === (field.amountCents === null)) add(`${at}.extractedFields[${fieldIndex}]`, "invalid", "needs exactly one of value (text) or amountCents (money)");
    });
  });
  rails.forEach((rail, index) => {
    const at = `rails[${index}]`;
    if (rail.memberId !== null && !memberIds.has(rail.memberId)) add(`${at}.memberId`, "inconsistent", "is not on the household roster");
    if (rail.consentId !== null && !consentIds.has(rail.consentId)) add(`${at}.consentId`, "inconsistent", "is not one of the consents in this input");
    if (rail.connectedAt > input.generatedAt) add(`${at}.connectedAt`, "inconsistent", "is later than generatedAt");
    if (rail.retrievedAt !== null && rail.retrievedAt < rail.connectedAt) add(`${at}.retrievedAt`, "inconsistent", "is earlier than connectedAt");
    if (rail.retrievedAt !== null && rail.retrievedAt > input.generatedAt) add(`${at}.retrievedAt`, "inconsistent", "is later than generatedAt");
  });
  if (decided && documents.length + rails.length === 0) {
    add("documents", "missing_audit_field", "a decided verification needs at least one document hash or data-connection report hash");
  }

  /* Reviews and timeline cannot report the future. */
  input.reviewTrail.forEach((entry, index) => {
    if (entry.at > input.generatedAt) add(`reviewTrail[${index}].at`, "inconsistent", "is later than generatedAt");
    if ((entry.actor.type === "reviewer" || entry.actor.type === "user") && entry.actor.id === null && entry.actor.name === null) {
      add(`reviewTrail[${index}].actor`, "missing_audit_field", "must identify the person who reviewed (id or name)");
    }
  });
  input.timeline.forEach((entry, index) => {
    if (entry.at > input.generatedAt) add(`timeline[${index}].at`, "inconsistent", "is later than generatedAt");
  });

  /* Income detail, whenever it is carried. */
  if (income !== null) {
    if (income.year !== decision.incomeYear) add("income.year", "inconsistent", `must equal decision.incomeYear (${decision.incomeYear})`);
    income.lines.forEach((line, index) => {
      const at = `income.items[${index}]`;
      if (line.memberId !== null && !memberIds.has(line.memberId)) add(`${at}.memberId`, "inconsistent", "is not on the household roster");
      if (line.source === "document" && line.documentId === null) add(`${at}.documentId`, "missing_audit_field", "is required when the income figure comes from a document");
      if (line.source === "rail" && line.railId === null) add(`${at}.railId`, "missing_audit_field", "is required when the income figure comes from a data connection");
      if (line.documentId !== null && !documentIds.has(line.documentId)) add(`${at}.documentId`, "inconsistent", "is not one of the documents in this input");
      if (line.railId !== null && !railIds.has(line.railId)) add(`${at}.railId`, "inconsistent", "is not one of the data connections in this input");
    });
  }

  /* Categorical detail, whenever it is carried. */
  if (categorical !== null) {
    if (categorical.namedMemberId !== null && !memberIds.has(categorical.namedMemberId)) add("categorical.namedMemberId", "inconsistent", "is not on the household roster");
    if (categorical.documentId !== null && !documentIds.has(categorical.documentId)) add("categorical.documentId", "inconsistent", "is not one of the documents in this input");
  }

  /* A decided verification: the detail its method rests on must be there, and the decision must follow from it. */
  if (decided && decision.method === "direct") {
    if (income === null) {
      add("income", "invalid", "is required for a decided direct verification");
    } else {
      // The two tests below are the ones the decision engine applies to a reviewer's resolution, so nothing it
      // allows is refused here. A decision the record's own numbers rule out under every reading is never signed.
      if (decision.status === "eligible" && income.totalCountedCents > detail.statutoryUpperBoundCents) {
        add(
          "decision.status",
          "decision_contradicts_record",
          `is eligible, but counted income of ${formatMoney(income.totalCountedCents)} is greater than the statutory limit under every reading (${formatMoney(detail.statutoryUpperBoundCents)})`,
        );
      }
      if (decision.status === "ineligible" && income.upperBoundCents <= threshold.lowerBoundCents) {
        add(
          "decision.status",
          "decision_contradicts_record",
          `is ineligible, but household income of at most ${formatMoney(income.upperBoundCents)} is not greater than the limit under any reading (${formatMoney(threshold.lowerBoundCents)})`,
        );
      }
    }
  }
  if (decided && decision.method === "categorical") {
    if (decision.status === "ineligible") {
      // docs/architecture.md, rule 2: ineligible means the evidence affirmatively shows income over the limit.
      add("decision.status", "decision_contradicts_record", "cannot be ineligible under the categorical method: missing or unusable documentation is not evidence of income over the limit");
    }
    if (categorical === null) {
      add("categorical", "invalid", "is required for a decided categorical verification");
    } else if (decision.status === "eligible") {
      if (categorical.program === null) add("categorical.program", "missing_audit_field", "is required for an eligible categorical decision");
      if (categorical.letterDate === null) add("categorical.letterDate", "missing_audit_field", "is required for an eligible categorical decision");
      if (categorical.documentId === null) add("categorical.documentId", "missing_audit_field", "is required for an eligible categorical decision: the document that shows the approval");
      if (APPROVAL_RULED_OUT.has(categorical.approvalStatus)) {
        add("decision.status", "decision_contradicts_record", `is eligible, but the documentation shows the approval is ${categorical.approvalStatus}, not current`);
      }
      if (categorical.approvalStatus === "unclear" && decision.decidedBy.type === "engine") {
        add("decision.status", "decision_contradicts_record", "is eligible by the engine, but the approval status is unclear: an unclear document goes to a reviewer");
      }
    }
  }
}

/* ------------------------------------------------------------------------------------ record build */

const ROLE_ORDER: Readonly<Record<EvidenceMemberRole, number>> = { student: 0, adult: 1, child: 2, other: 3 };

/** Stable order that does not depend on how the caller's query happened to sort. */
function sortedBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, sortKey: key(item) }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.index - b.index))
    .map((entry) => entry.item);
}

/* Leaves that hold an identifier or a hash are left as they are: identifiers are refused at validation when
   they are shaped like a Social Security number, and a hash is hexadecimal. Everything else is free text. */
const IDENTIFIER_OR_HASH_KEY = /(^|_)(id|kid|sha256)$/;

/**
 * Last step of the build: removes anything shaped like a Social Security number from every text leaf of the
 * record and counts what went. Inside a consent `scope` the keys are the caller's, so there every leaf is
 * treated as free text.
 */
function scrubRecord(record: EvidenceRecord): { record: EvidenceRecord; removed: number } {
  let removed = 0;
  const scrub = (value: unknown, key: string, callerKeys: boolean): unknown => {
    if (typeof value === "string") {
      if (!callerKeys && IDENTIFIER_OR_HASH_KEY.test(key)) return value;
      const result = removeSsnPatterns(value);
      removed += result.removed;
      return result.text;
    }
    if (Array.isArray(value)) return value.map((entry) => scrub(entry, key, callerKeys));
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(value)) {
        // defineProperty: a caller's scope key named "__proto__" must stay an ordinary property.
        Object.defineProperty(out, childKey, { value: scrub(child, childKey, callerKeys || key === "scope"), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    return value;
  };
  return { record: scrub(record, "", false) as EvidenceRecord, removed };
}

function methodBasis(input: ParsedEvidenceInput): EvidenceMethodBasis {
  if (input.decision.method === null) return "not_determined";
  if (input.decision.method === "categorical") return input.documents.length > 0 ? "categorical_documentation" : "none_recorded";
  if (input.documents.length > 0 && input.rails.length > 0) return "written_documentation_and_other_relevant_data_sources";
  if (input.documents.length > 0) return "written_documentation";
  if (input.rails.length > 0) return "other_relevant_data_sources";
  return "none_recorded";
}

/** Which figure a decided direct verification compared income with, and everything the sentences say about the limit. */
function limitFacts(input: ParsedEvidenceInput, detail: Detail): LimitFacts {
  const { decision, threshold } = input;
  const { income } = detail;
  const lowest = threshold.readings.reduce((low, reading) => (reading.thresholdCents < low.thresholdCents ? reading : low));
  const highest = threshold.readings.reduce((high, reading) => (reading.thresholdCents > high.thresholdCents ? reading : high));
  const facts: LimitFacts = {
    provisional: threshold.provisional,
    capPct: threshold.capPct,
    lowerBoundCents: threshold.lowerBoundCents,
    upperBoundCents: threshold.upperBoundCents,
    readingsAgree: threshold.readingsAgree,
    statutoryUpperBoundCents: detail.statutoryUpperBoundCents,
    lowerLabel: lowest.label,
    upperLabel: highest.label,
    reliedOn: "none",
    reliedOnLimitCents: null,
    restsOnOpenLines: false,
  };
  if (!detail.decided || decision.method !== "direct" || income === null) return facts;

  const lower = { reliedOn: threshold.readingsAgree ? ("single_limit" as const) : ("lower_bound" as const), reliedOnLimitCents: threshold.lowerBoundCents };
  const upper = { reliedOn: threshold.readingsAgree ? ("single_limit" as const) : ("upper_bound" as const), reliedOnLimitCents: threshold.upperBoundCents };
  const recorded = income.totalCountedCents;
  if (decision.status === "eligible") {
    // Within the lowest reading means within every reading; above it, only a higher figure supports "eligible".
    if (recorded <= threshold.lowerBoundCents) return { ...facts, ...lower };
    if (recorded <= threshold.upperBoundCents) return { ...facts, ...upper };
    return { ...facts, reliedOn: "statutory_limit", reliedOnLimitCents: detail.statutoryUpperBoundCents };
  }
  // Above the highest reading means above every reading; below it, only a lower figure supports "ineligible".
  if (recorded > threshold.upperBoundCents) return { ...facts, ...upper };
  if (recorded > threshold.lowerBoundCents) return { ...facts, ...lower };
  // The recorded figure is within every reading: the decision can only rest on lines whose treatment is open.
  return { ...facts, ...lower, restsOnOpenLines: true };
}

function actorRecord(actor: ParsedEvidenceInput["reviewTrail"][number]["actor"]): EvidenceRecordActor {
  // Staff who review are named; nobody else is (data-minimization rule).
  const named = actor.type === "reviewer" || actor.type === "user";
  return { type: actor.type, id: actor.id, name: named ? actor.name : null };
}

function consentRecord(consent: ParsedEvidenceInput["consent"]): EvidenceRecordConsent {
  return {
    id: consent.id,
    kind: consent.kind,
    copy_version: consent.copyVersion,
    copy_sha256: consent.copySha256,
    locale: consent.locale,
    granted_at: consent.grantedAt,
    granted_by: consent.grantedBy,
    scope: consent.scope,
  };
}

/**
 * Builds the record an SGO hands an auditor. Pure: the same input always gives the same record.
 *
 * Refuses, with a `validation_failed` AppError whose `details` is `EvidenceInputErrorDetails`, when the input
 * is malformed, when a field an auditor needs is missing, when the input contradicts itself, or when the
 * decision cannot follow from the facts supplied.
 */
export function buildEvidenceRecord(input: EvidenceInput): EvidenceRecord {
  const parsed = evidenceInputSchema.safeParse(input);
  if (!parsed.success) refuse(issuesFromZod(parsed.error));
  const data = parsed.data;
  const problems: EvidenceIssue[] = [];
  const add = (path: string, code: EvidenceIssueCode, message: string) => void problems.push({ path, code, message });
  const detail = resolveDetail(data, add);
  crossFieldIssues(data, detail, add);
  if (problems.length > 0) refuse(problems);

  const { decision, household, geography, threshold } = data;
  const { income, categorical } = detail;
  const limit = limitFacts(data, detail);
  const incomeFacts = income === null ? null : { countedCents: income.totalCountedCents, lowerBoundCents: income.lowerBoundCents, upperBoundCents: income.upperBoundCents };
  const members = sortedBy(household.members, (member) => String(ROLE_ORDER[member.role]));

  const summary = decisionSummary({
    status: decision.status,
    method: decision.method,
    decidedByReviewer: decision.decidedBy.type === "reviewer",
    incomeYear: decision.incomeYear,
    householdSize: household.size,
    countyName: geography.countyName,
    state: geography.state,
    limit,
    income: incomeFacts,
    program: categorical?.program ?? null,
    letterDate: categorical?.letterDate ?? null,
    approvalStatus: categorical?.approvalStatus ?? null,
  });
  const statement = reliedOnStatement({ status: decision.status, method: decision.method, limit, income: incomeFacts });

  let extractedFieldsRemoved = 0;
  const documents = sortedBy(data.documents, (document) => `${document.uploadedAt} ${document.id}`).map((document) => {
    const kept = document.extractedFields.filter((field) => !isSensitiveFieldName(field.key, field.label));
    extractedFieldsRemoved += document.extractedFields.length - kept.length;
    return {
      id: document.id,
      kind: document.kind,
      sha256: document.sha256,
      filename: sanitizeFilename(document.filename),
      size_bytes: document.sizeBytes,
      content_type: document.contentType,
      uploaded_at: document.uploadedAt,
      extracted_by: document.extractedBy,
      member_id: document.memberId,
      raw_file_status: document.purgedAt === null ? ("retained" as const) : ("purged" as const),
      purged_at: document.purgedAt,
      extracted_fields: kept.map((field) => ({
        key: field.key,
        label: field.label,
        value: field.value,
        amount_cents: field.amountCents,
        confidence_pct: field.confidencePct,
      })),
    };
  });

  const record: EvidenceRecord = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    record_type: EVIDENCE_RECORD_TYPE,
    copy_version: EVIDENCE_COPY_VERSION,
    verification_id: data.verificationId,
    mode: data.mode,
    generated_at: data.generatedAt,
    reused_from_verification_id: data.reusedFromVerificationId,
    sgo: { id: data.sgo.id, name: data.sgo.name, ein: data.sgo.ein, external_ref: data.externalRef },
    decision: {
      status: decision.status,
      method: decision.method,
      method_label: decision.method === null ? METHOD_NOT_DETERMINED : METHOD_LABEL[decision.method],
      method_basis: methodBasis(data),
      method_citation: decision.method === null ? null : methodCitation(decision.method),
      summary,
      reasons: decision.reasons.map((reason) => ({ code: reason.code, message: reason.message, member_ids: reason.memberIds, source_ids: reason.sourceIds })),
      application_date: decision.applicationDate,
      income_year: decision.incomeYear,
      decided_at: decision.decidedAt,
      decided_by:
        decision.decidedBy.type === "reviewer"
          ? {
              type: "reviewer",
              reviewer_id: decision.decidedBy.reviewerId,
              reviewer_name: decision.decidedBy.reviewerName,
              reviewer_notes: decision.decidedBy.notes,
            }
          : { type: "engine", reviewer_id: null, reviewer_name: null, reviewer_notes: null },
      expires_at: decision.expiresAt,
    },
    household: {
      id: household.id,
      size: household.size,
      students: members.filter((member) => member.role === "student").map((member) => ({ member_id: member.id, name: `${member.firstName} ${member.lastName}`.trim() })),
      members: members.map((member) => ({
        member_id: member.id,
        role: member.role,
        initials: initialsOf(member.firstName, member.lastName),
        relationship: member.relationship,
      })),
      custody:
        household.custody === null
          ? null
          : {
              lives_in_multiple_households: household.custody.livesInMultipleHouseholds,
              months_in_this_household: household.custody.monthsInThisHousehold,
              equal_time: household.custody.equalTime,
              this_household_has_higher_income: household.custody.thisHouseholdHasHigherIncome,
              notes: household.custody.notes,
              outcome: household.custody.outcome,
            },
    },
    geography: {
      state: geography.state,
      county_fips: geography.countyFips,
      county_name: geography.countyName,
      area_code: geography.areaCode,
      area_name: geography.areaName,
      zip: geography.zip,
      county_resolution: geography.countyResolution,
    },
    threshold: {
      limit_cents: threshold.thresholdCents,
      statutory_limit_cents: threshold.statutoryThresholdCents,
      median_income_cents: threshold.medianIncomeCents,
      family_size_multiplier: threshold.multiplier,
      cap_pct: threshold.capPct,
      source: threshold.source,
      table_version: threshold.tableVersion,
      effective_date: threshold.effectiveDate,
      method: threshold.method,
      formula: threshold.formula,
      provisional: threshold.provisional,
      label: {
        copy_version: threshold.label.copyVersion,
        badge: threshold.label.badge,
        limit_label: threshold.label.limitLabel,
        source_line: threshold.label.sourceLine,
        explanation: threshold.label.explanation,
        readings_note: threshold.label.readingsNote,
      },
      readings: threshold.readings.map((reading) => ({
        id: reading.id,
        label: reading.label,
        limit_cents: reading.thresholdCents,
        statutory_limit_cents: reading.statutoryThresholdCents,
        formula: reading.formula,
      })),
      lower_bound_cents: threshold.lowerBoundCents,
      upper_bound_cents: threshold.upperBoundCents,
      readings_agree: threshold.readingsAgree,
      statutory_upper_bound_cents: detail.statutoryUpperBoundCents,
      relied_on: limit.reliedOn,
      relied_on_limit_cents: limit.reliedOnLimitCents,
      relied_on_statement: statement,
    },
    income:
      income === null
        ? null
        : {
            year: income.year,
            total_counted_cents: income.totalCountedCents,
            lower_bound_cents: income.lowerBoundCents,
            upper_bound_cents: income.upperBoundCents,
            items: sortedBy(income.lines, (line) => `${line.categoryLabel} ${line.id} ${line.treatment}`).map((line) => ({
              id: line.id,
              category: line.category,
              category_label: line.categoryLabel,
              description: line.description,
              member_id: line.memberId,
              annual_amount_cents: line.annualAmountCents,
              treatment: line.treatment,
              basis: line.basis,
              source: line.source,
              document_id: line.documentId,
              rail_id: line.railId,
            })),
          },
    categorical:
      categorical === null
        ? null
        : {
            program: categorical.program,
            program_label: categorical.program === null ? null : PROGRAM_LABEL[categorical.program],
            letter_date: categorical.letterDate,
            approval_status: categorical.approvalStatus,
            issuing_agency: categorical.issuingAgency,
            named_member_id: categorical.namedMemberId,
            benefit_period_end: categorical.benefitPeriodEnd,
            document_id: categorical.documentId,
          },
    documents,
    rails: sortedBy(data.rails, (rail) => `${rail.connectedAt} ${rail.id}`).map((rail) => ({
      id: rail.id,
      provider: rail.provider,
      kind: rail.kind,
      report_sha256: rail.reportSha256,
      connected_at: rail.connectedAt,
      retrieved_at: rail.retrievedAt,
      member_id: rail.memberId,
      consent_id: rail.consentId,
    })),
    consent: consentRecord(data.consent),
    additional_consents: sortedBy(data.additionalConsents, (consent) => `${consent.grantedAt} ${consent.id}`).map((consent) => consentRecord(consent)),
    review_trail: sortedBy(data.reviewTrail, (entry) => entry.at).map((entry) => ({
      at: entry.at,
      actor: actorRecord(entry.actor),
      action: entry.action,
      notes: entry.notes,
    })),
    timeline: sortedBy(data.timeline, (entry) => entry.at).map((entry) => ({
      at: entry.at,
      event: entry.event,
      actor: entry.actor === null ? null : actorRecord(entry.actor),
      detail: entry.detail,
    })),
    data_minimization: { rule_version: EVIDENCE_POLICY.dataMinimizationRuleVersion, ssn_patterns_removed: 0, extracted_fields_removed: 0, income_detail_omitted: detail.incomeDetailOmitted },
    versions: { engine: data.versions.engine, taxonomy: data.versions.taxonomy, rule_set: data.versions.ruleSet },
  };

  const scrubbed = scrubRecord(record);
  scrubbed.record.data_minimization = {
    rule_version: EVIDENCE_POLICY.dataMinimizationRuleVersion,
    ssn_patterns_removed: scrubbed.removed,
    extracted_fields_removed: extractedFieldsRemoved,
    income_detail_omitted: detail.incomeDetailOmitted,
  };
  return scrubbed.record;
}

/* ------------------------------------------------------------------------------ canonical + sign */

/** The exact bytes that are hashed and signed: canonical JSON of the record, UTF-8. */
export function canonicalRecordBytes(record: EvidenceRecord): Uint8Array {
  return Buffer.from(canonicalJson(record), "utf8");
}

function isEd25519(key: KeyObject): boolean {
  return key.asymmetricKeyType === "ed25519";
}

/**
 * Signs a record with an Ed25519 private key. The signature covers the canonical bytes of `record`, so any
 * change to any field, added key or removed key breaks it, while key order and white space do not matter.
 */
export function signEvidenceRecord(record: EvidenceRecord, key: EvidenceSigningKey): SignedEvidence {
  if (record.schema_version !== EVIDENCE_SCHEMA_VERSION || record.record_type !== EVIDENCE_RECORD_TYPE) {
    throw invalid("Only evidence records of the current schema version can be signed");
  }
  if (typeof key.kid !== "string" || key.kid === "") throw invalid("The signing key needs a key id");
  if (key.privateKey.type !== "private" || !isEd25519(key.privateKey)) throw invalid("Evidence records are signed with an Ed25519 private key only");
  const bytes = canonicalRecordBytes(record);
  return {
    record,
    signature: {
      alg: EVIDENCE_SIGNATURE_ALG,
      kid: key.kid,
      value: ed25519Sign(bytes, key.privateKey),
      canonicalization: EVIDENCE_CANONICALIZATION,
      record_sha256: sha256Hex(bytes),
    },
  };
}

/* ------------------------------------------------------------------------------------------ verify */

const FAILURE_MESSAGE: Readonly<Record<EvidenceVerifyFailure, string>> = Object.freeze({
  malformed: "The file is not a signed evidence record (expected an object with record and signature).",
  unsupported_alg: "The signature algorithm is not EdDSA (Ed25519). No other algorithm is accepted.",
  unsupported_canonicalization: `The canonicalization is not ${EVIDENCE_CANONICALIZATION}.`,
  unsupported_schema: `The record is not an evidence record of schema version ${EVIDENCE_SCHEMA_VERSION}.`,
  not_canonicalizable: "The record contains a value that cannot be canonicalized (for example a number that is not a whole number).",
  record_hash_mismatch: "The record does not match its SHA-256 hash: it was changed after it was signed.",
  unknown_kid: "No public key with the record's key id was supplied.",
  unsupported_key: "The public key for the record's key id is not an Ed25519 signature key.",
  malformed_signature: "The signature value is not a canonical base64url Ed25519 signature.",
  bad_signature: "The signature does not verify against the record with the supplied public key.",
});

function failure(reason: EvidenceVerifyFailure, kid: string | null): EvidenceVerification {
  return { valid: false, reason, message: FAILURE_MESSAGE[reason], kid };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

type KeyLookup = { status: "found"; key: KeyObject } | { status: "unknown_kid" } | { status: "unsupported_key" };

/* Only OKP / Ed25519 signature keys are usable. Anything else with a matching kid (RSA, EC, a shared secret,
   a key marked for encryption or for another algorithm) is refused before it reaches the verifier, which is
   what closes algorithm and key-type confusion. */
function keyFromJwk(jwk: EvidenceJwk): KeyObject | null {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") return null;
  if ("d" in jwk) return null;
  if (jwk.alg !== undefined && jwk.alg !== EVIDENCE_SIGNATURE_ALG) return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  try {
    const key = publicKeyFromJwk({ kty: "OKP", crv: "Ed25519", x: jwk.x });
    return key.type === "public" && isEd25519(key) ? key : null;
  } catch {
    return null;
  }
}

/** The keys a caller may supply, as one list: a JWKS document, one JWK, one in-memory key, or a list of in-memory keys. */
export type EvidenceVerificationKeys = EvidenceJwks | EvidenceJwk | EvidencePublicKey | readonly EvidencePublicKey[];

function candidateKeys(keys: unknown): unknown[] {
  if (Array.isArray(keys)) return [...keys];
  if (isPlainObject(keys) && Array.isArray(keys.keys)) return [...keys.keys];
  return [keys];
}

function findKey(keys: EvidenceVerificationKeys, kid: string): KeyLookup {
  const matches = candidateKeys(keys).filter((candidate): candidate is Record<string, unknown> => isPlainObject(candidate) && candidate.kid === kid);
  if (matches.length === 0) return { status: "unknown_kid" };
  // Two different keys under one id would let the publisher of either pass as the other.
  if (matches.length > 1) return { status: "unsupported_key" };
  const match = matches[0];
  if (match.publicKey instanceof KeyObject) {
    return match.publicKey.type === "public" && isEd25519(match.publicKey) ? { status: "found", key: match.publicKey } : { status: "unsupported_key" };
  }
  const key = keyFromJwk(match);
  return key ? { status: "found", key } : { status: "unsupported_key" };
}

const ENVELOPE_KEYS = ["record", "signature"] as const;
const SIGNATURE_KEYS = ["alg", "kid", "value", "canonicalization", "record_sha256"] as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ED25519_SIGNATURE_BYTES = 64;

/**
 * Checks a signed evidence record against a set of public keys: a JWKS document (`{ keys: [...] }`), a single
 * public JWK, or keys in memory (`{ kid, publicKey }`, one or a list).
 *
 * Valid only when all of these hold: the envelope is well formed; the algorithm is EdDSA and the
 * canonicalization is the one this schema defines; the record's canonical bytes hash to `record_sha256`; a
 * key with the record's `kid` is supplied and is an Ed25519 signature key; the signature is canonical
 * base64url of 64 bytes and verifies over the canonical bytes. Never throws on hostile input.
 */
export function verifySignedEvidence(signed: unknown, keys: EvidenceVerificationKeys): EvidenceVerification {
  if (!isPlainObject(signed) || !isPlainObject(signed.record) || !isPlainObject(signed.signature)) return failure("malformed", null);
  const { record, signature } = signed;
  const kid = typeof signature.kid === "string" && signature.kid !== "" ? signature.kid : null;
  // Nothing outside `record` is signed, so nothing else may ride along in the envelope looking as if it were.
  if (!hasExactlyKeys(signed, ENVELOPE_KEYS) || !hasExactlyKeys(signature, SIGNATURE_KEYS)) return failure("malformed", kid);
  if (kid === null || typeof signature.value !== "string" || typeof signature.record_sha256 !== "string") return failure("malformed", kid);
  if (signature.alg !== EVIDENCE_SIGNATURE_ALG) return failure("unsupported_alg", kid);
  if (signature.canonicalization !== EVIDENCE_CANONICALIZATION) return failure("unsupported_canonicalization", kid);
  if (record.schema_version !== EVIDENCE_SCHEMA_VERSION || record.record_type !== EVIDENCE_RECORD_TYPE) return failure("unsupported_schema", kid);

  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(canonicalJson(record), "utf8");
  } catch {
    return failure("not_canonicalizable", kid);
  }
  if (sha256Hex(bytes) !== signature.record_sha256) return failure("record_hash_mismatch", kid);

  const lookup = findKey(keys, kid);
  if (lookup.status !== "found") return failure(lookup.status, kid);

  // Node's base64url decoder skips characters it does not know and ignores spare bits, so the same signature
  // bytes have many spellings. Only the canonical spelling is accepted: decode, re-encode, compare.
  if (!BASE64URL.test(signature.value)) return failure("malformed_signature", kid);
  const signatureBytes = Buffer.from(signature.value, "base64url");
  if (signatureBytes.length !== ED25519_SIGNATURE_BYTES || signatureBytes.toString("base64url") !== signature.value) return failure("malformed_signature", kid);

  return ed25519Verify(bytes, signature.value, lookup.key) ? { valid: true, kid } : failure("bad_signature", kid);
}
