import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { IrsReportIssue, Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { parseCsv, toCsv } from "@/lib/csv";
import { AppError, conflict, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { getSgoProfile, type SgoActor } from "@/server/sgos";
import { getObjectBytes, putObject } from "@/server/storage";
import { irsContributionReportDueDate } from "@/taxmath";
import { authorizeStaff, lockKey, requireOrgId, requireReadAccess, type ReadAccess } from "./access";
import { donorAddressLines, donorFullName } from "./build";
import { IRS_REPORT_COLUMNS, REPORT_AMOUNT_BASIS, REPORT_HISTORY_LIMIT, SANDBOX_DONOR_NUMBER_PREFIX } from "./policy";

/**
 * The SGO's annual contribution report to the IRS (Temp. Treas. Reg. 1.25F-4T(c)(2); acknowledgment-reporting.md
 * F33-F36, E4): one record per unique donor number with the donor's name, address and aggregate qualified
 * contributions for the calendar year, due February 28 of the next year through the IRS SGO portal. The portal's
 * file format is NOT IN SOURCES (F35), so this produces a CSV with internal column names plus the same rows as a
 * table for manual entry, an issues list, and a consistency check against the issued acknowledgments. Every
 * generation is a new immutable version stored encrypted with its SHA-256; test and live data never mix.
 */

const { donations, donors, donorNumbers, acknowledgments, irsReports } = schema;
export type IrsReportRow = typeof irsReports.$inferSelect;

export interface IrsReportTableRow {
  donorId: string;
  uniqueDonorNumber: string;
  donorName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  aggregateQualifiedContributionsCents: number;
}

export type IrsReportIssueCode =
  | "test_mode"
  | "sgo_ein_missing"
  | "sgo_not_portal_registered"
  | "donor_number_missing"
  | "sandbox_donor_number_in_live"
  | "donor_name_missing"
  | "address_incomplete"
  | "goods_or_services_review"
  | "acknowledgment_not_issued"
  | "total_changed_after_acknowledgment"
  | "refunded_after_acknowledgment"
  | "name_or_address_differs_from_acknowledgment"
  | "no_contributions";

export interface ConsistencyMismatch {
  donorId: string;
  reportCents: number;
  acknowledgedCents: number;
}

/**
 * Proof that the report agrees with what donors were told: per donor, the report amount equals the latest issued
 * acknowledgment's designated total less any goods-or-services value it stated, and the grand totals are equal.
 */
export interface IrsReportConsistency {
  matches: boolean;
  reportTotalCents: number;
  acknowledgedTotalCents: number;
  /** Donors in the report or with an issued acknowledgment whose two figures differ (a missing side counts as 0). */
  mismatches: ConsistencyMismatch[];
  basis: typeof REPORT_AMOUNT_BASIS;
}

export interface IrsReportResult {
  report: IrsReportRow;
  sgo: { name: string; legalName: string | null; ein: string | null };
  dueDate: string;
  table: { columns: readonly string[]; rows: IrsReportTableRow[] };
  csv: string;
  issues: IrsReportIssue[];
  consistency: IrsReportConsistency;
}

const yearSchema = z.number().int().min(2000).max(2200);
const generateSchema = z.strictObject({ taxYear: yearSchema, mode: z.enum(["test", "live"]) });

function fields(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "input"] ??= issue.message;
  return out;
}

/** "170000" cents → "1700.00": a plain decimal (no currency sign or separators) for re-keying into the portal. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const ZIP = /^\d{5}(?:-\d{4})?$/;
const STATE = /^[A-Z]{2}$/;

function issue(code: IrsReportIssueCode, severity: IrsReportIssue["severity"], message: string, donorId?: string): IrsReportIssue {
  return donorId ? { code, severity, message, donorId } : { code, severity, message };
}

const usd = (cents: number) => `$${centsToDecimal(cents)}`;

/** Builds the report content from the ledger, the donor numbers and the issued acknowledgments. Reads only. */
async function assemble(db: DbOrTx, orgId: string, taxYear: number, mode: Mode) {
  const { profile } = await getSgoProfile(orgId, db);
  const sums = await db
    .select({
      donorId: donations.donorId,
      designatedCents: sql<string>`coalesce(sum(${donations.designatedAmountCents}), 0)`,
      goodsCents: sql<string>`coalesce(sum(case when ${donations.goodsOrServicesProvided} then ${donations.goodsOrServicesValueCents} else 0 end), 0)`,
      goodsCount: sql<string>`count(*) filter (where ${donations.goodsOrServicesProvided})`,
    })
    .from(donations)
    .where(and(eq(donations.orgId, orgId), eq(donations.mode, mode), eq(donations.taxYear, taxYear), eq(donations.status, "succeeded")))
    .groupBy(donations.donorId);
  const issued = await db
    .select()
    .from(acknowledgments)
    .where(and(eq(acknowledgments.orgId, orgId), eq(acknowledgments.mode, mode), eq(acknowledgments.taxYear, taxYear), eq(acknowledgments.status, "issued")));
  const donorIds = [...new Set([...sums.map((s) => s.donorId), ...issued.map((a) => a.donorId)])];
  const donorRows = donorIds.length ? await db.select().from(donors).where(inArray(donors.id, donorIds)) : [];
  const numberRows = donorIds.length
    ? await db.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, orgId), eq(donorNumbers.mode, mode), eq(donorNumbers.taxYear, taxYear), inArray(donorNumbers.donorId, donorIds)))
    : [];
  const donorById = new Map(donorRows.map((d) => [d.id, d]));
  const numberByDonor = new Map(numberRows.map((n) => [n.donorId, n]));
  const ackByDonor = new Map(issued.map((a) => [a.donorId, a]));

  const issues: IrsReportIssue[] = [];
  if (mode === "test") issues.push(issue("test_mode", "warning", "Test mode: this report is built from sandbox gifts and sandbox donor numbers. It is not for filing."));
  if (!profile.ein) issues.push(issue("sgo_ein_missing", "error", "The organization's EIN is not on file."));
  if (mode === "live" && !profile.irsPortalRegistered) issues.push(issue("sgo_not_portal_registered", "error", "The organization is not recorded as registered in the IRS SGO portal, where this report is filed."));

  const rows: IrsReportTableRow[] = [];
  const reportByDonor = new Map<string, number>();
  for (const s of sums) {
    const donor = donorById.get(s.donorId);
    if (!donor) continue;
    const designated = Number(s.designatedCents);
    if (designated === 0) continue;
    const name = donorFullName(donor);
    const goods = Number(s.goodsCents);
    const qualified = designated - goods;
    if (Number(s.goodsCount) > 0) {
      issues.push(issue("goods_or_services_review", "warning", `Goods or services worth ${usd(goods)} were recorded for ${name}; the reported amount is the designated total less that value. Confirm the figure before filing.`, donor.id));
    }
    const number = numberByDonor.get(donor.id);
    if (!number) {
      issues.push(issue("donor_number_missing", "error", `${name} has no unique donor number for ${taxYear}; the report has one record per unique donor number, so this donor is not in the file.`, donor.id));
      continue;
    }
    if (mode === "live" && (number.source === "sandbox_generated" || number.number.toUpperCase().startsWith(SANDBOX_DONOR_NUMBER_PREFIX))) {
      issues.push(issue("sandbox_donor_number_in_live", "error", `${name} has a sandbox donor number, which is never valid for filing; this donor is not in the file.`, donor.id));
      continue;
    }
    if (!donor.firstName.trim() || !donor.lastName.trim()) issues.push(issue("donor_name_missing", "error", `The donor name for number ${number.number} is incomplete.`, donor.id));
    const addressProblems: string[] = [];
    if (!donor.addressLine1.trim()) addressProblems.push("street address");
    if (!donor.city.trim()) addressProblems.push("city");
    if (!STATE.test(donor.state.trim())) addressProblems.push("two-letter State code");
    if (!ZIP.test(donor.zip.trim())) addressProblems.push("ZIP code");
    if (addressProblems.length) issues.push(issue("address_incomplete", "error", `The address of ${name} is missing or has an invalid ${addressProblems.join(", ")}.`, donor.id));

    const ack = ackByDonor.get(donor.id);
    if (!ack) {
      issues.push(issue("acknowledgment_not_issued", "error", `No acknowledgment has been issued to ${name} for ${taxYear}; the report must match what the donor was told.`, donor.id));
    } else {
      const acknowledged = ack.totalDesignatedCents - (ack.goodsOrServicesProvided ? ack.goodsOrServicesValueCents : 0);
      if (acknowledged !== qualified) {
        issues.push(issue("total_changed_after_acknowledgment", "error", `The ${taxYear} total for ${name} is ${usd(qualified)}, but the acknowledgment issued says ${usd(acknowledged)}. Issue a new acknowledgment before filing.`, donor.id));
      }
      const snap = ack.snapshot;
      const printed = snap ? [snap.donor.fullName, ...snap.donor.addressLines].join("|") : null;
      const current = [name, ...donorAddressLines(donor)].join("|");
      if (printed !== null && printed !== current) {
        issues.push(issue("name_or_address_differs_from_acknowledgment", "warning", `The name or address of ${name} differs from what the issued acknowledgment printed.`, donor.id));
      }
    }
    reportByDonor.set(donor.id, qualified);
    rows.push({
      donorId: donor.id,
      uniqueDonorNumber: number.number,
      donorName: name,
      addressLine1: donor.addressLine1.trim(),
      addressLine2: (donor.addressLine2 ?? "").trim(),
      city: donor.city.trim(),
      state: donor.state.trim(),
      zip: donor.zip.trim(),
      aggregateQualifiedContributionsCents: qualified,
    });
  }
  for (const ack of issued) {
    if (reportByDonor.has(ack.donorId) || sums.some((s) => s.donorId === ack.donorId && Number(s.designatedCents) > 0)) continue;
    const donor = donorById.get(ack.donorId);
    issues.push(
      issue("refunded_after_acknowledgment", "error", `${donor ? donorFullName(donor) : "A donor"} was issued an acknowledgment of ${usd(ack.totalDesignatedCents)} for ${taxYear}, but no contribution from them remains received. Review the correction with counsel.`, ack.donorId),
    );
  }
  rows.sort((a, b) => a.uniqueDonorNumber.localeCompare(b.uniqueDonorNumber));
  if (rows.length === 0) issues.push(issue("no_contributions", "warning", `No donor has a reportable qualified contribution for ${taxYear}.`));

  const mismatches: ConsistencyMismatch[] = [];
  let acknowledgedTotalCents = 0;
  for (const ack of issued) acknowledgedTotalCents += ack.totalDesignatedCents - (ack.goodsOrServicesProvided ? ack.goodsOrServicesValueCents : 0);
  for (const donorId of donorIds) {
    const reportCents = reportByDonor.get(donorId) ?? 0;
    const ack = ackByDonor.get(donorId);
    const acknowledgedCents = ack ? ack.totalDesignatedCents - (ack.goodsOrServicesProvided ? ack.goodsOrServicesValueCents : 0) : 0;
    if (reportCents !== acknowledgedCents) mismatches.push({ donorId, reportCents, acknowledgedCents });
  }
  mismatches.sort((a, b) => a.donorId.localeCompare(b.donorId));
  const reportTotalCents = rows.reduce((s, r) => s + r.aggregateQualifiedContributionsCents, 0);
  const consistency: IrsReportConsistency = { matches: mismatches.length === 0 && reportTotalCents === acknowledgedTotalCents, reportTotalCents, acknowledgedTotalCents, mismatches, basis: REPORT_AMOUNT_BASIS };
  // Errors first, then warnings; within each, the file order of donors.
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return { profile, rows, issues, consistency };
}

