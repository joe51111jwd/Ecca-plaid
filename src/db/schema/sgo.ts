import { boolean, index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_shared";
import { organizations } from "./core";

export type SgoListSource = "provisional_curated" | "irs_published";

/**
 * The list of organizations a donor may give to. Until the IRS publishes the official SGO list this is a
 * curated PROVISIONAL list and every surface must label it as provisional. Once published, entries are
 * imported with source "irs_published" and become the source of truth (a gift must not be taken for an
 * organization that is not listed, or that has been removed).
 */
export const sgoListEntries = pgTable(
  "sgo_list_entries",
  {
    id: pk(),
    source: text("source").$type<SgoListSource>().notNull(),
    state: text("state").notNull(), // two-letter state on whose list the SGO appears
    name: text("name").notNull(),
    ein: text("ein"),
    status: text("status").$type<"listed" | "removed">().notNull().default("listed"),
    listedFrom: text("listed_from"), // YYYY-MM-DD
    removedOn: text("removed_on"), // YYYY-MM-DD
    sourceUrl: text("source_url"),
    sourceRetrievedAt: ts("source_retrieved_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    importedAt: ts("imported_at").notNull().defaultNow(),
  },
  (t) => [index("sgo_list_state_idx").on(t.state, t.status), index("sgo_list_ein_idx").on(t.ein)],
);

/** SGO-specific configuration, 1:1 with an organization of type "sgo". */
export const sgoProfiles = pgTable("sgo_profiles", {
  orgId: text("org_id").primaryKey().references(() => organizations.id),
  displayName: text("display_name").notNull(),
  legalName: text("legal_name"),
  ein: text("ein"),
  description: text("description"),
  website: text("website"),
  city: text("city"),
  state: text("state").notNull().default("TX"),
  supportEmail: text("support_email"),
  logoUrl: text("logo_url"),
  listEntryId: text("list_entry_id").references(() => sgoListEntries.id),
  /** The SGO has registered in the IRS SGO portal (required before real unique donor numbers exist). */
  irsPortalRegistered: boolean("irs_portal_registered").notNull().default(false),
  acceptsDonations: boolean("accepts_donations").notNull().default(true),
  /** Will accept applicants arriving from a point-of-booking handoff. */
  acceptsHandoffs: boolean("accepts_handoffs").notNull().default(false),
  /** Income cap as a percent of area median gross income. Statutory maximum 300; an SGO may set a stricter policy. */
  incomeCapPct: integer("income_cap_pct").notNull().default(300),
  /** While the threshold table is provisional, incomes within this many basis points of the threshold go to review. */
  reviewBandBps: integer("review_band_bps").notNull().default(500),
  /** Days raw uploads are kept after a decision before the bytes are purged (hashes and extracted fields are kept). */
  rawRetentionDays: integer("raw_retention_days").notNull().default(30),
  /** Connected payments account id for settlement (e.g. Stripe Connect acct_...). */
  paymentsAccountId: text("payments_account_id"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
