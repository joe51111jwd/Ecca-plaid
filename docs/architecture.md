# Architecture

One Next.js application that contains the three product pieces from the build spec and the shared core
they depend on.

| Piece | What it is | Where it lives |
| --- | --- | --- |
| 1. Donor checkout | Hosted giving page + embeddable widget with the section 25F tax-credit math, designation, payment, receipt, acknowledgment and IRS-report exports | `src/taxmath`, `src/server/donations`, `src/server/payments`, `src/app/give`, `src/app/embed/give` |
| 2. Family intake | Magic-link accounts, consent, household form, upload-or-auto-submit, point-of-booking handoff for camps/schools | `src/server/auth`, `src/server/households`, `src/server/rails`, `src/server/handoffs`, `src/app/v`, `src/app/family`, `src/app/embed/handoff`, `src/app/partner` |
| 3. Verification core | Texas income engine, decision service, evidence pack (PDF + signed JSON), HTTP API, webhooks, SGO dashboard | `src/engine/*`, `src/server/verifications`, `src/app/api/v1`, `src/app/sgo` |

Working product name: **Passport** (one constant in `src/lib/brand.ts`; do not hard-code it elsewhere).

## Layers and dependency rules

```
src/lib        pure utilities (clock, ids, money, crypto, csv, errors, env). No DB, no Next imports.
src/engine     PURE domain logic. No DB, no network, no Next, no process.env, no Date.now(): every function
               takes its inputs (including "today") as arguments and returns plain data.
               ami/ geo/ income/ decision/ documents/ evidence/
src/taxmath    PURE. The single module that owns every section 25F number and every sentence of tax copy.
src/db         Drizzle schema (src/db/schema/*.ts) and the database client.
src/server     Services: everything that touches the database, storage, email, payments or the network.
               One folder per domain, each with an index.ts that is its public API.
src/app        Next.js App Router: pages, server actions and route handlers. Thin: validate → call a
               service → render. No business rules here.
src/components shared UI (src/components/ui is the design-system kit; src/components/layout the shells).
src/features   feature-specific React components and client logic (e.g. src/features/payments,
               src/features/intake). Pages compose these; the shared kit stays generic.
src/i18n       English and Spanish dictionaries for family-facing screens.
```

Allowed imports: `app → server → engine/taxmath/db/lib`; `engine` and `taxmath` import only `lib`
(never `server`, `db` or `app`). A service may import another service only through that service's
`index.ts`.

## Runtime defaults (zero-config local development)

| Concern | Local default | Production |
| --- | --- | --- |
| Database | Embedded Postgres (PGlite) in `.data/pglite`, schema auto-synced | `DATABASE_URL` Postgres + `npm run db:migrate` |
| Jobs | Run inside the web process (`JOBS_INLINE`) | `npm run worker` or the cron-triggered `/api/internal/jobs/run` |
| Object storage | AES-256-GCM encrypted files in `.data/objects` | S3-compatible bucket, same envelope encryption |
| Email | Outbox table, viewable at `/dev/mail` | Resend |
| Payments | Sandbox processor (no money moves) | Stripe |
| Data rail | Simulated payroll/bank rail | A licensed rail adapter (Plaid first) |
| Document reading | Text-layer PDF parsers; scans/photos go to human review | Same, plus optional model-assisted extraction when `ANTHROPIC_API_KEY` is set |

All configuration is read through `env()` in `src/lib/env.ts`. All time is read through `now()` in
`src/lib/clock.ts` (so the January 1, 2027 gate, the 12-month award-letter window, link expiry, hold
windows and retention can be tested). All money is integer cents (`src/lib/money.ts`).

## Data model

The schema is the contract: read `src/db/schema/*.ts` (each table and column is documented there).

- `core.ts` users, organizations (type `sgo` | `business` | `platform`), memberships, platform_settings,
  audit_logs, jobs, emails, objects, rate_limits, api_keys, events, webhook_endpoints, webhook_deliveries
- `auth.ts` magic_links, sessions
- `sgo.ts` sgo_list_entries (provisional curated list now, IRS-published list later), sgo_profiles
- `verification.ts` households, household_members, consents, verifications, verification_events,
  documents, income_items, rail_connections, review_tasks, awards
- `donation.ts` donors, checkout_sessions, payments, donations, donor_numbers, acknowledgments,
  irs_reports, fee_ledger
- `business.ts` business_profiles, partnerships, handoffs, business_invoices, business_invoice_lines

