import { and, asc, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { toCsv } from "@/lib/csv";
import { badRequest, forbidden, invalid, notFound } from "@/lib/errors";
import { acknowledgmentSummaries, donorNumberSummaries, type AcknowledgmentSummary, type DonorNumberSummary } from "@/server/acknowledgments";
import { audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { listFeesForDonations, type FeeLedgerRow } from "@/server/fees";
import { getSgoProfile } from "@/server/sgos";
import { renderCopy } from "@/taxmath";
import { SGO_LIST_PAGE } from "./policy";

/**
 * Read models over donations: the SGO dashboard (org-scoped; the caller has already checked membership) and the
 * donor's own page. Every read of donor records is written to the audit log with the actor the caller names.
 */

const { donations, donors, donorDeliveryConsents, donorYearTotals } = schema;
export type DonationRecord = typeof donations.$inferSelect;
export type DonorRecord = typeof donors.$inferSelect;
export type DeliveryConsentRecord = typeof donorDeliveryConsents.$inferSelect;
type DonationStatus = DonationRecord["status"];

export interface ReadAccess {
  /** Who is reading (an SGO staff user, an API key, ...). Recorded in the audit log. */
  actor: AuditActor;
  request?: AuditRequestInfo | null;
}

export interface SgoDonationItem {
  donation: DonationRecord;
  donor: DonorRecord;
}

const DONATION_STATUSES = ["pending", "succeeded", "failed", "canceled", "refunded"] as const satisfies readonly DonationStatus[];

const listSchema = z.strictObject({
  mode: z.enum(["test", "live"]),
  taxYear: z.number().int().min(2000).max(2200).optional(),
  status: z.enum(DONATION_STATUSES).optional(),
  cursor: z.string().max(300).nullish(),
  limit: z.number().int().min(1).max(SGO_LIST_PAGE.max).default(SGO_LIST_PAGE.default),
});

export type ListDonationsParams = z.input<typeof listSchema>;

function encodeCursor(row: Pick<DonationRecord, "createdAt" | "id">): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) throw badRequest("Invalid cursor");
  return { createdAt, id };
}

function requireOrg(orgId: unknown): string {
  if (typeof orgId !== "string" || orgId.length === 0 || orgId.length > 100) throw badRequest("An organization is required");
  return orgId;
}

function requireAccess(access: ReadAccess | undefined): ReadAccess {
  if (!access?.actor?.type) throw forbidden("A reader must be named for donor records");
  return access;
}

function parseOrThrow<S extends z.ZodType>(schemaToUse: S, input: unknown): z.output<S> {
  const parsed = schemaToUse.safeParse(input);
  if (!parsed.success) throw invalid("Check the filters.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "params", i.message])) });
  return parsed.data;
}

function filters(orgId: string, p: { mode: Mode; taxYear?: number; status?: DonationStatus }): SQL[] {
  const where: SQL[] = [eq(donations.orgId, orgId), eq(donations.mode, p.mode)];
  if (p.taxYear !== undefined) where.push(eq(donations.taxYear, p.taxYear));
  if (p.status) where.push(eq(donations.status, p.status));
  return where;
}

/** One SGO's donations, newest first, with cursor paging. */
export async function listDonationsForSgo(orgId: string, params: ListDonationsParams, access: ReadAccess, dbOrTx?: DbOrTx): Promise<{ items: SgoDonationItem[]; nextCursor: string | null }> {
  const org = requireOrg(orgId);
  const who = requireAccess(access);
  const p = parseOrThrow(listSchema, params);
  const where = filters(org, p);
  if (p.cursor) {
    const c = decodeCursor(p.cursor);
    where.push(or(lt(donations.createdAt, c.createdAt), and(eq(donations.createdAt, c.createdAt), lt(donations.id, c.id))) as SQL);
  }
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ donation: donations, donor: donors })
    .from(donations)
    .innerJoin(donors, eq(donors.id, donations.donorId))
    .where(and(...where))
    .orderBy(desc(donations.createdAt), desc(donations.id))
    .limit(p.limit + 1);
  const items = rows.slice(0, p.limit);
  await audit({ actor: who.actor, orgId: org, action: "donation.list", metadata: { mode: p.mode, taxYear: p.taxYear ?? null, status: p.status ?? null, count: items.length }, request: who.request }, db);
  return { items, nextCursor: rows.length > p.limit ? encodeCursor(items[items.length - 1].donation) : null };
}

