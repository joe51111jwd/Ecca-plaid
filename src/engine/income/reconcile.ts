/**
 * Evidence reconciliation: turning what was read from documents and data rails into income items WITHOUT
 * counting the same income twice.
 *
 * A Form W-2, a tax return and an IRS transcript for the same person and year describe the same wages. So
 * does a year-end pay stub. The verification service passes everything it extracted to
 * `reconcileIncomeEvidence`; it gets back one wage item per person (or per married couple on a joint
 * return), items for the other income lines of a tax record, and review flags.
 *
 * PRECEDENCE (product policy; the proposed rule lists the documents and ranks none of them). The recorded
 * wage figure comes from the first of these that is on file:
 *   1. IRS tax return transcript     2. IRS wage and income transcript     3. tax return as filed
 *   4. Forms W-2 (summed)            5. pay stubs (latest per employer, summed)
 * IRS records come first because the IRS produced them; a filed return comes before W-2s because it totals
 * every W-2 of the people on it, while the W-2s on file may not be all of them.
 *
 * CONSISTENCY. Figures that should agree are compared, and a difference above
 * `RECONCILIATION_POLICY.sameFigureToleranceCents` raises `income_figures_conflict`, which always sends the
 * verification to a person:
 *   - two complete records for the same people (a return and its transcript) must match;
 *   - W-2s, or one spouse's own record, may total LESS than a complete record (a W-2 may be missing), never more.
 * Whatever is flagged, the lower figure is never silently chosen: the item's `highCents` carries the highest
 * figure any document supports and `lowCents` the lowest complete one.
 *
 * WHICH "WAGES". The sources do not say whether household income uses taxable wages (Form W-2 box 1),
 * Medicare wages (box 5) or gross pay (docs/reference/hud-ami-and-annual-income.md, open question 6). The
 * recorded figure is on the taxable-wage basis, the only basis every document type except a pay stub
 * states; `highCents` adds what box 5 or a year-end pay stub shows above it. With a pay stub alone only
 * gross pay is known, so the item's lower bound is zero.
 *
 * PAY STUBS. Only a stub that closes the year can stand for the year: the last regular pay date of the
 * income year, or a stub marked final. A mid-year stub proves pay received so far and nothing about the
 * rest of the year; it produces `pay_stub_projection_only` and no figure the engine decides on. Nothing is
 * annualized.
 *
 * JOINT RETURNS cover both spouses: the wage item names one and lists the other in `alsoCoversMemberIds`.
 */
import { z } from "zod";
import { formatUsd } from "@/lib/money";
import { addDays, dayOfYear, daysInYear, lastDayOfYear, yearOf, type IsoDate } from "./calendar";
import type { IncomeCategoryKey } from "./categories";
import {
  idSchema,
  incomeYearSchema,
  isoDateSchema,
  MAX_AMOUNT_CENTS,
  parseInput,
  type IncomeFlagCode,
  type IncomeFlagSeverity,
  type IncomeItemInput,
  type IncomeReviewFlag,
} from "./types";

/* --------------------------------------------------------------------------------------- policy */

/** Product policy. None of these values comes from section 25F or the proposed regulations. */
export const RECONCILIATION_POLICY = Object.freeze({
  /**
   * Two documents state the same figure when they differ by no more than this. It absorbs whole-dollar
   * rounding on returns and transcripts across several wage statements. It is a matching tolerance only:
   * no amount is ever rounded away, and HUD's de minimis error rule (24 CFR 5.609(c)(4)) is not adopted.
   */
  sameFigureToleranceCents: 500,
  /**
   * A pay stub closes the year when the next regular pay date would fall after December 31: the pay date
   * plus this many days is in the next year. Semimonthly uses 16 so a stub dated the 16th closes the year
   * and one dated the 15th does not.
   */
  payPeriodDays: Object.freeze({ weekly: 7, biweekly: 14, semimonthly: 16, monthly: 31 }),
  /** With no pay frequency on the stub, the shortest regular period is assumed, so only a stub dated December 25 or later closes the year. */
  defaultPayPeriodDays: 7,
});

/** Order in which sources supply the recorded wage figure. */
export const WAGE_SOURCE_PRECEDENCE = Object.freeze(["irs_return_transcript", "irs_wage_income_transcript", "filed_return", "w2", "pay_stub"] as const);
export type WageSourceTier = (typeof WAGE_SOURCE_PRECEDENCE)[number];

