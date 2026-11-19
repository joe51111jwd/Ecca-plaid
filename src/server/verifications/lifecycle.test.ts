import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { generateSyntheticDocument } from "@/engine/documents/synthetic";
import { verifySignedEvidenceWithPlatformKey, type SignedEvidence } from "@/engine/evidence";
import { setTestNow } from "@/lib/clock";
import { decryptJson } from "@/lib/crypto";
import { listOutbox } from "@/server/email";
import { listEvents } from "@/server/events";
import { useTestDb } from "../../../tests/helpers/db";
import { signCertification } from "./certifications";
import { addDocument, EXTRACTION_PURPOSE } from "./documents";
import { getFamilyVerification } from "./family";
import { getEvidenceObject, getVerification } from "./org";
import { toApiVerification } from "./serialize";
import { submit } from "./submit";
import { drainJobs, hideEnumerableArrayExtensions, makeTestFamily, makeTestSgo, startedVerification, TEST_NOW } from "./test-support";

/** SYNTHETIC: a 2025 Form W-2 for the synthetic owner "Dana Sample". */
async function danaW2(box1Cents = 4_125_000): Promise<Uint8Array> {
  return generateSyntheticDocument("w2", {
    statements: [
      {
        taxYear: 2025,
        copy: "B",
        employeeSsn: "000-00-0001",
        employerEin: "00-0000001",
        employerName: "FIXTURE FOODS LLC",
        employerAddress: { street: "500 SAMPLE PARKWAY", cityStateZip: "HOUSTON TX 77002" },
        controlNumber: "SYN-W2-0001",
        employeeFirst: "DANA",
        employeeLast: "SAMPLE",
        box1Cents,
        box2Cents: 210_000,
        box3Cents: box1Cents,
        box4Cents: 266_600,
        box5Cents: box1Cents,
        box6Cents: 62_350,
      },
    ],
  });
}

/** Dead jobs of this module and the services it uses ("handoff.verification_updated" belongs to the handoffs module). */
async function deadJobs() {
  const db = await getDb();
  return (await db.select().from(schema.jobs).where(eq(schema.jobs.status, "dead"))).filter((j) => j.type !== "handoff.verification_updated");
}

