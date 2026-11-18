import { eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listEvents } from "@/server/events";
import { enqueue, listJobs } from "@/server/jobs";
import { useTestDb } from "../../../tests/helpers/db";
import { recurringJobs } from "../donations/jobs";
import { placeOrder, saveCheckout, startCheckout } from "../donations/checkout";
import { createListedSgo, drainJobs, paySandbox, singleFilerPatch } from "../donations/test-support";
import {
  ACKNOWLEDGMENT_ANNUAL_JOB,
  acknowledgmentWorklist,
  daysBetween,
  generateIrsReport,
  generateSandboxDonorNumber,
  generateSandboxDonorNumbers,
  issueAcknowledgment,
  listAcknowledgmentNotices,
  markAcknowledgmentStale,
  noticeLevelFor,
  recordIrsReportSubmission,
  runAcknowledgmentAnnual,
  setDonorNumber,
} from "./index";
import { createStaff, createTestSgo, insertConsent, insertDonor, insertGift, SYS, type TestSgo } from "./test-support";

// Small batches so the continuation path runs in every test.
vi.mock("./policy", async (importOriginal) => ({ ...(await importOriginal<typeof import("./policy")>()), ANNUAL_JOB_BATCH: 2 }));

/* Synthetic organizations, donors, gifts and numbers. All dates are set with setTestNow. */

const at = (iso: string) => setTestNow(new Date(iso));
const LEVELS = [
  { level: "reminder", daysLeft: 14 },
  { level: "urgent", daysLeft: 7 },
  { level: "final", daysLeft: 2 },
] as const;

describe("deadline arithmetic", () => {
  it("counts whole calendar days, negative after the date", () => {
    expect(daysBetween("2028-01-01", "2028-01-31")).toBe(30);
    expect(daysBetween("2028-01-31", "2028-01-31")).toBe(0);
    expect(daysBetween("2028-02-01", "2028-01-31")).toBe(-1);
    expect(daysBetween("2028-02-27", "2028-03-01")).toBe(3); // 2028 is a leap year
  });

  it("picks the most escalated level that applies, once, and only while work is outstanding", () => {
    const base = { windowStart: "2028-01-01", dueDate: "2028-01-31", outstanding: true, sent: new Set<never>(), levels: LEVELS };
    expect(noticeLevelFor({ ...base, today: "2027-12-31" })).toBeNull();
    expect(noticeLevelFor({ ...base, today: "2028-01-01" })).toBe("opening");
    expect(noticeLevelFor({ ...base, today: "2028-01-17" })).toBe("reminder");
    expect(noticeLevelFor({ ...base, today: "2028-01-24" })).toBe("urgent");
    expect(noticeLevelFor({ ...base, today: "2028-01-29" })).toBe("final");
    expect(noticeLevelFor({ ...base, today: "2028-01-31" })).toBe("final");
    expect(noticeLevelFor({ ...base, today: "2028-02-01" })).toBe("overdue");
    expect(noticeLevelFor({ ...base, today: "2028-01-25", sent: new Set(["final"] as const) })).toBeNull();
    expect(noticeLevelFor({ ...base, today: "2028-01-25", sent: new Set(["opening", "reminder"] as const) })).toBe("urgent");
    expect(noticeLevelFor({ ...base, today: "2028-01-25", outstanding: false })).toBeNull();
    expect(noticeLevelFor({ ...base, today: "2028-01-02", outstanding: false })).toBe("opening");
    expect(noticeLevelFor({ ...base, today: "2028-02-02", outstanding: false })).toBeNull();
  });
});

