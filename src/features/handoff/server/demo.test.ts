import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { getBusinessProfile, listPartnershipsForBusiness } from "@/server/businesses";
import { createHandoff, getHandoffView } from "@/server/handoffs";
import { setVerificationState } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../../tests/helpers/db";
import { DEMO_CAMP, DEMO_SGO } from "../demo";
import { demoOrigin, ensureDemoCamp, getDemoBooking, getDemoCamp } from "./demo";

const NOW = "2026-11-18T16:00:00.000Z";

describe("demo camp seed", () => {
  const t = useTestDb();
  beforeEach(() => setTestNow(NOW));
  afterEach(() => setTestNow(null));

  it("is absent until set up", async () => {
    expect(await getDemoCamp()).toBeNull();
  });

  it("creates the camp, the partner SGO and an active partnership, idempotently", async () => {
    const first = await ensureDemoCamp();
    const second = await ensureDemoCamp();
    expect(second).toEqual(first);
    expect(first).toMatchObject({ ownerEmail: DEMO_CAMP.ownerEmail, mode: "test", origin: demoOrigin() });
    expect(first.publishableKey).toMatch(/^pk_test_/);

    const { org, profile } = await getBusinessProfile(first.businessOrgId);
    expect(org.name).toBe(DEMO_CAMP.name);
    expect(profile.allowedOrigins).toEqual([demoOrigin()]);
    expect(profile.holdWindowHours).toBe(DEMO_CAMP.holdWindowHours);

    const partnerships = await listPartnershipsForBusiness(first.businessOrgId);
    expect(partnerships).toHaveLength(1);
    expect(partnerships[0]).toMatchObject({ partnership: { status: "active" }, sgo: { displayName: DEMO_SGO.name, acceptsHandoffs: true } });
    const orgs = await t.db.select().from(schema.organizations);
    expect(orgs.filter((o) => o.type === "business")).toHaveLength(1);
    expect(orgs.filter((o) => o.type === "sgo")).toHaveLength(1);
  });

  it("repairs an ended partnership", async () => {
    const camp = await ensureDemoCamp();
    const [p] = await listPartnershipsForBusiness(camp.businessOrgId);
    const { endPartnership, businessSystemActor } = await import("@/server/businesses");
    await endPartnership(camp.businessOrgId, p.partnership.id, businessSystemActor("test"));
    expect((await getDemoCamp())?.sgoOrgId).toBeNull();
    expect((await ensureDemoCamp()).sgoOrgId).toBe(camp.sgoOrgId);
  });

  it("reads a booking as the camp's server sees it: the API shape and the handoff events, oldest first", async () => {
    const camp = await ensureDemoCamp();
    const created = await createHandoff(
      { bookingRef: "CCC-2027-ABC123", bookingDescription: "Session 2 (demo)", bookingAmountCents: 45_000, channel: "redirect", returnUrl: `${camp.origin}/demo/camp/booking/CCC-2027-ABC123` },
      { kind: "embed", publishableKey: camp.publishableKey, origin: camp.origin, ip: "203.0.113.30" },
    );
    await setVerificationState(created.handoff.verificationId!, { status: "eligible", expiresAt: new Date("2026-12-31T23:59:59Z") });
    await getHandoffView(created.token);

    const state = await getDemoBooking(camp, "CCC-2027-ABC123");
    expect(state?.handoff).toMatchObject({ id: created.handoff.id, status: "eligible", booking: { ref: "CCC-2027-ABC123", amount_usd: "450.00", amount_confirmed: false } });
    expect(state?.events.map((e) => e.type)).toEqual(["handoff.started", "handoff.eligible"]);
    expect(JSON.stringify(state)).not.toContain(created.token);

    expect(await getDemoBooking(camp, "CCC-2027-ZZZZZZ")).toBeNull();
    await expect(getDemoBooking(camp, "../../x")).rejects.toSatisfy((e) => isAppError(e) && e.code === "not_found");
  });
});
