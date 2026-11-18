import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { parseCsv } from "@/lib/csv";
import { badRequest, conflict, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { getSgoProfile, type SgoActor } from "@/server/sgos";
import { authorizeStaff, lockKey, requireOrgId, type ActorContext } from "./access";
import {
  DONOR_NUMBER_IMPORT_MAX_BYTES,
  DONOR_NUMBER_IMPORT_MAX_ROWS,
  DONOR_NUMBER_MAX_LENGTH,
  DONOR_NUMBER_PATTERN,
  SANDBOX_DONOR_NUMBER_PREFIX,
} from "./policy";
import { markAcknowledgmentStale } from "./refreshes";

/**
 * Unique donor numbers. The SGO creates them in the IRS SGO portal under instructions the IRS gives only after
 * registration (Temp. Treas. Reg. 1.25F-4T(b)(4); acknowledgment-reporting.md F20-F23). We never invent a real one:
 * SGO staff enter or import what the portal produced. In test mode only, a clearly labeled sandbox number can be
 * generated. Numbers are per donor, per SGO, per calendar year and mode (F24: lifetime NOT IN SOURCES), unique within
 * the SGO and year, and every change marks the donor's acknowledgment for regeneration.
 */

const { donorNumbers, donations } = schema;
export type DonorNumberRow = typeof donorNumbers.$inferSelect;

const numberSchema = z
  .string()
  .trim()
  .min(1, "Enter the unique donor number.")
  .max(DONOR_NUMBER_MAX_LENGTH, `A unique donor number has at most ${DONOR_NUMBER_MAX_LENGTH} characters.`)
  .regex(DONOR_NUMBER_PATTERN, "Use only letters, digits and hyphens.");

const setSchema = z.strictObject({
  donorId: z.string().min(1).max(100),
  taxYear: z.number().int().min(2000).max(2200),
  mode: z.enum(["test", "live"]),
  number: numberSchema,
  /** Required to change a number the donor already has. */
  replace: z.boolean().optional(),
});

export type SetDonorNumberInput = z.input<typeof setSchema>;

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "input"] ??= issue.message;
  return out;
}

const isSandboxNumber = (n: string) => n.toUpperCase().startsWith(SANDBOX_DONOR_NUMBER_PREFIX);

/** The donor designated at least one payment to this SGO in the year (F20); otherwise the donor is "not found" here. */
async function assertDonorGaveInYear(tx: DbOrTx, orgId: string, donorId: string, taxYear: number, mode: Mode): Promise<void> {
  const [row] = await tx
    .select({ id: donations.id })
    .from(donations)
    .where(and(eq(donations.orgId, orgId), eq(donations.donorId, donorId), eq(donations.taxYear, taxYear), eq(donations.mode, mode), inArray(donations.status, ["succeeded", "refunded"])))
    .limit(1);
  if (!row) throw notFound("Donor");
}

async function assertLiveAllowed(tx: DbOrTx, orgId: string, mode: Mode): Promise<void> {
  if (mode !== "live") return;
  const { profile } = await getSgoProfile(orgId, tx);
  if (!profile.irsPortalRegistered) {
    throw conflict("Register in the IRS SGO portal first: unique donor numbers can only be created under the instructions the IRS gives after registration.", { reason: "sgo_not_portal_registered" });
  }
}

type Source = DonorNumberRow["source"];

interface ApplyResult {
  row: DonorNumberRow;
  outcome: "created" | "replaced" | "unchanged";
}