/* ------------------------------------------------------------------------------------- evidence */

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";
/** Where the data came from: an uploaded document (`documents.id`) or a data rail (`rail_connections.id`). */
export type EvidenceOrigin = "document" | "rail";

interface EvidenceBase {
  sourceId: string;
  origin: EvidenceOrigin;
}

export interface W2Evidence extends EvidenceBase {
  kind: "w2";
  memberId: string;
  taxYear: number;
  employerName: string | null;
  /** Box 1: wages, tips, other compensation. */
  wagesCents: number;
  /** Box 5: Medicare wages and tips; null when it was not read. */
  medicareWagesCents: number | null;
}

export interface PayStubEvidence extends EvidenceBase {
  kind: "pay_stub";
  memberId: string;
  employerName: string | null;
  payDate: IsoDate;
  payFrequency: PayFrequency | null;
  /** Year-to-date gross pay printed on the stub; null when it was not read. */
  grossYtdCents: number | null;
  /** The stub itself says it is the final statement for the year or for the job. */
  markedFinal: boolean;
}

export type TaxRecordForm = "irs_return_transcript" | "irs_wage_income_transcript" | "filed_return";

/**
 * Income lines of a tax record other than wages. Pass the TOTAL amount received for pensions, IRA
 * distributions and Social Security (not the taxable part): 24 CFR 5.609 counts amounts received.
 */
export const TAX_RECORD_LINE_KEYS = [
  "taxable_interest",
  "tax_exempt_interest",
  "ordinary_dividends",
  "ira_distributions",
  "pensions_annuities",
  "social_security_benefits",
  "capital_gain",
  "business_income",
  "farm_income",
  "rental_royalty_partnership_income",
  "unemployment_compensation",
  "alimony_received",
  "other_income",
] as const;
export type TaxRecordLineKey = (typeof TAX_RECORD_LINE_KEYS)[number];

export interface TaxRecordLine {
  line: TaxRecordLineKey;
  amountCents: number;
}

/**
 * What the record says about income other than wages.
 *  - `none`: the income section was read and every other line is blank or zero.
 *  - `itemized`: every non-zero line is listed.
 *  - `not_read`: the other lines were not read. The engine does not assume they are empty.
 */
export type TaxRecordOtherIncome = { status: "none" } | { status: "itemized"; lines: TaxRecordLine[] } | { status: "not_read" };

export interface TaxRecordEvidence extends EvidenceBase {
  kind: "tax_record";
  form: TaxRecordForm;
  /** The person the record is for, or both spouses on a joint return. */
  memberIds: string[];
  taxYear: number;
  /** Total wages, salaries and tips as the record states them; null when the line was not read. */
  wagesCents: number | null;
  otherIncome: TaxRecordOtherIncome;
}

export type IncomeEvidence = W2Evidence | PayStubEvidence | TaxRecordEvidence;

interface TaxRecordLineRule {
  category: IncomeCategoryKey;
  label: string;
  /** The line cannot show whether the income counts, so nothing goes into the lower bound. */
  lowIsZero?: boolean;
  /** A negative amount on this line is a loss that is simply not income. */
  ignoreLoss?: boolean;
  /** A negative amount is meaningful (a net loss). */
  allowsLoss?: boolean;
  flag?: { code: IncomeFlagCode; severity: IncomeFlagSeverity; message: string };
}

