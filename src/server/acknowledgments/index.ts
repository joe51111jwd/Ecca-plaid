/**
 * Acknowledgments and reporting: the SGO's official written acknowledgment to each donor (per donor, per SGO, per
 * calendar year; Temp. Treas. Reg. 1.25F-4T(c)(1); acknowledgment-reporting.md E1), the unique donor numbers it
 * carries (E2), the January 31 / February 28 deadlines, and the annual contribution report to the IRS (E4).
 * This file is the domain's public API.
 *
 *   setDonorNumber / importDonorNumbers / generateSandboxDonorNumber   numbers created in the IRS SGO portal (never invented)
 *   buildAcknowledgment → issueAcknowledgment                          aggregate, render (pdf-lib), store encrypted, version, deliver
 *   withdrawEDelivery, markAcknowledgmentMailed                        paper path
 *   "acknowledgment.annual" (handleAcknowledgmentAnnual)               January batch, worklist and reminders, IRS report reminders
 *   generateIrsReport, recordIrsReportSubmission                       the February 28 report with its consistency check
 *   acknowledgmentWorklist, getDonorAcknowledgments, ...               dashboard reads (audited)
 *
 * Mutations take an SgoActor (`{ userId, request }` checked against the SGO's memberships, or systemActor(reason));
 * reads take `{ actor, request }` naming the reader, after the caller guarded membership.
 */
export {
  listPendingAcknowledgmentRefreshes,
  markAcknowledgmentStale,
  resolveAcknowledgmentRefresh,
  type AcknowledgmentRefresh,
  type AcknowledgmentRefreshReason,
  type MarkAcknowledgmentStaleInput,
} from "./refreshes";
export {
  acknowledgmentSummaries,
  donorNumberSummaries,
  type AcknowledgmentStatus,
  type AcknowledgmentSummary,
  type DonorNumberStatus,
  type DonorNumberSummary,
  type IssuedVersionSummary,
  type StatusScope,
} from "./status";
export {
  DONOR_NUMBER_IMPORT_COLUMNS,
  generateSandboxDonorNumber,
  generateSandboxDonorNumbers,
  importDonorNumbers,
  setDonorNumber,
  type DonorNumberImportError,
  type DonorNumberImportReport,
  type DonorNumberRow,
  type ImportDonorNumbersInput,
  type SetDonorNumberInput,
} from "./donor-numbers";
export {
  BLOCKER_MESSAGES,
  buildAcknowledgment,
  donorAddressLines,
  donorFullName,
  type AcknowledgmentBlocker,
  type AcknowledgmentBlockerCode,
  type AcknowledgmentBuild,
  type AcknowledgmentGift,
  type BuildOptions,
} from "./build";
export { buildLetter, letterParagraphs, type LetterContent, type LetterInput } from "./letter";
export { ACKNOWLEDGMENT_PDF_RENDERER, renderAcknowledgmentPdf } from "./pdf";
export { LETTER_COPY, LETTER_COPY_SHA256, LETTER_COPY_VERSION, NOTICE_COPY } from "./letter-copy";
export {
  issueAcknowledgment,
  markAcknowledgmentMailed,
  toApiAcknowledgment,
  withdrawEDelivery,
  type AcknowledgmentRow,
  type AcknowledgmentScope,
  type IssueResult,
} from "./issue";
export {
  ACKNOWLEDGMENT_ANNUAL_JOB,
  daysBetween,
  handleAcknowledgmentAnnual,
  noticeLevelFor,
  runAcknowledgmentAnnual,
  type AnnualRunSummary,
} from "./annual";
export {
  centsToDecimal,
  checkIrsReportConsistency,
  downloadIrsReport,
  generateIrsReport,
  getIrsReportTable,
  listIrsReports,
  recordIrsReportSubmission,
  type ConsistencyMismatch,
  type IrsReportConsistency,
  type IrsReportDownload,
  type IrsReportIssueCode,
  type IrsReportResult,
  type IrsReportRow,
  type IrsReportTableRow,
} from "./report";
export { computeWorklist, nextAction, WORKLIST_ACTIONS, type Worklist, type WorklistAction, type WorklistCounts, type WorklistItem } from "./worklist";
export {
  acknowledgmentWorklist,
  downloadAcknowledgmentForUser,
  downloadAcknowledgmentPdf,
  getDonorAcknowledgments,
  listAcknowledgmentNotices,
  listPaperMailings,
  type AcknowledgmentDownload,
  type DonorAcknowledgmentDetail,
  type PaperMailingTask,
  type WorklistPage,
} from "./read";
export type { ReadAccess as AcknowledgmentReadAccess } from "./access";
export * as acknowledgmentsPolicy from "./policy";
