# Passport

Income verification and tax-credit giving for the federal scholarship tax credit (IRC section 25F), starting with
Texas. One Next.js app with three pieces:

| Piece | Who uses it | Where |
| --- | --- | --- |
| **Donor checkout** — give to a listed scholarship granting organization (SGO), see the credit math, designate the gift, pay, get a receipt; the SGO later issues the official acknowledgment and files the IRS report | Individual donors; SGO staff | `/give`, `/sgo/donations`, `/sgo/acknowledgments`, `/sgo/irs-report` |
| **Family intake** — a parent signs in with an emailed code, consents, describes the household, uploads proof of income (or connects a rail), from an SGO's link or from a camp's checkout ("point-of-booking handoff") | Parents; camps, schools and other vendors | `/v/{token}`, `/family`, `/h/{token}`, `/partner`, `/demo/camp` |
| **Verification core** — the Texas income engine (all 254 counties), decisions, human review, evidence packs (PDF + signed JSON), HTTP API, webhooks, SGO dashboard | SGO staff and their software | `/sgo`, `/api/v1`, `/docs` |

Plain-English explainer: [docs/how-it-works.md](docs/how-it-works.md). Architecture contract:
[docs/architecture.md](docs/architecture.md). Recorded walkthrough: [docs/demo/](docs/demo/README.md).

Built to the October 2, 2026 **proposed** regulations, which are not final. Income limits are HUD-derived and labeled
**provisional** until the IRS publishes its own table. Not tax or legal advice.

## Run it locally (3 commands)

Requires Node 22.13 or newer. No database, accounts or `.env` are needed: the app uses an embedded Postgres
(PGlite) in `.data/`, an email outbox instead of real email, a sandbox payment processor and a simulated data rail.

```bash
npm install
npm run db:seed      # demo data: two fictional SGOs, a camp, verifications in every state, gifts, a held booking
npm run dev          # http://localhost:3000
```

Run the seed while the dev server is **stopped** (the embedded database is opened by one process at a time). It is
idempotent; run it again any time. To start over: `npm run db:reset && npm run db:seed`.

### Where to click