describe("acknowledgment.annual", () => {
  const t = useTestDb();
  let sgo: TestSgo;
  let admin: string;

  beforeEach(async () => {
    at("2027-03-10T16:00:00Z");
    sgo = await createTestSgo({ portalRegistered: true });
    admin = await createStaff(sgo.orgId, "admin");
    await createStaff(sgo.orgId, "reviewer");
  });
  afterEach(() => setTestNow(null));

  const notices = () => t.db.select().from(schema.acknowledgmentNotices);
  const noticeEmails = () => t.db.select().from(schema.emails).where(like(schema.emails.template, "acknowledgment_notice_%"));

  it("is registered as a daily recurring job of Piece 1", () => {
    expect(recurringJobs).toContainEqual({ type: ACKNOWLEDGMENT_ANNUAL_JOB, everyMs: 86_400_000 });
  });

  it("does nothing for the current year before it ends", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId });
    await markAcknowledgmentStale({ orgId: sgo.orgId, donorId, taxYear: 2027, mode: "test", reason: "gift_succeeded" });
    at("2027-11-18T16:00:00Z");
    const run = await runAcknowledgmentAnnual("test");
    expect(run).toMatchObject({ priorYear: 2026, processed: 0, notices: [] });
    expect(await t.db.select().from(schema.acknowledgments)).toHaveLength(0);
  });

  it("from January 1 builds every prior-year acknowledgment, sends the worklist, and is idempotent the same day", async () => {
    const ready = await insertDonor({ firstName: "Avery", email: "avery@synthetic.example" });
    await insertGift({ orgId: sgo.orgId, donorId: ready });
    await insertConsent(sgo.orgId, ready, "avery@synthetic.example");
    await generateSandboxDonorNumber(sgo.orgId, { donorId: ready, taxYear: 2027, mode: "test" }, SYS);
    const paper = await insertDonor({ firstName: "Blake" });
    await insertGift({ orgId: sgo.orgId, donorId: paper });
    await generateSandboxDonorNumber(sgo.orgId, { donorId: paper, taxYear: 2027, mode: "test" }, SYS);
    const noNumber = await insertDonor({ firstName: "Casey" });
    await insertGift({ orgId: sgo.orgId, donorId: noNumber });
    const refundedOnly = await insertDonor({ firstName: "Drew" });
    await insertGift({ orgId: sgo.orgId, donorId: refundedOnly, status: "refunded" });

    at("2028-01-02T18:00:00Z");
    await enqueue(ACKNOWLEDGMENT_ANNUAL_JOB, {});
    await drainJobs();

    const rows = await t.db.select().from(schema.acknowledgments);
    const byDonor = Object.fromEntries(rows.map((r) => [r.donorId, r]));
    expect(byDonor[ready]).toMatchObject({ status: "issued", delivery: "email", issuedBy: "system:acknowledgment.annual" });
    expect(byDonor[paper]).toMatchObject({ status: "issued", delivery: "paper_required" });
    expect(byDonor[noNumber]).toMatchObject({ status: "blocked", blockers: [{ code: "donor_number_missing" }] });
    expect(byDonor[refundedOnly]).toBeUndefined();
    // The batch of 2 needed a continuation job.
    expect((await listJobs({ type: ACKNOWLEDGMENT_ANNUAL_JOB })).length).toBeGreaterThan(1);
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).filter((e) => e.type === "acknowledgment.issued")).toHaveLength(2);

    expect(await notices()).toMatchObject([{ orgId: sgo.orgId, mode: "test", taxYear: 2027, kind: "acknowledgments", level: "opening", summary: { donors: 3, upToDate: 2, missingDonorNumber: 1, paperToMail: 1 } }]);
    const emails = await noticeEmails();
    expect(emails.map((e) => e.toEmail).sort()).toEqual([sgo.ownerEmail, (await t.db.select().from(schema.users).where(eq(schema.users.id, admin)))[0].email].sort());
    expect(emails[0].subject).toBe("[Sandbox] 2027 donor acknowledgments: your worklist");
    expect(emails[0].text).toContain("due to your donors by January 31, 2028");
    expect(emails[0].text).toContain("Donors without a unique donor number");
    expect(emails[0].text).toContain("test mode");
    expect(emails[0].text).not.toContain("Blake");

    // Same day again: nothing new is issued, emailed or noticed.
    await enqueue(ACKNOWLEDGMENT_ANNUAL_JOB, {}, { dedupeKey: "second-run" });
    await drainJobs();
    expect(await t.db.select().from(schema.acknowledgments)).toHaveLength(3);
    expect(await noticeEmails()).toHaveLength(2);
    expect((await listEvents({ orgId: sgo.orgId, mode: "test" })).filter((e) => e.type === "acknowledgment.issued")).toHaveLength(2);

    const worklist = await acknowledgmentWorklist(sgo.orgId, { mode: "test", taxYear: 2027 }, { actor: { type: "user", id: admin } });
    expect(worklist.items.map((i) => [i.donor.id, i.action])).toEqual([
      [noNumber, "generate_sandbox_number"],
      [paper, "mail_paper"],
      [ready, "none"],
    ]);
    expect(worklist).toMatchObject({ acknowledgmentDueDate: "2028-01-31", reportDueDate: "2028-02-28", total: 3 });
    expect((await acknowledgmentWorklist(sgo.orgId, { mode: "test", taxYear: 2027, action: "mail_paper" }, { actor: { type: "user", id: admin } })).items).toHaveLength(1);
  });

  it("escalates as January 31 approaches while work is outstanding, then opens the February 28 report window", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId });
    const levels = async () => (await notices()).map((n) => `${n.kind}:${n.level}`).sort();

    at("2028-01-03T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    at("2028-01-10T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect(await levels()).toEqual(["acknowledgments:opening"]);
    at("2028-01-18T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    at("2028-01-25T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    at("2028-01-30T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect(await levels()).toEqual(["acknowledgments:final", "acknowledgments:opening", "acknowledgments:reminder", "acknowledgments:urgent"]);
    const urgent = (await noticeEmails()).find((e) => e.subject.includes("Urgent"));
    expect(urgent?.text).toContain("Only 6 days remain");

    at("2028-02-01T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect(await levels()).toEqual(expect.arrayContaining(["acknowledgments:overdue", "irs_report:opening"]));
    // Test mode: generating the report clears the reminder (test reports are never filed).
    await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "test" }, SYS);
    at("2028-02-20T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect((await levels()).filter((l) => l.startsWith("irs_report"))).toEqual(["irs_report:opening"]);
    expect((await listAcknowledgmentNotices(sgo.orgId, { mode: "test", taxYear: 2027 }, { actor: { type: "user", id: admin } })).length).toBe(6);
  });

  it("sends only the level that applies when the first run is late, and nothing once all is done", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId });
    at("2028-01-30T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect((await notices()).map((n) => n.level)).toEqual(["final"]);

    await generateSandboxDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "test" }, SYS);
    await insertConsent(sgo.orgId, donorId, "donor@synthetic.example");
    at("2028-01-31T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect((await t.db.select().from(schema.acknowledgments))[0]).toMatchObject({ status: "issued", delivery: "email" });
    at("2028-02-02T18:00:00Z");
    await runAcknowledgmentAnnual("test");
    expect((await notices()).map((n) => `${n.kind}:${n.level}`).sort()).toEqual(["acknowledgments:final", "irs_report:opening"]);
  });

  it("live: reminds about the IRS report until a version is recorded as submitted", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId, mode: "live" });
    await setDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "live", number: "SYN-0001" }, SYS);
    at("2028-01-05T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    expect((await t.db.select().from(schema.acknowledgments))[0]).toMatchObject({ mode: "live", status: "issued", delivery: "paper_required" });
    at("2028-02-16T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    const report = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    at("2028-02-22T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    await recordIrsReportSubmission(sgo.orgId, report.report.id, { submittedOn: "2028-02-22" }, SYS);
    at("2028-02-27T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    at("2028-03-01T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    const levels = (await notices()).filter((n) => n.kind === "irs_report").map((n) => n.level);
    expect(levels.sort()).toEqual(["reminder", "urgent"]);
    const subjects = (await noticeEmails()).map((e) => e.subject);
    expect(subjects.every((s) => !s.startsWith("[Sandbox]"))).toBe(true);
    // The live paper acknowledgment kept the acknowledgment worklist outstanding: an overdue notice went out.
    expect((await notices()).filter((n) => n.kind === "acknowledgments").map((n) => n.level).sort()).toEqual(["opening", "overdue"]);
  });

  it("supersedes an issued acknowledgment when its donor number is corrected, and keeps current-year versions current", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId, mode: "live" });
    await setDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "live", number: "SYN-0001" }, SYS);
    at("2028-01-05T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    await setDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "live", number: "SYN-0009", replace: true }, SYS);
    at("2028-01-06T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    const versions = (await t.db.select().from(schema.acknowledgments)).sort((a, b) => a.version - b.version);
    expect(versions.map((v) => [v.version, v.status, v.uniqueDonorNumber])).toEqual([
      [1, "superseded", "SYN-0001"],
      [2, "issued", "SYN-0009"],
    ]);

    // A 2028 acknowledgment issued during 2028 is kept current by the job when a later 2028 gift arrives.
    await insertGift({ orgId: sgo.orgId, donorId, mode: "live", taxYear: 2028, designatedCents: 10_000, contributedAt: new Date("2028-01-06T16:00:00Z") });
    await setDonorNumber(sgo.orgId, { donorId, taxYear: 2028, mode: "live", number: "SYN-2028-1" }, SYS);
    await issueAcknowledgment(sgo.orgId, { donorId, taxYear: 2028, mode: "live" }, SYS);
    await insertGift({ orgId: sgo.orgId, donorId, mode: "live", taxYear: 2028, designatedCents: 5_000, contributedAt: new Date("2028-01-07T16:00:00Z") });
    await markAcknowledgmentStale({ orgId: sgo.orgId, donorId, taxYear: 2028, mode: "live", reason: "gift_succeeded" });
    at("2028-01-08T18:00:00Z");
    await runAcknowledgmentAnnual("live");
    const current = (await t.db.select().from(schema.acknowledgments).where(eq(schema.acknowledgments.taxYear, 2028))).find((a) => a.status === "issued");
    expect(current).toMatchObject({ version: 2, totalDesignatedCents: 15_000 });
  });

  it("finishes the year for a gift made through the real checkout (test mode, end to end)", async () => {
    const listed = await createListedSgo({ portalRegistered: true });
    at("2027-06-15T16:00:00Z");
    const { token } = await startCheckout({ sgoSlug: listed.slug, source: "hosted" });
    await saveCheckout(token, singleFilerPatch({ contributors: { primary: { firstName: "Avery", lastName: "Synthetic", eDeliveryConsent: true } } }));
    await saveCheckout(token, { designationConfirmed: true });
    const placed = await placeOrder(token);
    await paySandbox(placed.payment);
    await drainJobs();

    at("2028-01-04T18:00:00Z");
    await generateSandboxDonorNumbers(listed.orgId, { taxYear: 2027, mode: "test" }, SYS);
    await enqueue(ACKNOWLEDGMENT_ANNUAL_JOB, {});
    await drainJobs();
    const [ack] = await t.db.select().from(schema.acknowledgments).where(eq(schema.acknowledgments.orgId, listed.orgId));
    expect(ack).toMatchObject({ status: "issued", totalDesignatedCents: 170_000, delivery: "email", deliveryEmail: "donor@synthetic.example" });
    expect(ack.uniqueDonorNumber).toMatch(/^TEST-2027-/);
    const [email] = await t.db.select().from(schema.emails).where(eq(schema.emails.template, "acknowledgment"));
    expect(email).toMatchObject({ toEmail: "donor@synthetic.example", status: "sent" });
    expect(await t.db.select().from(schema.acknowledgmentRefreshes).where(eq(schema.acknowledgmentRefreshes.orgId, listed.orgId))).toMatchObject([{ resolvedAt: expect.any(Date) }]);
  });
});
