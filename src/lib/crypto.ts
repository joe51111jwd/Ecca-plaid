import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as nodeSign,
  timingSafeEqual,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, isProd } from "./env";

/* ------------------------------------------------------------------ hashing */

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Hash for secrets we must look up by value (session tokens, API keys, magic-link tokens). */
export function hashToken(token: string): string {
  return sha256Hex(`ecca-token-v1:${token}`);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/* --------------------------------------------------------------- master key */

let masterKey: Buffer | null = null;

/**
 * 32-byte root key. In production it must come from ECCA_MASTER_KEY. In development a random key is
 * generated once and kept in ECCA_DATA_DIR so local encrypted data stays readable across restarts.
 */
export function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  const fromEnv = env().ECCA_MASTER_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("ECCA_MASTER_KEY must be 32 bytes, base64-encoded");
    masterKey = key;
    return key;
  }
  if (isProd()) throw new Error("ECCA_MASTER_KEY is required in production");
  if (env().NODE_ENV === "test") {
    masterKey = createHash("sha256").update("ecca-test-master-key").digest();
    return masterKey;
  }
  const dir = env().ECCA_DATA_DIR;
  const file = join(dir, "dev-master.key");
  if (existsSync(file)) {
    masterKey = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  } else {
    mkdirSync(dir, { recursive: true });
    masterKey = randomBytes(32);
    writeFileSync(file, masterKey.toString("base64"), { mode: 0o600 });
  }
  return masterKey;
}

/** Purpose-bound sub-key so a key used for one thing can never decrypt another. */
export function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", getMasterKey(), Buffer.alloc(0), `ecca:${purpose}`, 32));
}

/* -------------------------------------------------------------- AES-256-GCM */

export interface Sealed {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export function aesGcmSeal(key: Buffer, plaintext: Uint8Array, aad?: Uint8Array): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ciphertext, tag: cipher.getAuthTag() };
}

export function aesGcmOpen(key: Buffer, sealed: Sealed, aad?: Uint8Array): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}

/**
 * Field-level encryption for sensitive columns (suffix `_enc`): dates of birth, extraction payloads,
 * rail access tokens, webhook secrets. Format: `v1.<iv>.<ciphertext>.<tag>` (base64url).
 */
export function encryptField(plaintext: string, purpose = "field"): string {
  const s = aesGcmSeal(deriveKey(purpose), Buffer.from(plaintext, "utf8"));
  return `v1.${s.iv.toString("base64url")}.${s.ciphertext.toString("base64url")}.${s.tag.toString("base64url")}`;
}

export function decryptField(value: string, purpose = "field"): string {
  const [v, iv, ct, tag] = value.split(".");
  if (v !== "v1" || !iv || ct === undefined || !tag) throw new Error("Unrecognized encrypted field format");
  return aesGcmOpen(deriveKey(purpose), {
    iv: Buffer.from(iv, "base64url"),
    ciphertext: Buffer.from(ct, "base64url"),
    tag: Buffer.from(tag, "base64url"),
  }).toString("utf8");
}

export function encryptJson(value: unknown, purpose = "field"): string {
  return encryptField(JSON.stringify(value), purpose);
}

export function decryptJson<T = unknown>(value: string, purpose = "field"): T {
  return JSON.parse(decryptField(value, purpose)) as T;
}

/* ------------------------------------------------------- canonical JSON (JCS) */

/**
 * RFC 8785-style canonical JSON for the value shapes we sign: objects (sorted keys), arrays, strings,
 * booleans, null and safe integers. Non-integer numbers are rejected so signatures can never depend on
 * float formatting — express money in cents and ratios as strings.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonicalJson only supports safe integers; encode other numbers as strings");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson cannot encode ${typeof value}`);
}

/* ------------------------------------------------------------------ Ed25519 */

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

let signingKey: SigningKey | null = null;

/** Key that signs evidence records. Production: EVIDENCE_SIGNING_PRIVATE_KEY. Dev: generated and kept in ECCA_DATA_DIR. */
export function getSigningKey(): SigningKey {
  if (signingKey) return signingKey;
  let pem = env().EVIDENCE_SIGNING_PRIVATE_KEY;
  if (!pem) {
    if (isProd()) throw new Error("EVIDENCE_SIGNING_PRIVATE_KEY is required in production");
    const dir = env().ECCA_DATA_DIR;
    const file = join(dir, "dev-evidence-signing.pem");
    if (env().NODE_ENV !== "test" && existsSync(file)) {
      pem = readFileSync(file, "utf8");
    } else {
      const { privateKey } = generateKeyPairSync("ed25519");
      pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      if (env().NODE_ENV !== "test") {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, pem, { mode: 0o600 });
      }
    }
  }
  const privateKey = createPrivateKey(pem.replace(/\\n/g, "\n"));
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  const kid = env().EVIDENCE_SIGNING_KEY_ID || `ed25519-${sha256Hex(jwk.x).slice(0, 16)}`;
  signingKey = { kid, privateKey, publicKey };
  return signingKey;
}

export function ed25519Sign(data: Uint8Array, key: KeyObject = getSigningKey().privateKey): string {
  return nodeSign(null, data, key).toString("base64url");
}

export function ed25519Verify(data: Uint8Array, signature: string, publicKey: KeyObject): boolean {
  try {
    return nodeVerify(null, data, publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

/** Public JWK ({kty:"OKP",crv:"Ed25519",x,kid,use,alg}) for /.well-known/jwks.json. */
export function publicJwk(key: SigningKey = getSigningKey()): Record<string, string> {
  const jwk = key.publicKey.export({ format: "jwk" }) as Record<string, string>;
  return { ...jwk, kid: key.kid, use: "sig", alg: "EdDSA" };
}

export function publicKeyFromJwk(jwk: Record<string, string>): KeyObject {
  return createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" });
}
