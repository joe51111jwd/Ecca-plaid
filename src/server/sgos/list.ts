import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { SgoListEntryStatus, SgoListSource } from "@/db/schema";
import { now } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { AppError, badRequest, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { auditContextOf, authorize, loadSgo, systemActor, type SgoActor, type SgoProfile } from "./access";
import { inProduction, isSandboxEin, listMatchKey, nameKey } from "./identity";
import { LIST_CSV_LIMITS, parseSgoListCsv, type ListCsvError, type ParsedListRow } from "./list-csv";
import { describeListing, isGiftableStatus, type ListEntry, type ListStatusResult } from "./list-status";
import { getActiveListSource, resolveEntry } from "./listing";
import { normalizeStateCode, type UsStateCode } from "./states";

const LIST_SOURCES = ["provisional_curated", "irs_published"] as const satisfies readonly SgoListSource[];

/** How far in the future a stated retrieval time may be (clock skew between the admin's machine and ours). */
const RETRIEVED_AT_MAX_SKEW_MS = 5 * 60_000;

/**
 * POLICY: an entry the source list used to carry but the new file leaves out is reported (`notInFile`) and left
 * as it is. The IRS says removed SGOs stay on its list with their removal date (acknowledgment-reporting.md, F66),
 * so absence is an anomaly for a person to look at, not a removal: only an explicit "removed" row with its
 * effective date removes an organization.
 */
export const ABSENT_ENTRY_POLICY = "report_only" as const;

/** Ids listed per category in the import report (counts are always complete). */
const REPORT_ID_LIMIT = 200;

const importInputSchema = z.strictObject({
  source: z.enum(LIST_SOURCES),
  csv: z.string(),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" || u.protocol === "http:";
      } catch {
        return false;
      }
    }, "Enter the http(s) address the list was downloaded from.")
    .optional()
    .nullable(),
  retrievedAt: z.coerce.date(),
});

export type ImportSgoListInput = z.input<typeof importInputSchema>;

export interface ImportSgoListReport {
  source: SgoListSource;
  /** SHA-256 of the file as uploaded, recorded on the audit entry. */
  sha256: string;
  rowCount: number;
  added: number;
  /** Changed rows that did not become removed (name, EIN, dates, reinstatement). */
  updated: number;
  /** Existing entries whose removal this file introduced or whose removal date it changed. */
  removed: number;
  unchanged: number;
  /** Entries of this source, in the States the file covers, that the file does not mention (left unchanged). */
  notInFile: number;
  ids: { added: string[]; updated: string[]; removed: string[]; notInFile: string[] };
}

function sameData(e: ListEntry, r: ParsedListRow): boolean {
  return e.name === r.name && e.ein === r.ein && e.status === r.status && e.listedFrom === r.listedFrom && e.removedOn === r.removedOn;
}

function fileErrors(errors: ListCsvError[]): AppError {
  const shown = errors.slice(0, LIST_CSV_LIMITS.maxErrorsReported);
  const more = errors.length - shown.length;
  return invalid(`The list file has ${errors.length} problem${errors.length === 1 ? "" : "s"}; nothing was imported.`, { errors: shown, ...(more > 0 ? { moreErrors: more } : {}) });
}

/**
 * Imports a list file (contract: ./list-csv.ts) all-or-nothing, in one transaction. Idempotent: rows are upserted
 * on (source, state, EIN — or normalized name when the row has no EIN), and re-importing the same file changes
 * nothing but the "retrieved at" confirmation time. A row that gains an EIN takes over the name-keyed entry it
 * used to be. Platform admins (or system code) only. Audited as "sgo_list.import", plus "sgo_list.entry_removed"
 * on each SGO whose linked entry this import removes.
 */
