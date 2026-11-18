/**
 * Human review on the embedded database with SYNTHETIC documents: the queue, the detail page, viewing a file,
 * keying fields, re-running, resolving, asking the family for more, and the rules around each.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { generateSyntheticDocument } from "@/engine/documents/synthetic";
import { verifySignedEvidenceWithPlatformKey, type SignedEvidence } from "@/engine/evidence";
import { setTestNow } from "@/lib/clock";
import { listOutbox } from "@/server/email";
import { listEvents } from "@/server/events";
import { useTestDb } from "../../../tests/helpers/db";
import { signCertification } from "./certifications";
import { decideVerificationJob } from "./decide";
import { addDocument, removeDocument } from "./documents";
import { extractDocumentJob } from "./extract";
import { generateEvidenceJob } from "./evidence";
import { getFamilyView } from "./family-view";
import { getEvidenceObject, getVerification } from "./org";
import { assignReview, getDocumentForReview, getVerificationDetail, listReviewQueue } from "./review";
import { addReviewerIncomeItem, removeReviewerIncomeItem, requestMoreInfo, rerunDecision, resolveReview, saveReviewerExtraction } from "./review-actions";
import { submit } from "./submit";
import {
  deadJobs,
  drainJobs,
  errorOf,
  hideEnumerableArrayExtensions,
  leakedValues,
  makeStaff,
  makeTestFamily,
  makeTestSgo,
  reviewerOf,
  startedVerification,
  syntheticSnapLetter,
  syntheticW2,
  TEST_NOW,
  userByEmail,
} from "./test-support";

/** Anderson County (48001): for two people the two provisional readings differ ($187,920 and $201,000). */
const ANDERSON = { countyFips: "48001", countyName: "Anderson County" } as const;

/** SYNTHETIC: a photo of a W-2 (no text layer). */
const photoW2 = () => generateSyntheticDocument("image_png", { lines: ["SYNTHETIC SAMPLE", "W-2 2025", "DANA SAMPLE"] });

async function submittedWith(
  files: Array<{ bytes: Uint8Array; kind: "w2" | "award_letter"; filename: string; contentType: string }>,
  opts: { county?: typeof ANDERSON; certify?: boolean; sgo?: Awaited<ReturnType<typeof makeTestSgo>>; email?: string } = {},
) {
  const sgo = opts.sgo ?? (await makeTestSgo());
  const family = await makeTestFamily(opts.email ?? "dana@example.com", opts.county ?? {});
  const { verification } = await startedVerification(sgo, family);
  const docs: string[] = [];
  for (const f of files) docs.push((await addDocument({ verificationId: verification.id, declaredKind: f.kind, bytes: f.bytes, filename: f.filename, contentType: f.contentType }, family.actor)).document.id);
  if (opts.certify !== false) await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
  await submit(verification.id, family.actor);
  await drainJobs();
  return { sgo, family, verification, docs, reviewer: await reviewerOf(sgo) };
}

const w2File = async (box1Cents?: number) => ({ bytes: await syntheticW2({ box1Cents }), kind: "w2" as const, filename: "w2.pdf", contentType: "application/pdf" });

