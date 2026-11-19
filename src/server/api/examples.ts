/**
 * Example payloads for the OpenAPI document and the developer docs. SYNTHETIC: every id, name, address, amount and
 * URL here is made up for illustration (example.org / synthetic.example hosts, `_SYNTHETIC` ids). A test checks that
 * each example validates against its schema, so an example can never show a field the API does not return.
 *
 * Threshold figures in the verification example are placeholders shaped like real values, not a real county's limit.
 */
import type { z } from "zod";
import type {
  createHandoffBody,
  createVerificationBody,
  createWebhookEndpointBody,
  donationSchema,
  errorSchema,
  eventSchema,
  handoffCreatedSchema,
  handoffSchema,
  meSchema,
  verificationCreatedSchema,
  verificationSchema,
  webhookDeliverySchema,
  webhookEndpointSchema,
  webhookEndpointWithSecretSchema,
} from "./schemas";

const HOST = "https://passport.synthetic.example";

export const EXAMPLE_PENDING_VERIFICATION: z.input<typeof verificationSchema> = {
  id: "ver_SYNTHETIC0000000000000A",
  object: "verification",
  mode: "test",
  status: "pending",
  stage: "created",
  method: null,
  household_size: null,
  area: null,
  threshold_usd: null,
  threshold_readings: [],
  threshold_source: null,
  threshold_table_version: null,
  threshold_effective_date: null,
  provisional: true,
  income_year: null,
  award_program: null,
  award_letter_date: null,
  reasons: [],
  evidence_pack_url: null,
  evidence_json_url: null,
  consent: null,
  expires_at: null,
  decided_at: null,
  decided_by: null,
  passport: null,
  external_ref: "APP-1042",
  metadata: { campus: "north" },
  created_at: "2026-11-18T16:00:00.000Z",
};

export const EXAMPLE_VERIFICATION_CREATED: z.input<typeof verificationCreatedSchema> = {
  ...EXAMPLE_PENDING_VERIFICATION,
  family_url: `${HOST}/v/SYNTHETIC-family-link-token-shown-once-000000`,
  embed_url: `${HOST}/embed/verify/SYNTHETIC-family-link-token-shown-once-000000`,
};

export const EXAMPLE_DECIDED_VERIFICATION: z.input<typeof verificationSchema> = {
  ...EXAMPLE_PENDING_VERIFICATION,
  status: "eligible",
  stage: "decided",
  method: "direct",
  household_size: 4,
  area: { county_fips: "48999", county_name: "Synthetic County", hud_area_code: "SYNTH0000", hud_area_name: "Synthetic Area (example)" },
  threshold_usd: "100000.00",
  threshold_readings: [
    { id: "ami_300pct", usd: "100000.00" },
    { id: "vli_6x", usd: "105000.00" },
  ],
  threshold_source: "hud_provisional",
  threshold_table_version: "synthetic-example",
  threshold_effective_date: "2026-04-01",
  provisional: true,
  income_year: 2025,
  evidence_pack_url: `${HOST}/api/v1/verifications/ver_SYNTHETIC0000000000000A/evidence.pdf`,
  evidence_json_url: `${HOST}/api/v1/verifications/ver_SYNTHETIC0000000000000A/evidence.json`,
  consent: { version: "share-v1", granted_at: "2026-11-18T16:05:00.000Z" },
  expires_at: "2026-12-31T23:59:59.999Z",
  decided_at: "2026-11-18T16:20:00.000Z",
  decided_by: "engine",
};

export const EXAMPLE_CREATE_VERIFICATION: z.input<typeof createVerificationBody> = {
  external_ref: "APP-1042",
  student: { first_name: "Riley", last_name: "Synthetic" },
  return_url: "https://apply.synthetic.example/done",
  metadata: { campus: "north" },
};

export const EXAMPLE_HANDOFF: z.input<typeof handoffSchema> = {
  id: "ho_SYNTHETIC00000000000000A",
  object: "handoff",
  booking_ref: "BK-2027-0042",
  status: "held",
  hold_expires_at: "2026-11-21T16:00:00.000Z",
  verification_status: "pending",
  award: null,
  sgo: { name: "Synthetic Scholarship Fund" },
  metadata: { session: "june-week-1" },
  mode: "test",
  channel: "redirect",
  created_via: "api",
  status_detail: "The family is verifying income with the scholarship organization. The spot is held.",
  booking: { ref: "BK-2027-0042", description: "Synthetic Day Camp, week 1", amount_usd: "450.00", amount_confirmed: true },
  return_url: "https://camp.synthetic-example.org/booking/BK-2027-0042",
  completed_at: null,
  created_at: "2026-11-18T16:00:00.000Z",
  updated_at: "2026-11-18T16:10:00.000Z",
};

export const EXAMPLE_HANDOFF_CREATED: z.input<typeof handoffCreatedSchema> = {
  ...EXAMPLE_HANDOFF,
  status: "started",
  url: `${HOST}/h/SYNTHETIC-handoff-token-shown-once-0000000000`,
  embed_url: `${HOST}/embed/handoff/SYNTHETIC-handoff-token-shown-once-0000000000`,
};

export const EXAMPLE_CREATE_HANDOFF: z.input<typeof createHandoffBody> = {
  booking_ref: "BK-2027-0042",
  booking_description: "Synthetic Day Camp, week 1",
  booking_amount_cents: 45000,
  family_email: "parent@synthetic.example",
  return_url: "https://camp.synthetic-example.org/booking/BK-2027-0042",
  channel: "redirect",
  metadata: { session: "june-week-1" },
};

