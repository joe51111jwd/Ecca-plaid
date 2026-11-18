import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt, type Mode } from "./_shared";
import { objects, organizations, users } from "./core";

/** An individual taxpayer who gives. One row per person (each spouse is a separate donor with their own acknowledgment). */
export const donors = pgTable(
  "donors",
  {
    id: pk(),
    userId: text("user_id").references(() => users.id),
    /** Stored lower-cased. Not unique: spouses may share one address. */
    email: text("email").notNull(),
    /** The name exactly as on the donor's federal income tax return (the IRS report is matched on it). */
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    suffix: text("suffix"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    /** The other spouse's donor row from the most recent joint gift (spouses are combined for the substantial-contributor test). */
    spouseDonorId: text("spouse_donor_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("donors_email_idx").on(t.email), index("donors_user_idx").on(t.userId)],
);

export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household" | "qualifying_surviving_spouse";
export type CheckoutStatus = "open" | "awaiting_payment" | "completed" | "expired" | "canceled";

/** One pass through the donor checkout. Produces one donation per contributing taxpayer (two for a joint-return split). */
export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id), // the SGO
    mode: text("mode").$type<Mode>().notNull().default("test"),
    status: text("status").$type<CheckoutStatus>().notNull().default("open"),
    email: text("email"),
    filingStatus: text("filing_status").$type<FilingStatus>(),
    /** Everything entered so far (src/server/donations types); lets the donor resume. */
    form: jsonb("form").$type<Record<string, unknown>>().notNull().default({}),
    /** Snapshot of the tax-math preview the donor saw, with the taxmath module version. */
    preview: jsonb("preview").$type<Record<string, unknown>>(),
    source: text("source").$type<"hosted" | "widget">().notNull().default("hosted"),
    tokenHash: text("token_hash").notNull(),
    /** The signed-in person who started the checkout, when there was one. */
    userId: text("user_id").references(() => users.id),
    /**
     * Incremented each time a different order is placed from this checkout; part of the payment's idempotency key,
     * so re-placing the same order returns the same payment and a changed order gets a new one.
     */
    orderNumber: integer("order_number").notNull().default(0),
    /** SHA-256 of the placed order's amounts, people and words (src/server/donations/checkout.ts). */
    orderFingerprint: text("order_fingerprint"),
    /** The payment of the current order. */
    paymentId: text("payment_id"),
    placedAt: ts("placed_at"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [uniqueIndex("checkout_sessions_token_uq").on(t.tokenHash), index("checkout_sessions_org_idx").on(t.orgId, t.createdAt)],
);

export type PaymentStatus = "requires_payment" | "processing" | "succeeded" | "failed" | "canceled" | "refunded";

/** A charge with the payment processor. `sandbox` payments never move money. */
export const payments = pgTable(
  "payments",
  {
    id: pk(),
    processor: text("processor").$type<"sandbox" | "stripe">().notNull(),
    processorPaymentId: text("processor_payment_id"),
    purpose: text("purpose").$type<"donation" | "business_invoice">().notNull(),
    checkoutSessionId: text("checkout_session_id").references(() => checkoutSessions.id),
    orgId: text("org_id").references(() => organizations.id),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status").$type<PaymentStatus>().notNull().default("requires_payment"),
    method: text("method"), // card | us_bank_account | ...
    failureReason: text("failure_reason"),
    /** When the charge was made — this instant decides the gift's tax year. */
    paidAt: ts("paid_at"),
    refundedAt: ts("refunded_at"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_processor_idx").on(t.processor, t.processorPaymentId), index("payments_checkout_idx").on(t.checkoutSessionId)],
);

/**
 * How the platform is paid on a gift. Not chosen in the spec — counsel decides.
 *  - "none": no platform fee is taken on this gift (the default until a counsel memo is recorded).
 *  - "sgo_invoiced": the full designated amount goes to the SGO's 25F account; the SGO is invoiced separately from operating funds.
 *  - "donor_service_fee": the donor pays a clearly separate, non-designated service fee on top.
 */
export type FeeStructure = "none" | "sgo_invoiced" | "donor_service_fee";

/** One taxpayer's designated section 25F qualified contribution. */
export const donations = pgTable(
  "donations",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id), // the SGO
    mode: text("mode").$type<Mode>().notNull().default("test"),
    checkoutSessionId: text("checkout_session_id").notNull().references(() => checkoutSessions.id),
    paymentId: text("payment_id").references(() => payments.id),
    donorId: text("donor_id").notNull().references(() => donors.id),
    /** Which taxpayer on the return this contribution belongs to. */
    taxpayerRole: text("taxpayer_role").$type<"individual" | "spouse_1" | "spouse_2">().notNull().default("individual"),
    filingStatus: text("filing_status").notNull(),
    /** Which order of the checkout this donation belongs to (checkout_sessions.order_number). */
    orderNumber: integer("order_number").notNull().default(1),
    /** The amount designated as a section 25F qualified contribution (excludes any separate service fee). */
    designatedAmountCents: bigint("designated_amount_cents", { mode: "number" }).notNull(),
    /** Part of this taxpayer's gift that was NOT designated: an ordinary gift, never in the 25F account or the acknowledgment total. */
    nonDesignatedAmountCents: bigint("non_designated_amount_cents", { mode: "number" }).notNull().default(0),
    /** The donor's explicit designation at the time of payment, and the exact words shown. */
    designated25f: boolean("designated_25f").notNull(),
    designatedAt: ts("designated_at").notNull(),
    designationCopyVersion: text("designation_copy_version").notNull(),
    /** Copy id of the designation statement (individual or joint form) and the exact words shown, with their hashes. */
    designationCopyId: text("designation_copy_id").notNull(),
    designationText: text("designation_text").notNull(),
    designationTemplateSha256: text("designation_template_sha256").notNull(),
    designationTextSha256: text("designation_text_sha256").notNull(),
    /** Donor confirmed the gift is not earmarked for a particular student. */
    noEarmarkConfirmed: boolean("no_earmark_confirmed").notNull(),
    /** Donor confirmed they are giving as an individual (not through a partnership or S corporation). */
    individualConfirmed: boolean("individual_confirmed").notNull(),
    usCitizenOrResidentConfirmed: boolean("us_citizen_or_resident_confirmed").notNull().default(false),
    notInExchangeConfirmed: boolean("not_in_exchange_confirmed").notNull().default(false),
    /** Joint gift: the payment is on behalf of both spouses. */
    jointOnBehalfOfBothConfirmed: boolean("joint_on_behalf_of_both_confirmed").notNull().default(false),
    /** Every attestation shown, with the copy version and hashes of the exact words. */
    attestations: jsonb("attestations").$type<DonationAttestationRecord[]>().notNull().default([]),
    /** The covered State whose list (and 25F account) the gift is directed to. Single-State SGO: its State. */
    stateAllocation: text("state_allocation").notNull(),
    /** IANA time zone used to assign the tax year. */
    donorTimeZone: text("donor_time_zone").notNull(),
    expectedStateCreditCents: bigint("expected_state_credit_cents", { mode: "number" }).notNull().default(0),
    feeStructure: text("fee_structure").$type<"none" | "sgo_invoiced" | "donor_service_fee">().notNull().default("none"),
    /** Platform fee owed by the SGO (sgo_invoiced) — never deducted from the designated amount. */
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull().default(0),
    /** Separate, non-designated fee paid by the donor on top (donor_service_fee). */
    donorServiceFeeCents: bigint("donor_service_fee_cents", { mode: "number" }).notNull().default(0),
    goodsOrServicesProvided: boolean("goods_or_services_provided").notNull().default(false),
    goodsOrServicesValueCents: bigint("goods_or_services_value_cents", { mode: "number" }).notNull().default(0),
    /** Description of any goods or services provided (acknowledgment element (E)); required whenever goodsOrServicesProvided. */
    goodsOrServicesDescription: text("goods_or_services_description"),
    status: text("status").$type<"pending" | "succeeded" | "failed" | "canceled" | "refunded">().notNull().default("pending"),
    /** Charge time (copied from the payment); decides taxYear. */
    contributedAt: ts("contributed_at"),
    taxYear: integer("tax_year"),
    /** The UTC and donor-local calendar years of the charge differ: needs a human look at year end. */
    yearBoundaryAmbiguous: boolean("year_boundary_ambiguous").notNull().default(false),
    /** False for gifts before the credit start date or to an SGO not on a valid list, with the reason shown to the donor. */
    creditEligible: boolean("credit_eligible").notNull().default(false),
    creditIneligibleReason: text("credit_ineligible_reason"),
    /** List status of the SGO at the moment of the gift (the donor may rely on it). */
    sgoListStatusAtGift: text("sgo_list_status_at_gift"),
    sgoListEntryIdAtGift: text("sgo_list_entry_id_at_gift"),
    /** The donor's reliance evidence: the SGO-list snapshot when the order was placed and again when the charge was made. */
    relianceAtOrder: jsonb("reliance_at_order").$type<Record<string, unknown>>(),
    relianceAtCharge: jsonb("reliance_at_charge").$type<Record<string, unknown>>(),
    /** taxmath.assessCreditEligibility results when the order was placed and as of the charge. */
    eligibilityAtOrder: jsonb("eligibility_at_order").$type<Record<string, unknown>>(),
    eligibilityAtCharge: jsonb("eligibility_at_charge").$type<Record<string, unknown>>(),
    eDeliveryConsentId: text("e_delivery_consent_id"),
    receiptEmailId: text("receipt_email_id"),
    failureReason: text("failure_reason"),
    refundedAt: ts("refunded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("donations_org_idx").on(t.orgId, t.mode, t.taxYear),
    index("donations_org_created_idx").on(t.orgId, t.mode, t.createdAt),
    index("donations_donor_idx").on(t.donorId),
    index("donations_checkout_idx").on(t.checkoutSessionId),
    index("donations_payment_idx").on(t.paymentId),
    // One donation per taxpayer per order: a second concurrent order attempt can never add a second charge's rows.
    uniqueIndex("donations_order_role_uq").on(t.checkoutSessionId, t.orderNumber, t.taxpayerRole),
  ],
);

/** One attestation the donor confirmed, as stored on the donation. */
export interface DonationAttestationRecord {
  /** Copy id in src/taxmath/copy.ts. */
  copyId: string;
  copyVersion: string;
  templateSha256: string;
  textSha256: string;
  text: string;
  confirmed: boolean;
}

/**
 * A donor's consent to receive the official written acknowledgment electronically (Temp. Treas. Reg.
 * 1.25F-4T(c)(1)): per donor, per SGO, with the exact words shown. Withdrawal before the acknowledgment is sent
 * switches delivery to paper. Rows are immutable except the withdrawal fields.
 */
export const donorDeliveryConsents = pgTable(
  "donor_delivery_consents",
  {
    id: pk(),
    donorId: text("donor_id").notNull().references(() => donors.id),
    orgId: text("org_id").notNull().references(() => organizations.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    checkoutSessionId: text("checkout_session_id").references(() => checkoutSessions.id),
    /** The address the donor agreed to receive the acknowledgment at. */
    email: text("email").notNull(),
    copyId: text("copy_id").notNull(),
    copyVersion: text("copy_version").notNull(),
    templateSha256: text("template_sha256").notNull(),
    textSha256: text("text_sha256").notNull(),
    text: text("text").notNull(),
    grantedAt: ts("granted_at").notNull(),
    withdrawnAt: ts("withdrawn_at"),
    withdrawnByUserId: text("withdrawn_by_user_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("donor_delivery_consents_donor_idx").on(t.donorId, t.orgId)],
);

/**
 * One donor's received money for one SGO and calendar year, recomputed from the donations ledger after every
 * change (so it only ever reflects money actually received), with the substantial-contributor advisory for SGO staff.
 */
export const donorYearTotals = pgTable(
  "donor_year_totals",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    donorId: text("donor_id").notNull().references(() => donors.id),
    taxYear: integer("tax_year").notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    designatedCents: bigint("designated_cents", { mode: "number" }).notNull().default(0),
    nonDesignatedCents: bigint("non_designated_cents", { mode: "number" }).notNull().default(0),
    giftCount: integer("gift_count").notNull().default(0),
    lastContributedAt: ts("last_contributed_at"),
    /** Donor plus spouse, all contributions (designated or not), as the proposed test counts them. */
    combinedWithSpouseCents: bigint("combined_with_spouse_cents", { mode: "number" }).notNull().default(0),
    /** taxmath.assessSubstantialContributor summary (status, advisories); for SGO staff only. */
    substantialContributor: jsonb("substantial_contributor").$type<Record<string, unknown>>(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.donorId, t.taxYear, t.mode] }), index("donor_year_totals_org_idx").on(t.orgId, t.mode, t.taxYear)],
);

/**
 * Donor/SGO/year combinations whose official acknowledgment must be generated or regenerated (a new gift, a
 * refund, a correction). Written by the donations service; resolved by the acknowledgment generator.
 */
export const acknowledgmentRefreshes = pgTable(
  "acknowledgment_refreshes",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    donorId: text("donor_id").notNull().references(() => donors.id),
    taxYear: integer("tax_year").notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    reason: text("reason").$type<"gift_succeeded" | "gift_refunded" | "correction">().notNull(),
    lastDonationId: text("last_donation_id"),
    requestedAt: ts("requested_at").notNull(),
    /** Set by the generator once a version reflecting `requestedAt` exists; cleared by the next request. */
    resolvedAt: ts("resolved_at"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.donorId, t.taxYear, t.mode] }), index("acknowledgment_refreshes_pending_idx").on(t.mode, t.resolvedAt)],
);