Conventions: ids are prefixed random strings from `newId()`; timestamps are `timestamptz`; status-like
columns are `text` typed with a TypeScript union (no Postgres enums); secrets are stored only as hashes
(`hashToken`); sensitive values use field encryption and a `_enc` suffix (`encryptField` /
`encryptJson`); every tenant-owned row carries `org_id` and every query for tenant data filters on it;
`mode` (`test` | `live`) separates sandbox data from real data everywhere.

Never stored: full Social Security numbers (parsers redact to the last four digits at most), card
numbers, bank credentials.

## Access control

- **People** sign in with a single-use, short-lived email credential that works as a link or as a typed
  6-digit code (`magic_links`), which creates a `sessions` row and an HttpOnly cookie. One `users` row
  per email; what a user can do comes from `memberships` (SGO staff, business staff, platform admin)
  and from household ownership (parents).
- **Machines** use API keys (`Authorization: Bearer ecca_test_…` / `ecca_live_…`), stored hashed, scoped to
  one organization and one mode.
- Guards live in `src/server/auth` (`requireUser`, `requireOrgMember(orgId, roles)`,
  `requirePlatformAdmin`, `requireHouseholdAccess`) and `src/server/api` (`authenticateApiKey`). Every
  page, server action and route handler calls a guard first. Services take an explicit `orgId` /
  `householdId` scope argument and never trust ids from the client without checking ownership.
- Reads of sensitive data (documents, evidence, donor records) and all changes are written to
  `audit_logs` through `audit()` in `src/server/audit`.

## Verification lifecycle

```
SGO (API or dashboard) creates a verification  →  family link /v/{token}
family: sign in (magic link / code) → consent → household → choose path
        ├─ upload documents ─┐
        └─ auto-submit (rail)┴→ submit → jobs: extract → decide → evidence
decision: eligible | ineligible | needs_review   (pending while information is missing)
needs_review → SGO reviewer resolves (keys fields / approves / asks for more) → eligible | ineligible
decided → evidence pack PDF + signed JSON → event verification.decided → webhooks
later: result expires; a second SGO can reuse a still-valid result with a fresh consent (passport)
```

Public `status`: `pending`, `eligible`, `ineligible`, `needs_review`, `expired`, `canceled`.
`stage` gives the detail while pending (see `VerificationStage`).

Rules that must hold everywhere:

1. A failed or low-confidence document parse goes to `needs_review`. Never a silent yes.
2. `ineligible` means the evidence affirmatively shows income over the limit. Missing or unusable
   evidence is `pending`/`awaiting_family` or `needs_review`, not `ineligible`.
3. Every decision records the threshold used, its source (`hud_provisional` or `irs_published`), table
   version and effective date. While the table is HUD-derived every surface (API, dashboard, PDF, family
   screen) labels the result **provisional**.
   The proposed rule can be read two ways while the table is HUD-derived — 300% × area median × family-size
   multiplier, or 6 × HUD's Section 8 very-low-income limit — and the readings differ in 143 of 254 Texas
   counties (`docs/reference/sgo-verification-rules.md` F34). An automatic decision is made only where both
   readings agree: at or below the lower one is eligible, above the higher one is ineligible, in between is
   `needs_review`. Both figures are recorded and shown.
4. Verification does not promise an award. An award is a separate, explicit SGO decision (`awards`).
5. Shared custody is never guessed: unclear answers create a review task.

## Engine contracts (pure functions)

- `src/engine/ami` — `getThreshold({ countyFips, householdSize, capPct?, table? })` returns
  `{ thresholdCents, medianIncomeCents, multiplier, capPct, area: { code, name, metro }, county: { fips, name },
  source, tableVersion, effectiveDate, provisional, method }`. The limit is
  `300% × area median × HUD family-size multiplier` (0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32, then
  +0.08 per extra person) as described in the proposed rule. Data is a versioned JSON dataset in
  `data/ami/` produced by `npm run ami:ingest` from the official HUD file in `data/hud/`; when the IRS
  publishes its limitation table the same job ingests it and it becomes the source of truth.
- `src/engine/geo` — ZIP → candidate Texas counties (Census ZCTA relationship data in `data/geo/`),
  county lookup and name normalization, plus an online address geocoder adapter (used by a service, the
  pure part only parses).
- `src/engine/income` — income categories (what counts as household cash income), annualization helpers,
  `computeHouseholdIncome(items)`.
- `src/engine/decision` — `decide(input): Decision` for the direct and categorical methods, including
  review reasons, the provisional review band, SGO stricter caps, and result validity.