export interface SgoDonationDetail extends SgoDonationItem {
  deliveryConsent: DeliveryConsentRecord | null;
  fees: FeeLedgerRow[];
  /** The other spouse's donation from the same payment, when the gift was made on behalf of both spouses. */
  jointWith: SgoDonationItem | null;
}

/** One donation of an SGO. Not found when it belongs to another organization. */
export async function getDonationForSgo(orgId: string, donationId: string, access: ReadAccess, dbOrTx?: DbOrTx): Promise<SgoDonationDetail> {
  const org = requireOrg(orgId);
  const who = requireAccess(access);
  if (typeof donationId !== "string" || donationId.length === 0 || donationId.length > 100) throw notFound("Donation");
  const db = dbOrTx ?? (await getDb());
  const [found] = await db.select({ donation: donations, donor: donors }).from(donations).innerJoin(donors, eq(donors.id, donations.donorId)).where(and(eq(donations.id, donationId), eq(donations.orgId, org)));
  if (!found) throw notFound("Donation");
  const [consent] = found.donation.eDeliveryConsentId ? await db.select().from(donorDeliveryConsents).where(eq(donorDeliveryConsents.id, found.donation.eDeliveryConsentId)) : [];
  const fees = await listFeesForDonations([found.donation.id], db);
  const jointWith = await siblingOf(found.donation, org, db);
  await audit({ actor: who.actor, orgId: org, action: "donation.read", target: { type: "donation", id: found.donation.id }, request: who.request }, db);
  return { ...found, deliveryConsent: consent ?? null, fees, jointWith };
}

async function siblingOf(donation: DonationRecord, orgId: string, db: DbOrTx): Promise<SgoDonationItem | null> {
  if (!donation.paymentId) return null;
  const rows = await db
    .select({ donation: donations, donor: donors })
    .from(donations)
    .innerJoin(donors, eq(donors.id, donations.donorId))
    .where(and(eq(donations.orgId, orgId), eq(donations.paymentId, donation.paymentId)));
  return rows.find((r) => r.donation.id !== donation.id) ?? null;
}

export interface DonorTotal {
  donor: DonorRecord;
  taxYear: number;
  mode: Mode;
  designatedCents: number;
  nonDesignatedCents: number;
  giftCount: number;
  lastContributedAt: Date | null;
  donorNumber: DonorNumberSummary;
  acknowledgment: AcknowledgmentSummary;
  eDelivery: { consented: boolean; consentId: string | null; email: string | null; withdrawnAt: Date | null };
  /** For SGO staff only: the large-donor advisory (taxmath), with spouse contributions combined. */
  substantialContributor: Record<string, unknown> | null;
}

