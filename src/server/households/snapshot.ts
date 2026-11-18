import { eq } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { MemberKind } from "@/db/schema";
import { invalid, notFound } from "@/lib/errors";
import { audit, SYSTEM_ACTOR, type AuditActor } from "@/server/audit";
import { countyOf, type HouseholdCountyView, type HouseholdLocale } from "./households";
import { decryptDob, listActiveMemberRows, toMemberView } from "./members";
import type { Relationship } from "./validation";

export interface SnapshotMember {
  id: string;
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: Relationship | null;
  isOwner: boolean;
  /** Present only when the caller asked for dates of birth with a purpose; null when none is stored. */
  dob?: string | null;
}

/** What is still missing before the household can be submitted for a decision. */
export type SnapshotGap = "owner_member" | "student" | "address" | "county";

/**
 * The plain household facts the decision engine and the evidence builder need: who is in the household
 * (family size = active members), the county and its HUD income-limit area, how the county was determined,
 * and the family's language. The street address is not included (data minimization: the county is the fact
 * the rule uses). Dates of birth are excluded unless explicitly requested with a purpose.
 */
export interface HouseholdSnapshot {
  householdId: string;
  ownerUserId: string;
  locale: HouseholdLocale;
  members: SnapshotMember[];
  studentIds: string[];
  size: number;
  county: HouseholdCountyView | null;
  missing: SnapshotGap[];
}

export interface SnapshotOptions {
  /**
   * Include decrypted dates of birth. Requires a stated purpose (e.g. "sgo_application"); the read is audited
   * with it. Without this option no date of birth is decrypted.
   */
  includeDob?: { purpose: string; actor?: AuditActor };
}

/**
 * No access check: for services and jobs that already checked access to the household or to a verification
 * that points at it. Throws not_found for an unknown household.
 */
export async function getHouseholdSnapshot(householdId: string, opts: SnapshotOptions = {}, dbOrTx?: DbOrTx): Promise<HouseholdSnapshot> {
  const db = dbOrTx ?? (await getDb());
  let purpose: string | null = null;
  if (opts.includeDob) {
    purpose = typeof opts.includeDob.purpose === "string" ? opts.includeDob.purpose.trim() : "";
    if (purpose.length === 0 || purpose.length > 120) throw invalid("A purpose is required to read dates of birth.");
  }
  const [household] = typeof householdId === "string" && householdId ? await db.select().from(schema.households).where(eq(schema.households.id, householdId)).limit(1) : [];
  if (!household) throw notFound("Household");

  const rows = await listActiveMemberRows(db, household.id);
  const members: SnapshotMember[] = rows.map((row) => {
    const v = toMemberView(row);
    const m: SnapshotMember = { id: v.id, kind: v.kind, firstName: v.firstName, lastName: v.lastName, relationship: v.relationship, isOwner: v.isOwner };
    if (purpose) m.dob = row.dobEnc ? decryptDob(row.dobEnc) : null;
    return m;
  });
  if (purpose) {
    await audit(
      {
        actor: opts.includeDob?.actor ?? SYSTEM_ACTOR,
        action: "household.dob_read",
        target: { type: "household", id: household.id },
        metadata: { purpose, memberIds: rows.filter((r) => r.dobEnc).map((r) => r.id) },
      },
      db,
    );
  }

  const county = countyOf(household);
  const studentIds = members.filter((m) => m.kind === "student").map((m) => m.id);
  const missing: SnapshotGap[] = [];
  if (!members.some((m) => m.isOwner)) missing.push("owner_member");
  if (studentIds.length === 0) missing.push("student");
  if (!household.zip) missing.push("address");
  if (!county) missing.push("county");

  return { householdId: household.id, ownerUserId: household.ownerUserId, locale: household.locale, members, studentIds, size: members.length, county, missing };
}
