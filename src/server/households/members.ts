import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { MemberKind } from "@/db/schema";
import { centralDateString, now } from "@/lib/clock";
import { decryptField, encryptField } from "@/lib/crypto";
import { conflict, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { requirePermission, type HouseholdActor } from "./access";
import { parseMemberInput, parseMemberPatch, RELATIONSHIPS, type MemberInput, type MemberPatch, type Relationship } from "./validation";

export type HouseholdMemberRow = typeof schema.householdMembers.$inferSelect;
export type Household = typeof schema.households.$inferSelect;

/** Policy (sources are silent): most people one household may list. A guard against runaway input. */
export const MAX_HOUSEHOLD_MEMBERS = 20;
/** Purpose string for field encryption of dates of birth (documented on household_members.dob_enc). */
export const DOB_ENCRYPTION_PURPOSE = "dob";

/** A member as shown to the family and to other services. The date of birth is never part of it. */
export interface HouseholdMemberView {
  id: string;
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: Relationship | null;
  /** The household owner's own row (exactly one once the owner has entered their name). */
  isOwner: boolean;
  /** This adult has their own sign-in linked to the row. */
  hasSignIn: boolean;
  /** A date of birth is stored (encrypted). Read it with readMemberDob or the snapshot's includeDob. */
  hasDob: boolean;
  createdAt: Date;
}

function isRelationship(value: string | null): value is Relationship {
  return value !== null && (RELATIONSHIPS as readonly string[]).includes(value);
}

export function toMemberView(row: HouseholdMemberRow): HouseholdMemberView {
  return {
    id: row.id,
    kind: row.kind,
    firstName: row.firstName,
    lastName: row.lastName,
    relationship: isRelationship(row.relationship) ? row.relationship : null,
    isOwner: row.isOwner,
    hasSignIn: row.userId !== null,
    hasDob: row.dobEnc !== null,
    createdAt: row.createdAt,
  };
}

export function encryptDob(dob: string): string {
  return encryptField(dob, DOB_ENCRYPTION_PURPOSE);
}

export function decryptDob(dobEnc: string): string {
  return decryptField(dobEnc, DOB_ENCRYPTION_PURPOSE);
}

/** Active members (not removed), owner first, then in the order they were added. */
export async function listActiveMemberRows(db: DbOrTx, householdId: string): Promise<HouseholdMemberRow[]> {
  const hm = schema.householdMembers;
  return db
    .select()
    .from(hm)
    .where(and(eq(hm.householdId, householdId), isNull(hm.removedAt)))
    .orderBy(sql`${hm.isOwner} desc`, asc(hm.createdAt), asc(hm.id));
}

/** Locks the household row so member changes that check counts or the owner row are serialized. */
async function lockHousehold(tx: DbOrTx, householdId: string): Promise<Household> {
  const [row] = await tx.select().from(schema.households).where(eq(schema.households.id, householdId)).for("update").limit(1);
  if (!row) throw notFound("Household");
  return row;
}

async function loadActiveMember(tx: DbOrTx, householdId: string, memberId: string): Promise<HouseholdMemberRow> {
  const hm = schema.householdMembers;
  const [row] =
    typeof memberId === "string" && memberId.length > 0
      ? await tx
          .select()
          .from(hm)
          .where(and(eq(hm.id, memberId), eq(hm.householdId, householdId), isNull(hm.removedAt)))
          .limit(1)
      : [];
  if (!row) throw notFound("Household member");
  return row;
}

async function touchHousehold(tx: DbOrTx, householdId: string): Promise<void> {
  await tx.update(schema.households).set({ updatedAt: now() }).where(eq(schema.households.id, householdId));
}

function today(): string {
  return centralDateString(now());
}

/* ---------------------------------------------------------------------------------------- owner row */

export type OwnerMemberInput = Omit<MemberInput, "kind">;

/**
 * Creates or updates the owner's own row: kind "adult", linked to the owner's sign-in, `isOwner` true. There
 * is never more than one; the household is incomplete (snapshot `missing` has "owner_member") until it exists.
 */
export async function upsertOwnerMember(householdId: string, input: OwnerMemberInput, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdMemberView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    const household = await lockHousehold(tx, access.household.id);
    const parsed = parseMemberInput({ ...(input as object), kind: "adult" }, today());
    const members = await listActiveMemberRows(tx, household.id);
    const existing = members.find((m) => m.isOwner);
    const values = { firstName: parsed.firstName, lastName: parsed.lastName, relationship: parsed.relationship, dobEnc: parsed.dob ? encryptDob(parsed.dob) : null };

    let row: HouseholdMemberRow;
    if (existing) {
      [row] = await tx.update(schema.householdMembers).set(values).where(eq(schema.householdMembers.id, existing.id)).returning();
    } else {
      if (members.length >= MAX_HOUSEHOLD_MEMBERS) throw conflict(`A household can list at most ${MAX_HOUSEHOLD_MEMBERS} people.`);
      [row] = await tx
        .insert(schema.householdMembers)
        .values({ id: newId("member"), householdId: household.id, kind: "adult", userId: household.ownerUserId, isOwner: true, createdAt: now(), ...values })
        .returning();
    }
    await touchHousehold(tx, household.id);
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: existing ? "household.member_update" : "household.member_add",
        target: { type: "household_member", id: row.id },
        metadata: { householdId: household.id, owner: true, fields: Object.keys(values), hasDob: values.dobEnc !== null },
        request: actor.request,
      },
      tx,
    );
    return toMemberView(row);
  });
}

