/**
 * SYNTHETIC document generator for tests, demos and end-to-end runs.
 *
 * Every document carries "SYNTHETIC SAMPLE — NOT A REAL DOCUMENT" at the top and bottom of every page (in the
 * text layer, in red) plus a diagonal watermark, no seals or logos (a grey "LOGO OMITTED" box), no
 * signatures ("[signature omitted]"), fictional people, never-issued SSNs (000-00-xxxx), case numbers
 * 9990000001-9990000009 and EIN 00-000000x (reference "Rules for every fixture"). Layouts whose wording is
 * not verified carry a second line, "Layout is a test invention, not a copy of an agency form".
 *
 * Output is deterministic: fixed metadata dates, no random ids. Dates are taken as parameters (pure).
 */
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCents } from "./money";
import { renderTextPng } from "./synthetic-raster";
import type { BenefitProgram, IsoDate } from "./types";

export const SYNTHETIC_BANNER_TEXT = "SYNTHETIC SAMPLE — NOT A REAL DOCUMENT";
export const SYNTHETIC_INVENTED_LAYOUT_TEXT = "Layout is a test invention, not a copy of an agency form";
/** Fixed metadata date so regenerated files are byte-identical. */
export const SYNTHETIC_METADATA_DATE = "2026-11-18T00:00:00.000Z";

const PAGE: [number, number] = [612, 792];
const RED = rgb(0.75, 0.05, 0.05);
const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.55, 0.55, 0.55);

/* ------------------------------------------------------------------------------- formatting */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];

