import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsStore } from "./local-fs-store";
import { S3Store, type S3ClientLike, type S3StoreCommand } from "./s3-store";
import { MemoryObjectStore, assertValidStorageKey, newStorageKey, type ObjectStore } from "./store";

const HOSTILE_KEYS = [
  "",
  ".",
  "..",
  "../outside",
  "../../etc/passwd",
  "a/../../outside",
  "a/..",
  "a/./b",
  "/etc/passwd",
  "/absolute",
  "a//b",
  "a/b/",
  "/",
  ".hidden",
  "a/.hidden",
  ".tmp/x",
  "a\\..\\..\\outside",
  "C:\\Windows\\system32",
  "~/x",
  "a b",
  "a\u0000b",
  "a\nb",
  "a%2e%2e/b",
  "a..b",
  "caf\u00e9",
  "a/b?versionId=1",
  "a#b",
  "x".repeat(513),
];

describe("storage keys", () => {
  it("accepts simple slash-separated names", () => {
    for (const key of ["a", "ab/cdef0123", "A-b_c.d/e.f", "3f/9a1c00", "x".repeat(512)]) expect(() => assertValidStorageKey(key)).not.toThrow();
  });

  it.each(HOSTILE_KEYS.map((k) => [JSON.stringify(k).slice(0, 40), k]))("rejects %s", (_label, key) => {
    expect(() => assertValidStorageKey(key)).toThrow(/Invalid storage key/);
  });

  it("rejects non-strings", () => {
    for (const key of [null, undefined, 42, {}, ["a"]]) expect(() => assertValidStorageKey(key as unknown as string)).toThrow(/Invalid storage key/);
  });

  it("generates random, valid, meaningless keys", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newStorageKey()));
    expect(keys.size).toBe(200);
    for (const key of keys) {
      expect(key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{46}$/);
      expect(() => assertValidStorageKey(key)).not.toThrow();
    }
  });
});

function sharedBehaviour(make: () => ObjectStore) {
  it("round-trips bytes, including binary and empty blobs", async () => {
    const store = make();
    const blob = Buffer.from([0, 1, 2, 253, 254, 255, 10, 13]);
    await store.put("aa/one", blob);
    await store.put("aa/empty", new Uint8Array(0));
    expect(await store.get("aa/one")).toEqual(blob);
    expect(await store.get("aa/empty")).toEqual(Buffer.alloc(0));
    expect(await store.exists("aa/one")).toBe(true);
  });

  it("reports missing blobs as null / false and deletes idempotently", async () => {
    const store = make();
    expect(await store.get("aa/missing")).toBeNull();
    expect(await store.exists("aa/missing")).toBe(false);
    await expect(store.delete("aa/missing")).resolves.toBeUndefined();
    await store.put("aa/x", Buffer.from("x"));
    await store.delete("aa/x");
    await store.delete("aa/x");
    expect(await store.get("aa/x")).toBeNull();
    expect(await store.exists("aa/x")).toBe(false);
  });

  it("overwrites an existing blob", async () => {
    const store = make();
    await store.put("aa/x", Buffer.from("first version, longer"));
    await store.put("aa/x", Buffer.from("second"));
    expect((await store.get("aa/x"))?.toString()).toBe("second");
  });

  it("does not alias the caller's buffer", async () => {
    const store = make();
    const blob = Buffer.from("immutable");
    await store.put("aa/x", blob);
    blob.fill(0);
    const read = await store.get("aa/x");
    expect(read?.toString()).toBe("immutable");
    read?.fill(0);
    expect((await store.get("aa/x"))?.toString()).toBe("immutable");
  });

  it("rejects hostile keys on every operation", async () => {
    const store = make();
    for (const key of HOSTILE_KEYS) {
      await expect(store.put(key, Buffer.from("x")), key).rejects.toThrow(/Invalid storage key/);
      await expect(store.get(key), key).rejects.toThrow(/Invalid storage key/);
      await expect(store.exists(key), key).rejects.toThrow(/Invalid storage key/);
      await expect(store.delete(key), key).rejects.toThrow(/Invalid storage key/);
    }
  });
}

describe("MemoryObjectStore", () => {
  sharedBehaviour(() => new MemoryObjectStore());

  it("exposes its keys for assertions", async () => {
    const store = new MemoryObjectStore();
    await store.put("aa/x", Buffer.from("x"));
    expect(store.keys()).toEqual(["aa/x"]);
    expect(store.size).toBe(1);
  });
});

