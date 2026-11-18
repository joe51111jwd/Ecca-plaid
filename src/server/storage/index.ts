import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { ObjectPurpose } from "@/db/schema";
import { now } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { SYSTEM_ACTOR, audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { EnvelopeError, newDataKey, openEnvelope, sealEnvelope, unwrapDataKey, wrapDataKey } from "./envelope";
import { LocalFsStore } from "./local-fs-store";
import { S3Store } from "./s3-store";
import { MemoryObjectStore, newStorageKey, type ObjectStore } from "./store";
import { sanitizeFilename } from "./upload-validation";

/**
 * Encrypted object storage.
 *
 *   const upload = validateUpload({ bytes, contentType: file.type, filename: file.name });
 *   const obj = await putObject({ bytes, contentType: upload.contentType, filename: upload.filename,
 *                                 purpose: "upload", orgId, householdId }, tx);
 *   const bytes = await getObjectBytes(obj.id, { orgId });
 *   return objectResponse(obj.id, { disposition: "inline", scope: { orgId }, audit: { actor, request } });
 *   await purgeObject(obj.id, "retention");
 *
 * Every object is encrypted with its own key before it reaches the object store (see ./envelope), indexed in
 * the `objects` table with the SHA-256 of its plaintext, and addressed by a random storage key. Purging
 * deletes the bytes and destroys the object's key but keeps the row and the hash, so an evidence record can
 * still prove which file was reviewed after the file itself is gone.
 */

type ObjectRow = typeof schema.objects.$inferSelect;

/** What other modules see of an object: the index row without the storage internals (storage key, wrapped key). */
export type ObjectMeta = Omit<ObjectRow, "storageKey" | "wrappedKey">;

function toMeta(row: ObjectRow): ObjectMeta {
  const meta: Partial<ObjectRow> = { ...row };
  delete meta.storageKey;
  delete meta.wrappedKey;
  return meta as ObjectMeta;
}

/* ------------------------------------------------------------------------------------- store selection */

const g = globalThis as unknown as {
  __eccaObjectStore?: { configKey: string; store: ObjectStore };
  __eccaTestObjectStore?: ObjectStore | null;
};

/**
 * The configured object store: S3 when STORAGE_PROVIDER=s3, otherwise encrypted files under
 * `${ECCA_DATA_DIR}/objects`. Under NODE_ENV=test it is an in-memory store unless a test installs its own,
 * so tests never write into the checkout.
 */
export function getObjectStore(): ObjectStore {
  if (g.__eccaTestObjectStore) return g.__eccaTestObjectStore;
  const e = env();
  const configKey =
    e.NODE_ENV === "test" ? "memory" : e.STORAGE_PROVIDER === "s3" ? `s3|${e.S3_BUCKET}|${e.S3_ENDPOINT}|${e.S3_REGION}|${e.S3_ACCESS_KEY_ID}` : `local|${e.ECCA_DATA_DIR}`;
  if (g.__eccaObjectStore?.configKey !== configKey) {
    const store =
      e.NODE_ENV === "test" ? new MemoryObjectStore() : e.STORAGE_PROVIDER === "s3" ? S3Store.fromEnv() : new LocalFsStore(join(e.ECCA_DATA_DIR, "objects"));
    g.__eccaObjectStore = { configKey, store };
  }
  return g.__eccaObjectStore.store;
}

/** Test-only: route all object bytes to `store` (pass null to go back to the default). */
export function setObjectStoreForTests(store: ObjectStore | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("setObjectStoreForTests is not allowed in production");
  g.__eccaTestObjectStore = store;
}

/* ------------------------------------------------------------------------------------------- writing */

// A record rather than an array so that adding a purpose to the schema type fails to compile until it is listed here.
const PURPOSES: Record<ObjectPurpose, true> = {
  upload: true,
  evidence_pdf: true,
  evidence_json: true,
  acknowledgment_pdf: true,
  irs_report: true,
  export: true,
  invoice_pdf: true,
};
export const OBJECT_PURPOSES = Object.keys(PURPOSES) as ObjectPurpose[];

/**
 * Hard ceiling for any stored object. Objects are sealed and opened in memory (AES-GCM authenticates the
 * whole blob before any of it is released), so this bounds memory per request. Uploads have their own,
 * lower limit in validateUpload().
 */
export const MAX_OBJECT_BYTES = 64 * 1024 * 1024;

const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:\s*;\s*[a-z0-9-]+=(?:[a-z0-9._-]+|"[^"\r\n]*"))*$/;

export interface PutObjectInput {
  bytes: Uint8Array;
  /** For uploads pass the type detected by validateUpload(), not the one the browser declared. */
  contentType: string;
  purpose: ObjectPurpose;
  /** Display name for downloads. Sanitized; never used to build the storage key. */
  filename?: string | null;
  /** Tenant that owns the object. */
  orgId?: string | null;
  householdId?: string | null;
}

/**
 * Encrypts and stores `bytes`, records the object in the index and returns its metadata.
 *
 * The bytes are written to the object store before the row is inserted, so a row never points at missing
 * bytes. If the insert fails the bytes are removed again; if a surrounding transaction rolls back later, an
 * unreadable ciphertext blob is left behind in the store (its key existed only in the rolled-back row).
 */
export async function putObject(input: PutObjectInput, dbOrTx?: DbOrTx): Promise<ObjectMeta> {
  const { bytes } = input;
  if (!(bytes instanceof Uint8Array)) throw new AppError("internal", "putObject: bytes must be a Uint8Array");
  if (bytes.byteLength === 0) throw badRequest("Cannot store an empty file");
  if (bytes.byteLength > MAX_OBJECT_BYTES) throw badRequest("File is too large to store");
  if (!OBJECT_PURPOSES.includes(input.purpose)) throw new AppError("internal", "putObject: unknown purpose");
  const contentType = String(input.contentType ?? "").trim().toLowerCase();
  if (contentType.length > 255 || !CONTENT_TYPE_PATTERN.test(contentType)) throw badRequest("Invalid content type");

  const id = newId("object");
  const storageKey = newStorageKey();
  const dataKey = newDataKey();
  let envelope: Buffer;
  let wrappedKey: string;
  try {
    envelope = sealEnvelope(dataKey, bytes, id);
    wrappedKey = wrapDataKey(dataKey, id);
  } finally {
    dataKey.fill(0);
  }

  const store = getObjectStore();
  await store.put(storageKey, envelope);
  try {
    const db = dbOrTx ?? (await getDb());
    const [row] = await db
      .insert(schema.objects)
      .values({
        id,
        storageKey,
        purpose: input.purpose,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
        contentType,
        filename: input.filename ? sanitizeFilename(input.filename) : null,
        wrappedKey,
        orgId: input.orgId ?? null,
        householdId: input.householdId ?? null,
        // Retention windows are counted from here, so it follows the application clock.
        createdAt: now(),
      })
      .returning();
    return toMeta(row);
  } catch (e) {
    await store.delete(storageKey).catch(() => undefined);
    throw e;
  }
}

/* ------------------------------------------------------------------------------------------- reading */

/**
 * Expected owner of an object. When given, an object that belongs to a different organization or household
 * is reported as not found (not "forbidden": the caller learns nothing about other tenants' files).
 */
export interface ObjectScope {
  orgId?: string;
  householdId?: string;
}

async function loadRow(objectId: string, scope: ObjectScope | null | undefined, db: DbOrTx): Promise<ObjectRow> {
  const [row] = typeof objectId === "string" && objectId.length > 0 ? await db.select().from(schema.objects).where(eq(schema.objects.id, objectId)) : [];
  if (!row) throw notFound("File");
  if (scope?.orgId !== undefined && row.orgId !== scope.orgId) throw notFound("File");
  if (scope?.householdId !== undefined && row.householdId !== scope.householdId) throw notFound("File");
  return row;
}

function unreadable(objectId: string, why: string, cause?: unknown): AppError {
  // The reason stays in the server log; callers only learn that the file cannot be served.
  console.error(`[storage] Object ${objectId} cannot be read: ${why}${cause instanceof Error ? ` (${cause.message})` : ""}`);
  return new AppError("internal", "The stored file could not be read");
}

async function readObject(objectId: string, scope: ObjectScope | null | undefined, db: DbOrTx): Promise<{ row: ObjectRow; bytes: Buffer }> {
  const row = await loadRow(objectId, scope, db);
  if (row.deletedAt) throw new AppError("gone", "This file has been deleted");
  const envelope = await getObjectStore().get(row.storageKey);
  if (!envelope) throw unreadable(row.id, "its bytes are missing from the object store");
  let bytes: Buffer;
  try {
    const dataKey = unwrapDataKey(row.wrappedKey, row.id);
    try {
      bytes = openEnvelope(dataKey, envelope, row.id);
    } finally {
      dataKey.fill(0);
    }
  } catch (e) {
    if (e instanceof EnvelopeError) throw unreadable(row.id, e.message, e.cause);
    throw e;
  }
  if (bytes.byteLength !== row.size || sha256Hex(bytes) !== row.sha256) throw unreadable(row.id, "its contents do not match the recorded SHA-256");
  return { row, bytes };
}

/** Index entry for an object (also for purged ones: `deletedAt` is set and the hash is still there). */
export async function getObjectMeta(objectId: string, scope?: ObjectScope | null, dbOrTx?: DbOrTx): Promise<ObjectMeta> {
  return toMeta(await loadRow(objectId, scope, dbOrTx ?? (await getDb())));
}

/**
 * Decrypted bytes of an object, verified against the SHA-256 recorded when it was stored.
 * Throws `not_found` (unknown id or outside `scope`), `gone` (purged) or `internal` (tampered/corrupt/missing bytes).
 * The caller is responsible for the access check and for auditing the read.
 */
export async function getObjectBytes(objectId: string, scope?: ObjectScope | null, dbOrTx?: DbOrTx): Promise<Buffer> {
  return (await readObject(objectId, scope, dbOrTx ?? (await getDb()))).bytes;
}

/* ------------------------------------------------------------------------------------------- purging */

/** Written to `objects.wrapped_key` when an object is purged: the data key no longer exists anywhere. */
export const PURGED_WRAPPED_KEY = "purged";

export interface PurgeObjectOptions {
  /** Who asked for the deletion. Default: the system (retention job). */
  actor?: AuditActor;
  request?: AuditRequestInfo | null;
}

/**
 * Permanently deletes an object's bytes and destroys its data key, keeping the index row with the SHA-256,
 * size and names, and stamping `deletedAt` / `deleteReason`. Audited as `object.purge`. Idempotent: purging a
 * purged object re-issues the delete to the store (finishing any half-done purge) and changes nothing else.
 *
 * The bytes are deleted before the row is marked, so a failure in between is retried rather than leaving
 * bytes behind a row that says they are gone. For the same reason, run it outside any transaction that might
 * still roll back.
 */
export async function purgeObject(objectId: string, reason: string, opts?: PurgeObjectOptions | null, dbOrTx?: DbOrTx): Promise<ObjectMeta> {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length === 0 || why.length > 200) throw badRequest("A reason of at most 200 characters is required to delete a file");
  const db = dbOrTx ?? (await getDb());
  const row = await loadRow(objectId, null, db);

  await getObjectStore().delete(row.storageKey);
  if (row.deletedAt) return toMeta(row);

  const updated = await db.transaction(async (tx) => {
    const [marked] = await tx
      .update(schema.objects)
      .set({ deletedAt: now(), deleteReason: why, wrappedKey: PURGED_WRAPPED_KEY })
      .where(and(eq(schema.objects.id, row.id), isNull(schema.objects.deletedAt)))
      .returning();
    if (!marked) return null;
    await audit(
      {
        actor: opts?.actor ?? SYSTEM_ACTOR,
        orgId: row.orgId,
        action: "object.purge",
        target: { type: "object", id: row.id },
        metadata: { reason: why, purpose: row.purpose, sha256: row.sha256, householdId: row.householdId },
        request: opts?.request,
      },
      tx,
    );
    return marked;
  });
  // null: a concurrent purge marked the row first.
  return toMeta(updated ?? (await loadRow(objectId, null, db)));
}