function parts(d: IsoDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new RangeError(`Not an ISO date: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
/** 09/15/2026 (HHSC, HUD). */
export const mdy = (d: IsoDate) => {
  const [y, m, day] = parts(d);
  return `${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}/${y}`;
};
/** 09-15-2026 (IRS transcripts). */
const mdyDash = (d: IsoDate) => mdy(d).replace(/\//g, "-");
/** September 15, 2026 (SSA). */
export const longDate = (d: IsoDate) => {
  const [y, m, day] = parts(d);
  return `${MONTH_NAMES[m - 1]} ${day}, ${y}`;
};
/** Sep. 15, 2026 (IRS transcript tax period). */
const abbrDate = (d: IsoDate) => {
  const [y, m, day] = parts(d);
  return `${MONTH_ABBR[m - 1]} ${day}, ${y}`;
};
const monthYear = (d: IsoDate) => {
  const [y, m] = parts(d);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};
/** 41,250 (Form 1040 whole dollars). */
const dollars = (cents: number) => Math.round(cents / 100).toLocaleString("en-US");
/** 41250.00 (W-2 boxes). */
const plain = (cents: number) => (cents / 100).toFixed(2);

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/* ------------------------------------------------------------------------------------ sheet */

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  mono?: boolean;
  color?: ReturnType<typeof rgb>;
}

class Sheet {
  constructor(
    readonly page: PDFPage,
    private readonly fonts: Fonts,
  ) {}

  text(x: number, y: number, s: string, o: TextOpts = {}): void {
    const font = o.mono ? this.fonts.mono : o.bold ? this.fonts.bold : this.fonts.regular;
    this.page.drawText(s, { x, y, size: o.size ?? 10, font, color: o.color ?? BLACK });
  }

  /** Wrapped paragraph; returns the baseline below the last line. */
  para(x: number, y: number, s: string, o: TextOpts & { max?: number; leading?: number } = {}): number {
    const leading = o.leading ?? (o.size ?? 10) + 3;
    let yy = y;
    for (const line of wrap(s, o.max ?? 90)) {
      this.text(x, yy, line, o);
      yy -= leading;
    }
    return yy;
  }

  logoBox(x: number, y: number): void {
    this.page.drawRectangle({ x, y, width: 90, height: 34, color: rgb(0.85, 0.85, 0.85) });
    this.text(x + 12, y + 13, "LOGO OMITTED", { size: 8, color: GREY });
  }
}

interface Pdf {
  doc: PDFDocument;
  fonts: Fonts;
  invented: boolean;
}

async function newPdf(title: string, invented: boolean): Promise<Pdf> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fixed = new Date(SYNTHETIC_METADATA_DATE);
  doc.setTitle(`SYNTHETIC ${title}`);
  doc.setAuthor("Passport synthetic fixture generator");
  doc.setSubject(SYNTHETIC_BANNER_TEXT);
  doc.setProducer("Passport synthetic fixture generator");
  doc.setCreator("Passport synthetic fixture generator");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  return { doc, fonts, invented };
}

function addPage(pdf: Pdf): Sheet {
  const page = pdf.doc.addPage(PAGE);
  const sheet = new Sheet(page, pdf.fonts);
  sheet.text(50, 772, SYNTHETIC_BANNER_TEXT, { size: 9, bold: true, color: RED });
  if (pdf.invented) sheet.text(50, 761, SYNTHETIC_INVENTED_LAYOUT_TEXT, { size: 7.5, color: RED });
  sheet.text(50, 14, SYNTHETIC_BANNER_TEXT, { size: 9, bold: true, color: RED });
  page.drawText(SYNTHETIC_BANNER_TEXT, { x: 70, y: 180, size: 30, font: pdf.fonts.bold, color: RED, opacity: 0.12, rotate: degrees(35) });
  return sheet;
}

async function save(pdf: Pdf): Promise<Uint8Array> {
  return pdf.doc.save({ useObjectStreams: false });
}

function addressBlock(s: Sheet, x: number, y: number, name: string, address: SyntheticAddress = DEFAULT_ADDRESS): number {
  s.text(x, y, name);
  s.text(x, y - 12, address.street);
  s.text(x, y - 24, address.cityStateZip);
  return y - 24;
}

/* --------------------------------------------------------------------------------- params */

export interface SyntheticAddress {
  street: string;
  cityStateZip: string;
}
export const DEFAULT_ADDRESS: SyntheticAddress = { street: "100 FIXTURE LANE", cityStateZip: "HOUSTON TX 77002" };

export interface Tf0001Row {
  name: string;
  edg: string;
  program: string;
  /** ISO start date; `end` makes it a range printed over two lines. */
  start: IsoDate;
  end?: IsoDate | null;
}
export interface Tf0001Table {
  status: "gets" | "cant_get";
  /** e.g. "SNAP food benefits" → "Who gets SNAP food benefits". */
  subject: string;
  rows: Tf0001Row[];
  reason?: string;
}
export interface Tf0001Params {
  noticeDate: IsoDate;
  /** Printed instead of `noticeDate` (to test ambiguous or malformed dates). */
  noticeDateText?: string;
  caseNumber: string;
  addressee: string;
  address?: SyntheticAddress;
  sections: Array<{ heading: string; tables: Tf0001Table[]; notes?: string }>;
  /** false: only the boilerplate and appeal pages (the household uploaded the wrong pages). */
  includeDecisionPage?: boolean;
  /** Invented Spanish wording on page 1 (B11: the Spanish TF0001 text is not in the sources). */
  spanish?: boolean;
}

export interface BenefitVerificationParams {
  date: IsoDate;
  addressee: string;
  address?: SyntheticAddress;
  socialSecurity?: { beginning: IsoDate; amountCents: number; type: "disability" | "retirement" | "survivors" };
  ssi?: { beginning: IsoDate; amountCents: number | null; type: string };
  noBenefits?: boolean;
}

export interface SsaNoticeParams {
  program: "Supplemental Security Income" | "Retirement, Survivors, and Disability Insurance";
  subject: string;
  date: IsoDate;
  addressee: string;
  address?: SyntheticAddress;
  claimSuffix: string;
  typeHeading: "Type of Payment" | "Type of Claim";
  typeValue: string;
  body: string[];
  captions?: string[];
  monthlyAmountCents?: number | null;
  formNumber: string;
}

export interface WicVocParams {
  participant: string;
  dateOfBirth: IsoDate;
  certificationStart: IsoDate;
  certificationEnd: IsoDate;
  incomeDetermined: IsoDate;
  vocId: string;
}

export interface VoucherParams {
  voucherNumber: string;
  issueDate: IsoDate;
  expirationDate: IsoDate;
  extensionExpires?: IsoDate | null;
  familyRepresentative: string;
  bedrooms: number;
}

export interface Hud50058Params {
  programCode: string;
  actionCode: number;
  effectiveDate: IsoDate;
  nextReexam?: IsoDate | null;
  headOfHousehold: string;
  hapToOwnerCents: number;
  tenantRentCents: number;
}

export interface PhaNoticeParams {
  date: IsoDate;
  headOfHousehold: string;
  effectiveDate: IsoDate;
  nextReexam: IsoDate;
  contractRentCents: number;
  hapCents: number;
  tenantRentCents: number;
}

export interface W2Statement {
  taxYear: number;
  copy: "B" | "C" | "2";
  employeeSsn: string;
  employerEin: string;
  employerName: string;
  employerAddress: SyntheticAddress;
  controlNumber: string;
  employeeFirst: string;
  employeeLast: string;
  box1Cents: number;
  box2Cents: number;
  box3Cents: number;
  box4Cents: number;
  box5Cents: number;
  box6Cents: number;
  box12?: Array<{ letter: "a" | "b" | "c" | "d"; code: string; amountCents: number }>;
}

export interface Form1040Params {
  taxYear: number;
  filingStatus: "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_surviving_spouse";
  filer: { first: string; last: string; ssn: string };
  spouse?: { first: string; last: string; ssn: string } | null;
  dependents: Array<{ first: string; last: string; ssn: string; relationship: string }>;
  /** Whole-dollar amounts in cents, keyed by line id ("1a", "1z", "2b", "9", "10", "11a", "11b"...). */
  lines: Record<string, number>;
  scheduleC?: { business: string; netProfitCents: number } | null;
}

export interface TranscriptParams {
  requestDate: IsoDate;
  taxPeriodEnding: IsoDate;
  ssnLast4: string;
  namesShown: string;
  filingStatus: string;
  /** Label → cents, printed in order. */
  items: Array<[string, number]>;
  noRecord?: boolean;
}

export interface WageIncomeTranscriptParams {
  requestDate: IsoDate;
  taxYear: number;
  taxpayer: string;
  ssn: string;
  forms: Array<{ form: "W-2"; employer: string; ein: string; wagesCents: number }>;
}

export interface NonfilingParams {
  date: IsoDate;
  taxYear: number;
  taxpayer: string;
  version: "no_record" | "not_honored";
}

export interface PayStubParams {
  employer: string;
  employee: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payDate: IsoDate;
  hours: string;
  rate: string;
  grossCurrentCents: number;
  grossYtdCents: number;
  deductionsCurrentCents: number;
  deductionsYtdCents: number;
  netCurrentCents: number;
  netYtdCents: number;
}

export interface LetterParams {
  /** Header lines (letterhead). */
  letterhead: string[];
  date?: IsoDate | null;
  addressee?: string | null;
  title: string;
  paragraphs: string[];
  footer?: string;
  invented?: boolean;
}

export interface ImageParams {
  lines: string[];
}

export interface SyntheticParamsByKind {
  tf0001: Tf0001Params;
  ssa_benefit_verification: BenefitVerificationParams;
  ssa_notice: SsaNoticeParams;
  wic_voc: WicVocParams;
  hud_52646: VoucherParams;
  hud_50058: Hud50058Params;
  pha_notice: PhaNoticeParams;
  w2: { statements: W2Statement[] };
  form_1040: Form1040Params;
  irs_tax_return_transcript: TranscriptParams;
  irs_wage_income_transcript: WageIncomeTranscriptParams;
  irs_nonfiling: NonfilingParams;
  pay_stub: PayStubParams;
  letter: LetterParams;
  image_png: ImageParams;
  image_only_pdf: ImageParams;
  corrupt_pdf: { seed: number };
}
export type SyntheticKind = keyof SyntheticParamsByKind;

/* ------------------------------------------------------------------------------- templates */

async function tf0001(p: Tf0001Params): Promise<Uint8Array> {
  const pdf = await newPdf("Texas HHSC Form TF0001 Notice of Case Action", true);
  const total = p.includeDecisionPage === false ? 2 : 3;
  let pageNo = 0;
  const footer = (s: Sheet, appeal = false) => {
    pageNo++;
    s.text(50, 45, appeal ? "Form TF0001 Appeal" : "Form TF0001", { size: 8 });
    s.text(50, 35, appeal ? "07/2026" : "06/2026", { size: 8 });
    s.text(480, 45, `Page ${pageNo} of ${total}`, { size: 8 });
  };

  if (p.includeDecisionPage !== false) {
    const s = addPage(pdf);
    const es = p.spanish === true;
    s.text(50, 730, "TEXAS HEALTH AND HUMAN SERVICES COMMISSION", { bold: true, size: 9 });
    s.text(50, 718, "P O BOX 149029", { size: 9 });
    s.text(50, 706, "AUSTIN, TEXAS 78714-9029", { size: 9 });
    s.logoBox(470, 700);
    s.text(50, 680, `${es ? "Fecha" : "Date"}: ${p.noticeDateText ?? mdy(p.noticeDate)}`);
    s.text(330, 680, es ? "¿Necesita ayuda?" : "Need help?");
    s.text(50, 666, `${es ? "Número de caso" : "Case Number"}: ${p.caseNumber}`);
    s.text(330, 666, es ? "Llame al 2-1-1 o al 1-877-541-7905" : "Call 2-1-1 or 1-877-541-7905");
    addressBlock(s, 330, 630, p.addressee, p.address);
    s.text(50, 570, es ? "Aviso sobre su caso:" : "Notice about your case:", { bold: true, size: 14 });
    let y = 545;
    for (const section of p.sections) {
      s.text(50, y, section.heading, { bold: true, size: 11 });
      y -= 18;
      for (const table of section.tables) {
        const title = es
          ? `${table.status === "gets" ? "Quién recibe" : "Quién no puede recibir"} ${table.subject}`
          : `${table.status === "gets" ? "Who gets" : "Who can’t get"} ${table.subject}`;
        s.text(60, y, title, { bold: true });
        y -= 16;
        const cols = es ? ["Nombre", "Número EDG", "Programa", "Fecha"] : ["Name", "EDG number", "Program", "Date"];
        [70, 210, 330, 430].forEach((x, i) => s.text(x, y, cols[i], { bold: true, size: 9 }));
        y -= 22;
        for (const row of table.rows) {
          s.text(70, y, row.name, { size: 9 });
          s.text(210, y, row.edg, { size: 9 });
          s.text(330, y, row.program, { size: 9 });
          if (row.end) {
            s.text(430, y + 6, `${mdy(row.start)} -`, { size: 9 });
            s.text(430, y - 6, mdy(row.end), { size: 9 });
          } else s.text(430, y, mdy(row.start), { size: 9 });
          y -= 28;
        }
        if (table.reason) {
          s.text(60, y, es ? "Razón:" : "Reason:", { bold: true, size: 9 });
          y = s.para(110, y, table.reason, { size: 9, max: 85 }) - 6;
        }
      }
      if (section.notes) {
        s.text(60, y, es ? "Notas:" : "Notes:", { bold: true, size: 9 });
        y = s.para(110, y, section.notes, { size: 9, max: 85 }) - 6;
      }
      y -= 8;
    }
    if (es) {
      s.para(50, Math.min(y, 150), "Usted tiene derecho a pedir una audiencia. Para más ayuda sobre su caso y sus beneficios llame al 2-1-1. Los beneficios de comida de su caso se depositan en su tarjeta.", { size: 9 });
    }
    footer(s);
  }

  const b = addPage(pdf);
  let y = b.para(50, 720, "Other help you can get and your rights:", { bold: true, size: 12 }) - 6;
  for (const para of [
    "For help or questions about your Lone Star Card, call the number on the back of the card.",
    "Women who can't get Medicaid or CHIP: you may be able to get services through other programs. Ask us about them.",
    "If you are applying for SNAP or get SNAP and you have been treated unfairly, you can file a complaint.",
    "You may need to send pay stubs or other proof if your household changes. We may stop benefits if we do not get what we need.",
  ]) {
    y = b.para(50, y, para, { size: 9 }) - 8;
  }
  footer(b);

  const a = addPage(pdf);
  a.text(50, 720, "Your right to appeal:", { bold: true, size: 12 });
  y = a.para(50, 700, "If you want a hearing, you must ask for it within 90 days of the date of this letter or the start date of the action. To keep getting benefits while you appeal, ask within 13 days of the date of this letter.", { size: 9 });
  a.text(50, y - 10, "Legal help (fictional office):", { size: 9 });
  addressBlock(a, 50, y - 24, "EXAMPLE LEGAL AID OFFICE", { street: "200 SAMPLE STREET", cityStateZip: "AUSTIN TX 78701" });
  footer(a, true);
  return save(pdf);
}

async function benefitVerification(p: BenefitVerificationParams): Promise<Uint8Array> {
  const pdf = await newPdf("SSA Benefit Verification Letter", p.ssi?.type.includes("child") === true);
  const s = addPage(pdf);
  s.text(50, 730, "Social Security Administration", { bold: true, size: 12 });
  s.text(50, 714, "Benefit Verification Letter", { bold: true, size: 12 });
  s.text(380, 690, `Date: ${longDate(p.date)}`);
  s.text(380, 676, "BNC#: 00SYN0000001");
  addressBlock(s, 50, 640, p.addressee, p.address);
  let y = 585;
  if (p.noBenefits) {
    y = s.para(50, y, "You asked us to verify whether you have received benefits from us. This letter verifies that:") - 6;
    y = s.para(60, y, "- You do not receive benefits now and have not received benefits in the past.") - 2;
    y = s.para(60, y, "- You do not have a pending claim for benefits.") - 10;
  } else {
    y = s.para(50, y, "You asked us for information from your record. The information that you requested is shown below.") - 10;
    if (p.socialSecurity) {
      s.text(50, y, "Information About Current Social Security Benefits", { bold: true });
      y = s.para(50, y - 14, `Beginning ${monthYear(p.socialSecurity.beginning)}, the full monthly Social Security benefit before any deductions is ${formatCents(p.socialSecurity.amountCents)}.`) - 8;
      s.text(50, y, "Type of Social Security Benefit Information", { bold: true });
      y = s.para(50, y - 14, `You are entitled to monthly ${p.socialSecurity.type} benefits.`) - 10;
    }
    if (p.ssi) {
      s.text(50, y, "Information About Supplemental Security Income Payments", { bold: true });
      if (p.ssi.amountCents !== null) {
        y = s.para(50, y - 14, `Beginning ${monthYear(p.ssi.beginning)}, the current Supplemental Security Income payment is ${formatCents(p.ssi.amountCents)}.`) - 8;
      } else y -= 22;
      s.text(50, y, "Type of Supplemental Security Income Payment Information", { bold: true });
      y = s.para(50, y - 14, `You are entitled to monthly payments as ${p.ssi.type}.`) - 10;
    }
  }
  s.text(50, y, "If You Have Questions", { bold: true });
  s.para(50, y - 14, "Call the national toll-free number shown on the agency's website. This sample lists no real telephone number.");
  return save(pdf);
}

async function ssaNotice(p: SsaNoticeParams): Promise<Uint8Array> {
  const pdf = await newPdf(`SSA notice ${p.formNumber}`, /Award/i.test(p.subject));
  const s = addPage(pdf);
  s.text(50, 730, "Social Security Administration", { bold: true, size: 12 });
  s.text(50, 716, p.program, { bold: true, size: 11 });
  s.text(50, 702, p.subject, { bold: true, size: 11 });
  s.text(380, 680, `Date: ${longDate(p.date)}`);
  s.text(380, 666, `Claim Number: 000-00-0001 ${p.claimSuffix}`);
  addressBlock(s, 50, 640, p.addressee, p.address);
  s.text(380, 600, p.typeHeading, { bold: true });
  s.text(380, 588, p.typeValue);
  let y = 560;
  for (const para of p.body) y = s.para(50, y, para) - 8;
  for (const caption of p.captions ?? []) {
    s.text(50, y, caption, { bold: true });
    y -= 16;
  }
  if (p.monthlyAmountCents != null) {
    y = s.para(50, y, `Your regular monthly check of ${formatCents(p.monthlyAmountCents)} will be sent to you about the first day of the month.`) - 8;
  }
  s.text(50, 45, p.formNumber, { size: 8 });
  return save(pdf);
}

async function wicVoc(p: WicVocParams): Promise<Uint8Array> {
  const pdf = await newPdf("WIC Verification of Certification", true);
  const s = addPage(pdf);
  s.text(50, 730, "Texas WIC", { bold: true, size: 13 });
  s.text(50, 714, "Verification of Certification (VOC)", { bold: true, size: 12 });
  s.logoBox(470, 705);
  const rows: Array<[string, string]> = [
    ["Participant Name:", p.participant],
    ["Date of Birth:", mdy(p.dateOfBirth)],
    ["Certification Start Date:", mdy(p.certificationStart)],
    ["Certification End Date:", mdy(p.certificationEnd)],
    ["Date Income Eligibility Determined:", mdy(p.incomeDetermined)],
    ["Risk Codes:", "000"],
    ["Local Agency:", "Sample County WIC Clinic 000 (fictional)"],
    ["Local Agency Address:", "300 Sample Road, Houston, TX 77002"],
    ["Certifying Official:", "[signature omitted]"],
    ["VOC ID:", p.vocId],
  ];
  let y = 670;
  for (const [label, value] of rows) {
    s.text(50, y, `${label} ${value}`);
    y -= 18;
  }
  s.para(50, y - 10, "This verification is valid until the certification end date shown above.");
  return save(pdf);
}

async function voucher(p: VoucherParams): Promise<Uint8Array> {
  const pdf = await newPdf("HUD-52646 Housing Choice Voucher", false);
  const s = addPage(pdf);
  s.text(50, 735, "Voucher", { bold: true, size: 14 });
  s.text(50, 720, "Housing Choice Voucher Program", { bold: true });
  s.text(330, 735, "U.S. Department of Housing and Urban Development", { size: 8 });
  s.text(330, 724, "Office of Public and Indian Housing", { size: 8 });
  const boxes: Array<[string, string]> = [
    ["1. Voucher Number", p.voucherNumber],
    ["2. Issue Date (mm/dd/yyyy)", mdy(p.issueDate)],
    ["3. Expiration Date (mm/dd/yyyy) (At least sixty days after date voucher is issued.)", mdy(p.expirationDate)],
    ["4. Date Extension Expires (if applicable) (mm/dd/yyyy)", p.extensionExpires ? mdy(p.extensionExpires) : ""],
    ["5. Name of Family Representative", p.familyRepresentative],
    ["6. Signature of Family Representative", "[signature omitted]"],
    ["7. Name of Public Housing Agency (PHA)", "Example City Housing Authority (fictional)"],
    ["8. Name and Title of PHA Official", "[name omitted]"],
    ["9. Unit size (number of bedrooms)", String(p.bedrooms)],
  ];
  let y = 690;
  for (const [label, value] of boxes) {
    s.text(50, y, label, { size: 8 });
    if (value) s.text(50, y - 12, value);
    y -= 34;
  }
  s.text(50, 45, "form HUD-52646 (10/2026)", { size: 8 });
  return save(pdf);
}

async function hud50058(p: Hud50058Params): Promise<Uint8Array> {
  const pdf = await newPdf("HUD-50058 Family Report extract", false);
  const s = addPage(pdf);
  s.text(50, 735, "Family Report", { bold: true, size: 14 });
  s.text(330, 735, "U.S. Department of Housing and Urban Development", { size: 8 });
  const rows = [
    "1a. Agency name: Example City Housing Authority (fictional)",
    `1c. Program: ${p.programCode}`,
    `2a. Type of action: ${p.actionCode}`,
    `2b. Effective date (mm/dd/yyyy) of action: ${mdy(p.effectiveDate)}`,
    `2i. Projected effective date (mm/dd/yyyy) of next reexamination: ${p.nextReexam ? mdy(p.nextReexam) : ""}`,
    `Head of household: ${p.headOfHousehold}`,
    "3n. Social security number: 000-00-0001",
    `12u. HAP to owner: ${formatCents(p.hapToOwnerCents)}`,
    `12v. Tenant rent to owner: ${formatCents(p.tenantRentCents)}`,
  ];
  let y = 700;
  for (const r of rows) {
    s.text(50, y, r.trimEnd());
    y -= 20;
  }
  s.text(50, 45, "form HUD-50058 (11/2013)", { size: 8 });
  return save(pdf);
}

async function phaNotice(p: PhaNoticeParams): Promise<Uint8Array> {
  const pdf = await newPdf("PHA rent notice", true);
  const s = addPage(pdf);
  s.text(50, 730, "Example City Housing Authority (fictional)", { bold: true, size: 12 });
  s.text(50, 716, "Housing Choice Voucher Program", { size: 10 });
  s.logoBox(470, 705);
  s.text(50, 690, `Date: ${mdy(p.date)}`);
  addressBlock(s, 50, 660, p.headOfHousehold);
  s.text(50, 610, "Notice of Rent Change", { bold: true, size: 12 });
  const rows: Array<[string, string]> = [
    ["Head of Household:", p.headOfHousehold],
    ["Unit Address:", "100 Fixture Lane, Houston, TX 77002"],
    ["Reexamination Type:", "Annual"],
    ["Effective Date:", mdy(p.effectiveDate)],
    ["Contract Rent:", formatCents(p.contractRentCents)],
    ["HAP to Owner:", formatCents(p.hapCents)],
    ["Tenant Rent:", formatCents(p.tenantRentCents)],
    ["Next Reexamination:", mdy(p.nextReexam)],
  ];
  let y = 585;
  for (const [l, v] of rows) {
    s.text(50, y, `${l} ${v}`);
    y -= 18;
  }
  return save(pdf);
}

async function w2(statements: W2Statement[]): Promise<Uint8Array> {
  const pdf = await newPdf("Form W-2 Wage and Tax Statement", false);
  for (const st of statements) {
    const s = addPage(pdf);
    const L = (x: number, y: number, t: string) => s.text(x, y, t, { size: 7 });
    const V = (x: number, y: number, t: string) => s.text(x, y, t, { size: 9 });
    L(50, 700, "a Employee’s social security number");
    V(50, 688, st.employeeSsn);
    L(250, 700, "OMB No. 1545-0029");
    L(50, 670, "b Employer identification number (EIN)");
    L(300, 670, "1 Wages, tips, other compensation");
    L(450, 670, "2 Federal income tax withheld");
    V(50, 658, st.employerEin);
    V(300, 658, plain(st.box1Cents));
    V(450, 658, plain(st.box2Cents));
    L(50, 640, "c Employer’s name, address, and ZIP code");
    L(300, 640, "3 Social security wages");
    L(450, 640, "4 Social security tax withheld");
    V(50, 628, st.employerName);
    V(300, 628, plain(st.box3Cents));
    V(450, 628, plain(st.box4Cents));
    V(50, 616, st.employerAddress.street);
    V(50, 604, st.employerAddress.cityStateZip);
    L(300, 590, "5 Medicare wages and tips");
    L(450, 590, "6 Medicare tax withheld");
    V(300, 578, plain(st.box5Cents));
    V(450, 578, plain(st.box6Cents));
    L(50, 560, "d Control number");
    L(300, 560, "7 Social security tips");
    L(450, 560, "8 Allocated tips");
    V(50, 548, st.controlNumber);
    L(50, 530, "e Employee’s first name and initial");
    L(190, 530, "Last name");
    L(260, 530, "Suff.");
    L(300, 530, "9");
    L(450, 530, "10 Dependent care benefits");
    V(50, 518, st.employeeFirst);
    V(190, 518, st.employeeLast);
    L(50, 500, "f Employee’s address and ZIP code");
    L(300, 500, "11 Nonqualified plans");
    V(50, 488, DEFAULT_ADDRESS.street);
    V(50, 476, DEFAULT_ADDRESS.cityStateZip);
    const letters = ["a", "b", "c", "d"] as const;
    letters.forEach((letter, i) => {
      const y = 500 - i * 30;
      L(450, y, `12${letter} See instructions for box 12`);
      const entry = st.box12?.find((e) => e.letter === letter);
      if (entry) {
        V(450, y - 12, entry.code);
        V(480, y - 12, plain(entry.amountCents));
      }
    });
    L(300, 470, "13 Statutory employee   Retirement plan   Third-party sick pay");
    if (st.taxYear >= 2026) {
      L(300, 440, "14a Other");
      L(300, 410, "14b Treasury Tipped Occupation Code(s)");
    } else L(300, 440, "14 Other");
    L(50, 380, "15 State   Employer’s state ID number");
    L(200, 380, "16 State wages, tips, etc.");
    L(320, 380, "17 State income tax");
    L(420, 380, "18 Local wages, tips, etc.");
    L(50, 360, "19 Local income tax");
    L(200, 360, "20 Locality name");
    s.text(50, 320, `Form W-2 Wage and Tax Statement ${st.taxYear}`, { bold: true, size: 12 });
    s.text(330, 320, "Department of the Treasury—Internal Revenue Service", { size: 8 });
    const copyLine =
      st.copy === "B"
        ? "Copy B—To Be Filed With Employee’s FEDERAL Tax Return."
        : st.copy === "C"
          ? "Copy C—For EMPLOYEE’S RECORDS"
          : "Copy 2—To Be Filed With Employee’s State, City, or Local Income Tax Return";
    s.text(50, 305, copyLine, { size: 8 });
  }
  return save(pdf);
}

const STATUS_LABELS: Record<Form1040Params["filingStatus"], string> = {
  single: "Single",
  married_filing_jointly: "Married filing jointly (even if only one had income)",
  married_filing_separately: "Married filing separately (MFS)",
  head_of_household: "Head of household (HOH)",
  qualifying_surviving_spouse: "Qualifying surviving spouse (QSS)",
};

async function form1040(p: Form1040Params): Promise<Uint8Array> {
  const pdf = await newPdf(`Form 1040 ${p.taxYear}`, false);
  const s = addPage(pdf);
  s.text(50, 740, `1040 U.S. Individual Income Tax Return ${p.taxYear}`, { bold: true, size: 12 });
  s.text(420, 740, "OMB No. 1545-0074", { size: 8 });
  s.text(50, 726, "Department of the Treasury—Internal Revenue Service", { size: 8 });
  s.text(50, 712, "Filing Status", { bold: true, size: 9 });
  let y = 700;
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    s.text(60, y, `${key === p.filingStatus ? "[X]" : "[ ]"} ${label}`, { size: 8 });
    y -= 11;
  }
  const L = (x: number, yy: number, t: string) => s.text(x, yy, t, { size: 7 });
  const V = (x: number, yy: number, t: string) => s.text(x, yy, t, { size: 9 });
  L(50, 640, "Your first name and middle initial");
  L(250, 640, "Last name");
  L(430, 640, "Your social security number");
  V(50, 628, p.filer.first);
  V(250, 628, p.filer.last);
  V(430, 628, p.filer.ssn);
  L(50, 610, "If joint return, spouse’s first name and middle initial");
  L(250, 610, "Last name");
  L(430, 610, "Spouse’s social security number");
  if (p.spouse) {
    V(50, 598, p.spouse.first);
    V(250, 598, p.spouse.last);
    V(430, 598, p.spouse.ssn);
  }
  L(50, 584, "Home address (number and street)");
  V(50, 572, DEFAULT_ADDRESS.street);
  s.text(50, 552, "Dependents", { bold: true, size: 9 });
  const depRows: Array<[string, (d: Form1040Params["dependents"][number]) => string]> = [
    ["(1) First name", (d) => d.first],
    ["(2) Last name", (d) => d.last],
    ["(3) SSN", (d) => d.ssn],
    ["(4) Relationship", (d) => d.relationship],
  ];
  y = 540;
  for (const [label, get] of depRows) {
    L(50, y, label);
    p.dependents.forEach((d, i) => V(200 + i * 100, y, get(d)));
    y -= 12;
  }
  const amount = (id: string) => (p.lines[id] !== undefined ? dollars(p.lines[id]) : "");
  const incomeLine = (yy: number, id: string, label: string, second?: { id: string; label: string }) => {
    L(50, yy, `${id} ${label}`);
    if (second) {
      L(200, yy, id);
      V(230, yy, amount(id));
      L(300, yy, `b ${second.label}`);
      L(470, yy, second.id);
      V(500, yy, amount(second.id));
    } else {
      L(470, yy, id);
      V(500, yy, amount(id));
    }
  };
  y = 470;
  const step = 14;
  incomeLine(y, "1a", "Total amount from Form(s) W-2, box 1 (see instructions)");
  incomeLine((y -= step), "1z", "Add lines 1a through 1h");
  incomeLine((y -= step), "2a", "Tax-exempt interest", { id: "2b", label: "Taxable interest" });
  incomeLine((y -= step), "3a", "Qualified dividends", { id: "3b", label: "Ordinary dividends" });
  incomeLine((y -= step), "4a", "IRA distributions", { id: "4b", label: "Taxable amount" });
  incomeLine((y -= step), "5a", "Pensions and annuities", { id: "5b", label: "Taxable amount" });
  incomeLine((y -= step), "6a", "Social security benefits", { id: "6b", label: "Taxable amount" });
  incomeLine((y -= step), "7a", "Capital gain or (loss). Attach Schedule D if required");
  incomeLine((y -= step), "8", "Additional income from Schedule 1, line 10");
  incomeLine((y -= step), "9", "Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7a, and 8. This is your total income");
  incomeLine((y -= step), "10", "Adjustments to income from Schedule 1, line 26");
  incomeLine((y -= step), "11a", "Subtract line 10 from line 9. This is your adjusted gross income");
  s.text(50, 45, `Form 1040 (${p.taxYear})`, { size: 8 });

  const s2 = addPage(pdf);
  s2.text(50, 740, `Form 1040 (${p.taxYear})`, { size: 8 });
  s2.text(50, 700, "11b Amount from line 11a (adjusted gross income)", { size: 7 });
  s2.text(470, 700, "11b", { size: 7 });
  s2.text(500, 700, amount("11b"), { size: 9 });
  s2.text(50, 660, "Sign Here: [signature omitted]", { size: 9 });
  s2.text(50, 45, `Form 1040 (${p.taxYear})`, { size: 8 });

  if (p.scheduleC) {
    const c = addPage(pdf);
    c.text(50, 740, "SCHEDULE C (Form 1040)", { bold: true, size: 11 });
    c.text(50, 726, `Profit or Loss From Business ${p.taxYear}`, { bold: true, size: 11 });
    c.text(50, 700, `Name of proprietor: ${p.filer.first} ${p.filer.last}`, { size: 9 });
    c.text(50, 686, `A Principal business or profession: ${p.scheduleC.business}`, { size: 9 });
    c.text(50, 640, "31 Net profit or (loss)", { size: 9 });
    c.text(500, 640, dollars(p.scheduleC.netProfitCents), { size: 9 });
  }
  return save(pdf);
}

async function transcript(p: TranscriptParams): Promise<Uint8Array> {
  const pdf = await newPdf("IRS Tax Return Transcript", false);
  const s = addPage(pdf);
  const lines: string[] = [
    "Internal Revenue Service",
    "United States Department of the Treasury",
    "",
    "This Product Contains Sensitive Taxpayer Data",
    "",
    `Request Date: ${mdyDash(p.requestDate)}`,
    `Response Date: ${mdyDash(p.requestDate)}`,
    "Tracking Number: 100000000001",
    "",
    "Tax Return Transcript",
    "",
    `SSN Provided: XXX-XX-${p.ssnLast4}`,
    `Tax Period Ending: ${abbrDate(p.taxPeriodEnding)}`,
    "",
  ];
  if (p.noRecord) lines.push("No record of return filed");
  else {
    lines.push(
      "The following items reflect the amount as shown on the return (PR), and the amount as",
      "adjusted (PC), if applicable. They do not show subsequent activity on the account.",
      "",
      `SSN: XXX-XX-${p.ssnLast4}`,
      `NAME(S) SHOWN ON RETURN: ${p.namesShown}`,
      "ADDRESS: 100 FI",
      `FILING STATUS: ${p.filingStatus}`,
      "FORM NUMBER: 1040",
      "",
      "Income",
    );
    for (const [label, cents] of p.items) {
      const value = formatCents(cents);
      const dots = ".".repeat(Math.max(3, 60 - label.length - value.length));
      lines.push(`${label}:${dots}${value}`);
    }
  }
  lines.push("", "This Product Contains Sensitive Taxpayer Data");
  let y = 735;
  for (const line of lines) {
    if (line) s.text(50, y, line, { mono: true, size: 9 });
    y -= 12;
  }
  return save(pdf);
}

async function wageIncomeTranscript(p: WageIncomeTranscriptParams): Promise<Uint8Array> {
  const pdf = await newPdf("IRS Wage and Income Transcript", true);
  const s = addPage(pdf);
  const lines = [
    "Internal Revenue Service",
    "United States Department of the Treasury",
    "This Product Contains Sensitive Taxpayer Data",
    "",
    "Wage and Income Transcript",
    "",
    `Request Date: ${mdyDash(p.requestDate)}`,
    `Response Date: ${mdyDash(p.requestDate)}`,
    `Tax Period Requested: December, ${p.taxYear}`,
    `Taxpayer: ${p.taxpayer}`,
    `SSN: ${p.ssn}`,
    "Address: 100 FIXTURE LANE HOUSTON TX 77002",
    "",
  ];
  for (const f of p.forms) {
    lines.push(
      "Form W-2 Wage and Tax Statement",
      `Employer: ${f.employer}`,
      `Employer Identification Number (EIN): ${f.ein}`,
      `Wages, Tips and Other Compensation: ${formatCents(f.wagesCents)}`,
      "",
    );
  }
  lines.push("This Product Contains Sensitive Taxpayer Data");
  let y = 735;
  for (const line of lines) {
    if (line) s.text(50, y, line, { mono: true, size: 9 });
    y -= 12;
  }
  return save(pdf);
}

async function nonfiling(p: NonfilingParams): Promise<Uint8Array> {
  const pdf = await newPdf("IRS Verification of Non-filing Letter", true);
  const s = addPage(pdf);
  s.text(50, 730, "Internal Revenue Service", { bold: true });
  s.text(50, 716, "Verification of Non-filing Letter", { bold: true, size: 12 });
  s.text(380, 690, `Date: ${mdy(p.date)}`);
  addressBlock(s, 50, 660, p.taxpayer);
  s.text(50, 610, `Tax Period Requested: December, ${p.taxYear}`);
  const body =
    p.version === "no_record"
      ? `Thank you for your request. Our records show that we have no record of a processed tax return for the tax period shown above.`
      : `Thank you for your request. We're sorry, but we couldn't honor the request for the tax period shown above.`;
  s.para(50, 585, body);
  return save(pdf);
}

async function payStub(p: PayStubParams): Promise<Uint8Array> {
  const pdf = await newPdf("Pay stub", true);
  const s = addPage(pdf);
  s.text(50, 730, `Employer: ${p.employer}`, { bold: true });
  s.text(50, 716, "Earnings Statement", { size: 9 });
  s.text(50, 690, `Employee: ${p.employee}`);
  s.text(50, 676, `Pay Period: ${mdy(p.periodStart)} - ${mdy(p.periodEnd)}`);
  s.text(50, 662, `Pay Date: ${mdy(p.payDate)}`);
  s.text(50, 630, "Earnings", { bold: true });
  s.text(250, 630, "Hours", { bold: true });
  s.text(320, 630, "Rate", { bold: true });
  s.text(390, 630, "Current", { bold: true });
  s.text(480, 630, "YTD", { bold: true });
  s.text(50, 614, "Regular");
  s.text(250, 614, p.hours);
  s.text(320, 614, p.rate);
  s.text(390, 614, formatCents(p.grossCurrentCents));
  s.text(480, 614, formatCents(p.grossYtdCents));
  s.text(50, 594, "Gross Pay", { bold: true });
  s.text(390, 594, formatCents(p.grossCurrentCents));
  s.text(480, 594, formatCents(p.grossYtdCents));
  s.text(50, 574, "Deductions", { bold: true });
  s.text(390, 574, formatCents(p.deductionsCurrentCents));
  s.text(480, 574, formatCents(p.deductionsYtdCents));
  s.text(50, 554, "Net Pay", { bold: true });
  s.text(390, 554, formatCents(p.netCurrentCents));
  s.text(480, 554, formatCents(p.netYtdCents));
  return save(pdf);
}

async function letter(p: LetterParams): Promise<Uint8Array> {
  const pdf = await newPdf(p.title, p.invented ?? true);
  const s = addPage(pdf);
  let y = 730;
  for (const l of p.letterhead) {
    s.text(50, y, l, { bold: y === 730, size: y === 730 ? 12 : 10 });
    y -= 14;
  }
  if (p.date) s.text(380, 690, `Date: ${mdy(p.date)}`);
  if (p.addressee) addressBlock(s, 50, 660, p.addressee);
  y = 600;
  s.text(50, y, p.title, { bold: true, size: 12 });
  y -= 22;
  for (const para of p.paragraphs) y = s.para(50, y, para) - 8;
  if (p.footer) s.text(50, 45, p.footer, { size: 8 });
  return save(pdf);
}

async function imageOnlyPdf(p: ImageParams): Promise<Uint8Array> {
  const pdf = await newPdf("image-only scan", false);
  const page = pdf.doc.addPage(PAGE);
  const png = await pdf.doc.embedPng(renderTextPng(p.lines.map((text) => ({ text })), { width: 1100 }));
  const scale = Math.min(512 / png.width, 692 / png.height);
  page.drawImage(png, { x: 50, y: 742 - png.height * scale, width: png.width * scale, height: png.height * scale });
  return save(pdf);
}

/** Deterministic garbage after a PDF header: classified as PDF, rejected by the parser as corrupt. */
function corruptPdf(seed: number): Uint8Array {
  const out = new Uint8Array(2048);
  const head = new TextEncoder().encode("%PDF-1.7\n% SYNTHETIC SAMPLE - NOT A REAL DOCUMENT (deliberately corrupt)\n");
  out.set(head);
  let x = seed >>> 0 || 1;
  for (let i = head.length; i < out.length - 6; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  out.set(new TextEncoder().encode("%%EOF\n"), out.length - 6);
  return out;
}

/** Mints one synthetic document. Every person, number and amount in `params` should be fictional. */
export async function generateSyntheticDocument<K extends SyntheticKind>(kind: K, params: SyntheticParamsByKind[K]): Promise<Uint8Array> {
  const p = params as SyntheticParamsByKind[SyntheticKind];
  switch (kind) {
    case "tf0001":
      return tf0001(p as Tf0001Params);
    case "ssa_benefit_verification":
      return benefitVerification(p as BenefitVerificationParams);
    case "ssa_notice":
      return ssaNotice(p as SsaNoticeParams);
    case "wic_voc":
      return wicVoc(p as WicVocParams);
    case "hud_52646":
      return voucher(p as VoucherParams);
    case "hud_50058":
      return hud50058(p as Hud50058Params);
    case "pha_notice":
      return phaNotice(p as PhaNoticeParams);
    case "w2":
      return w2((p as { statements: W2Statement[] }).statements);
    case "form_1040":
      return form1040(p as Form1040Params);
    case "irs_tax_return_transcript":
      return transcript(p as TranscriptParams);
    case "irs_wage_income_transcript":
      return wageIncomeTranscript(p as WageIncomeTranscriptParams);
    case "irs_nonfiling":
      return nonfiling(p as NonfilingParams);
    case "pay_stub":
      return payStub(p as PayStubParams);
    case "letter":
      return letter(p as LetterParams);
    case "image_png":
      return renderTextPng([{ text: SYNTHETIC_BANNER_TEXT.replace("—", "-"), scale: 2 }, ...(p as ImageParams).lines.map((text) => ({ text }))]);
    case "image_only_pdf":
      return imageOnlyPdf({ lines: [SYNTHETIC_BANNER_TEXT.replace("—", "-"), ...(p as ImageParams).lines] });
    case "corrupt_pdf":
      return corruptPdf((p as { seed: number }).seed);
    default:
      throw new RangeError(`Unknown synthetic document kind: ${String(kind)}`);
  }
}

/* ----------------------------------------------------------------- convenience: award letters */

export interface SyntheticAwardLetterParams {
  program: BenefitProgram;
  /** Fictional recipient, e.g. "MARIA ALVAREZ". */
  recipient: string;
  /** Other fictional household members covered (TF0001 rows). */
  members?: string[];
  /** The date the letter bears (the caller computes it, e.g. 30 days before its "today"). */
  letterDate: IsoDate;
  /** Benefit period end, where the program prints one. */
  periodEnd?: IsoDate | null;
  caseNumber?: string;
  monthlyAmountCents?: number;
}

/**
 * A plausible approval letter for any listed program, for demos and end-to-end runs:
 * SNAP/TANF → TF0001, SSI → Benefit Verification Letter, WIC → VOC, SECTION_8 → PHA rent notice.
 */
export async function generateSyntheticAwardLetter(p: SyntheticAwardLetterParams): Promise<Uint8Array> {
  const people = [p.recipient, ...(p.members ?? [])].map((n) => n.toUpperCase());
  const amount = p.monthlyAmountCents ?? 50_000;
  switch (p.program) {
    case "SNAP":
    case "TANF": {
      const snap = p.program === "SNAP";
      return generateSyntheticDocument("tf0001", {
        noticeDate: p.letterDate,
        caseNumber: p.caseNumber ?? "9990000001",
        addressee: people[0],
        sections: [
          {
            heading: snap ? "SNAP Food Benefits" : "TANF Cash Help",
            tables: [
              {
                status: "gets",
                subject: snap ? "SNAP food benefits" : "TANF cash help",
                rows: people.map((name, i) => ({ name, edg: String(990000011 + i), program: p.program, start: p.letterDate, end: snap ? (p.periodEnd ?? null) : null })),
              },
            ],
            notes: `Monthly amount: ${formatCents(amount)}`,
          },
        ],
      });
    }
    case "SSI":
      return generateSyntheticDocument("ssa_benefit_verification", {
        date: p.letterDate,
        addressee: people[0],
        ssi: { beginning: p.letterDate, amountCents: amount, type: "a disabled individual" },
      });
    case "WIC":
      return generateSyntheticDocument("wic_voc", {
        participant: people[0],
        dateOfBirth: "2023-05-01",
        certificationStart: p.letterDate,
        certificationEnd: p.periodEnd ?? p.letterDate,
        incomeDetermined: p.letterDate,
        vocId: "SYN-VOC-0001",
      });
    case "SECTION_8":
      return generateSyntheticDocument("pha_notice", {
        date: p.letterDate,
        headOfHousehold: people[0],
        effectiveDate: p.letterDate,
        nextReexam: p.periodEnd ?? p.letterDate,
        contractRentCents: 130_000,
        hapCents: 108_800,
        tenantRentCents: 21_200,
      });
  }
}
