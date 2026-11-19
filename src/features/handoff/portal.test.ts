import { describe, expect, it } from "vitest";
import type { HandoffStatus } from "@/db/schema";
import { HANDOFF_STATUSES, type HandoffConversionStats } from "@/server/handoffs";
import { businessWebhookEvents, buildFunnel, embedSnippet, holdExtensionChoices, percent, pickMode, portalHref, serverCreateExample, timelineFromAudit, timeUntil, type AuditEntryLike } from "./portal";

function stats(counts: Partial<Record<HandoffStatus, number>>): HandoffConversionStats {
  const byStatus = Object.fromEntries(HANDOFF_STATUSES.map((s) => [s, counts[s] ?? 0])) as Record<HandoffStatus, number>;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const reachedEligible = byStatus.eligible + byStatus.awarded + byStatus.completed;
  return { mode: "test", since: null, total, byStatus, reachedEligible, completed: byStatus.completed, completionRateBps: 0, eligibleToCompletedBps: 0 };
}

describe("holdExtensionChoices", () => {
  it("offers the policy choices that fit the remaining allowance", () => {
    expect(holdExtensionChoices(720)).toEqual([12, 24, 48, 72]);
    expect(holdExtensionChoices(30)).toEqual([12, 24]);
    expect(holdExtensionChoices(12)).toEqual([12]);
  });
  it("offers the whole remainder when it is smaller than every choice, never an empty picker", () => {
    expect(holdExtensionChoices(11)).toEqual([11]);
    expect(holdExtensionChoices(1)).toEqual([1]);
    expect(holdExtensionChoices(5.9)).toEqual([5]);
  });
  it("offers nothing when no allowance is left (or the input is nonsense)", () => {
    expect(holdExtensionChoices(0)).toEqual([]);
    expect(holdExtensionChoices(0.5)).toEqual([]);
    expect(holdExtensionChoices(-3)).toEqual([]);
    expect(holdExtensionChoices(Number.NaN)).toEqual([]);
  });
});

describe("percent", () => {
  it("floors to whole percent with integer math", () => {
    expect(percent(1, 3)).toBe("33%");
    expect(percent(2, 3)).toBe("66%");
    expect(percent(3, 3)).toBe("100%");
    expect(percent(0, 0)).toBe("—");
  });
  it("rejects nonsense", () => {
    expect(() => percent(-1, 3)).toThrow();
    expect(() => percent(1.5, 3)).toThrow();
  });
});

describe("buildFunnel", () => {
  it("counts each step as reached-at-some-point, so it never increases", () => {
    const f = buildFunnel(stats({ started: 2, verifying: 1, held: 3, eligible: 2, awarded: 1, completed: 1, declined: 2, expired: 1, canceled: 1 }));
    expect(f.total).toBe(14);
    expect(f.steps.map((s) => [s.key, s.count, s.share])).toEqual([
      ["started", 14, "100%"],
      ["eligible", 4, "28%"],
      ["awarded", 2, "14%"],
      ["completed", 1, "7%"],
    ]);
    for (let i = 1; i < f.steps.length; i++) expect(f.steps[i].count).toBeLessThanOrEqual(f.steps[i - 1].count);
    expect(f.ended).toEqual({ declined: 2, expired: 1, canceled: 1 });
    expect(f.holding).toBe(8);
  });

  it("handles a business with no handoffs", () => {
    const f = buildFunnel(stats({}));
    expect(f.steps.every((s) => s.count === 0 && s.share === "—")).toBe(true);
  });

  it("says eligible is not an award", () => {
    expect(buildFunnel(stats({})).steps[1].description).toMatch(/Not an award/);
  });
});

describe("pickMode / portalHref", () => {
  it("falls back to the deployment's mode", () => {
    expect(pickMode("live", "test")).toBe("live");
    expect(pickMode(["test"], "live")).toBe("test");
    expect(pickMode("prod", "test")).toBe("test");
    expect(pickMode(undefined, "live")).toBe("live");
  });

  it("carries org and mode only when they differ from the defaults", () => {
    const base = { orgId: "org_a", mode: "test" as const, defaultOrgId: "org_a", defaultMode: "test" as const };
    expect(portalHref("/partner/handoffs", base)).toBe("/partner/handoffs");
    expect(portalHref("/partner/handoffs", { ...base, orgId: "org_b", mode: "live" })).toBe("/partner/handoffs?org=org_b&mode=live");
    expect(portalHref("/partner/handoffs", base, { status: "held", empty: "", none: undefined })).toBe("/partner/handoffs?status=held");
  });
});