/** Writes one number under the SGO/year lock. Caller has authorized, validated and locked. */
async function applyNumber(
  tx: DbOrTx,
  input: { orgId: string; donorId: string; taxYear: number; mode: Mode; number: string; replace: boolean; source: Source },
  who: ActorContext,
): Promise<ApplyResult> {
  const { orgId, donorId, taxYear, mode, number } = input;
  if (mode === "live" && (isSandboxNumber(number) || input.source === "sandbox_generated")) {
    throw invalid(`Numbers starting with ${SANDBOX_DONOR_NUMBER_PREFIX} are reserved for test mode.`, { fields: { number: `Numbers starting with ${SANDBOX_DONOR_NUMBER_PREFIX} are reserved for test mode.` } });
  }
  const sameYear = await tx
    .select()
    .from(donorNumbers)
    .where(and(eq(donorNumbers.orgId, orgId), eq(donorNumbers.taxYear, taxYear), eq(donorNumbers.mode, mode), sql`upper(${donorNumbers.number}) = upper(${number})`));
  const takenByOther = sameYear.find((r) => r.donorId !== donorId);
  if (takenByOther) {
    throw conflict("This unique donor number is already recorded for another donor of this organization for the year.", { fields: { number: "Already used for another donor." }, donorId: takenByOther.donorId });
  }
  const [existing] = await tx.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, orgId), eq(donorNumbers.donorId, donorId), eq(donorNumbers.taxYear, taxYear), eq(donorNumbers.mode, mode)));
  const at = now();
  let row: DonorNumberRow;
  let outcome: ApplyResult["outcome"];
  if (existing) {
    if (existing.number === number) return { row: existing, outcome: "unchanged" };
    if (!input.replace) {
      throw conflict("This donor already has a unique donor number for the year. Confirm that you want to replace it.", { reason: "number_exists", fields: { number: "This donor already has a number for the year." } });
    }
    [row] = await tx.update(donorNumbers).set({ number, source: input.source, assignedBy: who.label, assignedAt: at, replacedAt: at }).where(eq(donorNumbers.id, existing.id)).returning();
    outcome = "replaced";
  } else {
    [row] = await tx.insert(donorNumbers).values({ id: newId("donorNumber"), orgId, donorId, taxYear, mode, number, source: input.source, assignedBy: who.label, assignedAt: at }).returning();
    outcome = "created";
  }
  await markAcknowledgmentStale({ orgId, donorId, taxYear, mode, reason: "correction" }, tx);
  await audit(
    {
      actor: who.audit,
      orgId,
      action: outcome === "replaced" ? "donor_number.replace" : "donor_number.set",
      target: { type: "donor_number", id: row.id },
      metadata: { donorId, taxYear, mode, source: input.source, systemReason: who.systemReason ?? null },
      request: who.request,
    },
    tx,
  );
  return { row, outcome };
}

/**
 * Records the unique donor number SGO staff created for a donor in the IRS SGO portal. Live numbers need the SGO's
 * portal registration. Idempotent for the same number; changing a number needs `replace: true`.
 */
export async function setDonorNumber(orgId: string, input: SetDonorNumberInput, actor: SgoActor, dbOrTx?: DbOrTx): Promise<DonorNumberRow> {
  const org = requireOrgId(orgId);
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the unique donor number.", { fields: fieldErrors(parsed.error) });
  const data = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    await assertLiveAllowed(tx, org, data.mode);
    await assertDonorGaveInYear(tx, org, data.donorId, data.taxYear, data.mode);
    await lockKey(tx, `donor_numbers:${org}:${data.taxYear}:${data.mode}`);
    const { row } = await applyNumber(tx, { orgId: org, donorId: data.donorId, taxYear: data.taxYear, mode: data.mode, number: data.number, replace: data.replace === true, source: "irs_portal_entered" }, who);
    return row;
  });
}

/* ------------------------------------------------------------------ bulk import */

export const DONOR_NUMBER_IMPORT_COLUMNS = ["donor_id", "tax_year", "unique_donor_number"] as const;

export interface DonorNumberImportError {
  /** 1-based line of the file (the header is line 1). */
  line: number;
  field: (typeof DONOR_NUMBER_IMPORT_COLUMNS)[number] | "row" | "file";
  message: string;
}