/* ----------------------------------------------------------------------------------------- members */

/** Adds a person who lives with the student. Owner only. Throws validation_failed with per-field messages. */
export async function addMember(householdId: string, input: MemberInput, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdMemberView> {
  const db = dbOrTx ?? (await getDb());
  const parsed = parseMemberInput(input, today());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    const household = await lockHousehold(tx, access.household.id);
    const count = (await listActiveMemberRows(tx, household.id)).length;
    if (count >= MAX_HOUSEHOLD_MEMBERS) throw conflict(`A household can list at most ${MAX_HOUSEHOLD_MEMBERS} people.`);
    const [row] = await tx
      .insert(schema.householdMembers)
      .values({
        id: newId("member"),
        householdId: household.id,
        kind: parsed.kind,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        relationship: parsed.relationship,
        dobEnc: parsed.dob ? encryptDob(parsed.dob) : null,
        isOwner: false,
        createdAt: now(),
      })
      .returning();
    await touchHousehold(tx, household.id);
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.member_add",
        target: { type: "household_member", id: row.id },
        metadata: { householdId: household.id, kind: row.kind, hasDob: row.dobEnc !== null },
        request: actor.request,
      },
      tx,
    );
    return toMemberView(row);
  });
}

/**
 * Changes a member. A date of birth sets it, null clears it, absent keeps it. The owner's row stays an adult,
 * and an adult with a linked sign-in stays an adult (their access depends on it: remove them instead).
 */
export async function updateMember(householdId: string, memberId: string, patch: MemberPatch, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdMemberView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    await lockHousehold(tx, access.household.id);
    const current = await loadActiveMember(tx, access.household.id, memberId);
    const parsed = parseMemberPatch(patch, today(), { kind: current.kind, dob: current.dobEnc ? decryptDob(current.dobEnc) : null });
    if (parsed.kind && parsed.kind !== current.kind) {
      if (current.isOwner) throw conflict("The adult in charge of the household is always listed as an adult.");
      if (current.userId) throw conflict("This adult has their own sign-in. Remove them from the household instead of changing who they are.");
    }
    const set: Partial<typeof schema.householdMembers.$inferInsert> = {};
    if (parsed.kind !== undefined) set.kind = parsed.kind;
    if (parsed.firstName !== undefined) set.firstName = parsed.firstName;
    if (parsed.lastName !== undefined) set.lastName = parsed.lastName;
    if (parsed.relationship !== undefined) set.relationship = parsed.relationship;
    if ("dob" in parsed) set.dobEnc = parsed.dob ? encryptDob(parsed.dob) : null;
    if (Object.keys(set).length === 0) return toMemberView(current);

    const [row] = await tx.update(schema.householdMembers).set(set).where(eq(schema.householdMembers.id, current.id)).returning();
    await touchHousehold(tx, access.household.id);
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.member_update",
        // Field names only: names and dates of birth never go into the audit log.
        target: { type: "household_member", id: row.id },
        metadata: { householdId: access.household.id, fields: Object.keys(set).map((k) => (k === "dobEnc" ? "dob" : k)) },
        request: actor.request,
      },
      tx,
    );
    return toMemberView(row);
  });
}

