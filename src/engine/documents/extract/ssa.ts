/**
 * Social Security Administration documents (reference E1-E9, P6).
 *
 * SSI versus SSDI is decided by structure, never by the word "disability" (Engineering Implications item 7):
 *  - Benefit Verification Letter: the section "Information About Supplemental Security Income Payments".
 *  - SSA notices: the second heading line ("Supplemental Security Income" vs "Retirement, Survivors, and
 *    Disability Insurance"), read on page 1 only (E2 [FC]: worksheets mention "Social Security benefits").
 * A Notice of Award proves eligibility for at least one month, not a current payment (E2 [FC]): it needs an
 * ongoing monthly amount, and its layout is unverified, so it is reviewed unless `ssiNoticeOfAward` is on.
 */
import { parseMonthYear } from "../dates";
import { maskIdentifier } from "../redact";
import { flat, fullText, type LineRef } from "../text";
import { ssaHeading } from "../classify";
import type { ApprovalStatus, BenefitProgram, Extraction, IsoDate, LookAlikeProgram } from "../types";
import { finishAward, readLetterDate, recordNegativeWording } from "./award-common";
import { CONF_POSITIONAL, CONF_SECONDARY, ExtractionBuilder, findAddressee, refsMatching, type ExtractContext } from "./common";

const AGENCY = "Social Security Administration";

function firstRef(ctx: ExtractContext, re: RegExp): LineRef | null {
  return refsMatching(ctx.doc, re)[0] ?? null;
}

function monthStart(m: { year: number; month: number }): IsoDate {
  return `${m.year}-${String(m.month).padStart(2, "0")}-01`;
}

function centsOf(raw: string): number | null {
  const m = /^\$?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const cents = Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
  return Number.isSafeInteger(cents) ? cents : null;
}

/* ------------------------------------------------------------------- Benefit Verification Letter */

export function extractBenefitVerificationLetter(ctx: ExtractContext): Extraction {
  const b = new ExtractionBuilder("ssa_benefit_verification", ctx.policy);
  const text = flat(fullText(ctx.doc));
  readLetterDate(ctx, b, /\bDate:/i, CONF_SECONDARY);

  const addressee = findAddressee(ctx.doc, /You asked us/i);
  if (addressee) b.set("recipient_name", addressee.name, CONF_POSITIONAL, addressee.ref);
  b.require("recipient_name");

  const ssiRef = firstRef(ctx, /Information About Supplemental Security Income Payments/i);
  const t2Ref = firstRef(ctx, /Information About Current Social Security Benefits/i);
  const pastRef = firstRef(ctx, /Information About Past Social Security Benefits/i);
  const noBenefits = /You do not receive benefits now/i.test(text);
  b.set("has_ssi_section", ssiRef !== null, CONF_SECONDARY, ssiRef);
  b.set("has_title2_section", t2Ref !== null, CONF_SECONDARY, t2Ref);
  b.set("no_benefits", noBenefits, CONF_SECONDARY, firstRef(ctx, /You do not receive benefits now/i));

  const ssiAmount = /Beginning ([A-Z][a-z]+\.? \d{4}), the current Supplemental Security Income payment is \$([\d,]+\.\d{2})/i.exec(text);
  const ssiAmountRef = firstRef(ctx, /current Supplemental Security Income/i);
  let effective: IsoDate | null = null;
  if (ssiAmount) {
    const cents = centsOf(ssiAmount[2]);
    const month = parseMonthYear(ssiAmount[1]);
    if (cents !== null) b.set("ssi_monthly_amount_cents", cents, CONF_SECONDARY, ssiAmountRef);
    if (month) {
      effective = monthStart(month);
      b.set("ssi_effective_month", effective.slice(0, 7), CONF_SECONDARY, ssiAmountRef);
    }
  }
  const ssiType = /You are entitled to monthly payments as (an? [a-z ]+?)\./i.exec(text);
  if (ssiType) b.set("ssi_payment_type", ssiType[1], CONF_SECONDARY, firstRef(ctx, /entitled to monthly payments as/i));
  const t2Type = /You are entitled to monthly (\w+) benefits\./i.exec(text);
  if (t2Type) b.set("title2_benefit_type", t2Type[1].toLowerCase(), CONF_SECONDARY, firstRef(ctx, /You are entitled to monthly \w+ benefits/i));

  let program: BenefitProgram | null = null;
  let lookAlike: LookAlikeProgram | null = null;
  let approvalStatus: ApprovalStatus = "unclear";
  if (noBenefits) {
    approvalStatus = "denied";
    b.reject("denial_or_termination", "The letter says the person does not receive benefits.");
  } else if (ssiRef) {
    program = "SSI";
    const cents = b.value<number>("ssi_monthly_amount_cents");
    if (cents !== null && cents > 0) {
      approvalStatus = "approved";
    } else {
      b.review("no_ongoing_payment", "The SSI section shows no current payment amount; a person must confirm current SSI.");
    }
    if (t2Ref) b.signal("letter also lists Social Security (title II) benefits; SSI section decides");
  } else if (t2Ref) {
    lookAlike = /disability/i.test(t2Type?.[1] ?? "") ? "SSDI" : "SOCIAL_SECURITY_RETIREMENT_SURVIVORS";
    approvalStatus = "approved";
    b.reject("ssa_not_ssi", "The letter lists Social Security benefits only, not Supplemental Security Income.");
  } else if (pastRef) {
    b.review("approval_unclear", "The letter shows only past benefits; a person must confirm whether any benefit continues.");
  } else {
    b.review("approval_unclear", "The letter has no section about current SSI or Social Security payments.");
  }
  b.set("program", program ?? lookAlike, CONF_SECONDARY, ssiRef ?? t2Ref);
  b.set("approval_status", approvalStatus, CONF_SECONDARY, ssiAmountRef ?? ssiRef ?? t2Ref);

  return b.build(
    finishAward(b, {
      program,
      lookAlikeProgram: lookAlike,
      approvalStatus,
      recipientName: addressee?.name ?? null,
      householdMembers: addressee ? [addressee.name] : [],
      benefitPeriod: effective ? { start: effective, end: null } : null,
      caseNumberMasked: null,
      issuingAgency: AGENCY,
    }),
    null,
  );
}

