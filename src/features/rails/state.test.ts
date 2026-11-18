import { describe, expect, it } from "vitest";
import type { LinkSessionPayload } from "@/server/rails/types";
import { initialRailConnectState, phaseForConnection, railConnectReducer, shouldOfferUpload, type RailConnectState } from "./state";
import type { RailConnectionView } from "./types";

// SYNTHETIC views only.

function view(over: Partial<RailConnectionView> = {}): RailConnectionView {
  return {
    id: "rail_1",
    verificationId: "ver_1",
    memberId: "hm_1",
    provider: "simulated",
    providerName: "Simulated payroll provider — sandbox",
    kind: "payroll",
    status: "connecting",
    sandbox: true,
    failureReason: null,
    failureMessage: null,
    reportSha256: null,
    retrieved: null,
    waiting: false,
    offerUpload: false,
    createdAt: "2026-11-18T15:00:00.000Z",
    updatedAt: "2026-11-18T15:00:00.000Z",
    ...over,
  };
}

const client: LinkSessionPayload = { provider: "simulated", sandbox: true, personas: [] };

describe("RailConnect state", () => {
  it("maps connection statuses to phases", () => {
    expect(phaseForConnection(view({ status: "connecting" }), true)).toBe("provider");
    expect(phaseForConnection(view({ status: "connecting" }), false)).toBe("done");
    expect(phaseForConnection(view({ status: "syncing" }), true)).toBe("waiting");
    expect(phaseForConnection(view({ status: "connected" }), false)).toBe("waiting");
    for (const status of ["ready", "failed", "declined", "revoked"] as const) expect(phaseForConnection(view({ status }), true)).toBe("done");
  });

  it("starts at the intro, and resumes a waiting or finished connection on reload", () => {
    expect(initialRailConnectState(null).phase).toBe("intro");
    expect(initialRailConnectState(view({ status: "connecting" }))).toMatchObject({ phase: "intro", connection: null });
    expect(initialRailConnectState(view({ status: "syncing" })).phase).toBe("waiting");
    expect(initialRailConnectState(view({ status: "ready" })).phase).toBe("done");
  });

  it("walks the happy path", () => {
    let s: RailConnectState = initialRailConnectState(null);
    s = railConnectReducer(s, { type: "start" });
    expect(s.phase).toBe("starting");
    s = railConnectReducer(s, { type: "started", connection: view(), client });
    expect(s.phase).toBe("provider");
    s = railConnectReducer(s, { type: "complete" });
    expect(s.phase).toBe("completing");
    s = railConnectReducer(s, { type: "updated", connection: view({ status: "syncing", waiting: true }) });
    expect(s.phase).toBe("waiting");
    s = railConnectReducer(s, { type: "updated", connection: view({ status: "ready" }) });
    expect(s).toMatchObject({ phase: "done", client: null });
    expect(shouldOfferUpload(s)).toBe(false);
  });

  it("a failed provider session goes straight to the outcome with upload offered", () => {
    const s = railConnectReducer(railConnectReducer(initialRailConnectState(null), { type: "start" }), { type: "started", connection: view({ status: "failed", offerUpload: true }), client: null });
    expect(s.phase).toBe("done");
    expect(shouldOfferUpload(s)).toBe(true);
  });

  it("an action error returns to the last actionable phase with a message", () => {
    const starting = railConnectReducer(initialRailConnectState(null), { type: "start" });
    expect(railConnectReducer(starting, { type: "error", message: "boom" })).toMatchObject({ phase: "intro", error: "boom" });
    const completing = railConnectReducer(railConnectReducer(starting, { type: "started", connection: view(), client }), { type: "complete" });
    expect(railConnectReducer(completing, { type: "error", message: "x" })).toMatchObject({ phase: "provider", error: "x" });
  });

  it("ignores events that do not fit the phase, and updates for another connection", () => {
    const intro = initialRailConnectState(null);
    expect(railConnectReducer(intro, { type: "complete" })).toBe(intro);
    const provider = railConnectReducer(railConnectReducer(intro, { type: "start" }), { type: "started", connection: view(), client });
    expect(railConnectReducer(provider, { type: "start" })).toBe(provider);
    expect(railConnectReducer(provider, { type: "updated", connection: view({ id: "rail_other", status: "ready" }) })).toBe(provider);
  });

  it("retry starts over from the intro (a new connection, a new consent)", () => {
    const done = railConnectReducer(initialRailConnectState(null), { type: "started", connection: view({ status: "declined", offerUpload: true }), client: null });
    expect(railConnectReducer(done, { type: "retry" })).toEqual({ phase: "intro", connection: null, client: null, error: null });
  });
});
