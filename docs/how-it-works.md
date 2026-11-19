# How Passport works — a plain-English guide

For the founder. What the product does, who uses each part, what happens step by step (and which rule each step
exists for), what is real and what is a sandbox stand-in, and where each part of the build spec lives in the code.
The rules quoted here come from the build spec and the research notes in `docs/reference/`; this is not legal
advice, and the October 2026 regulations it follows are **proposed, not final**.

## The three pieces and who uses each

| Piece | Who | What they do |
| --- | --- | --- |
| **1. Donor checkout** | Individual donors; SGO staff | A donor finds a listed scholarship granting organization (SGO), enters a gift, sees a preview of the federal credit, designates the gift as a section 25F qualified contribution, pays, and gets an immediate receipt. The SGO later sends the official acknowledgment (by January 31) and files the annual report to the IRS (by February 28). |
| **2. Family intake** | Parents; camps, schools, tutoring vendors | A parent verifies household income once — from an SGO's link, or in the middle of a camp's booking checkout — with no password and no fee. |
| **3. Verification core** | SGO staff and their software vendors | The engine that decides "under the 300% limit or not", the human-review queue for what it cannot decide, the evidence pack an auditor can check, the API and webhooks, and the SGO dashboard. |

Money comes in through piece 1 (a platform cut on gifts, **not switched on** until counsel decides how it may be
structured). Families come in through piece 2; the camp or school, not the family, pays a success fee on its own
invoice. Piece 3 is what both depend on and what an SGO is required to do by law: verify household income and keep
proof.

## One family's verification, in order

1. **The SGO creates a verification** (dashboard "New verification", or `POST /api/v1/verifications`). It gets a
   one-time family link `/v/{token}` (valid 30 days, stored only as a hash). *Why:* the link is a credential; the
   SGO decides who to invite.
2. **The parent signs in with an emailed 6-digit code or link** (single-use, 15 minutes). First use creates the
   household account; later uses sign the same person back in. *Why:* the spec's magic-link accounts — nothing to
   remember, and the household ID is durable so a result can be reused with a second SGO ("passport").
