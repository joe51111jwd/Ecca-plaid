import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { parseCsv } from "@/lib/csv";
import { isAppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { listAuditLogs } from "@/server/audit";
import { getObjectBytes } from "@/server/storage";
import { useTestDb } from "../../../tests/helpers/db";
import {
  centsToDecimal,
  checkIrsReportConsistency,
  downloadIrsReport,
  generateIrsReport,
  generateSandboxDonorNumber,
  getIrsReportTable,
  issueAcknowledgment,
  listIrsReports,
  recordIrsReportSubmission,
  setDonorNumber,
} from "./index";
import { createStaff, createTestSgo, insertDonor, insertGift, SYS, type TestSgo } from "./test-support";

/* Synthetic organizations, donors, gifts and numbers ("SYN-" numbers stand in for portal-created ones). */

const NOW = new Date("2028-02-10T16:00:00.000Z");
const HEADER = "unique_donor_number,donor_name,address_line1,address_line2,city,state,zip,aggregate_qualified_contributions";

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

describe("IRS contribution report", () => {
  const t = useTestDb();
  let sgo: TestSgo;
  let admin: string;
  const reader = () => ({ actor: { type: "user" as const, id: admin } });

  beforeEach(async () => {
    setTestNow(NOW);
    sgo = await createTestSgo({ portalRegistered: true });
    admin = await createStaff(sgo.orgId, "admin");
  });
  afterEach(() => setTestNow(null));

  /** A live donor with gifts, a portal number and an issued acknowledgment. */
  async function acknowledgedDonor(first: string, number: string, gifts: number[], address: { zip?: string } = {}): Promise<string> {
    const donorId = await insertDonor({ firstName: first, lastName: "Synthetic", ...address });
    for (const cents of gifts) await insertGift({ orgId: sgo.orgId, donorId, mode: "live", designatedCents: cents });
    await setDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "live", number }, SYS);
    await issueAcknowledgment(sgo.orgId, { donorId, taxYear: 2027, mode: "live" }, SYS);
    return donorId;
  }

  it("has one record per unique donor number with exactly name, address and aggregate qualified contributions, consistent with the acknowledgments", async () => {
    const b = await acknowledgedDonor("Blake", "SYN-0002", [100_000, 70_000]);
    const a = await acknowledgedDonor("Avery", "SYN-0001", [50_000]);
    await insertGift({ orgId: sgo.orgId, donorId: a, mode: "test", designatedCents: 12_345 }); // never in a live report
    const r = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, { userId: admin });

    expect(r.issues).toEqual([]);
    expect(r.consistency).toEqual({ matches: true, reportTotalCents: 220_000, acknowledgedTotalCents: 220_000, mismatches: [], basis: "designated_less_goods_value" });
    const lines = r.csv.trim().split("\r\n");
    expect(lines).toEqual([HEADER, "SYN-0001,Avery Synthetic,100 Synthetic Way,,Austin,TX,78701,500.00", "SYN-0002,Blake Synthetic,100 Synthetic Way,,Austin,TX,78701,1700.00"]);
    expect(r.csv).not.toMatch(/\b(ssn|tin|itin|email)\b|@/i);
    expect(r.table.rows.map((row) => [row.donorId, row.aggregateQualifiedContributionsCents])).toEqual([
      [a, 50_000],
      [b, 170_000],
    ]);
    expect(r.report).toMatchObject({ orgId: sgo.orgId, mode: "live", taxYear: 2027, version: 1, rowCount: 2, totalDesignatedCents: 220_000, acknowledgedTotalCents: 220_000, generatedBy: admin, submittedOn: null });
    expect(r.report.filename).toBe(`contribution-report-${sgo.ein!.replace("-", "")}-2027-v1.csv`);
    expect(r.dueDate).toBe("2028-02-28");

    const [object] = await t.db.select().from(schema.objects).where(eq(schema.objects.id, r.report.objectId!));
    expect(object).toMatchObject({ purpose: "irs_report", orgId: sgo.orgId });
    const stored = await getObjectBytes(r.report.objectId!, { orgId: sgo.orgId });
    expect(stored.toString("utf8")).toBe(r.csv);
    expect(sha256Hex(stored)).toBe(r.report.sha256);
    expect((await listAuditLogs({ action: "irs_report.generate" })).items[0]).toMatchObject({ actorId: admin, metadata: expect.objectContaining({ consistent: true, rowCount: 2 }) });
  });

  it("lists every problem: missing numbers, address problems, no acknowledgment, totals changed or refunded after one, goods", async () => {
    const changed = await acknowledgedDonor("Casey", "SYN-0003", [100_000]);
    await insertGift({ orgId: sgo.orgId, donorId: changed, mode: "live", designatedCents: 20_000 });
    const refunded = await acknowledgedDonor("Drew", "SYN-0004", [40_000]);
    await t.db.update(schema.donations).set({ status: "refunded", refundedAt: NOW }).where(eq(schema.donations.donorId, refunded));
    const badZip = await acknowledgedDonor("Emery", "SYN-0005", [10_000], { zip: "7870" });
    const noNumber = await insertDonor({ firstName: "Finley" });
    await insertGift({ orgId: sgo.orgId, donorId: noNumber, mode: "live", designatedCents: 30_000 });
    const notIssued = await insertDonor({ firstName: "Gray" });
    await insertGift({ orgId: sgo.orgId, donorId: notIssued, mode: "live", designatedCents: 25_000, goods: { valueCents: 5_000, description: "Synthetic tickets" } });
    await setDonorNumber(sgo.orgId, { donorId: notIssued, taxYear: 2027, mode: "live", number: "SYN-0007" }, SYS);
    const sandboxed = await insertDonor({ firstName: "Harper" });
    await insertGift({ orgId: sgo.orgId, donorId: sandboxed, mode: "live", designatedCents: 1_000 });
    await t.db.insert(schema.donorNumbers).values({ id: newId("donorNumber"), orgId: sgo.orgId, donorId: sandboxed, taxYear: 2027, mode: "live", number: "TEST-2027-SYN", source: "sandbox_generated" });

    const r = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    const byDonor = (code: string) => r.issues.filter((i) => i.code === code).map((i) => i.donorId);
    expect(byDonor("total_changed_after_acknowledgment")).toEqual([changed]);
    expect(byDonor("refunded_after_acknowledgment")).toEqual([refunded]);
    expect(byDonor("address_incomplete")).toEqual([badZip]);
    expect(byDonor("donor_number_missing")).toEqual([noNumber]);
    expect(byDonor("acknowledgment_not_issued")).toEqual([notIssued]);
    expect(byDonor("goods_or_services_review")).toEqual([notIssued]);
    expect(byDonor("sandbox_donor_number_in_live")).toEqual([sandboxed]);
    expect(r.issues.findIndex((i) => i.severity === "warning")).toBeGreaterThan(r.issues.findLastIndex((i) => i.severity === "error"));

    // Rows: one per valid number; amounts net of goods; donors without a usable number are out.
    expect(r.table.rows.map((row) => [row.uniqueDonorNumber, row.aggregateQualifiedContributionsCents])).toEqual([
      ["SYN-0003", 120_000],
      ["SYN-0005", 10_000],
      ["SYN-0007", 20_000],
    ]);
    expect(r.consistency.matches).toBe(false);
    expect(r.consistency.mismatches).toEqual(
      expect.arrayContaining([
        { donorId: changed, reportCents: 120_000, acknowledgedCents: 100_000 },
        { donorId: refunded, reportCents: 0, acknowledgedCents: 40_000 },
        { donorId: notIssued, reportCents: 20_000, acknowledgedCents: 0 },
      ]),
    );
    expect(r.consistency.mismatches).toHaveLength(3);
    expect(r.consistency).toMatchObject({ reportTotalCents: 150_000, acknowledgedTotalCents: 150_000 });

    // Re-issuing fixes the changed donor; the consistency check (without storing) shows it.
    await issueAcknowledgment(sgo.orgId, { donorId: changed, taxYear: 2027, mode: "live" }, SYS);
    const check = await checkIrsReportConsistency(sgo.orgId, { taxYear: 2027, mode: "live" }, reader());
    expect(check.consistency.mismatches.map((m) => m.donorId).sort()).toEqual([notIssued, refunded].sort());
    expect((await listAuditLogs({ action: "irs_report.check" })).items).toHaveLength(1);
  });

  it("flags a missing EIN and a missing portal registration", async () => {
    const bare = await createTestSgo({ ein: null, portalRegistered: false });
    const donorId = await insertDonor();
    await insertGift({ orgId: bare.orgId, donorId, mode: "live" });
    const r = await generateIrsReport(bare.orgId, { taxYear: 2027, mode: "live" }, SYS);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["sgo_ein_missing", "sgo_not_portal_registered", "donor_number_missing", "no_contributions"]));
    expect(r.report.filename).toBe("contribution-report-noein-2027-v1.csv");
    expect(r.csv).toBe(`${HEADER}\r\n`);
  });

  it("keeps test and live apart: a test report has only sandbox data, says so, and can never be recorded as filed", async () => {
    const donorId = await insertDonor();
    await insertGift({ orgId: sgo.orgId, donorId, mode: "test", designatedCents: 33_300 });
    await insertGift({ orgId: sgo.orgId, donorId, mode: "live", designatedCents: 44_400 });
    const number = await generateSandboxDonorNumber(sgo.orgId, { donorId, taxYear: 2027, mode: "test" }, SYS);
    await issueAcknowledgment(sgo.orgId, { donorId, taxYear: 2027, mode: "test" }, SYS);
    const r = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "test" }, SYS);
    expect(r.issues.map((i) => i.code)).toEqual(["test_mode"]);
    expect(r.csv).toContain(`${number.number},Avery Synthetic`);
    expect(r.csv).toContain("333.00");
    expect(r.csv).not.toContain("444.00");
    expect(r.report.filename).toMatch(/^sandbox-contribution-report-/);
    expect(await errorOf(recordIrsReportSubmission(sgo.orgId, r.report.id, { submittedOn: "2028-02-11" }, SYS))).toMatchObject({ code: "conflict", details: { reason: "test_mode" } });
    expect(await listIrsReports(sgo.orgId, { mode: "live" }, reader())).toEqual([]);
  });

  it("versions every generation, keeps the history, downloads audited, and records the portal submission once", async () => {
    await acknowledgedDonor("Avery", "SYN-0001", [170_000]);
    const v1 = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    const v2 = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    expect(v2.report.version).toBe(2);
    expect(v2.report.sha256).toBe(v1.report.sha256);
    expect((await listIrsReports(sgo.orgId, { mode: "live", taxYear: 2027 }, reader())).map((r) => r.version)).toEqual([2, 1]);

    const file = await downloadIrsReport(sgo.orgId, v1.report.id, reader());
    expect(file).toMatchObject({ contentType: "text/csv; charset=utf-8", sha256: v1.report.sha256, filename: v1.report.filename });
    expect(file.bytes.toString("utf8")).toBe(v1.csv);
    const table = await getIrsReportTable(sgo.orgId, v1.report.id, reader());
    expect(table.columns.join(",")).toBe(HEADER);
    expect(table.rows).toEqual(parseCsv(v1.csv).slice(1));
    expect((await listAuditLogs({ action: "irs_report.download" })).items).toHaveLength(2);

    expect((await errorOf(recordIrsReportSubmission(sgo.orgId, v2.report.id, { submittedOn: "2028-2-11" }, SYS))).code).toBe("validation_failed");
    expect((await errorOf(recordIrsReportSubmission(sgo.orgId, v2.report.id, { submittedOn: "2027-12-31" }, SYS))).code).toBe("validation_failed");
    const viewer = await createStaff(sgo.orgId, "viewer");
    expect((await errorOf(recordIrsReportSubmission(sgo.orgId, v2.report.id, { submittedOn: "2028-02-11" }, { userId: viewer }))).code).toBe("forbidden");
    const submitted = await recordIrsReportSubmission(sgo.orgId, v2.report.id, { submittedOn: "2028-02-11", reference: "SYN-CONFIRMATION-1" }, { userId: admin });
    expect(submitted).toMatchObject({ submittedOn: "2028-02-11", submissionReference: "SYN-CONFIRMATION-1", submittedBy: admin });
    expect((await errorOf(recordIrsReportSubmission(sgo.orgId, v2.report.id, { submittedOn: "2028-02-12" }, SYS))).code).toBe("conflict");
    expect((await listAuditLogs({ action: "irs_report.submitted" })).items).toHaveLength(1);
  });

  it("refuses to serve a stored file that does not match the report version's recorded SHA-256", async () => {
    await acknowledgedDonor("Avery", "SYN-0001", [170_000]);
    const v1 = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    await acknowledgedDonor("Blake", "SYN-0002", [50_000]);
    const v2 = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    expect(v2.report.sha256).not.toBe(v1.report.sha256);
    await t.db.update(schema.irsReports).set({ objectId: v2.report.objectId }).where(eq(schema.irsReports.id, v1.report.id));
    expect((await errorOf(downloadIrsReport(sgo.orgId, v1.report.id, reader()))).code).toBe("internal");
    expect((await errorOf(getIrsReportTable(sgo.orgId, v1.report.id, reader()))).code).toBe("internal");
    expect((await listAuditLogs({ action: "irs_report.download" })).items).toHaveLength(0);
  });

  it("isolates tenants and requires an admin to generate", async () => {
    await acknowledgedDonor("Avery", "SYN-0001", [170_000]);
    const mine = await generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, SYS);
    const other = await createTestSgo({ portalRegistered: true });
    const theirs = await generateIrsReport(other.orgId, { taxYear: 2027, mode: "live" }, SYS);
    expect(theirs.table.rows).toEqual([]);
    expect((await errorOf(downloadIrsReport(other.orgId, mine.report.id, reader()))).code).toBe("not_found");
    expect((await errorOf(recordIrsReportSubmission(other.orgId, mine.report.id, { submittedOn: "2028-02-11" }, SYS))).code).toBe("not_found");
    const reviewer = await createStaff(sgo.orgId, "reviewer");
    expect((await errorOf(generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "live" }, { userId: reviewer }))).code).toBe("forbidden");
    expect((await errorOf(generateIrsReport(sgo.orgId, { taxYear: 2027, mode: "both" as "live" }, SYS))).code).toBe("validation_failed");
    expect((await errorOf(listIrsReports(sgo.orgId, { mode: "live" }, undefined as never))).code).toBe("forbidden");
  });

  it("formats cents as plain decimals", () => {
    expect([0, 5, 99, 100, 170_000, 123_456_789, -250].map(centsToDecimal)).toEqual(["0.00", "0.05", "0.99", "1.00", "1700.00", "1234567.89", "-2.50"]);
  });
});
