import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import type { User } from "@/server/auth";
import { assertActiveConsent, grantConsent } from "@/server/consents";
import { getObjectBytes, getObjectMeta, MemoryObjectStore, putObject, setObjectStoreForTests } from "@/server/storage";
import { syntheticFile } from "@/server/storage/testing";
import { useTestDb } from "../../../tests/helpers/db";
import { addMember, exportHouseholdData, getHousehold, getOrCreateHouseholdForUser, inviteAdult, processDeletionRequest, updateAddress, upsertOwnerMember } from "./index";
import { codeOf, fakeGeocoder, makePlatformAdmin, makeSgo, makeUser, makeVerification } from "./test-support";

// Every person, address, file and organization here is SYNTHETIC.

describe("household privacy operations", () => {
  useTestDb();
  let store: MemoryObjectStore;
  let owner: User;
  let admin: User;
  let adultId: string;
  let householdId: string;
  let verificationId: string;
  let sgoId: string;
  let uploadId: string;
  let evidenceId: string;
  let documentId: string;

  beforeAll(() => {
    store = new MemoryObjectStore();
    setObjectStoreForTests(store);
  });
  afterAll(() => setObjectStoreForTests(null));

  beforeEach(async () => {
    setTestNow("2026-11-18T15:00:00Z");
    owner = await makeUser("owner@example.com", { phone: "+15125550100" });
    admin = await makePlatformAdmin();
    householdId = (await getOrCreateHouseholdForUser(owner.id)).household.id;
    const actor = { userId: owner.id };
    await upsertOwnerMember(householdId, { firstName: "Ana", lastName: "Peña", relationship: "parent", dob: "1985-03-04" }, actor);
    await addMember(householdId, { kind: "student", firstName: "Leo", lastName: "Peña", relationship: "self", dob: "2015-06-01" }, actor);
    const second = await addMember(householdId, { kind: "adult", firstName: "Luis", lastName: "Peña", relationship: "parent" }, actor);
    adultId = (await inviteAdult(householdId, { email: "adult@example.com", memberId: second.id }, actor)).user.id;
    await getDb().then((db) => db.update(schema.users).set({ phone: "+15125550101" }).where(eq(schema.users.id, adultId)));
    await updateAddress(householdId, { line1: "1 Synthetic Way", city: "Houston", state: "TX", zip: "77002" }, actor, { fetchImpl: fakeGeocoder(null) });

    const sgo = await makeSgo();
    sgoId = sgo.id;
    verificationId = (await makeVerification(sgo.id, householdId)).id;
    await grantConsent({ kind: "verification_share", userId: owner.id, householdId, verificationId, recipientOrgId: sgo.id, locale: "en", vars: { shareUntil: "2027-06-30", uploadRetentionDays: 90 } });

    const upload = await putObject({ bytes: syntheticFile("pdf"), contentType: "application/pdf", purpose: "upload", filename: "synthetic-w2.pdf", householdId });
    const evidence = await putObject({ bytes: Buffer.from('{"synthetic":true}'), contentType: "application/json", purpose: "evidence_json", orgId: sgo.id, householdId });
    uploadId = upload.id;
    evidenceId = evidence.id;
    const db = await getDb();
    documentId = newId("document");
    await db.insert(schema.documents).values({
      id: documentId,
      verificationId,
      householdId,
      declaredKind: "w2",
      objectId: upload.id,
      sha256: upload.sha256,
      filename: "synthetic-w2.pdf",
      contentType: "application/pdf",
      size: upload.size,
      extractionEnc: "v1.synthetic.extraction.kept",
    });
    await db.insert(schema.railConnections).values({ id: newId("railConnection"), householdId, verificationId, provider: "simulated", status: "connected", accessTokenEnc: "v1.synthetic.token.x" });
  });
  afterEach(() => setTestNow(null));

  describe("exportHouseholdData", () => {
    it("gives the owner everything held, with dates of birth, and no credentials", async () => {
      const out = await exportHouseholdData(householdId, { userId: owner.id });
      expect(out.format).toBe("passport.household-export.v1");
      expect(out.household.address).toMatchObject({ line1: "1 Synthetic Way", zip: "77002" });
      expect(out.household.county).toMatchObject({ fips: "48201" });
      expect(out.members.map((m) => m.dateOfBirth).sort()).toEqual(["1985-03-04", "2015-06-01", null]);
      expect(out.members.find((m) => m.firstName === "Luis")?.signInEmail).toBe("adult@example.com");
      expect(out.consents).toHaveLength(1);
      expect(out.verifications[0]).toMatchObject({ id: verificationId, organization: "Synthetic Scholarship Fund", status: "pending" });
      expect(out.documents[0]).toMatchObject({ id: documentId, filename: "synthetic-w2.pdf" });
      expect(out.dataConnections).toHaveLength(1);
      const json = JSON.stringify(out);
      expect(json).not.toContain("synthetic.token");
      expect(json).not.toContain("synthetic.extraction");
      expect(json).not.toContain("v1.");
      expect((await listAuditLogs({ action: "household.export" })).items).toHaveLength(1);
    });

    it("is owner only", async () => {
      expect(await codeOf(exportHouseholdData(householdId, { userId: adultId }))).toBe("forbidden");
      expect(await codeOf(exportHouseholdData(householdId, { userId: admin.id }))).toBe("not_found");
    });
  });

  describe("processDeletionRequest", () => {
    it("is for platform admins only and needs a reason", async () => {
      expect(await codeOf(processDeletionRequest(householdId, { userId: owner.id }, { reason: "asked" }))).toBe("forbidden");
      expect(await codeOf(processDeletionRequest(householdId, { userId: admin.id }, { reason: "  " }))).toBe("validation_failed");
      expect(await codeOf(processDeletionRequest("hh_missing", { userId: admin.id }, { reason: "asked" }))).toBe("not_found");
      expect(await getObjectBytes(uploadId)).toBeInstanceOf(Buffer);
    });

    it("purges raw uploads, clears personal details, revokes consents and keeps the SGO's records", async () => {
      const db = await getDb();
      const auditBefore = (await db.select().from(schema.auditLogs)).length;
      const consentsBefore = await db.select().from(schema.consents);

      const report = await processDeletionRequest(householdId, { userId: admin.id, request: { ip: "198.51.100.4" } }, { reason: "Family emailed support asking for deletion" });

      expect(report.purgedObjectIds).toEqual([uploadId]);
      expect(report.alreadyPurgedObjectIds).toEqual([]);
      expect(report.documentIdsMarkedPurged).toEqual([documentId]);
      expect(report.membersDobCleared).toBe(2);
      expect(report.phonesCleared).toBe(2);
      expect(report.revokedConsentIds).toEqual(consentsBefore.map((c) => c.id));
      expect(report.railConnectionIdsToClose).toHaveLength(1);
      expect(report.openVerificationIds).toEqual([verificationId]);

      // Raw upload bytes are gone; the hash stays. Evidence (the SGO's record) is untouched.
      expect(await codeOf(getObjectBytes(uploadId))).toBe("gone");
      expect((await getObjectMeta(uploadId)).sha256).toBeTruthy();
      expect((await getObjectBytes(evidenceId)).toString()).toBe('{"synthetic":true}');

      const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
      expect(doc).toMatchObject({ status: "purged", sha256: expect.any(String), extractionEnc: "v1.synthetic.extraction.kept" });
      expect(doc.purgedAt).toBeInstanceOf(Date);

      const [h] = await db.select().from(schema.households).where(eq(schema.households.id, householdId));
      expect(h).toMatchObject({ addressLine1: null, addressLine2: null, city: null, zip: null, countyFips: null, countyName: null, countyResolution: null });
      const members = await db.select().from(schema.householdMembers).where(eq(schema.householdMembers.householdId, householdId));
      expect(members.every((m) => m.dobEnc === null)).toBe(true);
      expect(members.map((m) => m.firstName).sort()).toEqual(["Ana", "Leo", "Luis"]); // names kept: the evidence names who was counted
      const users = await db.select().from(schema.users);
      expect(users.find((u) => u.id === owner.id)?.phone).toBeNull();
      expect(users.find((u) => u.id === adultId)?.phone).toBeNull();

      // Consent records are kept, now revoked; nothing more can be collected or shared.
      const consentsAfter = await db.select().from(schema.consents);
      expect(consentsAfter).toHaveLength(consentsBefore.length);
      expect(consentsAfter.every((c) => c.revokedAt !== null)).toBe(true);
      expect(await codeOf(assertActiveConsent(verificationId, "verification_share"))).toBe("forbidden");

      // The verification (decision record) and the rail row are not changed here.
      const [v] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verificationId));
      expect(v.status).toBe("pending");
      const [rail] = await db.select().from(schema.railConnections).where(eq(schema.railConnections.householdId, householdId));
      expect(rail.accessTokenEnc).toBe("v1.synthetic.token.x");

      // Audit logs are only ever added to.
      const auditAfter = await db.select().from(schema.auditLogs);
      expect(auditAfter.length).toBeGreaterThan(auditBefore);
      const { items } = await listAuditLogs({ action: "household.deletion_processed" });
      expect(items[0]).toMatchObject({ actorId: admin.id, targetId: householdId, ip: "198.51.100.4", metadata: { reason: "Family emailed support asking for deletion", purgedObjects: 1 } });
      expect((await listAuditLogs({ action: "object.purge" })).items[0]).toMatchObject({ actorId: admin.id, targetId: uploadId });
      expect(JSON.stringify(items[0]!.metadata)).not.toContain(sgoId);

      // The household itself remains (durable id), now without address.
      expect((await getHousehold(householdId, { userId: owner.id })).address).toBeNull();
    });

    it("is safe to run again", async () => {
      await processDeletionRequest(householdId, { userId: admin.id }, { reason: "first" });
      const again = await processDeletionRequest(householdId, { userId: admin.id }, { reason: "second" });
      expect(again).toMatchObject({ purgedObjectIds: [], alreadyPurgedObjectIds: [uploadId], documentIdsMarkedPurged: [], membersDobCleared: 0, phonesCleared: 0, revokedConsentIds: [] });
    });
  });
});
