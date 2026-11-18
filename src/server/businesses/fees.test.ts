import { describe, expect, it } from "vitest";
import { describeFeeTerms, FAMILY_AND_SCHOLARSHIP_PROTECTION, formatBps } from "./fees";

// Synthetic business name and fee amounts; the spec sets no fee amounts.
const base = { displayName: "Synthetic Camp Co", successFeeFlatCents: 0, successFeeBps: 0 };

describe("formatBps", () => {
  it.each([
    [0, "0%"],
    [1, "0.01%"],
    [10, "0.1%"],
    [99, "0.99%"],
    [100, "1%"],
    [250, "2.5%"],
    [1000, "10%"],
    [1234, "12.34%"],
    [2000, "20%"],
  ])("%i → %s", (bps, text) => expect(formatBps(bps)).toBe(text));

  it("rejects negative or fractional basis points", () => {
    expect(() => formatBps(-1)).toThrow();
    expect(() => formatBps(1.5)).toThrow();
    expect(() => formatBps(Number.NaN)).toThrow();
  });
});

describe("describeFeeTerms", () => {
  it("always says families are never charged and the fee is never taken from scholarship funds", () => {
    for (const terms of [
      { successFeeFlatCents: 0, successFeeBps: 0 },
      { successFeeFlatCents: 2500, successFeeBps: 0 },
      { successFeeFlatCents: 0, successFeeBps: 250 },
      { successFeeFlatCents: 1999, successFeeBps: 1 },
    ]) {
      const text = describeFeeTerms({ ...base, ...terms });
      expect(text.endsWith(FAMILY_AND_SCHOLARSHIP_PROTECTION)).toBe(true);
      expect(text).toMatch(/Families are never charged/);
      expect(text).toMatch(/never taken from scholarship funds/);
    }
  });

  it("states a flat fee", () => {
    expect(describeFeeTerms({ ...base, successFeeFlatCents: 2500 })).toBe(
      `Synthetic Camp Co pays a success fee of $25 for each booking completed with scholarship funds, billed to Synthetic Camp Co on its own invoice. ${FAMILY_AND_SCHOLARSHIP_PROTECTION}`,
    );
    expect(describeFeeTerms({ ...base, successFeeFlatCents: 1999 })).toMatch(/\$19\.99 for each booking/);
  });

  it("states a percentage fee", () => {
    expect(describeFeeTerms({ ...base, successFeeBps: 250 })).toMatch(/success fee of 2\.5% of the booking amount for each booking/);
  });

  it("states both parts together", () => {
    expect(describeFeeTerms({ ...base, successFeeFlatCents: 1000, successFeeBps: 300 })).toMatch(/success fee of \$10 plus 3% of the booking amount/);
  });

  it("states that no fee applies when both parts are zero", () => {
    expect(describeFeeTerms(base)).toBe(`Synthetic Camp Co currently pays no success fee for bookings completed with scholarship funds. ${FAMILY_AND_SCHOLARSHIP_PROTECTION}`);
  });

  it("falls back to a generic subject for a blank name and refuses invalid amounts", () => {
    expect(describeFeeTerms({ ...base, displayName: "  " })).toMatch(/^This business currently pays/);
    expect(() => describeFeeTerms({ ...base, successFeeFlatCents: -1 })).toThrow();
    expect(() => describeFeeTerms({ ...base, successFeeFlatCents: 1.5 })).toThrow();
    expect(() => describeFeeTerms({ ...base, successFeeBps: -5 })).toThrow();
  });
});