| URL | What it is |
| --- | --- |
| [/](http://localhost:3000/) | Public home page |
| [/give](http://localhost:3000/give) | Donor checkout (sandbox gifts; not credit-eligible before January 1, 2027) |
| [/sgo](http://localhost:3000/sgo) | SGO dashboard: queue, review, evidence, donations, acknowledgments, IRS report, developers |
| [/partner](http://localhost:3000/partner) | Camp / school partner portal: handoffs, billing, install snippet |
| [/admin](http://localhost:3000/admin) | Platform admin console: gates & fees, SGO list, income limits, audit log, jobs, privacy requests |
| [/demo/camp](http://localhost:3000/demo/camp) | A fictional summer camp's booking site with the "Pay with a scholarship" button |
| [/docs](http://localhost:3000/docs) | API documentation (quickstart, verifications, webhooks, handoffs, evidence, errors) |
| [/dev/mail](http://localhost:3000/dev/mail) | Development outbox: every email the app "sent", including sign-in codes |
| [/styleguide](http://localhost:3000/styleguide) | Design-system components and page shells |

### Demo sign-ins

Sign in at `/sign-in` with one of these addresses; the 6-digit code and link appear at `/dev/mail`. Nothing is ever
delivered (the `.test` domain is reserved).

| Address | Lands on |
| --- | --- |
| `admin@passport.test` | `/admin` — platform admin |
| `director@lonestar-fund.passport.test` | `/sgo` — owner of "Demo: Lone Star Scholarship Fund (sandbox)" (API key, webhook, camp partner) |
| `reviewer@lonestar-fund.passport.test` | `/sgo/review` — reviewer at the same SGO |
| `director@bluebonnet-partners.passport.test` | `/sgo` — a second SGO (shows tenant isolation) |
| `director@camp-cedar-creek.example` | `/partner` — the demo camp |
| `donor@passport.test` | `/donor` — a donor with a sandbox gift |

The seed also writes the sandbox API key and webhook signing secret to `.data/demo-credentials.json` (local only,
gitignored). Seeded verifications cover every state: eligible by SNAP letter (confirmed by a reviewer), eligible by
W-2, a Starr County case between the two readings of the limit (in review), an unreadable photo (in review), one
waiting on the family, one ineligible, plus a camp booking held while its family's letter is reviewed.

Sign-in is rate-limited per address (5 emails per 15 minutes) and per network; if you are told to wait, wait.

## Tests

```bash
npm test                     # unit and service tests (Vitest; each service file gets its own in-memory Postgres)
npm run test:e2e             # end-to-end (Playwright) against a dev server on a throwaway database (.data-e2e)
npm run typecheck && npm run lint
```

The end-to-end suite (`tests/e2e`) creates everything it needs through the product's own screens and API:

- `acceptance.spec.ts` — the spec's acceptance test: magic link → consent → household → synthetic text-layer W-2 PDF
  and a no-other-income statement → decided automatically (eligible, provisional) → the SGO's signed evidence JSON
  verifies against `/.well-known/jwks.json` → PDF.
- `review.spec.ts` — an unreadable scan resolved from the review queue; asking the family for more.
- `donor.spec.ts` — admin lists an SGO, donor gives in the sandbox, sees the not-credit-eligible banner, gets the
  receipt email.
- `handoff.spec.ts` — `/demo/camp` → synthetic SNAP letter → spot held → a reviewer confirms the letter → SGO award →
  the camp sees "Awarded".
- `isolation.spec.ts` — SGO B cannot open, download or list SGO A's verification (dashboard and API).
- `api.spec.ts` — API quickstart with a real key: create → get → cancel → a signed webhook reaches a local listener.

Browsers: `npx playwright install chromium` if Playwright has none. The suite's config deletes `.data-e2e` and
`.next-e2e` before it starts its dev server (a stale build directory can make pages reload in a loop). Do not run the
suite while another dev server from the same checkout is running.

## Environment variables

Everything has a local default (see `src/lib/env.ts` and `.env.example`). Production needs:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL (links in emails, webhook payloads, allowed embed origin) |
| `DATABASE_URL` | Postgres connection string (unset = embedded PGlite under `ECCA_DATA_DIR`) |
| `ECCA_MASTER_KEY` | 32 random bytes, base64 — wraps every encryption key. **Required in production** |
| `EVIDENCE_SIGNING_PRIVATE_KEY`, `EVIDENCE_SIGNING_KEY_ID` | Ed25519 key that signs evidence records; its public half is served at `/.well-known/jwks.json` |
| `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, `RESEND_API_KEY` | Real email (default `outbox`: nothing is sent) |
| `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe (default `sandbox`: no money moves) |
| `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage for uploads (same envelope encryption as local) |
| `RAIL_PROVIDER=plaid`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | A licensed payroll/bank rail (default `simulated`) |
| `ANTHROPIC_API_KEY` | Optional model-assisted reading of scans/photos; results always go to a person to confirm |
| `CRON_SECRET` | Bearer secret for `/api/internal/jobs/run` (the endpoint is closed in production without it) |
| `JOBS_INLINE` | `false` on web processes when a separate worker runs |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated addresses granted platform admin on first sign-in |

`ECCA_FAKE_NOW` moves the clock for demos and tests (ignored in production).

## Deploying (Vercel + Postgres + cron or a worker)

1. Create a Postgres database (Neon, Supabase, RDS…) and an S3-compatible bucket.
2. Generate the keys: `openssl rand -base64 32` (master key), `openssl genpkey -algorithm ed25519` (evidence key).
3. Set the variables above in the Vercel project. Set `APP_URL` to the production origin.
4. Run `npm run db:migrate` against `DATABASE_URL` on every deploy, before the new code serves traffic. The SQL
   migrations are committed in `./drizzle`; after a schema change, run `npm run db:generate` and commit the new file.
5. Background jobs (document reading, decisions, evidence, webhooks, retention purges, hold expiry): either
   schedule a Vercel Cron hitting `GET /api/internal/jobs/run?drain=1` every minute with
   `Authorization: Bearer $CRON_SECRET`, or run `npm run worker` on a long-running host with `JOBS_INLINE=false`.
6. Import the real SGO list at `/admin/sgo-list` (the sandbox list is refused in production, as are 00- EINs).
7. For Stripe, point the webhook at `/api/webhooks/stripe`; for Plaid, at `/api/webhooks/plaid`.

## What is not production-ready yet

Honest list; details and owners in [docs/how-it-works.md](docs/how-it-works.md).

- **Legal sign-offs are missing.** No live section 25F gift may be taken before counsel's fee-structure memo; the FCRA
  posture memo is needed before production personal data. The fee structure is locked at "none" until then.
- **Outside accounts are not connected:** Stripe (on the parent's entity), a licensed data rail (Plaid sandbox adapter
  exists; no contract), an email sender and domain, IRS SGO portal registration (per SGO) for real unique donor
  numbers.
- **The IRS limitation table and SGO list do not exist yet.** Limits are HUD-derived and provisional; the SGO list is
  a curated provisional one. Swapping in the IRS table is one ingest job (`docs/runbooks/irs-table-swap-in.md`).
- **Uploaded PDFs are not read in the running dev server** (they come back as "damaged"), so in the app every PDF
  currently goes to human review; the parsers work in tests and in the seed. Cause under investigation by the
  documents/database owners (pdfjs and an enumerable `Array.prototype` addition from the embedded database's schema
  tool). Scans and photos always go to review by design.
- **Undecided handoffs reach the camp on a five-minute sync**, not instantly; decisions are instant.
- **Security program:** policies are drafts ([security](docs/security-policy.md),
  [retention and deletion](docs/data-retention-and-deletion-policy.md)); no penetration test, no SOC 2 yet.
- **Proposed rules may change** (verification methods, designation, acknowledgments, joint returns); the engine and
  all tax copy are isolated so they can be updated in one place.