export async function importSgoList(input: ImportSgoListInput, actor: SgoActor, dbOrTx?: DbOrTx): Promise<ImportSgoListReport> {
  const parsedInput = importInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsedInput.error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
    throw invalid("Check the list import details.", { fields });
  }
  const { source, csv, sourceUrl, retrievedAt } = parsedInput.data;
  const at = now();
  if (Number.isNaN(retrievedAt.getTime())) throw invalid("Enter when the list was retrieved.", { fields: { retrievedAt: "Enter a valid date and time." } });
  if (retrievedAt.getTime() > at.getTime() + RETRIEVED_AT_MAX_SKEW_MS) {
    throw invalid("The retrieval time is in the future.", { fields: { retrievedAt: "The retrieval time is in the future." } });
  }

  const db = dbOrTx ?? (await getDb());
  await authorize(db, actor, "platform");

  const parsed = parseSgoListCsv(csv, source);
  if (parsed.errors.length > 0) throw fileErrors(parsed.errors);
  if (parsed.rows.length === 0) throw invalid("The list file has no rows; nothing was imported.", { errors: [{ line: 0, message: "No data rows." }] });
  if (inProduction()) {
    const sandbox = parsed.rows.filter((r) => r.ein && isSandboxEin(r.ein));
    if (sandbox.length > 0) {
      throw fileErrors(sandbox.map((r) => ({ line: r.line, message: `ein ${r.ein} is a sandbox EIN and cannot be imported in production.` })));
    }
  }

  const sha256 = sha256Hex(csv);
  const ctx = auditContextOf(actor);

  return db.transaction(async (tx) => {
    const t = schema.sgoListEntries;
    const states = [...new Set(parsed.rows.map((r) => r.state))];
    // Row locks serialize concurrent imports of the same source and States.
    const existing = await tx
      .select()
      .from(t)
      .where(and(eq(t.source, source), inArray(t.state, states)))
      .for("update");
    const byKey = new Map(existing.map((e) => [`${e.state}|${e.matchKey}`, e]));
    const touched = new Set<string>();
    const report: ImportSgoListReport = {
      source,
      sha256,
      rowCount: parsed.rows.length,
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      notInFile: 0,
      ids: { added: [], updated: [], removed: [], notInFile: [] },
    };
    const push = (list: string[], id: string) => {
      if (list.length < REPORT_ID_LIMIT) list.push(id);
    };
    const removedEntryIds: Array<{ id: string; removedOn: string | null }> = [];

    for (const row of parsed.rows) {
      const key = listMatchKey(row.ein, row.name);
      let current = byKey.get(`${row.state}|${key}`);
      // Already claimed by an earlier row of this file that upgraded it from its name key: this row is a new entry.
      if (current && touched.has(current.id)) current = undefined;
      if (!current && row.ein) {
        // A row that now carries an EIN replaces the entry that was keyed by its name, if that entry had no EIN.
        const byName = byKey.get(`${row.state}|${listMatchKey(null, row.name)}`);
        if (byName && !byName.ein && !touched.has(byName.id)) current = byName;
      }
      const values = {
        name: row.name,
        ein: row.ein,
        matchKey: key,
        status: row.status,
        listedFrom: row.listedFrom,
        removedOn: row.removedOn,
        sourceUrl: sourceUrl ?? null,
        sourceRetrievedAt: retrievedAt,
        raw: { line: row.line, ...row.raw },
        updatedAt: at,
      };

      if (!current) {
        const [inserted] = await tx
          .insert(t)
          .values({ id: newId("listEntry"), source, state: row.state, importedAt: at, ...values })
          .returning({ id: t.id });
        touched.add(inserted.id);
        report.added++;
        push(report.ids.added, inserted.id);
        continue;
      }

      touched.add(current.id);
      const unchanged = sameData(current, row) && current.matchKey === key;
      await tx.update(t).set(unchanged ? { sourceUrl: values.sourceUrl, sourceRetrievedAt: retrievedAt, updatedAt: at } : values).where(eq(t.id, current.id));
      if (unchanged) {
        report.unchanged++;
      } else if (row.status === "removed" && (current.status !== "removed" || current.removedOn !== row.removedOn)) {
        report.removed++;
        push(report.ids.removed, current.id);
        removedEntryIds.push({ id: current.id, removedOn: row.removedOn });
      } else {
        report.updated++;
        push(report.ids.updated, current.id);
      }
    }

    for (const e of existing) {
      if (!touched.has(e.id)) {
        report.notInFile++;
        push(report.ids.notInFile, e.id);
      }
    }

    await audit(
      {
        actor: ctx.actor,
        action: "sgo_list.import",
        target: { type: "sgo_list", id: source },
        metadata: {
          source,
          sourceUrl: sourceUrl ?? null,
          retrievedAt: retrievedAt.toISOString(),
          sha256,
          rowCount: report.rowCount,
          added: report.added,
          updated: report.updated,
          removed: report.removed,
          unchanged: report.unchanged,
          notInFile: report.notInFile,
          absentEntryPolicy: ABSENT_ENTRY_POLICY,
          ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}),
        },
        request: ctx.request,
      },
      tx,
    );

    if (removedEntryIds.length > 0) {
      const affected = await tx
        .select({ orgId: schema.sgoProfiles.orgId, listEntryId: schema.sgoProfiles.listEntryId })
        .from(schema.sgoProfiles)
        .where(inArray(schema.sgoProfiles.listEntryId, removedEntryIds.map((r) => r.id)));
      for (const a of affected) {
        const removal = removedEntryIds.find((r) => r.id === a.listEntryId);
        await audit(
          { actor: ctx.actor, orgId: a.orgId, action: "sgo_list.entry_removed", target: { type: "sgo_list_entry", id: a.listEntryId! }, metadata: { source, removedOn: removal?.removedOn ?? null, sha256 }, request: ctx.request },
          tx,
        );
      }
    }
    return report;
  });
}


