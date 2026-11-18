import { and, eq, inArray, or } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { SgoListSource } from "@/db/schema";
import { getSetting } from "@/server/settings";
import type { SgoProfile } from "./access";
import { chooseEntry, type ListEntry, type ProfileListingRef } from "./list-status";

/** The list donors are checked against: the `sgoList.source` platform setting. */
export async function getActiveListSource(db: DbOrTx): Promise<SgoListSource> {
  return getSetting("sgoList.source", db);
}

/**
 * Resolves the active-list entry for many profiles with two queries (linked entries, then active-list entries
 * with the verified EINs). See `chooseEntry` for the rules.
 */
export async function resolveEntries(db: DbOrTx, profiles: readonly ProfileListingRef[], source: SgoListSource): Promise<Map<ProfileListingRef, ListEntry | null>> {
  const out = new Map<ProfileListingRef, ListEntry | null>();
  const linkedIds = [...new Set(profiles.map((p) => p.listEntryId).filter((id): id is string => Boolean(id)))];
  const linked = linkedIds.length > 0 ? await db.select().from(schema.sgoListEntries).where(inArray(schema.sgoListEntries.id, linkedIds)) : [];
  const linkedById = new Map(linked.map((e) => [e.id, e]));

  const carryOver = profiles
    .map((p) => {
      const l = p.listEntryId ? linkedById.get(p.listEntryId) : undefined;
      return l && l.source !== source && l.ein && l.ein === p.ein ? { ein: l.ein, state: p.state } : null;
    })
    .filter((x): x is { ein: string; state: string } => x !== null);

  const t = schema.sgoListEntries;
  const candidates =
    carryOver.length > 0
      ? await db
          .select()
          .from(t)
          .where(and(eq(t.source, source), or(...carryOver.map((c) => and(eq(t.ein, c.ein), eq(t.state, c.state))))))
      : [];

  for (const p of profiles) {
    const l = p.listEntryId ? (linkedById.get(p.listEntryId) ?? null) : null;
    out.set(p, chooseEntry(p, l, candidates, source));
  }
  return out;
}

export async function resolveEntry(db: DbOrTx, profile: SgoProfile, source: SgoListSource): Promise<ListEntry | null> {
  return (await resolveEntries(db, [profile], source)).get(profile) ?? null;
}
