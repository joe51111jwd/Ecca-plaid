import { describe, expect, it } from "vitest";
import { DEMO_CAMP, DEMO_SESSIONS, DEMO_SGO, demoBookingDescription, findDemoSession, isDemoBookingRef, newDemoBookingRef } from "./demo";

describe("demo camp data", () => {
  it("is visibly fictional", () => {
    expect(DEMO_CAMP.name).toMatch(/\(demo\)$/);
    expect(DEMO_SGO.name).toMatch(/\(demo\)$/);
    for (const email of [DEMO_CAMP.ownerEmail, DEMO_CAMP.billingEmail, DEMO_SGO.ownerEmail]) expect(email).toMatch(/\.example$/);
    expect(demoBookingDescription(DEMO_SESSIONS[0])).toMatch(/\(demo\)$/);
  });

  it("has unique session ids and whole-cent prices", () => {
    expect(new Set(DEMO_SESSIONS.map((s) => s.id)).size).toBe(DEMO_SESSIONS.length);
    for (const s of DEMO_SESSIONS) expect(Number.isSafeInteger(s.priceCents) && s.priceCents > 0).toBe(true);
  });

  it("finds sessions by id only", () => {
    expect(findDemoSession("s2")?.name).toBe("Session 2: Creek Explorers");
    expect(findDemoSession(["s3"])?.id).toBe("s3");
    expect(findDemoSession("nope")).toBeNull();
    expect(findDemoSession(undefined)).toBeNull();
  });

  it("makes booking references that are unique and match their own pattern", () => {
    const refs = Array.from({ length: 200 }, newDemoBookingRef);
    for (const r of refs) expect(isDemoBookingRef(r)).toBe(true);
    expect(new Set(refs).size).toBeGreaterThan(195);
    expect(isDemoBookingRef("CCC-2027-abc123")).toBe(false);
    expect(isDemoBookingRef("../../etc")).toBe(false);
    expect(isDemoBookingRef(42)).toBe(false);
  });
});
