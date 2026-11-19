/**
 * Passport reuse across two SYNTHETIC SGOs on the embedded database: a still-valid result is reused with a fresh
 * consent and a re-run under the second SGO's rules; a stricter cap or an aged-out letter falls back to the
 * normal flow without losing anything.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { verifySignedEvidenceWithPlatformKey, type SignedEvidence } from "@/engine/evidence";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { listEvents } from "@/server/events";
import { useTestDb } from "../../../tests/helpers/db";
import { signCertification } from "./certifications";
import { createVerification } from "./create";
import { addDocument } from "./documents";
import { recordSharingConsent, startVerification } from "./family";
import { getFamilyView } from "./family-view";
import { citeSha256 } from "./evidence";
import { getEvidenceObject, getVerification } from "./org";
import { findReusableResult, previewPassportConsent, reuseResult } from "./passport";
import { purgeDueUploads } from "./retention";
import { getDocumentForReview, getVerificationDetail } from "./review";
import { rerunDecision, saveReviewerExtraction } from "./review-actions";
import { toApiVerification } from "./serialize";
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
  syntheticSnapLetter,
  syntheticW2,
  TEST_NOW,
  userByEmail,
  type TestFamily,
  type TestSgo,
} from "./test-support";

/** SGO A decides the household eligible on a W-2 and a no-other-income statement; evidence is generated. */
async function decidedWithA(a: TestSgo, family: TestFamily, box1Cents = 4_125_000) {
  const { verification } = await startedVerification(a, family, { externalRef: "A-1" });
  await addDocument({ verificationId: verification.id, declaredKind: "w2", memberId: family.ownerMemberId, bytes: await syntheticW2({ box1Cents }), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
  await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
  await submit(verification.id, family.actor);
  await drainJobs();
  const row = await getVerification(a.orgId, verification.id, { mode: "test" });
  expect(row.status).toBe("eligible");
  expect(row.evidenceJsonObjectId).toBeTruthy();
  return row;
}

/** SGO B sends the same household a new link; the owner opens it. Nothing else is done yet. */
async function startedWithB(b: TestSgo, family: TestFamily, mode: "test" | "live" = "test") {
  const created = await createVerification(baseCreate(b.orgId, { externalRef: "B-1", mode }));
  await startVerification(created.familyToken, family.userId);
  return created.verification;
}

describe("passport reuse", () => {
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

  it("a second SGO reuses a still-valid result with a fresh consent: re-run, decided, new evidence citing the source; raw files are not re-shared", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const family = await makeTestFamily();
    const source = await decidedWithA(a, family);
    const target = await startedWithB(b, family);

    expect((await findReusableResult(family.householdId, b.orgId, { mode: "test" }))?.verificationId).toBe(source.id);
    expect(await findReusableResult(family.householdId, a.orgId, { mode: "test" })).toBeNull();
    expect(await findReusableResult(family.householdId, b.orgId, { mode: "live" })).toBeNull();
    expect((await getFamilyView(target.id, family.userId)).reusableResult?.verificationId).toBe(source.id);

    expect((await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: false as never }, family.actor))).code).toBe("validation_failed");
    const consent = await previewPassportConsent(target.id, source.id, family.actor, "en");
    expect(consent.text).toContain("Synthetic Fund B");
    const result = await reuseResult(target.id, source.id, { attestsNothingChanged: true, locale: "en", shownSha256: consent.sha256 }, family.actor);
    expect(result.outcome).toBe("reused");
    await drainJobs();
    expect(await deadJobs()).toEqual([]);

    const row = await getVerification(b.orgId, target.id, { mode: "test" });
    expect(row).toMatchObject({ status: "eligible", stage: "decided", decidedBy: "engine", passportSourceId: source.id, evidenceCopiedFromId: source.id, consentVersion: "passport_reuse.v1", householdIncomeCents: 4_125_000 });
    expect(row.passportSourceDecidedAt?.toISOString()).toBe(source.decidedAt?.toISOString());
    const sourceEvidence = JSON.parse((await getEvidenceObject(a.orgId, source.id, "json", { type: "api_key", id: "key_A", mode: "test" })).bytes.toString("utf8")) as SignedEvidence;
    expect(row.passportSourceRecordSha256).toBe(sourceEvidence.signature.record_sha256);
    expect(toApiVerification(row, { baseUrl: "https://app.example.org" }).passport).toEqual({ reused: true, source_decided_at: source.decidedAt?.toISOString() });

    const evidence = JSON.parse((await getEvidenceObject(b.orgId, target.id, "json", { type: "api_key", id: "key_B", mode: "test" })).bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(evidence).valid).toBe(true);
    expect(evidence.record.reused_from_verification_id).toBe(source.id);
    expect(evidence.record.consent.kind).toBe("passport_reuse");
    expect(JSON.stringify(evidence.record.timeline)).toContain(citeSha256(sourceEvidence.signature.record_sha256));
    expect(evidence.record.documents.map((d) => d.sha256)).toEqual(sourceEvidence.record.documents.map((d) => d.sha256));
    expect(await listEvents({ orgId: b.orgId, type: "verification.decided" })).toHaveLength(1);

    // The second SGO's reviewers see the carried-over document's fields, never its file.
    const reviewer = await reviewerOf(b);
    const detail = await getVerificationDetail(b.orgId, target.id, reviewer);
    expect(detail.documents[0]).toMatchObject({ viewable: false });
    expect(detail.documents[0]?.sourceDocumentId).toBeTruthy();
    expect(detail.verification.passport?.sourceVerificationId).toBe(source.id);
    expect(await errorOf(getDocumentForReview(b.orgId, detail.documents[0]!.id, reviewer))).toMatchObject({ code: "forbidden", details: { reason: "carried_over_document" } });

    // The source's retention governs the shared file: purging it marks the copy purged and the evidence still verifies.
    const db = await getDb();
    const [copy] = await db.select().from(schema.documents).where(eq(schema.documents.verificationId, target.id));
    expect(copy.purgeAfter).toBeNull();
    setTestNow(new Date(Date.parse(TEST_NOW) + 31 * 86_400_000));
    expect((await purgeDueUploads()).purged).toBe(1);
    const [afterPurge] = await db.select().from(schema.documents).where(eq(schema.documents.id, copy.id));
    expect(afterPurge.status).toBe("purged");
    expect(afterPurge.purgedAt).not.toBeNull();
    expect(verifySignedEvidenceWithPlatformKey(evidence).valid).toBe(true);

    // Once decided, nothing can be reused again.
    expect((await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor))).code).toBe("conflict");
  });

  it("reuse still works after the earlier verification's raw files were purged (fields and hashes are what is reused)", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const family = await makeTestFamily();
    const source = await decidedWithA(a, family);
    setTestNow(new Date(Date.parse(TEST_NOW) + 31 * 86_400_000));
    expect((await purgeDueUploads()).purged).toBe(1);
    const target = await startedWithB(b, family);
    const result = await reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor);
    expect(result.outcome).toBe("reused");
    await drainJobs();
    const row = await getVerification(b.orgId, target.id, { mode: "test" });
    expect(row.status).toBe("eligible");
    const evidence = JSON.parse((await getEvidenceObject(b.orgId, target.id, "json", { type: "api_key", id: "key_B", mode: "test" })).bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(evidence).valid).toBe(true);
    expect(evidence.record.documents[0]?.purged_at).toBeTruthy();
  });

  it("a stricter cap at the second SGO is honoured: the re-run is not eligible, so it falls back to the normal flow keeping everything", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B", { incomeCapPct: 200 });
    const family = await makeTestFamily();
    // $170,000: within 300% of the Harris County median, above the second SGO's 200% cap ($166,400 for two).
    const source = await decidedWithA(a, family, 17_000_000);
    const target = await startedWithB(b, family);
    const result = await reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor);
    expect(result.outcome).toBe("fallback");
    if (result.outcome !== "fallback") throw new Error("unreachable");
    expect(result.rerun.status).not.toBe("eligible");
    expect(result.rerun.explanation.headline).toBeTruthy();

    const row = await getVerification(b.orgId, target.id, { mode: "test" });
    expect(row).toMatchObject({ status: "pending", passportSourceId: null, evidenceCopiedFromId: source.id, decidedAt: null, applicationDate: null, stage: "collecting" });
    const db = await getDb();
    expect(await db.select().from(schema.documents).where(eq(schema.documents.verificationId, target.id))).toHaveLength(1);
    expect(await db.select().from(schema.verificationCertifications).where(eq(schema.verificationCertifications.verificationId, target.id))).toHaveLength(1);
    expect(await db.select().from(schema.consents).where(and(eq(schema.consents.verificationId, target.id), eq(schema.consents.kind, "passport_reuse")))).toHaveLength(1);
    expect((await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor))).details).toMatchObject({ reason: "already_reused" });

    // The normal flow continues with what was copied: consent, submit, and the stricter cap decides.
    await recordSharingConsent(target.id, family.actor, { locale: "en" });
    await submit(target.id, family.actor);
    await drainJobs();
    const decided = await getVerification(b.orgId, target.id, { mode: "test" });
    expect(["needs_review", "ineligible"]).toContain(decided.status);
    expect(decided.incomeCapPct).toBe(200);
  });

  it("an award letter that has aged out by today is honoured on reuse, even when the earlier result is still valid", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const family = await makeTestFamily();
    const { verification } = await startedVerification(a, family);
    const added = await addDocument({ verificationId: verification.id, declaredKind: "award_letter", bytes: await syntheticSnapLetter("2025-12-01"), filename: "snap.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    const reviewer = await reviewerOf(a);
    await saveReviewerExtraction(a.orgId, added.document.id, { kind: "award_letter", award: { program: "SNAP", letterDate: "2025-12-01", approvalStatus: "approved", recipientName: "DANA SAMPLE", benefitPeriod: { start: "2025-12-01", end: "2027-03-31" } } }, reviewer);
    const decidedA = await rerunDecision(a.orgId, verification.id, reviewer);
    expect(decidedA).toMatchObject({ status: "eligible", method: "categorical" });
    await drainJobs();
    // SYNTHETIC: a result recorded as valid to the end of the year (as an earlier rule version could have).
    const db = await getDb();
    const decision = { ...(decidedA.decision as Record<string, unknown>), validUntil: "2026-12-31" };
    await db.update(schema.verifications).set({ decision, expiresAt: new Date("2027-01-01T06:00:00.000Z") }).where(eq(schema.verifications.id, verification.id));

    setTestNow("2026-12-10T16:00:00.000Z");
    const target = await startedWithB(b, family);
    expect((await findReusableResult(family.householdId, b.orgId, { mode: "test" }))?.verificationId).toBe(verification.id);
    const result = await reuseResult(target.id, verification.id, { attestsNothingChanged: true }, family.actor);
    expect(result.outcome).toBe("fallback");
    if (result.outcome !== "fallback") throw new Error("unreachable");
    expect(result.rerun.reasonCodes).toContain("letter_older_than_12_months");
    expect((await getVerification(b.orgId, target.id, { mode: "test" })).status).toBe("pending");
  });

  it("refuses: a changed household, a non-owner, another household's result, another mode, an expired result", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const family = await makeTestFamily();
    const source = await decidedWithA(a, family);
    const target = await startedWithB(b, family);

    // A partner with their own sign-in is an adult of the household, not its owner.
    const partner = await userByEmail("partner@example.com");
    const db = await getDb();
    await db.insert(schema.householdMembers).values({ id: newId("member"), householdId: family.householdId, kind: "adult", firstName: "Pat", lastName: "Sample", userId: partner.id });
    expect((await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, { userId: partner.id }))).code).toBe("forbidden");
    // The partner joined the household after the earlier result: it changed.
    expect(await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor))).toMatchObject({ code: "conflict", details: { reason: "household_changed" } });
    await db.update(schema.householdMembers).set({ removedAt: new Date(TEST_NOW) }).where(eq(schema.householdMembers.userId, partner.id));

    const stranger = await makeTestFamily("stranger@example.com");
    const strangersSource = await decidedWithA(a, stranger);
    expect((await errorOf(reuseResult(target.id, strangersSource.id, { attestsNothingChanged: true }, family.actor))).code).toBe("not_found");
    const liveTarget = await startedWithB(b, family, "live");
    expect((await errorOf(reuseResult(liveTarget.id, source.id, { attestsNothingChanged: true }, family.actor))).code).toBe("not_found");
    expect((await errorOf(reuseResult(target.id, "ver_DOESNOTEXIST", { attestsNothingChanged: true }, family.actor))).code).toBe("not_found");
    expect((await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, stranger.actor))).code).toBe("not_found");

    setTestNow("2027-01-02T16:00:00.000Z");
    expect(await findReusableResult(family.householdId, b.orgId, { mode: "test" })).toBeNull();
    expect(await errorOf(reuseResult(target.id, source.id, { attestsNothingChanged: true }, family.actor))).toMatchObject({ code: "conflict", details: { reason: "source_not_reusable" } });
    // Nothing was copied by any refused attempt.
    expect(await db.select().from(schema.documents).where(and(eq(schema.documents.verificationId, target.id), isNotNull(schema.documents.sourceDocumentId)))).toHaveLength(0);
    expect((await getVerification(b.orgId, target.id, { mode: "test" })).evidenceCopiedFromId).toBeNull();
  });
});
