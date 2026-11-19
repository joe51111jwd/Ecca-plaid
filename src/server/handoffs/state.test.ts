import { describe, expect, it } from "vitest";
import type { HandoffStatus, VerificationStatus } from "@/db/schema";
import { allowedTransitions, canTransition, FINAL_STATUSES, HANDOFF_STATUSES, isFinal, isHolding, publicVerificationStatus, targetForVerification } from "./state";

/** The complete legal-move table, written out independently of the implementation. */
const LEGAL: Record<HandoffStatus, HandoffStatus[]> = {
  started: ["verifying", "held", "eligible", "declined", "expired", "canceled"],
  verifying: ["held", "eligible", "declined", "expired", "canceled"],
  held: ["eligible", "declined", "expired", "canceled"],
  eligible: ["awarded", "declined", "expired", "canceled"],
  awarded: ["completed", "declined", "canceled"],
  completed: [],
  declined: [],
  expired: [],
  canceled: [],
};

describe("handoff state machine", () => {
  it("lists all nine statuses", () => {
    expect([...HANDOFF_STATUSES].sort()).toEqual(["awarded", "canceled", "completed", "declined", "eligible", "expired", "held", "started", "verifying"]);
  });

  describe("full transition matrix", () => {
    for (const from of HANDOFF_STATUSES) {
      for (const to of HANDOFF_STATUSES) {
        const legal = LEGAL[from].includes(to);
        it(`${from} → ${to} is ${legal ? "legal" : "illegal"}`, () => {
          expect(canTransition(from, to)).toBe(legal);
        });
      }
    }
  });

  it("allowedTransitions matches the table", () => {
    for (const s of HANDOFF_STATUSES) expect([...allowedTransitions(s)].sort()).toEqual([...LEGAL[s]].sort());
  });

  it("never moves a status to itself and never leaves a final state", () => {
    for (const s of HANDOFF_STATUSES) expect(canTransition(s, s)).toBe(false);
    for (const s of FINAL_STATUSES) expect(allowedTransitions(s)).toEqual([]);
    expect([...FINAL_STATUSES].sort()).toEqual(["canceled", "completed", "declined", "expired"]);
  });

  it("cannot reach completed except from awarded, nor awarded except from eligible", () => {
    for (const s of HANDOFF_STATUSES) {
      expect(canTransition(s, "completed")).toBe(s === "awarded");
      expect(canTransition(s, "awarded")).toBe(s === "eligible");
    }
  });

  it("an awarded booking cannot expire (the hold only guards the wait for an award)", () => {
    expect(canTransition("awarded", "expired")).toBe(false);
    expect(isHolding("awarded")).toBe(false);
    for (const s of ["started", "verifying", "held", "eligible"] as const) expect(isHolding(s)).toBe(true);
    for (const s of ["completed", "declined", "expired", "canceled"] as const) expect(isFinal(s)).toBe(true);
  });
});

describe("publicVerificationStatus", () => {
  it("only ever says eligible, not_eligible or pending", () => {
    const cases: Array<[VerificationStatus | null, string]> = [
      ["eligible", "eligible"],
      ["ineligible", "not_eligible"],
      ["pending", "pending"],
      ["needs_review", "pending"],
      ["expired", "pending"],
      ["canceled", "pending"],
      [null, "pending"],
    ];
    for (const [input, out] of cases) expect(publicVerificationStatus(input)).toBe(out);
  });
});

describe("targetForVerification", () => {
  const at = new Date("2026-11-18T12:00:00Z");
  const v = (status: VerificationStatus, p: { started?: boolean; submitted?: boolean } = {}) => ({ status, startedAt: p.started ? at : null, submittedAt: p.submitted ? at : null });

  it("maps outcomes: eligible → eligible, ineligible → declined, canceled → canceled", () => {
    expect(targetForVerification("held", v("eligible"))).toBe("eligible");
    expect(targetForVerification("held", v("ineligible"))).toBe("declined");
    expect(targetForVerification("verifying", v("canceled"))).toBe("canceled");
  });

  it("maps needs_review and submitted-pending to held, opened-pending to verifying", () => {
    expect(targetForVerification("started", v("needs_review"))).toBe("held");
    expect(targetForVerification("verifying", v("pending", { started: true, submitted: true }))).toBe("held");
    expect(targetForVerification("started", v("pending", { started: true }))).toBe("verifying");
    expect(targetForVerification("started", v("pending"))).toBeNull();
  });

  it("skips forward from started straight to eligible (a reused passport result)", () => {
    expect(targetForVerification("started", v("eligible"))).toBe("eligible");
  });

  it("never moves backwards, never re-applies the same status, ignores expiry", () => {
    expect(targetForVerification("eligible", v("needs_review"))).toBeNull();
    expect(targetForVerification("held", v("needs_review"))).toBeNull();
    expect(targetForVerification("held", v("pending", { started: true }))).toBeNull();
    expect(targetForVerification("eligible", v("eligible"))).toBeNull();
    expect(targetForVerification("held", v("expired"))).toBeNull();
  });

  it("a re-review after an award, or any change after the end, does not move the handoff", () => {
    expect(targetForVerification("awarded", v("ineligible"))).toBeNull();
    expect(targetForVerification("awarded", v("canceled"))).toBeNull();
    for (const s of ["completed", "declined", "expired", "canceled"] as const) {
      for (const status of ["eligible", "ineligible", "needs_review", "pending", "canceled"] as const) expect(targetForVerification(s, v(status, { started: true, submitted: true }))).toBeNull();
    }
  });

  it("an eligible handoff whose verification is re-decided ineligible is declined", () => {
    expect(targetForVerification("eligible", v("ineligible"))).toBe("declined");
  });
});
