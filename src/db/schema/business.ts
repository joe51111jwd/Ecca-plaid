import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts, updatedAt, type Mode } from "./_shared";
import { objects, organizations } from "./core";

/** Kind of establishment. Configurable because what counts as a qualifying expense/provider is not final. */
export type VendorType = "summer_camp" | "private_school" | "microschool" | "tutoring" | "after_school" | "other";

/** Business-specific configuration, 1:1 with an organization of type "business". The business is the customer for the handoff. */
export const businessProfiles = pgTable("business_profiles", {
  orgId: text("org_id").primaryKey().references(() => organizations.id),
  displayName: text("display_name").notNull(),
  vendorType: text("vendor_type").$type<VendorType>().notNull().default("summer_camp"),
  website: text("website"),
  billingEmail: text("billing_email"),
  /** Processor customer id for invoicing (e.g. Stripe cus_...). */
  paymentsCustomerId: text("payments_customer_id"),
  /** Success fee per completed scholarship-funded booking: a flat amount and/or basis points of the booking. Billed to the business only. */
  successFeeFlatCents: bigint("success_fee_flat_cents", { mode: "number" }).notNull().default(0),
  successFeeBps: integer("success_fee_bps").notNull().default(0),
  /** How long a reservation is held while verification / award is pending. */
  holdWindowHours: integer("hold_window_hours").notNull().default(72),
  /** Origins allowed to embed the handoff and URLs we may return the family to. */
  allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
  brandColor: text("brand_color"),
  logoUrl: text("logo_url"),
  /** Publishable key used by the embed script (not a secret; identifies the business). */
  publishableKey: text("publishable_key").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which SGOs accept applicants from which business's handoff. */
export const partnerships = pgTable(
  "partnerships",
  {
    id: text("id").primaryKey(),
    businessOrgId: text("business_org_id").notNull().references(() => organizations.id),
    sgoOrgId: text("sgo_org_id").notNull().references(() => organizations.id),
    status: text("status").$type<"pending" | "active" | "ended">().notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("partnerships_uq").on(t.businessOrgId, t.sgoOrgId)],
);

/**
 * Point-of-booking handoff lifecycle (also the webhook event names sent to the business: handoff.<status>).
 *  started → verifying → held → eligible → awarded → completed
 *                         ↘ declined (not eligible, or the SGO did not award)   ↘ expired (hold window passed)   ↘ canceled
 * "eligible" is NOT a promise of payment: an award is a separate SGO decision.
 */
export type HandoffStatus = "started" | "verifying" | "held" | "eligible" | "awarded" | "completed" | "declined" | "expired" | "canceled";

export const handoffs = pgTable(
  "handoffs",
  {
    id: pk(),
    businessOrgId: text("business_org_id").notNull().references(() => organizations.id),
    sgoOrgId: text("sgo_org_id").references(() => organizations.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    status: text("status").$type<HandoffStatus>().notNull().default("started"),
    channel: text("channel").$type<"embed" | "redirect">().notNull().default("redirect"),
    /** The business's own booking id and a human description ("Session 2, June 8-12"). */
    bookingRef: text("booking_ref").notNull(),
    bookingDescription: text("booking_description"),
    bookingAmountCents: bigint("booking_amount_cents", { mode: "number" }),
    familyEmail: text("family_email"),
    studentFirstName: text("student_first_name"),
    studentLastName: text("student_last_name"),
    verificationId: text("verification_id"),
    awardId: text("award_id"),
    returnUrl: text("return_url"),
    /** Token that lets the family's browser resume the handoff (hash stored). */
    tokenHash: text("token_hash").notNull(),
    holdExpiresAt: ts("hold_expires_at"),
    declineReason: text("decline_reason"),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("handoffs_token_uq").on(t.tokenHash),
    index("handoffs_business_idx").on(t.businessOrgId, t.mode, t.createdAt),
    index("handoffs_sgo_idx").on(t.sgoOrgId),
    index("handoffs_verification_idx").on(t.verificationId),
    index("handoffs_hold_idx").on(t.status, t.holdExpiresAt),
  ],
);

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

/** Invoice to a business for success fees. Never to a family, never netted from scholarship funds. */
export const businessInvoices = pgTable(
  "business_invoices",
  {
    id: pk(),
    businessOrgId: text("business_org_id").notNull().references(() => organizations.id),
    mode: text("mode").$type<Mode>().notNull().default("test"),
    number: text("number").notNull(),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    periodStart: text("period_start"), // YYYY-MM-DD
    periodEnd: text("period_end"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    processor: text("processor").$type<"sandbox" | "stripe">().notNull().default("sandbox"),
    processorInvoiceId: text("processor_invoice_id"),
    hostedUrl: text("hosted_url"),
    pdfObjectId: text("pdf_object_id").references(() => objects.id),
    dueAt: ts("due_at"),
    issuedAt: ts("issued_at"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("business_invoices_number_uq").on(t.number), index("business_invoices_business_idx").on(t.businessOrgId, t.status)],
);

export const businessInvoiceLines = pgTable(
  "business_invoice_lines",
  {
    id: pk(),
    invoiceId: text("invoice_id").notNull().references(() => businessInvoices.id),
    feeLedgerId: text("fee_ledger_id"),
    handoffId: text("handoff_id"),
    description: text("description").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("business_invoice_lines_invoice_idx").on(t.invoiceId)],
);
