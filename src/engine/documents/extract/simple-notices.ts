/**
 * Notices whose outcome is fixed by what they are rather than by tables (reference B10, B15, B16, P3), and
 * look-alike letters for programs that are not on the list (school meals, unemployment).
 */
import { flat, fullText } from "../text";
import type { ApprovalStatus, DocumentSubtype, Extraction, LookAlikeProgram } from "../types";
import { finishAward, readLetterDate } from "./award-common";
import { CONF_HEURISTIC, CONF_VERIFIED, ExtractionBuilder, findAddressee, type ExtractContext } from "./common";

const HHSC = "Texas Health and Human Services Commission";

interface NoticeRule {
  approvalStatus: ApprovalStatus;
  lookAlike: LookAlikeProgram | null;
  agency: string | null;
  apply: (b: ExtractionBuilder, text: string) => void;
}

const RULES: Partial<Record<DocumentSubtype, NoticeRule>> = {
  tx_hhsc_h1009: {
    approvalStatus: "unclear",
    lookAlike: null,
    agency: HHSC,
    apply: (b, text) => {
      b.review("checkbox_form", "This is a manual eligibility notice; only the ticked boxes apply, and ticks cannot be read from text (B10).");
      const m = /per month in SNAP benefits from\s+(\d{2}\/\d{2}\/\d{4})\s+through\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
      if (m) b.signal(`SNAP period printed: ${m[1]} through ${m[2]}`);
    },
  },
  tx_hhsc_h1017: {
    approvalStatus: "denied",
    lookAlike: null,
    agency: HHSC,
    apply: (b, text) => {
      if (/will be lowered/i.test(text)) {
        b.review("approval_unclear", "The notice may only lower a benefit, which then continues; a person must check which box is ticked.");
      } else {
        b.reject("denial_or_termination", "This is a notice of benefit denial.");
      }
    },
  },
  tx_hhsc_h1020: {
    approvalStatus: "pending",
    lookAlike: null,
    agency: HHSC,
    apply: (b) => b.reject("not_a_decision", "This letter asks for more information while a case is pending; it is not an approval."),
  },
  tx_hhsc_h1718: {
    approvalStatus: "denied",
    lookAlike: null,
    agency: HHSC,
    apply: (b) => {
      b.reject("denial_or_termination", "This is a notice of benefit denial.");
      b.review("layout_unverified", "The H1718 layout is not in the sources; a person should confirm the classification.");
    },
  },
  tx_hhsc_renewal: {
    approvalStatus: "unclear",
    lookAlike: null,
    agency: HHSC,
    apply: (b) => b.review("not_a_decision", "A renewal form shows a case exists but is not a determination; ask for the TF0001."),
  },
  tx_hhsc_other: {
    approvalStatus: "unclear",
    lookAlike: null,
    agency: HHSC,
    apply: (b) => b.reject("not_a_decision", "This HHSC letter is not a notice of case action and carries no approval."),
  },
  benefit_card: {
    approvalStatus: "unclear",
    lookAlike: null,
    agency: null,
    apply: (b) => b.reject("not_a_decision", "A benefit card shows no approval and no benefit period; HHSC does not accept it as proof (B15)."),
  },
  school_meals_notice: {
    approvalStatus: "unclear",
    lookAlike: "SCHOOL_MEALS",
    agency: null,
    apply: (b) => b.reject("program_not_listed", "School meal eligibility is not a household-level program on the list."),
  },
};

export function extractSimpleNotice(ctx: ExtractContext, subtype: DocumentSubtype): Extraction {
  const rule = RULES[subtype];
  if (!rule) throw new RangeError(`No simple-notice rule for ${subtype}`);
  const b = new ExtractionBuilder(subtype, ctx.policy);
  const text = flat(fullText(ctx.doc));
  readLetterDate(ctx, b, /\bDate:|\bDATE:/, rule.lookAlike ? CONF_HEURISTIC : CONF_VERIFIED, undefined, false);
  const addressee = findAddressee(ctx.doc);
  if (addressee) b.set("recipient_name", addressee.name, 0.8, addressee.ref);
  rule.apply(b, text);
  if (rule.lookAlike) b.set("look_alike_program", rule.lookAlike, CONF_HEURISTIC, null);
  return b.build(
    finishAward(b, {
      program: null,
      lookAlikeProgram: rule.lookAlike,
      approvalStatus: rule.approvalStatus,
      recipientName: addressee?.name ?? null,
      householdMembers: [],
      benefitPeriod: null,
      caseNumberMasked: null,
      issuingAgency: rule.agency,
    }),
    null,
  );
}

/** Unemployment letters: other income, not an award. Pre-filled for a reviewer only (no source layout). */
export function extractUnemploymentNotice(ctx: ExtractContext): Extraction {
  const b = new ExtractionBuilder("unemployment_notice", ctx.policy);
XX, addressee.name, 0.8, addressee.ref);
  b.set("look_alike_program", "UNEMPLOYMENT", CONF_HEURISTIC, null);
  b.review("review_required_by_policy", "Unemployment letters are income evidence read by a person; no layout is verified.");
  return b.build(null, null);
}
