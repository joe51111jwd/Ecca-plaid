import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { listEvents } from "@/server/events";
import { useTestDb } from "../../../tests/helpers/db";
import { previewCertification, signCertification, withdrawCertification, listCertifications } from "./certifications";
import { createVerification } from "./create";
import { addDocument } from "./documents";
import {
  completeHousehold,
  getFamilyVerification,
  getVerificationByFamilyToken,
  previewSharingConsent,
  recordSharingConsent,
  setPathPreference,
  startVerification,
} from "./family";
import { cancelVerification } from "./org";
import { submit } from "./submit";
import { baseCreate, errorOf, hideEnumerableArrayExtensions, makeTestFamily, makeTestSgo, startedVerification, TEST_NOW, userByEmail } from "./test-support";
import { syntheticFile } from "@/server/storage/testing";

const pdf = () => syntheticFile("pdf");

describe("family link and start", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("reports invalid, expired and canceled links as typed states, never a throw", async () => {
    const sgo = await makeTestSgo();
    expect(await getVerificationByFamilyToken("nonsense")).toEqual({ state: "invalid" });
    expect(await getVerificationByFamilyToken("A".repeat(43))).toEqual({ state: "invalid" });
    expect(await getVerificationByFamilyToken("")).toEqual({ state: "invalid" });
    expect(await getVerificationByFamilyToken(null as unknown as string)).toEqual({ state: "invalid" });

    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId));
    const active = await getVerificationByFamilyToken(familyToken);
    expect(active).toMatchObject({ state: "active", verification: { id: verification.id, orgName: "Synthetic Scholarship Fund", started: false } });
    expect(JSON.stringify(active)).not.toMatch(/dana@example/);

    setTestNow("2026-12-19T16:00:00.000Z");
    expect(await getVerificationByFamilyToken(familyToken)).toEqual({ state: "expired", orgName: "Synthetic Scholarship Fund" });
    setTestNow(TEST_NOW);
    await cancelVerification(sgo.orgId, verification.id, { type: "user", id: "usr_x", mode: "test" });
    expect(await getVerificationByFamilyToken(familyToken)).toEqual({ state: "canceled", orgName: "Synthetic Scholarship Fund" });
  });

  it("binds the household on start, emits verification.started once and is idempotent", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId));
    const view = await startVerification(familyToken, family.userId);
    expect(view).toMatchObject({ id: verification.id, stage: "started", householdId: family.householdId });
    const again = await startVerification(familyToken, family.userId);
    expect(again.householdId).toBe(family.householdId);
    expect(await listEvents({ orgId: sgo.orgId, type: "verification.started" })).toHaveLength(1);
    const [started] = await listEvents({ orgId: sgo.orgId, type: "verification.started" });
    expect(started.payload).toMatchObject({ id: verification.id, object: "verification", stage: "started" });
    expect(JSON.stringify(started.payload)).not.toContain(familyToken);
  });

  it("refuses a link already bound to another household, an unknown link and an expired unstarted link", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const stranger = await makeTestFamily("stranger@example.com");
    const { familyToken } = await createVerification(baseCreate(sgo.orgId));
    await startVerification(familyToken, family.userId);
    expect(await errorOf(startVerification(familyToken, stranger.userId))).toMatchObject({ code: "conflict", details: { reason: "link_used" } });
    expect((await errorOf(startVerification("B".repeat(43), family.userId))).code).toBe("not_found");

    const other = await createVerification(baseCreate(sgo.orgId));
    setTestNow("2027-01-01T16:00:00.000Z");
    expect(await errorOf(startVerification(other.familyToken, family.userId))).toMatchObject({ code: "gone", details: { reason: "link_expired" } });
    // A family that already started keeps access through its own account after the link expires.
    expect((await startVerification(familyToken, family.userId)).householdId).toBe(family.householdId);
  });

  it("flags an applicant-email mismatch for reviewers instead of blocking", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("someone-else@example.com");
    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId, { applicantEmail: "dana@example.com" }));
    await startVerification(familyToken, family.userId);
    const db = await getDb();
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(row.flags.map((f) => f.code)).toEqual(["applicant_email_mismatch"]);
    expect(row.flags[0].message).not.toContain("@");
  });

  it("creates the household on first use for a new person", async () => {
    const sgo = await makeTestSgo();
    const user = await userByEmail("new-parent@example.com", "es");
    const { familyToken } = await createVerification(baseCreate(sgo.orgId, { applicantEmail: "new-parent@example.com", locale: "es" }));
    const view = await startVerification(familyToken, user.id);
    expect(view.locale).toBe("es");
    const db = await getDb();
    const [h] = await db.select().from(schema.households).where(eq(schema.households.id, view.householdId));
    expect(h.ownerUserId).toBe(user.id);
  });
});

