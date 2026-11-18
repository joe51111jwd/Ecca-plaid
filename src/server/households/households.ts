import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { CountyResolution } from "@/db/schema";
import { getCounty } from "@/engine/ami";
import { normalizeZip, type CountyCandidate } from "@/engine/geo";
import { now } from "@/lib/clock";
import { conflict, invalid } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import type { HouseholdAccess } from "@/server/auth";
import { confirmSelectedCounty, resolveHouseholdCounty, type GeoServiceOptions, type HouseholdAddressInput, type HudAreaRef, type SelectionReason } from "@/server/geo";
import { loadActorUser, requirePermission, type HouseholdActor, type HouseholdRole } from "./access";
import { listActiveMemberRows, toMemberView, type Household, type HouseholdMemberView } from "./members";
import { tidyAddressText, type NormalizedAddress } from "./validation";

export type HouseholdLocale = "en" | "es";

export interface HouseholdCountyView {
  fips: string;
  name: string;
  resolution: CountyResolution;
  /** HUD income-limit area of the county in the active table; null if the table no longer lists the county. */
  hudArea: HudAreaRef | null;
  /**
   * For a self-selected county: whether it is one of the ZIP's candidate counties (null when the ZIP has no
   * Texas ZCTA). Always null for geocoder or unique-ZIP resolutions. Reviewers see a false here.
   */
  matchesZip: boolean | null;
}