/* -------------------------------------------------------------------------------------- HTTP response */

/** Types a browser may display in place. Everything else is always sent as a download. */
const INLINE_SAFE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "application/json"]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "application/pdf": "pdf",
  "application/json": "json",
  "text/csv": "csv",
  "text/plain": "txt",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export interface ObjectResponseOptions {
  /** "inline" shows PDFs, images and JSON in the browser; other types are downloaded regardless. Default "attachment". */
  disposition?: "inline" | "attachment";
  /** Download name. Default: the stored file name, or "<object id>.<ext>". */
  filename?: string;
  scope?: ObjectScope;
  /** When set, the read is written to the audit log (default action "object.download") before the response is returned. */
  audit?: { actor: AuditActor; action?: string; request?: AuditRequestInfo | null; metadata?: Record<string, unknown> };
}

/** RFC 6266 header value with an ASCII fallback and an RFC 5987 UTF-8 name. */
function contentDisposition(disposition: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * A `Response` carrying the decrypted object, for route handlers:
 *
 *   // in a route handler, after the access guard has established who is asking and for which organization:
 *   return objectResponse(objectId, {
 *     disposition: "inline",
 *     scope: { orgId },
 *     audit: { actor: { type: "user", id: userId }, request: requestInfoFromHeaders(req.headers) },
 *   });
 *
 * Throws the same AppErrors as getObjectBytes (map them with toErrorBody). The response is never cacheable
 * and never sniffable; active content types cannot be rendered inline.
 */
export async function objectResponse(objectId: string, opts: ObjectResponseOptions = {}, dbOrTx?: DbOrTx): Promise<Response> {
  const db = dbOrTx ?? (await getDb());
  const { row, bytes } = await readObject(objectId, opts.scope, db);
  const baseType = row.contentType.split(";")[0].trim();
  const disposition = opts.disposition === "inline" && INLINE_SAFE_TYPES.has(baseType) ? "inline" : "attachment";
  const filename = sanitizeFilename(opts.filename ?? row.filename, `${row.id}${EXTENSION_BY_TYPE[baseType] ? `.${EXTENSION_BY_TYPE[baseType]}` : ""}`);

  if (opts.audit) {
    await audit(
      {
        actor: opts.audit.actor,
        orgId: row.orgId,
        action: opts.audit.action ?? "object.download",
        target: { type: "object", id: row.id },
        metadata: { ...opts.audit.metadata, purpose: row.purpose, disposition },
        request: opts.audit.request,
      },
      db,
    );
  }

  // Copy into a plain ArrayBuffer-backed view: a pooled Buffer may share memory with unrelated data.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(disposition, filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export { MemoryObjectStore, assertValidStorageKey, newStorageKey, type ObjectStore } from "./store";
export { LocalFsStore } from "./local-fs-store";
export { S3Store, type S3ClientLike, type S3StoreCommand, type S3StoreConfig } from "./s3-store";
export {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
  sanitizeFilename,
  sniffContentType,
  validateUpload,
  type UploadContentType,
  type UploadInput,
  type UploadRejectionReason,
  type ValidatedUpload,
} from "./upload-validation";
