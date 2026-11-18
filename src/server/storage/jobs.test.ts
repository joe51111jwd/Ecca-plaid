import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAuditLogs } from "@/server/audit";
import { useTestDb } from "../../../tests/helpers/db";
import { MemoryObjectStore, getObjectBytes, getObjectMeta, putObject, setObjectStoreForTests } from "./index";
import { jobHandlers, recurringJobs } from "./jobs";

const ctx = { jobId: "job_test", attempt: 1 };

describe("storage jobs", () => {
  useTestDb();
  let store: MemoryObjectStore;
  beforeEach(() => {
    store = new MemoryObjectStore();
    setObjectStoreForTests(store);
  });
  afterEach(() => setObjectStoreForTests(null));

  it("exports the registry shape", () => {
    expect(Object.keys(jobHandlers)).toEqual(["storage.purge_object"]);
    expect(recurringJobs).toEqual([]);
  });

  it("storage.purge_object deletes the bytes and is safe to retry", async () => {
    const meta = await putObject({ bytes: Buffer.from("SYNTHETIC upload"), contentType: "application/pdf", purpose: "upload", orgId: "org_a" });
    await jobHandlers["storage.purge_object"]({ objectId: meta.id, reason: "retention" }, ctx);
    expect(store.size).toBe(0);
    await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "gone" });
    const purged = await getObjectMeta(meta.id);
    expect(purged).toMatchObject({ deleteReason: "retention", sha256: meta.sha256 });

    await jobHandlers["storage.purge_object"]({ objectId: meta.id, reason: "retention" }, { ...ctx, attempt: 2 });
    expect(await getObjectMeta(meta.id)).toEqual(purged);
    expect((await listAuditLogs({ action: "object.purge" })).items).toHaveLength(1);
  });

  it("fails loudly on a malformed payload or an unknown object, so the job is retried and surfaced", async () => {
    await expect(jobHandlers["storage.purge_object"]({}, ctx)).rejects.toThrow();
    await expect(jobHandlers["storage.purge_object"]({ objectId: "", reason: "retention" }, ctx)).rejects.toThrow();
    await expect(jobHandlers["storage.purge_object"]({ objectId: "obj_1", reason: "  " }, ctx)).rejects.toThrow();
    await expect(jobHandlers["storage.purge_object"]({ objectId: "obj_missing", reason: "retention" }, ctx)).rejects.toMatchObject({ code: "not_found" });
  });
});