function toFileRows(rows: readonly IrsReportTableRow[]): unknown[][] {
  return rows.map((r) => [r.uniqueDonorNumber, r.donorName, r.addressLine1, r.addressLine2, r.city, r.state, r.zip, centsToDecimal(r.aggregateQualifiedContributionsCents)]);
}

/**
 * Generates (and stores as a new version) the contribution report for one SGO, calendar year and mode. Always
 * succeeds when authorized: problems are returned as issues (errors must be fixed before filing) rather than
 * thrown, so the SGO sees everything that is wrong at once.
 */
export async function generateIrsReport(orgId: string, input: z.input<typeof generateSchema>, actor: SgoActor, dbOrTx?: DbOrTx): Promise<IrsReportResult> {
  const org = requireOrgId(orgId);
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the report request.", { fields: fields(parsed.error) });
  const { taxYear, mode } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    await lockKey(tx, `irs_report:${org}:${taxYear}:${mode}`);
    const { profile, rows, issues, consistency } = await assemble(tx, org, taxYear, mode);
    const csv = toCsv([...IRS_REPORT_COLUMNS], toFileRows(rows));
    const bytes = new TextEncoder().encode(csv);
    const [{ last }] = await tx
      .select({ last: max(irsReports.version) })
      .from(irsReports)
      .where(and(eq(irsReports.orgId, org), eq(irsReports.taxYear, taxYear), eq(irsReports.mode, mode)));
    const version = (last ?? 0) + 1;
    const einPart = (profile.ein ?? "no-ein").replace(/[^0-9A-Za-z]/g, "");
    const filename = `${mode === "test" ? "sandbox-" : ""}contribution-report-${einPart}-${taxYear}-v${version}.csv`;
    const object = await putObject({ bytes, contentType: "text/csv; charset=utf-8", purpose: "irs_report", filename, orgId: org }, tx);
    const at = now();
    const [report] = await tx
      .insert(irsReports)
      .values({
        id: newId("irsReport"),
        orgId: org,
        mode,
        taxYear,
        version,
        rowCount: rows.length,
        totalDesignatedCents: consistency.reportTotalCents,
        acknowledgedTotalCents: consistency.acknowledgedTotalCents,
        consistency: { ...consistency },
        objectId: object.id,
        sha256: sha256Hex(bytes),
        filename,
        generatedBy: who.label,
        generatedAt: at,
        issues,
      })
      .returning();
    await audit(
      {
        actor: who.audit,
        orgId: org,
        action: "irs_report.generate",
        target: { type: "irs_report", id: report.id },
        metadata: { taxYear, mode, version, rowCount: rows.length, totalCents: consistency.reportTotalCents, consistent: consistency.matches, errors: issues.filter((i) => i.severity === "error").length, sha256: report.sha256, systemReason: who.systemReason ?? null },
        request: who.request,
      },
      tx,
    );
    return {
      report,
      sgo: { name: profile.displayName, legalName: profile.legalName, ein: profile.ein },
      dueDate: irsContributionReportDueDate(taxYear),
      table: { columns: IRS_REPORT_COLUMNS, rows },
      csv,
      issues,
      consistency,
    };
  });
}

