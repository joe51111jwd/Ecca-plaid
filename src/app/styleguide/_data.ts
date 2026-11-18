import type { HandoffStatus } from "@/db/schema/business";
import type { VerificationMethod, VerificationStage, VerificationStatus } from "@/db/schema/verification";

/**
 * SYNTHETIC sample data for the style guide. Every person, organization, id and amount here is made up.
 * The one sourced figure is the Houston-area income limit used in the build spec's own illustration
 * ($104,000 median × 300% = $312,000 for a household of four, provisional).
 */

/** A fixed "now" so the style guide renders the same on every request (app code uses now() from src/lib/clock). */
export const SAMPLE_NOW = new Date("2026-11-18T21:30:00Z");

export const SAMPLE_SGO = { name: "Prairie Lantern Scholarship Fund", typeLabel: "Scholarship organization" } as const;
export const SAMPLE_CAMP = { name: "Camp Cedar Creek", typeLabel: "Camp or school", booking: "Session 2 · June 8–12" } as const;
export const SAMPLE_USER = { name: "Daniel Okafor", email: "daniel@prairielantern.example" } as const;
export const SAMPLE_LIMIT_CENTS = 31_200_000;

export interface SampleVerification {
  id: string;
  externalRef: string;
  applicant: string;
  student: string;
  status: VerificationStatus;
  stage: VerificationStage;
  method: VerificationMethod | null;
  householdSize: number | null;
  incomeCents: number | null;
  thresholdCents: number | null;
  provisional: boolean;
  updatedAt: string;
}

export const SAMPLE_VERIFICATIONS: SampleVerification[] = [
  { id: "ver_3Zk9QmT2", externalRef: "APP-1042", applicant: "Maria Alvarez", student: "Tomás Alvarez", status: "needs_review", stage: "in_review", method: "direct", householdSize: 4, incomeCents: 30_480_000, thresholdCents: SAMPLE_LIMIT_CENTS, provisional: true, updatedAt: "2026-11-18T20:52:00Z" },
  { id: "ver_8Hd2LpX7", externalRef: "APP-1041", applicant: "James Whitfield", student: "Ava Whitfield", status: "eligible", stage: "decided", method: "categorical", householdSize: 4, incomeCents: null, thresholdCents: SAMPLE_LIMIT_CENTS, provisional: true, updatedAt: "2026-11-18T18:14:00Z" },
  { id: "ver_5Tn7WcB4", externalRef: "APP-1039", applicant: "Nguyen Thi Lan", student: "Minh Nguyen", status: "pending", stage: "collecting", method: null, householdSize: 4, incomeCents: null, thresholdCents: null, provisional: true, updatedAt: "2026-11-18T16:40:00Z" },
  { id: "ver_2Rv6JkD9", externalRef: "APP-1036", applicant: "Priya Raman", student: "Anika Raman", status: "eligible", stage: "decided", method: "direct", householdSize: 4, incomeCents: 9_640_000, thresholdCents: SAMPLE_LIMIT_CENTS, provisional: true, updatedAt: "2026-11-17T22:05:00Z" },
  { id: "ver_9Bq4FsM1", externalRef: "APP-1033", applicant: "DeShawn Carter", student: "Jordan Carter", status: "ineligible", stage: "decided", method: "direct", householdSize: 4, incomeCents: 34_150_000, thresholdCents: SAMPLE_LIMIT_CENTS, provisional: true, updatedAt: "2026-11-17T15:31:00Z" },
  { id: "ver_6Yw1NzG8", externalRef: "APP-1030", applicant: "Elena Petrova", student: "Mila Petrova", status: "pending", stage: "awaiting_family", method: null, householdSize: 4, incomeCents: null, thresholdCents: null, provisional: true, updatedAt: "2026-11-16T19:20:00Z" },
  { id: "ver_4Ke8HtP3", externalRef: "APP-1027", applicant: "Samuel Ortiz", student: "Lucia Ortiz", status: "expired", stage: "decided", method: "categorical", householdSize: 4, incomeCents: null, thresholdCents: SAMPLE_LIMIT_CENTS, provisional: true, updatedAt: "2026-10-02T14:00:00Z" },
  { id: "ver_7Jm3XvC6", externalRef: "APP-1021", applicant: "Hannah Becker", student: "Noah Becker", status: "canceled", stage: "started", method: null, householdSize: null, incomeCents: null, thresholdCents: null, provisional: true, updatedAt: "2026-09-28T17:45:00Z" },
];

export interface SampleHandoff {
  id: string;
  family: string;
  booking: string;
  status: HandoffStatus;
  amountCents: number;
}

export const SAMPLE_HANDOFFS: SampleHandoff[] = [
  { id: "hof_1Ab2", family: "Maria Alvarez", booking: "Session 2 · June 8–12", status: "held", amountCents: 42_500 },
  { id: "hof_3Cd4", family: "Priya Raman", booking: "Session 1 · June 1–5", status: "awarded", amountCents: 42_500 },
  { id: "hof_5Ef6", family: "Samuel Ortiz", booking: "Session 3 · June 15–19", status: "expired", amountCents: 42_500 },
];

export const SAMPLE_EMBED_SNIPPET = `<script src="https://app.example/embed.js" async></script>
<div data-scholarship-handoff
     data-key="pk_test_Qm4T…"
     data-booking-ref="BK-20931"
     data-amount-cents="42500"></div>`;

export const SAMPLE_WEBHOOK_PAYLOAD = `{
  "type": "verification.decided",
  "data": {
    "id": "ver_8Hd2LpX7",
    "status": "eligible",
    "method": "categorical",
    "threshold_source": "hud_provisional"
  }
}`;
