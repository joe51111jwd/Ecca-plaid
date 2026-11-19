import { describe, expect, it } from "vitest";
import {
  basePath,
  defaultScreen,
  flowStateOf,
  householdChangedSinceSnapshot,
  isFamilyToken,
  isScreen,
  isScreenAllowed,
  parseBasePath,
  previousScreen,
  resolveScreen,
  screenHref,
  SCREENS,
  stepperStepOf,
  type FlowState,
} from "./flow";

const TOKEN = "A".repeat(43);

function state(overrides: Partial<FlowState> = {}, household: Partial<FlowState["household"]> = {}): FlowState {
  return {
    currentStep: "evidence",
    status: "pending",
    stage: "household",
    canEdit: true,
    hasReusable: false,
    pathPreference: null,
    evidenceCount: 0,
    household: { hasAddress: true, hasCounty: true, hasOwner: true, studentCount: 1, ...household },
    ...overrides,
  };
}

describe("paths", () => {
  it("builds and parses the three flow addresses", () => {
    expect(basePath({ kind: "token", token: TOKEN, surface: "page" })).toBe(`/v/${TOKEN}`);
    expect(basePath({ kind: "token", token: TOKEN, surface: "embed" })).toBe(`/embed/verify/${TOKEN}`);
    expect(basePath({ kind: "id", verificationId: "ver_abc" })).toBe("/family/verifications/ver_abc");
    expect(parseBasePath(`/v/${TOKEN}`)).toEqual({ kind: "token", token: TOKEN, surface: "page" });
    expect(parseBasePath(`/embed/verify/${TOKEN}`)).toEqual({ kind: "token", token: TOKEN, surface: "embed" });
    expect(parseBasePath("/family/verifications/ver_abc")).toEqual({ kind: "id", verificationId: "ver_abc" });
  });

  it("refuses anything that could redirect elsewhere or to another kind of page", () => {
    for (const bad of [
      "",
      "/",
      `//evil.example/${TOKEN}`,
      `https://evil.example/v/${TOKEN}`,
      `/v/${TOKEN}/consent`,
      `/v/${TOKEN.slice(1)}`,
      `/v/${TOKEN}!`,
      "/family/verifications/abc",
      "/family/verifications/ver_",
      `/embed/give/${TOKEN}`,
      `v/${TOKEN}`,
      42,
      null,
    ]) {
      expect(parseBasePath(bad), String(bad)).toBeNull();
    }
  });

  it("checks token shape", () => {
    expect(isFamilyToken(TOKEN)).toBe(true);
    expect(isFamilyToken("a-b_c".padEnd(43, "x"))).toBe(true);
    expect(isFamilyToken(`${TOKEN}A`)).toBe(false);
    expect(isFamilyToken("../../etc/passwd".padEnd(43, "a"))).toBe(false);
  });

  it("builds screen hrefs with encoded, non-empty query values only", () => {
    expect(screenHref("/v/x", "people", { edit: "mem_1", add: "", lang: undefined })).toBe("/v/x/people?edit=mem_1");
    expect(screenHref("/v/x", "status", { notice: "a b&c" })).toBe("/v/x/status?notice=a+b%26c");
  });

  it("knows its screens and maps each to a stepper step", () => {
    expect(isScreen("upload")).toBe(true);
    expect(isScreen("admin")).toBe(false);
    expect(isScreen(undefined)).toBe(false);
    for (const s of SCREENS) expect(["consent", "household", "proof", "review", "result"]).toContain(stepperStepOf(s));
  });
});

describe("defaultScreen", () => {
  it("offers the earlier result before permission, else permission", () => {
    expect(defaultScreen(state({ currentStep: "consent", hasReusable: true }))).toBe("reuse");
    expect(defaultScreen(state({ currentStep: "consent" }))).toBe("consent");
  });

  it("walks the household in order: address, county, people, living arrangement", () => {
    const h = { currentStep: "household" as const };
    expect(defaultScreen(state(h, { hasAddress: false, hasCounty: false }))).toBe("address");
    expect(defaultScreen(state(h, { hasCounty: false }))).toBe("county");
    expect(defaultScreen(state(h, { hasOwner: false }))).toBe("people");
    expect(defaultScreen(state(h, { studentCount: 0 }))).toBe("people");
    expect(defaultScreen(state(h))).toBe("custody");
  });

  it("asks for the path, then sends to the chosen proof screen, then to review once something is provided", () => {
    expect(defaultScreen(state())).toBe("path");
    expect(defaultScreen(state({ pathPreference: "upload" }))).toBe("upload");
    expect(defaultScreen(state({ pathPreference: "auto_submit" }))).toBe("connect");
    expect(defaultScreen(state({ pathPreference: "auto_submit", evidenceCount: 1 }))).toBe("review");
  });

  it("shows the status page while waiting, after the outcome, when closed and when more is needed", () => {
    for (const currentStep of ["waiting", "outcome", "closed"] as const) expect(defaultScreen(state({ currentStep }))).toBe("status");
    expect(defaultScreen(state({ stage: "awaiting_family", pathPreference: "upload", evidenceCount: 2 }))).toBe("status");
  });
});