/**
 * The consistency check on its own, without storing a report: the current ledger against the issued
 * acknowledgments. Used by the dashboard and the February reminder.
 */
export async function checkIrsReportConsistency(orgId: string, input: z.input<typeof generateSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<{ consistency: IrsReportConsistency; issues: IrsReportIssue[] }> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the report request.", { fields: fields(parsed.error) });
  const db = dbOrTx ?? (await getDb());
  const { issues, consistency } = await assemble(db, org, parsed.data.taxYear, parsed.data.mode);
  await audit({ actor: reader.actor, orgId: org, action: "irs_report.check", metadata: { taxYear: parsed.data.taxYear, mode: parsed.data.mode, consistent: consistency.matches }, request: reader.request ?? null }, db);
  return { consistency, issues };
}

/* ------------------------------------------------------------------ history, reading, submission */

const listSchema = z.strictObject({ mode: z.enum(["test", "live"]), taxYear: yearSchema.optional() });

/** Report versions, newest first (no donor data: counts, totals, hashes, issues and submission record). */
export async function listIrsReports(orgId: string, params: z.input<typeof listSchema>, access: ReadAccess, dbOrTx?: DbOrTx): Promise<IrsReportRow[]> {
  const org = requireOrgId(orgId);
  requireReadAccess(access);
  const parsed = listSchema.safeParse(params);
  if (!parsed.success) throw invalid("Check the filters.", { fields: fields(parsed.error) });
  const db = dbOrTx ?? (await getDb());
  const where = [eq(irsReports.orgId, org), eq(irsReports.mode, parsed.data.mode)];
  if (parsed.data.taxYear !== undefined) where.push(eq(irsReports.taxYear, parsed.data.taxYear));
  return db.select().from(irsReports).where(and(...where)).orderBy(desc(irsReports.taxYear), desc(irsReports.version)).limit(REPORT_HISTORY_LIMIT);
}

