import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { VerificationRow } from "./internal";

/**
 * How a verification is named in the SGO's lists: the applicant name the SGO gave; else the name the family entered
 * for themselves (the household's owner); else, for a camp handoff, the camp and its booking reference; else the
 * family's email. Returns a label for every row given (keyed by verification id). Rows must belong to `orgId`.
 */
export type LabelledRow = Pick<VerificationRow, "id" | "orgId" | "applicantName" | "applicantEmail" | "householdId" | "handoffId">;

export async function applicantLabels(orgId: string, rows: readonly LabelledRow[], dbOrTx?: DbOrTx): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const unnamed = rows.filter((r) => r.orgId === orgId && !r.applicantName);
  if (unnamed.length > 0) {
    const db = dbOrTx ?? (await getDb());
    const householdIds = [...new Set(unnamed.map((r) => r.householdId).filter((id): id is string => id !== null))];
    const handoffIds = [...new Set(unnamed.map((r) => r.handoffId).filter((id): id is string => id !== null))];
    const m = schema.householdMembers;
    const owners = householdIds.length
      ? await db
          .select({ householdId: m.householdId, firstName: m.firstName, lastName: m.lastName })
          .from(m)
          .where(and(inArray(m.householdId, householdIds), eq(m.isOwner, true), isNull(m.removedAt)))
      : [];
    const h = schema.handoffs;
    const o = schema.organizations;
    const handoffs = handoffIds.length
      ? await db
          .select({ id: h.id, bookingRef: h.bookingRef, campName: o.name })
          .from(h)
          .innerJoin(o, eq(o.id, h.businessOrgId))
          .where(and(inArray(h.id, handoffIds), eq(h.sgoOrgId, orgId)))
      : [];
    const ownerName = new Map(owners.map((w) => [w.householdId, `${w.firstName} ${w.lastName}`.trim()]));
    const handoffName = new Map(handoffs.map((x) => [x.id, `${x.campName} · ${x.bookingRef}`]));
    for (const r of unnamed) {
      const name = (r.householdId ? ownerName.get(r.householdId) : undefined) || (r.handoffId ? handoffName.get(r.handoffId) : undefined) || r.applicantEmail;
      if (name) labels[r.id] = name;
    }
  }
  for (const r of rows) labels[r.id] ??= r.applicantName ?? "No name given";
  return labels;
}
