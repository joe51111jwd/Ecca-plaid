import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt, type Mode } from "./_shared";
import { objects, organizations, users } from "./core";

/** An individual taxpayer who gives. One row per person (each spouse is a separate donor with their own acknowledgment). */
export const donors = pgTable(
  "donors",
  {
    id: pk(),
    userId: text("user_id").references(() => users.id),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("donors_email_idx").on(t.email)],
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
    /** The amount designated as a section 25F qualified contribution (excludes any separate service fee). */
    designatedAmountCents: bigint("designated_amount_cents", { mode: "number" }).notNull(),
    /** The donor's explicit designation at the time of payment, and the exact words shown. */
    designated25f: boolean("designated_25f").notNull(),
    designatedAt: ts("designated_at").notNull(),
    designationCopyVersion: text("designation_copy_version").notNull(),
    /** Donor confirmed the gift is not earmarked for a particular student. */
    noEarmarkConfirmed: boolean("no_earmark_confirmed").notNull(),
    /** Donor confirmed they are giving as an individual (not through a partnership or S corporation). */
    individualConfirmed: boolean("individual_confirmed").notNull(),
    expectedStateCreditCents: bigint("expected_state_credit_cents", { mode: "number" }).notNull().default(0),
    feeStructure: text("fee_structure").$type<"none" | "sgo_invoiced" | "donor_service_fee">().notNull().default("none"),
    /** Platform fee owed by the SGO (sgo_invoiced) — never deducted from the designated amount. */
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull().default(0),
    /** Separate, non-designated fee paid by the donor on top (donor_service_fee). */
    donorServiceFeeCents: bigint("donor_service_fee_cents", { mode: "number" }).notNull().default(0),
    goodsOrServicesProvided: boolean("goods_or_services_provided").notNull().default(false),
    goodsOrServicesValueCents: bigint("goods_or_services_value_cents", { mode: "number" }).notNull().default(0),
    status: text("status").$type<"pending" | "succeeded" | "failed" | "canceled" | "refunded">().notNull().default("pending"),
    /** Charge time (copied from the payment); decides taxYear. */
    contributedAt: ts("contributed_at"),
    taxYear: integer("tax_year"),
    /** False for gifts before the credit start date or to an SGO not on a valid list, with the reason shown to the donor. */
    creditEligible: boolean("credit_eligible").notNull().default(false),
    creditIneligibleReason: text("credit_ineligible_reason"),
    /** List status of the SGO at the moment of the gift (the donor may rely on it). */
    sgoListStatusAtGift: text("sgo_list_status_at_gift"),
    sgoListEntryIdAtGift: text("sgo_list_entry_id_at_gift"),
    eDeliveryConsentId: text("e_delivery_consent_id"),
    receiptEmailId: text("receipt_email_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("donations_org_idx").on(t.orgId, t.mode, t.taxYear), index("donations_donor_idx").on(t.donorId), index("donations_checkout_idx").on(t.checkoutSessionId)],
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
  },
  (t) => [uniqueIndex("donor_numbers_uq").on(t.orgId, t.donorId, t.taxYear, t.mode)],
);

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
    deliveredAt: ts("delivered_at"),
    emailId: text("email_id"),
    createdAt: createdAt(),
  },
  (t) => [index("acknowledgments_org_idx").on(t.orgId, t.mode, t.taxYear), index("acknowledgments_donor_idx").on(t.donorId)],
);

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
    issues: jsonb("issues").$type<Array<{ code: string; message: string; donorId?: string }>>().notNull().default([]),
  },
  (t) => [index("irs_reports_org_idx").on(t.orgId, t.taxYear)],
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
    createdAt: createdAt(),
  },
  (t) => [index("fee_ledger_payer_idx").on(t.payerOrgId, t.status), index("fee_ledger_donation_idx").on(t.donationId), index("fee_ledger_handoff_idx").on(t.handoffId)],
);