/**
 * Unique donor number: issued through the IRS SGO portal by a registered SGO. We never invent real ones.
 * `sandbox_generated` numbers exist only in test mode and are labeled as not valid for filing.
 */
export const donorNumbers = pgTable(
  "donor_numbers",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    donorId: text("donor_id").notNull().references(() => donors.id),
    taxYear: integer("tax_year").notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    number: text("number").notNull(),
    source: text("source").$type<"irs_portal_entered" | "irs_portal_import" | "sandbox_generated">().notNull(),
    assignedBy: text("assigned_by"),
    assignedAt: ts("assigned_at").notNull().defaultNow(),
    /** Set when SGO staff replaced an earlier number for the same donor and year (the audit log keeps the history). */
    replacedAt: ts("replaced_at"),
  },
  (t) => [
    uniqueIndex("donor_numbers_uq").on(t.orgId, t.donorId, t.taxYear, t.mode),
    // A number identifies one donor within an SGO and year (acknowledgment-reporting.md E2 item 3-4).
    uniqueIndex("donor_numbers_number_uq").on(t.orgId, t.taxYear, t.mode, t.number),
  ],
);

/** What an acknowledgment version printed about the donor and the gifts (kept so a version can be reproduced exactly). */
export interface AcknowledgmentSnapshot {
  sgo: { name: string; legalName: string | null; ein: string; city: string | null; state: string | null };
  donor: { fullName: string; addressLines: string[] };
  donorNumber: { number: string; source: "irs_portal_entered" | "irs_portal_import" | "sandbox_generated" };
  gifts: Array<{ donationId: string; localDate: string; designatedCents: number; nonDesignatedCents: number }>;
  copyVersion: string;
  letterCopyVersion: string;
}

