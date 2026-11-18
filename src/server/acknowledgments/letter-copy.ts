import { sha256Hex } from "@/lib/crypto";

/**
 * Structural labels of the acknowledgment letter and the SGO reminder emails: headings, column names, the test-mode
 * watermark and product statements. No tax rule is stated here; every sentence that states a section 25F rule or one
 * of the five required items comes from the taxmath copy registry (src/taxmath/copy.ts: ack.*, note.*), so this file
 * never re-words tax copy. Changing any word requires bumping LETTER_COPY_VERSION (a test pins the hash).
 */

export const LETTER_COPY_VERSION = "ack-letter.2026-11-18.v1";

export const LETTER_COPY = {
  testWatermark: "TEST MODE - NOT VALID FOR FILING",
  testNotice: "Test document. This acknowledgment was produced in test mode from sandbox gifts: no money moved, and it is not valid for filing.",
  calendarYearLabel: "Calendar year",
  issuedLabel: "Issued",
  documentLabel: "Document",
  versionLabel: "Version",
  donorLabel: "Donor",
  requiredHeading: "Required information",
  replaces: "This acknowledgment replaces version {previousVersion} issued on {previousDate}, because the information for the year changed.",
  giftsHeading: "Contributions received in calendar year {calendarYear}",
  giftsColumns: { date: "Date", designated: "Designated", notDesignated: "Not designated", reference: "Reference" },
  giftsTotal: "Total",
  giftsNote: "Each contribution is listed with its date. Amounts in the \"Not designated\" column are not included in the designated total above.",
  notesHeading: "Please note",
  notTaxAdvice: "This letter is not tax advice. Ask a tax professional about your own return.",
  page: "Page {page} of {pages}",
  emailPdfNote: "A printable copy of this acknowledgment is kept with your gifts on the giving page.",
} as const;

export const LETTER_COPY_SHA256 = sha256Hex(JSON.stringify(LETTER_COPY));

/** Fills `{name}` placeholders; a missing variable is an error, never a blank. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => {
    if (!(name in vars)) throw new Error(`Missing letter variable ${name}`);
    return String(vars[name]);
  });
}

/** Wording of the SGO worklist and reminder emails (counts only: no donor names leave the dashboard by email). */
export const NOTICE_COPY = {
  acknowledgments: {
    opening: { subject: "{year} donor acknowledgments: your worklist", lead: "The {year} donor acknowledgments are due to your donors by {dueDate}." },
    reminder: { subject: "Reminder: {year} donor acknowledgments are due {dueDate}", lead: "{daysLeft} days remain until the {year} donor acknowledgments are due on {dueDate}." },
    urgent: { subject: "Urgent: {year} donor acknowledgments are due {dueDate}", lead: "Only {daysLeft} days remain until the {year} donor acknowledgments are due on {dueDate}." },
    final: { subject: "Final reminder: {year} donor acknowledgments are due {dueDate}", lead: "The {year} donor acknowledgments are due on {dueDate}. Some are still outstanding." },
    overdue: { subject: "Overdue: {year} donor acknowledgments were due {dueDate}", lead: "The {year} donor acknowledgments were due on {dueDate} and some are still outstanding." },
  },
  irs_report: {
    opening: { subject: "{year} IRS contribution report: due {dueDate}", lead: "Your {year} contribution report is due to the IRS through the IRS SGO portal by {dueDate}." },
    reminder: { subject: "Reminder: {year} IRS contribution report is due {dueDate}", lead: "{daysLeft} days remain until the {year} contribution report is due on {dueDate}." },
    urgent: { subject: "Urgent: {year} IRS contribution report is due {dueDate}", lead: "Only {daysLeft} days remain until the {year} contribution report is due on {dueDate}." },
    final: { subject: "Final reminder: {year} IRS contribution report is due {dueDate}", lead: "The {year} contribution report is due on {dueDate} and has not been recorded as submitted." },
    overdue: { subject: "Overdue: {year} IRS contribution report was due {dueDate}", lead: "The {year} contribution report was due on {dueDate} and has not been recorded as submitted." },
  },
  counts: {
    donors: "Donors with gifts in {year}",
    issued: "Acknowledgments issued and up to date",
    missingDonorNumber: "Donors without a unique donor number",
    sgoEinMissing: "Organization EIN on file",
    portalRegistration: "Registered in the IRS SGO portal",
    paperToMail: "Paper acknowledgments to mail",
    readyToIssue: "Ready to issue",
    needsReview: "Need review (all gifts refunded or details missing)",
    reportGenerated: "Report generated",
    reportSubmitted: "Recorded as submitted in the IRS SGO portal",
  },
  yes: "Yes",
  no: "No",
  cta: "Open the dashboard",
  sandboxPrefix: "[Sandbox] ",
  sandboxNote: "These figures are from test mode (sandbox gifts). Nothing here is filed.",
} as const;
