import { describe, expect, it } from "vitest";
import { shortHash } from "./display";

describe("shortHash", () => {
  const sha = "77c11c64fe4fb3b4e4bc36d666f738b27f6c5fc61204ce539707e9d68a8b0a89";

  it("keeps the head and tail of a long value", () => {
    expect(shortHash(sha)).toBe("77c11c64…8b0a89");
    expect(shortHash(sha, 4, 4)).toBe("77c1…0a89");
  });

  it("returns short values whole (nothing worth hiding)", () => {
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("a".repeat(17))).toBe("a".repeat(17));
    expect(shortHash("a".repeat(18))).toBe("aaaaaaaa…aaaaaa");
    expect(shortHash("")).toBe("");
  });

  it("trims whitespace and survives nonsense lengths", () => {
    expect(shortHash(`  ${sha}  `)).toBe("77c11c64…8b0a89");
    expect(shortHash(sha, 0, -5)).toBe("7…9");
    expect(shortHash(sha, Number.NaN, 2.7)).toBe(shortHash(sha, 1, 2));
  });
});
