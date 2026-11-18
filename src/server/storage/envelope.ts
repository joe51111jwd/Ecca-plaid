import { randomBytes } from "node:crypto";
import { aesGcmOpen, aesGcmSeal, deriveKey } from "@/lib/crypto";

/**
 * Envelope encryption for stored objects.
 *
 * Each object gets its own random 256-bit data key. The bytes are sealed with AES-256-GCM under that key and
 * written to the object store as:
 *
 *   offset 0   4 bytes   magic "ECCA"
 *   offset 4   1 byte    format version (1)
 *   offset 5   12 bytes  IV
 *   offset 17  16 bytes  GCM authentication tag
 *   offset 33  …         ciphertext (same length as the plaintext)
 *
 * The data key is itself sealed with the key-encryption key `deriveKey("object-kek")` (derived from the
 * master key) and kept in `objects.wrapped_key` as `v1.<iv>.<ciphertext>.<tag>` (base64url). The object store
 * therefore never holds anything that can decrypt a file, and rotating the master key only re-wraps data
 * keys — no file is rewritten.
 *
 * Both seals are bound to the object's id as additional authenticated data, so neither a blob nor a wrapped
 * key can be transplanted onto another `objects` row.
 */

const MAGIC = Buffer.from("ECCA", "ascii");
export const ENVELOPE_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1;
/** Bytes the envelope adds to the plaintext. */
export const ENVELOPE_OVERHEAD = HEADER_LENGTH + IV_LENGTH + TAG_LENGTH;
export const DATA_KEY_LENGTH = 32;
const KEK_PURPOSE = "object-kek";
const WRAPPED_KEY_VERSION = "v1";

/** The stored bytes or key are not what this module wrote: tampered with, corrupted, truncated, or from a different object. */
export class EnvelopeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EnvelopeError";
  }
}

const dataAad = (objectId: string) => Buffer.from(`ecca-object-data-v${ENVELOPE_VERSION}:${objectId}`, "utf8");
const keyAad = (objectId: string) => Buffer.from(`ecca-object-key-${WRAPPED_KEY_VERSION}:${objectId}`, "utf8");

export function newDataKey(): Buffer {
  return randomBytes(DATA_KEY_LENGTH);
}

export function sealEnvelope(dataKey: Buffer, plaintext: Uint8Array, objectId: string): Buffer {
  if (dataKey.length !== DATA_KEY_LENGTH) throw new EnvelopeError("Data key must be 32 bytes");
  const sealed = aesGcmSeal(dataKey, plaintext, dataAad(objectId));
  return Buffer.concat([MAGIC, Buffer.from([ENVELOPE_VERSION]), sealed.iv, sealed.tag, sealed.ciphertext]);
}

export function openEnvelope(dataKey: Buffer, envelope: Uint8Array, objectId: string): Buffer {
  const buf = Buffer.isBuffer(envelope) ? envelope : Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  if (buf.length < ENVELOPE_OVERHEAD || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new EnvelopeError("Not an object envelope");
  const version = buf[MAGIC.length];
  if (version !== ENVELOPE_VERSION) throw new EnvelopeError(`Unsupported object envelope version ${version}`);
  const iv = buf.subarray(HEADER_LENGTH, HEADER_LENGTH + IV_LENGTH);
  const tag = buf.subarray(HEADER_LENGTH + IV_LENGTH, ENVELOPE_OVERHEAD);
  const ciphertext = buf.subarray(ENVELOPE_OVERHEAD);
  try {
    return aesGcmOpen(dataKey, { iv, tag, ciphertext }, dataAad(objectId));
  } catch (cause) {
    throw new EnvelopeError("Object failed authentication", { cause });
  }
}

export function wrapDataKey(dataKey: Buffer, objectId: string): string {
  if (dataKey.length !== DATA_KEY_LENGTH) throw new EnvelopeError("Data key must be 32 bytes");
  const s = aesGcmSeal(deriveKey(KEK_PURPOSE), dataKey, keyAad(objectId));
  return [WRAPPED_KEY_VERSION, s.iv.toString("base64url"), s.ciphertext.toString("base64url"), s.tag.toString("base64url")].join(".");
}

export function unwrapDataKey(wrapped: string, objectId: string): Buffer {
  const [version, iv, ciphertext, tag, ...rest] = wrapped.split(".");
  if (version !== WRAPPED_KEY_VERSION || !iv || !ciphertext || !tag || rest.length > 0) throw new EnvelopeError("Unrecognized wrapped key format");
  const sealed = { iv: Buffer.from(iv, "base64url"), ciphertext: Buffer.from(ciphertext, "base64url"), tag: Buffer.from(tag, "base64url") };
  // GCM would also accept a shortened tag, which weakens authentication: insist on the full sizes we write.
  if (sealed.iv.length !== IV_LENGTH || sealed.tag.length !== TAG_LENGTH) throw new EnvelopeError("Unrecognized wrapped key format");
  let key: Buffer;
  try {
    key = aesGcmOpen(deriveKey(KEK_PURPOSE), sealed, keyAad(objectId));
  } catch (cause) {
    throw new EnvelopeError("Wrapped key failed authentication", { cause });
  }
  if (key.length !== DATA_KEY_LENGTH) throw new EnvelopeError("Wrapped key has the wrong length");
  return key;
}
