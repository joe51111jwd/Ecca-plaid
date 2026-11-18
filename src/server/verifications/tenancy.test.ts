import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listEvents } from "@/server/events";
import { putObject } from "@/server/storage";
import { useTestDb } from "../../../tests/helpers/db";
import { createVerification } from "./create";
import type { OrgActor } from "./internal";
import { cancelVerification, getEvidenceObject, getVerification, listVerifications, statusCounts } from "./org";
import { baseCreate, errorOf, makeTestSgo, TEST_NOW } from "./test-support";

/**
 * Two SGOs, each with a test-mode and a live-mode verification, and fake evidence objects on SGO A's test row.
 * Every org-facing function must refuse or hide the other tenant's rows and the other mode's rows.
 */
async function twoTenants() {
  const a = await makeTestSgo("Synthetic Fund A");
  const b = await makeTestSgo("Synthetic Fund B");
  const aTest = (await createVerification(baseCreate(a.orgId, { externalRef: "A-T" }))).verification;
  const aLive = (await createVerification(baseCreate(a.orgId, { mode: "live", externalRef: "A-L" }))).verification;
  const bTest = (await createVerification(baseCreate(b.orgId, { externalRef: "B-T" }))).verification;
  const pdf = await putObject({ bytes: Buffer.from("%PDF-1.7 synthetic evidence"), contentType: "application/pdf", purpose: "evidence_pdf", orgId: a.orgId });
  const json = await putObject({ bytes: Buffer.from('{"synthetic":true}'), contentType: "application/json", purpose: "evidence_json", orgId: a.orgId });
  const db = await getDb();
  await db.update(schema.verifications).set({ status: "eligible", stage: "decided", evidencePdfObjectId: pdf.id, evidenceJsonObjectId: json.id, decidedAt: new Date(TEST_NOW), decidedBy: "engine" }).where(eq(schema.verifications.id, aTest.id));
  return { a, b, aTest, aLive, bTest };
}

const actor = (mode: "test" | "live" = "test"): OrgActor => ({ type: "api_key", id: "key_SYNTHETIC0000000000000", mode });

describe("tenant and mode isolation", () => {
  useTestDb();
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("every org-facing function hides the other tenant's and the other mode's verifications", async () => {
    const { a, b, aTest, aLive, bTest } = await twoTenants();

    expect((await getVerification(a.orgId, aTest.id, { mode: "test" })).id).toBe(aTest.id);
    for (const [org, id, mode] of [
      [b.orgId, aTest.id, "test"],
      [a.orgId, bTest.id, "test"],
      [a.orgId, aTest.id, "live"],
      [a.orgId, aLive.id, "test"],
      [a.orgId, "ver_doesnotexist000000000", "test"],
      ["", aTest.id, "test"],
    ] as const) {
      expect((await errorOf(getVerification(org, id, { mode }))).code).toBe("not_found");
      expect((await errorOf(cancelVerification(org, id, actor(mode)))).code).toBe("not_found");
      expect((await errorOf(getEvidenceObject(org, id, "pdf", actor(mode)))).code).toBe("not_found");
    }

    const aList = await listVerifications(a.orgId, { mode: "test" });
    expect(aList.items.map((v) => v.id)).toEqual([aTest.id]);
    expect((await listVerifications(a.orgId, { mode: "live" })).items.map((v) => v.id)).toEqual([aLive.id]);
    expect((await listVerifications(b.orgId, { mode: "test" })).items.map((v) => v.id)).toEqual([bTest.id]);
    expect((await listVerifications(b.orgId, { mode: "test", externalRef: "A-T" })).items).toEqual([]);

    expect(await statusCounts(a.orgId, "test")).toMatchObject({ eligible: 1, pending: 0, total: 1 });
    expect(await statusCounts(a.orgId, "live")).toMatchObject({ pending: 1, total: 1 });
    expect(await statusCounts(b.orgId, "test")).toMatchObject({ pending: 1, eligible: 0, total: 1 });

    // A's own evidence downloads, audited; B never gets it even with a forged object id swap.
    const file = await getEvidenceObject(a.orgId, aTest.id, "json", actor());
    expect(file.bytes.toString()).toBe('{"synthetic":true}');
    const db = await getDb();
    await db.update(schema.verifications).set({ evidencePdfObjectId: aTest.evidencePdfObjectId ?? (await getVerification(a.orgId, aTest.id, { mode: "test" })).evidencePdfObjectId, status: "eligible" }).where(eq(schema.verifications.id, bTest.id));
    expect((await errorOf(getEvidenceObject(b.orgId, bTest.id, "pdf", actor()))).code).toBe("not_found");
  });

  it("the same id cannot be canceled across tenants and cancel emits to the owning tenant only", async () => {
    const { a, b, bTest } = await twoTenants();
    const canceled = await cancelVerification(b.orgId, bTest.id, actor());
    expect(canceled.status).toBe("canceled");
    expect(await listEvents({ orgId: b.orgId, type: "verification.canceled" })).toHaveLength(1);
    expect(await listEvents({ orgId: a.orgId, type: "verification.canceled" })).toHaveLength(0);
    expect(await errorOf(cancelVerification(b.orgId, bTest.id, actor()))).toMatchObject({ code: "conflict", details: { reason: "verification_canceled" } });
  });
});