/** The SGO's written acknowledgment to one donor for one tax year (the donor's substantiation; must match what the SGO reports). */
export const acknowledgments = pgTable(
  "acknowledgments",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    donorId: text("donor_id").notNull().references(() => donors.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    taxYear: integer("tax_year").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").$type<"draft" | "issued" | "superseded" | "blocked">().notNull().default("draft"),
    /** Why it cannot be issued yet, e.g. the unique donor number is not available. */
    blockedReason: text("blocked_reason"),
    sgoEin: text("sgo_ein"),
    uniqueDonorNumber: text("unique_donor_number"),
    totalDesignatedCents: bigint("total_designated_cents", { mode: "number" }).notNull(),
    goodsOrServicesProvided: boolean("goods_or_services_provided").notNull().default(false),
    goodsOrServicesValueCents: bigint("goods_or_services_value_cents", { mode: "number" }).notNull().default(0),
    donationIds: jsonb("donation_ids").$type<string[]>().notNull().default([]),
    pdfObjectId: text("pdf_object_id").references(() => objects.id),
    delivery: text("delivery").$type<"email" | "paper_required">().notNull().default("email"),
    issuedAt: ts("issued_at"),
    /** Email: null (the outbox row's status tells delivery). Paper: when SGO staff recorded that it was mailed. */
    deliveredAt: ts("delivered_at"),
    emailId: text("email_id"),
    /** Every reason the version cannot be issued (blockedReason is the first one's message). */
    blockers: jsonb("blockers").$type<Array<{ code: string; message: string }>>().notNull().default([]),
    nonDesignatedCents: bigint("non_designated_cents", { mode: "number" }).notNull().default(0),
    goodsOrServicesDescription: text("goods_or_services_description"),
    /** The address the acknowledgment was emailed to (the consented address). */
    deliveryEmail: text("delivery_email"),
    deliveryConsentId: text("delivery_consent_id"),
    /** SHA-256 of the content the version prints (amounts, people, number, gifts, words); equal hashes mean nothing changed. */
    contentSha256: text("content_sha256"),
    pdfSha256: text("pdf_sha256"),
    snapshot: jsonb("snapshot").$type<AcknowledgmentSnapshot>(),
    issuedBy: text("issued_by"),
    mailedBy: text("mailed_by"),
    supersededAt: ts("superseded_at"),
    supersededById: text("superseded_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("acknowledgments_org_idx").on(t.orgId, t.mode, t.taxYear),
    index("acknowledgments_donor_idx").on(t.donorId),
    uniqueIndex("acknowledgments_version_uq").on(t.orgId, t.donorId, t.taxYear, t.mode, t.version),
  ],
);

/**
 * Reminder and worklist emails sent to an SGO about one tax year's acknowledgments (due January 31) or IRS report
 * (due February 28). One row per escalation level, so the daily job never sends the same level twice.
 */
export const acknowledgmentNotices = pgTable(
  "acknowledgment_notices",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    taxYear: integer("tax_year").notNull(),
    kind: text("kind").$type<"acknowledgments" | "irs_report">().notNull(),
    level: text("level").$type<"opening" | "reminder" | "urgent" | "final" | "overdue">().notNull(),
    sentAt: ts("sent_at").notNull(),
    emailIds: jsonb("email_ids").$type<string[]>().notNull().default([]),
    /** The worklist counts the notice reported. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.mode, t.taxYear, t.kind, t.level] })],
);

export interface IrsReportIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  donorId?: string;
}

/** A generated annual information report file for the IRS SGO portal. */
export const irsReports = pgTable(
  "irs_reports",
  {
    id: pk(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    taxYear: integer("tax_year").notNull(),
    rowCount: integer("row_count").notNull(),
    totalDesignatedCents: bigint("total_designated_cents", { mode: "number" }).notNull(),
    objectId: text("object_id").references(() => objects.id),
    sha256: text("sha256"),
    generatedBy: text("generated_by"),
    generatedAt: ts("generated_at").notNull().defaultNow(),
    /** Problems that must be fixed before filing (e.g. donors missing a unique donor number). */
    issues: jsonb("issues").$type<IrsReportIssue[]>().notNull().default([]),
    /** 1, 2, ... per SGO, mode and year: a correction is a new version. */
    version: integer("version").notNull().default(1),
    filename: text("filename"),
    /** Sum of the latest issued acknowledgments for the year, and the per-donor comparison with the report. */
    acknowledgedTotalCents: bigint("acknowledged_total_cents", { mode: "number" }).notNull().default(0),
    consistency: jsonb("consistency").$type<Record<string, unknown>>().notNull().default({}),
    /** Recorded by SGO staff after entering the report in the IRS SGO portal. */
    submittedOn: text("submitted_on"),
    submissionReference: text("submission_reference"),
    submittedBy: text("submitted_by"),
  },
  (t) => [index("irs_reports_org_idx").on(t.orgId, t.taxYear), uniqueIndex("irs_reports_version_uq").on(t.orgId, t.taxYear, t.mode, t.version)],
);

/** Every fee the platform is owed, on either side of the marketplace. Families never appear here. */
export const feeLedger = pgTable(
  "fee_ledger",
  {
    id: pk(),
    /** Who owes the fee: an SGO (donor-side, sgo_invoiced), a donor checkout (donor_service_fee) or a business (success fee). */
    payerOrgId: text("payer_org_id").references(() => organizations.id),
    kind: text("kind").$type<"sgo_platform_fee" | "donor_service_fee" | "business_success_fee">().notNull(),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: text("status").$type<"accrued" | "invoiced" | "paid" | "waived" | "void">().notNull().default("accrued"),
    donationId: text("donation_id"),
    handoffId: text("handoff_id"),
    invoiceId: text("invoice_id"),
    description: text("description"),
    /** Donor-side rows: the payment the gift was charged in, the fee structure and rate applied, and the gift the rate was applied to. */
    paymentId: text("payment_id"),
    feeStructure: text("fee_structure").$type<FeeStructure>(),
    feeBps: integer("fee_bps"),
    baseCents: bigint("base_cents", { mode: "number" }),
    voidedAt: ts("voided_at"),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("fee_ledger_payer_idx").on(t.payerOrgId, t.status),
    index("fee_ledger_donation_idx").on(t.donationId),
    index("fee_ledger_handoff_idx").on(t.handoffId),
    // One accrual per donation and fee kind: a retried job can never charge a fee twice. (Rows without a donation are not constrained.)
    uniqueIndex("fee_ledger_donation_kind_uq").on(t.donationId, t.kind),
  ],
);
