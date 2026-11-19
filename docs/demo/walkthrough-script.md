# Passport walkthrough — script

The video (`passport-walkthrough.mp4`, 10:53) read as text: every title card and every caption, with the time it appears. Recorded 2026-11-19 against the seeded sandbox. Everything shown is synthetic.

## 0:00 — Chapter 0: What this is

**[0:00] Title card**

> Passport · walkthrough: Income verification and tax-credit giving for the federal scholarship tax credit
> Texas first, built to the October 2026 proposed rules (not final).
> One app, three pieces, one shared verification engine.

**[0:09] Title card**

> The three pieces: Who uses what
> Donor checkout — donors give to a listed scholarship organization (SGO).
> Family intake — a parent verifies household income once.
> Verification core — the SGO's dashboard and API: decisions, review, evidence.

**[0:18] Title card**

> What you are about to see: Eight short chapters
> The website, then a family verifying on a phone.
> The SGO dashboard — the longest part: it is what an SGO buys.
> A donor's gift, the camp handoff, your admin console, what is real.

## 0:36 — Chapter 1: The website

**[0:36] Title card**

> Chapter 1: The website
> The public home page at /: what Passport is, the key dates, and the ground rules it is built on.

- **[0:41]** The home page: one line on what Passport does, and the dates that drive everything — the credit starts January 1, 2027.
- **[0:49]** Key facts from the statute and proposed rules: the $1,700 cap per taxpayer and the 300%-of-area-median income limit.
- **[0:56]** How it works: a sample sheet of paperwork is scanned and melts into a single answer.
- **[1:16]** The result chip: eligible, labeled provisional — because the IRS has not published its own income limits yet.
- **[1:23]** The ground rules, stated up front: proposed rules, provisional limits, eligible is not an award, families never pay.
- **[1:33]** Each audience has its own door: donors give, families apply, organizations verify, camps add the button.

## 1:40 — Chapter 2: A family verifies (phone)

**[1:40] Title card**

> Chapter 2: A family verifies
> On a phone, from the SGO's link.
> Families never pay. Eligible is not a promise of an award.

- **[1:52]** The SGO sent this family a link. The page says who is asking, what will happen, and that checking income is not a promise of a scholarship.
- **[2:03]** No password: a single-use code is emailed. In this sandbox emails land in the development outbox at /dev/mail.
- **[2:12]** Permission first, in plain language: who gets what, for what purpose and for how long. The exact wording and its version are stored.
- **[2:23]** Checking the box is the parent's written instruction to share — the consumer-directed design the FCRA constraint calls for.
- **[2:31]** The address decides the Texas county, and the county decides the income limit.
- **[2:34]** Resolved to Harris County. If a ZIP spans counties the family picks — a wrong county would be a wrong limit, so it is never guessed.
- **[2:42]** Household size follows the proposed household definition: the student and everyone living with them.
- **[2:45]** Shared custody is never guessed: if the student lives in two homes, the answers go to a reviewer.
- **[2:51]** Upload, or connect a licensed payroll or bank rail (simulated here). Switching loses nothing.
- **[2:57]** A SNAP approval letter dated within 12 months proves eligibility by the categorical method. This one is synthetic.
- **[3:04]** Result: a person will look. The TF0001 letter layout is not yet verified, so the engine never says yes on it alone — no silent yes.
- **[3:13]** Families never pay to verify. And eligible is not a promise of a scholarship: the SGO decides awards separately.

## 3:17 — Chapter 3: The SGO dashboard

**[3:17] Title card**

> Chapter 3: The SGO dashboard
> What a scholarship organization buys: the queue, the decisions, human review, evidence packs, giving records and the API.
> Signed in as the owner of “Demo: Lone Star Scholarship Fund (sandbox)”, a fictional sandbox SGO.

- **[3:28]** Home: what needs attention — cases waiting for a reviewer, donors who need donor numbers, setup steps left.
- **[3:35]** Verifications by status, with the reminders built in: limits are provisional, and eligible is not an award.
- **[3:42]** The verification queue: every family the SGO asked to verify, with status and the SGO's own reference.
- **[3:49]** The review queue: what the engine could not decide, oldest first, each with the reason in plain words.
- **[3:56]** This is the family from chapter 2. A reviewer reads the letter and confirms what it shows.
- **[4:09]** Eligible by the categorical method: SNAP approval dated within 12 months. Marked PROVISIONAL, because the limit table is HUD-derived.
- **[4:18]** The limit used, its source, table version and effective date are recorded with every decision.
- **[4:24]** The timeline: every step by the family, the system and the reviewer.
- **[4:29]** Starr County. The proposed rule can be read two ways, and here the readings differ: $92,880 versus $201,000 for two people.
- **[4:37]** This household's income falls between them. The engine decides only where both readings agree, so a person decides this one.
- **[4:45]** A W-2 case read automatically and decided by the engine: direct method, prior-year wages compared with the Travis County limit.
- **[4:53]** Every decided case has an evidence pack: a PDF for people and a signed JSON record for machines. Downloads are audited.
- **[5:02]** The evidence pack PDF: decision, method, household, area, the limit, its source and both readings.
- **[5:11]** Extracted fields, file hashes instead of raw files, the consent record with version and timestamp, and who reviewed what.
- **[5:23]** The same facts as a signed JSON record (Ed25519). Anyone can check it against /.well-known/jwks.json with npm run evidence:verify.
- **[5:30]** Back to the review queue: a family uploaded a phone photo of a W-2. Photos have no text layer, so nothing is guessed.
- **[5:39]** The reviewer opens the file. Opening it is written to the audit log.
- **[5:45]** The reviewer keys the figure from the photo: 2025 W-2 wages, box 1.
- **[5:52]** The engine decides again with the keyed figure: eligible, direct method. The evidence pack records that a reviewer keyed it.
- **[6:00]** Donations: each gift's designated amount, kept separate from any fee.
- **[6:05]** Acknowledgments: one per donor per year, with the SGO's EIN and a unique donor number from the IRS SGO portal — never invented.
- **[6:12]** The IRS report: the annual contribution report, due February 28.
- **[6:17]** Developers: test API keys (stored only as hashes) and webhook endpoints with a log of every signed delivery.
- **[6:25]** The API docs: create a verification, read it, get a signed webhook when it is decided.