/** Repository path of the sandbox-only demo list (fictional organizations, never-issued EINs). */
export const SANDBOX_PROVISIONAL_LIST_PATH = join("data", "sgo-list", "provisional-sandbox.csv");

/**
 * Seeds the provisional list from data/sgo-list/provisional-sandbox.csv. Refused in production: the file lists
 * fictional demo organizations only.
 */
export async function importSandboxProvisionalList(actor: SgoActor = systemActor("seed"), dbOrTx?: DbOrTx, opts: { cwd?: string } = {}): Promise<ImportSgoListReport> {
  if (inProduction()) throw forbidden("The sandbox SGO list cannot be imported in production");
  const csv = await readFile(join(opts.cwd ?? process.cwd(), SANDBOX_PROVISIONAL_LIST_PATH), "utf8");
  return importSgoList({ source: "provisional_curated", csv, sourceUrl: null, retrievedAt: now() }, actor, dbOrTx);
}

/* ------------------------------------------------------------------------------------------ links */

/**
 * Links an SGO to the list entry a platform admin verified it against (or unlinks it with `entryId: null`). The
 * entry must be in the SGO's State; when both carry an EIN they must match; an entry represents one SGO only.
 * A profile without an EIN adopts the entry's. Audited as "sgo_list.link" / "sgo_list.unlink".
 */