describe("timeUntil", () => {
  const at = new Date("2026-11-18T12:00:00Z");
  it.each([
    [1, "in 1 minute"],
    [45 * 60_000, "in 45 minutes"],
    [60 * 60_000, "in 1 hour"],
    [5 * 3_600_000 + 1, "in 5 hours"],
    [47 * 3_600_000, "in 47 hours"],
    [72 * 3_600_000, "in 3 days"],
  ])("%d ms → %s", (ms, text) => {
    expect(timeUntil(new Date(at.getTime() + ms), at)).toBe(text);
  });
  it("says now for a deadline that passed", () => {
    expect(timeUntil(new Date(at.getTime() - 1), at)).toBe("now");
  });
});

describe("timelineFromAudit", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 18, 12, m));
  const entries: AuditEntryLike[] = [
    { id: "a3", at: at(3), action: "handoff.held", actorType: "system", metadata: { from: "verifying", to: "held" } },
    { id: "a1", at: at(1), action: "handoff.create", actorType: "system", metadata: { createdVia: "embed" } },
    { id: "a2", at: at(2), action: "handoff.hold_extended", actorType: "user", metadata: { hours: 24, to: "2026-11-22T12:00:00.000Z" } },
    { id: "a4", at: at(4), action: "handoff.canceled", actorType: "user", metadata: { reason: "Family moved to session 3" } },
    { id: "a5", at: at(5), action: "handoff.declined", actorType: "user", metadata: { cause: "sgo_declined", reason: "internal SGO note" } },
    { id: "a6", at: at(6), action: "verification.read", actorType: "user", metadata: {} },
    { id: "a7", at: at(7), action: "handoff.unknown_status", actorType: "system", metadata: null },
  ];

  it("orders oldest first and describes each change in business terms", () => {
    const t = timelineFromAudit(entries);
    expect(t.map((e) => e.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(t[0]).toMatchObject({ title: "Handoff created", description: "From the button on your booking page.", actor: "System" });
    expect(t[1]).toMatchObject({ title: "Hold extended by 24 hours", description: "New deadline: 2026-11-22T12:00:00.000Z", actor: "Your team" });
    expect(t[2].title).toBe("Family submitted; result pending");
    expect(t[3].description).toBe("Reason: Family moved to session 3");
  });

  it("never shows an SGO's decline reason to the business", () => {
    const declined = timelineFromAudit(entries).find((e) => e.id === "a5")!;
    expect(declined.description).not.toContain("internal SGO note");
    expect(declined.title).toBe("No scholarship for this booking");
  });

  it("calls eligible what it is", () => {
    const [e] = timelineFromAudit([{ id: "x", at: at(1), action: "handoff.eligible", actorType: "system", metadata: {} }]);
    expect(e.title).toMatch(/awaiting the SGO's award decision/);
  });
});

describe("install snippets", () => {
  it("builds the embed snippet for this business's key and host", () => {
    const s = embedSnippet("http://localhost:3124", "pk_test_" + "b".repeat(32), "inline");
    expect(s).toContain('src="http://localhost:3124/embed/handoff.js"');
    expect(s).toContain(`data-publishable-key="pk_test_${"b".repeat(32)}"`);
    expect(s).toContain('data-mode="inline"');
    expect(s).toContain("passport:handoff:created");
  });

  it("escapes attribute values", () => {
    expect(embedSnippet('https://x.example"><script>', "pk")).not.toContain('"><script>');
  });

  it("keeps the secret key out of the browser example", () => {
    const s = serverCreateExample("https://passport.example");
    expect(s).toContain("https://passport.example/api/v1/handoffs");
    expect(s).toContain("$PASSPORT_SECRET_KEY");
    expect(s).toContain("Idempotency-Key");
  });

  it("lists exactly the business's handoff events", () => {
    const events = businessWebhookEvents();
    expect(events.map((e) => e.type)).toEqual(["handoff.started", "handoff.held", "handoff.eligible", "handoff.awarded", "handoff.declined", "handoff.expired", "handoff.completed"]);
    expect(events.find((e) => e.type === "handoff.eligible")!.when).toMatch(/Not an award/);
  });
});