/** Per donor, for one SGO and calendar year: received totals, unique donor number, acknowledgment and e-delivery status. */
export async function donorTotalsForSgo(orgId: string, taxYear: number, params: { mode: Mode }, access: ReadAccess, dbOrTx?: DbOrTx): Promise<DonorTotal[]> {
  const org = requireOrg(orgId);
  const who = requireAccess(access);
  const p = parseOrThrow(z.strictObject({ mode: z.enum(["test", "live"]), taxYear: z.number().int().min(2000).max(2200) }), { mode: params?.mode, taxYear });
  const db = dbOrTx ?? (await getDb());
  const { profile } = await getSgoProfile(org, db);
  const rows = await db
    .select({ totals: donorYearTotals, donor: donors })
    .from(donorYearTotals)
    .innerJoin(donors, eq(donors.id, donorYearTotals.donorId))
    .where(and(eq(donorYearTotals.orgId, org), eq(donorYearTotals.mode, p.mode), eq(donorYearTotals.taxYear, p.taxYear)))
    .orderBy(asc(donors.lastName), asc(donors.firstName), asc(donors.id));
  const donorIds = rows.map((r) => r.donor.id);
  const scope = { orgId: org, mode: p.mode, taxYear: p.taxYear, donorIds };
  const acks = await acknowledgmentSummaries(scope, db);
  const numbers = await donorNumberSummaries({ ...scope, sgoPortalRegistered: profile.irsPortalRegistered }, db);
  const consents =
    donorIds.length > 0
      ? await db
          .select()
          .from(donorDeliveryConsents)
          .where(and(eq(donorDeliveryConsents.orgId, org), eq(donorDeliveryConsents.mode, p.mode), inArray(donorDeliveryConsents.donorId, donorIds)))
          .orderBy(desc(donorDeliveryConsents.grantedAt))
      : [];
  await audit({ actor: who.actor, orgId: org, action: "donation.donor_totals", metadata: { mode: p.mode, taxYear: p.taxYear, count: rows.length }, request: who.request }, db);
  return rows.map(({ totals, donor }) => {
    const latest = consents.find((c) => c.donorId === donor.id) ?? null;
    return {
      donor,
      taxYear: totals.taxYear,
      mode: totals.mode,
      designatedCents: totals.designatedCents,
      nonDesignatedCents: totals.nonDesignatedCents,
      giftCount: totals.giftCount,
      lastContributedAt: totals.lastContributedAt,
      donorNumber: numbers.get(donor.id) as DonorNumberSummary,
      acknowledgment: acks.get(donor.id) as AcknowledgmentSummary,
      eDelivery: { consented: latest !== null && latest.withdrawnAt === null, consentId: latest?.id ?? null, email: latest?.email ?? null, withdrawnAt: latest?.withdrawnAt ?? null },
      substantialContributor: totals.substantialContributor ?? null,
    };
  });
}

export const DONATION_EXPORT_COLUMNS = [
  "donation_id",
  "status",
  "mode",
  "contributed_at",
  "tax_year",
  "year_boundary_ambiguous",
  "taxpayer_role",
  "filing_status",
  "donor_id",
  "first_name",
  "middle_name",
  "last_name",
  "suffix",
  "email",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "zip",
  "designated_amount_cents",
  "non_designated_amount_cents",
  "donor_service_fee_cents",
  "sgo_platform_fee_cents",
  "designated_at",
  "designation_copy_version",
  "designation_text_sha256",
  "state_allocation",
  "credit_eligible",
  "credit_ineligible_reason",
  "sgo_list_status_at_gift",
  "e_delivery_consent",
  "payment_id",
  "refunded_at",
] as const;