export interface DonorNumberImportReport {
  mode: Mode;
  rows: number;
  /** Nothing is written unless every row is valid (applied = false). */
  applied: boolean;
  created: number;
  replaced: number;
  unchanged: number;
  errors: DonorNumberImportError[];
}

const importSchema = z.strictObject({
  csv: z.string(),
  mode: z.enum(["test", "live"]),
  replace: z.boolean().optional(),
  /** Validate and report without writing. */
  dryRun: z.boolean().optional(),
});

export type ImportDonorNumbersInput = z.input<typeof importSchema>;

/**
 * Bulk import of numbers created in the IRS SGO portal: a CSV with the columns donor_id, tax_year,
 * unique_donor_number (donor ids as in the donations export). Every row is checked (format, donor gave to this SGO
 * that year, duplicates within the file and against recorded numbers); the file is applied atomically and only when
 * no row has an error, so a half-imported file can never leave the SGO's records inconsistent.
 */
export async function importDonorNumbers(orgId: string, input: ImportDonorNumbersInput, actor: SgoActor, dbOrTx?: DbOrTx): Promise<DonorNumberImportReport> {
  const org = requireOrgId(orgId);
  const parsedInput = importSchema.safeParse(input);
  if (!parsedInput.success) throw invalid("Check the import.", { fields: fieldErrors(parsedInput.error) });
  const { csv, mode } = parsedInput.data;
  if (Buffer.byteLength(csv, "utf8") > DONOR_NUMBER_IMPORT_MAX_BYTES) throw badRequest(`The file is larger than ${DONOR_NUMBER_IMPORT_MAX_BYTES / (1024 * 1024)} MB.`);
  const db = dbOrTx ?? (await getDb());
  const report: DonorNumberImportReport = { mode, rows: 0, applied: false, created: 0, replaced: 0, unchanged: 0, errors: [] };

  const table = parseCsv(csv);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = DONOR_NUMBER_IMPORT_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    report.errors.push({ line: 1, field: "file", message: `Missing column(s): ${missing.join(", ")}. Expected: ${DONOR_NUMBER_IMPORT_COLUMNS.join(", ")}.` });
    return report;
  }
  const body = table.slice(1);
  report.rows = body.length;
  if (body.length === 0) {
    report.errors.push({ line: 1, field: "file", message: "The file has no rows." });
    return report;
  }
  if (body.length > DONOR_NUMBER_IMPORT_MAX_ROWS) {
    report.errors.push({ line: 1, field: "file", message: `At most ${DONOR_NUMBER_IMPORT_MAX_ROWS} rows per file.` });
    return report;
  }
  const col = (name: (typeof DONOR_NUMBER_IMPORT_COLUMNS)[number]) => header.indexOf(name);

  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    await assertLiveAllowed(tx, org, mode);

    const rows: Array<{ line: number; donorId: string; taxYear: number; number: string }> = [];
    const seenNumber = new Map<string, number>();
    const seenDonor = new Map<string, number>();
    body.forEach((cells, index) => {
      const line = index + 2;
      const donorId = (cells[col("donor_id")] ?? "").trim();
      const yearText = (cells[col("tax_year")] ?? "").trim();
      const numberResult = numberSchema.safeParse(cells[col("unique_donor_number")] ?? "");
      let ok = true;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(donorId)) {
        report.errors.push({ line, field: "donor_id", message: "Enter the donor id from the donations export." });
        ok = false;
      }
      const taxYear = Number(yearText);
      if (!/^\d{4}$/.test(yearText) || taxYear < 2000 || taxYear > 2200) {
        report.errors.push({ line, field: "tax_year", message: "Enter a four-digit calendar year." });
        ok = false;
      }
      if (!numberResult.success) {
        report.errors.push({ line, field: "unique_donor_number", message: numberResult.error.issues[0]?.message ?? "Invalid number." });
        ok = false;
      } else if (mode === "live" && isSandboxNumber(numberResult.data)) {
        report.errors.push({ line, field: "unique_donor_number", message: `Numbers starting with ${SANDBOX_DONOR_NUMBER_PREFIX} are reserved for test mode.` });
        ok = false;
      }
      if (!ok || !numberResult.success) return;
      const numberKey = `${taxYear}|${numberResult.data.toUpperCase()}`;
      const donorKey = `${taxYear}|${donorId}`;
      const dupNumber = seenNumber.get(numberKey);
      if (dupNumber !== undefined) {
        report.errors.push({ line, field: "unique_donor_number", message: `The same number is also on line ${dupNumber}.` });
        return;
      }
      const dupDonor = seenDonor.get(donorKey);
      if (dupDonor !== undefined) {
        report.errors.push({ line, field: "donor_id", message: `This donor and year are also on line ${dupDonor}.` });
        return;
      }
      seenNumber.set(numberKey, line);
      seenDonor.set(donorKey, line);
      rows.push({ line, donorId, taxYear, number: numberResult.data });
    });

    // Donors must have given to THIS SGO in that year and mode; anything else (including another SGO's donors) is not found.
    const years = [...new Set(rows.map((r) => r.taxYear))].sort();
    for (const year of years) await lockKey(tx, `donor_numbers:${org}:${year}:${mode}`);
    const donorIds = [...new Set(rows.map((r) => r.donorId))];
    const gave = donorIds.length
      ? await tx
          .selectDistinct({ donorId: donations.donorId, taxYear: donations.taxYear })
          .from(donations)
          .where(and(eq(donations.orgId, org), eq(donations.mode, mode), inArray(donations.donorId, donorIds), inArray(donations.status, ["succeeded", "refunded"])))
      : [];
    const gaveKey = new Set(gave.map((g) => `${g.taxYear}|${g.donorId}`));
    const existing = years.length
      ? await tx.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.mode, mode), inArray(donorNumbers.taxYear, years)))
      : [];
    const valid: typeof rows = [];
    for (const r of rows) {
      if (!gaveKey.has(`${r.taxYear}|${r.donorId}`)) {
        report.errors.push({ line: r.line, field: "donor_id", message: "No designated gift to this organization from this donor in that year." });
        continue;
      }
      const other = existing.find((e) => e.taxYear === r.taxYear && e.donorId !== r.donorId && e.number.toUpperCase() === r.number.toUpperCase());
      // A number held by a donor whose own row in this file changes it away is free again.
      const freed = other && rows.some((x) => x.donorId === other.donorId && x.taxYear === r.taxYear && x.number.toUpperCase() !== other.number.toUpperCase());
      if (other && !(freed && parsedInput.data.replace)) {
        report.errors.push({ line: r.line, field: "unique_donor_number", message: "Already recorded for another donor of this organization for that year." });
        continue;
      }
      const own = existing.find((e) => e.taxYear === r.taxYear && e.donorId === r.donorId);
      if (own && own.number !== r.number && !parsedInput.data.replace) {
        report.errors.push({ line: r.line, field: "unique_donor_number", message: "This donor already has a different number for that year (import with replace to change it)." });
        continue;
      }
      valid.push(r);
    }
    report.errors.sort((a, b) => a.line - b.line);
    if (report.errors.length > 0 || parsedInput.data.dryRun) return report;

    // Park every number this file changes first, so two donors swapping numbers in one file never collide.
    for (const r of valid) {
      const own = existing.find((e) => e.taxYear === r.taxYear && e.donorId === r.donorId);
      if (own && own.number !== r.number) await tx.update(donorNumbers).set({ number: `__swap__${own.id}` }).where(eq(donorNumbers.id, own.id));
    }
    for (const r of valid) {
      const result = await applyNumber(tx, { orgId: org, donorId: r.donorId, taxYear: r.taxYear, mode, number: r.number, replace: true, source: "irs_portal_import" }, who);
      report[result.outcome === "created" ? "created" : result.outcome === "replaced" ? "replaced" : "unchanged"] += 1;
    }
    report.applied = true;
    await audit({ actor: who.audit, orgId: org, action: "donor_number.import", metadata: { mode, rows: report.rows, created: report.created, replaced: report.replaced, unchanged: report.unchanged }, request: who.request }, tx);
    return report;
  });
}