export async function linkProfileToListEntry(orgId: string, entryId: string | null, actor: SgoActor, dbOrTx?: DbOrTx): Promise<SgoProfile> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    await authorize(tx, actor, "platform");
    const { profile } = await loadSgo(tx, orgId, { forUpdate: true });
    const ctx = auditContextOf(actor);
    const p = schema.sgoProfiles;

    if (entryId === null) {
      if (!profile.listEntryId) return profile;
      const [updated] = await tx.update(p).set({ listEntryId: null, updatedAt: now() }).where(eq(p.orgId, orgId)).returning();
      await audit({ actor: ctx.actor, orgId, action: "sgo_list.unlink", target: { type: "sgo_list_entry", id: profile.listEntryId }, metadata: ctx.systemReason ? { systemReason: ctx.systemReason } : null, request: ctx.request }, tx);
      return updated;
    }

    if (typeof entryId !== "string" || entryId.length === 0) throw notFound("List entry");
    const [entry] = await tx.select().from(schema.sgoListEntries).where(eq(schema.sgoListEntries.id, entryId)).limit(1);
    if (!entry) throw notFound("List entry");
    if (entry.state !== profile.state) {
      throw conflict(`That list entry is on the ${entry.state} list, but the organization is in ${profile.state}.`, { fields: { entryId: "The entry is for a different State." } });
    }
    if (entry.ein && profile.ein && entry.ein !== profile.ein) {
      throw conflict(`The list entry's EIN (${entry.ein}) does not match the organization's EIN (${profile.ein}).`, { fields: { entryId: "EIN mismatch." } });
    }
    const [claimed] = await tx
      .select({ orgId: p.orgId })
      .from(p)
      .where(and(eq(p.listEntryId, entry.id), ne(p.orgId, orgId)))
      .limit(1);
    if (claimed) throw conflict("That list entry is already linked to another organization.", { fields: { entryId: "Already linked to another organization." } });

    const adoptEin = !profile.ein && entry.ein ? entry.ein : null;
    if (adoptEin) {
      const [holder] = await tx.select({ orgId: p.orgId }).from(p).where(and(eq(p.ein, adoptEin), ne(p.orgId, orgId))).limit(1);
      if (holder) throw conflict(`Another organization already uses EIN ${adoptEin}.`, { fields: { entryId: "EIN in use by another organization." } });
    }
    if (profile.listEntryId === entry.id && !adoptEin) return profile;

    const [updated] = await tx
      .update(p)
      .set({ listEntryId: entry.id, ...(adoptEin ? { ein: adoptEin } : {}), updatedAt: now() })
      .where(eq(p.orgId, orgId))
      .returning();
    await audit(
      {
        actor: ctx.actor,
        orgId,
        action: "sgo_list.link",
        target: { type: "sgo_list_entry", id: entry.id },
        metadata: { source: entry.source, state: entry.state, entryEin: entry.ein, previousEntryId: profile.listEntryId, einAdopted: adoptEin, ...(ctx.systemReason ? { systemReason: ctx.systemReason } : {}) },
        request: ctx.request,
      },
      tx,
    );
    return updated;
  });
}

/* ----------------------------------------------------------------------------------------- status */

/**
 * The SGO's standing on the active list at instant `at` (default now). Org-scoped read: callers have already
 * guarded access (any member, or a public page for directory-visible SGOs).
 */
export async function getListStatus(orgId: string, at: Date = now(), dbOrTx?: DbOrTx): Promise<ListStatusResult> {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw badRequest("A valid date is required");
  const db = dbOrTx ?? (await getDb());
  const { profile } = await loadSgo(db, orgId);
  const source = await getActiveListSource(db);
  return describeListing(await resolveEntry(db, profile, source), source, at);
}

/**
 * What a donation stores as the donor's reliance evidence: the list entry the gift was checked against, as it
 * stood at the moment of the check (docs/reference/acknowledgment-reporting.md, E5.4 and F67). Dates are ISO
 * strings so the snapshot can be stored as JSON unchanged.
 */
export interface GiftListSnapshot {
  entryId: string;
  source: SgoListSource;
  status: "irs_listed" | "provisional";
  /** The exact label the donor was shown. */
  label: string;
  /** When the list file that last confirmed this entry was retrieved from its source (ISO 8601). */
  retrievedAt: string;
  name: string;
  ein: string | null;
  state: UsStateCode;
  listedFrom: string | null;
  removedOn: string | null;
  /** The instant the check was made for (ISO 8601). */
  checkedAt: string;
}

export type GiftRefusalReason = "sgo_inactive" | "sgo_not_accepting" | "sgo_removed" | "sgo_unlisted" | "sgo_not_yet_listed";

