import { describe, expect, it } from "vitest";
import { deriveKey } from "@/lib/crypto";
import { DATA_KEY_LENGTH, ENVELOPE_OVERHEAD, ENVELOPE_VERSION, EnvelopeError, newDataKey, openEnvelope, sealEnvelope, unwrapDataKey, wrapDataKey } from "./envelope";

const plaintext = Buffer.from("SYNTHETIC award letter contents - not a real document");
const flip = (buf: Buffer, index: number) => {
  const copy = Buffer.from(buf);
  copy[index] ^= 0x01;
  return copy;
};

describe("object envelope", () => {
  it("has the documented layout: magic, version, IV, tag, ciphertext", () => {
    const key = newDataKey();
    const envelope = sealEnvelope(key, plaintext, "obj_1");
    expect(ENVELOPE_OVERHEAD).toBe(33);
    expect(envelope).toHaveLength(plaintext.length + 33);
    expect(envelope.subarray(0, 4).toString("ascii")).toBe("ECCA");
    expect(envelope[4]).toBe(ENVELOPE_VERSION);
    expect(envelope.includes(plaintext)).toBe(false);
    expect(envelope.includes(Buffer.from("SYNTHETIC"))).toBe(false);
  });

  it("round-trips, including empty and large payloads and non-Buffer views", () => {
    const key = newDataKey();
    expect(openEnvelope(key, sealEnvelope(key, plaintext, "obj_1"), "obj_1")).toEqual(plaintext);
    expect(openEnvelope(key, sealEnvelope(key, new Uint8Array(0), "obj_1"), "obj_1")).toEqual(Buffer.alloc(0));
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    expect(openEnvelope(key, sealEnvelope(key, big, "obj_1"), "obj_1").equals(big)).toBe(true);
    const sealed = sealEnvelope(key, plaintext, "obj_1");
    const padded = new Uint8Array(sealed.length + 8);
    padded.set(sealed, 4);
    expect(openEnvelope(key, padded.subarray(4, 4 + sealed.length), "obj_1")).toEqual(plaintext);
  });

  it("uses a fresh IV every time", () => {
    const key = newDataKey();
    const a = sealEnvelope(key, plaintext, "obj_1");
    const b = sealEnvelope(key, plaintext, "obj_1");
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(5, 17).equals(b.subarray(5, 17))).toBe(false);
  });

  it("detects a flipped bit anywhere in the envelope", () => {
    const key = newDataKey();
    const envelope = sealEnvelope(key, plaintext, "obj_1");
    for (let i = 0; i < envelope.length; i++) {
      expect(() => openEnvelope(key, flip(envelope, i), "obj_1"), `byte ${i}`).toThrow(EnvelopeError);
    }
  });

  it("detects truncation, extension and garbage", () => {
    const key = newDataKey();
    const envelope = sealEnvelope(key, plaintext, "obj_1");
    expect(() => openEnvelope(key, envelope.subarray(0, envelope.length - 1), "obj_1")).toThrow(EnvelopeError);
    expect(() => openEnvelope(key, envelope.subarray(0, 20), "obj_1")).toThrow(/Not an object envelope/);
    expect(() => openEnvelope(key, Buffer.concat([envelope, Buffer.from([0])]), "obj_1")).toThrow(EnvelopeError);
    expect(() => openEnvelope(key, Buffer.alloc(0), "obj_1")).toThrow(/Not an object envelope/);
    expect(() => openEnvelope(key, plaintext, "obj_1")).toThrow(/Not an object envelope/);
  });

  it("refuses an unknown format version rather than guessing", () => {
    const key = newDataKey();
    const envelope = sealEnvelope(key, plaintext, "obj_1");
    envelope[4] = 2;
    expect(() => openEnvelope(key, envelope, "obj_1")).toThrow(/Unsupported object envelope version 2/);
  });

  it("is bound to its object id and its key", () => {
    const key = newDataKey();
    const envelope = sealEnvelope(key, plaintext, "obj_1");
    expect(() => openEnvelope(key, envelope, "obj_2")).toThrow(/failed authentication/);
    expect(() => openEnvelope(newDataKey(), envelope, "obj_1")).toThrow(/failed authentication/);
  });

  it("insists on 32-byte data keys", () => {
    expect(newDataKey()).toHaveLength(DATA_KEY_LENGTH);
    expect(() => sealEnvelope(Buffer.alloc(16), plaintext, "obj_1")).toThrow(EnvelopeError);
    expect(() => wrapDataKey(Buffer.alloc(31), "obj_1")).toThrow(EnvelopeError);
  });
});

describe("data key wrapping", () => {
  it("round-trips through the versioned text format", () => {
    const key = newDataKey();
    const wrapped = wrapDataKey(key, "obj_1");
    expect(wrapped).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/);
    expect(wrapped).not.toContain(key.toString("base64url"));
    expect(unwrapDataKey(wrapped, "obj_1")).toEqual(key);
    expect(wrapDataKey(key, "obj_1")).not.toBe(wrapped);
  });

  it("is bound to the object id, so a wrapped key cannot be moved to another row", () => {
    const wrapped = wrapDataKey(newDataKey(), "obj_1");
    expect(() => unwrapDataKey(wrapped, "obj_2")).toThrow(/failed authentication/);
  });

  it("uses a key-encryption key that is separate from other purposes", () => {
    expect(deriveKey("object-kek").equals(deriveKey("field"))).toBe(false);
  });

  it("rejects tampered, truncated and malformed values", () => {
    const wrapped = wrapDataKey(newDataKey(), "obj_1");
    const [v, iv, ct, tag] = wrapped.split(".");
    const mutate = (s: string) => (s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`);
    for (const bad of [
      `${v}.${mutate(iv)}.${ct}.${tag}`,
      `${v}.${iv}.${mutate(ct)}.${tag}`,
      `${v}.${iv}.${ct}.${mutate(tag)}`,
      `v2.${iv}.${ct}.${tag}`,
      `${v}.${iv}.${ct}`,
      `${v}.${iv}.${ct}.${tag}.extra`,
      `${v}..${ct}.${tag}`,
      "purged",
      "",
    ]) {
      expect(() => unwrapDataKey(bad, "obj_1"), bad).toThrow(EnvelopeError);
    }
  });

  it("does not accept a shortened authentication tag", () => {
    const wrapped = wrapDataKey(newDataKey(), "obj_1");
    const [v, iv, ct, tag] = wrapped.split(".");
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => unwrapDataKey(`${v}.${iv}.${ct}.${shortTag}`, "obj_1")).toThrow(/Unrecognized wrapped key format/);
  });
});
