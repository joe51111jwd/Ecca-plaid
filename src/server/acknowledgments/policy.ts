import { MS } from "@/lib/clock";
import type { MemberRole } from "@/db/schema";

/**
 * Product policies of the acknowledgment and reporting domain. Each is a decision the sources
 * (docs/reference/acknowledgment-reporting.md) leave open; the comment says what is open and why the value was
 * chosen, so a counsel decision or the IRS portal instructions become a one-line change here.
 */

/**
 * Unique donor number format. The real format comes only from the IRS SGO portal instructions (F23: NOT IN
 * SOURCES), so only the shape any identifier needs is checked: not empty, bounded length, letters, digits and
 * hyphens. Widen the pattern when the instructions say more.
 */
export const DONOR_NUMBER_MAX_LENGTH = 64;
export const DONOR_NUMBER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Prefix of sandbox numbers. Sandbox output must be visibly non-production and must be rejected by the official
 * paths (acknowledgment-reporting.md E2 item 2), so live numbers may never start with it.
 */
export const SANDBOX_DONOR_NUMBER_PREFIX = "TEST-";

/** Largest donor-number import accepted in one file (Treasury's planning figure is ~16,923 donors per SGO, F38). */
export const DONOR_NUMBER_IMPORT_MAX_ROWS = 50_000;
export const DONOR_NUMBER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** SGO roles allowed to enter numbers, issue acknowledgments, generate the IRS report and record mailings. */
export const MANAGE_ROLE: MemberRole = "admin";

/**
 * Whether an acknowledgment may be issued before the calendar year ends. Element (B) is the calendar-year total and
 * whether an in-year acknowledgment satisfies the rule is NOT IN SOURCES (Q4); issuing is allowed and any later
 * change to the year's total supersedes it with a new version (E1 item 9).
 */
export const ALLOW_ISSUE_BEFORE_YEAR_END = true;

/**
 * IRS report amount (element (C), "aggregate amount of qualified contributions"). A qualified contribution is net of
 * any goods or services (F13), while acknowledgment element (B) is "designated"; whether (B) is gross or net is open
 * (Q6). The report uses designated minus goods value, and the report raises an issue whenever goods were provided so
 * a person confirms the figure. The checkout itself never attaches goods (E1 item 8).
 */
export const REPORT_AMOUNT_BASIS = "designated_less_goods_value" as const;

/**
 * What happens when every gift of an already-acknowledged year is refunded. The treatment of refunds after a
 * designation is NOT IN SOURCES (Q7), so no $0 document is sent automatically: the next version is blocked with a
 * reason that asks the SGO to review it with counsel.
 */
export const ZERO_TOTAL_AFTER_ISSUE = "block_for_review" as const;

/** Time zone that decides "today" for the January 31 and February 28 deadlines (US Central, the Texas wedge's zone). */
export const DEADLINE_TIME_ZONE = "America/Chicago";

/** How often the recurring "acknowledgment.annual" job runs. */
export const ANNUAL_JOB_EVERY_MS = MS.day;

/** Acknowledgments built or re-checked per run; the job enqueues a continuation for the rest (bounded by the job timeout). */
export const ANNUAL_JOB_BATCH = 200;

/**
 * Escalation levels of the SGO reminders, by days left until the deadline. Not in the sources: E1 item 4 says to
 * schedule the batch in the first half of January with an internal cutoff several days before January 31.
 * "opening" is sent from the first day of the window, "overdue" once the deadline has passed with work outstanding.
 */
export const ACKNOWLEDGMENT_NOTICE_LEVELS = [
  { level: "reminder", daysLeft: 14 },
  { level: "urgent", daysLeft: 7 },
  { level: "final", daysLeft: 2 },
] as const;

/** The IRS report window opens the day after the acknowledgment deadline (February 1). */
export const IRS_REPORT_NOTICE_LEVELS = [
  { level: "reminder", daysLeft: 14 },
  { level: "urgent", daysLeft: 7 },
  { level: "final", daysLeft: 2 },
] as const;

/** Modes the annual job runs for. Test-mode notices and documents carry the sandbox label. */
export const ANNUAL_JOB_MODES = ["live", "test"] as const;

/** Rows per page of the IRS report history. */
export const REPORT_HISTORY_LIMIT = 100;