/* ------------------------------------------------------------------------------- SSA notices */

const SSI_NEGATIVE = [
  /not eligible to receive Supplemental Security Income/i,
  /cannot get Supplemental Security Income/i,
  /no payments can be made at this time/i,
  /Why We Can't Pay/i,
  /Why .{0,40}Payments Are Stopping/i,
  /We will stop .{0,40}payment/i,
  /Notice of Disapproved Claim/i,
  /Type of Claim/i,
];

const SUBJECT_REVIEW = /^(Notice of Planned Action|Important Information|Notice of Overpayment|Notice of Reconsideration|Notice of Revised Determination)$/i;
const SUBJECT_NEGATIVE = /^(Notice of Disapproved Claim|Notice of Disability Cessation)$/i;

export function extractSsaNotice(ctx: ExtractContext, subtype: "ssa_ssi_notice" | "ssa_title2_notice" | "ssa_other"): Extraction {
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const text = flat(fullText(ctx.doc));
  const heading = ssaHeading(ctx.doc);
  const headingRef = firstRef(ctx, /^Social Security Administration$/i);
  readLetterDate(ctx, b, /\bDate:/i, CONF_SECONDARY);
  const addressee = findAddressee(ctx.doc);
  if (addressee) b.set("recipient_name", addressee.name, CONF_POSITIONAL, addressee.ref);
  b.require("recipient_name");

  const claim = /Claim Number:\s*([0-9X*]{3}[- ]?[0-9X*]{2}[- ]?(\d{4}))\s*([A-Z]{1,2})?\b/i.exec(text);
  let caseNumberMasked: string | null = null;
  if (claim) {
    // The claim number is a Social Security number (E3): keep the last four digits only.
    caseNumberMasked = maskIdentifier(`00000${claim[2]}`);
    b.set("claim_number_last4", claim[2], CONF_SECONDARY, firstRef(ctx, /Claim Number:/i));
  }
  const form = /SSA-L(\d{4})/i.exec(text);
  if (form) b.set("form_number", `SSA-L${form[1]}`, CONF_SECONDARY, firstRef(ctx, /SSA-L\d{4}/i));
  if (heading?.program) b.set("heading_program", heading.program, CONF_SECONDARY, headingRef);
  if (heading?.subject) b.set("heading_subject", heading.subject, CONF_SECONDARY, headingRef);

  const typeOfPayment = /\bType of Payment\b/i.test(text);
  const typeOfClaim = /\bType of Claim\b/i.test(text);
  const negative = recordNegativeWording(b, text, SSI_NEGATIVE);

  let program: BenefitProgram | null = null;
  let lookAlike: LookAlikeProgram | null = null;
  let approvalStatus: ApprovalStatus = "unclear";
  let period: { start: IsoDate | null; end: IsoDate | null } | null = null;

  if (subtype === "ssa_title2_notice") {
    const p = heading?.program ?? "";
    lookAlike = /Extra Help/i.test(p)
      ? "MEDICARE_EXTRA_HELP"
      : /Special Veterans/i.test(p)
        ? "SPECIAL_VETERANS_BENEFITS"
        : /disability/i.test(text)
          ? "SSDI"
          : "SOCIAL_SECURITY_RETIREMENT_SURVIVORS";
    approvalStatus = /Notice of Award/i.test(heading?.subject ?? "") ? "approved" : "unclear";
    b.reject("ssa_not_ssi", `The notice is about ${p || "a Social Security program"}, not Supplemental Security Income.`);
  } else if (subtype === "ssa_other") {
    b.review("approval_unclear", "The SSA notice has no program heading (it may cross programs); a person must read it.");
  } else {
    program = "SSI";
    const subject = heading?.subject ?? "";
    const monthly = /regular monthly check of \$([\d,]+\.\d{2})/i.exec(text);
    const monthlyCents = monthly ? centsOf(monthly[1]) : null;
    const table = /(?:Your Payments|The Payments of .+?) Will Be (?:Changed )?As Follows:?\s+From\s+Through\s+Amount Due Each Month\s+([A-Z][a-z]+\.? \d{1,2},? \d{4})\s+(Continuing|[A-Z][a-z]+\.? \d{4})\s+\$([\d,]+\.\d{2})/i.exec(text);
    const tableCents = table ? centsOf(table[3]) : null;
    const amount = tableCents ?? monthlyCents;
    if (amount !== null) b.set("ssi_monthly_amount_cents", amount, CONF_SECONDARY, firstRef(ctx, /regular monthly check|Amount Due Each Month/i));
    if (table) {
      b.set("payment_through", table[2], CONF_SECONDARY, firstRef(ctx, /Continuing|Through/i));
      const through = parseMonthYear(table[2]);
      period = { start: null, end: through ? monthStart(through) : null };
    }

    if (SUBJECT_NEGATIVE.test(subject) || (typeOfClaim && !typeOfPayment)) {
      approvalStatus = /Cessation/i.test(subject) ? "terminated" : "denied";
      b.reject("denial_or_termination", "The SSI notice is a denial or cessation.");
    } else if (/^Notice of Award$/i.test(subject)) {
      const eligible = /eligible to receive Supplemental Security Income payments/i.test(text) && !/not eligible/i.test(text);
      const noPayment = /no payments can be made at this time/i.test(text);
      if (noPayment || amount === null || amount === 0) {
        b.review("no_ongoing_payment", "The award notice shows no ongoing monthly payment; SSA also sends it for back pay only.");
      } else if (eligible && typeOfPayment) {
        approvalStatus = "approved";
        if (!ctx.policy.autoAcceptUnverifiedLayouts.ssiNoticeOfAward) {
          b.review("layout_unverified", "The SSI Notice of Award layout has not been confirmed on a real 2026 notice; a person must confirm.");
        }
      } else {
        b.review("approval_unclear", "The award notice does not carry the standard eligibility sentence.");
      }
    } else if (/^Notice of Change in Payment$/i.test(subject)) {
      if (table && amount !== null && amount > 0 && typeOfPayment && !negative.some((n) => /stop|can't pay/i.test(n))) approvalStatus = "approved";
      else b.review("approval_unclear", "The change notice does not show a continuing payment amount.");
    } else if (SUBJECT_REVIEW.test(subject)) {
      b.review("approval_unclear", `"${subject}" notices are read by a person.`);
    } else {
      b.review("approval_unclear", `The SSI notice subject "${subject || "(none)"}" is not one the reader recognises.`);
    }
  }
  b.set("program", program ?? lookAlike, CONF_SECONDARY, headingRef);
  b.set("approval_status", approvalStatus, CONF_SECONDARY, headingRef);
  b.require("program");
  return b.build(
    finishAward(b, {
      program,
      lookAlikeProgram: lookAlike,
      approvalStatus,
      recipientName: addressee?.name ?? null,
      householdMembers: addressee ? [addressee.name] : [],
      benefitPeriod: period,
      caseNumberMasked,
      issuingAgency: AGENCY,
    }),
    null,
  );
}
