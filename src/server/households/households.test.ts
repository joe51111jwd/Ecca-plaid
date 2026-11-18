import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { decryptField } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit";
import type { User } from "@/server/auth";
import { listOutbox } from "@/server/email";
import { useTestDb } from "../../../tests/helpers/db";
import {
  ADDRESS_UPDATE_LIMIT,
  addMember,
  getHousehold,
  getHouseholdSize,
  getHouseholdSnapshot,
  getOrCreateHouseholdForUser,
  householdCan,
  INVITE_LIMITS,
  inviteAdult,
  MAX_HOUSEHOLD_MEMBERS,
  readMemberDob,
  removeMember,
  selectCounty,
  setStudents,
  updateAddress,
  updateHouseholdLocale,
  updateMember,
  upsertOwnerMember,
  type HouseholdActor,
} from "./index";
import { codeOf, fakeGeocoder, makeUser } from "./test-support";

// Every person, email and street address in this file is SYNTHETIC.

const ADDR = { line1: "1 Synthetic Way", city: "Houston", state: "TX", zip: "77002" };
const STUDENT = { kind: "student", firstName: "María-José", lastName: "O'Connor Peña", relationship: "self", dob: "2015-06-01" } as const;
const OWNER_SELF = { firstName: "Ana", lastName: "Peña", relationship: "parent" } as const;

