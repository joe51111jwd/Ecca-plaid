import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { getObjectBytes } from "@/server/storage";
import { syntheticFile } from "@/server/storage/testing";
import { useTestDb } from "../../../tests/helpers/db";
import { addDocument, listDocuments, removeDocument } from "./documents";
import { extractDocumentJob } from "./extract";
import { DOCUMENT_LIMITS } from "./policy";
import { submit } from "./submit";
import { signCertification } from "./certifications";
import { errorOf, hideEnumerableArrayExtensions, makeTestFamily, makeTestSgo, startedVerification, TEST_NOW, userByEmail } from "./test-support";

/** A distinct SYNTHETIC PDF per call (same container, different filler). */
function uniquePdf(n: number): Buffer {
  return Buffer.concat([syntheticFile("pdf"), Buffer.from(`\n% synthetic variant ${n}\n`, "latin1")]);
}

describe("documents", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("stores the upload encrypted with a server-side hash, queues extraction, and moves the stage to collecting", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const bytes = uniquePdf(1);
    const { document, duplicate } = await addDocument({ verificationId: verification.id, declaredKind: "pay_stub", memberId: family.ownerMemberId, bytes, filename: "../../etc/passwd", contentType: "application/pdf" }, family.actor);
    expect(duplicate).toBe(false);
    expect(document).toMatchObject({ status: "uploaded", declaredKind: "pay_stub", memberId: family.ownerMemberId, contentType: "application/pdf", size: bytes.length });
    expect(document.filename).not.toContain("/");
    const db = await getDb();
    const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(row.sha256).toBe(sha256Hex(bytes));
    expect(Buffer.compare(await getObjectBytes(row.objectId, { orgId: sgo.orgId }), bytes)).toBe(0);
    const [object] = await db.select().from(schema.objects).where(eq(schema.objects.id, row.objectId));
    expect(object).toMatchObject({ purpose: "upload", orgId: sgo.orgId, householdId: family.householdId });
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "document.extract"));
    expect(jobs.map((j) => j.payload)).toEqual([{ documentId: document.id }]);
    const [v] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(v.stage).toBe("collecting");
  });

  it("recognises the same file uploaded twice and does not store it again", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const bytes = uniquePdf(2);
    const first = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes, filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    const second = await addDocument({ verificationId: verification.id, declaredKind: "tax_return", bytes, filename: "b.pdf", contentType: "application/pdf" }, family.actor);
    expect(second).toMatchObject({ duplicate: true, document: { id: first.document.id } });
    const db = await getDb();
    expect(await db.select().from(schema.objects)).toHaveLength(1);
    // After taking it back, the same file may be added again.
    await removeDocument(first.document.id, family.actor);
    const third = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes, filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    expect(third.duplicate).toBe(false);
  });

  it("validates the file, the kind, the member and the per-verification limit", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const other = await makeTestFamily("other@example.com");
    const { verification } = await startedVerification(sgo, family);
    const base = { verificationId: verification.id, declaredKind: "w2" as const, filename: "a.pdf", contentType: "application/pdf" };
    expect(await errorOf(addDocument({ ...base, bytes: Buffer.from("<html><script>alert(1)</script></html>") }, family.actor))).toMatchObject({ code: "validation_failed" });
    expect(await errorOf(addDocument({ ...base, bytes: new Uint8Array(0) }, family.actor))).toMatchObject({ code: "validation_failed" });
    expect(await errorOf(addDocument({ ...base, bytes: syntheticFile("png") }, family.actor))).toMatchObject({ code: "validation_failed", details: { reason: "type_mismatch" } });
    expect(await errorOf(addDocument({ ...base, declaredKind: "selfie" as never, bytes: uniquePdf(3) }, family.actor))).toMatchObject({ code: "validation_failed" });
    expect(await errorOf(addDocument({ ...base, memberId: other.ownerMemberId, bytes: uniquePdf(4) }, family.actor))).toMatchObject({ code: "validation_failed" });

    for (let i = 0; i < DOCUMENT_LIMITS.maxActiveDocuments; i++) await addDocument({ ...base, bytes: uniquePdf(100 + i) }, family.actor);
    expect(await errorOf(addDocument({ ...base, bytes: uniquePdf(999) }, family.actor))).toMatchObject({ code: "conflict", details: { reason: "too_many_documents" } });
    expect(await listDocuments(verification.id, family.actor)).toHaveLength(DOCUMENT_LIMITS.maxActiveDocuments);
  });

  it("a linked adult may upload; the upload needs the sharing consent", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const partner = await userByEmail("partner@example.com");
    const db = await getDb();
    await db.insert(schema.householdMembers).values({ id: newId("member"), householdId: family.householdId, kind: "adult", firstName: "Pat", lastName: "Sample", userId: partner.id });
    const res = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: uniquePdf(5), filename: "a.pdf", contentType: "application/pdf" }, { userId: partner.id });
    expect(res.duplicate).toBe(false);
    await db.update(schema.consents).set({ revokedAt: new Date(TEST_NOW) }).where(eq(schema.consents.verificationId, verification.id));
    expect(await errorOf(addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: uniquePdf(6), filename: "a.pdf", contentType: "application/pdf" }, family.actor))).toMatchObject({ code: "forbidden", details: { reason: "consent_revoked" } });
  });

  it("removing a document purges its bytes, keeps its hash, deletes its income lines and is idempotent", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const { document } = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: uniquePdf(7), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    const db = await getDb();
    await db.insert(schema.incomeItems).values({ id: newId("incomeItem"), verificationId: verification.id, source: "document", category: "wages_salary", incomeYear: 2025, annualAmountCents: 1, documentId: document.id });
    const removed = await removeDocument(document.id, family.actor);
    expect(removed.status).toBe("purged");
    const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(row.removedAt).not.toBeNull();
    expect(row.purgedAt).not.toBeNull();
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await errorOf(getObjectBytes(row.objectId))).code).toBe("gone");
    expect(await db.select().from(schema.incomeItems).where(eq(schema.incomeItems.documentId, document.id))).toHaveLength(0);
    expect(await listDocuments(verification.id, family.actor)).toHaveLength(0);
    expect((await removeDocument(document.id, family.actor)).id).toBe(document.id);
    // The extraction job leaves a removed document alone.
    await extractDocumentJob(document.id);
    const [after] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(after.status).toBe("purged");
    expect(after.extractionEnc).toBeNull();
  });

  it("a stranger cannot see or remove the documents; removal after submit is refused", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const stranger = await makeTestFamily("stranger@example.com");
    const { verification } = await startedVerification(sgo, family);
    const { document } = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: uniquePdf(8), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    expect((await errorOf(removeDocument(document.id, stranger.actor))).code).toBe("not_found");
    expect((await errorOf(listDocuments(verification.id, stranger.actor))).code).toBe("not_found");
    expect((await errorOf(removeDocument("doc_nope", family.actor))).code).toBe("not_found");
    await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
    await submit(verification.id, family.actor);
    expect(await errorOf(removeDocument(document.id, family.actor))).toMatchObject({ code: "conflict", details: { reason: "verification_locked" } });
  });

  it("extraction is idempotent and records only codes in the timeline and audit log", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const { document } = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: uniquePdf(9), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    await extractDocumentJob(document.id);
    await extractDocumentJob(document.id);
    const db = await getDb();
    const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(row.status).toBe("needs_review");
    const events = await db.select().from(schema.verificationEvents).where(eq(schema.verificationEvents.type, "document.extracted"));
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0].data).sort()).toEqual(["detectedKind", "documentId", "extractedBy", "reasonCodes", "status"]);
  });
});