describe("human review", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => {
    setTestNow(TEST_NOW);
    for (const level of ["error", "warn", "info", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("direct method across the two readings (Anderson County): under the lower is eligible, over the higher is ineligible, in between goes to review", async () => {
    const sgo = await makeTestSgo();
    const under = await submittedWith([await w2File(10_000_000)], { county: ANDERSON, sgo, email: "under@example.com" });
    const over = await submittedWith([await w2File(25_000_000)], { county: ANDERSON, sgo, email: "over@example.com" });
    const between = await submittedWith([await w2File(19_500_000)], { county: ANDERSON, sgo, email: "between@example.com" });
    expect(await deadJobs()).toEqual([]);

    const u = await getVerification(sgo.orgId, under.verification.id, { mode: "test" });
    expect(u).toMatchObject({ status: "eligible", method: "direct", decidedBy: "engine", countyFips: "48001", householdSize: 2 });
    expect(u.thresholdCents).toBe(18_792_000);
    const o = await getVerification(sgo.orgId, over.verification.id, { mode: "test" });
    expect(o).toMatchObject({ status: "ineligible", method: "direct", decidedBy: "engine" });
    expect(o.thresholdCents).toBe(20_100_000);
    const b = await getVerification(sgo.orgId, between.verification.id, { mode: "test" });
    expect(b).toMatchObject({ status: "needs_review", stage: "in_review", decidedAt: null });
    expect(b.decisionReasons.map((r) => r.code)).toContain("between_provisional_readings");

    // Both readings are recorded on every decision and shown in the API.
    const { toApiVerification } = await import("./serialize");
    expect(toApiVerification(b, { baseUrl: "https://app.example.org" }).threshold_readings.map((r) => r.usd).sort()).toEqual(["187920.00", "201000.00"]);
    // The ineligible file has evidence; the ineligible family is told without a figure.
    const signed = JSON.parse((await getEvidenceObject(sgo.orgId, o.id, "json", under.reviewer)).bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(signed).valid).toBe(true);
    expect(signed.record.decision.status).toBe("ineligible");
    const told = await listOutbox({ to: "over@example.com", template: "verification_outcome" });
    expect(told).toHaveLength(1);
    expect(told[0].text).not.toMatch(/250,000|\$250/);
  });

  it("reviewer flow end to end: needs_review → queue → detail → view file → key fields → re-run → decided by the engine with a review trail", async () => {
    const { sgo, family, verification, docs, reviewer } = await submittedWith([{ bytes: await photoW2(), kind: "w2", filename: "w2.png", contentType: "image/png" }]);
    expect(await getVerification(sgo.orgId, verification.id, { mode: "test" })).toMatchObject({ status: "needs_review", stage: "in_review" });

    const queue = await listReviewQueue(sgo.orgId, { mode: "test" });
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ verificationId: verification.id, assignedTo: null, waitingOnFamily: false, ageDays: 0 });
    expect(queue.items[0].reasons.map((r) => r.code)).toContain("document_not_read");

    await assignReview(sgo.orgId, verification.id, reviewer.id, reviewer);
    expect((await listReviewQueue(sgo.orgId, { mode: "test", assignedTo: reviewer.id })).items).toHaveLength(1);
    expect((await listReviewQueue(sgo.orgId, { mode: "test", assignedTo: null })).items).toHaveLength(0);

    const detail = await getVerificationDetail(sgo.orgId, verification.id, reviewer);
    expect(detail.household?.members.map((m) => `${m.firstName} ${m.lastName}`).sort()).toEqual(["Dana Sample", "Riley Sample"]);
    expect(JSON.stringify(detail.household)).not.toMatch(/dob|birth/i);
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]).toMatchObject({ status: "needs_review", viewable: true });
    expect(detail.documents[0].reviewReasons.map((r) => r.code)).toContain("no_text_layer");
    expect(detail.consents.map((c) => c.kind)).toEqual(["verification_share"]);
    expect(detail.decision?.status).toBe("needs_review");
    expect(detail.decision?.threshold?.readings.length).toBeGreaterThanOrEqual(1);
    expect(detail.reviewTasks).toHaveLength(1);
    expect(detail.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(["created", "started", "submitted", "decision.made", "review.requested", "review.assigned"]));

    const file = await getDocumentForReview(sgo.orgId, docs[0]!, reviewer);
    expect(file.contentType).toBe("image/png");
    expect(file.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");

    await saveReviewerExtraction(
      sgo.orgId,
      docs[0]!,
      {
        kind: "w2",
        memberId: family.ownerMemberId,
        notes: "Read the photo: one W-2 for 2025.",
        income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 4_125_000, person: "DANA SAMPLE", payer: "FIXTURE FOODS LLC" }] },
      },
      reviewer,
    );
    const after = await rerunDecision(sgo.orgId, verification.id, reviewer);
    expect(after).toMatchObject({ status: "eligible", stage: "decided", decidedBy: "engine", method: "direct", householdIncomeCents: 4_125_000 });
    await drainJobs();
    expect(await deadJobs()).toEqual([]);

    const db = await getDb();
    const [task] = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, verification.id));
    expect(task).toMatchObject({ status: "resolved", resolution: "eligible", resolvedBy: null });
    const ev = await getEvidenceObject(sgo.orgId, verification.id, "json", reviewer);
    const signed = JSON.parse(ev.bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(signed).valid).toBe(true);
    expect(signed.record.review_trail.map((e) => e.action)).toEqual(expect.arrayContaining([expect.stringContaining("Keyed or corrected"), expect.stringContaining("decide again")]));
    expect(signed.record.documents[0]?.extracted_by).toBe("reviewer");

    // Sensitive reads are audited; nothing extracted or personal reaches audit metadata or the timeline.
    const actions = (await db.select({ action: schema.auditLogs.action }).from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["verification.detail_read", "document.view", "document.reviewer_extraction", "verification.rerun", "evidence.download"]));
    const needles = ["Dana", "Riley", "4125000", "41,250", "FIXTURE FOODS", "photo: one W-2"];
    expect(await leakedValues(needles)).toEqual([]);
    const logged = (["error", "warn", "info", "log"] as const).flatMap((level) => vi.mocked(console[level]).mock.calls.map((args) => args.map(String).join(" ")));
    expect(logged.filter((line) => needles.some((n) => line.toLowerCase().includes(n.toLowerCase())))).toEqual([]);
  });

  it("a SNAP letter goes to review (unverified layout); a reviewer confirms the fields and it is eligible with evidence; every job run twice emits verification.decided once", async () => {
    const { sgo, verification, docs, reviewer } = await submittedWith([{ bytes: await syntheticSnapLetter(), kind: "award_letter", filename: "snap.pdf", contentType: "application/pdf" }], { certify: false });
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row.status).toBe("needs_review");
    expect((await getVerificationDetail(sgo.orgId, verification.id, reviewer)).documents[0]?.reviewReasons.map((r) => r.code)).toContain("layout_unverified");

    await saveReviewerExtraction(
      sgo.orgId,
      docs[0]!,
      { kind: "award_letter", award: { program: "SNAP", letterDate: "2026-10-20", approvalStatus: "approved", recipientName: "DANA SAMPLE", issuingAgency: "Texas Health and Human Services Commission", benefitPeriod: { start: "2026-10-20", end: "2027-03-31" } } },
      reviewer,
    );
    await rerunDecision(sgo.orgId, verification.id, reviewer);
    await drainJobs();
    // Every job of the module again, twice: nothing changes.
    for (let i = 0; i < 2; i++) {
      await extractDocumentJob(docs[0]!);
      await decideVerificationJob(verification.id);
      await generateEvidenceJob(verification.id);
      await drainJobs();
    }
    const decided = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(decided).toMatchObject({ status: "eligible", method: "categorical", awardProgram: "SNAP", awardLetterDate: "2026-10-20", householdIncomeCents: null });
    expect(await listEvents({ orgId: sgo.orgId, type: "verification.decided" })).toHaveLength(1);
    const json = JSON.parse((await getEvidenceObject(sgo.orgId, verification.id, "json", reviewer)).bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(json).valid).toBe(true);
    expect(json.record.categorical).toMatchObject({ program: "SNAP", letter_date: "2026-10-20" });
    const pdf = await getEvidenceObject(sgo.orgId, verification.id, "pdf", reviewer);
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // SGO staff were told it needs review, then that it was decided.
    expect((await listOutbox({ template: "verification_needs_review" })).length).toBeGreaterThan(0);
    expect((await listOutbox({ template: "verification_decided", to: sgo.reviewerEmail })).length).toBe(1);
  });

  it("resolves a verification between the two readings: decided by the reviewer, notes mandatory, the task closed, evidence names the reviewer", async () => {
    const { sgo, verification, reviewer } = await submittedWith([await w2File(19_500_000)], { county: ANDERSON });
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row.status).toBe("needs_review");
    expect(row.decisionReasons.map((r) => r.code)).toContain("between_provisional_readings");

    expect(await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "  ", basis: { method: "direct" } }, reviewer))).toMatchObject({ code: "validation_failed" });
    expect(await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "x", basis: { method: "categorical", documentId: "doc_NOPE" } }, reviewer))).toMatchObject({
      code: "conflict",
      details: { reason: "letter_not_on_record" },
    });
    const viewer = await makeStaff(sgo.orgId, "viewer", "viewer-only@example.org");
    expect((await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "x", basis: { method: "direct" } }, viewer))).code).toBe("forbidden");
    expect((await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "x", basis: { method: "direct" } }, { type: "api_key", id: "key_SYNTHETIC", mode: "test" }))).code).toBe("forbidden");

    const resolved = await resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "Checked the W-2 against the SGO's reading of the limit.", basis: { method: "direct" } }, reviewer);
    expect(resolved).toMatchObject({ status: "eligible", stage: "decided", decidedBy: reviewer.id, method: "direct" });
    expect(await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "again", basis: { method: "direct" } }, reviewer))).toMatchObject({ code: "conflict", details: { reason: "verification_decided" } });
    await drainJobs();
    const db = await getDb();
    const [task] = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, verification.id));
    expect(task).toMatchObject({ status: "resolved", resolution: "eligible", resolvedBy: reviewer.id });
    const signed = JSON.parse((await getEvidenceObject(sgo.orgId, verification.id, "json", reviewer)).bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(signed).valid).toBe(true);
    expect(JSON.stringify(signed.record.decision)).toContain(reviewer.id);
    expect(signed.record.review_trail.some((e) => e.action.includes("Resolved the verification as eligible") && e.notes?.includes("Checked the W-2"))).toBe(true);
    const [decidedEvent] = await listEvents({ orgId: sgo.orgId, type: "verification.decided" });
    expect(decidedEvent.payload.decided_by).toBe("reviewer");
  });

  it("refuses to approve above the statutory limit under every reading", async () => {
    // $205,000 is above the higher reading ($201,000) but inside the review band, so it goes to a person.
    const { sgo, verification, reviewer } = await submittedWith([await w2File(20_500_000)], { county: ANDERSON });
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).status).toBe("needs_review");
    expect(await errorOf(resolveReview(sgo.orgId, verification.id, { resolution: "eligible", notes: "Looks fine.", basis: { method: "direct" } }, reviewer))).toMatchObject({
      code: "conflict",
      details: { reason: "income_above_statutory_limit" },
    });
    const ineligible = await resolveReview(sgo.orgId, verification.id, { resolution: "ineligible", notes: "Income is above every reading.", basis: { method: "direct" } }, reviewer);
    expect(ineligible.status).toBe("ineligible");
  });

  it("asks the family for more: awaiting_family, emailed, task stays linked; the resubmission updates the same task and finally decides", async () => {
    const { sgo, family, verification, docs, reviewer } = await submittedWith([{ bytes: await photoW2(), kind: "w2", filename: "w2.png", contentType: "image/png" }]);
    expect(await errorOf(requestMoreInfo(sgo.orgId, verification.id, { message: "", items: [] }, reviewer))).toMatchObject({ code: "validation_failed" });
    const asked = await requestMoreInfo(sgo.orgId, verification.id, { message: "The photo is blurry.", items: ["A clear copy of the 2025 W-2"] }, reviewer);
    expect(asked).toMatchObject({ status: "pending", stage: "awaiting_family" });
    expect(asked.familyRequest).toMatchObject({ message: "The photo is blurry.", items: ["A clear copy of the 2025 W-2"], requestedBy: reviewer.id });
    const mail = await listOutbox({ to: "dana@example.com", template: "verification_more_information_request" });
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain("A clear copy of the 2025 W-2");
    const view = await getFamilyView(verification.id, family.userId);
    expect(view.request?.items).toEqual(["A clear copy of the 2025 W-2"]);
    expect(view.canEdit).toBe(true);
    const queued = await listReviewQueue(sgo.orgId, { mode: "test" });
    expect(queued.items[0]).toMatchObject({ waitingOnFamily: true });

    // First answer: a readable W-2, but the photo is still on file and unread → back to review, same task.
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    const db = await getDb();
    let tasks = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, verification.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "open", moreInfoRequestedAt: null });
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).familyRequest).toBeNull();
    expect(await listEvents({ orgId: sgo.orgId, type: "verification.needs_review" })).toHaveLength(2);

    // Second request; the family takes the photo back and resubmits → decided, the task closed.
    await requestMoreInfo(sgo.orgId, verification.id, { message: "Please remove the photo.", items: ["Remove the blurry photo"] }, reviewer);
    await removeDocument(docs[0]!, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).status).toBe("eligible");
    tasks = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, verification.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "resolved", resolution: "eligible" });
  });

  it("a reviewer's re-run that lands in review again updates the task quietly (no second webhook or email)", async () => {
    const { sgo, verification, reviewer } = await submittedWith([{ bytes: await photoW2(), kind: "w2", filename: "w2.png", contentType: "image/png" }]);
    const before = (await listOutbox({ template: "verification_needs_review" })).length;
    const row = await rerunDecision(sgo.orgId, verification.id, reviewer);
    expect(row.status).toBe("needs_review");
    expect(await listEvents({ orgId: sgo.orgId, type: "verification.needs_review" })).toHaveLength(1);
    expect((await listOutbox({ template: "verification_needs_review" })).length).toBe(before);
    const db = await getDb();
    expect(await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, verification.id))).toHaveLength(1);
  });

  it("reviewer income lines: validated, counted by category, removable only when a reviewer added them", async () => {
    const family2 = { extraAdults: [{ firstName: "Sam", lastName: "Sample" }] };
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("dana@example.com", family2);
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", memberId: family.ownerMemberId, locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    expect((await getVerification(sgo.orgId, verification.id, { mode: "test" })).stage).toBe("awaiting_family");
    const reviewer = await reviewerOf(sgo);
    const sam = family.otherMemberIds[0]!;

    for (const bad of [
      { category: "not_a_category", annualAmountCents: 1, description: "x", basis: "y" },
      { category: "wages_salary", annualAmountCents: 1.5, description: "x", basis: "y" },
      { category: "wages_salary", annualAmountCents: 1, description: "", basis: "y" },
      { category: "wages_salary", annualAmountCents: 1, description: "x", basis: "y", memberId: "hm_NOT_IN_HOUSEHOLD" },
      { category: "wages_salary", annualAmountCents: 1, description: "x", basis: "y", documentId: "doc_NOT_HERE" },
      { category: "wages_salary", annualAmountCents: 1, description: "x", basis: "y", extra: true },
    ]) {
      expect((await errorOf(addReviewerIncomeItem(sgo.orgId, verification.id, bad as never, reviewer))).code).toBe("validation_failed");
    }
    const item = await addReviewerIncomeItem(sgo.orgId, verification.id, { memberId: sam, category: "wages_salary", annualAmountCents: 1_200_000, description: "Second job", basis: "Employer letter seen by the reviewer" }, reviewer);
    expect(item).toMatchObject({ source: "reviewer", counted: true, incomeYear: 2025, createdBy: reviewer.id });

    const db = await getDb();
    const [docLine] = await db.select().from(schema.incomeItems).where(and(eq(schema.incomeItems.verificationId, verification.id), eq(schema.incomeItems.source, "document")));
    expect(await errorOf(removeReviewerIncomeItem(sgo.orgId, docLine!.id, reviewer))).toMatchObject({ code: "conflict", details: { reason: "not_reviewer_line" } });
    expect((await removeReviewerIncomeItem(sgo.orgId, item.id, reviewer)).id).toBe(item.id);
    expect((await errorOf(removeReviewerIncomeItem(sgo.orgId, item.id, reviewer))).code).toBe("not_found");

    // Keyed income plus a statement for Sam: the re-run now decides.
    await addReviewerIncomeItem(sgo.orgId, verification.id, { memberId: sam, category: "wages_salary", annualAmountCents: 1_200_000, description: "Second job", basis: "Employer letter" }, reviewer);
    const reran = await rerunDecision(sgo.orgId, verification.id, reviewer);
    expect(reran.householdIncomeCents).toBe(4_125_000 + 1_200_000);
  });

  it("keyed fields are validated against the reader's vocabulary and refused outside review or for carried-over documents", async () => {
    const { sgo, verification, docs, reviewer } = await submittedWith([{ bytes: await photoW2(), kind: "w2", filename: "w2.png", contentType: "image/png" }]);
    for (const bad of [
      { kind: "w2" },
      { kind: "w2", income: { taxYear: 2025, amounts: [] } },
      { kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "paystub_gross_ytd", amountCents: 1 }] } },
      { kind: "w2", income: { taxYear: null, amounts: [{ measure: "w2_box1_wages", amountCents: 1 }] } },
      { kind: "pay_stub", income: { taxYear: 2025, amounts: [{ measure: "paystub_gross_ytd", amountCents: 1 }] } },
      { kind: "award_letter", award: { program: "MEDICAID", letterDate: null, approvalStatus: "approved", recipientName: null } },
      { kind: "award_letter", award: { program: "SNAP", lookAlikeProgram: "MEDICAID", letterDate: null, approvalStatus: "approved", recipientName: null } },
      { kind: "w2", subtype: "pay_stub", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 1 }] } },
      { kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 0.5 }] } },
      { kind: "irs_transcript", subtype: "irs_wage_income_transcript", income: { taxYear: 2025, amounts: [{ measure: "transcript_wages", amountCents: 1 }] } },
      { kind: "w2", income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages", amountCents: 1 }] }, memberId: "hm_NOT_IN_HOUSEHOLD" },
    ]) {
      expect((await errorOf(saveReviewerExtraction(sgo.orgId, docs[0]!, bad as never, reviewer))).code).toBe("validation_failed");
    }
    const db = await getDb();
    await db.update(schema.documents).set({ sourceDocumentId: "doc_SYNTHETIC_SOURCE" }).where(eq(schema.documents.id, docs[0]!));
    const keyed = { kind: "w2" as const, income: { taxYear: 2025, amounts: [{ measure: "w2_box1_wages" as const, amountCents: 1 }] } };
    expect(await errorOf(saveReviewerExtraction(sgo.orgId, docs[0]!, keyed, reviewer))).toMatchObject({ code: "forbidden", details: { reason: "carried_over_document" } });
    expect(await errorOf(getDocumentForReview(sgo.orgId, docs[0]!, reviewer))).toMatchObject({ code: "forbidden", details: { reason: "carried_over_document" } });
    await db.update(schema.documents).set({ sourceDocumentId: null }).where(eq(schema.documents.id, docs[0]!));
    await db.update(schema.verifications).set({ status: "pending", stage: "processing" }).where(eq(schema.verifications.id, verification.id));
    expect(await errorOf(saveReviewerExtraction(sgo.orgId, docs[0]!, keyed, reviewer))).toMatchObject({ code: "conflict", details: { reason: "verification_not_in_review" } });
    expect(await errorOf(rerunDecision(sgo.orgId, verification.id, reviewer))).toMatchObject({ code: "conflict", details: { reason: "verification_not_in_review" } });
  });

  it("roles: viewers read the detail but cannot open files or act; API keys get neither; purged files are gone", async () => {
    const { sgo, verification, docs, reviewer } = await submittedWith([{ bytes: await photoW2(), kind: "w2", filename: "w2.png", contentType: "image/png" }]);
    const viewer = await makeStaff(sgo.orgId, "viewer", "viewer-two@example.org");
    const key = { type: "api_key" as const, id: "key_SYNTHETIC", mode: "test" as const };
    expect((await getVerificationDetail(sgo.orgId, verification.id, viewer)).verification.id).toBe(verification.id);
    expect((await errorOf(getDocumentForReview(sgo.orgId, docs[0]!, viewer))).code).toBe("forbidden");
    expect((await errorOf(assignReview(sgo.orgId, verification.id, null, viewer))).code).toBe("forbidden");
    expect((await errorOf(rerunDecision(sgo.orgId, verification.id, viewer))).code).toBe("forbidden");
    expect((await errorOf(requestMoreInfo(sgo.orgId, verification.id, { message: "m", items: ["i"] }, viewer))).code).toBe("forbidden");
    expect((await errorOf(getVerificationDetail(sgo.orgId, verification.id, key))).code).toBe("forbidden");
    expect((await errorOf(getDocumentForReview(sgo.orgId, docs[0]!, key))).code).toBe("forbidden");
    // A viewer cannot be assigned; an unknown user cannot be assigned.
    expect((await errorOf(assignReview(sgo.orgId, verification.id, viewer.id, reviewer))).code).toBe("validation_failed");
    expect((await errorOf(assignReview(sgo.orgId, verification.id, "usr_NOBODY", reviewer))).code).toBe("validation_failed");
    const owner = await userByEmail(sgo.ownerEmail);
    expect((await assignReview(sgo.orgId, verification.id, owner.id, reviewer)).assignedTo).toBe(owner.id);
    expect((await assignReview(sgo.orgId, verification.id, null, reviewer)).assignedTo).toBeNull();

    const db = await getDb();
    await db.update(schema.documents).set({ purgedAt: new Date(TEST_NOW) }).where(eq(schema.documents.id, docs[0]!));
    expect((await errorOf(getDocumentForReview(sgo.orgId, docs[0]!, reviewer))).code).toBe("gone");
  });

  it("the review queue is oldest first, paginates without repeats and validates its parameters", async () => {
    const sgo = await makeTestSgo();
    const db = await getDb();
    const ids: string[] = [];
    const { createVerification } = await import("./create");
    const { baseCreate } = await import("./test-support");
    for (let i = 0; i < 5; i++) {
      setTestNow(new Date(Date.parse(TEST_NOW) + i * 60_000));
      const v = (await createVerification(baseCreate(sgo.orgId, { externalRef: `Q-${i}` }))).verification;
      await db.update(schema.verifications).set({ status: "needs_review", stage: "in_review" }).where(eq(schema.verifications.id, v.id));
      await db.insert(schema.reviewTasks).values({ id: `rev_SYNTHETIC0000000000000${i}`, verificationId: v.id, orgId: sgo.orgId, reasons: [{ code: "no_documentary_evidence", message: "synthetic" }], createdAt: new Date(Date.parse(TEST_NOW) + i * 60_000) });
      ids.push(v.id);
    }
    setTestNow(new Date(Date.parse(TEST_NOW) + 3 * 86_400_000));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listReviewQueue>> = await listReviewQueue(sgo.orgId, { mode: "test", limit: 2, cursor });
      seen.push(...page.items.map((i) => i.verificationId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids);
    expect((await listReviewQueue(sgo.orgId, { mode: "test" })).items[0]?.ageDays).toBe(3);
    expect((await listReviewQueue(sgo.orgId, { mode: "live" })).items).toEqual([]);
    for (const bad of [{ mode: "prod" }, { mode: "test", limit: 0 }, { mode: "test", limit: 101 }, { mode: "test", cursor: "junk" }, { mode: "test", extra: 1 }]) {
      expect((await errorOf(listReviewQueue(sgo.orgId, bad as never))).code).toBe("validation_failed");
    }
  });
});
