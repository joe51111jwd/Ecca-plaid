import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listEvents } from "@/server/events";
import { allRecurringJobs } from "@/server/jobs/registry";
import { getObjectBytes, getObjectMeta } from "@/server/storage";
import { syntheticFile } from "@/server/storage/testing";
import { useTestDb } from "../../../tests/helpers/db";
import { addDocument } from "./documents";
import { cancelVerification } from "./org";
import { expireDueVerifications, purgeDueUploads } from "./retention";
import { errorOf, makeTestFamily, makeTestSgo, startedVerification, TEST_NOW } from "./test-support";

describe("retention and expiry", () => {
  useTestDb();
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => {
    setTestNow(null);
    vi.restoreAllMocks();
  });

  it("purges raw uploads after their date, keeping the row, the hash and the extraction", async () => {
    const sgo = await makeTestSgo("Synthetic Fund", { rawRetentionDays: 10 });
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const { document } = await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: syntheticFile("pdf"), filename: "a.pdf", contentType: "application/pdf" }, family.actor);
    const db = await getDb();
    await db.update(schema.documents).set({ extractionEnc: "v1.synthetic.kept.value" }).where(eq(schema.documents.id, document.id));
    expect(await purgeDueUploads()).toEqual({ purged: 0, failed: 0, abandoned: 0 });

    await cancelVerification(sgo.orgId, verification.id, { type: "api_key", id: "key_x", mode: "test" });
    const [scheduled] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(scheduled.purgeAfter?.toISOString()).toBe("2026-11-28T16:00:00.000Z");
    setTestNow("2026-11-28T15:59:59.000Z");
    expect(await purgeDueUploads()).toEqual({ purged: 0, failed: 0, abandoned: 0 });
    setTestNow("2026-11-28T16:00:00.000Z");
    expect(await purgeDueUploads()).toEqual({ purged: 1, failed: 0, abandoned: 0 });
    expect(await purgeDueUploads()).toEqual({ purged: 0, failed: 0, abandoned: 0 });

    const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(row.purgedAt?.toISOString()).toBe("2026-11-28T16:00:00.000Z");
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.extractionEnc).toBe("v1.synthetic.kept.value");
    expect((await getObjectMeta(row.objectId)).deletedAt).not.toBeNull();
    expect((await errorOf(getObjectBytes(row.objectId))).code).toBe("gone");
  });

  it("expires decided results past their expiry and emits verification.expired once", async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const { verification } = await startedVerification(sgo, family);
    const db = await getDb();
    await db.update(schema.verifications).set({ status: "eligible", stage: "decided", decidedAt: new Date(TEST_NOW), decidedBy: "engine", expiresAt: new Date("2027-01-01T06:00:00.000Z") }).where(eq(schema.verifications.id, verification.id));
    expect(await expireDueVerifications()).toBe(0);
    setTestNow("2027-01-01T06:00:00.000Z");
    expect(await expireDueVerifications()).toBe(1);
    expect(await expireDueVerifications()).toBe(0);
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, verification.id));
    expect(row.status).toBe("expired");
    const events = await listEvents({ orgId: sgo.orgId, type: "verification.expired" });
    expect(events).toHaveLength(1);
    expect(events[0].payload.status).toBe("expired");
  });

  it("is scheduled through the job registry", () => {
    const types = allRecurringJobs().map((j) => j.type);
    expect(types).toEqual(expect.arrayContaining(["retention.purge", "verification.expire"]));
  });
});