describe("LocalFsStore", () => {
  let base: string;
  let root: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "ecca-store-test-"));
    root = join(base, "data", "objects");
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  sharedBehaviour(() => new LocalFsStore(root));

  async function listFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) out.push(join(entry.parentPath, entry.name).slice(dir.length + 1));
    }
    return out.sort();
  }

  it("creates the root lazily and stores each blob at root/<key>", async () => {
    const store = new LocalFsStore(root);
    expect(existsSync(root)).toBe(false);
    await store.put("3f/9a1c", Buffer.from("ciphertext"));
    expect(await readFile(join(root, "3f", "9a1c"), "utf8")).toBe("ciphertext");
  });

  it("writes atomically: no temporary files remain and files are private", async () => {
    const store = new LocalFsStore(root);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.put(`aa/file${i}`, Buffer.alloc(50_000, i))));
    expect(await listFiles(join(root, ".tmp"))).toEqual([]);
    expect(await listFiles(root)).toHaveLength(20);
    const mode = (await stat(join(root, "aa", "file0"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("concurrent writers to one key leave exactly one complete blob", async () => {
    const store = new LocalFsStore(root);
    const versions = Array.from({ length: 12 }, (_, i) => Buffer.alloc(200_000, i + 1));
    await Promise.all(versions.map((v) => store.put("aa/contended", v)));
    const final = await store.get("aa/contended");
    expect(final).toHaveLength(200_000);
    expect(versions.some((v) => v.equals(final!))).toBe(true);
    expect(await listFiles(join(root, ".tmp"))).toEqual([]);
  });

  it("cleans up its temporary file when a write cannot complete", async () => {
    const store = new LocalFsStore(root);
    await store.put("aa", Buffer.from("a file where a directory is needed"));
    await expect(store.put("aa/child", Buffer.from("x"))).rejects.toThrow();
    expect(await listFiles(join(root, ".tmp"))).toEqual([]);
    expect((await store.get("aa"))?.toString()).toBe("a file where a directory is needed");
    expect(await store.get("aa/child")).toBeNull();
    expect(await store.exists("aa/child")).toBe(false);
    await expect(store.delete("aa/child")).resolves.toBeUndefined();
  });

  it("never touches anything outside its root, whatever the key", async () => {
    await writeFile(join(base, "secret.txt"), "outside the store");
    const store = new LocalFsStore(root);
    await store.put("aa/inside", Buffer.from("inside"));
    for (const key of ["../secret.txt", "../../secret.txt", "aa/../../secret.txt", join(base, "secret.txt"), "..\\secret.txt"]) {
      await expect(store.get(key)).rejects.toThrow(/Invalid storage key/);
      await expect(store.delete(key)).rejects.toThrow(/Invalid storage key/);
      await expect(store.put(key, Buffer.from("overwritten"))).rejects.toThrow(/Invalid storage key/);
    }
    expect(await readFile(join(base, "secret.txt"), "utf8")).toBe("outside the store");
    expect(await listFiles(base)).toEqual(["data/objects/aa/inside", "secret.txt"]);
  });

  it("treats a directory at the key's path as no blob", async () => {
    const store = new LocalFsStore(root);
    await store.put("aa/bb/cc", Buffer.from("x"));
    expect(await store.get("aa/bb")).toBeNull();
    expect(await store.exists("aa/bb")).toBe(false);
  });

  it("resolves a relative root once, so later chdir cannot move it", () => {
    const store = new LocalFsStore("relative/objects");
    expect(store.root).toBe(join(process.cwd(), "relative", "objects"));
  });
});

/** In-memory stand-in for an S3 endpoint. Fails the way S3 does: typed errors with a `name`. */
class FakeS3 implements S3ClientLike {
  readonly objects = new Map<string, Buffer>();
  readonly calls: S3StoreCommand[] = [];
  failWith: Error | null = null;
  /** Some S3-compatible services answer NoSuchKey to a DELETE of a missing key. */
  strictDelete = false;

  constructor(private readonly bucket: string) {}

  private static error(name: string, status: number): Error {
    return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  }

  async send(command: S3StoreCommand): Promise<unknown> {
    this.calls.push(command);
    if (this.failWith) throw this.failWith;
    const { Bucket, Key } = command.input;
    if (Bucket !== this.bucket) throw FakeS3.error("NoSuchBucket", 404);
    const id = `${Bucket}/${Key}`;
    if (command instanceof PutObjectCommand) {
      this.objects.set(id, Buffer.from(command.input.Body as Uint8Array));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const blob = this.objects.get(id);
      if (!blob) throw FakeS3.error("NoSuchKey", 404);
      return { Body: { transformToByteArray: async () => new Uint8Array(blob) } };
    }
    if (command instanceof HeadObjectCommand) {
      if (!this.objects.has(id)) throw FakeS3.error("NotFound", 404);
      return { ContentLength: this.objects.get(id)!.length };
    }
    if (command instanceof DeleteObjectCommand) {
      if (this.strictDelete && !this.objects.has(id)) throw FakeS3.error("NoSuchKey", 404);
      this.objects.delete(id);
      return {};
    }
    throw new Error("unexpected command");
  }
}

describe("S3Store (with an injected fake client)", () => {
  let fake: FakeS3;
  beforeEach(() => {
    fake = new FakeS3("ecca-test-bucket");
  });

  sharedBehaviour(() => new S3Store({ client: fake, bucket: "ecca-test-bucket", prefix: "objects/" }));

  it("sends the expected commands", async () => {
    const store = new S3Store({ client: fake, bucket: "ecca-test-bucket", prefix: "objects/" });
    const blob = Buffer.from("ciphertext");
    await store.put("3f/9a1c", blob);
    await store.get("3f/9a1c");
    await store.exists("3f/9a1c");
    await store.delete("3f/9a1c");

    const [put, get, head, del] = fake.calls;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: "ecca-test-bucket", Key: "objects/3f/9a1c", ContentType: "application/octet-stream", ContentLength: 10 });
    expect(Buffer.from((put as PutObjectCommand).input.Body as Uint8Array)).toEqual(blob);
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect(get.input).toEqual({ Bucket: "ecca-test-bucket", Key: "objects/3f/9a1c" });
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect(head.input).toEqual({ Bucket: "ecca-test-bucket", Key: "objects/3f/9a1c" });
    expect(del).toBeInstanceOf(DeleteObjectCommand);
    expect(del.input).toEqual({ Bucket: "ecca-test-bucket", Key: "objects/3f/9a1c" });
    expect(fake.calls).toHaveLength(4);
  });

  it("uses keys as-is when no prefix is configured", async () => {
    const store = new S3Store({ client: fake, bucket: "ecca-test-bucket" });
    await store.put("3f/9a1c", Buffer.from("x"));
    expect([...fake.objects.keys()]).toEqual(["ecca-test-bucket/3f/9a1c"]);
  });

  it("never calls S3 for an invalid key", async () => {
    const store = new S3Store({ client: fake, bucket: "ecca-test-bucket" });
    await expect(store.put("../other-tenant", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(store.get("a/../b")).rejects.toThrow(/Invalid storage key/);
    expect(fake.calls).toHaveLength(0);
  });

  it("tolerates services that answer NoSuchKey to deleting a missing key", async () => {
    fake.strictDelete = true;
    const store = new S3Store({ client: fake, bucket: "ecca-test-bucket" });
    await expect(store.delete("aa/missing")).resolves.toBeUndefined();
  });

  it("surfaces a wrong bucket as an error, never as 'object missing' or a successful delete", async () => {
    const store = new S3Store({ client: fake, bucket: "some-other-bucket" });
    await expect(store.get("aa/x")).rejects.toMatchObject({ name: "NoSuchBucket" });
    await expect(store.delete("aa/x")).rejects.toMatchObject({ name: "NoSuchBucket" });
    await expect(store.put("aa/x", Buffer.from("x"))).rejects.toMatchObject({ name: "NoSuchBucket" });
  });

  it("propagates access and network failures from every operation", async () => {
    const store = new S3Store({ client: fake, bucket: "ecca-test-bucket" });
    await store.put("aa/x", Buffer.from("x"));
    for (const failure of [Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }), new Error("socket hang up")]) {
      fake.failWith = failure;
      await expect(store.get("aa/x")).rejects.toBe(failure);
      await expect(store.exists("aa/x")).rejects.toBe(failure);
      await expect(store.put("aa/x", Buffer.from("y"))).rejects.toBe(failure);
      await expect(store.delete("aa/x")).rejects.toBe(failure);
    }
  });

  it("rejects a response without a body", async () => {
    const store = new S3Store({ client: { send: async () => ({}) }, bucket: "b" });
    await expect(store.get("aa/x")).rejects.toThrow(/without a body/);
  });

  it("validates its configuration", () => {
    expect(() => new S3Store({ client: fake, bucket: "" })).toThrow(/bucket/);
    for (const prefix of ["objects", "/objects/", "../", "a//", "a b/"]) {
      expect(() => new S3Store({ client: fake, bucket: "b", prefix }), prefix).toThrow(/prefix/);
    }
    expect(() => new S3Store({ client: fake, bucket: "b", prefix: "env/prod/objects/" })).not.toThrow();
  });
});