export interface HouseholdView {
  id: string;
  ownerUserId: string;
  /** The viewer's role. */
  access: HouseholdRole;
  locale: HouseholdLocale;
  address: NormalizedAddress | null;
  county: HouseholdCountyView | null;
  members: HouseholdMemberView[];
  studentIds: string[];
  /** Family size: active members (see getHouseholdSize). */
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------------------------------------------------------------------- views */

export function addressOf(h: Household): NormalizedAddress | null {
  if (!h.addressLine1 || !h.city || !h.state || !h.zip) return null;
  return { line1: h.addressLine1, line2: h.addressLine2, city: h.city, state: h.state, zip: h.zip };
}

export function countyOf(h: Household): HouseholdCountyView | null {
  if (!h.countyFips || !h.countyName || !h.countyResolution) return null;
  const ami = getCounty(h.countyFips);
  let matchesZip: boolean | null = null;
  if (h.countyResolution === "self_selected" && ami) matchesZip = confirmSelectedCounty(h.countyFips, h.zip).matchesZip;
  return { fips: h.countyFips, name: h.countyName, resolution: h.countyResolution, hudArea: ami ? { code: ami.areaCode, name: ami.areaName } : null, matchesZip };
}

async function buildView(db: DbOrTx, household: Household, access: HouseholdRole): Promise<HouseholdView> {
  const members = (await listActiveMemberRows(db, household.id)).map(toMemberView);
  return {
    id: household.id,
    ownerUserId: household.ownerUserId,
    access,
    locale: household.locale,
    address: addressOf(household),
    county: countyOf(household),
    members,
    studentIds: members.filter((m) => m.kind === "student").map((m) => m.id),
    size: members.length,
    createdAt: household.createdAt,
    updatedAt: household.updatedAt,
  };
}

/* -------------------------------------------------------------------------------- get or create */

export interface GetOrCreateHouseholdResult {
  household: HouseholdView;
  created: boolean;
}

/**
 * The durable household for a signed-in person, so a verified result can be reused later without a new
 * account (the spec's "passport"). One household per owner: a person who owns one gets it; a person linked
 * as an adult member of someone else's household gets that one; anyone else gets a new household they own.
 * Concurrent first calls for one person create a single household (transaction-scoped advisory lock).
 */
export async function getOrCreateHouseholdForUser(userId: string, opts: { locale?: HouseholdLocale } = {}, dbOrTx?: DbOrTx): Promise<GetOrCreateHouseholdResult> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const user = await loadActorUser(tx, userId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`household-owner:${user.id}`}, 0))`);

    const h = schema.households;
    const [owned] = await tx.select().from(h).where(eq(h.ownerUserId, user.id)).orderBy(asc(h.createdAt), asc(h.id)).limit(1);
    if (owned) return { household: await buildView(tx, owned, "owner"), created: false };

    const hm = schema.householdMembers;
    const [linked] = await tx
      .select({ household: h })
      .from(hm)
      .innerJoin(h, eq(h.id, hm.householdId))
      .where(and(eq(hm.userId, user.id), eq(hm.kind, "adult"), isNull(hm.removedAt)))
      .orderBy(asc(hm.createdAt), asc(hm.id))
      .limit(1);
    if (linked) return { household: await buildView(tx, linked.household, "adult"), created: false };

    const at = now();
    const locale: HouseholdLocale = opts.locale === "es" || opts.locale === "en" ? opts.locale : user.locale === "es" ? "es" : "en";
    const [created] = await tx.insert(h).values({ id: newId("household"), ownerUserId: user.id, locale, createdAt: at, updatedAt: at }).returning();
    await audit({ actor: { type: "user", id: user.id }, action: "household.create", target: { type: "household", id: created.id }, metadata: { locale } }, tx);
    return { household: await buildView(tx, created, "owner"), created: true };
  });
}

/** The household as the actor may see it (owner or linked adult). not_found for anyone else. */
export async function getHousehold(householdId: string, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdView> {
  const db = dbOrTx ?? (await getDb());
  const access = await requirePermission(db, householdId, actor, "view");
  return buildView(db, access.household, access.access);
}

/** Language for the family's screens and emails. Owner only. */
export async function updateHouseholdLocale(householdId: string, locale: HouseholdLocale, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdView> {
  if (locale !== "en" && locale !== "es") throw invalid("Choose English or Spanish.", { fields: { locale: "Choose English or Spanish." } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    const [row] = await tx.update(schema.households).set({ locale, updatedAt: now() }).where(eq(schema.households.id, access.household.id)).returning();
    await audit({ actor: { type: "user", id: actor.userId }, action: "household.locale_update", target: { type: "household", id: row.id }, metadata: { locale }, request: actor.request }, tx);
    return buildView(tx, row, access.access);
  });
}

/* ------------------------------------------------------------------------------- address & county */

export type UpdateAddressResult =
  | { status: "resolved"; needsSelection: false; household: HouseholdView; county: HouseholdCountyView; matchedAddress?: string }
  | {
      status: "needs_selection";
      needsSelection: true;
      household: HouseholdView;
      candidates: CountyCandidate[];
      reason: SelectionReason;
      outsideTexasBps: number;
    };

function normalizeAddressForStorage(address: HouseholdAddressInput): NormalizedAddress {
  const zip = normalizeZip(address.zip);
  const line1 = tidyAddressText(address.line1);
  const city = tidyAddressText(address.city);
  // resolveHouseholdCounty has already rejected incomplete, malformed and non-Texas addresses.
  if (!zip || !line1 || !city) throw invalid("Please check your address.");
  return { line1, line2: tidyAddressText(address.line2 ?? null), city, state: "TX", zip };
}

/**
 * Saves the household's address and resolves its county. The geography service decides: a Census geocoder
 * match in Texas, else a ZIP that lies wholly in one county, else the family must pick (`needs_selection`,
 * with candidates). The address is saved either way; a new address clears any earlier county so a stale
 * county is never used. Non-Texas and incomplete addresses throw validation_failed (from the geo service).
 * The geocoder is called before the database transaction, so a slow lookup never holds a lock.
 */
export async function updateAddress(householdId: string, address: HouseholdAddressInput, actor: HouseholdActor, geo: GeoServiceOptions = {}, dbOrTx?: DbOrTx): Promise<UpdateAddressResult> {
  const db = dbOrTx ?? (await getDb());
  await requirePermission(db, householdId, actor, "edit_household");
  const resolution = await resolveHouseholdCounty(address, geo);
  const addr = normalizeAddressForStorage(address);

  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    const resolved = "needsSelection" in resolution ? null : resolution;
    const [row] = await tx
      .update(schema.households)
      .set({
        addressLine1: addr.line1,
        addressLine2: addr.line2,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
        countyFips: resolved?.countyFips ?? null,
        countyName: resolved?.countyName ?? null,
        countyResolution: resolved?.resolution ?? null,
        updatedAt: now(),
      })
      .where(eq(schema.households.id, access.household.id))
      .returning();
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.address_update",
        target: { type: "household", id: row.id },
        // County-level facts only; the street address stays out of the audit log.
        metadata: resolved
          ? { outcome: "resolved", resolution: resolved.resolution, countyFips: resolved.countyFips }
          : { outcome: "needs_selection", reason: "needsSelection" in resolution ? resolution.reason : null, geocoder: "needsSelection" in resolution ? resolution.geocoder : null },
        request: actor.request,
      },
      tx,
    );
    const household = await buildView(tx, row, access.access);
    if ("needsSelection" in resolution) {
      return { status: "needs_selection", needsSelection: true, household, candidates: resolution.candidates, reason: resolution.reason, outsideTexasBps: resolution.outsideTexasBps };
    }
    return { status: "resolved", needsSelection: false, household, county: household.county!, ...(resolution.matchedAddress ? { matchedAddress: resolution.matchedAddress } : {}) };
  });
}

export interface SelectCountyResult {
  household: HouseholdView;
  county: HouseholdCountyView;
  /** True when the county is one of the ZIP's candidates; false is shown to reviewers; null when the ZIP is unknown. */
  matchesZip: boolean | null;
  zipCandidates: CountyCandidate[];
}

/**
 * Records a county the family chose themselves (resolution "self_selected"). Any Texas county is accepted, so
 * a family whose ZIP data is wrong is not stuck, but the result says whether it matches the ZIP and the
 * household view keeps saying so for reviewers. The address must be saved first.
 */
export async function selectCounty(householdId: string, fips: string, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<SelectCountyResult> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access: HouseholdAccess = await requirePermission(tx, householdId, actor, "edit_household");
    if (!access.household.zip) throw conflict("Enter your address first.");
    const confirmed = confirmSelectedCounty(fips, access.household.zip);
    const [row] = await tx
      .update(schema.households)
      .set({ countyFips: confirmed.countyFips, countyName: confirmed.countyName, countyResolution: "self_selected", updatedAt: now() })
      .where(eq(schema.households.id, access.household.id))
      .returning();
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.county_select",
        target: { type: "household", id: row.id },
        metadata: { countyFips: confirmed.countyFips, matchesZip: confirmed.matchesZip, zipCandidates: confirmed.zipCandidates.map((c) => c.fips) },
        request: actor.request,
      },
      tx,
    );
    const household = await buildView(tx, row, access.access);
    return { household, county: household.county!, matchesZip: confirmed.matchesZip, zipCandidates: confirmed.zipCandidates };
  });
}