/** How each tax-record line maps onto the income taxonomy. */
export const TAX_RECORD_LINES: Readonly<Record<TaxRecordLineKey, TaxRecordLineRule>> = Object.freeze({
  taxable_interest: { category: "interest_dividends", label: "Taxable interest" },
  tax_exempt_interest: { category: "interest_dividends", label: "Tax-exempt interest" },
  ordinary_dividends: { category: "interest_dividends", label: "Ordinary dividends" },
  ira_distributions: { category: "retirement_periodic_distributions", label: "IRA distributions (periodic or one-time is not shown on the record)", lowIsZero: true },
  pensions_annuities: { category: "pension_annuity", label: "Pensions and annuities" },
  social_security_benefits: { category: "social_security", label: "Social Security benefits" },
  capital_gain: { category: "realized_capital_gains", label: "Capital gain", ignoreLoss: true },
  business_income: { category: "self_employment_net", label: "Business income or loss", allowsLoss: true },
  farm_income: { category: "self_employment_net", label: "Farm income or loss", allowsLoss: true },
  rental_royalty_partnership_income: {
    category: "rental_income_net",
    label: "Rental real estate, royalties, partnerships, S corporations and trusts",
    allowsLoss: true,
    flag: {
      code: "schedule_e_income_needs_review",
      severity: "blocking",
      message:
        "A tax record shows income from rental real estate, royalties, partnerships, S corporations or trusts as one net figure. It mixes kinds of income that are treated differently and gross rents are not shown, so a reviewer must break it down.",
    },
  },
  unemployment_compensation: { category: "unemployment", label: "Unemployment compensation" },
  alimony_received: { category: "alimony_received", label: "Alimony received" },
  other_income: { category: "severance_strike_other", label: "Other income" },
});

/* -------------------------------------------------------------------------------------- results */

export type IgnoredEvidenceReason = "different_year" | "no_year_to_date_figure";

export interface IgnoredEvidence {
  sourceId: string;
  kind: IncomeEvidence["kind"];
  reason: IgnoredEvidenceReason;
  detail: string;
}

/** Where one wage item's figure came from, for the audit trail. */
export interface WageFinding {
  itemId: string;
  memberIds: string[];
  tier: WageSourceTier;
  /** Sources that supplied the recorded figure. */
  governingSourceIds: string[];
  /** Other sources about the same wages: compared, never added. */
  corroboratingSourceIds: string[];
  conflict: boolean;
}

export interface ReconciledIncome {
  incomeYear: number;
  /** Ready for `computeHouseholdIncome` and for storing as `income_items`. Ids are deterministic. */
  items: IncomeItemInput[];
  /** Pass to the decision service as `direct.evidenceFlags`. */
  flags: IncomeReviewFlag[];
  wages: WageFinding[];
  ignored: IgnoredEvidence[];
}

/* -------------------------------------------------------------------------------------- schemas */

const cents = z.number().int().min(0).max(MAX_AMOUNT_CENTS);
const base = { sourceId: idSchema, origin: z.enum(["document", "rail"]) };
const LOSS_LINES: ReadonlySet<TaxRecordLineKey> = new Set(TAX_RECORD_LINE_KEYS.filter((key) => TAX_RECORD_LINES[key].allowsLoss || TAX_RECORD_LINES[key].ignoreLoss));

const w2Schema = z.strictObject({
  ...base,
  kind: z.literal("w2"),
  memberId: idSchema,
  taxYear: incomeYearSchema,
  employerName: z.string().max(200).nullable(),
  wagesCents: cents,
  medicareWagesCents: cents.nullable(),
});

const payStubSchema = z.strictObject({
  ...base,
  kind: z.literal("pay_stub"),
  memberId: idSchema,
  employerName: z.string().max(200).nullable(),
  payDate: isoDateSchema,
  payFrequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]).nullable(),
  grossYtdCents: cents.nullable(),
  markedFinal: z.boolean(),
});

const taxRecordLineSchema = z
  .strictObject({ line: z.enum(TAX_RECORD_LINE_KEYS), amountCents: z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS) })
  .refine((entry) => entry.amountCents >= 0 || LOSS_LINES.has(entry.line), { path: ["amountCents"], message: "must not be negative for this line" });

const taxRecordSchema = z.strictObject({
  ...base,
  kind: z.literal("tax_record"),
  form: z.enum(["irs_return_transcript", "irs_wage_income_transcript", "filed_return"]),
  memberIds: z
    .array(idSchema)
    .min(1)
    .max(2)
    .refine((ids) => new Set(ids).size === ids.length, "must not repeat a member"),
  taxYear: incomeYearSchema,
  wagesCents: cents.nullable(),
  otherIncome: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("none") }),
    z.strictObject({ status: z.literal("itemized"), lines: z.array(taxRecordLineSchema).max(100) }),
    z.strictObject({ status: z.literal("not_read") }),
  ]),
});

const evidenceSchema: z.ZodType<IncomeEvidence> = z.discriminatedUnion("kind", [w2Schema, payStubSchema, taxRecordSchema]);
const reconcileInputSchema = z.strictObject({ incomeYear: incomeYearSchema, evidence: z.array(evidenceSchema).max(1000) });

