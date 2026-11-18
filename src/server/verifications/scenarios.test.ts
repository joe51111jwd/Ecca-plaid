/**
 * Lifecycle scenarios on the embedded database with SYNTHETIC documents (tests/fixtures/synthetic and
 * generateSyntheticDocument): look-alike and stale letters, unclear custody, the family view, SGO notification
 * preferences, retention and expiry.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { verifySignedEvidenceWithPlatformKey, type SignedEvidence } from "@/engine/evidence";
import { setTestNow } from "@/lib/clock";
import { listOutbox } from "@/server/email";
import { listEvents } from "@/server/events";
import { getObjectBytes } from "@/server/storage";
import { useTestDb } from "../../../tests/helpers/db";
import { signCertification } from "./certifications";
import { createVerification } from "./create";
import { addDocument } from "./documents";
import { completeHousehold, recordSharingConsent, setPathPreference, startVerification } from "./family";
import { getFamilyView } from "./family-view";
import { buildSgoNotificationEmail, getSgoNotificationSettings, readSgoNotificationSettings, setSgoNotificationSettings } from "./notifications";
import { getEvidenceObject, getVerification } from "./org";
import { expireDueVerifications, purgeDueUploads } from "./retention";
import { submit } from "./submit";
import {
  baseCreate,
  deadJobs,
  drainJobs,
  errorOf,
  hideEnumerableArrayExtensions,
  makeTestFamily,
  makeTestSgo,
  reviewerOf,
  startedVerification,
  syntheticFixture,
  syntheticW2,
  TEST_NOW,
  userByEmail,
} from "./test-support";

describe("lifecycle scenarios", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => {
    setTestNow(TEST_NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("a Medicaid letter is not categorical evidence: never eligible on it, never ineligible for lack of proof", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "award_letter", bytes: syntheticFixture("SYNTHETIC_tf0001_medicaid_only.pdf"), filename: "medicaid.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    expect(await deadJobs()).toEqual([]);
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row.status).not.toBe("eligible");
    expect(row.status).not.toBe("ineligible");
    expect(row.method).toBeNull();
    expect(row.decisionReasons.map((r) => r.code)).toContain("program_medicaid_not_listed");
    // The family is not told anything that reads as a result; the SGO's reviewers see why.
    const view = await getFamilyView(verification.id, family.userId);
    expect(view.outcome).toBeNull();
    const reviewer = await reviewerOf(sgo);
    const { getVerificationDetail } = await import("./review");
    const detail = await getVerificationDetail(sgo.orgId, verification.id, reviewer);
    expect(detail.decision?.reviewReasons.concat(detail.decision.reasons).map((r) => r.message).join(" ")).toContain("Medicaid");
  });

  it("an award letter dated 13 months before the application cannot support the categorical method", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "award_letter", bytes: syntheticFixture("SYNTHETIC_tf0001_snap_13_months_old.pdf"), filename: "snap.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row.status).not.toBe("eligible");
    expect(row.method).toBeNull();
    expect(row.decisionReasons.map((r) => r.code)).toContain("letter_older_than_12_months");
  });

  it("shared custody with equal time and unknown incomes goes to a person, never a guess", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const created = await createVerification(baseCreate(sgo.orgId));
    await startVerification(created.familyToken, family.userId);
    await recordSharingConsent(created.verification.id, family.actor, { locale: "en" });
    const done = await completeHousehold(created.verification.id, family.actor, { custody: { livesInMultipleHouseholds: true, equalTime: true, thisHouseholdHasHigherIncome: "unknown" } });
    expect(done.custody.needsReview).toBe(true);
    await addDocument({ verificationId: created.verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(created.verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(created.verification.id, family.actor);
    await drainJobs();
    const row = await getVerification(sgo.orgId, created.verification.id, { mode: "test" });
    expect(row.status).toBe("needs_review");
    expect(row.decisionReasons.some((r) => r.code.startsWith("custody_"))).toBe(true);
  });

  it("the family view walks the steps, labels documents plainly, lists what is missing in both languages and never promises an award", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("dana@example.com", { extraAdults: [{ firstName: "Sam", lastName: "Sample" }] });
    const created = await createVerification(baseCreate(sgo.orgId));
    await startVerification(created.familyToken, family.userId);
    const id = created.verification.id;
    let view = await getFamilyView(id, family.userId);
    expect(view).toMatchObject({ currentStep: "consent", canEdit: true, completedSteps: [], sandbox: true, orgName: "Synthetic Scholarship Fund" });
    await recordSharingConsent(id, family.actor, { locale: "en" });
    expect((await getFamilyView(id, family.userId)).currentStep).toBe("household");
    await completeHousehold(id, family.actor, { custody: { livesInMultipleHouseholds: false } });
    await setPathPreference(id, family.actor, "upload");
    await addDocument({ verificationId: id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    view = await getFamilyView(id, family.userId);
    expect(view).toMatchObject({ currentStep: "evidence", completedSteps: ["consent", "household"], pathPreference: "upload" });
    expect(view.documents[0]).toMatchObject({ state: "reading", label: { en: "Received — we are reading it" } });
    expect(view.whatHappensNext.en).toContain("Being eligible is not a promise of a scholarship.");
    expect(view.whatHappensNext.es).toContain("Ser elegible no es una promesa de beca.");

    await signCertification(id, family.actor, { kind: "no_other_income", memberId: family.ownerMemberId, locale: "en" });
    await submit(id, family.actor);
    await drainJobs();
    view = await getFamilyView(id, family.userId);
    expect(view).toMatchObject({ status: "pending", stage: "awaiting_family", currentStep: "evidence", canEdit: true });
    expect(view.documents[0]?.state).toBe("received");
    expect(view.missing.length).toBeGreaterThan(0);
    expect(view.missing.some((m) => m.en.includes("Sam") && m.es.includes("Sam"))).toBe(true);
    expect(view.explanation?.headline).toBeTruthy();

    await signCertification(id, family.actor, { kind: "zero_income", memberId: family.otherMemberIds[0], locale: "en" });
    await signCertification(id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(id, family.actor);
    await drainJobs();
    view = await getFamilyView(id, family.userId);
    expect(view).toMatchObject({ status: "eligible", currentStep: "outcome", canEdit: false, missing: [] });
    expect(view.completedSteps).toEqual(["consent", "household", "evidence", "waiting", "outcome"]);
    expect(view.outcome).toMatchObject({ status: "eligible", provisional: true, decidedByReviewer: false, reusedEarlierResult: false });
    expect(view.outcome?.provisionalNote).toBeTruthy();
    expect(view.outcome?.paragraphs.join(" ")).toContain("not a scholarship award");
    expect(JSON.stringify(view)).not.toMatch(/41,250|4125000|\$41/);
    // Another household cannot see it.
    const stranger = await makeTestFamily("stranger@example.com");
    expect((await errorOf(getFamilyView(id, stranger.userId))).code).toBe("not_found");
  });

  it("SGO notification emails follow the SGO's setting; one builder serves single notices and digests", async () => {
    const sgo = await makeTestSgo();
    expect(await getSgoNotificationSettings(sgo.orgId)).toEqual({ needsReview: true, decided: true });
    expect(readSgoNotificationSettings({ verificationEmails: { decided: "yes" } })).toEqual({ needsReview: true, decided: true });
    const owner = await userByEmail(sgo.ownerEmail);
    const ownerActor = { type: "user" as const, id: owner.id, mode: "test" as const };
    const reviewer = await reviewerOf(sgo);
    expect((await errorOf(setSgoNotificationSettings(sgo.orgId, { decided: false }, reviewer))).code).toBe("forbidden");
    expect((await errorOf(setSgoNotificationSettings(sgo.orgId, { decided: false }, { type: "api_key", id: "key_x", mode: "test" }))).code).toBe("forbidden");
    expect((await errorOf(setSgoNotificationSettings(sgo.orgId, { decided: "no" } as never, ownerActor))).code).toBe("validation_failed");
    expect(await setSgoNotificationSettings(sgo.orgId, { decided: false }, ownerActor)).toEqual({ needsReview: true, decided: false });
    const db = await getDb();
    const [profile] = await db.select().from(schema.sgoProfiles).where(eq(schema.sgoProfiles.orgId, sgo.orgId));
    expect(profile.settings).toMatchObject({ verificationEmails: { needsReview: true, decided: false } });

    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).status).toBe("eligible");
    expect(await listOutbox({ template: "verification_decided" })).toHaveLength(0);

    const digest = buildSgoNotificationEmail("needs_review", {
      mode: "live",
      items: [
        { verificationId: "ver_SYNTHETIC1", externalRef: "R-1", reasonCount: 1 },
        { verificationId: "ver_SYNTHETIC2", externalRef: null, reasonCount: 3 },
      ],
    });
    expect(digest.subject).toBe("2 verifications need review");
    expect(digest.text).toContain("ver_SYNTHETIC1 (your reference R-1): 1 point to settle.");
    expect(digest.text).toContain("ver_SYNTHETIC2: 3 points to settle.");
    expect(digest.text).toContain("/sgo/review");
    expect(buildSgoNotificationEmail("decided", { mode: "test", items: [{ verificationId: "ver_S", externalRef: null, status: "eligible", decidedBy: "engine" }] }).subject).toBe("[Test] A verification has been decided");
    expect(() => buildSgoNotificationEmail("decided", { mode: "test", items: [] })).toThrow();
  });
});

describe("retention and expiry (scenarios)", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => {
    setTestNow(TEST_NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("the purge keeps hashes and extracted fields, records the kept hash, and the evidence still verifies", async () => {
    const sgo = await makeTestSgo("Synthetic Fund", { rawRetentionDays: 7 });
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const added = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    const before = JSON.parse((await getEvidenceObject(sgo.orgId, verification.id, "json", { type: "api_key", id: "key_x", mode: "test" })).bytes.toString("utf8")) as SignedEvidence;

    setTestNow(new Date(Date.parse(TEST_NOW) + 8 * 86_400_000));
    const run = await purgeDueUploads();
    expect(run).toMatchObject({ purged: 1, failed: 0 });
    expect(await purgeDueUploads()).toMatchObject({ purged: 0, failed: 0 });
    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, added.document.id));
    expect(doc.status).toBe("purged");
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.extractionEnc).toBeTruthy();
    expect((await errorOf(getObjectBytes(doc.objectId))).code).toBe("gone");
    const [purgedEvent] = await db.select().from(schema.verificationEvents).where(eq(schema.verificationEvents.type, "document.purged"));
    expect(purgedEvent.data).toMatchObject({ documentId: doc.id, sha256: doc.sha256, reason: "retention" });
    // Evidence is untouched, still downloadable and still verifies; the decision is kept.
    const after = JSON.parse((await getEvidenceObject(sgo.orgId, verification.id, "json", { type: "api_key", id: "key_x", mode: "test" })).bytes.toString("utf8")) as SignedEvidence;
    expect(after).toEqual(before);
    expect(verifySignedEvidenceWithPlatformKey(after).valid).toBe(true);
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).status).toBe("eligible");
    const view = await getFamilyView(verification.id, family.userId);
    expect(view.documents[0]?.state).toBe("deleted_after_decision");
  });

  it("releases the uploads of a verification abandoned before submission after the policy window", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const added = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await drainJobs();
    setTestNow(new Date(Date.parse(TEST_NOW) + 59 * 86_400_000));
    expect(await purgeDueUploads()).toEqual({ purged: 0, failed: 0, abandoned: 0 });
    setTestNow(new Date(Date.parse(TEST_NOW) + 61 * 86_400_000));
    expect(await purgeDueUploads()).toEqual({ purged: 1, failed: 0, abandoned: 1 });
    expect(await purgeDueUploads()).toEqual({ purged: 0, failed: 0, abandoned: 0 });
    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, added.document.id));
    expect(doc.removedAt).not.toBeNull();
    expect(doc.purgedAt).not.toBeNull();
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The verification itself stays open; the family can upload again.
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).status).toBe("pending");
    const again = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    expect(again.duplicate).toBe(false);
  });

  it("recent family activity keeps uploads; submitted verifications are never treated as abandoned", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await drainJobs();
    setTestNow(new Date(Date.parse(TEST_NOW) + 50 * 86_400_000));
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    setTestNow(new Date(Date.parse(TEST_NOW) + 70 * 86_400_000));
    expect((await purgeDueUploads()).abandoned).toBe(0);
  });

  it("expires family links nobody opened, and decided results past expiry, emitting verification.expired once each; evidence is kept", async () => {
    const sgo = await makeTestSgo();
    const unopened = (await createVerification(baseCreate(sgo.orgId, { externalRef: "NEVER-OPENED" }))).verification;
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    expect(await expireDueVerifications()).toBe(0);

    // The link expired after 30 days; the result is valid to the end of the application year.
    setTestNow(new Date(Date.parse(TEST_NOW) + 31 * 86_400_000));
    expect(await expireDueVerifications()).toBe(1);
    setTestNow("2027-01-01T06:00:00.000Z");
    expect(await expireDueVerifications()).toBe(1);
    expect(await expireDueVerifications()).toBe(0);
    expect((await getVerification(sgo.orgId, unopened.id, { mode: "test" })).status).toBe("expired");
    const decided = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(decided.status).toBe("expired");
    expect(decided.evidenceJsonObjectId).toBeTruthy();
    expect((await getEvidenceObject(sgo.orgId, verification.id, "json", { type: "api_key", id: "key_x", mode: "test" })).bytes.length).toBeGreaterThan(0);
    const events = await listEvents({ orgId: sgo.orgId, type: "verification.expired" });
    expect(events).toHaveLength(2);
  });
});
