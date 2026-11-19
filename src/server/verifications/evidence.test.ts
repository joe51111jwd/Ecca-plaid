import { describe, expect, it } from "vitest";
import { removeSsnPatterns } from "@/engine/evidence/text";
import { citeSha256 } from "./evidence";

describe("citeSha256", () => {
  // SYNTHETIC digests. The first held exactly nine digits in a row ("867898892") and lost them to the evidence
  // engine's Social-Security-number scrub when cited verbatim in a timeline entry.
  const nineDigitRun = "95fb2e867898892ef709cd3eef025673ce45a7e7abbbeffb1a82e83cb0464bbc";
  const allDigits = "1234567890".repeat(6) + "1234";

  it("a verbatim digest can be cut by the scrub; the grouped citation never is", () => {
    expect(removeSsnPatterns(`SHA-256 ${nineDigitRun}`).removed).toBe(1);
    for (const hex of [nineDigitRun, allDigits, "0".repeat(64), "a".repeat(64)]) {
      const cited = citeSha256(hex);
      expect(removeSsnPatterns(`Reuses verification ver_x (evidence record SHA-256 ${cited}) with a new consent.`).removed, hex).toBe(0);
      expect(cited.replace(/ /g, "")).toBe(hex);
      expect(cited.split(" ").every((group) => group.length === 8)).toBe(true);
    }
  });
});