describe("households", () => {
  useTestDb();
  let owner: User;
  let other: User;
  let ownerActor: HouseholdActor;
  let otherActor: HouseholdActor;
  let householdId: string;

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    owner = await makeUser("owner@example.com", { locale: "es" });
    other = await makeUser("other@example.com");
    ownerActor = { userId: owner.id, request: { ip: "203.0.113.7", userAgent: "test" } };
    otherActor = { userId: other.id };
    householdId = (await getOrCreateHouseholdForUser(owner.id)).household.id;
  });
  afterEach(() => setTestNow(null));

  describe("getOrCreateHouseholdForUser", () => {
    it("creates one durable household per owner and returns it on later calls", async () => {
      const again = await getOrCreateHouseholdForUser(owner.id);
      expect(again.created).toBe(false);
      expect(again.household.id).toBe(householdId);
      expect(again.household.access).toBe("owner");
      expect(again.household.locale).toBe("es"); // from the user's language
      expect(again.household.members).toEqual([]);
    });

    it("is safe against concurrent first calls", async () => {
      const fresh = await makeUser("fresh@example.com");
      const results = await Promise.all([1, 2, 3, 4].map(() => getOrCreateHouseholdForUser(fresh.id, { locale: "en" })));
      expect(new Set(results.map((r) => r.household.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      const db = await getDb();
      expect(await db.select().from(schema.households).where(eq(schema.households.ownerUserId, fresh.id))).toHaveLength(1);
    });

    it("gives a linked adult the household they belong to", async () => {
      const m = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, ownerActor);
      const { user } = await inviteAdult(householdId, { email: "second.adult@example.com", memberId: m.id }, ownerActor);
      const r = await getOrCreateHouseholdForUser(user.id);
      expect(r).toMatchObject({ created: false, household: { id: householdId, access: "adult" } });
    });

    it("refuses an unknown user", async () => {
      expect(await codeOf(getOrCreateHouseholdForUser("usr_missing"))).toBe("not_found");
    });
  });

  describe("access", () => {
    it("cross-household access is not_found, never forbidden (ids cannot be probed)", async () => {
      const theirs = (await getOrCreateHouseholdForUser(other.id)).household.id;
      expect(await codeOf(getHousehold(theirs, ownerActor))).toBe("not_found");
      expect(await codeOf(getHousehold(householdId, otherActor))).toBe("not_found");
      expect(await codeOf(addMember(householdId, STUDENT, otherActor))).toBe("not_found");
      expect(await codeOf(updateAddress(householdId, ADDR, otherActor, { fetchImpl: fakeGeocoder(null) }))).toBe("not_found");
      expect(await codeOf(getHousehold("hh_nope", ownerActor))).toBe("not_found");
    });

    it("cannot touch another household's member through one's own household id", async () => {
      const theirs = (await getOrCreateHouseholdForUser(other.id)).household.id;
      const theirMember = await addMember(theirs, STUDENT, otherActor);
      expect(await codeOf(updateMember(householdId, theirMember.id, { firstName: "Eve" }, ownerActor))).toBe("not_found");
      expect(await codeOf(removeMember(householdId, theirMember.id, ownerActor))).toBe("not_found");
      expect(await codeOf(setStudents(householdId, [theirMember.id], ownerActor))).toBe("not_found");
      expect(await codeOf(inviteAdult(householdId, { email: "x@example.com", memberId: theirMember.id }, ownerActor))).toBe("not_found");
    });

    it("permission table: adults view and add documents, only the owner edits and shares", () => {
      expect(householdCan("adult", "view")).toBe(true);
      expect(householdCan("adult", "add_documents")).toBe(true);
      expect(householdCan("adult", "grant_share_consent")).toBe(false);
      expect(householdCan("adult", "edit_household")).toBe(false);
      expect(householdCan("owner", "grant_share_consent")).toBe(true);
    });
  });

  describe("address and county", () => {
    it("resolves a unique ZIP when the geocoder has no match, and keeps the street out of the audit log", async () => {
      const r = await updateAddress(householdId, { ...ADDR, line1: "  1   Synthetic Way ", state: "Texas", zip: "77002-1234" }, ownerActor, { fetchImpl: fakeGeocoder(null) });
      expect(r.status).toBe("resolved");
      if (r.status !== "resolved") return;
      expect(r.county).toMatchObject({ fips: "48201", name: "Harris County", resolution: "zip_unique", matchesZip: null });
      expect(r.county.hudArea?.name).toContain("Houston");
      expect(r.household.address).toEqual({ line1: "1 Synthetic Way", line2: null, city: "Houston", state: "TX", zip: "77002" });
      const { items } = await listAuditLogs({ action: "household.address_update" });
      expect(JSON.stringify(items[0]!.metadata)).not.toContain("Synthetic Way");
      expect(items[0]!.metadata).toMatchObject({ outcome: "resolved", resolution: "zip_unique", countyFips: "48201" });
    });

    it("prefers a geocoder match in Texas", async () => {
      const r = await updateAddress(householdId, { ...ADDR, city: "Carrollton", zip: "75007" }, ownerActor, { fetchImpl: fakeGeocoder("48113") });
      expect(r).toMatchObject({ status: "resolved", county: { fips: "48113", resolution: "geocoder" } });
    });

    it("an ambiguous ZIP needs the family to choose, and a new address clears the old county", async () => {
      await updateAddress(householdId, ADDR, ownerActor, { fetchImpl: fakeGeocoder(null) });
      const r = await updateAddress(householdId, { ...ADDR, city: "Carrollton", zip: "75007" }, ownerActor, { fetchImpl: fakeGeocoder(null) });
      expect(r.status).toBe("needs_selection");
      if (r.status !== "needs_selection") return;
      expect(r.needsSelection).toBe(true);
      expect(r.reason).toBe("zip_ambiguous");
      expect(r.candidates.map((c) => c.fips)).toContain("48113");
      expect(r.household.county).toBeNull();
      expect(r.household.address?.zip).toBe("75007");
      expect((await getHouseholdSnapshot(householdId)).missing).toContain("county");
    });

    it("self-selection of a ZIP candidate is consistent", async () => {
      await updateAddress(householdId, { ...ADDR, city: "Carrollton", zip: "75007" }, ownerActor, { fetchImpl: fakeGeocoder(null) });
      const r = await selectCounty(householdId, "48113", ownerActor);
      expect(r).toMatchObject({ matchesZip: true, county: { fips: "48113", resolution: "self_selected", matchesZip: true } });
      expect(r.zipCandidates.length).toBeGreaterThan(1);
    });

    it("a self-selected county outside the ZIP is accepted but flagged for reviewers", async () => {
      await updateAddress(householdId, { ...ADDR, city: "Carrollton", zip: "75007" }, ownerActor, { fetchImpl: fakeGeocoder(null) });
      const r = await selectCounty(householdId, "48201", ownerActor);
      expect(r.matchesZip).toBe(false);
      expect((await getHousehold(householdId, ownerActor)).county).toMatchObject({ fips: "48201", resolution: "self_selected", matchesZip: false });
      expect((await getHouseholdSnapshot(householdId)).county).toMatchObject({ matchesZip: false, hudArea: { name: expect.stringContaining("Houston") } });
      const { items } = await listAuditLogs({ action: "household.county_select" });
      expect(items[0]!.metadata).toMatchObject({ countyFips: "48201", matchesZip: false });
    });

    it("rejects non-Texas addresses and stores nothing", async () => {
      expect(await codeOf(updateAddress(householdId, { ...ADDR, state: "NY", zip: "10001" }, ownerActor, { fetchImpl: fakeGeocoder(null) }))).toBe("validation_failed");
      expect(await codeOf(updateAddress(householdId, { ...ADDR, city: "New York", zip: "10001" }, ownerActor, { fetchImpl: fakeGeocoder("36061", "NY") }))).toBe("validation_failed");
      expect((await getHousehold(householdId, ownerActor)).address).toBeNull();
    });

    it("rejects bad county codes and selection before an address exists", async () => {
      expect(await codeOf(selectCounty(householdId, "48201", ownerActor))).toBe("conflict");
      await updateAddress(householdId, ADDR, ownerActor, { fetchImpl: fakeGeocoder(null) });
      for (const bad of ["06037", "48000", "Harris", ""]) expect(await codeOf(selectCounty(householdId, bad, ownerActor))).toBe("validation_failed");
    });

    it("only the owner changes the address, county or language", async () => {
      const m = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, ownerActor);
      const { user } = await inviteAdult(householdId, { email: "second.adult@example.com", memberId: m.id }, ownerActor);
      const adult = { userId: user.id };
      expect(await codeOf(updateAddress(householdId, ADDR, adult, { fetchImpl: fakeGeocoder(null) }))).toBe("forbidden");
      expect(await codeOf(selectCounty(householdId, "48201", adult))).toBe("forbidden");
      expect(await codeOf(updateHouseholdLocale(householdId, "en", adult))).toBe("forbidden");
      expect((await updateHouseholdLocale(householdId, "en", ownerActor)).locale).toBe("en");
      expect(await codeOf(updateHouseholdLocale(householdId, "fr" as never, ownerActor))).toBe("validation_failed");
    });
  });

  describe("members", () => {
    it("stores the date of birth only encrypted, never in plain text or in the audit log", async () => {
      const m = await addMember(householdId, STUDENT, ownerActor);
      expect(m).toMatchObject({ kind: "student", firstName: "María-José", lastName: "O'Connor Peña", hasDob: true, isOwner: false, hasSignIn: false });
      expect(m).not.toHaveProperty("dob");
      expect(m).not.toHaveProperty("dobEnc");

      const db = await getDb();
      const [row] = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, m.id));
      expect(row.dobEnc).toMatch(/^v1\./);
      expect(row.dobEnc).not.toContain("2015");
      expect(decryptField(row.dobEnc!, "dob")).toBe("2015-06-01");
      expect(() => decryptField(row.dobEnc!, "field")).toThrow(); // purpose-bound key

      const raw = JSON.stringify(await db.select().from(schema.auditLogs));
      expect(raw).not.toContain("2015-06-01");
      expect(raw).not.toContain("O'Connor");

      expect(await readMemberDob(householdId, m.id, { ...ownerActor, purpose: "edit_form" })).toBe("2015-06-01");
      expect(await codeOf(readMemberDob(householdId, m.id, { ...ownerActor, purpose: " " }))).toBe("validation_failed");
      const { items } = await listAuditLogs({ action: "household.dob_read" });
      expect(items[0]!.metadata).toMatchObject({ purpose: "edit_form" });
    });

    it("validates names, kinds, relationships and dates at the boundary", async () => {
      for (const bad of [
        { ...STUDENT, firstName: "R2-D2" },
        { ...STUDENT, kind: "pet" },
        { ...STUDENT, relationship: "boss" },
        { ...STUDENT, dob: "2027-01-01" },
        { ...STUDENT, dob: "2015-02-29" },
        { ...STUDENT, kind: "adult", relationship: "parent", dob: "2012-01-01" },
      ]) {
        expect(await codeOf(addMember(householdId, bad as never, ownerActor))).toBe("validation_failed");
      }
      expect(await getHouseholdSize(householdId)).toBe(0);
    });

    it("updates fields, clears the date of birth with null and keeps it when absent", async () => {
      const m = await addMember(householdId, STUDENT, ownerActor);
      expect((await updateMember(householdId, m.id, { firstName: "  Zoë " }, ownerActor)).firstName).toBe("Zoë");
      expect((await updateMember(householdId, m.id, { lastName: "Peña" }, ownerActor)).hasDob).toBe(true);
      expect((await updateMember(householdId, m.id, { dob: null }, ownerActor)).hasDob).toBe(false);
      const { items } = await listAuditLogs({ action: "household.member_update" });
      expect(items[0]!.metadata).toEqual({ householdId, fields: ["dob"] });
    });

    it("household size counts active members only", async () => {
      await upsertOwnerMember(householdId, OWNER_SELF, ownerActor);
      const kid = await addMember(householdId, STUDENT, ownerActor);
      const grandma = await addMember(householdId, { kind: "other", firstName: "Rosa", lastName: "Peña", relationship: "grandparent" }, ownerActor);
      expect(await getHouseholdSize(householdId)).toBe(3);
      await removeMember(householdId, grandma.id, ownerActor);
      expect(await getHouseholdSize(householdId)).toBe(2);
      expect(await codeOf(removeMember(householdId, grandma.id, ownerActor))).toBe("not_found");
      expect(await codeOf(updateMember(householdId, grandma.id, { firstName: "Ana" }, ownerActor))).toBe("not_found");
      const view = await getHousehold(householdId, ownerActor);
      expect(view.size).toBe(2);
      expect(view.members.map((m) => m.id)).toEqual([view.members.find((m) => m.isOwner)!.id, kid.id]);
      // The row is kept (soft delete) for documents and income lines that may point at it.
      const db = await getDb();
      const [row] = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.id, grandma.id));
      expect(row.removedAt).toBeInstanceOf(Date);
    });

    it("keeps exactly one owner row, linked to the owner, which cannot be removed or demoted", async () => {
      const first = await upsertOwnerMember(householdId, OWNER_SELF, ownerActor);
      const second = await upsertOwnerMember(householdId, { ...OWNER_SELF, firstName: "Ana María", dob: "1985-03-04" }, ownerActor);
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({ firstName: "Ana María", kind: "adult", isOwner: true, hasSignIn: true, hasDob: true });
      const db = await getDb();
      const owners = await db
        .select()
        .from(schema.householdMembers)
        .where(and(eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.isOwner, true)));
      expect(owners).toHaveLength(1);
      expect(owners[0]!.userId).toBe(owner.id);
      expect(await codeOf(removeMember(householdId, first.id, ownerActor))).toBe("conflict");
      expect(await codeOf(updateMember(householdId, first.id, { kind: "other" }, ownerActor))).toBe("conflict");
      expect(await codeOf(setStudents(householdId, [first.id], ownerActor))).toBe("validation_failed");
      expect(await codeOf(upsertOwnerMember(householdId, { ...OWNER_SELF, dob: "2010-01-01" }, ownerActor))).toBe("validation_failed");
    });

    it("updating the owner's name without a date of birth keeps the stored one; null clears it", async () => {
      const row = await upsertOwnerMember(householdId, { ...OWNER_SELF, dob: "1985-03-04" }, ownerActor);
      expect((await upsertOwnerMember(householdId, { ...OWNER_SELF, firstName: "Ana Sofía" }, ownerActor)).hasDob).toBe(true);
      expect(await readMemberDob(householdId, row.id, { ...ownerActor, purpose: "edit_form" })).toBe("1985-03-04");
      expect((await upsertOwnerMember(householdId, { ...OWNER_SELF, dob: null }, ownerActor)).hasDob).toBe(false);
      expect(await readMemberDob(householdId, row.id, { ...ownerActor, purpose: "edit_form" })).toBeNull();
    });

    it("limits the number of people", async () => {
      for (let i = 0; i < MAX_HOUSEHOLD_MEMBERS; i++) await addMember(householdId, { kind: "child", firstName: "Niño", lastName: "Sintético", relationship: "sibling" }, ownerActor);
      expect(await codeOf(addMember(householdId, STUDENT, ownerActor))).toBe("conflict");
    });

    it("setStudents marks exactly the given members and turns former students into children", async () => {
      const a = await addMember(householdId, STUDENT, ownerActor);
      const b = await addMember(householdId, { kind: "child", firstName: "Leo", lastName: "Peña", relationship: "sibling" }, ownerActor);
      let members = await setStudents(householdId, [b.id, b.id], ownerActor);
      expect(members.find((m) => m.id === a.id)?.kind).toBe("child");
      expect(members.find((m) => m.id === b.id)?.kind).toBe("student");
      members = await setStudents(householdId, [a.id, b.id], ownerActor);
      expect(members.filter((m) => m.kind === "student")).toHaveLength(2);
      expect(await codeOf(setStudents(householdId, [], ownerActor))).toBe("validation_failed");
      expect(await codeOf(setStudents(householdId, ["hm_missing"], ownerActor))).toBe("not_found");
      expect((await getHousehold(householdId, ownerActor)).studentIds.sort()).toEqual([a.id, b.id].sort());
    });
  });

  describe("second adult", () => {
    async function invited() {
      const m = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, ownerActor);
      const { user, isNewUser } = await inviteAdult(householdId, { email: " Second.Adult@Example.com ", memberId: m.id }, ownerActor);
      return { member: m, user, isNewUser, actor: { userId: user.id } as HouseholdActor };
    }

    it("links the sign-in to the member row and sends an invitation in the household's language", async () => {
      const { member, user, isNewUser } = await invited();
      expect(user.email).toBe("second.adult@example.com");
      expect(isNewUser).toBe(true);
      const view = await getHousehold(householdId, { userId: user.id });
      expect(view.access).toBe("adult");
      expect(view.members.find((m) => m.id === member.id)?.hasSignIn).toBe(true);
      const [email] = await listOutbox({ to: "second.adult@example.com" });
      expect(email.template).toBe("household_invitation");
      expect(email.subject).toMatch(/hogar/); // household locale "es"
      expect(email.text).toContain("/sign-in?email=second.adult%40example.com&next=%2Ffamily");
    });

    it("can view but cannot edit, invite, read others' details for edit, or export", async () => {
      const { actor, member } = await invited();
      expect((await getHousehold(householdId, actor)).id).toBe(householdId);
      expect(await codeOf(addMember(householdId, STUDENT, actor))).toBe("forbidden");
      expect(await codeOf(updateMember(householdId, member.id, { firstName: "Luis" }, actor))).toBe("forbidden");
      expect(await codeOf(removeMember(householdId, member.id, actor))).toBe("forbidden");
      expect(await codeOf(setStudents(householdId, [member.id], actor))).toBe("forbidden");
      expect(await codeOf(inviteAdult(householdId, { email: "third@example.com", memberId: member.id }, actor))).toBe("forbidden");
      expect(await codeOf(upsertOwnerMember(householdId, OWNER_SELF, actor))).toBe("forbidden");
    });

    it("loses access when removed, and a linked adult cannot be turned into a child", async () => {
      const { actor, member } = await invited();
      expect(await codeOf(updateMember(householdId, member.id, { kind: "child" }, ownerActor))).toBe("conflict");
      await removeMember(householdId, member.id, ownerActor);
      expect(await codeOf(getHousehold(householdId, actor))).toBe("not_found");
    });

    it("re-inviting the same person re-sends; other invitations are refused", async () => {
      const { member, user } = await invited();
      const again = await inviteAdult(householdId, { email: "second.adult@example.com", memberId: member.id }, ownerActor);
      expect(again).toMatchObject({ isNewUser: false, user: { id: user.id } });
      expect(await listOutbox({ to: "second.adult@example.com" })).toHaveLength(2);

      const kid = await addMember(householdId, STUDENT, ownerActor);
      expect(await codeOf(inviteAdult(householdId, { email: "kid@example.com", memberId: kid.id }, ownerActor))).toBe("conflict");
      const third = await addMember(householdId, { kind: "adult", firstName: "Rosa", lastName: "Peña", relationship: "grandparent" }, ownerActor);
      expect(await codeOf(inviteAdult(householdId, { email: "owner@example.com", memberId: third.id }, ownerActor))).toBe("conflict");
      expect(await codeOf(inviteAdult(householdId, { email: "second.adult@example.com", memberId: third.id }, ownerActor))).toBe("conflict");
      expect(await codeOf(inviteAdult(householdId, { email: "other.address@example.com", memberId: member.id }, ownerActor))).toBe("conflict");
      await getOrCreateHouseholdForUser(other.id);
      expect(await codeOf(inviteAdult(householdId, { email: "other@example.com", memberId: third.id }, ownerActor))).toBe("conflict");
      expect(await codeOf(inviteAdult(householdId, { email: "not an email", memberId: third.id }, ownerActor))).toBe("validation_failed");
      // A refused invitation leaves no account behind.
      const db = await getDb();
      expect(await db.select().from(schema.users).where(eq(schema.users.email, "kid@example.com"))).toHaveLength(0);
    });
  });

  it("two owners inviting the same person at once: exactly one household gets them", async () => {
    const secondOwner = await makeUser("second.owner@example.com");
    const secondHousehold = (await getOrCreateHouseholdForUser(secondOwner.id)).household.id;
    const m1 = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, ownerActor);
    const m2 = await addMember(secondHousehold, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, { userId: secondOwner.id });
    const codes = await Promise.all([
      codeOf(inviteAdult(householdId, { email: "shared.adult@example.com", memberId: m1.id }, ownerActor)),
      codeOf(inviteAdult(secondHousehold, { email: "shared.adult@example.com", memberId: m2.id }, { userId: secondOwner.id })),
    ]);
    expect(codes.sort()).toEqual(["conflict", "ok"]);
    const db = await getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "shared.adult@example.com"));
    expect(await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.userId, u!.id))).toHaveLength(1);
  });

  describe("rate limits", () => {
    it("bounds invitations per inviter and per address, after the permission check", async () => {
      const db = await getDb();
      const members = [];
      for (let i = 0; i < 2; i++) members.push(await addMember(householdId, { kind: "adult", firstName: "Rosa", lastName: "Peña", relationship: "other_relative" }, ownerActor));
      const [a] = members;
      // Re-sending to the same person counts against the address.
      for (let i = 0; i < INVITE_LIMITS.perAddress.limit; i++) await inviteAdult(householdId, { email: "limited@example.com", memberId: a!.id }, ownerActor);
      expect(await codeOf(inviteAdult(householdId, { email: "limited@example.com", memberId: a!.id }, ownerActor))).toBe("rate_limited");
      expect(await listOutbox({ to: "limited@example.com" })).toHaveLength(INVITE_LIMITS.perAddress.limit);

      // A stranger is refused as not_found and does not use up the address's allowance.
      setTestNow("2026-11-19T15:00:01Z");
      for (let i = 0; i < 5; i++) expect(await codeOf(inviteAdult(householdId, { email: "limited@example.com", memberId: a!.id }, otherActor))).toBe("not_found");
      await inviteAdult(householdId, { email: "limited@example.com", memberId: a!.id }, ownerActor);

      // Per inviter: one inviter cannot email an unbounded list of addresses.
      setTestNow("2026-11-21T15:00:00Z");
      const [b] = members.slice(1);
      let sent = 0;
      let last = "ok";
      for (let i = 0; i <= INVITE_LIMITS.perInviter.limit; i++) {
        last = await codeOf(inviteAdult(householdId, { email: `probe${i}@example.com`, memberId: b!.id }, ownerActor));
        if (last === "ok") sent++;
      }
      // The first succeeds; later ones to new addresses conflict (the row is linked), each still counted.
      expect(sent).toBe(1);
      expect(last).toBe("rate_limited");
      expect(await db.select().from(schema.users).where(eq(schema.users.email, `probe${INVITE_LIMITS.perInviter.limit}@example.com`))).toHaveLength(0);
    });

    it("bounds address saves (each one calls the geocoder)", async () => {
      const fetchImpl = fakeGeocoder(null);
      for (let i = 0; i < ADDRESS_UPDATE_LIMIT.limit; i++) await updateAddress(householdId, ADDR, ownerActor, { fetchImpl });
      const calls = (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      expect(await codeOf(updateAddress(householdId, ADDR, ownerActor, { fetchImpl }))).toBe("rate_limited");
      expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(calls);
      expect(await codeOf(updateAddress(householdId, ADDR, otherActor, { fetchImpl }))).toBe("not_found");
      setTestNow("2026-11-18T16:00:01Z");
      expect((await updateAddress(householdId, ADDR, ownerActor, { fetchImpl })).status).toBe("resolved");
    });
  });

  describe("getHouseholdSnapshot", () => {
    beforeEach(async () => {
      await upsertOwnerMember(householdId, { ...OWNER_SELF, dob: "1985-03-04" }, ownerActor);
      await addMember(householdId, STUDENT, ownerActor);
      await updateAddress(householdId, ADDR, ownerActor, { fetchImpl: fakeGeocoder(null) });
    });

    it("gives the decision inputs without dates of birth or the street address", async () => {
      const snap = await getHouseholdSnapshot(householdId);
      expect(snap).toMatchObject({ householdId, ownerUserId: owner.id, locale: "es", size: 2, missing: [], county: { fips: "48201", resolution: "zip_unique" } });
      expect(snap.county?.hudArea?.code).toBeTruthy();
      expect(snap.studentIds).toHaveLength(1);
      for (const m of snap.members) expect(m).not.toHaveProperty("dob");
      expect(JSON.stringify(snap)).not.toContain("Synthetic Way");
      expect(JSON.stringify(snap)).not.toContain("2015-06-01");
    });

    it("includes dates of birth only for a stated purpose, and audits the read", async () => {
      const snap = await getHouseholdSnapshot(householdId, { includeDob: { purpose: "sgo_application", actor: { type: "user", id: owner.id } } });
      expect(snap.members.map((m) => m.dob).sort()).toEqual(["1985-03-04", "2015-06-01"]);
      const { items } = await listAuditLogs({ action: "household.dob_read" });
      expect(items[0]).toMatchObject({ actorId: owner.id, metadata: { purpose: "sgo_application" } });
      expect(await codeOf(getHouseholdSnapshot(householdId, { includeDob: { purpose: "" } }))).toBe("validation_failed");
    });

    it("lists what is missing", async () => {
      const fresh = await makeUser("fresh@example.com");
      const id = (await getOrCreateHouseholdForUser(fresh.id)).household.id;
      expect((await getHouseholdSnapshot(id)).missing).toEqual(["owner_member", "student", "address", "county"]);
      expect(await codeOf(getHouseholdSnapshot("hh_missing"))).toBe("not_found");
    });
  });

  it("errors are AppErrors with safe messages", async () => {
    const error = await getHousehold(householdId, otherActor).then(
      () => null,
      (e: unknown) => e,
    );
    expect(isAppError(error)).toBe(true);
    expect((error as Error).message).toBe("Household not found");
  });
});