describe("isScreenAllowed / resolveScreen", () => {
  it("never lets the browser skip ahead of the server's state", () => {
    const atConsent = state({ currentStep: "consent" });
    for (const s of ["address", "people", "custody", "path", "upload", "connect", "review", "statement"] as const) expect(isScreenAllowed(s, atConsent), s).toBe(false);
    expect(resolveScreen("review", atConsent)).toEqual({ screen: "consent", redirect: true });
  });

  it("redirects unknown and missing screens to the default one", () => {
    expect(resolveScreen("../../admin", state())).toEqual({ screen: "path", redirect: true });
    expect(resolveScreen(null, state())).toEqual({ screen: "path", redirect: true });
    expect(resolveScreen("path", state())).toEqual({ screen: "path", redirect: false });
  });

  it("keeps county and people behind the steps they depend on", () => {
    const h = { currentStep: "household" as const };
    expect(isScreenAllowed("county", state(h, { hasAddress: false }))).toBe(false);
    expect(isScreenAllowed("people", state(h, { hasCounty: false }))).toBe(false);
    expect(isScreenAllowed("custody", state(h, { studentCount: 0 }))).toBe(false);
    expect(isScreenAllowed("custody", state(h))).toBe(true);
  });

  it("lets the family go back and edit the household while collecting proof, but not after sending", () => {
    expect(isScreenAllowed("people", state())).toBe(true);
    const sent = state({ currentStep: "waiting", canEdit: false, stage: "processing" });
    for (const s of ["address", "people", "upload", "review", "consent", "reuse"] as const) expect(isScreenAllowed(s, sent), s).toBe(false);
    expect(isScreenAllowed("status", sent)).toBe(true);
  });

  it("allows switching between upload and connect at any time while collecting (a preference, not a trap)", () => {
    const s = state({ pathPreference: "upload" });
    expect(isScreenAllowed("connect", s)).toBe(true);
    expect(isScreenAllowed("upload", state({ pathPreference: "auto_submit" }))).toBe(true);
  });

  it("only offers reuse when there is something reusable and the check is open", () => {
    expect(isScreenAllowed("reuse", state({ currentStep: "consent" }))).toBe(false);
    expect(isScreenAllowed("reuse", state({ currentStep: "consent", hasReusable: true }))).toBe(true);
    expect(isScreenAllowed("reuse", state({ currentStep: "consent", hasReusable: true, canEdit: false }))).toBe(false);
  });
});

describe("previousScreen", () => {
  it("points back only to screens that are allowed", () => {
    expect(previousScreen("upload", state({ pathPreference: "upload" }))).toBe("path");
    expect(previousScreen("review", state({ pathPreference: "auto_submit" }))).toBe("connect");
    expect(previousScreen("consent", state({ currentStep: "consent" }))).toBeNull();
    expect(previousScreen("status", state())).toBeNull();
    expect(previousScreen("county", state({ currentStep: "household" }))).toBe("address");
    expect(previousScreen("upload", state({ canEdit: false }))).toBeNull();
  });
});

describe("flowStateOf", () => {
  it("counts only documents still on file and connections that are working or done", () => {
    const s = flowStateOf(
      {
        currentStep: "evidence",
        status: "pending",
        stage: "collecting",
        canEdit: true,
        reusableResult: null,
        pathPreference: "upload",
        documents: [{ state: "reading" }, { state: "removed" }, { state: "deleted_after_decision" }, { state: "cannot_use" }],
        rails: [{ status: "ready" }, { status: "failed" }, { status: "declined" }, { status: "syncing" }],
      },
      { address: { line1: "x" }, county: null, members: [{ isOwner: true, kind: "adult" }, { isOwner: false, kind: "student" }, { isOwner: false, kind: "student" }] },
    );
    expect(s.evidenceCount).toBe(4);
    expect(s.hasReusable).toBe(false);
    expect(s.household).toEqual({ hasAddress: true, hasCounty: false, hasOwner: true, studentCount: 2 });
  });

  it("reads any non-null reusable result as reusable", () => {
    const view = { currentStep: "consent" as const, status: "pending" as const, stage: "started" as const, canEdit: true, pathPreference: null, documents: [], rails: [] };
    expect(flowStateOf({ ...view, reusableResult: { verificationId: "ver_x" } }, { address: null, county: null, members: [] }).hasReusable).toBe(true);
    expect(flowStateOf({ ...view, reusableResult: undefined }, { address: null, county: null, members: [] }).hasReusable).toBe(false);
  });
});

describe("householdChangedSinceSnapshot", () => {
  const snap = { size: 3, countyFips: "48491", studentMemberIds: ["mem_a"] };
  it("is false without a snapshot and when nothing changed (adding a second student is not a change of the checked one)", () => {
    expect(householdChangedSinceSnapshot(null, { size: 9, countyFips: null, studentIds: [] })).toBe(false);
    expect(householdChangedSinceSnapshot(snap, { size: 3, countyFips: "48491", studentIds: ["mem_a", "mem_b"] })).toBe(false);
  });
  it("catches a changed size, county or a removed student", () => {
    expect(householdChangedSinceSnapshot(snap, { size: 4, countyFips: "48491", studentIds: ["mem_a"] })).toBe(true);
    expect(householdChangedSinceSnapshot(snap, { size: 3, countyFips: "48453", studentIds: ["mem_a"] })).toBe(true);
    expect(householdChangedSinceSnapshot(snap, { size: 3, countyFips: null, studentIds: ["mem_a"] })).toBe(true);
    expect(householdChangedSinceSnapshot(snap, { size: 3, countyFips: "48491", studentIds: ["mem_b"] })).toBe(true);
  });
});