/* ------------------------------------------------------------------------------------ pay stubs */

export type PayStubClass = "year_end" | "mid_year" | "other_year";

/**
 * Whether a pay stub can stand for the income year.
 *  - `other_year`: the pay date is not in the income year. Its year-to-date figure is about another year.
 *  - `year_end`: marked final, or the next regular pay date would fall after December 31.
 *  - `mid_year`: pay received so far; the rest of the year is unknown.
 */
export function classifyPayStub(stub: Pick<PayStubEvidence, "payDate" | "payFrequency" | "markedFinal">, incomeYear: number): PayStubClass {
  if (yearOf(stub.payDate) !== incomeYear) return "other_year";
  if (stub.markedFinal) return "year_end";
  const periodDays = stub.payFrequency ? RECONCILIATION_POLICY.payPeriodDays[stub.payFrequency] : RECONCILIATION_POLICY.defaultPayPeriodDays;
  return addDays(stub.payDate, periodDays) > lastDayOfYear(incomeYear) ? "year_end" : "mid_year";
}

/**
 * Straight-line projection of a year-to-date amount to the full calendar year, by days elapsed. Shown to a
 * reviewer next to a mid-year pay stub. The sources give no annualization method, so the engine never
 * decides on this number.
 */
export function projectAnnualFromYtd(ytdCents: number, throughDate: IsoDate): number {
  const year = yearOf(throughDate);
  return Number((BigInt(ytdCents) * BigInt(daysInYear(year))) / BigInt(dayOfYear(throughDate)));
}

interface StubInYear {
  stub: PayStubEvidence & { grossYtdCents: number };
  stubClass: Exclude<PayStubClass, "other_year">;
}

function employerKey(name: string | null): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The latest stub per employer: a later stub's year-to-date figure already contains the earlier ones. */
function latestPerEmployer(stubs: StubInYear[]): StubInYear[] {
  const latest = new Map<string, StubInYear>();
  for (const entry of stubs) {
    const key = employerKey(entry.stub.employerName);
    const current = latest.get(key);
    const newer =
      !current || entry.stub.payDate > current.stub.payDate || (entry.stub.payDate === current.stub.payDate && entry.stub.grossYtdCents > current.stub.grossYtdCents);
    if (newer) latest.set(key, entry);
  }
  return [...latest.values()].sort((a, b) => a.stub.sourceId.localeCompare(b.stub.sourceId));
}

/* ------------------------------------------------------------------------------------- internals */

const FORM_RANK: Record<TaxRecordForm, number> = { irs_return_transcript: 0, irs_wage_income_transcript: 1, filed_return: 2 };
const FORM_LABEL: Record<TaxRecordForm, string> = {
  irs_return_transcript: "IRS tax return transcript",
  irs_wage_income_transcript: "IRS wage and income transcript",
  filed_return: "tax return as filed",
};