async function loadReport(db: DbOrTx, orgId: string, reportId: unknown): Promise<IrsReportRow> {
  const [row] = typeof reportId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(reportId) ? await db.select().from(irsReports).where(and(eq(irsReports.id, reportId), eq(irsReports.orgId, orgId))) : [];
  if (!row) throw notFound("Report");
  return row;
}

export interface IrsReportDownload {
  filename: string;
  contentType: string;
  bytes: Buffer;
  sha256: string;
  report: IrsReportRow;
}

/** The stored file of one report version, verified against its SHA-256. Audited. Another SGO's report is not found. */
export async function downloadIrsReport(orgId: string, reportId: string, access: ReadAccess, dbOrTx?: DbOrTx): Promise<IrsReportDownload> {
  const org = requireOrgId(orgId);
  const reader = requireReadAccess(access);
  const db = dbOrTx ?? (await getDb());
  const report = await loadReport(db, org, reportId);
  if (!report.objectId) throw notFound("Report file");
  const bytes = await getObjectBytes(report.objectId, { orgId: org }, db);
  // The report row's own hash is the record of what was generated; never serve a file that does not match it.
  if (!report.sha256 || sha256Hex(bytes) !== report.sha256) throw new AppError("internal", `IRS report ${report.id}: the stored file does not match the recorded SHA-256`);
  await audit({ actor: reader.actor, orgId: org, action: "irs_report.download", target: { type: "irs_report", id: report.id }, metadata: { taxYear: report.taxYear, mode: report.mode, version: report.version, sha256: report.sha256 }, request: reader.request ?? null }, db);
  return { filename: report.filename ?? `contribution-report-${report.taxYear}-v${report.version}.csv`, contentType: "text/csv; charset=utf-8", bytes, sha256: report.sha256, report };
}