/**
 * Soft-deletes a member (sets `removedAt`); the row stays because documents and income lines may point at it.
 * The owner's row cannot be removed. Removing a linked adult ends their access to the household.
 */
export async function removeMember(householdId: string, memberId: string, actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdMemberView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    await lockHousehold(tx, access.household.id);
    const current = await loadActiveMember(tx, access.household.id, memberId);
    if (current.isOwner) throw conflict("The adult in charge of the household cannot be removed.");
    const [row] = await tx.update(schema.householdMembers).set({ removedAt: now() }).where(eq(schema.householdMembers.id, current.id)).returning();
    await touchHousehold(tx, access.household.id);
    await audit(
      {
        actor: { type: "user", id: actor.userId },
        action: "household.member_remove",
        target: { type: "household_member", id: row.id },
        metadata: { householdId: access.household.id, kind: row.kind, hadSignIn: row.userId !== null },
        request: actor.request,
      },
      tx,
    );
    return toMemberView(row);
  });
}

/**
 * Marks exactly these members as the students being verified. Members who were students and are not in the
 * list become "child" (a person under the household's care who is not applying). The owner cannot be a
 * student, and neither can an adult with their own sign-in.
 */
export async function setStudents(householdId: string, memberIds: readonly string[], actor: HouseholdActor, dbOrTx?: DbOrTx): Promise<HouseholdMemberView[]> {
  if (!Array.isArray(memberIds) || memberIds.length === 0) throw invalid("Choose at least one student.", { fields: { students: "Choose at least one student." } });
  const wanted = [...new Set(memberIds)];
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const access = await requirePermission(tx, householdId, actor, "edit_household");
    await lockHousehold(tx, access.household.id);
    const members = await listActiveMemberRows(tx, access.household.id);
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const id of wanted) {
      const m = byId.get(id);
      if (!m) throw notFound("Household member");
      if (m.isOwner || m.userId) throw invalid("An adult with their own sign-in cannot be the student.", { fields: { students: "Choose a child in the household." } });
    }
    const hm = schema.householdMembers;
    const demote = members.filter((m) => m.kind === "student" && !wanted.includes(m.id)).map((m) => m.id);
    const promote = wanted.filter((id) => byId.get(id)!.kind !== "student");
    if (demote.length > 0) await tx.update(hm).set({ kind: "child" }).where(inArray(hm.id, demote));
    if (promote.length > 0) await tx.update(hm).set({ kind: "student" }).where(inArray(hm.id, promote));
    if (demote.length > 0 || promote.length > 0) {
      await touchHousehold(tx, access.household.id);
      await audit(
        {
          actor: { type: "user", id: actor.userId },
          action: "household.students_set",
          target: { type: "household", id: access.household.id },
          metadata: { studentIds: wanted, added: promote, removed: demote },
          request: actor.request,
        },
        tx,
      );
    }
    return (await listActiveMemberRows(tx, access.household.id)).map(toMemberView);
  });
}

/**
 * Family size under the proposed rule: everyone residing with the student, the student included
 * (sgo-verification-rules F20) — i.e. the active members. Removed members do not count. No access check:
 * callers have already checked access to the household or verification.
 */
export async function getHouseholdSize(householdId: string, dbOrTx?: DbOrTx): Promise<number> {
  const db = dbOrTx ?? (await getDb());
  const hm = schema.householdMembers;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(hm)
    .where(and(eq(hm.householdId, householdId), isNull(hm.removedAt)));
  return Number(row?.n ?? 0);
}

/**
 * Decrypts one member's date of birth for a household adult (for example to prefill the edit form). Audited
 * with the stated purpose. Null when none is stored.
 */
export async function readMemberDob(householdId: string, memberId: string, actor: HouseholdActor & { purpose: string }, dbOrTx?: DbOrTx): Promise<string | null> {
  const purpose = typeof actor.purpose === "string" ? actor.purpose.trim() : "";
  if (purpose.length === 0 || purpose.length > 120) throw invalid("State why the date of birth is needed.");
  const db = dbOrTx ?? (await getDb());
  const access = await requirePermission(db, householdId, actor, "view");
  const member = await loadActiveMember(db, access.household.id, memberId);
  if (!member.dobEnc) return null;
  await audit(
    { actor: { type: "user", id: actor.userId }, action: "household.dob_read", target: { type: "household_member", id: member.id }, metadata: { householdId: access.household.id, purpose }, request: actor.request },
    db,
  );
  return decryptDob(member.dobEnc);
}