/** One SGO's donations as CSV (spreadsheet-formula safe), oldest first. */
export async function exportDonationsCsv(
  orgId: string,
  params: { mode: Mode; taxYear?: number; status?: DonationStatus },
  access: ReadAccess,
  dbOrTx?: DbOrTx,
): Promise<{ filename: string; csv: string; rowCount: number }> {
  const org = requireOrg(orgId);
  const who = requireAccess(access);
  const p = parseOrThrow(listSchema.omit({ cursor: true, limit: true }), params);
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ donation: donations, donor: donors })
    .from(donations)
    .innerJoin(donors, eq(donors.id, donations.donorId))
    .where(and(...filters(org, p)))
    .orderBy(asc(donations.createdAt), asc(donations.id));
  const iso = (d: Date | null) => (d ? d.toISOString() : "");
  const csv = toCsv(
    [...DONATION_EXPORT_COLUMNS],
    rows.map(({ donation: d, donor }) => ({
      donation_id: d.id,
      status: d.status,
      mode: d.mode,
      contributed_at: iso(d.contributedAt),
      tax_year: d.taxYear ?? "",
      year_boundary_ambiguous: d.yearBoundaryAmbiguous,
      taxpayer_role: d.taxpayerRole,
      filing_status: d.filingStatus,
      donor_id: donor.id,
      first_name: donor.firstName,
      middle_name: donor.middleName,
      last_name: donor.lastName,
      suffix: donor.suffix,
      email: donor.email,
      address_line1: donor.addressLine1,
      address_line2: donor.addressLine2,
      city: donor.city,
      state: donor.state,
      zip: donor.zip,
      designated_amount_cents: d.designatedAmountCents,
      non_designated_amount_cents: d.nonDesignatedAmountCents,
      donor_service_fee_cents: d.donorServiceFeeCents,
      sgo_platform_fee_cents: d.platformFeeCents,
      designated_at: d.designatedAt.toISOString(),
      designation_copy_version: d.designationCopyVersion,
      designation_text_sha256: d.designationTextSha256,
      state_allocation: d.stateAllocation,
      credit_eligible: d.creditEligible,
      credit_ineligible_reason: d.creditIneligibleReason,
      sgo_list_status_at_gift: d.sgoListStatusAtGift,
      e_delivery_consent: d.eDeliveryConsentId !== null,
      payment_id: d.paymentId,
      refunded_at: iso(d.refundedAt),
    })),
  );
  await audit({ actor: who.actor, orgId: org, action: "donation.export", metadata: { mode: p.mode, taxYear: p.taxYear ?? null, status: p.status ?? null, rowCount: rows.length }, request: who.request }, db);
  const parts = [p.mode === "test" ? "sandbox-" : "", "donations-", org, p.taxYear !== undefined ? `-${p.taxYear}` : "", p.status ? `-${p.status}` : ""];
  return { filename: `${parts.join("")}.csv`, csv, rowCount: rows.length };
}

/* ------------------------------------------------------------------ the donor's own page */

export interface DonorGift {
  donationId: string;
  status: DonationStatus;
  designatedAt: Date;
  contributedAt: Date | null;
  designatedCents: number;
  nonDesignatedCents: number;
  serviceFeeCents: number;
  creditEligible: boolean;
  creditIneligibleReason: string | null;
  designationText: string;
  receiptEmailId: string | null;
  refundedAt: Date | null;
}

export interface DonorGiftGroup {
  /** What Form 8525 will ask for: the SGO and the unique donor number. */
  sgo: { orgId: string; name: string; legalName: string | null; ein: string | null };
  donor: { id: string; fullName: string };
  mode: Mode;
  /** Null for gifts still being processed (the tax year is fixed by the charge time). */
  taxYear: number | null;
  /** Money received and designated for the year (succeeded gifts only). */
  designatedTotalCents: number;
  donorNumber: (DonorNumberSummary & { note: string | null }) | null;
  acknowledgment: AcknowledgmentSummary | null;
  eDelivery: { consented: boolean; consentId: string | null; email: string | null; withdrawnAt: Date | null };
  gifts: DonorGift[];
}

/**
 * The signed-in donor's gifts, grouped by SGO, donor (each spouse separately) and year: each SGO with name, EIN
 * and unique donor number when available, plus receipts and acknowledgments. A donor row belongs to the user when it
 * is linked to them or carries their (verified) sign-in email address.
 */