/** One stored version as the on-screen table (read back from the stored file). Audited like a download. */
export async function getIrsReportTable(orgId: string, reportId: string, access: ReadAccess, dbOrTx?: DbOrTx): Promise<{ report: IrsReportRow; columns: readonly string[]; rows: string[][] }> {
  const file = await downloadIrsReport(orgId, reportId, access, dbOrTx);
  const [header, ...rows] = parseCsv(file.bytes.toString("utf8"));
  return { report: file.report, columns: header ?? [...IRS_REPORT_COLUMNS], rows };
}

const submissionSchema = z.strictObject({
  submittedOn: z.iso.date("Enter the date as YYYY-MM-DD."),
  reference: z.string().trim().max(200).optional(),
});

/**
 * Records that SGO staff entered this report version in the IRS SGO portal, with the date and any confirmation
 * reference the portal gave. A version can be recorded once; a correction is a new version recorded separately.
 */
export async function recordIrsReportSubmission(orgId: string, reportId: string, input: z.input<typeof submissionSchema>, actor: SgoActor, dbOrTx?: DbOrTx): Promise<IrsReportRow> {
  const org = requireOrgId(orgId);
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the submission details.", { fields: fields(parsed.error) });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    const report = await loadReport(tx, org, reportId);
    if (report.submittedOn) throw conflict("This report version is already recorded as submitted.", { submittedOn: report.submittedOn });
    if (report.mode === "test") throw conflict("A test-mode report is never filed with the IRS.", { reason: "test_mode" });
    if (parsed.data.submittedOn < `${report.taxYear + 1}-01-01`) throw invalid("The report can only be filed after the calendar year ends.", { fields: { submittedOn: `Enter a date in ${report.taxYear + 1} or later.` } });
    const [updated] = await tx
      .update(irsReports)
      .set({ submittedOn: parsed.data.submittedOn, submissionReference: parsed.data.reference || null, submittedBy: who.label })
      .where(eq(irsReports.id, report.id))
      .returning();
    await audit({ actor: who.audit, orgId: org, action: "irs_report.submitted", target: { type: "irs_report", id: report.id }, metadata: { taxYear: report.taxYear, version: report.version, submittedOn: parsed.data.submittedOn, sha256: report.sha256 }, request: who.request }, tx);
    return updated;
  });
}
