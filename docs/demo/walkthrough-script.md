# Passport walkthrough — script

The video (`passport-walkthrough.mp4`, 9:42) read as text: every title card and every caption, with the time it appears. Recorded 2026-11-19 against the seeded sandbox. Everything shown is synthetic.

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

## 0:27 — Chapter 1: The website

**[0:27] Title card**

> Chapter 1: The website
> The public home page at /: what Passport is, the key dates, and the ground rules it is built on.

- **[0:33]** The home page: one line on what Passport does, and the dates that drive everything — the credit starts January 1, 2027.
- **[0:40]** Key facts from the statute and proposed rules: the $1,700 cap per taxpayer and the 300%-of-area-median income limit.
- **[0:48]** How it works: a sample sheet of paperwork is scanned and melts into a single answer.
- **[1:06]** The result chip: eligible, labeled provisional — because the IRS has not published its own income limits yet.
- **[1:14]** The ground rules, stated up front: proposed rules, provisional limits, eligible is not an award, families never pay.
- **[1:24]** A door for each audience: donors, families, organizations, camps.

## 1:24 — Chapter 2: A family verifies (phone)

**[1:27] Title card**

> Chapter 2: A family verifies
> On a phone, from the SGO's link.
> Families never pay. Eligible is not a promise of an award.

- **[1:35]** The SGO sent this family a link. The page says who is asking, what will happen, and that checking income is not a promise of a scholarship.
- **[1:45]** No password: a single-use code is emailed. In this sandbox emails land in the development outbox at /dev/mail.
- **[1:55]** Permission first, in plain words: who gets what, why and for how long. The exact wording and its version are stored.
- **[2:05]** Checking the box is the parent's written instruction to share (the consumer-directed design the FCRA calls for).
- **[2:13]** The address decides the Texas county, and the county decides the income limit.
- **[2:16]** Resolved to Harris County. A ZIP that spans counties is never guessed: the family picks.
- **[2:21]** Household size follows the proposed household definition: the student and everyone living with them.
- **[2:25]** Shared custody is never guessed: if the student lives in two homes, the answers go to a reviewer.
- **[2:32]** Upload, or connect a payroll or bank account (simulated here).
- **[2:36]** A 2025 W-2, synthetic. It is a PDF with a text layer, so it is read right away; nobody has to type it in.
- **[2:46]** A W-2 shows wages only, so the parent also signs that the household had no other income.
- **[2:54]** Sent. The engine checks the W-2 and the statement against the limit for the family's county.
- **[2:56]** Decided on the spot, with no person needed: the household's 2025 income is under the income limit for its county.
- **[3:04]** The limit is provisional, and being eligible is not a promise of a scholarship. Families never pay.

## 3:10 — Chapter 3: The SGO dashboard

**[3:10] Title card**

> Chapter 3: The SGO dashboard
> What a scholarship organization buys: the queue, the decisions, human review, evidence packs, giving records and the API.
> Signed in as the owner of “Demo: Lone Star Scholarship Fund (sandbox)”, a fictional sandbox SGO.

- **[3:21]** Home: what needs attention — cases waiting for a reviewer, donors who need donor numbers, setup steps left. Limits are provisional; eligible is not an award.
- **[3:31]** Every family the SGO asked to verify, with status and the SGO's own reference.
- **[3:38]** The family from chapter 2. Their W-2 was read and the engine decided: eligible by the direct method, decided automatically.
- **[3:46]** The limit used is labeled PROVISIONAL (HUD-derived). Its source, table version and effective date are recorded with the decision.
- **[3:54]** Every decided case has an evidence pack: a PDF for people and a signed JSON record for machines. Downloads are audited.
- **[4:03]** The evidence pack PDF: decision, method, household, area, the limit, its source and both readings.
- **[4:11]** Extracted fields, file hashes instead of raw files, and the consent record with its version and timestamp.
- **[4:20]** The same facts as a signed JSON record (Ed25519). Anyone can check it against /.well-known/jwks.json with npm run evidence:verify.
- **[4:29]** The review queue: what the engine could not decide, oldest first, each with a short reason.
- **[4:35]** Starr County. The proposed rule can be read two ways, and here the readings differ: $92,880 versus $201,000 for two people.
- **[4:43]** This household's income falls between them. The engine decides only where both readings agree, so a person decides this one.
- **[4:51]** Another case from the queue: a phone photo of a W-2. Photos have no text layer, so nothing is guessed from it.
- **[4:58]** The reviewer opens the file. Opening it is written to the audit log.
- **[5:03]** The reviewer keys the figure from the photo: 2025 W-2 wages, box 1.
- **[5:11]** The engine decides again with the keyed figure: eligible, direct method. The evidence pack records that a reviewer keyed it.
- **[5:19]** Donations: each gift's designated amount, kept separate from any fee.
- **[5:24]** Acknowledgments: one per donor per year, with a unique donor number from the IRS SGO portal — never invented.
- **[5:30]** The IRS report, due February 28.
- **[5:35]** Developers: test API keys (stored only as hashes) and webhook endpoints with a log of every signed delivery.
- **[5:41]** The API docs: create a verification, read it, get a signed webhook when it is decided.