- `src/engine/documents` — `classifyDocument(text)`, `extractDocument(text, kind)` with per-field
  confidence, plus synthetic sample generators used by tests and demos.
- `src/engine/evidence` — `buildEvidenceRecord(...)`, `signEvidenceRecord(...)`, `verifyEvidenceRecord(...)`,
  `renderEvidencePdf(...)`.
- `src/taxmath` — `previewCredit(input)`, the constants (cap, start date, carryforward years), the fee
  structures, and every sentence of tax copy with a version id.

## Money rules (do not improvise)

- The designated section 25F amount and any platform fee are always separate lines. A fee is never
  described as part of the qualified contribution.
- Three fee structures exist in code (`none`, `sgo_invoiced`, `donor_service_fee`). The active one is a
  platform setting that defaults to `none` and can only be changed by a platform admin recording the
  counsel memo reference. No percentage of a live 25F gift is taken before that.
- Credit-eligible checkout is held behind the credit start date (January 1, 2027) AND the SGO being on the
  IRS SGO list at the moment of the gift (Texas has only an advance election; its list is due February 15,
  2027, and a gift to an organization that is not yet listed is not treated as credit-eligible). Before
  both are true, sandbox gifts work and are plainly marked as not credit-eligible.
- A donor may designate all or part of a payment as a qualified contribution. The designation is made at
  the time of payment, recorded with the exact words shown, and is irrevocable: there is no un-designate
  and no self-serve refund of a designated gift.
- With Stripe, a designated gift is a direct charge on the SGO's own connected account, so the money never
  sits in the platform's balance. Other settlement shapes need counsel sign-off first.
- The official acknowledgment is per donor, per SGO, per calendar year (SGO EIN, total designated, unique
  donor number, goods-or-services statement and value) and is due by January 31. The immediate email
  receipt is not the acknowledgment. Unique donor numbers come from the IRS SGO portal; we never invent
  real ones. Donor SSNs/TINs are not collected.
- Family-side fees do not exist. The business (camp, school, vendor) is invoiced for the success fee on
  its own account. The fee is never taken from the family and never netted from scholarship funds.
- Checkout is for individuals only.

## Copy rules (legal accuracy)

- Proposed-regulation content is never presented as settled law. Use "under the proposed rules".
- Never say or imply the IRS limitation table has been published until it has (`threshold_source`).
- Never call a gift "free" without the qualifiers: nonrefundable, only up to the donor's tax liability,
  up to the cap, and excluding any fee paid on top.
- The tax-math panel is a preview, not tax advice, and never invents the donor's tax liability.
- The SGO list is labeled provisional until the IRS list is the source.
- Consent text says who receives what, for what purpose and for how long; each grant stores the copy
  version, a hash of the exact words, and a timestamp.
- All tax and consent copy lives in versioned copy modules (`src/taxmath/copy.ts`,
  `src/server/consents/copy.ts`), not inline in components.
- Citations for these rules are in `docs/reference/`.

## Events and webhooks

Services call `emitEvent(orgId, type, payload, mode)`; the webhook dispatcher delivers each event to the
organization's subscribed endpoints with signed requests (Standard Webhooks headers), retries with
backoff, and records every attempt. Event types: `verification.started`, `verification.submitted`,
`verification.needs_review`, `verification.decided`, `verification.expired`, `verification.canceled`,
`donation.succeeded`, `donation.refunded`, `acknowledgment.issued`, `handoff.started`, `handoff.held`,
`handoff.eligible`, `handoff.awarded`, `handoff.declined`, `handoff.expired`, `handoff.completed`,
`award.offered`.

## Jobs

`enqueue(type, payload, { runAt?, dedupeKey?, maxAttempts? })` writes to `jobs`; handlers are registered
per domain in `src/server/<domain>/jobs.ts` and collected in `src/server/jobs/registry.ts`. One job type has
exactly one handler; cross-domain reactions use purpose-specific job types (for example the payments
service enqueues `donation.payment_updated` or `invoice.payment_updated` depending on what was paid). Recurring
work (`retention.purge`, `handoff.expire_holds`, `verification.expire`, `acknowledgment.annual`,
`webhook.retry`) is scheduled by `scheduleRecurring()`.

## Testing

- Unit tests sit next to the code (`*.test.ts`) and run with `npm test` (Vitest).
- Service tests use `useTestDb()` from `tests/helpers/db.ts` (a fresh in-memory Postgres per file).
- End-to-end tests are in `tests/e2e` (Playwright) and run against a dev server on the embedded database.
- Fixtures are synthetic only. No real family documents, ever.
