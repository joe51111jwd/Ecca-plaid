/**
 * Section 8 (Housing Choice Voucher) documents (reference D1-D9, P5).
 *
 * There is no Section 8 "award letter" (D1). Every Section 8 document is reviewed in v1; the extractor
 * pre-fills the reviewer's screen and marks the outcomes the sources make clear:
 *  - HUD-52646 voucher: eligibility, not proof of participation (D2, D9) → `section8_not_yet_participating`.
 *  - HUD-50058: program `P` is public housing (not Section 8); action codes 6 and 11 are exits; 10 is a
 *    voucher issuance; 1, 2, 3, 4 and 7 are evidence of assistance; every other code goes to review (D6 [FC]).
 *  - PHA rent notice: no layout is verified (D5); labels are heuristics.
 */
import { flat, fullText, valueAfterLabel, type DocumentText } from "../text";
import { maskIdentifier } from "../redact";
import { findMoneyTokens } from "../money";
import type { ApprovalStatus, Extraction, LookAlikeProgram } from "../types";
import { finishAward, readLetterDate, recordNegativeWording } from "./award-common";
import { CONF_HEURISTIC, CONF_VERIFIED, ExtractionBuilder, isPlausibleName, readLabeledDate, refsMatching, type ExtractContext } from "./common";

const NEGATIVE = [
  /End Participation/i,
  /Expiration of Voucher/i,
  /voucher (has )?expired/i,
  /termination of (assistance|HAP|participation)/i,
  /HAP contract terminates/i,
  /waiting list/i,
  /\bnot eligible\b/i,
  /\bdenied\b/i,
  /\bwithdrawn\b/i,
];

