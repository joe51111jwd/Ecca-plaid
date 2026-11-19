import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { createHandoff } from "@/server/handoffs/create";
import { apiSource, makeBusiness, makeSgo, partner } from "@/server/handoffs/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import { createVerification } from "./create";
import { applicantLabels } from "./labels";
import { getVerification } from "./org";
import { baseCreate, makeTestFamily, makeTestSgo, startedVerification, TEST_NOW } from "./test-support";

// Every organization, person and booking below is synthetic.
describe("applicantLabels", () => {
  useTestDb();
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("prefers the SGO's name, then the name the family entered, then the email", async () => {
    const sgo = await makeTestSgo();
    const named = await createVerification(baseCreate(sgo.orgId, { applicantName: "Given Name", externalRef: "SYN-1" }));
    const notStarted = await createVerification(baseCreate(sgo.orgId, { applicantEmail: "waiting@example.com", externalRef: "SYN-2" }));
    const anonymous = await createVerification(baseCreate(sgo.orgId, { applicantEmail: undefined, externalRef: "SYN-3" }));
    const started = await startedVerification(sgo, await makeTestFamily(), { externalRef: "SYN-4" });
    const rows = await Promise.all([named, notStarted, anonymous, started].map((c) => getVerification(sgo.orgId, c.verification.id, { mode: "test" })));
    const labels = await applicantLabels(sgo.orgId, rows);
    expect(rows.map((r) => labels[r.id])).toEqual(["Given Name", "waiting@example.com", "No name given", "Dana Sample"]);
  });

  it("names a camp handoff by the camp and its booking reference until the family enters a name", async () => {
    const biz = await makeBusiness({ holdWindowHours: 72, fee: { flatCents: 2500, bps: 250 } });
    const sgoOrgId = await makeSgo("Synthetic Fund");
    await partner(biz.orgId, sgoOrgId);
    const res = await createHandoff({ bookingRef: "SYN-CAMP-9", bookingDescription: "Week 1 (synthetic)", bookingAmountCents: 50_000, channel: "redirect", familyEmail: "family@example.com", studentFirstName: "Riley" }, await apiSource(biz.orgId));
    const db = await getDb();
    const [camp] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, biz.orgId));
    const row = await getVerification(sgoOrgId, res.handoff.verificationId!, { mode: res.handoff.mode });
    expect(await applicantLabels(sgoOrgId, [row])).toEqual({ [row.id]: `${camp.name} · SYN-CAMP-9` });
  });
});