describe("verification lifecycle (synthetic documents)", () => {
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

  it("direct method: a W-2 and a no-other-income statement decide eligible, then evidence, then verification.decided", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family, { handoffId: "ho_SYNTHETIC0000000000001" });

    const added = await addDocument({ verificationId: verification.id, declaredKind: "w2", memberId: family.ownerMemberId, bytes: await danaW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    expect(added.duplicate).toBe(false);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    expect(await deadJobs()).toEqual([]);

    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row).toMatchObject({ status: "eligible", stage: "decided", method: "direct", decidedBy: "engine", householdSize: 2, countyFips: "48201", provisional: true, incomeYear: 2025, applicationDate: "2026-11-18" });
    expect(row.householdIncomeCents).toBe(4_125_000);
    expect(row.expiresAt?.toISOString()).toBe("2027-01-01T06:00:00.000Z");
    expect(row.evidencePdfObjectId).toBeTruthy();
    expect(row.evidenceJsonObjectId).toBeTruthy();

    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, added.document.id));
    expect(doc.status).toBe("extracted");
    expect(doc.purgeAfter?.toISOString()).toBe(new Date(Date.parse(row.decidedAt!.toISOString()) + 30 * 86_400_000).toISOString());
    // The extraction is stored encrypted, never in clear text.
    expect(doc.extractionEnc?.startsWith("v1.")).toBe(true);
    expect(doc.extractionEnc).not.toContain("DANA");
    expect(decryptJson<{ detectedKind: string }>(doc.extractionEnc!, EXTRACTION_PURPOSE).detectedKind).toBe("w2");
    const items = await db.select().from(schema.incomeItems).where(eq(schema.incomeItems.verificationId, verification.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "document", documentId: doc.id, annualAmountCents: 4_125_000 });

    // The API shape: no income, no names, no family link.
    const api = toApiVerification(row, { baseUrl: "https://app.example.org" });
    expect(api.evidence_pack_url).toBe(`https://app.example.org/api/v1/verifications/${row.id}/evidence.pdf`);
    expect(api.consent?.version).toBe("verification_share.v1");
    expect(api.threshold_readings.length).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(api);
    expect(json).not.toMatch(/Dana|Riley|dana@example|41250|41,250|4125000/);
    expect(json).not.toContain("/v/");

    // Evidence: signed, verifiable, downloadable, carries the household income.
    const ev = await getEvidenceObject(sgo.orgId, row.id, "json", { type: "api_key", id: "key_SYNTHETIC", mode: "test" });
    const signed = JSON.parse(ev.bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(signed).valid).toBe(true);
    expect(signed.record.income?.total_counted_cents).toBe(4_125_000);
    expect(signed.record.decision.status).toBe("eligible");
    expect(signed.record.additional_consents.some((c) => c.kind === "income_certification_no_other_income")).toBe(true);
    const pdf = await getEvidenceObject(sgo.orgId, row.id, "pdf", { type: "user", id: "usr_SYNTHETIC", mode: "test" });
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const downloads = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "evidence.download"));
    expect(downloads).toHaveLength(2);

    // Event order: decided is emitted with evidence URLs in the payload.
    const events = (await listEvents({ orgId: sgo.orgId })).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["verification.started", "verification.submitted", "verification.decided"]));
    const [decided] = await listEvents({ orgId: sgo.orgId, type: "verification.decided" });
    expect(decided.payload.evidence_json_url).toBeTruthy();
    expect(decided.payload.status).toBe("eligible");
    // The webhook payload is data-minimized too: the engine's reason wording states the income, the payload does not.
    expect(row.decisionReasons.map((r) => r.message).join(" ")).toContain("41,250");
    expect(JSON.stringify(decided.payload)).not.toMatch(/Dana|Riley|41,250|41250/);

    // The family was told in plain language; the handoff job was queued.
    const outcome = await listOutbox({ to: "dana@example.com", template: "verification_outcome" });
    expect(outcome).toHaveLength(1);
    expect(outcome[0].text).toContain("not a scholarship award");
    expect(outcome[0].text).not.toMatch(/41,250|\$41/);
    const handoffJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "handoff.verification_updated"));
    expect(handoffJobs).toHaveLength(1);
    expect(handoffJobs[0].payload).toEqual({ handoffId: "ho_SYNTHETIC0000000000001", verificationId: row.id });

    const view = await getFamilyVerification(row.id, family.actor);
    expect(view.status).toBe("eligible");
    expect(view.explanation?.headline).toBeTruthy();
  });

  it("categorical method: the parser's SSI reading is below the engine's confidence bar, so it goes to review; once a reviewer confirms the fields it decides eligible", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const letter = await generateSyntheticDocument("ssa_benefit_verification", { date: "2026-10-02", addressee: "RILEY SAMPLE", ssi: { beginning: "2026-01-01", amountCents: 50_000, type: "a disabled child" } });
    const added = await addDocument({ verificationId: verification.id, declaredKind: "award_letter", bytes: letter, filename: "ssi.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    expect(await deadJobs()).toEqual([]);
    const reviewed = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(reviewed).toMatchObject({ status: "needs_review", method: null });
    expect(reviewed.decisionReasons.map((r) => r.code)).toContain("letter_low_extraction_confidence");

    // Stand-in for the review module: a reviewer confirmed the parser's fields, and the file is decided again.
    const db = await getDb();
    await db.update(schema.documents).set({ extractedBy: "reviewer" }).where(eq(schema.documents.id, added.document.id));
    await db.update(schema.verifications).set({ status: "pending", stage: "submitted" }).where(eq(schema.verifications.id, verification.id));
    const { decideVerificationJob } = await import("./decide");
    await decideVerificationJob(verification.id);
    await drainJobs();
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row).toMatchObject({ status: "eligible", method: "categorical", awardProgram: "SSI", awardLetterDate: "2026-10-02", householdIncomeCents: null });
    const ev = await getEvidenceObject(sgo.orgId, row.id, "json", { type: "api_key", id: "key_SYNTHETIC", mode: "test" });
    const signed = JSON.parse(ev.bytes.toString("utf8")) as SignedEvidence;
    expect(verifySignedEvidenceWithPlatformKey(signed).valid).toBe(true);
    expect(signed.record.categorical).toMatchObject({ program: "SSI", letter_date: "2026-10-02", issuing_agency: "Social Security Administration" });
    expect(signed.record.income).toBeNull();
  });

  it("an award letter on an unverified layout goes to review: task, event, reviewers emailed, never a silent yes", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const letter = await generateSyntheticDocument("tf0001", {
      noticeDate: "2026-10-20",
      caseNumber: "9990000001",
      addressee: "DANA SAMPLE",
      sections: [{ heading: "SNAP Food Benefits", tables: [{ status: "gets", subject: "SNAP food benefits", rows: [{ name: "DANA SAMPLE", edg: "990000011", program: "SNAP", start: "2026-10-20", end: "2027-03-31" }] }] }],
    });
    await addDocument({ verificationId: verification.id, declaredKind: "award_letter", bytes: letter, filename: "snap.pdf", contentType: "application/pdf" }, family.actor);
    await submit(verification.id, family.actor);
    await drainJobs();
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row).toMatchObject({ status: "needs_review", stage: "in_review", decidedAt: null, evidencePdfObjectId: null });
    const db = await getDb();
    const tasks = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, row.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("open");
    expect(tasks[0].reasons.length).toBeGreaterThan(0);
    expect((await listEvents({ orgId: sgo.orgId, type: "verification.needs_review" })).length).toBe(1);
    const toReviewer = await listOutbox({ template: "verification_needs_review" });
    expect(toReviewer.map((e) => e.toEmail).sort()).toEqual([sgo.ownerEmail, sgo.reviewerEmail].sort());
    expect(toReviewer[0].text).not.toMatch(/Dana|Riley/);
  });

  it("missing evidence for a second adult is pending: awaiting_family and the family is told exactly what is missing, in Spanish", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily("dana@example.com", { extraAdults: [{ firstName: "Sam", lastName: "Sample" }], locale: "es" });
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await danaW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "es" });
    await submit(verification.id, family.actor);
    await drainJobs();
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row).toMatchObject({ status: "pending", stage: "awaiting_family", decidedAt: null });
    const mail = await listOutbox({ to: "dana@example.com", template: "verification_more_information" });
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe("Necesitamos un poco más de información");
    expect(mail[0].text).toContain("Sam");

    // The family adds what was missing and resubmits; the application date is kept.
    setTestNow("2026-11-20T16:00:00.000Z");
    await signCertification(verification.id, family.actor, { kind: "zero_income", memberId: family.otherMemberIds[0], locale: "es" });
    await submit(verification.id, family.actor);
    await drainJobs();
    const after = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(after.status).toBe("eligible");
    expect(after.applicationDate).toBe("2026-11-18");
  });

  it("the decide job waits for a document still being read, then decides once", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await danaW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    const db = await getDb();
    // Run only the decide job first: the document is not read yet.
    const { decideVerificationJob } = await import("./decide");
    await decideVerificationJob(verification.id);
    const [waiting] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(waiting.stage).toBe("processing");
    await drainJobs();
    const decidedEvents = await db.select().from(schema.verificationEvents).where(and(eq(schema.verificationEvents.verificationId, verification.id), eq(schema.verificationEvents.type, "decision.made")));
    expect(decidedEvents).toHaveLength(1);
    expect((await listEvents({ orgId: sgo.orgId, type: "verification.decided" })).length).toBe(1);
    // Re-running every job is harmless.
    const { generateEvidenceJob } = await import("./evidence");
    await decideVerificationJob(verification.id);
    await generateEvidenceJob(verification.id);
    expect((await listEvents({ orgId: sgo.orgId, type: "verification.decided" })).length).toBe(1);
  });

  it("a photo with no text layer and no model reader configured stays in human review", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const png = await generateSyntheticDocument("image_png", { lines: ["SYNTHETIC SAMPLE", "W-2 2025"] });
    await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: png, filename: "w2.png", contentType: "image/png" }, family.actor);
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    await drainJobs();
    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.verificationId, verification.id));
    expect(doc.status).toBe("needs_review");
    expect(doc.reviewReasons.map((r) => r.code)).toContain("no_text_layer");
    const row = await getVerification(sgo.orgId, verification.id, { mode: "test" });
    expect(row.status).toBe("needs_review");
  });
});