describe("listing, reading, canceling, counting", () => {
  useTestDb();
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("keyset-paginates newest first without gaps or repeats, including rows created at the same instant", async () => {
    const sgo = await makeTestSgo();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (i % 3 === 0) setTestNow(new Date(Date.parse(TEST_NOW) + i * 1000));
      ids.push((await createVerification(baseCreate(sgo.orgId, { externalRef: `R-${i}` }))).verification.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listVerifications>> = await listVerifications(sgo.orgId, { mode: "test", limit: 3, cursor });
      seen.push(...page.items.map((v) => v.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(ids));
    const all = await listVerifications(sgo.orgId, { mode: "test", limit: 100 });
    expect(all.items.map((v) => v.id)).toEqual(seen);
    expect(all.nextCursor).toBeNull();
  });

  it("filters by status and external reference and validates its parameters", async () => {
    const sgo = await makeTestSgo();
    const one = (await createVerification(baseCreate(sgo.orgId, { externalRef: "X-1" }))).verification;
    await createVerification(baseCreate(sgo.orgId, { externalRef: "X-2" }));
    await cancelVerification(sgo.orgId, one.id, actor());
    expect((await listVerifications(sgo.orgId, { mode: "test", status: "canceled" })).items.map((v) => v.id)).toEqual([one.id]);
    expect((await listVerifications(sgo.orgId, { mode: "test", externalRef: "X-2" })).items).toHaveLength(1);
    for (const bad of [{ mode: "prod" }, { mode: "test", limit: 0 }, { mode: "test", limit: 101 }, { mode: "test", status: "approved" }, { mode: "test", cursor: "not-a-cursor" }, { mode: "test", cursor: Buffer.from('{"t":"x","id":"y"}').toString("base64url") }]) {
      expect((await errorOf(listVerifications(sgo.orgId, bad as never))).code).toBe("validation_failed");
    }
  });

  it("getVerification audits reads when an actor is given; cancel refuses decided verifications", async () => {
    const { a, aTest, aLive } = await twoTenants();
    await getVerification(a.orgId, aLive.id, { mode: "live", actor: actor("live") });
    const db = await getDb();
    const reads = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "verification.read"));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ actorType: "api_key", orgId: a.orgId, targetId: aLive.id });
    expect(await errorOf(cancelVerification(a.orgId, aTest.id, actor()))).toMatchObject({ code: "conflict", details: { reason: "verification_decided" } });
  });

  it("cancel closes open review tasks", async () => {
    const sgo = await makeTestSgo();
    const v = (await createVerification(baseCreate(sgo.orgId))).verification;
    const db = await getDb();
    await db.update(schema.verifications).set({ status: "needs_review", stage: "in_review" }).where(eq(schema.verifications.id, v.id));
    await db.insert(schema.reviewTasks).values({ id: "rev_SYNTHETIC00000000000001", verificationId: v.id, orgId: sgo.orgId });
    await cancelVerification(sgo.orgId, v.id, { type: "user", id: "usr_SYNTHETIC", mode: "test" });
    const [task] = await db.select().from(schema.reviewTasks).where(eq(schema.reviewTasks.verificationId, v.id));
    expect(task).toMatchObject({ status: "resolved", resolution: "canceled" });
  });

  it("evidence downloads require a decided verification with evidence and a known kind", async () => {
    const sgo = await makeTestSgo();
    const v = (await createVerification(baseCreate(sgo.orgId))).verification;
    expect((await errorOf(getEvidenceObject(sgo.orgId, v.id, "pdf", actor()))).code).toBe("not_found");
    expect((await errorOf(getEvidenceObject(sgo.orgId, v.id, "xml" as never, actor()))).code).toBe("validation_failed");
    expect((await errorOf(statusCounts(sgo.orgId, "staging" as never))).code).toBe("validation_failed");
  });
});
