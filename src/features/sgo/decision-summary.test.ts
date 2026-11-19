import { describe, expect, it } from "vitest";
import type { Decision } from "@/engine/decision";
import { reliedOnSentence, summarizeDecision } from "./decision-summary";

/**
 * SYNTHETIC decision records. Only the fields the summary reads are filled in; the figures are invented for the test
 * and are not real HUD limits.
 */
function synthetic(over: { status?: Decision["status"]; reliedOn?: string; readingsAgree?: boolean; provisional?: boolean; capPct?: number; reviewer?: boolean; threshold?: boolean }): Decision {
  const lower = 18_000_000;
  const upper = over.readingsAgree ? lower : 20_000_000;
  const relied = over.reliedOn ?? "lower_bound";
  return {
    status: over.status ?? "eligible",
    incomeYear: 2025,
    householdIncomeCents: 10_000_000,
    decidedOn: "2026-11-18",
    decidedBy: over.reviewer ? { type: "reviewer", reviewerId: "usr_SYNTHETIC", resolvedOn: "2026-11-19", notes: "Checked the synthetic W-2.", basis: { method: "direct" } } : { type: "engine" },
    threshold:
      over.threshold === false
        ? null
        : {
            provisional: over.provisional ?? true,
            source: (over.provisional ?? true) ? "hud_provisional" : "irs_published",
            tableVersion: "synthetic-table",
            effectiveDate: "2026-05-01",
            area: { code: "SYN", name: "Synthetic Area", metro: true },
            county: { fips: "48999", name: "Synthetic County" },
            householdSize: 2,
            capPct: over.capPct ?? 300,
            readings: [
              { id: "median_product", label: "x", thresholdCents: lower, statutoryThresholdCents: lower, formula: "synthetic formula A" },
              { id: "section8_vli", label: "y", thresholdCents: upper, statutoryThresholdCents: upper, formula: "synthetic formula B" },
            ],
            lowerBoundCents: lower,
            upperBoundCents: upper,
            readingsAgree: over.readingsAgree ?? false,
            reliedOn: relied,
            reliedOnLimitCents: relied === "none" ? null : relied === "upper_bound" ? upper : lower,
          },
  } as unknown as Decision;
}

describe("summarizeDecision", () => {
  it("returns null without a decision", () => {
    expect(summarizeDecision(null)).toBeNull();
  });

  it("shows both readings and marks the lower one when the result rests on it", () => {
    const s = summarizeDecision(synthetic({ reliedOn: "lower_bound" }))!;
    expect(s.limit!.readings.map((r) => [r.id, r.cents, r.reliedOn])).toEqual([
      ["median_product", 18_000_000, true],
      ["section8_vli", 20_000_000, false],
    ]);
    expect(s.limit!.reliedOnSentence).toMatch(/lower reading \(\$180,000\.00\)/);
    expect(s.limit!.reliedOnSentence).toMatch(/under every reading/);
    expect(s.limit!.provisional).toBe(true);
    expect(s.limit!.limitNoun).toBe("the provisional limit");
    expect(s.limit!.sourceName).toMatch(/provisional/i);
    expect(s.decidedByLine).toBe("Decided automatically on 2026-11-18");
  });

  it("marks the higher reading for an over-the-limit result", () => {
    const s = summarizeDecision(synthetic({ status: "ineligible", reliedOn: "upper_bound" }))!;
    expect(s.limit!.readings.find((r) => r.reliedOn)?.id).toBe("section8_vli");
    expect(s.limit!.reliedOnSentence).toMatch(/higher reading \(\$200,000\.00\)/);
  });

  it("never calls a HUD-derived figure the IRS limit, and says IRS-published only for an IRS table", () => {
    const hud = summarizeDecision(synthetic({ reliedOn: "single_limit", readingsAgree: true }))!;
    expect(JSON.stringify(hud)).not.toMatch(/IRS limit|IRS-published limit/);
    const irs = summarizeDecision(synthetic({ reliedOn: "single_limit", readingsAgree: true, provisional: false }))!;
    expect(irs.limit!.limitNoun).toBe("the IRS-published limit");
    expect(irs.limit!.reliedOnSentence).toMatch(/IRS-published limit/);
  });

  it("notes a stricter SGO cap and reviewer decisions with their notes", () => {
    const s = summarizeDecision(synthetic({ capPct: 250, reviewer: true }))!;
    expect(s.limit!.capNote).toMatch(/250 percent/);
    expect(s.decidedByLine).toBe("Decided by a reviewer on 2026-11-19");
    expect(s.reviewerNotes).toBe("Checked the synthetic W-2.");
  });

  it("handles a pending decision without a threshold", () => {
    const s = summarizeDecision(synthetic({ status: "pending", threshold: false }))!;
    expect(s.limit).toBeNull();
    expect(s.decidedByLine).toBe("Not decided yet");
  });
});

describe("reliedOnSentence", () => {
  it("covers every relied-on value", () => {
    expect(reliedOnSentence("none", null, true, false)).toBe("No income comparison decided this result.");
    expect(reliedOnSentence("statutory_limit", 1_000_00, true, false)).toMatch(/statutory 300 percent \(\$1,000\.00\)/);
    expect(reliedOnSentence("single_limit", 5_000_00, true, false)).toMatch(/provisional limit/);
  });
});