export async function listGiftsForUser(userId: string, options: { request?: AuditRequestInfo | null } = {}, dbOrTx?: DbOrTx): Promise<DonorGiftGroup[]> {
  if (typeof userId !== "string" || userId.length === 0) throw forbidden();
  const db = dbOrTx ?? (await getDb());
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) throw forbidden();
  const owned = await db
    .select()
    .from(donors)
    .where(or(eq(donors.userId, user.id), eq(donors.email, user.email.toLowerCase())) as SQL);
  if (owned.length === 0) return [];
  const rows = await db
    .select()
    .from(donations)
    .where(and(inArray(donations.donorId, owned.map((d) => d.id)), inArray(donations.status, ["pending", "succeeded", "refunded"])))
    .orderBy(desc(donations.designatedAt), desc(donations.id));

  const groups = new Map<string, DonorGiftGroup>();
  const profiles = new Map<string, Awaited<ReturnType<typeof getSgoProfile>>>();
  for (const d of rows) {
    const key = `${d.orgId}|${d.donorId}|${d.mode}|${d.taxYear ?? "pending"}`;
    let group = groups.get(key);
    if (!group) {
      if (!profiles.has(d.orgId)) profiles.set(d.orgId, await getSgoProfile(d.orgId, db));
      const { profile } = profiles.get(d.orgId) as Awaited<ReturnType<typeof getSgoProfile>>;
      const donor = owned.find((o) => o.id === d.donorId) as DonorRecord;
      group = {
        sgo: { orgId: d.orgId, name: profile.displayName, legalName: profile.legalName, ein: profile.ein },
        donor: { id: donor.id, fullName: [donor.firstName, donor.middleName, donor.lastName, donor.suffix].filter(Boolean).join(" ") },
        mode: d.mode,
        taxYear: d.taxYear,
        designatedTotalCents: 0,
        donorNumber: null,
        acknowledgment: null,
        eDelivery: { consented: false, consentId: null, email: null, withdrawnAt: null },
        gifts: [],
      };
      groups.set(key, group);
    }
    if (d.status === "succeeded") group.designatedTotalCents += d.designatedAmountCents;
    group.gifts.push({
      donationId: d.id,
      status: d.status,
      designatedAt: d.designatedAt,
      contributedAt: d.contributedAt,
      designatedCents: d.designatedAmountCents,
      nonDesignatedCents: d.nonDesignatedAmountCents,
      serviceFeeCents: d.donorServiceFeeCents,
      creditEligible: d.creditEligible,
      creditIneligibleReason: d.creditIneligibleReason,
      designationText: d.designationText,
      receiptEmailId: d.receiptEmailId,
      refundedAt: d.refundedAt,
    });
  }

  for (const group of groups.values()) {
    const { profile } = profiles.get(group.sgo.orgId) as Awaited<ReturnType<typeof getSgoProfile>>;
    const [consent] = await db
      .select()
      .from(donorDeliveryConsents)
      .where(and(eq(donorDeliveryConsents.orgId, group.sgo.orgId), eq(donorDeliveryConsents.donorId, group.donor.id), eq(donorDeliveryConsents.mode, group.mode)))
      .orderBy(desc(donorDeliveryConsents.grantedAt))
      .limit(1);
    group.eDelivery = { consented: Boolean(consent) && consent.withdrawnAt === null, consentId: consent?.id ?? null, email: consent?.email ?? null, withdrawnAt: consent?.withdrawnAt ?? null };
    if (group.taxYear === null) continue;
    const scope = { orgId: group.sgo.orgId, mode: group.mode, taxYear: group.taxYear, donorIds: [group.donor.id] };
    const number = (await donorNumberSummaries({ ...scope, sgoPortalRegistered: profile.irsPortalRegistered }, db)).get(group.donor.id) as DonorNumberSummary;
    const note =
      number.status === "sandbox"
        ? renderCopy("ack.sandbox_donor_number")
        : number.status === "assigned"
          ? null
          : renderCopy("ack.pending_donor_number", { sgoName: profile.displayName });
    group.donorNumber = { ...number, note };
    group.acknowledgment = (await acknowledgmentSummaries(scope, db)).get(group.donor.id) ?? null;
  }
  await audit({ actor: { type: "user", id: user.id }, action: "donation.read_own", metadata: { groups: groups.size }, request: options.request }, db);
  return [...groups.values()];
}
