import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { isAppError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit";
import { useTestDb } from "../../../tests/helpers/db";
import { generateSandboxDonorNumber, generateSandboxDonorNumbers, importDonorNumbers, listPendingAcknowledgmentRefreshes, setDonorNumber } from "./index";
import { createStaff, createTestSgo, insertDonor, insertGift, SYS, type TestSgo } from "./test-support";

/* Synthetic organizations, donors and numbers ("SYN-" numbers stand in for portal-created ones). */

const NOW = new Date("2028-01-05T16:00:00.000Z");

async function errorOf(p: Promise<unknown>): Promise<{ code: string; message: string; details: unknown }> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return { code: e.code, message: e.message, details: e.details };
    throw e;
  }
  throw new Error("expected an error");
}

describe("unique donor numbers", () => {
  const t = useTestDb();
  let sgo: TestSgo;
  let admin: string;
  let donorA: string;
  let donorB: string;

  beforeEach(async () => {
    setTestNow(NOW);
    sgo = await createTestSgo({ portalRegistered: true });
    admin = await createStaff(sgo.orgId, "admin");
    donorA = await insertDonor({ firstName: "Avery" });
    donorB = await insertDonor({ firstName: "Blake" });
    for (const donorId of [donorA, donorB]) {
      await insertGift({ orgId: sgo.orgId, donorId, mode: "live" });
      await insertGift({ orgId: sgo.orgId, donorId, mode: "test" });
    }
  });
  afterEach(() => setTestNow(null));

  describe("setDonorNumber", () => {
    it("records the number SGO staff created in the portal, audits it and marks the acknowledgment for regeneration", async () => {
      const row = await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: " SYN-0001 " }, { userId: admin });
      expect(row).toMatchObject({ orgId: sgo.orgId, donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0001", source: "irs_portal_entered", assignedBy: admin });
      const [audit] = (await listAuditLogs({ action: "donor_number.set" })).items;
      expect(audit).toMatchObject({ orgId: sgo.orgId, actorId: admin });
      expect(JSON.stringify(audit.metadata)).not.toContain("SYN-0001");
      expect(await listPendingAcknowledgmentRefreshes({ mode: "live", orgId: sgo.orgId })).toMatchObject([{ donorId: donorA, taxYear: 2027, reason: "correction" }]);
    });

    it("is idempotent for the same number and needs replace to change it", async () => {
      await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0001" }, { userId: admin });
      await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0001" }, { userId: admin });
      const err = await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0002" }, { userId: admin }));
      expect(err).toMatchObject({ code: "conflict", details: { reason: "number_exists" } });
      const replaced = await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0002", replace: true }, { userId: admin });
      expect(replaced).toMatchObject({ number: "SYN-0002" });
      expect(replaced.replacedAt).toEqual(NOW);
      expect((await listAuditLogs({ action: "donor_number.replace" })).items).toHaveLength(1);
      expect(await t.db.select().from(schema.donorNumbers)).toHaveLength(1);
    });

    it("keeps a number unique within the SGO and year (case-insensitively), but not across years, modes or SGOs", async () => {
      await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-0001" }, { userId: admin });
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorB, taxYear: 2027, mode: "live", number: "syn-0001" }, { userId: admin }))).code).toBe("conflict");
      await setDonorNumber(sgo.orgId, { donorId: donorB, taxYear: 2027, mode: "test", number: "SYN-0001" }, { userId: admin });
      const other = await createTestSgo({ portalRegistered: true });
      await insertGift({ orgId: other.orgId, donorId: donorB, mode: "live" });
      await setDonorNumber(other.orgId, { donorId: donorB, taxYear: 2027, mode: "live", number: "SYN-0001" }, SYS);
      await insertGift({ orgId: sgo.orgId, donorId: donorB, mode: "live", taxYear: 2028, contributedAt: new Date("2028-02-01T16:00:00Z") });
      await setDonorNumber(sgo.orgId, { donorId: donorB, taxYear: 2028, mode: "live", number: "SYN-0001" }, { userId: admin });
    });

    it("validates only what any identifier needs: not empty, bounded, letters, digits and hyphens", async () => {
      for (const number of ["", "   ", "A".repeat(65), "SYN 0001", "SYN_0001", "-SYN", "SYN-", "SYN/1", "'=1+1"]) {
        const err = await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number }, { userId: admin }));
        expect(err.code, number).toBe("validation_failed");
      }
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-1", ssn: "000-00-0000" } as never, { userId: admin }))).code).toBe("validation_failed");
      await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "A".repeat(64) }, { userId: admin });
    });

    it("refuses live numbers before IRS SGO portal registration and TEST- numbers in live", async () => {
      const unregistered = await createTestSgo({ portalRegistered: false });
      await insertGift({ orgId: unregistered.orgId, donorId: donorA, mode: "live" });
      expect(await errorOf(setDonorNumber(unregistered.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-1" }, SYS))).toMatchObject({ code: "conflict", details: { reason: "sgo_not_portal_registered" } });
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "test-123" }, { userId: admin }))).code).toBe("validation_failed");
    });

    it("refuses a donor who did not give to this SGO in that year, and other SGOs' donors", async () => {
      const stranger = await insertDonor({ firstName: "Casey" });
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: stranger, taxYear: 2027, mode: "live", number: "SYN-9" }, { userId: admin }))).code).toBe("not_found");
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2026, mode: "live", number: "SYN-9" }, { userId: admin }))).code).toBe("not_found");
      const pendingOnly = await insertDonor({ firstName: "Drew" });
      await insertGift({ orgId: sgo.orgId, donorId: pendingOnly, mode: "live", status: "pending" });
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: pendingOnly, taxYear: 2027, mode: "live", number: "SYN-9" }, { userId: admin }))).code).toBe("not_found");
    });

    it("requires an SGO admin (or the system): reviewers, viewers, outsiders and another SGO's admin are refused", async () => {
      const reviewer = await createStaff(sgo.orgId, "reviewer");
      const viewer = await createStaff(sgo.orgId, "viewer");
      const other = await createTestSgo();
      const otherAdmin = await createStaff(other.orgId, "admin");
      for (const userId of [reviewer, viewer, otherAdmin, "usr_nobody"]) {
        expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-1" }, { userId }))).code).toBe("forbidden");
      }
      expect((await errorOf(setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-1" }, { system: true, reason: "" }))).code).toBe("forbidden");
      await setDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live", number: "SYN-1" }, { userId: sgo.ownerUserId });
    });
  });

  describe("importDonorNumbers", () => {
    const header = "donor_id,tax_year,unique_donor_number";

    it("imports a clean file atomically and reports the counts", async () => {
      const csv = [header, `${donorA},2027,SYN-0001`, `${donorB},2027,SYN-0002`].join("\n");
      const dry = await importDonorNumbers(sgo.orgId, { csv, mode: "live", dryRun: true }, { userId: admin });
      expect(dry).toMatchObject({ applied: false, rows: 2, errors: [] });
      expect(await t.db.select().from(schema.donorNumbers)).toHaveLength(0);
      const report = await importDonorNumbers(sgo.orgId, { csv, mode: "live" }, { userId: admin });
      expect(report).toMatchObject({ applied: true, rows: 2, created: 2, replaced: 0, unchanged: 0, errors: [] });
      const rows = await t.db.select().from(schema.donorNumbers);
      expect(rows.map((r) => [r.number, r.source]).sort()).toEqual([
        ["SYN-0001", "irs_portal_import"],
        ["SYN-0002", "irs_portal_import"],
      ]);
      expect((await listAuditLogs({ action: "donor_number.import" })).items).toHaveLength(1);
      expect(await importDonorNumbers(sgo.orgId, { csv, mode: "live" }, { userId: admin })).toMatchObject({ applied: true, unchanged: 2, created: 0 });
    });

    it("reports every row-level error with its line and writes nothing", async () => {
      await setDonorNumber(sgo.orgId, { donorId: donorB, taxYear: 2027, mode: "live", number: "SYN-TAKEN" }, { userId: admin });
      const stranger = await insertDonor({ firstName: "Casey" });
      const csv = [
        header,
        `${donorA},2027,SYN-0001`,
        `${donorA},2027,SYN-0003`, // same donor twice
        `bad id!,2027,SYN-0004`,
        `${donorB},27,SYN-0005`,
        `${donorB},2027,`,
        `${stranger},2027,SYN-0006`,
        `${donorA},2027,TEST-0007`,
        `${donorA},2027,SYN-0001`, // same number twice
      ].join("\n");
      const report = await importDonorNumbers(sgo.orgId, { csv, mode: "live" }, { userId: admin });
      expect(report.applied).toBe(false);
      expect(report.errors.map((e) => [e.line, e.field])).toEqual([
        [3, "donor_id"],
        [4, "donor_id"],
        [5, "tax_year"],
        [6, "unique_donor_number"],
        [7, "donor_id"],
        [8, "unique_donor_number"],
        [9, "unique_donor_number"],
      ]);
      expect(await t.db.select().from(schema.donorNumbers)).toHaveLength(1);
      const taken = await importDonorNumbers(sgo.orgId, { csv: [header, `${donorA},2027,syn-taken`].join("\n"), mode: "live" }, { userId: admin });
      expect(taken.errors).toMatchObject([{ line: 2, field: "unique_donor_number", message: expect.stringMatching(/another donor/) }]);
    });

    it("refuses a file without the columns, an empty file, and changes without replace; swaps two numbers with replace", async () => {
      expect((await importDonorNumbers(sgo.orgId, { csv: "donor,number\nx,y", mode: "live" }, { userId: admin })).errors[0]).toMatchObject({ line: 1, field: "file" });
      expect((await importDonorNumbers(sgo.orgId, { csv: header, mode: "live" }, { userId: admin })).errors[0]).toMatchObject({ field: "file", message: "The file has no rows." });
      await importDonorNumbers(sgo.orgId, { csv: [header, `${donorA},2027,SYN-A`, `${donorB},2027,SYN-B`].join("\n"), mode: "live" }, { userId: admin });
      const swap = [header, `${donorA},2027,SYN-B`, `${donorB},2027,SYN-A`].join("\n");
      expect((await importDonorNumbers(sgo.orgId, { csv: swap, mode: "live" }, { userId: admin })).applied).toBe(false);
      expect(await importDonorNumbers(sgo.orgId, { csv: swap, mode: "live", replace: true }, { userId: admin })).toMatchObject({ applied: true, replaced: 2 });
      const rows = await t.db.select().from(schema.donorNumbers);
      expect(Object.fromEntries(rows.map((r) => [r.donorId, r.number]))).toEqual({ [donorA]: "SYN-B", [donorB]: "SYN-A" });
    });

    it("needs portal registration for live imports and authorization always", async () => {
      const unregistered = await createTestSgo({ portalRegistered: false });
      const csv = [header, `${donorA},2027,SYN-1`].join("\n");
      expect((await errorOf(importDonorNumbers(unregistered.orgId, { csv, mode: "live" }, SYS))).details).toMatchObject({ reason: "sgo_not_portal_registered" });
      const viewer = await createStaff(sgo.orgId, "viewer");
      expect((await errorOf(importDonorNumbers(sgo.orgId, { csv, mode: "live" }, { userId: viewer }))).code).toBe("forbidden");
    });
  });

  describe("sandbox numbers", () => {
    it("exist only in test mode, start with TEST- and are stable per donor and year", async () => {
      const row = await generateSandboxDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "test" }, { userId: admin });
      expect(row.number).toMatch(/^TEST-2027-[0-9A-Z]{10}$/);
      expect(row).toMatchObject({ source: "sandbox_generated", mode: "test" });
      expect((await generateSandboxDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "test" }, { userId: admin })).number).toBe(row.number);
      expect((await errorOf(generateSandboxDonorNumber(sgo.orgId, { donorId: donorA, taxYear: 2027, mode: "live" as "test" }, { userId: admin }))).code).toBe("validation_failed");
      expect(await generateSandboxDonorNumbers(sgo.orgId, { taxYear: 2027, mode: "test" }, { userId: admin })).toEqual({ created: 1 });
      await expect(generateSandboxDonorNumbers(sgo.orgId, { taxYear: 2027, mode: "live" as "test" }, { userId: admin })).rejects.toMatchObject({ code: "validation_failed" });
      expect((await t.db.select().from(schema.donorNumbers)).every((r) => r.mode === "test" && r.number.startsWith("TEST-"))).toBe(true);
    });

    it("work without portal registration (no real number is involved)", async () => {
      const unregistered = await createTestSgo({ portalRegistered: false });
      await insertGift({ orgId: unregistered.orgId, donorId: donorA, mode: "test" });
      expect((await generateSandboxDonorNumber(unregistered.orgId, { donorId: donorA, taxYear: 2027, mode: "test" }, SYS)).number).toMatch(/^TEST-/);
    });
  });
});