/* ------------------------------------------------------------------ sandbox numbers */

const SANDBOX_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function sandboxNumber(taxYear: number): string {
  const bytes = randomBytes(10);
  const tail = Array.from(bytes, (b) => SANDBOX_ALPHABET[b % SANDBOX_ALPHABET.length]).join("");
  return `${SANDBOX_DONOR_NUMBER_PREFIX}${taxYear}-${tail}`;
}

const sandboxSchema = z.strictObject({ donorId: z.string().min(1).max(100), taxYear: z.number().int().min(2000).max(2200), mode: z.literal("test", "Sandbox donor numbers exist only in test mode.") });

/**
 * Test mode only: a sandbox number prefixed "TEST-", labeled "not valid for filing" wherever it is shown, and refused
 * by every live path. Returns the donor's existing number for the year when there is one.
 */
export async function generateSandboxDonorNumber(orgId: string, input: z.input<typeof sandboxSchema>, actor: SgoActor, dbOrTx?: DbOrTx): Promise<DonorNumberRow> {
  const org = requireOrgId(orgId);
  const parsed = sandboxSchema.safeParse(input);
  if (!parsed.success) throw invalid("Sandbox donor numbers exist only in test mode.", { fields: fieldErrors(parsed.error) });
  const { donorId, taxYear } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    await assertDonorGaveInYear(tx, org, donorId, taxYear, "test");
    await lockKey(tx, `donor_numbers:${org}:${taxYear}:test`);
    const [existing] = await tx.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.donorId, donorId), eq(donorNumbers.taxYear, taxYear), eq(donorNumbers.mode, "test")));
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = sandboxNumber(taxYear);
      const [clash] = await tx.select({ id: donorNumbers.id }).from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.taxYear, taxYear), eq(donorNumbers.mode, "test"), eq(donorNumbers.number, number)));
      if (clash) continue;
      return (await applyNumber(tx, { orgId: org, donorId, taxYear, mode: "test", number, replace: false, source: "sandbox_generated" }, who)).row;
    }
    throw conflict("Could not generate a unique sandbox number. Try again.");
  });
}

