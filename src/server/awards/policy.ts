import type { MemberRole, VendorType } from "@/db/schema";

/**
 * Policy and compliance reminders for scholarship awards. The reminders restate docs/reference (each cites the fact
 * it rests on) as data for the SGO's award screen; they are reminders for the SGO's own judgment, not legal advice,
 * and proposed-rule content is labeled as proposed.
 */

export type AwardPaymentMethod = "direct_to_vendor" | "qualified_digital_wallet" | "other";
export const AWARD_PAYMENT_METHODS: readonly AwardPaymentMethod[] = ["direct_to_vendor", "qualified_digital_wallet", "other"];

/** POLICY: the least SGO role that may offer, decline or change an award (reviewers decide; viewers only look). */
export const AWARD_DECIDER_ROLE: MemberRole = "reviewer";

/** POLICY: largest single award accepted ($100,000). The sources set no amount; this only catches unit mistakes. */
export const MAX_AWARD_CENTS = 10_000_000;
/** POLICY: lengths of the SGO's internal notes and decline / revocation reasons (never shown to the business or family). */
export const MAX_AWARD_NOTES_LENGTH = 2000;
export const REASON_LENGTH = { min: 3, max: 1000 } as const;

/**
 * POLICY: an award on a completed booking cannot be revoked here. The business has already confirmed the booking as
 * completed with scholarship funds and the success fee is owed; unwinding that is an operator matter (contact the
 * business), not a button. The sources are silent on reversals.
 */
export const REVOKE_AFTER_COMPLETION_ALLOWED = false;

/**
 * Vendor types the reference notes as not addressed by the proposed rules (F77: summer camps, after-school
 * programs and microschools). Configurable because the final rules may settle them either way.
 */
export const UNSETTLED_VENDOR_TYPES: ReadonlySet<VendorType> = new Set(["summer_camp", "after_school", "microschool"]);

export interface ComplianceReminder {
  code: string;
  /** "caution" items should be read before deciding; "info" items explain what the platform does and does not do. */
  severity: "caution" | "info";
  text: string;
  /** Where the statement comes from in docs/reference. */
  source: string;
}

const ELIGIBLE_STUDENT: ComplianceReminder = {
  code: "eligible_student_qualified_expense",
  severity: "caution",
  text: "A scholarship may go only to an eligible student and only for qualified elementary or secondary education expenses (expenses described in section 530(b)(3)(A), each tied to a K-12 school). Under the proposed rules the household income test is verified with the methods in Prop. Reg. 1.25F-3(c)(6).",
  source: "docs/reference/sgo-verification-rules.md F6, F74, F76",
};

const INCOME_ONLY: ComplianceReminder = {
  code: "verification_covers_income_only",
  severity: "info",
  text: "This verification covers household income only. Whether the student is eligible to enroll in a public elementary or secondary school, and whether the student is a disqualified person, are for your organization to confirm.",
  source: "docs/reference/sgo-verification-rules.md F6, F69",
};

const NOT_A_PAYMENT: ComplianceReminder = {
  code: "award_is_not_a_payment",
  severity: "info",
  text: "Offering an award records your decision and tells the business the booking may be completed with scholarship funds. It does not move money: pay under your own procedures.",
  source: "Build spec, Piece 2 risks (an award is not automatic; do not promise the business will be paid)",
};

const NO_FAMILY_PAYMENT: ComplianceReminder = {
  code: "no_payment_to_family",
  severity: "caution",
  text: "Under the proposed rules no funds may be paid directly to the family unless the payment is a qualified reimbursement backed by a receipt.",
  source: "docs/reference/sgo-verification-rules.md F80; market-and-integration-context.md fact 76",
};

const VENDOR_DIRECT: ComplianceReminder = {
  code: "vendor_direct_payment_conditions",
  severity: "caution",
  text: "Under the proposed rules, paying a vendor directly requires that the vendor (A) has been verified as an appropriate provider, (B) is not related, directly or indirectly, to the scholarship recipient, and (C) is required to reimburse the SGO for any payments in excess of the student's costs or disbursed in error. Who verifies a provider, and how the reimbursement requirement is imposed, are not stated in the sources.",
  source: "docs/reference/sgo-verification-rules.md F80 (Prop. Reg. 1.25F-3(c)(5)(iv))",
};

const DIGITAL_WALLET: ComplianceReminder = {
  code: "qualified_digital_wallet_proposed",
  severity: "info",
  text: "A qualified digital wallet is defined only in the proposed rules, and the definition is open for comment.",
  source: "docs/reference/sgo-verification-rules.md F81; market-and-integration-context.md fact 31",
};

const UNSETTLED_VENDOR: ComplianceReminder = {
  code: "vendor_type_not_settled",
  severity: "caution",
  text: "Whether this kind of provider's fee is a qualified expense is not settled in the proposed rules: they do not address summer camps, after-school programs or microschools, and guidance on qualified expenses is still to come. Confirm with counsel before awarding for this booking.",
  source: "docs/reference/sgo-verification-rules.md F77, F79; market-and-integration-context.md fact 76",
};

const PRIVATE_BENEFIT: ComplianceReminder = {
  code: "business_fee_private_benefit",
  severity: "caution",
  text: "The business pays the platform a success fee when a booking is completed with scholarship funds (never from the scholarship). Whether such an arrangement raises a private-benefit question for the SGO is not addressed in the sources and needs counsel.",
  source: "docs/reference/sgo-verification-rules.md F97",
};

/**
 * The reminders to show when deciding an award. `vendorType` is the booking's vendor type when the award is for a
 * handoff (null for a standalone award); `paymentMethod` the method being chosen, if any.
 */
export function awardComplianceReminders(opts: { vendorType: VendorType | null; paymentMethod?: AwardPaymentMethod | null }): ComplianceReminder[] {
  const out: ComplianceReminder[] = [ELIGIBLE_STUDENT, INCOME_ONLY, NO_FAMILY_PAYMENT];
  if (opts.vendorType !== null) {
    if (UNSETTLED_VENDOR_TYPES.has(opts.vendorType)) out.push(UNSETTLED_VENDOR);
    out.push(PRIVATE_BENEFIT);
  }
  if (opts.paymentMethod === undefined || opts.paymentMethod === null || opts.paymentMethod === "direct_to_vendor") out.push(VENDOR_DIRECT);
  if (opts.paymentMethod === undefined || opts.paymentMethod === null || opts.paymentMethod === "qualified_digital_wallet") out.push(DIGITAL_WALLET);
  out.push(NOT_A_PAYMENT);
  return out;
}
