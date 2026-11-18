import { describe, expect, it } from "vitest";
import { countWords, ENTRIES, HONEST, MELT, PIECES, pageBodyText, SITE_CTA, TICKER, WORD_BUDGET } from "./site-copy";

describe("site copy", () => {
  it("stays within the page word budget", () => {
    expect(countWords(pageBodyText())).toBeLessThanOrEqual(WORD_BUDGET);
  });

  it("counts words the way a reader does", () => {
    expect(countWords("CAP · $1,700 PER TAXPAYER")).toBe(4);
    expect(countWords("300% of area median")).toBe(4);
    expect(countWords("· ▪ →")).toBe(0);
  });

  it("keeps items short: numbered names 2-3 words, lines at most 6", () => {
    for (const item of PIECES.items) {
      expect(countWords(item.name)).toBeGreaterThanOrEqual(2);
      expect(countWords(item.name)).toBeLessThanOrEqual(3);
      expect(countWords(item.line)).toBeLessThanOrEqual(6);
    }
    for (const tile of ENTRIES.tiles) expect(countWords(tile.line)).toBeLessThanOrEqual(5);
    expect(MELT.captions).toHaveLength(3);
  });

  it("follows the copy rules: no 'free', proposed rules flagged, limits provisional", () => {
    const text = pageBodyText().toLowerCase();
    expect(text).not.toMatch(/\bfree\b/);
    expect(HONEST.chips.some((c) => /proposed rules/i.test(c))).toBe(true);
    expect(HONEST.chips.some((c) => /provisional/i.test(c))).toBe(true);
    // Never claims the IRS table or SGO list is published.
    expect(text).not.toMatch(/irs (table|list) (is|has been) published/);
  });

  it("states only the dated facts from the spec", () => {
    expect(Object.fromEntries(TICKER)).toEqual({
      "Credit starts": "Jan 1, 2027",
      "Comments due": "Dec 1, 2026",
      "State SGO lists due": "Feb 15, 2027",
      Cap: "$1,700 per taxpayer",
      Limit: "300% of area median",
      Texas: "254 counties",
    });
  });

  it("points the call to action at the test workspace signup", () => {
    expect(SITE_CTA.href).toBe("/sgo/signup");
    expect(ENTRIES.tiles.map((t) => t.href)).toEqual(["/give", "/family", "/sgo", "/partner"]);
  });
});
