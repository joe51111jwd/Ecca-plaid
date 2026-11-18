import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, pk, ts } from "./_shared";
import { organizations } from "./core";

export type SgoListSource = "provisional_curated" | "irs_published";
export type SgoListEntryStatus = "listed" | "removed";

/**
 * The list of organizations a donor may give to. Until the IRS publishes the official SGO list this is a
 * curated PROVISIONAL list and every surface must label it as provisional. Once published, entries are
 * imported with source "irs_published" and become the source of truth (a gift must not be taken for an
 * organization that is not listed, or that has been removed).
 *
 * Rows are written only by `importSgoList` (src/server/sgos), which upserts on (source, state, match_key).
 * Removed entries are kept with their removal date: the IRS shows removed SGOs struck through with the date,
 * and gifts made before that date may still qualify.
 */
export const sgoListEntries = pgTable(
  "sgo_list_entries",
  {
    id: pk(),
    source: text("source").$type<SgoListSource>().notNull(),
    state: text("state").notNull(), // two-letter state on whose list the SGO appears
    name: text("name").notNull(),
    ein: text("ein"), // NN-NNNNNNN
    /** Upsert identity within (source, state): "ein:NN-NNNNNNN" when the list gives an EIN, else "name:<normalized name>". */
    matchKey: text("match_key").notNull(),
    status: text("status").$type<SgoListEntryStatus>().notNull().default("listed"),
    listedFrom: text("listed_from"), // YYYY-MM-DD
    removedOn: text("removed_on"), // YYYY-MM-DD, the removal's effective date: gifts on or after it are refused
    sourceUrl: text("source_url"),
    /** When the list file this row was last confirmed by was retrieved from its source. */
    sourceRetrievedAt: ts("source_retrieved_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    importedAt: ts("imported_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("sgo_list_state_idx").on(t.state, t.status),
    index("sgo_list_ein_idx").on(t.ein),
    uniqueIndex("sgo_list_source_state_key_uq").on(t.source, t.state, t.matchKey),
  ],
);

/** SGO-specific configuration, 1:1 with an organization of type "sgo". */
export const sgoProfiles = pgTable(
  "sgo_profiles",
  {
    orgId: text("org_id").primaryKey().references(() => organizations.id),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    /** NN-NNNNNNN. Unique across profiles, so two organizations can never claim the same list entry. */
    ein: text("ein"),
    description: text("description"),
    website: text("website"),
    city: text("city"),
    state: text("state").notNull().default("TX"),
    supportEmail: text("support_email"),
    logoUrl: text("logo_url"),
    /**
     * The list entry a platform admin verified this organization against. Only a platform admin sets it. When the
     * active list source changes, an entry in the new source with the same verified EIN and state takes its place.
     */
    listEntryId: text("list_entry_id").references(() => sgoListEntries.id),
    /** The SGO has registered in the IRS SGO portal (required before real unique donor numbers exist). */
    irsPortalRegistered: boolean("irs_portal_registered").notNull().default(false),
    irsPortalRegisteredAt: ts("irs_portal_registered_at"),
    acceptsDonations: boolean("accepts_donations").notNull().default(true),
    /** Will accept applicants arriving from a point-of-booking handoff. */
    acceptsHandoffs: boolean("accepts_handoffs").notNull().default(false),
    /** The SGO chose to work in the dashboard only (no webhook endpoint needed). */
    dashboardOnly: boolean("dashboard_only").notNull().default(false),
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
  },
  (t) => [uniqueIndex("sgo_profiles_ein_uq").on(t.ein), uniqueIndex("sgo_profiles_list_entry_uq").on(t.listEntryId)],
);
