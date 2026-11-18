import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type DbOrTx } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listAuditLogs } from "@/server/audit";
import { useTestDb } from "../../../tests/helpers/db";
import {
  LocalFsStore,
  MAX_OBJECT_BYTES,
  MemoryObjectStore,
  PURGED_WRAPPED_KEY,
  getObjectBytes,
  getObjectMeta,
  getObjectStore,
  objectResponse,
  purgeObject,
  putObject,
  setObjectStoreForTests,
  validateUpload,
} from "./index";
import { syntheticFile } from "./testing";

const MARKER = "SYNTHETIC-PLAINTEXT-MARKER";
const sample = Buffer.from(`${MARKER} synthetic pay stub for a test household, not a real document`);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("encrypted object storage", () => {
  const t = useTestDb();
  let store: MemoryObjectStore;

  beforeEach(() => {
    store = new MemoryObjectStore();
    setObjectStoreForTests(store);
    setTestNow("2026-12-01T12:00:00.000Z");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setObjectStoreForTests(null);
    setTestNow(null);
  });

  const dbRow = async (id: string) => (await t.db.select().from(schema.objects).where(eq(schema.objects.id, id)))[0];
  const put = (overrides: Partial<Parameters<typeof putObject>[0]> = {}) =>
    putObject({ bytes: sample, contentType: "application/pdf", purpose: "upload", filename: "pay stub.pdf", orgId: "org_a", householdId: "hh_1", ...overrides });

  describe("putObject", () => {
    it("records the object and returns its metadata without storage internals", async () => {
      const meta = await put();
      expect(meta).toEqual({
        id: expect.stringMatching(/^obj_/),
        purpose: "upload",
        sha256: sha256(sample),
        size: sample.length,
        contentType: "application/pdf",
        filename: "pay stub.pdf",
        orgId: "org_a",
        householdId: "hh_1",
        createdAt: new Date("2026-12-01T12:00:00.000Z"),
        deletedAt: null,
        deleteReason: null,
      });
      expect(meta).not.toHaveProperty("storageKey");
      expect(meta).not.toHaveProperty("wrappedKey");
    });

    it("stores only ciphertext, under a random key that says nothing about the file", async () => {
      const meta = await put({ filename: "Maria Garcia W-2.pdf", orgId: "org_a", householdId: "hh_garcia" });
      const row = await dbRow(meta.id);
      expect(row.storageKey).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{46}$/);
      for (const leak of ["Maria", "Garcia", "W-2", "pdf", "org_a", "hh_garcia", meta.id, "upload"]) expect(row.storageKey).not.toContain(leak);
      expect(store.keys()).toEqual([row.storageKey]);

      const blob = (await store.get(row.storageKey))!;
      expect(blob.subarray(0, 4).toString("ascii")).toBe("ECCA");
      expect(blob).toHaveLength(sample.length + 33);
      expect(blob.includes(Buffer.from(MARKER))).toBe(false);
      expect(blob.includes(sample.subarray(0, 16))).toBe(false);
      expect(row.wrappedKey).toMatch(/^v1\./);
    });

    it("uses a different key and ciphertext for identical files", async () => {
      const a = await dbRow((await put()).id);
      const b = await dbRow((await put()).id);
      expect(a.sha256).toBe(b.sha256);
      expect(a.storageKey).not.toBe(b.storageKey);
      expect(a.wrappedKey).not.toBe(b.wrappedKey);
      const [blobA, blobB] = [await store.get(a.storageKey), await store.get(b.storageKey)];
      expect(blobA!.subarray(33).equals(blobB!.subarray(33))).toBe(false);
    });

    it("normalizes the content type and sanitizes the file name", async () => {
      const meta = await put({ contentType: "  Text/CSV; charset=utf-8 ", purpose: "export", filename: "../../etc/report\r\n.csv" });
      expect(meta.contentType).toBe("text/csv; charset=utf-8");
      expect(meta.filename).toBe("report.csv");
      expect((await put({ filename: undefined })).filename).toBeNull();
      expect((await put({ filename: "" })).filename).toBeNull();
      expect((await put({ orgId: undefined, householdId: undefined })).orgId).toBeNull();
    });

    it("rejects empty, oversized and malformed input before storing anything", async () => {
      await expect(put({ bytes: new Uint8Array(0) })).rejects.toMatchObject({ code: "bad_request" });
      await expect(put({ bytes: new Uint8Array(MAX_OBJECT_BYTES + 1) })).rejects.toMatchObject({ code: "bad_request" });
      await expect(put({ bytes: "text" as unknown as Uint8Array })).rejects.toMatchObject({ code: "internal" });
      await expect(put({ purpose: "malware" as never })).rejects.toMatchObject({ code: "internal" });
      for (const contentType of ["", "pdf", "application/pdf\r\nX-Injected: 1", "text/html, text/plain", "a/b; c", "x".repeat(300) + "/y"]) {
        await expect(put({ contentType }), contentType).rejects.toMatchObject({ code: "bad_request" });
      }
      expect(store.size).toBe(0);
      expect(await t.db.select().from(schema.objects)).toHaveLength(0);
    });

    it("removes the bytes again when the index row cannot be written", async () => {
      const brokenDb = {
        insert() {
          throw new Error("database unavailable");
        },
      } as unknown as DbOrTx;
      await expect(putObject({ bytes: sample, contentType: "application/pdf", purpose: "upload" }, brokenDb)).rejects.toThrow("database unavailable");
      expect(store.size).toBe(0);
    });

    it("does not write a row when the object store rejects the bytes", async () => {
      vi.spyOn(store, "put").mockRejectedValue(new Error("bucket unavailable"));
      await expect(put()).rejects.toThrow("bucket unavailable");
      expect(await t.db.select().from(schema.objects)).toHaveLength(0);
    });

    it("joins the caller's transaction; a rollback leaves only unreadable ciphertext behind", async () => {
      await expect(
        t.db.transaction(async (tx) => {
          const meta = await putObject({ bytes: sample, contentType: "application/pdf", purpose: "upload" }, tx);
          expect(await getObjectBytes(meta.id, null, tx)).toEqual(sample);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await t.db.select().from(schema.objects)).toHaveLength(0);
      for (const key of store.keys()) expect((await store.get(key))!.includes(Buffer.from(MARKER))).toBe(false);
    });

    it("works end to end with a validated upload", async () => {
      const bytes = syntheticFile("heic");
      const upload = validateUpload({ bytes, contentType: "", filename: "IMG_0042.HEIC" });
      const meta = await putObject({ bytes, contentType: upload.contentType, filename: upload.filename, purpose: "upload", householdId: "hh_1" });
      expect(meta).toMatchObject({ contentType: "image/heic", filename: "IMG_0042.heic", size: bytes.length });
      expect(await getObjectBytes(meta.id)).toEqual(bytes);
    });
  });

  describe("getObjectBytes / getObjectMeta", () => {
    it("decrypts back to the exact bytes", async () => {
      const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
      const meta = await put({ bytes: binary });
      const read = await getObjectBytes(meta.id);
      expect(read.equals(binary)).toBe(true);
      expect(sha256(read)).toBe(meta.sha256);
      expect(await getObjectMeta(meta.id)).toEqual(meta);
    });

    it("reports unknown ids as not found", async () => {
      for (const id of ["obj_doesnotexist", "", "' or 1=1 --"]) {
        await expect(getObjectBytes(id)).rejects.toMatchObject({ code: "not_found", status: 404 });
        await expect(getObjectMeta(id)).rejects.toMatchObject({ code: "not_found" });
      }
      await expect(getObjectBytes(undefined as unknown as string)).rejects.toMatchObject({ code: "not_found" });
    });

    it("enforces the expected owner, answering 'not found' for another tenant's object", async () => {
      const meta = await put({ orgId: "org_a", householdId: "hh_1" });
      expect(await getObjectBytes(meta.id, { orgId: "org_a" })).toEqual(sample);
      expect(await getObjectBytes(meta.id, { householdId: "hh_1" })).toEqual(sample);
      expect(await getObjectBytes(meta.id, { orgId: "org_a", householdId: "hh_1" })).toEqual(sample);
      await expect(getObjectBytes(meta.id, { orgId: "org_b" })).rejects.toMatchObject({ code: "not_found" });
      await expect(getObjectBytes(meta.id, { householdId: "hh_2" })).rejects.toMatchObject({ code: "not_found" });
      await expect(getObjectBytes(meta.id, { orgId: "org_a", householdId: "hh_2" })).rejects.toMatchObject({ code: "not_found" });
      await expect(getObjectMeta(meta.id, { orgId: "org_b" })).rejects.toMatchObject({ code: "not_found" });
      await expect(objectResponse(meta.id, { scope: { orgId: "org_b" } })).rejects.toMatchObject({ code: "not_found" });

      const unowned = await put({ orgId: null, householdId: null });
      await expect(getObjectBytes(unowned.id, { orgId: "org_a" })).rejects.toMatchObject({ code: "not_found" });
      expect(await getObjectBytes(unowned.id)).toEqual(sample);
    });
  });

  describe("tamper detection", () => {
    const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

    async function stored() {
      const meta = await put();
      const row = await dbRow(meta.id);
      return { meta, row, blob: (await store.get(row.storageKey))! };
    }

    it("refuses bytes with a flipped ciphertext bit", async () => {
      const log = quiet();
      const { meta, row, blob } = await stored();
      blob[blob.length - 1] ^= 0x01;
      await store.put(row.storageKey, blob);
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal", status: 500, message: "The stored file could not be read" });
      await expect(objectResponse(meta.id)).rejects.toMatchObject({ code: "internal" });
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain(MARKER);
    });

    it.each([
      ["first ciphertext byte", 33],
      ["authentication tag", 20],
      ["IV", 8],
      ["format version", 4],
      ["magic", 0],
    ])("refuses bytes with a modified %s", async (_label, index) => {
      quiet();
      const { meta, row, blob } = await stored();
      blob[index] ^= 0xff;
      await store.put(row.storageKey, blob);
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
    });

    it("refuses truncated or replaced bytes", async () => {
      quiet();
      const { meta, row, blob } = await stored();
      await store.put(row.storageKey, blob.subarray(0, blob.length - 5));
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
      await store.put(row.storageKey, sample);
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
      await store.put(row.storageKey, new Uint8Array(0));
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
    });

    it("refuses another object's (perfectly valid) ciphertext", async () => {
      quiet();
      const a = await stored();
      const b = await stored();
      await store.put(a.row.storageKey, b.blob);
      await expect(getObjectBytes(a.meta.id)).rejects.toMatchObject({ code: "internal" });
      expect(await getObjectBytes(b.meta.id)).toEqual(sample);
    });

    it("refuses a row that was pointed at another object's bytes and key", async () => {
      quiet();
      const victim = await stored();
      const other = await putObject({ bytes: Buffer.from("SYNTHETIC other household's file"), contentType: "application/pdf", purpose: "upload", orgId: "org_b" });
      const otherRow = await dbRow(other.id);
      // An attacker who can write to the bucket and the database swaps in the other object's ciphertext
      // together with its wrapped key, hash and size. (Sharing one storage key is already ruled out by the
      // unique index.)
      await expect(t.db.update(schema.objects).set({ storageKey: otherRow.storageKey }).where(eq(schema.objects.id, victim.meta.id))).rejects.toThrow();
      await store.put(victim.row.storageKey, (await store.get(otherRow.storageKey))!);
      await t.db.update(schema.objects).set({ wrappedKey: otherRow.wrappedKey, sha256: otherRow.sha256, size: otherRow.size }).where(eq(schema.objects.id, victim.meta.id));
      await expect(getObjectBytes(victim.meta.id)).rejects.toMatchObject({ code: "internal" });
      expect((await getObjectBytes(other.id)).toString()).toBe("SYNTHETIC other household's file");
    });

    it("refuses when the recorded hash or size no longer matches", async () => {
      quiet();
      const { meta } = await stored();
      await t.db.update(schema.objects).set({ sha256: sha256(Buffer.from("something else")) }).where(eq(schema.objects.id, meta.id));
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
      await t.db.update(schema.objects).set({ sha256: meta.sha256, size: meta.size + 1 }).where(eq(schema.objects.id, meta.id));
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
      await t.db.update(schema.objects).set({ size: meta.size }).where(eq(schema.objects.id, meta.id));
      expect(await getObjectBytes(meta.id)).toEqual(sample);
    });

    it("refuses a corrupted wrapped key, and reports missing bytes as an error rather than 'gone'", async () => {
      quiet();
      const a = await stored();
      await t.db.update(schema.objects).set({ wrappedKey: "v1.AAAA.BBBB.CCCC" }).where(eq(schema.objects.id, a.meta.id));
      await expect(getObjectBytes(a.meta.id)).rejects.toMatchObject({ code: "internal" });

      const b = await stored();
      await store.delete(b.row.storageKey);
      await expect(getObjectBytes(b.meta.id)).rejects.toMatchObject({ code: "internal" });
    });
  });

  describe("purgeObject", () => {
    it("deletes the bytes and the key but keeps the row, the hash and the names", async () => {
      const meta = await put();
      const before = await dbRow(meta.id);
      setTestNow("2027-01-05T08:00:00.000Z");
      const purged = await purgeObject(meta.id, "retention");

      expect(purged).toEqual({ ...meta, deletedAt: new Date("2027-01-05T08:00:00.000Z"), deleteReason: "retention" });
      expect(await store.exists(before.storageKey)).toBe(false);
      expect(store.size).toBe(0);
      const after = await dbRow(meta.id);
      expect(after).toMatchObject({ sha256: sha256(sample), size: sample.length, filename: "pay stub.pdf", storageKey: before.storageKey, wrappedKey: PURGED_WRAPPED_KEY });
      expect(await getObjectMeta(meta.id)).toEqual(purged);
    });

    it("makes the bytes unreadable for good: 410 gone", async () => {
      const meta = await put();
      await purgeObject(meta.id, "user_request");
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "gone", status: 410 });
      await expect(objectResponse(meta.id)).rejects.toMatchObject({ code: "gone" });
      await expect(getObjectBytes(meta.id, { orgId: "org_b" })).rejects.toMatchObject({ code: "not_found" });
    });

    it("writes one audit entry, attributed to the system by default or to the given actor", async () => {
      const a = await put();
      const b = await put();
      await purgeObject(a.id, "retention");
      await purgeObject(b.id, " family asked us to delete it ", { actor: { type: "user", id: "usr_parent" }, request: { ip: "203.0.113.7" } });
      const logs = (await listAuditLogs({ action: "object.purge" })).items;
      expect(logs).toHaveLength(2);
      expect(logs.find((l) => l.targetId === a.id)).toMatchObject({
        actorType: "system",
        orgId: "org_a",
        targetType: "object",
        metadata: { reason: "retention", purpose: "upload", sha256: sha256(sample), householdId: "hh_1" },
      });
      expect(logs.find((l) => l.targetId === b.id)).toMatchObject({ actorType: "user", actorId: "usr_parent", ip: "203.0.113.7", metadata: { reason: "family asked us to delete it" } });
      expect((await getObjectMeta(b.id)).deleteReason).toBe("family asked us to delete it");
    });

    it("is idempotent: the first purge wins and nothing is logged twice", async () => {
      const meta = await put();
      const first = await purgeObject(meta.id, "retention");
      setTestNow("2027-06-01T00:00:00.000Z");
      const second = await purgeObject(meta.id, "another reason");
      expect(second).toEqual(first);
      expect((await listAuditLogs({ action: "object.purge" })).items).toHaveLength(1);
    });

    it("finishes a half-done purge: bytes that reappear behind a purged row are deleted again", async () => {
      const meta = await put();
      const row = await dbRow(meta.id);
      await purgeObject(meta.id, "retention");
      await store.put(row.storageKey, Buffer.from("restored from a stale replica"));
      await purgeObject(meta.id, "retention");
      expect(store.size).toBe(0);
    });

    it("does not mark the row when the bytes could not be deleted", async () => {
      const meta = await put();
      vi.spyOn(store, "delete").mockRejectedValueOnce(new Error("bucket unavailable"));
      await expect(purgeObject(meta.id, "retention")).rejects.toThrow("bucket unavailable");
      expect((await getObjectMeta(meta.id)).deletedAt).toBeNull();
      expect(await getObjectBytes(meta.id)).toEqual(sample);
      expect((await listAuditLogs({ action: "object.purge" })).items).toHaveLength(0);
      await purgeObject(meta.id, "retention");
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "gone" });
    });

    it("handles two purges racing each other", async () => {
      const meta = await put();
      const [a, b] = await Promise.all([purgeObject(meta.id, "retention"), purgeObject(meta.id, "retention")]);
      expect(a.deletedAt).toEqual(b.deletedAt);
      expect((await listAuditLogs({ action: "object.purge" })).items).toHaveLength(1);
    });

    it("requires a reason and an existing object, and leaves other objects alone", async () => {
      const keep = await put();
      const target = await put();
      for (const reason of ["", "   ", "x".repeat(201), undefined as unknown as string]) {
        await expect(purgeObject(target.id, reason)).rejects.toMatchObject({ code: "bad_request" });
      }
      await expect(purgeObject("obj_missing", "retention")).rejects.toMatchObject({ code: "not_found" });
      expect(store.size).toBe(2);
      await purgeObject(target.id, "retention");
      expect(await getObjectBytes(keep.id)).toEqual(sample);
    });
  });

  describe("objectResponse", () => {
    it("returns the decrypted bytes as a download by default", async () => {
      const meta = await put();
      const res = await objectResponse(meta.id);
      expect(res.status).toBe(200);
      expect(Object.fromEntries(res.headers)).toEqual({
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="pay stub.pdf"; filename*=UTF-8''pay%20stub.pdf`,
        "content-length": String(sample.length),
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff",
      });
      expect(Buffer.from(await res.arrayBuffer())).toEqual(sample);
    });

    it("shows PDFs, images and JSON inline when asked", async () => {
      for (const contentType of ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/json; charset=utf-8"]) {
        const meta = await put({ contentType });
        const res = await objectResponse(meta.id, { disposition: "inline" });
        expect(res.headers.get("content-disposition"), contentType).toMatch(/^inline; /);
        expect(res.headers.get("content-type")).toBe(contentType);
      }
    });

    it("never renders active content inline, even when asked", async () => {
      for (const contentType of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript", "application/octet-stream", "text/csv"]) {
        const meta = await put({ contentType, purpose: "export" });
        const res = await objectResponse(meta.id, { disposition: "inline" });
        expect(res.headers.get("content-disposition"), contentType).toMatch(/^attachment; /);
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      }
    });

    it("builds a header-safe file name from hostile or non-ASCII names", async () => {
      const accented = `declaraci${String.fromCodePoint(0xf3)}n "final".pdf`;
      const meta = await put({ filename: accented });
      const header = (await objectResponse(meta.id)).headers.get("content-disposition")!;
      expect(header).toBe(`attachment; filename="declaraci_n _final_.pdf"; filename*=UTF-8''declaraci%C3%B3n%20_final_.pdf`);

      const override = (await objectResponse(meta.id, { filename: "evidence\r\nX-Injected: 1.pdf" })).headers.get("content-disposition")!;
      expect(override).not.toMatch(/[\r\n]/);
      expect(override).toContain('filename="evidenceX-Injected_ 1.pdf"');

      const quoted = (await objectResponse(meta.id, { filename: "it's (100%) done*.pdf" })).headers.get("content-disposition")!;
      expect(quoted).toBe(`attachment; filename="it's (100_) done_.pdf"; filename*=UTF-8''it%27s%20%28100%25%29%20done_.pdf`);
    });

    it("names unnamed objects after their id and type", async () => {
      const pdf = await put({ filename: null, purpose: "evidence_pdf" });
      expect((await objectResponse(pdf.id)).headers.get("content-disposition")).toContain(`filename="${pdf.id}.pdf"`);
      const json = await put({ filename: null, contentType: "application/json", purpose: "evidence_json" });
      expect((await objectResponse(json.id)).headers.get("content-disposition")).toContain(`filename="${json.id}.json"`);
      const other = await put({ filename: null, contentType: "application/x-custom", purpose: "export" });
      expect((await objectResponse(other.id)).headers.get("content-disposition")).toContain(`filename="${other.id}"`);
    });

    it("records the read in the audit log when given an actor", async () => {
      const meta = await put({ purpose: "evidence_pdf" });
      await objectResponse(meta.id, {
        disposition: "inline",
        scope: { orgId: "org_a" },
        audit: { actor: { type: "api_key", id: "key_1" }, request: { ip: "203.0.113.7", userAgent: "synthetic" }, metadata: { verificationId: "ver_1" } },
      });
      await objectResponse(meta.id, { audit: { actor: { type: "user", id: "usr_1" }, action: "evidence.download" } });
      await objectResponse(meta.id);
      const logs = (await listAuditLogs({ targetType: "object", targetId: meta.id })).items;
      expect(logs).toHaveLength(2);
      expect(logs[1]).toMatchObject({
        action: "object.download",
        actorType: "api_key",
        actorId: "key_1",
        orgId: "org_a",
        ip: "203.0.113.7",
        metadata: { verificationId: "ver_1", purpose: "evidence_pdf", disposition: "inline" },
      });
      expect(logs[0]).toMatchObject({ action: "evidence.download", actorType: "user", metadata: { disposition: "attachment" } });
    });

    it("does not audit a read that was refused", async () => {
      const meta = await put();
      await expect(objectResponse(meta.id, { scope: { orgId: "org_b" }, audit: { actor: { type: "user", id: "usr_1" } } })).rejects.toMatchObject({ code: "not_found" });
      expect((await listAuditLogs()).items).toHaveLength(0);
    });
  });

  describe("object store selection", () => {
    it("defaults to an in-memory store under test, so tests never write object files into the checkout", async () => {
      setObjectStoreForTests(null);
      const first = getObjectStore();
      expect(first).toBeInstanceOf(MemoryObjectStore);
      expect(getObjectStore()).toBe(first);
      const meta = await put();
      expect(await getObjectBytes(meta.id)).toEqual(sample);
      setObjectStoreForTests(store);
      expect(getObjectStore()).toBe(store);
    });

    it("refuses the test hook in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => setObjectStoreForTests(new MemoryObjectStore())).toThrow(/not allowed in production/);
    });

    describe("outside tests (fresh module instance, real environment parsing)", () => {
      let dir: string;
      beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "ecca-storage-test-"));
        setObjectStoreForTests(null);
        vi.resetModules();
      });
      afterEach(async () => {
        vi.unstubAllEnvs();
        vi.resetModules();
        await rm(dir, { recursive: true, force: true });
      });

      it("uses encrypted files under ECCA_DATA_DIR/objects by default", async () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("ECCA_DATA_DIR", dir);
        vi.stubEnv("STORAGE_PROVIDER", undefined);
        vi.stubEnv("ECCA_MASTER_KEY", Buffer.alloc(32, 9).toString("base64"));
        const fresh = await import("./index");
        const selected = fresh.getObjectStore();
        expect(selected).toBeInstanceOf(fresh.LocalFsStore);
        expect((selected as LocalFsStore).root).toBe(join(dir, "objects"));
        expect(fresh.getObjectStore()).toBe(selected);

        const meta = await fresh.putObject({ bytes: sample, contentType: "application/pdf", purpose: "upload", filename: "Maria W-2.pdf" });
        expect(await fresh.getObjectBytes(meta.id)).toEqual(sample);
        const files = (await readdir(join(dir, "objects"), { withFileTypes: true, recursive: true })).filter((f) => f.isFile());
        expect(files).toHaveLength(1);
        expect(files[0].name).not.toMatch(/Maria|W-2|pdf/);
        const onDisk = await readFile(join(files[0].parentPath, files[0].name));
        expect(onDisk.includes(Buffer.from(MARKER))).toBe(false);
        expect(onDisk.subarray(0, 4).toString("ascii")).toBe("ECCA");

        await fresh.purgeObject(meta.id, "retention");
        expect((await readdir(join(dir, "objects"), { withFileTypes: true, recursive: true })).filter((f) => f.isFile())).toHaveLength(0);
      });

      it("uses S3 when STORAGE_PROVIDER=s3 and insists on complete configuration", async () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("ECCA_DATA_DIR", dir);
        vi.stubEnv("STORAGE_PROVIDER", "s3");
        vi.stubEnv("S3_BUCKET", "");
        const fresh = await import("./index");
        expect(() => fresh.getObjectStore()).toThrow(/S3_BUCKET is required/);

        vi.resetModules();
        vi.stubEnv("S3_BUCKET", "ecca-synthetic-bucket");
        vi.stubEnv("S3_ENDPOINT", "https://s3.invalid");
        vi.stubEnv("S3_ACCESS_KEY_ID", "synthetic-access-key-id");
        vi.stubEnv("S3_SECRET_ACCESS_KEY", "");
        const halfConfigured = await import("./index");
        expect(() => halfConfigured.getObjectStore()).toThrow(/both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY/);

        vi.resetModules();
        vi.stubEnv("S3_SECRET_ACCESS_KEY", "synthetic-secret-access-key");
        const configured = await import("./index");
        const selected = configured.getObjectStore();
        expect(selected).toBeInstanceOf(configured.S3Store);
        expect(configured.getObjectStore()).toBe(selected);
      });
    });
  });

  it("round-trips through a real directory with LocalFsStore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ecca-storage-test-"));
    try {
      setObjectStoreForTests(new LocalFsStore(join(dir, "objects")));
      const meta = await put();
      expect(await getObjectBytes(meta.id)).toEqual(sample);
      const row = await dbRow(meta.id);
      const onDisk = await readFile(join(dir, "objects", ...row.storageKey.split("/")));
      expect(onDisk.includes(Buffer.from(MARKER))).toBe(false);
      onDisk[40] ^= 0x01;
      await writeFile(join(dir, "objects", ...row.storageKey.split("/")), onDisk);
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(getObjectBytes(meta.id)).rejects.toMatchObject({ code: "internal" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