export const EXAMPLE_DONATION: z.input<typeof donationSchema> = {
  id: "don_SYNTHETIC0000000000000A",
  object: "donation",
  mode: "test",
  status: "succeeded",
  org_id: "org_SYNTHETIC0000000000000A",
  checkout_session_id: "chk_SYNTHETIC0000000000000A",
  payment_id: "pay_SYNTHETIC0000000000000A",
  taxpayer_role: "individual",
  filing_status: "single",
  currency: "usd",
  designated_amount_cents: 170000,
  non_designated_amount_cents: 0,
  donor_service_fee_cents: 0,
  sgo_platform_fee_cents: 0,
  fee_structure: "none",
  designated_25f: true,
  designated_at: "2026-11-18T16:00:00.000Z",
  designation: { copy_id: "designation.synthetic", copy_version: "synthetic-v1", text: "(the exact designation words shown to the donor)", text_sha256: "0".repeat(64) },
  state_allocation: "TX",
  attestations: { individual: true, us_citizen_or_resident: true, no_earmark: true, not_in_exchange_for_scholarship: true, joint_on_behalf_of_both: false },
  goods_or_services: { provided: false, value_cents: 0 },
  contributed_at: "2026-11-18T16:00:05.000Z",
  tax_year: 2026,
  year_boundary_ambiguous: false,
  credit_eligible: false,
  credit_ineligible_reason: "sandbox_mode",
  sgo_list: { status_at_gift: "listed", entry_id_at_gift: "sle_SYNTHETIC000000000000A" },
  e_delivery_consent: true,
  refunded_at: null,
  donor: {
    id: "dnr_SYNTHETIC0000000000000A",
    first_name: "Avery",
    middle_name: null,
    last_name: "Synthetic",
    suffix: null,
    email: "donor@synthetic.example",
    address: { line1: "100 Synthetic Way", line2: null, city: "Austin", state: "TX", zip: "78701" },
  },
  created_at: "2026-11-18T16:00:00.000Z",
  updated_at: "2026-11-18T16:00:05.000Z",
};

export const EXAMPLE_EVENT: z.input<typeof eventSchema> = {
  id: "evt_SYNTHETIC0000000000000A",
  object: "event",
  type: "verification.decided",
  mode: "test",
  created_at: "2026-11-18T16:20:00.000Z",
  data: EXAMPLE_DECIDED_VERIFICATION as unknown as Record<string, unknown>,
};

export const EXAMPLE_WEBHOOK_ENDPOINT: z.input<typeof webhookEndpointSchema> = {
  id: "whe_SYNTHETIC0000000000000A",
  object: "webhook_endpoint",
  url: "https://hooks.synthetic.example/passport",
  description: "Decisions into our applicant system",
  event_types: ["verification.decided", "verification.needs_review"],
  format: "native",
  status: "active",
  failure_count: 0,
  last_success_at: null,
  last_failure_at: null,
  created_at: "2026-11-18T16:00:00.000Z",
};

export const EXAMPLE_WEBHOOK_ENDPOINT_WITH_SECRET: z.input<typeof webhookEndpointWithSecretSchema> = {
  ...EXAMPLE_WEBHOOK_ENDPOINT,
  secret: "whsec_U1lOVEhFVElDLWV4YW1wbGUtc2VjcmV0LW5vdC1yZWFsMDA=",
};

export const EXAMPLE_CREATE_WEBHOOK_ENDPOINT: z.input<typeof createWebhookEndpointBody> = {
  url: "https://hooks.synthetic.example/passport",
  description: "Decisions into our applicant system",
  event_types: ["verification.decided", "verification.needs_review"],
};

export const EXAMPLE_WEBHOOK_DELIVERY: z.input<typeof webhookDeliverySchema> = {
  id: "whd_SYNTHETIC0000000000000A",
  object: "webhook_delivery",
  endpoint_id: "whe_SYNTHETIC0000000000000A",
  event_id: "evt_SYNTHETIC0000000000000A",
  event_type: "verification.decided",
  mode: "test",
  attempt: 1,
  status: "succeeded",
  response_status: 200,
  response_excerpt: "ok",
  error: null,
  next_attempt_at: null,
  created_at: "2026-11-18T16:20:00.000Z",
  delivered_at: "2026-11-18T16:20:01.000Z",
};

export const EXAMPLE_ME: z.input<typeof meSchema> = {
  object: "api_key_context",
  mode: "test",
  organization: { id: "org_SYNTHETIC0000000000000A", name: "Synthetic Scholarship Fund", slug: "synthetic-scholarship-fund", type: "sgo", status: "active" },
  api_key: { id: "key_SYNTHETIC0000000000000A", name: "Applicant system", prefix: "ecca_test_AbC123", created_at: "2026-11-18T15:00:00.000Z" },
};

export const EXAMPLE_ERROR: z.input<typeof errorSchema> = {
  error: { code: "validation_failed", message: "Enter a valid email address.", details: { fields: { applicant_email: "Enter a valid email address." } }, request_id: "req_SYNTHETIC00000000" },
};

export const EXAMPLE_EVIDENCE_NOT_READY: z.input<typeof errorSchema> = {
  error: { code: "conflict", message: "There is no evidence yet: this verification has not been decided.", details: { reason: "evidence_not_ready", status: "pending" }, request_id: "req_SYNTHETIC00000001" },
};