function ranked<T extends TaxRecordEvidence>(records: T[]): T[] {
  return [...records].sort((a, b) => FORM_RANK[a.form] - FORM_RANK[b.form] || a.sourceId.localeCompare(b.sourceId));
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((memberId) => b.includes(memberId));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

type WagedRecord = TaxRecordEvidence & { wagesCents: number };

interface MemberWages {
  memberId: string;
  /** Null when no record or W-2 states this member's taxable wages. */
  figure: { tier: WageSourceTier; amountCents: number; lowCents: number; highCents: number; governingSourceIds: string[]; origin: EvidenceOrigin } | null;
  /** How far Medicare wages or year-end gross pay exceed the taxable wages of the same employment. */
  upliftCents: number;
  /** Sum of year-end gross pay across employers; null when any employer's latest stub is mid-year or there are no stubs. */
  yearEndGrossCents: number | null;
  latestStubs: StubInYear[];
  sourceIds: string[];
  conflicts: string[];
}

/* -------------------------------------------------------------------------------------- reconcile */

/**
 * Income items and review flags for one calendar year from extracted documents and rail data.
 *
 * Throws a `validation_failed` AppError for malformed input.
 */
export function reconcileIncomeEvidence(input: { incomeYear: number; evidence: IncomeEvidence[] }): ReconciledIncome {
  const { incomeYear, evidence } = parseInput(reconcileInputSchema, input, "income evidence");
  const tolerance = RECONCILIATION_POLICY.sameFigureToleranceCents;

  const ignored: IgnoredEvidence[] = [];
  const flags: IncomeReviewFlag[] = [];
  const items: IncomeItemInput[] = [];
  const wages: WageFinding[] = [];
  const w2s: W2Evidence[] = [];
  const records: TaxRecordEvidence[] = [];
  const stubs: Array<StubInYear & { memberId: string }> = [];

  for (const entry of evidence) {
    if (entry.kind === "pay_stub") {
      const stubClass = classifyPayStub(entry, incomeYear);
      if (stubClass === "other_year") {
        ignored.push({ sourceId: entry.sourceId, kind: entry.kind, reason: "different_year", detail: `Pay date ${entry.payDate} is not in ${incomeYear}.` });
      } else if (entry.grossYtdCents === null) {
        ignored.push({ sourceId: entry.sourceId, kind: entry.kind, reason: "no_year_to_date_figure", detail: "Year-to-date gross pay was not read from the pay stub." });
      } else {
        stubs.push({ stub: { ...entry, grossYtdCents: entry.grossYtdCents }, stubClass, memberId: entry.memberId });
      }
    } else if (entry.taxYear !== incomeYear) {
      ignored.push({ sourceId: entry.sourceId, kind: entry.kind, reason: "different_year", detail: `The document is for ${entry.taxYear}, not ${incomeYear}.` });
    } else if (entry.kind === "w2") {
      w2s.push(entry);
    } else {
      records.push(entry);
    }
  }

  const flag = (code: IncomeFlagCode, severity: IncomeFlagSeverity, message: string, memberIds: string[], sourceIds: string[], itemId: string | null = null): void => {
    flags.push({ code, severity, message, itemId, memberIds: [...memberIds], sourceIds: unique(sourceIds) });
  };
  const sourceFields = (origin: EvidenceOrigin, sourceId: string): Pick<IncomeItemInput, "source" | "documentId" | "railConnectionId"> =>
    origin === "rail" ? { source: "rail", documentId: null, railConnectionId: sourceId } : { source: "document", documentId: sourceId, railConnectionId: null };

  /* Units: a person alone, or the two spouses a joint record ties together. */
  const memberIds = unique([...w2s.map((w2) => w2.memberId), ...stubs.map((entry) => entry.memberId), ...records.flatMap((record) => record.memberIds)]).sort();
  const unitOf = new Map(memberIds.map((memberId) => [memberId, memberId]));
  const find = (memberId: string): string => {
    let root = memberId;
    while (unitOf.get(root) !== root) root = unitOf.get(root)!;
    return root;
  };
  for (const record of records) {
    for (const memberId of record.memberIds.slice(1)) unitOf.set(find(memberId), find(record.memberIds[0]));
  }
  const units = new Map<string, string[]>();
  for (const memberId of memberIds) units.set(find(memberId), [...(units.get(find(memberId)) ?? []), memberId]);

  const memberWages = (memberId: string): MemberWages => {
    const own = ranked(records.filter((record): record is WagedRecord => record.wagesCents !== null && sameMembers(record.memberIds, [memberId])));
    const memberW2s = w2s.filter((w2) => w2.memberId === memberId);
    const taxable = memberW2s.reduce((total, w2) => total + w2.wagesCents, 0);
    const medicare = memberW2s.reduce((total, w2) => total + Math.max(w2.wagesCents, w2.medicareWagesCents ?? w2.wagesCents), 0);
    const latestStubs = latestPerEmployer(stubs.filter((entry) => entry.memberId === memberId));
    const yearEndGrossCents =
      latestStubs.length > 0 && latestStubs.every((entry) => entry.stubClass === "year_end") ? latestStubs.reduce((total, entry) => total + entry.stub.grossYtdCents, 0) : null;
    const conflicts: string[] = [];

    let figure: MemberWages["figure"] = null;
    if (own.length > 0) {
      const amounts = own.map((record) => record.wagesCents);
      let highCents = Math.max(...amounts);
      const lowCents = Math.min(...amounts);
      if (highCents - lowCents > tolerance) {
        conflicts.push(`${own.map((record) => `${FORM_LABEL[record.form]} ${formatUsd(record.wagesCents)}`).join(" against ")}`);
      }
      if (memberW2s.length > 0 && taxable > own[0].wagesCents + tolerance) {
        conflicts.push(`Forms W-2 total ${formatUsd(taxable)}, more than the ${formatUsd(own[0].wagesCents)} on the ${FORM_LABEL[own[0].form]}`);
        highCents = Math.max(highCents, taxable);
      }
      figure = { tier: own[0].form, amountCents: own[0].wagesCents, lowCents, highCents, governingSourceIds: [own[0].sourceId], origin: own[0].origin };
    } else if (memberW2s.length > 0) {
      const sorted = [...memberW2s].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      figure = { tier: "w2", amountCents: taxable, lowCents: taxable, highCents: taxable, governingSourceIds: unique(sorted.map((w2) => w2.sourceId)), origin: sorted[0].origin };
    }

    const upliftBase = memberW2s.length > 0 ? taxable : (figure?.amountCents ?? 0);
    const grossLike = Math.max(memberW2s.length > 0 ? medicare : 0, yearEndGrossCents ?? 0);
    return {
      memberId,
      figure,
      upliftCents: figure ? Math.max(0, grossLike - upliftBase) : 0,
      yearEndGrossCents,
      latestStubs,
      sourceIds: unique([...own.map((record) => record.sourceId), ...memberW2s.map((w2) => w2.sourceId), ...latestStubs.map((entry) => entry.stub.sourceId)]),
      conflicts,
    };
  };

  const pushWageItem = (
    unit: string[],
    figure: NonNullable<MemberWages["figure"]>,
    highCents: number,
    allSourceIds: string[],
    conflicts: string[],
    description: string,
    lowCents: number = figure.lowCents,
  ): string => {
    const itemId = `wages:${unit.join("+")}`;
    items.push({
      id: itemId,
      memberId: unit[0],
      ...(unit.length > 1 ? { alsoCoversMemberIds: unit.slice(1) } : {}),
      category: "wages_salary",
      incomeYear,
      annualAmountCents: figure.amountCents,
      lowCents: Math.min(lowCents, figure.amountCents),
      highCents: Math.max(highCents, figure.amountCents),
      ...sourceFields(figure.origin, figure.governingSourceIds[0]),
      description,
    });
    wages.push({
      itemId,
      memberIds: [...unit],
      tier: figure.tier,
      governingSourceIds: figure.governingSourceIds,
      corroboratingSourceIds: unique(allSourceIds).filter((sourceId) => !figure.governingSourceIds.includes(sourceId)),
      conflict: conflicts.length > 0,
    });
    if (conflicts.length > 0) {
      flag(
        "income_figures_conflict",
        "blocking",
        `Documents for the same ${incomeYear} wages do not agree: ${conflicts.join("; ")}. The higher figure is in the upper bound of household income; a reviewer must settle which is right.`,
        unit,
        allSourceIds,
        itemId,
      );
    }
    return itemId;
  };

  const pushMemberWages = (picture: MemberWages): void => {
    if (picture.figure) {
      pushWageItem(
        [picture.memberId],
        picture.figure,
        picture.figure.highCents + picture.upliftCents,
        picture.sourceIds,
        picture.conflicts,
        picture.figure.tier === "w2" ? "Wages per Forms W-2 (box 1)" : `Wages per ${FORM_LABEL[picture.figure.tier as TaxRecordForm]}`,
      );
      return;
    }
    if (picture.latestStubs.length === 0) return;

    // Pay stubs only. Gross pay is the one figure known; taxable wages are not, so nothing is in the lower bound.
    const total = picture.latestStubs.reduce((sum, entry) => sum + entry.stub.grossYtdCents, 0);
    const first = picture.latestStubs[0].stub;
    const stubSourceIds = picture.latestStubs.map((entry) => entry.stub.sourceId);
    const itemId = pushWageItem(
      [picture.memberId],
      { tier: "pay_stub", amountCents: total, lowCents: 0, highCents: total, governingSourceIds: unique(stubSourceIds), origin: first.origin },
      total,
      picture.sourceIds,
      [],
      "Year-to-date gross pay per pay stub",
      0,
    );
    flag(
      "wages_from_pay_stub_only",
      "bounded",
      "Wages rest on a pay stub alone. Year-to-date gross pay is the upper figure; taxable wages (Form W-2 box 1) are not known, so the lower bound of household income leaves these wages out.",
      [picture.memberId],
      stubSourceIds,
      itemId,
    );
    for (const entry of picture.latestStubs.filter((candidate) => candidate.stubClass === "mid_year")) {
      flag(
        "pay_stub_projection_only",
        "blocking",
        `The latest pay stub on file is dated ${entry.stub.payDate} and does not close ${incomeYear}: it shows ${formatUsd(entry.stub.grossYtdCents)} of gross pay so far. ` +
          `A straight-line projection to the full year would be ${formatUsd(projectAnnualFromYtd(entry.stub.grossYtdCents, entry.stub.payDate))}; the projection is shown for the reviewer and is not used. ` +
          "A year-end pay stub, Form W-2, tax return or IRS transcript is needed, or a reviewer must decide.",
        [picture.memberId],
        [entry.stub.sourceId],
        itemId,
      );
    }
  };

  for (const unit of [...units.values()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const unitRecords = records.filter((record) => record.memberIds.some((memberId) => unit.includes(memberId)));
    const unitSourceIds = (): string[] => [
      ...unitRecords.map((record) => record.sourceId),
      ...w2s.filter((w2) => unit.includes(w2.memberId)).map((w2) => w2.sourceId),
      ...stubs.filter((entry) => unit.includes(entry.memberId)).map((entry) => entry.stub.sourceId),
    ];

    for (const record of unitRecords.filter((candidate) => candidate.wagesCents === null)) {
      flag("tax_record_incompletely_read", "blocking", `The wages line of a ${FORM_LABEL[record.form]} was not read. A reviewer must read it from the document.`, record.memberIds, [record.sourceId]);
    }
    const overlapping = unitRecords.filter((record) => record.memberIds.length > 1 && !sameMembers(record.memberIds, unit));
    if (overlapping.length > 0) {
      flag(
        "tax_records_overlap",
        "blocking",
        `Tax records for ${incomeYear} cover overlapping but different pairs of household members, so their figures cannot be reconciled automatically.`,
        unit,
        overlapping.map((record) => record.sourceId),
      );
    }

    /* Wages. */
    const pictures = unit.map(memberWages);
    const joint = unit.length > 1 ? ranked(unitRecords.filter((record): record is WagedRecord => record.wagesCents !== null && sameMembers(record.memberIds, unit))) : [];
    if (joint.length > 0) {
      const amounts = joint.map((record) => record.wagesCents);
      const governing = joint[0];
      let lowCents = Math.min(...amounts);
      let highCents = Math.max(...amounts);
      const conflicts = pictures.flatMap((picture) => picture.conflicts);
      if (highCents - lowCents > tolerance) conflicts.push(joint.map((record) => `${FORM_LABEL[record.form]} ${formatUsd(record.wagesCents)}`).join(" against "));

      const withFigure = pictures.filter((picture) => picture.figure !== null);
      const memberTotal = withFigure.reduce((total, picture) => total + picture.figure!.amountCents, 0);
      const memberHigh = withFigure.reduce((total, picture) => total + picture.figure!.highCents, 0);
      const eachHasOwnRecord = withFigure.length === unit.length && withFigure.every((picture) => picture.figure!.tier !== "w2");
      if (eachHasOwnRecord && Math.abs(memberTotal - governing.wagesCents) > tolerance) {
        conflicts.push(`each spouse's own record totals ${formatUsd(memberTotal)} against ${formatUsd(governing.wagesCents)} on the joint ${FORM_LABEL[governing.form]}`);
        lowCents = Math.min(lowCents, withFigure.reduce((total, picture) => total + picture.figure!.lowCents, 0));
        highCents = Math.max(highCents, memberHigh);
      } else if (!eachHasOwnRecord && memberHigh > governing.wagesCents + tolerance) {
        conflicts.push(`wage statements on file total ${formatUsd(memberHigh)}, more than the ${formatUsd(governing.wagesCents)} on the joint ${FORM_LABEL[governing.form]}`);
        highCents = Math.max(highCents, memberHigh);
      }

      const stubsOnly = withFigure.length === 0 && pictures.every((picture) => picture.yearEndGrossCents !== null);
      const upliftCents = stubsOnly
        ? Math.max(0, pictures.reduce((total, picture) => total + picture.yearEndGrossCents!, 0) - governing.wagesCents)
        : withFigure.reduce((total, picture) => total + picture.upliftCents, 0);

      pushWageItem(
        unit,
        { tier: governing.form, amountCents: governing.wagesCents, lowCents, highCents, governingSourceIds: [governing.sourceId], origin: governing.origin },
        highCents + upliftCents,
        unitSourceIds(),
        conflicts,
        `Wages per joint ${FORM_LABEL[governing.form]}`,
      );
    } else {
      pictures.forEach(pushMemberWages);
    }

    /* Other income lines, one set per distinct group of people a record covers. */
    const groups = new Map<string, TaxRecordEvidence[]>();
    for (const record of unitRecords) {
      const key = [...record.memberIds].sort().join("+");
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    const coveredByReturn = new Set(unitRecords.filter((record) => record.form !== "irs_wage_income_transcript" && record.otherIncome.status !== "not_read").flatMap((record) => record.memberIds));
    for (const [key, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const groupMembers = key.split("+");
      const returns = ranked(group.filter((record) => record.form !== "irs_wage_income_transcript"));
      // A return already reports the interest, benefits and other amounts a wage and income transcript lists for the same person.
      const candidates = returns.length > 0 ? returns : ranked(group).filter((record) => !record.memberIds.some((memberId) => coveredByReturn.has(memberId)));
      const readable = candidates.filter((record) => record.otherIncome.status !== "not_read");
      if (candidates.length > 0 && readable.length === 0) {
        flag(
          "tax_record_incompletely_read",
          "blocking",
          `Only part of a ${FORM_LABEL[candidates[0].form]} was read: its income lines other than wages are not known. A reviewer must read them from the document.`,
          groupMembers,
          candidates.map((record) => record.sourceId),
        );
        continue;
      }
      if (readable.length === 0) continue;

      const totals = readable.map((record) => {
        const byLine = new Map<TaxRecordLineKey, number>();
        if (record.otherIncome.status === "itemized") {
          for (const entry of record.otherIncome.lines) byLine.set(entry.line, (byLine.get(entry.line) ?? 0) + entry.amountCents);
        }
        return byLine;
      });
      for (const lineKey of TAX_RECORD_LINE_KEYS) {
        if (!totals.some((byLine) => byLine.has(lineKey))) continue;
        const rule = TAX_RECORD_LINES[lineKey];
        const amounts = totals.map((byLine) => byLine.get(lineKey) ?? 0);
        const recorded = amounts[0];
        const lowest = Math.min(...amounts);
        const highest = Math.max(...amounts);
        if (rule.ignoreLoss && highest <= 0) continue;

        const itemId = `${lineKey}:${key}`;
        const amountCents = rule.ignoreLoss ? Math.max(0, recorded) : recorded;
        items.push({
          id: itemId,
          memberId: groupMembers[0],
          ...(groupMembers.length > 1 ? { alsoCoversMemberIds: groupMembers.slice(1) } : {}),
          category: rule.category,
          incomeYear,
          annualAmountCents: amountCents,
          lowCents: rule.lowIsZero ? Math.min(0, lowest) : Math.min(amountCents, rule.ignoreLoss ? Math.max(0, lowest) : lowest),
          highCents: Math.max(amountCents, highest),
          ...sourceFields(readable[0].origin, readable[0].sourceId),
          description: `${rule.label} per ${FORM_LABEL[readable[0].form]}`,
        });
        if (highest - lowest > tolerance) {
          flag(
            "income_figures_conflict",
            "blocking",
            `Tax records for ${incomeYear} do not agree on "${rule.label}": ${readable.map((record, index) => `${FORM_LABEL[record.form]} ${formatUsd(amounts[index])}`).join(" against ")}. A reviewer must settle which is right.`,
            groupMembers,
            readable.map((record) => record.sourceId),
            itemId,
          );
        }
        if (rule.flag) flag(rule.flag.code, rule.flag.severity, rule.flag.message, groupMembers, [readable[0].sourceId], itemId);
      }
    }
  }

  return { incomeYear, items, flags, wages, ignored };
}