describe("consent, household, path, certifications, submit", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("records the sharing consent with the SGO and retention window, owner only", async () => {
    const sgo = await makeTestSgo("Synthetic Fund", { rawRetentionDays: 45 });
    const family = await makeTestFamily();
    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId));
    await startVerification(familyToken, family.userId);

    const preview = await previewSharingConsent(verification.id, family.actor, "en");
    expect(preview.text).toContain("Synthetic Fund");
    expect(preview.vars).toMatchObject({ shareUntil: "2027-12-31", uploadRetentionDays: 45 });

    // A second adult with their own sign-in cannot give the sharing consent.
    const partner = await userByEmail("partner@example.com");
    const db = await getDb();
    await db.insert(schema.householdMembers).values({ id: newId("member"), householdId: family.householdId, kind: "adult", firstName: "Pat", lastName: "Sample", userId: partner.id });
    expect((await errorOf(recordSharingConsent(verification.id, { userId: partner.id }, { locale: "en" }))).code).toBe("forbidden");

    const view = await recordSharingConsent(verification.id, family.actor, { locale: "en", shownSha256: preview.sha256 });
    expect(view.stage).toBe("consented");
    expect(view.consent?.version).toBe("verification_share.v1");
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(row.consentVersion).toBe("verification_share.v1");
    expect(row.consentGrantedAt?.toISOString()).toBe(TEST_NOW);

    // Changed wording is refused.
    expect(await errorOf(recordSharingConsent(verification.id, family.actor, { locale: "en", shownSha256: "0".repeat(64) }))).toMatchObject({ code: "conflict" });
  });

  it("hides another household's verification from every family function", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const stranger = await makeTestFamily("stranger@example.com");
    const { verification } = await startedVerification(sgo, family);
    const id = verification.id;
    const calls = [
      () => getFamilyVerification(id, stranger.actor),
      () => previewSharingConsent(id, stranger.actor, "en"),
      () => recordSharingConsent(id, stranger.actor, { locale: "en" }),
      () => completeHousehold(id, stranger.actor, { custody: { livesInMultipleHouseholds: false } }),
      () => setPathPreference(id, stranger.actor, "upload"),
      () => addDocument({ verificationId: id, declaredKind: "w2", bytes: pdf(), filename: "a.pdf", contentType: "application/pdf" }, stranger.actor),
      () => signCertification(id, stranger.actor, { kind: "no_other_income", locale: "en" }),
      () => previewCertification(id, stranger.actor, { kind: "no_other_income", locale: "en" }),
      () => listCertifications(id, stranger.actor),
      () => submit(id, stranger.actor),
    ];
    for (const call of calls) expect((await errorOf(call)).code).toBe("not_found");
    // A verification nobody has started yet is not reachable by id either.
    const unstarted = await createVerification(baseCreate(sgo.orgId));
    expect((await errorOf(getFamilyVerification(unstarted.verification.id, family.actor))).code).toBe("not_found");
  });

  it("gates the household step on consent and on a complete Texas household; snapshots size, county and custody", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("dana@example.com", { extraAdults: [{ firstName: "Sam", lastName: "Sample" }] });
    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId));
    await startVerification(familyToken, family.userId);
    expect(await errorOf(completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: false } }))).toMatchObject({ code: "forbidden", details: { reason: "consent_missing" } });
    await recordSharingConsent(verification.id, family.actor, { locale: "en" });

    const db = await getDb();
    await db.update(schema.households).set({ countyFips: null, countyName: null, countyResolution: null }).where(eq(schema.households.id, family.householdId));
    const gap = await errorOf(completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: false } }));
    expect(gap).toMatchObject({ code: "validation_failed", details: { missing: ["county"] } });
    await db.update(schema.households).set({ countyFips: "06037", countyName: "Los Angeles County", countyResolution: "self_selected" }).where(eq(schema.households.id, family.householdId));
    expect((await errorOf(completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: false } }))).code).toBe("validation_failed");
    await db.update(schema.households).set({ countyFips: "48427", countyName: "Starr County", countyResolution: "geocoder" }).where(eq(schema.households.id, family.householdId));

    expect((await errorOf(completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: "maybe" } }))).code).toBe("validation_failed");
    expect((await errorOf(completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: false }, studentMemberIds: [family.ownerMemberId] }))).code).toBe("validation_failed");

    const res = await completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: true, monthsInThisHousehold: 6, equalTime: true, thisHouseholdHasHigherIncome: "unknown" } });
    expect(res.custody.needsReview).toBe(true);
    expect(res.verification.household).toMatchObject({ size: 3, countyFips: "48427", countyName: "Starr County", studentMemberIds: [family.studentId] });
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(row).toMatchObject({ stage: "household", householdSize: 3, hudAreaCode: expect.any(String), areaName: expect.stringContaining("Starr") });
    expect(row.custody?.livesInMultipleHouseholds).toBe(true);
  });

  it("the path preference is never a trap: switching keeps what was provided", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await setPathPreference(verification.id, family.actor, "auto_submit");
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: pdf(), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    const view = await setPathPreference(verification.id, family.actor, "upload");
    expect(view.pathPreference).toBe("upload");
    expect(view.consent).not.toBeNull();
    expect(view.household).not.toBeNull();
    const db = await getDb();
    expect(await db.select().from(schema.documents).where(eq(schema.documents.verificationId, verification.id))).toHaveLength(1);
    expect(await listCertifications(verification.id, family.actor)).toHaveLength(1);
    expect((await errorOf(setPathPreference(verification.id, family.actor, "scrape" as never))).code).toBe("validation_failed");
  });

  it("certifications: versioned words, an adult signer on the roster, idempotent, withdrawable before submit", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("dana@example.com", { extraAdults: [{ firstName: "Sam", lastName: "Sample" }] });
    const { verification } = await startedVerification(sgo, family);
    const preview = await previewCertification(verification.id, family.actor, { kind: "zero_income", memberId: family.otherMemberIds[0], locale: "es" });
    expect(preview.text).toContain("Sam Sample");
    expect(preview.text).toContain("2025");
    expect(preview.text).toContain("Dana Sample");
    expect((await errorOf(previewCertification(verification.id, family.actor, { kind: "zero_income", locale: "en" }))).code).toBe("validation_failed");
    expect((await errorOf(signCertification(verification.id, family.actor, { kind: "zero_income", memberId: "hm_notinthishousehold00000", locale: "en" }))).code).toBe("validation_failed");

    const signed = await signCertification(verification.id, family.actor, { kind: "zero_income", memberId: family.otherMemberIds[0], locale: "es", shownSha256: preview.sha256 });
    expect(signed).toMatchObject({ kind: "zero_income", incomeYear: 2025, copyVersion: "income_certification.v1", locale: "es", signedByMemberId: family.ownerMemberId });
    const again = await signCertification(verification.id, family.actor, { kind: "zero_income", memberId: family.otherMemberIds[0], locale: "es" });
    expect(again.id).toBe(signed.id);
    expect(await errorOf(signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en", shownSha256: "f".repeat(64) }))).toMatchObject({ code: "conflict", details: { reason: "copy_changed" } });

    const db = await getDb();
    const [row] = await db.select().from(schema.verificationCertifications).where(eq(schema.verificationCertifications.id, signed.id));
    expect(row.copySha256).toBe(preview.sha256);
    expect(row.ip).toBe("203.0.113.7");

    // A linked adult without a roster row of their own cannot sign; a stranger cannot withdraw.
    const partner = await userByEmail("partner@example.com");
    await db.insert(schema.householdMembers).values({ id: newId("member"), householdId: family.householdId, kind: "child", firstName: "Kid", lastName: "Sample", userId: partner.id });
    expect((await errorOf(signCertification(verification.id, { userId: partner.id }, { kind: "no_other_income", locale: "en" }))).code).toBe("not_found");
    expect((await errorOf(withdrawCertification(signed.id, (await makeTestFamily("x@example.com")).actor))).code).toBe("not_found");

    const withdrawn = await withdrawCertification(signed.id, family.actor);
    expect(await listCertifications(verification.id, family.actor)).toHaveLength(0);
    expect((await withdrawCertification(withdrawn.id, family.actor)).id).toBe(signed.id);
  });

  it("submit needs consent, a complete household and evidence; it is a no-op twice and locks family edits", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { familyToken, verification } = await createVerification(baseCreate(sgo.orgId));
    await startVerification(familyToken, family.userId);
    expect(await errorOf(submit(verification.id, family.actor))).toMatchObject({ code: "forbidden", details: { reason: "consent_missing" } });
    await recordSharingConsent(verification.id, family.actor, { locale: "en" });
    expect(await errorOf(submit(verification.id, family.actor))).toMatchObject({ code: "validation_failed", details: { reason: "household_incomplete" } });
    await completeHousehold(verification.id, family.actor, { custody: { livesInMultipleHouseholds: false } });
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    expect(await errorOf(submit(verification.id, family.actor))).toMatchObject({ code: "conflict", details: { reason: "no_evidence" } });

    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: pdf(), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    const view = await submit(verification.id, family.actor);
    expect(view).toMatchObject({ stage: "submitted", applicationDate: "2026-11-18", incomeYear: 2025 });
    await submit(verification.id, family.actor);
    expect(await listEvents({ orgId: sgo.orgId, type: "verification.submitted" })).toHaveLength(1);
    const db = await getDb();
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.type, "verification.decide"))).length).toBe(1);

    expect(await errorOf(setPathPreference(verification.id, family.actor, "upload"))).toMatchObject({ code: "conflict", details: { reason: "verification_locked" } });
    expect(await errorOf(addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: syntheticFile("png"), filename: "b.png", contentType: "image/png" }, family.actor))).toMatchObject({ code: "conflict" });
    expect(await errorOf(recordSharingConsent(verification.id, family.actor, { locale: "en" }))).toMatchObject({ code: "conflict" });
  });

  it("a ready data connection counts as evidence for submit", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const db = await getDb();
    await db.insert(schema.railConnections).values({ id: newId("railConnection"), householdId: family.householdId, verificationId: verification.id, memberId: family.ownerMemberId, provider: "simulated", status: "connecting" });
    expect(await errorOf(submit(verification.id, family.actor))).toMatchObject({ code: "conflict", details: { reason: "no_evidence" } });
    await db.update(schema.railConnections).set({ status: "ready" }).where(eq(schema.railConnections.verificationId, verification.id));
    expect((await submit(verification.id, family.actor)).stage).toBe("submitted");
  });

  it("a canceled verification refuses family changes", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await cancelVerification(sgo.orgId, verification.id, { type: "api_key", id: "key_x", mode: "test" });
    expect(await errorOf(setPathPreference(verification.id, family.actor, "upload"))).toMatchObject({ code: "conflict", details: { reason: "verification_canceled" } });
  });
});