## 5:48 — Chapter 4: A donor gives

**[5:48] Title card**

> Chapter 4: A donor gives
> Individuals only, to an SGO on the list.
> Before January 1, 2027 gifts work in the sandbox and are plainly marked not credit-eligible.

- **[5:56]** Search is limited to listed SGOs. Until the IRS publishes its list, the list is our provisional one — and it says so.
- **[6:08]** The tax-math panel: $1,700 cap, joint returns, state-credit reduction, nonrefundable, five-year carryforward. A preview, never tax advice.
- **[6:17]** The banner: a sandbox gift, not credit-eligible yet. The credit starts January 1, 2027, and the list is provisional.
- **[6:27]** Name and address for the acknowledgment and the IRS report. No Social Security number or TIN is ever collected.
- **[6:33]** Individuals only; no earmarking for a named student; and the designation in exact words, made at the time of payment.
- **[6:43]** The designation is irrevocable; the exact words and their hash are stored. No self-serve refund.
- **[6:49]** The designated amount and any fee are always separate lines. With the fee structure at none, there is no fee at all.
- **[6:55]** Sandbox payment with a test card number: no money moves.
- **[7:01]** The immediate receipt — not the official acknowledgment, which the SGO sends by January 31 with the unique donor number.
- **[7:09]** The receipt email, as the development outbox recorded it.

## 7:13 — Chapter 5: The camp handoff

**[7:13] Title card**

> Chapter 5: The camp handoff
> A fictional summer camp's checkout with a “Pay with a scholarship” button.
> The camp pays the success fee on its own invoice. The family never pays; scholarship funds are never touched.

- **[7:22]** Camp Cedar Creek is a fictional booking site that installs the real embed script. Pick a session.
- **[7:29]** At checkout the family can pay with a scholarship. The camp's page receives events as the handoff moves.
- **[7:38]** The family's handoff page: the spot is held until a stated deadline. Free for families; no promise of a scholarship.
- **[7:46]** The camp's partner portal. Booking CCC-DEMO-0001 (seeded): that family submitted, so the spot is held while the SGO reviews.
- **[7:55]** On the SGO side, the reviewer confirms that family's SNAP letter.
- **[8:07]** Eligible. An award is a separate, explicit decision of the SGO — never automatic after verification.
- **[8:16]** Back in the camp's portal, CCC-DEMO-0001 now reads Awarded. The camp's success fee goes on its own invoice.

## 8:14 — Chapter 6: Your admin console

**[8:14] Title card**

> Chapter 6: Your admin console
> Platform-admin only: the legal switches, the income-limit table, and the audit log.

- **[8:19]** Gates & fees. The fee structure stays at none: the rules do not say how a platform fee on a 25F gift is treated.
- **[8:27]** Choosing another structure is refused without counsel's memo reference and date — and every change is audited.
- **[8:34]** Live gifts stay off until you turn them on, after the credit date and the memo.
- **[8:40]** The income-limit table every decision uses: HUD FY 2026, provisional, 254 Texas counties. Swapping in the IRS table is one ingest job.
- **[8:48]** Look up any county: both readings for household sizes 1 to 8. Where they differ, incomes in between go to a person.
- **[8:56]** The audit log: every read of sensitive data and every change, newest first, never edited or deleted.

## 8:58 — Chapter 7: What is real, what is next

**[8:58] Title card**

> Chapter 7: What is real versus sandbox
> Real: the income engine for all 254 counties, decisions, review, evidence packs, the API, webhooks, the dashboards.
> Sandbox stand-ins: payments (no money moves), the payroll/bank rail, email (outbox), the SGO list (fictional).
> Every limit is labeled provisional until the IRS publishes its table.

**[9:11] Title card**

> Only you can supply: Outside accounts and sign-offs
> A Stripe account (on the parent's entity) and a data-rail contract (Plaid, Argyle, Pinwheel or Truv).
> Counsel's memos: the fee structure and the FCRA posture.
> IRS SGO portal registration (by each SGO), a domain, and an email sender.

**[9:22] Title card**

> Run it yourself: Three commands
> npm install  ·  npm run db:seed  ·  npm run dev
> Then open localhost:3000 — /sgo, /give, /demo/camp, /admin, /docs.
> Sign-in codes appear at /dev/mail. See README.md and docs/how-it-works.md.
