/**
 * WIC documents (reference C1-C7, P4). No Texas WIC layout is verified: every label below is a test
 * invention modelled on the federal VOC field list (7 CFR 246.7(k)(4)), so every WIC document is reviewed
 * in v1 and the extractor only pre-fills the reviewer's screen. Nutritional risk data is never read (C1).
 */
import { flat, fullText, valueAfterLabel } from "../text";
import type { ApprovalStatus, Extraction } from "../types";
import { finishAward, readLetterDate, recordNegativeWording } from "./award-common";
import { CONF_HEURISTIC, ExtractionBuilder, isPlausibleName, readLabeledDate, type ExtractContext } from "./common";

const NEGATIVE = [/Ineligibility/i, /\bTermination\b/i, /Disqualification/i, /Expiration of Eligibility/i, /no longer categorically eligible/i];

function readName(ctx: ExtractContext, b: ExtractionBuilder, label: RegExp, key: string): string | null {
  const v = valueAfterLabel(ctx.doc, label, /^[A-Za-zÀ-ÿ' .,-]+$/);
  if (!v || !isPlausibleName(v.value)) return null;
  b.set(key, v.value, CONF_HEURISTIC, v.ref);
  return v.value;
}

function readDate(ctx: ExtractContext, b: ExtractionBuilder, label: RegExp, key: string): string | null {
  const d = readLabeledDate(ctx.doc, label);
  if (!d) return null;
  if (d.ambiguous) {
    b.review("date_ambiguous", `The ${key.replace(/_/g, " ")} "${d.raw}" can be read more than one way.`);
    return null;
  }
  if (d.date) b.set(key, d.date, CONF_HEURISTIC, d.ref);
  return d.date;
}

export function extractWic(ctx: ExtractContext, subtype: "wic_certification" | "wic_ineligible" | "wic_benefit_list"): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const text = flat(fullText(ctx.doc));
  const participant = readName(ctx, b, /Participant Name:/i, "participant_name");
  if (participant) b.alias("recipient_name", "participant_name");
  const agency = valueAfterLabel(ctx.doc, /Local Agency:/i, /^.{3,120}$/, { below: false });
  if (agency) b.set("local_agency", agency.value, CONF_HEURISTIC, agency.ref);
  const negative = recordNegativeWording(b, text, NEGATIVE);

  let approvalStatus: ApprovalStatus = "unclear";
  let period: { start: string | null; end: string | null } | null = null;
  if (subtype === "wic_certification") {
    const start = readDate(ctx, b, /Certification Start Date:/i, "certification_start_date");
    const end = readDate(ctx, b, /Certification End Date:/i, "certification_end_date");
    readDate(ctx, b, /Date Income Eligibility Determined:/i, "income_determination_date");
    const voc = valueAfterLabel(ctx.doc, /VOC ID:/i, /^[A-Za-z0-9-]{1,40}$/, { below: false });
    if (voc) b.set("voc_id", voc.value, CONF_HEURISTIC, voc.ref);
    // The 12-month test runs on the certification date (P4); it is the document's date.
    if (start) b.alias("letter_date", "certification_start_date");
    else b.review("date_missing", "The certification date could not be read.");
    period = { start, end };
    approvalStatus = negative.length === 0 && start ? "approved" : "unclear";
    if (/Notification of Certification Expiration/i.test(text)) {
      approvalStatus = "unclear";
      b.review("approval_unclear", "A certification-expiration notice is neither an approval nor a denial.");
    }
  } else if (subtype === "wic_ineligible") {
    readLetterDate(ctx, b, /\bDate:/i, CONF_HEURISTIC, undefined, false);
    approvalStatus = /Termination|terminated/i.test(text) && !/Ineligibility/i.test(text) ? "terminated" : "denied";
    b.reject("denial_or_termination", "This is a WIC notice of ineligibility or termination; ask for another document (a reviewer can override).");
  } else {
    const month = /Benefit Month:\s*([A-Z][a-z]+ \d{4})/i.exec(text);
    if (month) b.set("benefit_month", month[1], CONF_HEURISTIC, null);
    readLetterDate(ctx, b, /\b(Print Date|Date):/i, CONF_HEURISTIC);
    b.review("approval_unclear", "A WIC benefit list shows benefits for a month, not a certification statement.");
  }

  // Health data must never be stored, even by accident: refuse any field whose label mentions risk.
  for (const key of Object.keys(b.fields)) if (/risk/i.test(key)) delete b.fields[key];
  if (/Risk Codes?:/i.test(text)) b.warn("The document lists nutritional risk codes; they were not read or stored.");

  b.set("program", "WIC", CONF_HEURISTIC, null);
  b.set("approval_status", approvalStatus, CONF_HEURISTIC, null);
  b.review("review_required_by_policy", "Every WIC document is reviewed by a person in v1.");
  b.review("layout_unverified", "No Texas WIC layout has been verified; the fields are pre-filled for a reviewer.");
  return b.build(
    finishAward(b, {
      program: "WIC",
      lookAlikeProgram: null,
      approvalStatus,
      recipientName: participant,
      householdMembers: participant ? [participant] : [],
      benefitPeriod: period,
      caseNumberMasked: null,
      issuingAgency: agency?.value ?? null,
    }),
    null,
  );
}
