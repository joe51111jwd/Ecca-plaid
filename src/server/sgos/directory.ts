import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { SgoListSource } from "@/db/schema";
import { now } from "@/lib/clock";
import { invalid } from "@/lib/errors";
import type { SgoProfile } from "./access";
import { nameKey, normalizeEin } from "./identity";
import { describeListing, isGiftableStatus, type ListStatus } from "./list-status";
import { getActiveListSource, resolveEntries } from "./listing";
import { normalizeStateCode } from "./states";

/**
 * The donor-facing directory. Only organizations a gift could be taken for right now are found: an active SGO
 * organization, accepting donations, linked by a platform admin to an entry of the ACTIVE list source that is in
 * effect and not removed. Nothing about unlisted, pending, suspended or removed organizations is enumerable here.
 */

export const DIRECTORY_LIMITS = { defaultLimit: 20, maxLimit: 50, maxQueryLength: 100 } as const;

const searchSchema = z.strictObject({
  query: z.string().max(DIRECTORY_LIMITS.maxQueryLength, `Search for at most ${DIRECTORY_LIMITS.maxQueryLength} characters.`).default(""),
  state: z.string().optional().nullable(),
  limit: z.number().int().min(1).max(DIRECTORY_LIMITS.maxLimit).default(DIRECTORY_LIMITS.defaultLimit),
});

export type SearchSgosInput = z.input<typeof searchSchema>;

export interface PublicSgo {
  orgId: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  ein: string | null;
  description: string | null;
  city: string | null;
  state: string;
  website: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  list: {
    status: ListStatus;
    source: SgoListSource;
    label: string;
    /**
     * The name and EIN exactly as the list entry carries them. `displayName` is the SGO's own choice; show this next
     * to it so a donor can check the organization against the list they rely on.
     */
    listedName: string;
    listedEin: string | null;
    listedFrom: string | null;
    removedOn: string | null;
  };
}

function toPublic(org: { id: string; slug: string }, profile: SgoProfile, list: PublicSgo["list"]): PublicSgo {
  return {
    orgId: org.id,
    slug: org.slug,
    displayName: profile.displayName,
    legalName: profile.legalName,
    ein: profile.ein,
    description: profile.description,
    city: profile.city,
    state: profile.state,
    website: profile.website,
    logoUrl: profile.logoUrl,
    supportEmail: profile.supportEmail,
    list,
  };
}

async function candidates(db: DbOrTx, filter: { state?: string; slug?: string }) {
  const o = schema.organizations;
  const p = schema.sgoProfiles;
  const where = [eq(o.type, "sgo"), eq(o.status, "active"), eq(p.acceptsDonations, true), isNotNull(p.listEntryId)];
  if (filter.state) where.push(eq(p.state, filter.state));
  if (filter.slug) where.push(eq(o.slug, filter.slug));
  return db
    .select({ org: { id: o.id, slug: o.slug }, profile: p })
    .from(p)
    .innerJoin(o, eq(o.id, p.orgId))
    .where(and(...where));
}

/**
 * Case- and diacritic-insensitive search over display name, legal name and listed name; a query that is an EIN
 * matches that EIN exactly. An empty query lists every directory-visible SGO (optionally in one State). Results:
 * names starting with the query first, then alphabetical.
 */
export async function searchSgos(input: SearchSgosInput, dbOrTx?: DbOrTx): Promise<PublicSgo[]> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "query"] ??= issue.message;
    throw invalid("Check the search.", { fields });
  }
  const { query, limit } = parsed.data;
  let state: string | undefined;
  if (parsed.data.state) {
    const code = normalizeStateCode(parsed.data.state);
    if (!code) throw invalid("Choose a US State.", { fields: { state: "Choose a US State." } });
    state = code;
  }

  const q = nameKey(query);
  const qEin = normalizeEin(query);
  // Typed text with nothing searchable in it ("%", "--") finds nothing rather than everything.
  if (query.trim() !== "" && q === "" && !qEin) return [];

  const db = dbOrTx ?? (await getDb());
  const source = await getActiveListSource(db);
  const rows = await candidates(db, { state });
  const entries = await resolveEntries(db, rows.map((r) => r.profile), source);
  const at = now();

  const hits: Array<{ sgo: PublicSgo; key: string; prefix: boolean }> = [];
  for (const r of rows) {
    const entry = entries.get(r.profile) ?? null;
    const listing = describeListing(entry, source, at);
    if (!entry || !isGiftableStatus(listing.status)) continue;
    const keys = [r.profile.displayName, r.profile.legalName, entry.name].filter((v): v is string => Boolean(v)).map(nameKey);
    const matches = qEin ? r.profile.ein === qEin || entry.ein === qEin : q === "" || keys.some((k) => k.includes(q));
    if (!matches) continue;
    const list = { status: listing.status, source, label: listing.label, listedName: entry.name, listedEin: entry.ein, listedFrom: listing.listedFrom, removedOn: listing.removedOn };
    hits.push({ sgo: toPublic(r.org, r.profile, list), key: keys[0], prefix: q !== "" && keys.some((k) => k.startsWith(q)) });
  }
  hits.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.key.localeCompare(b.key) || a.sgo.orgId.localeCompare(b.sgo.orgId));
  return hits.slice(0, limit).map((h) => h.sgo);
}

/**
 * The public page of one SGO by its slug, or null. Returned while the SGO is listed and also once it has been
 * removed (the removal is public on the list itself, and a donor following an old link must see why a gift
 * cannot be taken). Null for anything else: unknown slug, not an SGO, not active, not accepting donations, never
 * linked to the active list, or listed only from a future date.
 */
export async function getPublicSgo(slug: string, dbOrTx?: DbOrTx): Promise<PublicSgo | null> {
  if (typeof slug !== "string") return null;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,100}$/.test(clean)) return null;
  const db = dbOrTx ?? (await getDb());
  const [row] = await candidates(db, { slug: clean });
  if (!row) return null;
  const source = await getActiveListSource(db);
  const entry = (await resolveEntries(db, [row.profile], source)).get(row.profile) ?? null;
  const listing = describeListing(entry, source, now());
  if (!entry || (!isGiftableStatus(listing.status) && listing.status !== "removed")) return null;
  return toPublic(row.org, row.profile, {
    status: listing.status,
    source,
    label: listing.label,
    listedName: entry.name,
    listedEin: entry.ein,
    listedFrom: listing.listedFrom,
    removedOn: listing.removedOn,
  });
}
