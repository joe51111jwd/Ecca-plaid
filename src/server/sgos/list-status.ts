import type { SgoListSource, sgoListEntries } from "@/db/schema";
import { formatLongDate } from "./identity";
import { normalizeStateCode, stateDateString, type UsStateCode } from "./states";

/**
 * What the list says about one organization at one instant. Pure: the services load the entry and the active
 * source, this decides and words it.
 */

export type ListEntry = typeof sgoListEntries.$inferSelect;

/**
 * - irs_listed:  on the IRS SGO list (the active source is the IRS list) and not removed at that instant.
 * - provisional: on the provisional curated list (the IRS list is not the active source yet) and not removed.
 * - removed:     on the active list, but its removal had taken effect.
 * - unlisted:    no entry on the active list, or the listing had not started yet.
 */
export type ListStatus = "irs_listed" | "provisional" | "removed" | "unlisted";

export interface ListStatusResult {
  status: ListStatus;
  /** The active list source (the `sgoList.source` platform setting), whatever the status. */
  source: SgoListSource;
  entryId: string | null;
  listedFrom: string | null;
  removedOn: string | null;
  /** The exact words to show. Never a claim that a gift is credit-eligible. */
  label: string;
}

/**
 * User-facing wording. The SGO list is labeled provisional until the IRS list is the source (docs/architecture.md,
 * copy rules); a listing is never presented as a promise that a gift earns the credit.
 */
export const LIST_STATUS_COPY = {
  provisional: "On the provisional list — the IRS SGO list has not been published",
  irsListed: (asOf: string) => `On the IRS SGO list as of ${asOf}`,
  removed: (source: SgoListSource, effective: string) =>
    `Removed from the ${source === "irs_published" ? "IRS SGO list" : "provisional list"} effective ${effective} — gifts can no longer be accepted`,
  notYet: (source: SgoListSource, from: string) =>
    `On the ${source === "irs_published" ? "IRS SGO list" : "provisional list"} from ${from} — not in effect yet`,
  unlisted: (source: SgoListSource) => (source === "irs_published" ? "Not on the IRS SGO list" : "Not on the provisional list"),
} as const;

/** True when gifts may be taken under this status. */
export function isGiftableStatus(status: ListStatus): status is "irs_listed" | "provisional" {
  return status === "irs_listed" || status === "provisional";
}

function entryState(entry: ListEntry): UsStateCode {
  const state = normalizeStateCode(entry.state);
  // Entries are only written by the importer, which validates the code; a bad row is a data error, not a status.
  if (!state) throw new Error(`SGO list entry ${entry.id} has an invalid state "${entry.state}"`);
  return state;
}

/**
 * Status of `entry` (already chosen from the active source, or null) at instant `at`. Dates on the list are
 * calendar dates in the listing State's reference zone (./states): a removal effective March 15 refuses a gift
 * made at 00:30 Central on March 15 even though it is still March 14 in Pacific time.
 */
export function describeListing(entry: ListEntry | null, activeSource: SgoListSource, at: Date): ListStatusResult {
  if (!entry || entry.source !== activeSource) {
    return { status: "unlisted", source: activeSource, entryId: null, listedFrom: null, removedOn: null, label: LIST_STATUS_COPY.unlisted(activeSource) };
  }
  const state = entryState(entry);
  const today = stateDateString(at, state);
  const base = { source: activeSource, entryId: entry.id, listedFrom: entry.listedFrom, removedOn: entry.removedOn };

  if (entry.listedFrom && today < entry.listedFrom) {
    return { ...base, status: "unlisted", label: LIST_STATUS_COPY.notYet(activeSource, formatLongDate(entry.listedFrom)) };
  }
  if (entry.status === "removed" && entry.removedOn && today >= entry.removedOn) {
    return { ...base, status: "removed", label: LIST_STATUS_COPY.removed(activeSource, formatLongDate(entry.removedOn)) };
  }
  if (activeSource === "irs_published") {
    const asOf = stateDateString(entry.sourceRetrievedAt ?? entry.importedAt, state);
    return { ...base, status: "irs_listed", label: LIST_STATUS_COPY.irsListed(formatLongDate(asOf)) };
  }
  return { ...base, status: "provisional", label: LIST_STATUS_COPY.provisional };
}

/** The profile fields that decide which entry represents an organization. */
export interface ProfileListingRef {
  ein: string | null;
  state: string;
  listEntryId: string | null;
}

/**
 * Chooses the entry that represents a profile on the active list:
 *  1. the entry a platform admin linked, when it is on the active list, in the profile's State, and its EIN (if
 *     any) is the profile's;
 *  2. otherwise, when the linked entry carries the profile's EIN (so the EIN was verified when it was linked), the
 *     active list's entry with that EIN in the profile's State. This is how a provisional link carries over to
 *     the IRS list without a second manual step.
 * A profile that was never linked is never matched: typing a listed organization's EIN does not make an
 * organization listed.
 */
export function chooseEntry(profile: ProfileListingRef, linked: ListEntry | null, activeCandidates: readonly ListEntry[], activeSource: SgoListSource): ListEntry | null {
  if (!profile.listEntryId || !linked || linked.id !== profile.listEntryId) return null;
  const einCompatible = !linked.ein || !profile.ein || linked.ein === profile.ein;
  if (!einCompatible) return null;
  if (linked.source === activeSource && linked.state === profile.state) return linked;
  const verifiedEin = linked.ein && linked.ein === profile.ein ? linked.ein : null;
  if (!verifiedEin) return null;
  return activeCandidates.find((e) => e.source === activeSource && e.state === profile.state && e.ein === verifiedEin) ?? null;
}