3. **Permission.** Plain language: who receives what, for what purpose, for how long (until a fixed date; uploads
   deleted after the SGO's retention window). The parent checks a box. The exact wording, its version and a hash of
   the words are stored with a timestamp. *Why:* the FCRA constraint — a consumer-directed design where the parent
   instructs the share in writing — and the spec's consent rule (copy version + timestamp).
4. **Address → county.** The address goes to the Census geocoder; if that fails, a ZIP wholly inside one county is
   used; otherwise the family picks from the candidate counties. *Why:* the county decides the HUD income-limit area,
   and several counties share one area. A wrong county is a wrong limit, so the largest ZIP share is never guessed.
5. **Household members.** The parent, the student and everyone living with them. *Why:* household size follows the
   proposed household definition (the student and the people residing with them) and changes the limit.
6. **Shared custody.** "Did the student live in more than one home?" Unclear answers go to a reviewer. *Why:* the
   proposed rules look to the home where the student lived longest (or the higher income if equal); the spec says
   flag it, never guess.
7. **Upload or connect.** Upload a benefits letter (SNAP, TANF, WIC, Section 8 or SSI, dated within 12 months) or
   prior-year income documents (tax return, IRS transcript, W-2s, pay stubs) — or connect a payroll/bank rail
   (simulated here). Switching paths loses nothing. *Why:* the spec's upload-or-auto-submit toggle; no scraping of
   state portals.
8. **Submit → the engine.** Each document is read (text-layer PDF parsers; photos and scans go to a person; optional
   model reading is always confirmed by a person). The decision engine then:
   - **Categorical method:** an approved award letter for someone in the household, dated within the last 12 months.
     School-wide free lunch does not count (eligibility must be household-based).
   - **Direct method:** prior-year household cash income compared with the county limit for the household size
     (non-cash items such as a Section 8 housing allowance are not counted).
   - Outcome: **eligible**, **ineligible** (only when the evidence affirmatively shows income over the limit), or
     **needs review**; missing evidence leaves it **pending** and the family is told exactly what is missing.
     *Why:* "failed parses must go to review, not to a silent yes".
9. **Human review** (SGO dashboard → Review queue). The reviewer opens the file (audited), keys or corrects fields,
   adds income lines, re-runs the check, resolves it with written notes, or asks the family for more. *Why:* the
   engine never guesses; the reviewer's actions go into the evidence pack.
10. **Evidence pack.** For every decided case: a PDF for people and a signed JSON record (Ed25519) for machines —
    decision, method, household size, area, limit with its source and effective date, both readings, extracted
    fields, file hashes (not raw files), the consent record, and who reviewed what. Anyone can check the signature
    against `/.well-known/jwks.json` (`npm run evidence:verify -- record.json --jwks <url>`). *Why:* the spec's
    evidence-file requirement and the Emmy reference design.
11. **Webhook + email.** `verification.decided` goes to the SGO's endpoints, signed (Standard Webhooks); the family is
    told the outcome — always with "being eligible is not a promise of a scholarship".
12. **Award (separate).** Only the SGO can offer an award, on the verification page or by API. *Why:* verification
    does not promise an award; the camp is never told it will be paid.
13. **Later.** Raw uploads are deleted after the SGO's retention window (default 30 days after the decision); the
    decision, fields and hashes are kept. The result expires (it is tied to the income year); a second SGO can reuse a
    still-valid result with a fresh consent.

### At a camp: the point-of-booking handoff

The camp installs a button (embed script) or redirect on its checkout. The family presses "Pay with a scholarship";
the camp's reservation is **held** for a stated window (default 72 hours) instead of silently dropping the sale. The
family verifies with the camp's partner SGO exactly as above. The camp sees only booking-level statuses — started,
spot held, eligible, awarded, declined, expired, completed — never income, documents or reasons, and gets webhooks.
When the SGO awards and the booking is completed, the camp's success fee accrues on the camp's own monthly invoice.
The family never pays; the fee is never taken from scholarship funds.

## One donor's gift, in order

1. **Find the SGO** at `/give`. Only organizations on the list can be chosen; until the IRS publishes its list, the
   list is our curated provisional one and every surface says so. *Why:* a gift to an organization not on a valid
   list does not earn the credit.
2. **Gift amount and designated amount**, with the note that a gift cannot be earmarked for a named student.
3. **The tax-math panel** (a preview, not tax advice): the $1,700 cap per taxpayer; joint returns as two taxpayers
   (up to $3,400 if each spouse gives); the reduction for any state credit the donor enters; nonrefundable (only
   helps if the donor owes enough federal tax — the panel never invents the donor's tax liability); five-year
   carryforward; no double benefit under section 170. All numbers and sentences come from one versioned module
   (`src/taxmath`).
4. **"Not credit-eligible yet" banner** before both conditions hold: the gift is made on or after January 1, 2027
   (the checkout waits until that date has begun in every U.S. state, since the rules do not name a time zone) **and**
   the SGO is on the IRS list at the moment of the gift. Sandbox gifts also say "no money moves". The reasons are
   listed one by one.
5. **About you:** filing status, name and address as on the tax return (for the acknowledgment and the IRS report),
   email. No Social Security number or TIN is collected anywhere. Individuals only (no partnerships, S corporations,
   trusts or donor-advised funds).
6. **Confirm:** attestations, the designation in exact words ("I designate $X of this payment to … as a qualified
   contribution under Internal Revenue Code section 25F"), irrevocable, and consent to electronic delivery of the
   acknowledgment. The words, their version and hash are stored with the gift.
7. **Review and pay:** the designated amount and any platform fee are always separate lines; under the default "none"
   structure there is no fee. Sandbox: pay with a test number. With Stripe: a direct charge on the SGO's own
   connected account, so the money never sits with the platform.
8. **Receipt** (page and email): explicitly *not* the official acknowledgment.
9. **The SGO's side:** donations list and CSV export; acknowledgments per donor, per SGO, per year with the SGO's EIN,
   total designated, unique donor number (from the IRS SGO portal — never invented; sandbox numbers are labeled not
   valid for filing) and the goods-or-services statement, due January 31; the IRS report file (name, address, donor
   number, aggregate designated), due February 28.

## "Provisional" and the two readings

- **Provisional.** The proposed rules say the IRS expects to publish income limits by area and family size. Until it
  does, Passport computes limits from HUD's FY 2026 income limits (effective May 1, 2026) for all 254 Texas counties.
  Every decision records the limit, its source (`hud_provisional`), table version and effective date, and every
  surface — API, dashboard, PDF, family screen — labels the result **provisional**. When the IRS table exists, one
  ingest job swaps it in (`docs/runbooks/irs-table-swap-in.md`) and it becomes the source of truth.
- **Two readings.** The proposed rule can be read two ways: 300% × area median × HUD family-size multiplier, or 6 ×
  HUD's Section 8 very-low-income limit. They differ in 143 of 254 Texas counties (`docs/reference/sgo-verification-rules.md`).
  The engine decides automatically only where both agree: at or below the lower limit is eligible, above the higher
  one is ineligible, and anything in between goes to a person. Both figures are shown everywhere. Example from the
  demo: Starr County, household of two — $92,880 under one reading, $201,000 under the other.

## Real versus sandbox, and what needs outside accounts or counsel

| Area | In this build | Needs before production |
| --- | --- | --- |
| Income engine, decisions, review, evidence packs, API, webhooks, dashboards, handoff, billing ledger | Real code, tested | The IRS limitation table and IRS SGO list when published |
| Payments | Sandbox processor (no money moves); Stripe adapter written (PaymentIntents, Invoicing, webhooks) | **A Stripe account on the parent's entity**, nonprofit rates, each SGO's connected account |
| Fee on gifts | Three structures coded; locked at "none" | **Counsel's fee-structure memo** (admin must record its reference and date to change it) |
| Data rail (auto-submit) | Simulated rail; Plaid adapter written | **A rail contract** (Plaid, Argyle, Pinwheel or Truv) through the parent's entity |
| FCRA posture | Consumer-directed consent design | **Counsel's FCRA memo** before production personal data |
| Email | Outbox viewable at `/dev/mail` | **A domain and an email sender** (Resend adapter written) |
| Unique donor numbers | Sandbox numbers labeled not valid for filing | **IRS SGO portal registration** by each SGO |
| SGO list | Fictional sandbox list (refused in production) | The state lists (due February 15, 2027) / IRS list |
| Document reading | Text-layer parsers; photos to people; optional model reading | Verified layouts for more letter formats (TF0001 and others stay in human review until verified) |

## Where each spec section lives

| Spec section | In the app | In the code |
| --- | --- | --- |
| Context and constraints — $1,700 cap, 300% limit, Jan 1 2027, Feb 15 2027 | Home page key dates; checkout banner; dashboard reporting calendar | `src/taxmath` (constants, copy), `src/engine/ami` |
| Constraint: FCRA | Permission screen | `src/server/consents` (copy versions + hashes), `src/features/intake` |
| Constraint: no portal scraping | Upload or licensed rail only | `src/server/rails`, `src/engine/documents` |
| Constraint: data security | — | `src/lib/crypto`, `src/server/storage`, `src/server/audit`, `docs/security-policy.md`, `docs/data-retention-and-deletion-policy.md` |
| Constraint: proposed rules not final | "Under the proposed rules", provisional labels everywhere | `src/taxmath/copy.ts`, `src/engine/ami/labels.ts` |
| Business model 1 — cut of donor gifts | `/admin/gates` (fee structure, counsel memo) | `src/server/fees`, `src/server/settings`, `src/taxmath` fee structures |
| Business model 2 — the business pays | `/partner/billing` | `src/server/billing`, `src/server/payments/invoices.ts` |
| Piece 1 — screens, SGO search, designation, joint split | `/give`, `/give/{slug}`, `/embed/give/{slug}` | `src/server/donations`, `src/features/checkout`, `src/app/give` |
| Piece 1 — tax-math panel | Checkout sidebar | `src/taxmath` (`previewCredit`) |
| Piece 1 — fee and settlement | Checkout "What you will be charged"; `/admin/gates` | `src/server/payments`, `src/server/fees` |
| Piece 1 — acknowledgment, donor numbers, IRS report | `/sgo/acknowledgments`, `/sgo/irs-report`, `/donor` | `src/server/acknowledgments` |
| Piece 2 — magic-link accounts | `/sign-in`, `/v/{token}` | `src/server/auth` |
| Piece 2 — consent and household screens, custody | `/v/{token}/consent`, `/address`, `/people`, `/custody` | `src/server/households`, `src/server/consents`, `src/features/intake` |
| Piece 2 — upload or auto-submit | `/v/{token}/path`, `/upload`, rail screens | `src/server/verifications/documents.ts`, `src/server/rails` |
| Piece 2 — point-of-booking handoff | `/demo/camp`, `/h/{token}`, `/embed/handoff`, `/partner` | `src/server/handoffs`, `src/server/businesses`, `src/features/handoff` |
| Piece 2 — passport reuse | Family screens; `passport` in the API | `src/server/verifications/passport.ts` |
| Piece 3 — Texas income engine (254 counties, HUD ingest) | `/admin/income-limits` | `src/engine/ami`, `src/engine/geo`, `data/ami`, `scripts/ami-ingest.ts` |
| Piece 3 — what the engine computes; methods in v1 | Verification page "Decision" | `src/engine/income`, `src/engine/decision`, `src/server/verifications/decide.ts` |
| Piece 3 — evidence file generation | "Evidence pack" links | `src/engine/evidence`, `src/server/verifications/evidence.ts`, `scripts/verify-evidence.ts` |
| Piece 3 — API SGOs plug into | `/docs`, `/sgo/developers` | `src/app/api/v1`, `src/server/api`, `src/server/webhooks`, `src/server/events` |
| Piece 3 — SGO dashboard | `/sgo` | `src/app/sgo`, `src/features/sgo` |
| Piece 3 — IRS table swap-in job | — | `docs/runbooks/irs-table-swap-in.md`, `src/engine/ami/ingest` |
| Build order step 2 — "a fake household can go from magic link to evidence pack" | — | `tests/e2e/acceptance.spec.ts` |
| Build order step 4 — hold credit-eligible checkout behind Jan 1 2027 | Checkout banner | `src/taxmath`, `src/server/donations` |
| Shared stack — Next.js, Postgres, encrypted storage, job queue | — | `src/db`, `src/server/storage`, `src/server/jobs`, `scripts/worker.ts` |

## Seeing it yourself

`README.md` has the three commands and the demo sign-ins; `docs/demo/passport-walkthrough.mp4` is the recorded
walkthrough and `docs/demo/walkthrough-script.md` the same video as text.