/** Test mode only: sandbox numbers for every donor of the year who has none yet. Returns how many were created. */
export async function generateSandboxDonorNumbers(orgId: string, input: { taxYear: number; mode: "test" }, actor: SgoActor, dbOrTx?: DbOrTx): Promise<{ created: number }> {
  const org = requireOrgId(orgId);
  if (input?.mode !== "test") throw invalid("Sandbox donor numbers exist only in test mode.", { fields: { mode: "Sandbox donor numbers exist only in test mode." } });
  const taxYear = z.number().int().min(2000).max(2200).parse(input.taxYear);
  const db = dbOrTx ?? (await getDb());
  await authorizeStaff(db, actor, org);
  const donors = await db
    .selectDistinct({ donorId: donations.donorId })
    .from(donations)
    .where(and(eq(donations.orgId, org), eq(donations.mode, "test"), eq(donations.taxYear, taxYear), inArray(donations.status, ["succeeded", "refunded"])));
  const have = await db.select({ donorId: donorNumbers.donorId }).from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.mode, "test"), eq(donorNumbers.taxYear, taxYear)));
  const haveSet = new Set(have.map((h) => h.donorId));
  let created = 0;
  for (const { donorId } of donors) {
    if (haveSet.has(donorId)) continue;
    await generateSandboxDonorNumber(org, { donorId, taxYear, mode: "test" }, actor, db);
    created += 1;
  }
  return { created };
}
