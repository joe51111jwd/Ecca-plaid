import { describe, expect, it } from "vitest";
import type { HandoffStatus } from "@/db/schema";
import { HANDOFF_STATUSES } from "@/server/handoffs";
import { familyPageCopy, pickFamilyLocale, verificationButtonLabel } from "./copy";
import { buildReturnHref, formatUsdString, progressSteps, resolveParentOrigin, returnAllowedFor, safeBrandColor, shouldPoll } from "./family-view";
import { closedMessage, MESSAGE_SOURCE, statusMessage } from "./messages";

describe("progressSteps", () => {
  const states = (s: HandoffStatus) => progressSteps(s, "en").map((p) => p.state);

  it("puts every holding status on the income check or the organization's decision", () => {
    expect(states("started")).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(states("verifying")).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(states("held")).toEqual(["done", "current", "upcoming", "upcoming"]);
    // Eligible is NOT the end: the organization still has to decide.
    expect(states("eligible")).toEqual(["done", "done", "current", "upcoming"]);
    expect(states("awarded")).toEqual(["done", "done", "done", "current"]);
    expect(states("completed")).toEqual(["done", "done", "done", "done"]);
  });

  it.each(["declined", "expired", "canceled"] as const)("marks %s as stopped, never as done", (s) => {
    expect(states(s)).toEqual(["done", "stopped", "upcoming", "upcoming"]);
  });

  it.each(["declined", "expired", "canceled"] as const)("a household verified eligible that ends %s stops at the organization's decision, not the income check", (s) => {
    expect(progressSteps(s, "en", { verifiedEligible: true }).map((p) => p.state)).toEqual(["done", "done", "stopped", "upcoming"]);
    expect(progressSteps(s, "en", { verifiedEligible: false }).map((p) => p.state)).toEqual(["done", "stopped", "upcoming", "upcoming"]);
  });

  it("ignores the verification for open and completed handoffs (the status alone places them)", () => {
    expect(progressSteps("held", "en", { verifiedEligible: true }).map((p) => p.state)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(progressSteps("completed", "en", { verifiedEligible: false }).map((p) => p.state)).toEqual(["done", "done", "done", "done"]);
  });

  it("labels the steps in both languages", () => {
    expect(progressSteps("held", "en").map((p) => p.label)).toEqual(["Spot held", "Income check", "Organization decides", "Booking confirmed"]);
    expect(progressSteps("held", "es")[2].label).toBe("La organización decide");
  });
});

describe("shouldPoll", () => {
  it("polls until the handoff is final", () => {
    expect(HANDOFF_STATUSES.filter(shouldPoll)).toEqual(["started", "verifying", "held", "eligible", "awarded"]);
  });
});

describe("buildReturnHref", () => {
  it("appends handoff_id and status, keeping the business's own query and fragment", () => {
    expect(buildReturnHref("https://camp.synthetic-example.org/booking/1?step=pay#top", { handoffId: "hof_1", status: "held" })).toBe(
      "https://camp.synthetic-example.org/booking/1?step=pay&handoff_id=hof_1&status=held#top",
    );
  });

  it("overwrites a handoff_id the business URL already carried", () => {
    expect(buildReturnHref("https://camp.synthetic-example.org/b?handoff_id=forged", { handoffId: "hof_2", status: "eligible" })).toBe("https://camp.synthetic-example.org/b?handoff_id=hof_2&status=eligible");
  });

  it.each([null, "", "not a url", "javascript:alert(1)", "data:text/html,hi", "ftp://camp.example/x"])("returns null for %j", (u) => {
    expect(buildReturnHref(u, { handoffId: "hof_1", status: "held" })).toBeNull();
  });
});

describe("resolveParentOrigin", () => {
  const allowed = ["https://camp.synthetic-example.org", "http://localhost:3124"];

  it("accepts an allowed origin in canonical form", () => {
    expect(resolveParentOrigin("https://CAMP.synthetic-example.org", allowed)).toBe("https://camp.synthetic-example.org");
    expect(resolveParentOrigin(["http://localhost:3124", "https://evil.example"], allowed)).toBe("http://localhost:3124");
  });

  it.each([undefined, null, "", "https://evil.example", "https://camp.synthetic-example.org.evil.example", "https://camp.synthetic-example.org/path", "null", "x".repeat(3000)])("refuses %j", (raw) => {
    expect(resolveParentOrigin(raw as string | null | undefined, allowed)).toBeNull();
  });

  it("refuses everything when the business allows no origin", () => {
    expect(resolveParentOrigin("https://camp.synthetic-example.org", [])).toBeNull();
  });
});

describe("returnAllowedFor", () => {
  it("allows only URLs on an allowed origin", () => {
    expect(returnAllowedFor(["https://camp.synthetic-example.org"], "https://camp.synthetic-example.org/b/1")).toBe(true);
    expect(returnAllowedFor(["https://camp.synthetic-example.org"], "https://evil.example/b/1")).toBe(false);
  });
});

describe("messages", () => {
  it("carries id, status and hold only", () => {
    const m = statusMessage({ id: "hof_1", status: "held", hold: { expiresAt: "2026-11-21T16:00:00.000Z" } });
    expect(m).toEqual({ source: MESSAGE_SOURCE, type: "handoff.status", handoff_id: "hof_1", status: "held", hold_expires_at: "2026-11-21T16:00:00.000Z" });
    expect(closedMessage({ id: "hof_1", status: "eligible" })).toEqual({ source: "ecca-embed", type: "handoff.closed", handoff_id: "hof_1", status: "eligible" });
  });
});

describe("formatting", () => {
  it("formats the service's decimal strings", () => {
    expect(formatUsdString("450.00")).toBe("$450.00");
    expect(formatUsdString("1250000.05")).toBe("$1,250,000.05");
    expect(formatUsdString(null)).toBeNull();
    expect(formatUsdString("450")).toBeNull();
  });

  it("accepts only six-digit hex brand colors", () => {
    expect(safeBrandColor("#1f5c3f")).toBe("#1f5c3f");
    expect(safeBrandColor("red; background:url(x)")).toBeNull();
    expect(safeBrandColor("#fff")).toBeNull();
    expect(safeBrandColor(null)).toBeNull();
  });
});

describe("family page copy", () => {
  it("picks Spanish only for lang=es", () => {
    expect(pickFamilyLocale("es")).toBe("es");
    expect(pickFamilyLocale(["es", "en"])).toBe("es");
    expect(pickFamilyLocale("fr")).toBe("en");
    expect(pickFamilyLocale(undefined)).toBe("en");
  });

  it("labels the verification button by where the family is", () => {
    expect(verificationButtonLabel("en", "started")).toBe("Check if I qualify");
    expect(verificationButtonLabel("en", "verifying")).toBe("Continue my income check");
    expect(verificationButtonLabel("en", "eligible")).toBe("See my verification result");
  });

  it("states the offer and the hold in the words the product uses", () => {
    expect(familyPageCopy("en").offer).toBe("A partner scholarship organization can check if you qualify.");
    expect(familyPageCopy("en").holdLine("November 21, 2026 at 10:00 AM CST")).toBe("We'll hold your spot until November 21, 2026 at 10:00 AM CST.");
  });

  it.each(["en", "es"] as const)("never mentions fees, prices for the family, or a promise of payment (%s)", (locale) => {
    const t = familyPageCopy(locale);
    const all = JSON.stringify(t, (_k, v) => (typeof v === "function" ? v("Synthetic Camp") : v));
    expect(all).not.toMatch(/\bfee\b|\btarifa\b|guarantee(d)? (a )?(scholarship|payment)|will be paid|garantiza(mos)? (una )?beca|pago garantizado/i);
  });
});
