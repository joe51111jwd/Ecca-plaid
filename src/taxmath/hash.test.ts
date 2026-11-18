import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "./hash";

const reference = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    for (const vector of ["", "abc", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"]) expect(sha256Hex(vector)).toBe(reference(vector));
  });

  it("matches node:crypto at every length around the block boundaries", () => {
    for (let length = 0; length <= 200; length++) {
      const text = "a".repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(reference(text));
    }
  });

  it("matches node:crypto on random bytes, long inputs and non-ASCII text", () => {
    for (const length of [1, 31, 32, 33, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096, 100_003]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256Hex(bytes), `random ${length}`).toBe(reference(bytes));
    }
    for (const text of ["Fondo Sintético: crédito ñ ü", "日本語のテキスト", "emoji 🎓 and \u0000 control", "é".repeat(777)]) {
      expect(sha256Hex(text)).toBe(reference(text));
    }
  });

  it("is deterministic and sensitive to every character", () => {
    expect(sha256Hex("section 25F")).toBe(sha256Hex("section 25F"));
    expect(sha256Hex("section 25F")).not.toBe(sha256Hex("section 25f"));
    expect(sha256Hex("$1,700")).not.toBe(sha256Hex("$1,700 "));
  });
});

describe("stableStringify", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });

  it("encodes strings, booleans and numbers as JSON does, and drops undefined properties", () => {
    expect(stableStringify('he said "hi"\n')).toBe(JSON.stringify('he said "hi"\n'));
    expect(stableStringify([true, false, 0, -1, 1.5])).toBe("[true,false,0,-1,1.5]");
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("refuses values that have no stable encoding", () => {
    expect(() => stableStringify(Number.NaN)).toThrow(TypeError);
    expect(() => stableStringify(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => stableStringify(undefined)).toThrow(TypeError);
    expect(() => stableStringify(() => 1)).toThrow(TypeError);
    expect(() => stableStringify(10n)).toThrow(TypeError);
  });
});