function name(ctx: ExtractContext, b: ExtractionBuilder, label: RegExp, key: string, confidence: number): string | null {
  const v = valueAfterLabel(ctx.doc, label, /^[A-Za-zÀ-ÿ' .,-]+$/);
  if (!v || !isPlausibleName(v.value)) return null;
  b.set(key, v.value, confidence, v.ref);
  return v.value;
}

function date(ctx: ExtractContext, b: ExtractionBuilder, label: RegExp, key: string, confidence: number): string | null {
  const d = readLabeledDate(ctx.doc, label);
  if (!d) return null;
  if (d.ambiguous) {
    b.review("date_ambiguous", `The ${key.replace(/_/g, " ")} "${d.raw}" can be read more than one way.`);
    return null;
  }
  if (d.date) b.set(key, d.date, confidence, d.ref);
  return d.date;
}

function amount(doc: DocumentText, b: ExtractionBuilder, label: RegExp, key: string, confidence: number): number | null {
  for (const ref of refsMatching(doc, label)) {
    const m = label.exec(ref.line.text)!;
    const token = findMoneyTokens(ref.line.text.slice((m.index ?? 0) + m[0].length))[0];
    if (token) {
      b.set(key, token.cents, confidence, ref);
      return token.cents;
    }
  }
  return null;
}

export function extractSection8(ctx: ExtractContext, subtype: "hcv_voucher" | "hud_hap_contract" | "hud_50058" | "pha_notice"): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const text = flat(fullText(ctx.doc));
  const negative = recordNegativeWording(b, text, NEGATIVE);
  let approvalStatus: ApprovalStatus = "unclear";
  let lookAlike: LookAlikeProgram | null = null;
  let recipient: string | null = null;
  let agency: string | null = null;
  let caseNumberMasked: string | null = null;
  let period: { start: string | null; end: string | null } | null = null;

  if (subtype === "hcv_voucher") {
    const voucher = valueAfterLabel(ctx.doc, /1\.\s*Voucher Number/i, /^[A-Za-z0-9-]{1,30}$/);
    if (voucher) {
      caseNumberMasked = maskIdentifier(voucher.value);
      b.set("voucher_number_masked", caseNumberMasked, CONF_VERIFIED, voucher.ref);
    }
    const issued = date(ctx, b, /2\.\s*Issue Date/i, "issue_date", CONF_VERIFIED);
    const expires = date(ctx, b, /3\.\s*Expiration Date/i, "expiration_date", CONF_VERIFIED);
    const extended = date(ctx, b, /4\.\s*Date Extension Expires/i, "extension_expires", CONF_VERIFIED);
    recipient = name(ctx, b, /5\.\s*Name of Family Representative/i, "family_representative", CONF_VERIFIED);
    const pha = valueAfterLabel(ctx.doc, /7\.\s*Name of Public Housing Agency(?: \(PHA\))?/i, /^.{3,120}$/);
    if (pha) {
      agency = pha.value;
      b.set("pha_name", pha.value, CONF_VERIFIED, pha.ref);
    }
    if (issued) b.alias("letter_date", "issue_date");
    else b.review("date_missing", "The voucher issue date could not be read.");
    b.require("letter_date");
    period = { start: issued, end: extended ?? expires };
    b.review(
      "section8_not_yet_participating",
      "A voucher shows eligibility, not that the family has leased a unit (it is also issued to participants who move); ask for the HAP contract or a rent notice.",
    );
  } else if (subtype === "hud_hap_contract") {
    recipient = name(ctx, b, /2\.\s*Tenant/i, "tenant", CONF_VERIFIED);
    const begins = /The initial lease term begins on\s*(?::\s*)?([0-9/]+|[A-Z][a-z]+ \d{1,2}, \d{4})/i.exec(text);
    if (begins) b.set("lease_begin_raw", begins[1], CONF_VERIFIED, refsMatching(ctx.doc, /initial lease term begins/i)[0] ?? null);
    amount(ctx.doc, b, /housing assistance payment by the PHA to the owner is/i, "hap_amount_cents", CONF_VERIFIED);
    readLetterDate(ctx, b, /\bDate:/i, CONF_HEURISTIC);
    approvalStatus = negative.length === 0 ? "approved" : "unclear";
    b.warn("HAP contracts are often old; the lease date and a later rent notice matter more than the contract date.");
  } else if (subtype === "hud_50058") {
    const agencyName = valueAfterLabel(ctx.doc, /1a\.\s*Agency name/i, /^.{3,120}$/);
    if (agencyName) {
      agency = agencyName.value;
      b.set("pha_name", agencyName.value, CONF_VERIFIED, agencyName.ref);
    }
    const programCode = valueAfterLabel(ctx.doc, /1c\.\s*Program/i, /^[A-Z]{1,2}$/);
    const action = valueAfterLabel(ctx.doc, /2a\.\s*Type of action/i, /^\d{1,2}$/);
    if (programCode) b.set("program_code", programCode.value, CONF_VERIFIED, programCode.ref);
    if (action) b.set("action_code", Number(action.value), CONF_VERIFIED, action.ref);
    const effective = date(ctx, b, /2b\.\s*Effective date(?: \(mm\/dd\/yyyy\))?(?: of action)?/i, "effective_date", CONF_VERIFIED);
    date(ctx, b, /2i\.\s*Projected effective date(?: \(mm\/dd\/yyyy\))?(?: of next reexamination)?/i, "next_reexam_date", CONF_VERIFIED);
    recipient = name(ctx, b, /Head of household:?/i, "head_of_household", CONF_HEURISTIC);
    amount(ctx.doc, b, /12u\.\s*HAP to owner/i, "hap_to_owner_cents", CONF_VERIFIED);
    amount(ctx.doc, b, /12v\.\s*Tenant rent to owner/i, "tenant_rent_cents", CONF_VERIFIED);
    if (effective) b.alias("letter_date", "effective_date");
    else b.review("date_missing", "The effective date of the action could not be read.");
    b.require("letter_date", "program_code", "action_code");
    const code = action ? Number(action.value) : null;
    if (programCode?.value === "P") {
      lookAlike = "PUBLIC_HOUSING";
      approvalStatus = code === 6 || code === 11 ? "terminated" : "approved";
      b.reject("public_housing_not_section8", "Program code P is public housing, not Section 8.");
    } else if (programCode && !["VO", "CE", "MR"].includes(programCode.value)) {
      b.review("program_needs_review", `Program code ${programCode.value} is not a Section 8 voucher code the reader knows.`);
    } else if (code === 6 || code === 11) {
      approvalStatus = "terminated";
      b.reject("denial_or_termination", "The action code records the end of participation.");
    } else if (code === 10) {
      b.review("section8_not_yet_participating", "Action code 10 records a voucher issuance, not participation.");
    } else if (code !== null && [1, 2, 3, 4, 7].includes(code)) {
      approvalStatus = "approved";
    } else {
      b.review("approval_unclear", "The action code does not by itself show current assistance.");
    }
  } else {
    const first = refsMatching(ctx.doc, /Housing Authority/i)[0];
    if (first) {
      agency = first.line.items.find((it) => /Housing Authority/i.test(it.text))?.text ?? first.line.text;
      b.set("pha_name", agency, CONF_HEURISTIC, first);
    }
    readLetterDate(ctx, b, /\bDate:/i, CONF_HEURISTIC);
    recipient = name(ctx, b, /Head of Household:/i, "head_of_household", CONF_HEURISTIC);
    date(ctx, b, /Effective Date:/i, "effective_date", CONF_HEURISTIC);
    date(ctx, b, /Next Reexamination:/i, "next_reexam_date", CONF_HEURISTIC);
    const reexam = valueAfterLabel(ctx.doc, /Reexamination Type:/i, /^[A-Za-z ]{3,30}$/, { below: false });
    if (reexam) b.set("reexamination_type", reexam.value, CONF_HEURISTIC, reexam.ref);
    amount(ctx.doc, b, /Contract Rent:/i, "contract_rent_cents", CONF_HEURISTIC);
    const hap = amount(ctx.doc, b, /HAP to Owner:|Housing Assistance Payment:/i, "hap_to_owner_cents", CONF_HEURISTIC);
    const rent = amount(ctx.doc, b, /Tenant Rent:|Tenant Portion:|Rent Portion:|Family Share:/i, "tenant_rent_cents", CONF_HEURISTIC);
    if (/Public Housing/i.test(text) && !/Section 8|Voucher|\bHAP\b/i.test(text)) {
      lookAlike = "PUBLIC_HOUSING";
      b.reject("public_housing_not_section8", "The letter is about public housing, not Section 8.");
    } else if (negative.length > 0) {
      approvalStatus = /waiting list/i.test(text) ? "pending" : "terminated";
      b.review("approval_unclear", "The letter contains wording about waiting lists, denial or ending assistance.");
    } else if (hap !== null && hap > 0 && rent !== null) {
      approvalStatus = "approved";
    } else {
      b.review("approval_unclear", "The letter does not show a housing assistance payment.");
    }
    b.review("layout_unverified", "No Texas PHA letter layout has been verified; the fields are pre-filled for a reviewer.");
  }

  const recipientKey = ["family_representative", "tenant", "head_of_household"].find((k) => b.fields[k]);
  if (recipientKey) b.alias("recipient_name", recipientKey);
  b.set("program", lookAlike ?? "SECTION_8", CONF_HEURISTIC, null);
  b.set("approval_status", approvalStatus, CONF_HEURISTIC, null);
  b.review("review_required_by_policy", "Every Section 8 document is reviewed by a person in v1.");
  return b.build(
    finishAward(b, {
      program: lookAlike ? null : "SECTION_8",
      lookAlikeProgram: lookAlike,
      approvalStatus,
      recipientName: recipient,
      householdMembers: recipient ? [recipient] : [],
      benefitPeriod: period,
      caseNumberMasked,
      issuingAgency: agency,
    }),
    null,
  );
}