/**
 * Throws unless a gift to this SGO may be taken at instant `at`; otherwise returns the list snapshot to store with
 * the gift. Refusals are AppError `conflict` with `details.reason` (a GiftRefusalReason) and a message that can be
 * shown to the donor. A removal takes effect on its effective date in the listing State's calendar: a gift on or
 * after that day is refused. Callers must check at payment time, not only when the checkout page loads.
 */
export async function assertGiftAllowed(orgId: string, at: Date, dbOrTx?: DbOrTx): Promise<GiftListSnapshot> {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw badRequest("A valid date is required");
  const db = dbOrTx ?? (await getDb());
  const { org, profile } = await loadSgo(db, orgId);
  const refuse = (reason: GiftRefusalReason, message: string) => new AppError("conflict", message, { reason });

  if (org.status !== "active") throw refuse("sgo_inactive", "This organization is not accepting gifts right now.");
  if (!profile.acceptsDonations) throw refuse("sgo_not_accepting", "This organization is not accepting gifts right now.");

  const source = await getActiveListSource(db);
  const entry = await resolveEntry(db, profile, source);
  const result = describeListing(entry, source, at);
  if (!entry || !isGiftableStatus(result.status)) {
    const reason: GiftRefusalReason = result.status === "removed" ? "sgo_removed" : result.entryId ? "sgo_not_yet_listed" : "sgo_unlisted";
    throw refuse(reason, `${result.label}. A gift to this organization cannot be accepted.`);
  }
  const state = normalizeStateCode(entry.state);
  if (!state) throw new AppError("internal", "The list entry has an invalid State");
  return {
    entryId: entry.id,
    source,
    status: result.status,
    label: result.label,
    retrievedAt: (entry.sourceRetrievedAt ?? entry.importedAt).toISOString(),
    name: entry.name,
    ein: entry.ein,
    state,
    listedFrom: entry.listedFrom,
    removedOn: entry.removedOn,
    checkedAt: at.toISOString(),
  };
}

/* ------------------------------------------------------------------------------------ admin views */

export interface ListEntryWithLink extends ListEntry {
  /** The SGO linked to this entry, if any. */
  linkedOrgId: string | null;
}

/** Entries of the list for the platform-admin screen, ordered by State and name. Platform admins only. */
export async function listSgoListEntries(
  filter: { source?: SgoListSource; state?: string; status?: SgoListEntryStatus; query?: string; limit?: number },
  actor: SgoActor,
  dbOrTx?: DbOrTx,
): Promise<ListEntryWithLink[]> {
  const db = dbOrTx ?? (await getDb());
  await authorize(db, actor, "platform");
  const limit = filter.limit ?? 200;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw badRequest("limit must be an integer between 1 and 1000");
  const t = schema.sgoListEntries;
  const where: SQL[] = [];
  if (filter.source !== undefined) {
    if (!(LIST_SOURCES as readonly string[]).includes(filter.source)) throw badRequest("Unknown list source");
    where.push(eq(t.source, filter.source));
  }
  if (filter.state !== undefined) {
    const state = normalizeStateCode(filter.state);
    if (!state) throw badRequest("Unknown State");
    where.push(eq(t.state, state));
  }
  if (filter.status !== undefined) {
    if (filter.status !== "listed" && filter.status !== "removed") throw badRequest("Unknown list status");
    where.push(eq(t.status, filter.status));
  }
  const rows = await db
    .select({ entry: t, linkedOrgId: schema.sgoProfiles.orgId })
    .from(t)
    .leftJoin(schema.sgoProfiles, eq(schema.sgoProfiles.listEntryId, t.id))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(t.state), asc(t.name), asc(t.id));
  const q = filter.query ? nameKey(filter.query) : "";
  return rows
    .filter((r) => q === "" || nameKey(r.entry.name).includes(q) || (r.entry.ein ?? "").includes(filter.query!.trim()))
    .slice(0, limit)
    .map((r) => ({ ...r.entry, linkedOrgId: r.linkedOrgId }));
}