## 6:33 — Chapter 4: A donor gives

**[6:33] Title card**

> Chapter 4: A donor gives
> Individuals only, to an SGO on the list.
> Before January 1, 2027 gifts work in the sandbox and are plainly marked not credit-eligible.

- **[6:40]** Search is limited to listed SGOs. Until the IRS publishes its list, the list is our provisional one — and it says so.
- **[6:51]** The tax-math panel: $1,700 cap, joint returns, state-credit reduction, nonrefundable, five-year carryforward. A preview, never tax advice.
- **[7:00]** The banner: a sandbox gift, not credit-eligible — the credit starts January 1, 2027, the list is provisional, and the SGO is not portal-registered.
- **[7:11]** Name and address for the acknowledgment and the IRS report. No Social Security number or TIN is ever collected.
- **[7:18]** Individuals only; no earmarking for a named student; and the designation in exact words, made at the time of payment.
- **[7:28]** The designation is irrevocable and stored with the exact words and their hash. There is no un-designate and no self-serve refund.
- **[7:35]** The designated amount and any fee are always separate lines. With the fee structure at none, there is no fee at all.
- **[7:42]** Sandbox payment with a test card number: no money moves. In production this is a Stripe charge on the SGO's own account.
- **[7:51]** The immediate receipt — not the official acknowledgment, which the SGO sends by January 31 with the unique donor number.
- **[7:59]** The receipt email, as the development outbox recorded it. In production it is sent through an email provider.

## 8:07 — Chapter 5: The camp handoff

**[8:07] Title card**

> Chapter 5: The camp handoff
> A fictional summer camp's checkout with a “Pay with a scholarship” button.
> The camp pays the success fee on its own invoice. The family never pays; scholarship funds are never touched.

- **[8:16]** Camp Cedar Creek is a fictional booking site that installs the real embed script. Pick a session.
- **[8:22]** At checkout the family can pay with a scholarship. The camp's page receives events as the handoff moves.
- **[8:31]** The family's handoff page: the spot is held until a stated deadline. Free for families; no promise of a scholarship.
- **[8:39]** The camp's partner portal. Booking CCC-DEMO-0001 (seeded): that family submitted, so the spot is held while the SGO reviews.
- **[8:48]** On the SGO side, the reviewer confirms that family's SNAP letter.
- **[9:00]** Eligible. An award is a separate, explicit decision of the SGO — never automatic after verification.
- **[9:09]** Back in the camp's portal, CCC-DEMO-0001 now reads Awarded. The camp completes the booking; its success fee goes on its own invoice.

## 9:17 — Chapter 6: Your admin console

**[9:17] Title card**

> Chapter 6: Your admin console
> Platform-admin only: the legal switches, the income-limit table, and the audit log.

- **[9:23]** Gates & fees. The fee structure stays at none: the rules do not say how a platform fee on a 25F gift is treated.
- **[9:30]** Choosing another structure is refused without counsel's memo reference and date — and every change is audited.
- **[9:38]** Live gifts stay off: only sandbox gifts are possible until you turn them on, after the credit date and the memo.
- **[9:45]** The income-limit table every decision uses: HUD FY 2026, provisional, 254 Texas counties. Swapping in the IRS table is one ingest job.
- **[9:54]** Look up any county: both readings for household sizes 1 to 8. Where they differ, incomes in between go to a person.
- **[10:01]** The audit log: every read of sensitive data and every change, newest first, never edited or deleted.

## 10:08 — Chapter 7: What is real, what is next

**[10:08] Title card**

> Chapter 7: What is real versus sandbox
> Real: the income engine for all 254 counties, decisions, review, evidence packs, the API, webhooks, the dashboards.
> Sandbox stand-ins: payments (no money moves), the payroll/bank rail, email (outbox), the SGO list (fictional).
> Every limit is labeled provisional until the IRS publishes its table.

**[10:22] Title card**

> Only you can supply: Outside accounts and sign-offs
> A Stripe account (on the parent's entity) and a data-rail contract (Plaid, Argyle, Pinwheel or Truv).
> Counsel's memos: the fee structure and the FCRA posture.
> IRS SGO portal registration (by each SGO), a domain, and an email sender.

**[10:33] Title card**

> Run it yourself: Three commands
> npm install  ·  npm run db:seed  ·  npm run dev
> Then open localhost:3000 — /sgo, /give, /demo/camp, /admin, /docs.
> Sign-in codes appear at /dev/mail. See README.md and docs/how-it-works.md.
