# Payments and data-rail integration facts (Stripe, payroll/bank rails, IRS transcripts)

Research date: 2026-11-18. Scope: drives (1) Stripe integration for donor checkout and business (camp) invoicing, (2) the payroll/bank "auto-submit" rail adapter, (3) the IRS-transcript path.

**Fact-check status (2026-11-18):** this file was adversarially fact-checked against the local sources and re-fetched vendor pages. Every quote was located in its cited source; corrections are marked inline with **[FACT-CHECK]** and listed in the VERIFICATION LOG at the end. Facts added by the fact-checker carry a letter suffix (2A, 5A, 13A, 15A, 24A, 37A, 63A) so the original numbering and cross-references still hold. Three things an engineer must not miss:
1. The "qualified contribution" definition (designation at the time of the gift, irrevocable, goods/services subtraction, cash in U.S. dollars, no digital assets) is **in the temporary regulations and therefore in force** (§1.25F-1T(a)(12)), not only proposed.
2. The proposed-rule preamble says the credit is for individuals contributing "directly to one or more SGOs, rather than through one or more entities" (fact 2A). That sentence was written about partnerships and S corporations, but it is the closest thing in the sources to a rule on intermediaries, and it bears on any charge that is created on the platform's own Stripe account.
3. Nothing here was run against a live Stripe or Plaid sandbox. SDK types were compiled; runtime behavior is untested.

How this file was built
- Section 25F rules come ONLY from the local source files (statute, T.D. 10057, REG-117199-25, IRS pages). Nothing about 25F is from memory.
- Vendor facts (Stripe, Plaid, Argyle, Pinwheel, Truv, Next.js, IRS transcript pages) were fetched live on 2026-11-18 with plain curl and saved under
  `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/` (called `EXTRA/` below). SDK facts were verified by downloading the npm tarballs and reading the shipped `.d.ts` files.
- Anything I could not verify online is tagged **[unverified, from memory]**. Anything the sources do not settle says **NOT IN SOURCES**.

Source abbreviations
- `PR` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/proposed_rule_REG-117199-25.txt`
- `TR` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/temp_regs_TD10057.txt`
- `USC` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/usc_25F.txt`
- `IRS-I` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/irs_fstc_individuals.txt`
- `EXTRA/` = `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/`

Confidence tags: [statute] / [temporary-reg: in force] / [proposed-reg: not final] / [preamble/economic-analysis] / [IRS web page] / [secondary/web] (vendor's own docs or npm registry, fetched 2026-11-18) / [unverified, from memory].

---

## VERIFIED VERSIONS (npm registry + tarballs, 2026-11-18)

| Package | Latest | Published | Notes verified in the tarball |
|---|---|---|---|
| `stripe` (stripe-node) | **23.1.0** | 2026-10-29 | Pinned API version **`2026-10-28.endive`** (`cjs/apiVersion.js`). `engines.node >= 20`. Major 23.0.0 was 2026-09-30 (API `2026-09-30.endive`). |
| `@stripe/stripe-js` | **10.3.0** | 2026-11-12 | Major 10 started 2026-10-01. |
| `@stripe/react-stripe-js` | **7.1.0** | 2026-11-13 | peerDeps: `@stripe/stripe-js >=10.3.0 <11.0.0`, `react >=16.8.0 <20.0.0`. Exports `.`, `./checkout`, `./pricing`. |
| `next` | 16.4.6 | not checked | `engines.node >= 20.9.0`; peer react `^18.2.0` or `^19.0.0`. |
| `react` | 19.3.1 | not checked | |
| `plaid` (plaid-node) | **51.0.0** | 2026-11-06 | Brand-new SDK surface in v51 (`PlaidClient`, `client.credit.getPayrollIncome`); old surface at `plaid/legacy`. `engines.node >= 18`. |
| `react-plaid-link` | 5.0.0 | 2026-07-24 | `usePlaidLink({ token, onSuccess, onExit })`. |

Sources: `https://registry.npmjs.org/<pkg>/latest`, saved as `EXTRA/npm_*.json`; tarballs unpacked in `EXTRA/stripe_node_pkg`, `EXTRA/stripe_js_pkg`, `EXTRA/react_stripe_js_pkg`, `EXTRA/plaid_node_pkg`, `EXTRA/react_plaid_link_pkg`. [secondary/web]

---

## FACTS

### Group R: Section 25F rules that directly constrain payments and rails

**1. "Cash" includes card and electronic transfer; USD only; no digital assets.**
- (a) Checkout may accept card, ACH/electronic transfer, check, money order, after-tax payroll deduction. It must charge in USD and must never accept crypto/stablecoins for a designated gift.
- (b) "Means physical currency, check, money order, electronic transfer, after-tax payroll deduction, or other similar method, in each case all in U.S. dollars, and (B) Does not mean any digital asset." Preamble adds: "electronic transfer (including, for example, by credit or debit card)".
- (c) Temporary reg text §1.25F-1T(a)(12)(iii): `TR` lines 1525-1530 (identical wording in proposed §1.25F-1(a)(12)(iii), `PR` lines 4943-4948). Card wording: T.D. 10057 preamble `TR` lines 181-184 ("the term “cash” means ... electronic transfer (including, for example, by credit or debit card)") and proposed-rule preamble `PR` lines 369-373.
- (d) [temporary-reg: in force] for the cash definition, U.S. dollars and the digital-asset exclusion. [preamble/economic-analysis] for the statement that credit and debit cards count as "electronic transfer": the reg text itself does not name cards. **[FACT-CHECK]** the original tagged this fact as proposed-only; the same text is in §1.25F-1T, which applies on or after September 1, 2026 (`TR` lines 1562-1564).
- Not addressed in the sources: ACH by name, digital wallets such as Apple Pay / Google Pay (they ride on a card), buy-now-pay-later. NOT IN SOURCES.

**2. Statutory definition: a charitable contribution of cash to an SGO.**
- (a) The payee of the gift must be the SGO. The statute says nothing about intermediaries or platforms.
- (b) "The term “qualified contribution” means a charitable contribution of cash to a scholarship granting organization that uses the contribution to fund scholarships for eligible students solely within the State in which the organization is listed pursuant to subsection (g)."
- (c) `USC` line 168 (§25F(c)(3)).
- (d) [statute]

**2A. [FACT-CHECK addition] Treasury reads the credit as limited to individuals contributing "directly" to SGOs, "rather than through one or more entities".**
- (a) This sentence sits in the preamble section on partnerships and S corporations, and the reg text that follows it (proposed §1.25F-2(a)(3)) only addresses partners and S-corporation shareholders. It is not a rule about payment processors or donation platforms. But it is the only place the sources speak to routing a contribution through another entity, so it must be in front of counsel when choosing a charge type. A direct charge (the charge is created on the SGO's own Stripe account, fact 36) keeps the platform out of the money path. A destination charge is created on the platform's account and the funds pass through the platform's Stripe balance before transfer (fact 34 flow of funds, `EXTRA/stripe_docs/destination_charges_elements.md` line 697). Whether that is a contribution "through" an entity is NOT IN SOURCES.
- (b) "The Treasury Department and the IRS interpret the language of section 25F(a) to limit the section 25F credit to individuals making qualified contributions directly to one or more SGOs, rather than through one or more entities." Economic analysis: "section 25F credits are allowed for qualified contributions made directly by individual taxpayers but are not allowed for qualified contributions made indirectly through pass-through entities."
- (c) `PR` lines 596-599 (preamble, part II.D); `PR` lines 3674-3677 (economic analysis); reg text proposed §1.25F-2(a)(3) at `PR` lines 5054-5065.
- (d) [preamble/economic-analysis] (interpretive statement about a proposed rule; context is pass-through entities; not final)

**3. Designation must be made to the SGO at the time of the contribution, and is irrevocable.**
- (a) The designation checkbox must be captured before/at payment confirmation, timestamped, stored with the payment record, and transmitted to the SGO. A "change my mind / undesignate" feature must not exist. Refund handling of a designated gift is a legal question (see Open Questions).
- (b) "to the extent that the donor designates to the recipient SGO, at the time of making the contribution, that the contribution is intended to be a qualified contribution for purposes of section 25F. Such designation, once made, is irrevocable." Preamble: "neither the donor nor the recipient organization would be permitted to revoke such designation".
- (c) Temporary reg text §1.25F-1T(a)(12)(i): `TR` lines 1514-1519 (identical wording in proposed §1.25F-1(a)(12)(i), `PR` lines 4932-4937). Preamble on revocation: `PR` lines 861-864. T.D. 10057 preamble: "a donor is required to designate to the recipient SGO, at the time of making the contribution" (`TR` lines 185-187).
- (d) [temporary-reg: in force] for designation "at the time of making the contribution" and irrevocability. [preamble/economic-analysis] for "neither the donor nor the recipient organization would be permitted to revoke". **[FACT-CHECK]** the original tagged this as proposed-only.
- Note: the definition also says the contribution is "made by an individual" and designated "to the recipient SGO". The designation is something the donor tells the SGO, so the platform must pass it to the SGO, not just store it.

**4. Goods or services from the SGO reduce the qualified contribution.**
- (a) The checkout must not bundle any SGO-provided benefit with the gift. The acknowledgment must state whether goods/services were provided (fact 8).
- (b) "If the SGO provides any goods or services as consideration for any part of the contribution, then the value of those goods and services must be subtracted from the amount of the charitable contribution to arrive at the amount of the qualified contribution."
- (c) Temporary reg text §1.25F-1T(a)(12)(ii): `TR` lines 1520-1524 (identical wording in proposed §1.25F-1(a)(12)(ii), `PR` lines 4938-4942).
- (d) [temporary-reg: in force] **[FACT-CHECK]** the original tagged this as proposed-only.
- Scope limit: the rule is about goods or services provided by **the SGO**. It says nothing about a service the platform provides to the donor (for example, a checkout convenience paid for by a donor fee). NOT IN SOURCES.

**5. Every designated gift must be deposited into the SGO's section 25F segregated account, which may contain only qualified contributions and their earnings.**
- (a) The account that receives designated gifts must be the SGO's 25F segregated account, and nothing else (non-designated gifts, service fees, refunds from other programs) may be in it. Engineering inference, not source text: in Stripe terms this points to a dedicated connected account (or at least a dedicated payout bank account) per SGO 25F account.
- (b) "Prevents the co-mingling of qualified contributions with other amounts by maintaining a section 25F segregated account, which must contain only qualified contributions and the earnings therefrom, depositing all qualified contributions into its section 25F segregated account". Statute: "maintaining one or more separate accounts exclusively for qualified contributions".
- (c) Statute: `USC` line 183 (§25F(c)(5)(B)). Temporary regs: the State must certify exactly this for every listed SGO, §1.25F-5T(d)(3)(ii), `TR` lines 1858-1863; definition of "section 25F segregated account" §1.25F-1T(a)(18), `TR` lines 1538-1541. Proposed regs: SGO-level requirement §1.25F-3(b)(2), `PR` lines 5308-5313; definition `PR` lines 4970-4975.
- (d) [statute] / [temporary-reg: in force] (State certification duty and definition) / [proposed-reg: not final] (the SGO-level rule in §1.25F-3(b)(2)). **[FACT-CHECK]** the original omitted the temporary-reg citations.
- Not settled: neither the statute nor the regulations say what kind of "account" qualifies (bank account vs. a payment processor balance), or whether money sitting in an SGO's Stripe balance, or passing through a platform's Stripe balance, before payout is "co-mingled". NOT IN SOURCES. The preamble calls the requirement "a tracing and anti-commingling rule for qualified contributions" (`PR` lines 981-982).

**5A. [FACT-CHECK addition] Stripe can pull money back out of the SGO's balance, and out of its bank account.**
- (a) Refunds, chargebacks and ACH returns on a direct charge are debited from the connected account's (SGO's) Stripe balance. Stripe first offsets them against the SGO's future payments, so donor B's gift can be reduced to cover donor A's chargeback inside the Stripe balance. If the SGO's Stripe balance goes negative, Stripe debits the SGO's external bank account on file. If that bank account is the 25F segregated account, a chargeback or a dispute fee is paid out of qualified contributions. With destination charges the platform's balance takes the hit instead (fact 37). Consequences: (i) the gift ledger must be kept gross per gift and reconciled to Stripe balance transactions, never inferred from payout amounts; (ii) who funds chargebacks and dispute fees is part of the counsel question in fact 16; (iii) do not use Stripe "Account Debits" to collect a platform fee from an SGO's 25F-linked connected account.
- (b) "Stripe first assigns negative transactions to the account the associated charge was made on." / "If at all possible, Stripe automatically offsets negative transactions against future payments." / "If a connected account balance is negative, Stripe debits their external account on file up to the maximum number of attempts allowed." / "Refunds and chargebacks reduce the connected account’s balance." (direct charges)
- (c) `https://docs.stripe.com/connect/account-balances.md` (`EXTRA/stripe_docs/acct_balances.md` lines 36-48); `EXTRA/stripe_docs/connect_charges.md` line 47; `EXTRA/stripe_docs/account_debits.md`.
- (d) [secondary/web] (Stripe docs, fetched 2026-11-18). How section 25F treats such a debit: NOT IN SOURCES.

**6. A designated gift goes into the segregated account whether or not the donor ends up with a credit.**
- (a) Do not route by "will this donor actually get the credit" (e.g., over-cap amounts). Route by designation.
- (b) "A contribution designated by a donor as a qualified contribution would need to be deposited in this section 25F segregated account regardless of whether the donor ultimately receives a tax credit for the qualified contribution."
- (c) `PR` lines 858-861.
- (d) [preamble/economic-analysis]

**7. Multistate SGOs need one segregated account per covered State, and the donor chooses the allocation.**
- (a) Data model: `sgo_25f_account` keyed by (SGO, State). Checkout for a multistate SGO needs a State-allocation step, and each allocation settles to that State's account. Texas-only v1 can hard-code one account but the schema should allow many.
- (b) "a multistate SGO must maintain a separate section 25F segregated account for each covered State on whose State SGO list the SGO appears. The SGO must allow donors to designate how their qualified contribution should be allocated among one or more of those covered States".
- (c) `PR` lines 5372-5378.
- (d) [proposed-reg: not final]

**8. Donor acknowledgment contents and deadline.**
- (a) The payment record must carry everything needed to produce the acknowledgment: SGO EIN, per-donor calendar-year total of designated contributions, unique donor number, goods/services statement and estimate. Due January 31 of the following year. Electronic delivery requires recorded donor consent that has not been withdrawn.
- (b) "(A) The organization's EIN; (B) The total amount of contributions made by the donor to the organization during the calendar year that the donor designated as qualified contributions; (C) The unique donor number ..." and "no later than January 31 of the calendar year following the calendar year in which a donor made a qualified contribution ... including by electronic delivery if the donor consents to receive the statement electronically and does not withdraw the consent before the statement is furnished."
- (c) `TR` lines 1615-1639 (§1.25F-4T(c)(1)).
- (d) [temporary-reg: in force]

**9. SGO's annual IRS report, per unique donor number, due February 28.**
- (a) Store donor legal name and address at checkout (not just the card billing name). Aggregate per donor per calendar year. Export for the IRS SGO portal.
- (b) "(A) The donor's name; (B) The donor's address; (C) The aggregate amount of qualified contributions made by the donor to the organization during the calendar year" ... "no later than February 28 of the year following the year in which such qualified contributions were made."
- (c) `TR` lines 1640-1657 (§1.25F-4T(c)(2)).
- (d) [temporary-reg: in force]
- **[FACT-CHECK addition]** Do not collect a donor's SSN or other taxpayer identification number at checkout. The required report fields are name, address and amount; the unique donor number exists so that SGOs do not have to collect TINs: "The use of the donor number avoids the need to have SGOs collect and report each donor's taxpayer identification number, such as a social security number." (`PR` lines 3712-3714) [preamble/economic-analysis]. The IRS may add report fields in future guidance (§1.25F-4T(c)(2)(i)(D), `TR` lines 1648-1650).

**10. Unique donor number is per donor who designated at least one payment in the calendar year.**
- (a) One unique donor number per donor at each SGO; several payments by the same donor in a calendar year aggregate under it. **[FACT-CHECK]** the original said the number is keyed by (SGO, donor, calendar year). The sources say the SGO creates a number "for each donor who has designated at least one payment ... during the calendar year"; whether a returning donor keeps the same number in a later year or gets a new one is NOT IN SOURCES, so do not hard-code either. The format is "a uniform format to be used by all SGOs" that the IRS gives to the registered SGO through the IRS SGO portal (§1.25F-1T(a)(8), `TR` lines 1491-1497); the format itself is NOT IN SOURCES. Keep the number an opaque string supplied by the SGO or generated per the SGO's IRS instructions.
- (b) "instructions for creating a unique donor number for each donor who has designated at least one payment to the organization as a qualified contribution to the SGO during the calendar year."
- (c) `TR` lines 1609-1614 (§1.25F-4T(b)(4)).
- (d) [temporary-reg: in force]

**11. One payment may cover two spouses; each spouse gets a separate acknowledgment and donor number.**
- (a) A single combined payment for a married-filing-jointly couple is contemplated by the IRS (its example is a combined $3,400). The checkout must capture both names and the fact that the gift is on behalf of both spouses; acknowledgment generation fans out into two records, one unique donor number each. How a combined payment is split between the spouses (50/50 or as the donors state) is NOT IN SOURCES: capture an explicit per-spouse amount from the donors rather than assuming a split. Proposed §1.25F-2(a)(2) treats joint filers as separate taxpayers for the $1,700 cap (`PR` lines 5050-5053) [proposed-reg: not final].
- (b) "If spouses who will be filing a married filing jointly tax return make simultaneous qualified contributions (e.g., a combined $3,400 qualified contribution on behalf of both spouses), they should provide both names to the SGO and indicate to the SGO the donation is on behalf of both spouses." ... "Each spouse should receive a separate timely written acknowledgement with their own unique donor number."
- (c) `IRS-I` lines 416-418 (page last reviewed 18-Nov-2026).
- (d) [IRS web page]

**12. Only individuals; partnership and S-corporation contributions do not count.**
- (a) Checkout is for individuals. Add an attestation that the payment is the individual's own contribution (not from a partnership/S corporation). A business card cannot be reliably detected from the payment method alone.
- (b) "that contribution is not a qualified contribution made by the partner or S corporation shareholder for purposes of section 25F."
- (c) Preamble `PR` lines 607-612; reg text proposed §1.25F-2(a)(3), `PR` lines 5054-5065. "made by an individual" is in the in-force definition §1.25F-1T(a)(12)(i), `TR` lines 1514-1516.
- (d) [temporary-reg: in force] for "made by an individual"; [proposed-reg: not final] and [preamble/economic-analysis] for the partnership / S-corporation rule. See also fact 2A.

**13. Credit-eligible contributions start January 1, 2027.**
- (a) Gate live designated checkout behind a date check (charge/confirmation timestamp on or after 2027-01-01 in the applicable time zone; which time zone/instant governs is NOT IN SOURCES). Sandbox payments are fine before that.
- (b) "Beginning on January 1, 2027, individual taxpayers will be able to make contributions to any eligible SGOs that have been certified by the States on whose SGO list they appear." IRS page: "Beginning Jan. 1, 2027, individual donors may be able to claim a nonrefundable FSTC".
- (c) `TR` lines 850-852; `IRS-I` line 404; statute effective for "taxable years ending after Dec. 31, 2026" at `USC` line 270.
- (d) [preamble/economic-analysis] (the sentence is in the T.D. 10057 preamble, "Special Analyses", not in operative reg text) / [IRS web page] / [statute]. **[FACT-CHECK]** the original tagged the preamble sentence as "temporary-reg: in force". The operative rule is the statutory effective date; the January 1, 2027 date is Treasury's and the IRS's description of it.

**13A. [FACT-CHECK addition] Legal status of the three rule sources, for reading every tag in this file.**
- (a) Temporary regulations (T.D. 10057: §§1.25F-1T, 1.25F-4T, 1.25F-5T) apply now and expire on or before October 1, 2029. Proposed regulations (REG-117199-25: §§1.25F-1 through 1.25F-5) are not law; they are proposed to apply to taxable years ending on or after the date final regulations are published. Treasury says taxpayers, organizations and States "may rely" on the proposed regulations for qualified contributions made on or after January 1, 2027, but only if they follow the applicable portions "in their entirety and in a consistent manner". So a proposed-reg fact may be built to, but it can change, and comments are open until December 1, 2026. Code and copy must keep proposed-reg behavior configurable.
- (b) "This section applies on or after September 1, 2026. The applicability of this section expires on or before October 1, 2029." / "Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent manner." / "Written or electronic comments must be received by December 1, 2026."
- (c) `TR` lines 1562-1564 (§1.25F-1T(b)), 1658-1660 (§1.25F-4T(f)); `PR` lines 2401-2413 (preamble part VI, Proposed Applicability Date); `PR` lines 99-100 (DATES).
- (d) [temporary-reg: in force] / [preamble/economic-analysis]

**14. Donor may rely on the IRS SGO list on the date of the contribution; removal cuts off later gifts.**
- (a) At payment time, check the SGO's list status and snapshot it (list version/date) on the payment record. Block new designated gifts to a removed SGO. The IRS says the list is to be posted December 31, 2026, and that some approved SGOs may not appear because they did not consent to listing.
- (b) "A donor may rely on the IRS SGO list on the date the donor makes a qualified contribution. If an organization is removed from the list during the year, only contributions made before the removal date may qualify for the credit." "The list of qualified SGOs will be posted on December 31, 2026."
- (c) `IRS-I` lines 411-413; reliance rule preamble `PR` lines 623-627 and reg text proposed §1.25F-2(b), `PR` lines 5066-5086; list contents §1.25F-5T(d)(9)(i), `TR` lines 2013-2018 ("reflect each removal from a State SGO list and the date of the removal"); display of removed SGOs in "strike-through text, along with the date of the organization's removal", T.D. 10057 preamble `TR` lines 760-766.
- (d) [IRS web page] / [temporary-reg: in force] (what the IRS SGO list contains) / [proposed-reg: not final] and [preamble/economic-analysis] (the donor reliance rule).
- **[FACT-CHECK addition]** the proposed reliance rule has an exception: a taxpayer may not rely on the list if the taxpayer "Had knowledge that the recipient organization did not satisfy the requirements" or was responsible for or aware of what caused the removal (`PR` lines 5075-5086). Checkout copy must not promise that list presence guarantees the credit. Parse the removal date from the list, not just presence, because a removed SGO stays on the list in strike-through with its removal date.

**15. The 90 percent test measures gross receipts, "unreduced by any expenses".**
- (a) What the proposed text says: "income of the organization" is total gross receipts, cash method, "unreduced by any expenses"; for safe-harbor single-State SGOs and for multistate SGOs it is instead the qualified contributions "received by", and earnings credited to, the 25F segregated account. **[FACT-CHECK]** the original went further and stated as a rule that a processing fee or platform fee netted out before the money reaches the SGO "does not shrink the SGO's income; it is an expense inside the SGO's 10 percent". That is a plausible reading of "unreduced by any expenses", but the sources never mention payment fees, and under the safe-harbor wording ("received by ... the section 25F segregated account") a net deposit could be read either way. Treat it as an inference for counsel, not a fact. Fee routing is a legal decision, not a plumbing detail.
- (b) "income of the organization means the total gross receipts of the organization from all sources computed using the cash receipts and disbursements method of accounting ... unreduced by any expenses". Safe harbor/multistate: "the total amount of qualified contributions received by, and earnings credited to, the section 25F segregated account during the taxable year".
- (c) `PR` lines 5398-5415 (§1.25F-3(c)(4)(ii)); preamble `PR` lines 974-997.
- (d) [proposed-reg: not final]

**15A. [FACT-CHECK addition] Only scholarship spending counts toward the 90 percent; the safe harbor exists so SGOs can raise separate money for administrative costs.**
- (a) This supports the spec's structure (a): the SGO pays a separately invoiced platform fee from operating funds that never entered the 25F account. For a safe-harbor SGO (at least 85 percent scholarship-granting activities), money raised outside the 25F account for administrative costs is not in the 90 percent denominator. It does not say a platform fee is a permitted use of any particular funds; it says only that non-25F administrative money is outside the test for safe-harbor SGOs.
- (b) "the 90 percent of income spending requirement, for which only expenditures on scholarships for eligible students are taken into account." / "to allow SGOs to raise funds for administrative costs that would not count toward the 90 percent of income spending requirement, the operational requirement safe harbor would be a narrow administrative accommodation for organizations whose overall operations overwhelmingly consist of granting scholarships."
- (c) `PR` lines 905-907 and 913-918 (preamble, part III.C); the same activity-test sentence appears in reg text at `PR` lines 5361-5363.
- (d) [preamble/economic-analysis] / [proposed-reg: not final]

**16. Third-party platform fees and payment-processor fees are not addressed.**
- (a) No rule in the statute, temporary regulations, or proposed regulations says how a platform fee or a card-processing fee affects the amount of the qualified contribution, or whether a net deposit satisfies "depositing all qualified contributions". Do not ship a default that nets a platform fee out of a designated gift.
- (b) NOT IN SOURCES. (Searches of `PR`, `TR`, `USC` for "processing fee", "transaction fee", "platform", "intermediary", "agent of" return only the qualified-digital-wallet definition at `PR` lines 4949-4956 and an academic citation at `PR` line 3224. **[FACT-CHECK]** re-run and confirmed, with one addition the original search terms missed: the preamble sentence in fact 2A, "directly to one or more SGOs, rather than through one or more entities", `PR` lines 596-599. Additional terms searched with no hit on point: "processor", "merchant", "refund", "chargeback", "returned", "donor advised", "fundrais", "postmark", "financial institution", "bank".)
- (c) `PR`, `TR`, `USC` (negative search result).
- (d) Silence in all three sources (statute, temporary regs, proposed regs). This is an absence, not a rule.

**17. When an electronic payment is treated as "made" (card vs ACH; year-end cutoffs) is not addressed.**
- (a) The 25F sources do not define the instant a card or ACH contribution is "made". ACH can stay `processing` for up to 4 business days and can fail later (fact 44), so December 29-31 ACH gifts and January 1, 2027 gating need a counsel-approved rule. Record three timestamps per gift (donor confirmed, charge succeeded, funds available) so any rule counsel picks can be applied later.
- (b) For section 25F: NOT IN SOURCES. **[FACT-CHECK]** the original said Publication 526 was not in the source set; another agent had saved it, and it does state the section 170 rule the spec refers to: "Time of making contribution. Usually, you make a contribution at the time of its unconditional delivery." / "Credit card. Contributions charged on your bank credit card are deductible in the year you make the charge." / "Pay-by-phone account. Contributions made through a pay-by-phone account are considered delivered on the date the financial institution pays the amount." Publication 526 has no entry for ACH debits initiated on a charity's website. These are section 170 deduction rules in an IRS publication for 2025 returns; the spec itself warns that "Ordinary section 170 practice is not a safe substitute". Whether they carry over to section 25F is NOT IN SOURCES.
- (c) `EXTRA/p526_txt/p526_raw.txt` lines 2103-2116 (IRS Publication 526 (2025), dated Feb 5, 2026, `https://www.irs.gov/pub/irs-pdf/p526.pdf`). Revenue Ruling 78-38 is not in the source set.
- (d) NOT IN SOURCES for section 25F. Publication 526 text is [IRS web page] (IRS publication on section 170, not section 25F guidance). The spec's Rev. Rul. 78-38 citation remains [unverified, from memory].

**18. Income verification: the documents and the "other relevant data sources" hook.**
- (a) Direct method accepts pay stubs, prior-year federal or state returns, IRS transcripts, W-2s, plus evidence of other income (or a certification that there is none), "or may be verified through other relevant data sources". The rail adapter and the IRS-transcript upload both sit under this clause. Note the reg text and the preamble are worded differently: the preamble says "a certification that would verify income through other relevant data sources"; the reg text says "or a certification that there is none, or may be verified through other relevant data sources".
- (b) Reg text: "income may be verified through review of written documentation including pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not reflected on such documents (such as evidence of child support and alimony not reported as income) or a certification that there is none, or may be verified through other relevant data sources."
- (c) `PR` lines 5521-5528 (§1.25F-3(c)(6)(iii)(A)); preamble `PR` lines 1270-1276.
- (d) [proposed-reg: not final] / [preamble/economic-analysis]

**19. What "household income" means, and for which year.**
- (a) Rails must produce income for the calendar year before the application date. The measure is Section 8 "annual income" (24 CFR 5.609), minus imputed return on net assets, including child support/alimony, excluding non-cash receipts. A payroll rail gives wages for the connected employer(s) only; it does not by itself prove total household income.
- (b) "the term household income means annual income, as defined in 24 CFR 5.609; however, for this purpose, household income must be determined by disregarding the imputed return on net assets ... This definition includes receipts by a member of the household in the form of child support and alimony not included in taxable income but excludes non-cash receipts." Prior year: "for the calendar year prior to the date of the application for a scholarship".
- (c) `PR` lines 5510-5520; `PR` lines 1155-1158; statute `USC` line 161 (§25F(c)(2)(A): "for the calendar year prior to the date of the application for a scholarship").
- (d) [statute] for the prior-calendar-year rule and the 300 percent test (**[FACT-CHECK]** the original did not tag the statutory part); [proposed-reg: not final] for the 24 CFR 5.609 definition of household income; [preamble/economic-analysis] for the `PR` 1155-1158 restatement.

---

### Group A: Stripe

All Stripe doc pages below were fetched 2026-11-18 as Markdown (`https://docs.stripe.com/<path>.md`) and saved in `EXTRA/stripe_docs/`. Stripe's docs currently show `Stripe-Version: 2026-10-28.preview` in v2 curl examples and the GA SDK pins `2026-10-28.endive`.

**20. Current stripe-node and API version; breaking changes that matter here.**
- (a) Use `stripe@23.1.0`, API `2026-10-28.endive`, Node 20+. Since v22 `Stripe` is a real ES class (`new Stripe(key, config)` required, no callbacks, `params` first and `RequestOptions` second). Since v23/API `2026-09-30.endive`, **`payment_method_types` was removed from `PaymentIntentCreateParams`**; use `automatic_payment_methods` (on by default) or `allowed_payment_method_types` / `excluded_payment_method_types`.
- (b) "This release changes the pinned API version to `2026-10-28.endive`." / "⚠️ Remove support for `payment_method_types` on `Checkout.SessionCreateParams`, `PaymentIntentConfirmParams`, `PaymentIntentCreateParams`, `PaymentIntentUpdateParams`, `SetupIntentCreateParams`, and `SetupIntentUpdateParams`" / "⚠️ Stripe import is now a true ES6 class. Use `new Stripe()`" / "⚠️ Drop support for Node 18".
- (c) `EXTRA/stripe_node_pkg/package/CHANGELOG.md` lines 8-9, 131, 169, 636; `EXTRA/stripe_node_pkg/package/cjs/apiVersion.js`; types in `cjs/resources/PaymentIntents.d.ts` lines 2666-2840. Stripe's own API changelog lists the same removal under `2026-09-30.endive` as a breaking change: "Removes the payment method types parameter from Payment Intents and Setup Intents" and, for Stripe.js, "Removes support for the payment method types option in Elements" (`https://docs.stripe.com/changelog.md`, `EXTRA/stripe_docs/changelog.md` lines 158, 162).
- (d) [secondary/web]. **[FACT-CHECK]** verified: registry `latest` re-fetched 2026-11-18 (23.1.0), tarball `apiVersion.js`, CHANGELOG line numbers. The removal applies when you call the API at version `2026-09-30.endive` or later; an integration pinned to an older API version is a different case and was not researched.

**21. Stripe's recommended custom-page integration has changed: Checkout Sessions + Elements is now the default recommendation; PaymentIntents + Payment Element is the supported lower-level path.**
- (a) The brief asked for PaymentIntents + Payment Element. That still works and is documented, but Stripe now recommends Checkout Sessions with `ui_mode: 'elements'` (React: `CheckoutElementsProvider` / `useCheckoutElements` from `@stripe/react-stripe-js/checkout`) "for most new integrations". For this product PaymentIntents is a defensible choice because the build needs exact control of amount composition, Connect routing, metadata, idempotency, and a possible second charge. Both expose `application_fee_amount`, `on_behalf_of`, and `transfer_data` (Checkout via `payment_intent_data`).
- (b) "We recommend the payment element with Checkout Sessions for most new integrations. The Payment Intents API requires you to build and maintain more of your checkout logic."
- (c) `https://docs.stripe.com/payments/accept-a-payment.md?payment-ui=elements&api-integration=paymentintents` (`EXTRA/stripe_docs/accept_payment_pi.md` lines 7-9); `EXTRA/react_stripe_js_pkg/package/README.md`; `cjs/resources/Checkout/Sessions.d.ts` lines 2626+.
- (d) [secondary/web]

**22. Intent-first Payment Element flow (the one to build).**
- (a) Server creates a PaymentIntent with `amount` + `currency` and returns `client_secret`. Client wraps the form in `<Elements stripe={loadStripe(pk)} options={{ clientSecret }}>`, renders `<PaymentElement />`, and calls `stripe.confirmPayment({ elements, confirmParams: { return_url } })`. Stripe redirects to `return_url` with `payment_intent` and `payment_intent_client_secret` query params; the return page calls `stripe.retrievePaymentIntent(clientSecret)` and branches on `succeeded` / `processing` / `requires_payment_method`. Fulfillment (receipt, acknowledgment ledger) must be driven by webhooks, not by the return page. **[FACT-CHECK addition]** Stripe's guide also says to call `elements.submit()` at the start of the submit handler when Apple Pay or Google Pay can appear; they are card wallets, so they can appear whenever `card` is allowed (S4 now does this).
- (b) "Always decide how much to charge on the server side, a trusted environment, as opposed to the client." / "Listen for these events rather than waiting on a callback from the client." / "If you accept Apple Pay or Google Pay, call elements.submit() at the beginning of your submission handler."
- (c) `EXTRA/stripe_docs/accept_payment_pi.md` lines 56-70, 191-258, 496-640, 648-706, 708-712, 753-765; `EXTRA/stripe_docs/direct_charges_elements.md` lines 556-568.
- (d) [secondary/web]

**23. Payment-method selection on a PaymentIntent.**
- (a) `automatic_payment_methods` is optional and enabled by default in the current API; that would surface whatever is enabled in the Dashboard (wallets, BNPL, and stablecoin/crypto if enabled). For a 25F gift, pass an explicit allow-list: `allowed_payment_method_types: ['card', 'us_bank_account']`. The enum in v23 includes `'crypto'`, `'klarna'`, `'affirm'`, `'cashapp'`, `'link'`; none of those should be offered for a designated gift (fact 1; BNPL/credit-product treatment is NOT IN SOURCES, so exclude it).
- (b) "In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default." / "To override payment methods, manually list any that you want to enable using the allowed_payment_method_types parameter."
- (c) `EXTRA/stripe_docs/accept_payment_pi.md` lines 58-60; `cjs/resources/PaymentIntents.d.ts` lines 2676-2678, 2842.
- (d) [secondary/web]

**24. Idempotency keys.**
- (a) Send an idempotency key on every POST that creates money movement. Keys: up to 255 chars, no PII; reuse with different params errors; a saved 500 is replayed (API v1). In stripe-node pass `{ idempotencyKey }` as the second argument. The SDK also auto-adds keys for its own network retries. **[FACT-CHECK]** the original said keys are "stored at least 24 hours" and built the sketches on permanent, deterministic keys (`gift_<id>_pi_v1`). Stripe may prune a key once it is at least 24 hours old, and then "We generate a new request if a key is reused after the original is pruned." So a deterministic key protects against retries and double-clicks within about a day; it does not stop a second PaymentIntent, refund or invoice being created for the same gift days later. See fact 24A.
- (b) "Idempotency keys are up to 255 characters long. Avoid using sensitive data (for example, email addresses or personal identifiers) as idempotency keys." / "you can remove keys from the system automatically after they’re at least 24 hours old" / "The idempotency layer compares incoming parameters to those of the original request and errors if they’re not the same".
- (c) `https://docs.stripe.com/api/idempotent_requests.md` (`EXTRA/stripe_docs/idempotent.md` lines 14-22; re-fetched 2026-11-18, byte-identical); `EXTRA/stripe_node_pkg/package/cjs/lib.d.ts` lines 39-45, 109.
- (d) [secondary/web]

**24A. [FACT-CHECK addition] Durable uniqueness must live in our database, not in the idempotency key.**
- (a) Store the Stripe object id on our own row the first time it is created (`gift.stripe_payment_intent_id`, `booking.stripe_invoice_id`, `gift.stripe_refund_id`) under a unique constraint, and on any later request retrieve or update that object instead of calling `create` again. Keep the idempotency key as the short-window guard. For API v2 calls (`v2.core.accounts.create`) the semantics differ: "retries don’t repeat successful operations".
- (b) "For API v1, you can remove keys from the system automatically after they’re at least 24 hours old. We generate a new request if a key is reused after the original is pruned." / "With API v2, retries don’t repeat successful operations. Stripe retries failed or partially failed work to completion when possible and returns an updated response."
- (c) `EXTRA/stripe_docs/idempotent.md` lines 14, 18.
- (d) [secondary/web]

**25. Webhook signature verification needs the raw body; default tolerance is 5 minutes.**
- (a) Verify with `stripe.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret)`. Any body re-serialization breaks verification. Do not pass tolerance `0` (in v23 that disables the recency check). Return 2xx quickly, then do work. `Webhook.DEFAULT_TOLERANCE` is 300 seconds in the SDK.
- (b) "Stripe requires the raw body of the request to perform signature verification. If you’re using a framework, make sure it doesn’t manipulate the raw body." / "Our libraries have a default tolerance of 5 minutes" / "Don’t use a tolerance value of `0`. Using a tolerance value of `0` disables the recency check entirely."
- (c) `https://docs.stripe.com/webhooks.md` (`EXTRA/stripe_docs/webhooks.md` lines 160, 676, 803-805; the Node rendering `EXTRA/stripe_docs/webhooks_node.md` has the same text at lines 149, 650, 777-779); `EXTRA/stripe_node_pkg/package/cjs/Webhooks.js` line 15; CHANGELOG lines 134-138. **[FACT-CHECK]** the original gave the `webhooks.md` line numbers under the `webhooks_node.md` file name.
- (d) [secondary/web]

**26. Next.js App Router: read the raw body with `await request.text()`; no `bodyParser` config.**
- (a) In `app/api/webhooks/stripe/route.ts`, `export async function POST(request: Request)`, call `await request.text()` and hand that string to `constructEvent`. Never call `request.json()` first. Set `export const runtime = 'nodejs'`. In Next 16 route `params` are a Promise (`await params`).
- (b) "const text = await request.text()" ... "Notably, unlike API Routes with the Pages Router, you do not need to use `bodyParser` to use any additional configuration."
- (c) `https://nextjs.org/docs/app/api-reference/file-conventions/route.md` (lastUpdated 2026-11-18), saved `EXTRA/next_docs/route.md` lines 643-685, 109-111, 743.
- (d) [secondary/web]

**27. Webhook delivery semantics.**
- (a) Events can arrive out of order and more than once. Deduplicate on `event.id` (unique index), and make handlers idempotent. Live-mode retries continue up to three days; sandbox retries three times over a few hours.
- (b) "Stripe doesn’t guarantee the delivery of events in the order that they’re generated." / "Webhook endpoints might occasionally receive the same event more than once." / "Stripe attempts to deliver events to your destination for up to three days with an exponential back off in live mode."
- (c) `EXTRA/stripe_docs/webhooks.md` lines 565-597 (same text in `webhooks_node.md` lines 539-571). Sandbox retries: "We retry event deliveries created in a sandbox three times over the course of a few hours."
- (d) [secondary/web]

**28. Snapshot vs thin events; platform vs connected-account destinations.**
- (a) Stripe's Dashboard now labels "Thin" as the recommended payload for new destinations. `payment_intent.*`, `charge.*`, `invoice.*`, `account.updated` are available as snapshot events, which is what the sketches use, and `constructEvent` is the snapshot parser. **[FACT-CHECK]** the original implied these events exist only as snapshot events; Stripe made thin events for API v1 resources generally available on 2026-09-30 (`EXTRA/stripe_docs/changelog.md` line 207), so either format works, but a destination must be created as Snapshot for `constructEvent` to accept its payloads (`parseEventNotification` is for thin events; v21+ throws if you use the wrong parser). Register two destinations: "Your account" (platform events: destination charges, invoices) and "Connected accounts" (direct charges, connected-account lifecycle). Connected-account events carry `event.account`. Accounts v2 lifecycle uses thin events such as `v2.core.account[requirements].updated`.
- (b) "Register an event destination for **Connected accounts** to receive events for resources that belong to your connected accounts. Examples include direct charges ..." / "Choose the payload format: **Thin** (recommended) or **Snapshot**."
- (c) `EXTRA/stripe_docs/webhooks.md` lines 39, 376-392 (same text in `webhooks_node.md` lines 39, 357-373); `EXTRA/stripe_docs/hosted_onboarding_v2.md` lines 314-316; `cjs/resources/Events.d.ts` line 26 (`account?: string`); wrong-parser error: stripe-node CHANGELOG line 705 (v21.0.0).
- (d) [secondary/web]

**29. Events to handle for the Payment Element.**
- (a) `payment_intent.succeeded` (record the gift as paid), `payment_intent.processing` (ACH initiated; show "pending"), `payment_intent.payment_failed` (ACH or card failed; mark failed). Also handle `charge.dispute.created`, `charge.refunded`, `charge.updated` (skipped transfer detection, fact 37), `invoice.paid`, `invoice.payment_failed`, `account.updated`. All of these names exist in the v23 `Event.type` union.
- (b) "`payment_intent.processing` | Sent when a customer successfully initiates a payment, but the payment has yet to complete. This event is most commonly sent when the customer initiates a bank debit."
- (c) `EXTRA/stripe_docs/direct_charges_elements.md` lines 562-568; `cjs/resources/Events.d.ts`.
- (d) [secondary/web]

**30. Connect charge types (the choice that decides who the donor paid).**
- (a) Three types. Direct charge: created on the connected account (SGO); funds land in the SGO's balance; platform may take an application fee. Destination charge: created on the platform; funds transfer immediately to the SGO; Stripe fees, refunds and chargebacks hit the platform balance. Separate charges and transfers (SCT): charge on the platform, then explicit `transfers.create`; most complex; only needed for multi-party splits or when the destination is unknown at charge time.
- (b) "Direct charges: payments made directly to a connected account." / "Destination charges ... You create a charge on your platform, so the payment appears in your platform’s balance. A portion of the funds immediately transfers to the connected account’s balance" / "Refunds and chargebacks reduce your platform’s balance." / "Stripe debits fees from your platform’s balance." / "Separate charges and transfers require a more complex Connect integration. Use them only if your business use case requires them".
- (c) `https://docs.stripe.com/connect/charges.md` (`EXTRA/stripe_docs/connect_charges.md` lines 11-12, 41-50, 63-69, 88-101).
- (d) [secondary/web]

**31. Merchant of record (MoR) is decided by what the customer sees, and the charge type must match it.**
- (a) Platform as MoR: destination charges or SCT **without** `on_behalf_of`. Connected account (SGO) as MoR: direct charges, or destination/SCT **with** `on_behalf_of`. Website, checkout, receipts, statement descriptor and Connect config must all name the same entity. For a charitable gift "to the SGO", the SGO should be the MoR; a platform-as-MoR flow would put the platform's name on the donor's statement.
- (b) "The MoR is the entity that the customer understands they’re buying from." Table: "Platform | Destination charges | Without `on_behalf_of`" ... "Connected account | Direct charges | N/A" / "Destination charges | With `on_behalf_of`". "Don’t present one party as MoR at checkout and another on the statement, receipt, customer terms, or dispute process."
- (c) `https://docs.stripe.com/connect/merchant-of-record.md` (`EXTRA/stripe_docs/mor.md` lines 5, 64-72, 93).
- (d) [secondary/web]

**32. What `on_behalf_of` changes.**
- (a) Sets the connected account as settlement merchant/business of record: its statement descriptor is used, charges settle in its country, its country's fee structure applies. It does **not** move the Stripe fee to the connected account: for destination charges Stripe still bills the platform. Requires the connected account to have a payments capability such as `card_payments` (so not a recipient-service-agreement account).
- (b) "If `on_behalf_of` is omitted, the platform is the business of record for the payment." / "The `on_behalf_of` parameter is supported only for connected accounts with a payments capability such as card_payments." / "Stripe charges the platform directly for destination charges (with or without `on_behalf_of`)".
- (c) `EXTRA/stripe_docs/destination_charges_elements.md` lines 704-720; `EXTRA/stripe_docs/fee_payer.md` line 15.
- (d) [secondary/web]

**33. Destination charge with `application_fee_amount`: full amount goes to the SGO, then the fee is pulled back.**
- (a) The connected account first receives the full charge; the application fee is then transferred back to the platform; the platform pays the Stripe fee out of that. Net to SGO = charge minus application fee. This is a "platform cut out of the gift" structure.
- (b) "the full charge amount is immediately transferred from the platform to the `transfer_data[destination]` account after the charge is captured. The `application_fee_amount` (capped at the full amount of the charge) is then transferred back to the platform." / "Your platform pays the Stripe fee after the `application_fee_amount` is transferred to your account."
- (c) `EXTRA/stripe_docs/destination_charges_elements.md` lines 635-664.
- (d) [secondary/web]

**34. Destination charge with `transfer_data[amount]`: the SGO receives exactly the amount you name.**
- (a) Charge = X; `transfer_data.amount` = Y ≤ X; SGO gets Y; platform keeps X − Y and pays Stripe fees from it. If `transfer_data.amount` is omitted (and no application fee), **the entire charge amount is transferred** to the destination and the platform pays the Stripe fee from its own balance. The connected account's dashboard only shows the transferred amount.
- (b) "If no amount is specified, by default the entire payment amount is transferred to the destination account." (SDK type doc) / "Your platform separately pays the Stripe fees on the charge." / "your connected account can’t view the total amount of the charge. They only see the amount transferred."
- (c) `cjs/resources/PaymentIntents.d.ts` lines 639-645; `EXTRA/stripe_docs/destination_charges_elements.md` lines 669-700.
- (d) [secondary/web]

**35. Direct charges: who pays Stripe is set per connected account at creation and cannot be changed.**
- (a) Accounts v2: `defaults.responsibilities.fees_collector` = `stripe` (Stripe collects its fee directly from the SGO; no Connect fees to the SGO or the platform; that the SGO then pays at its own negotiated or nonprofit rate is an inference, not a quoted statement) or `application` (platform pays Stripe fees and Connect fees). Dispute fees follow the same switch: platform pays when `fees_collector` is `application`, the connected account pays when it is `stripe` (`EXTRA/stripe_docs/fee_payer.md` lines 86-94). v1 equivalent: `controller.fees.payer` = `account` / `application`. With `stripe`, set `application_fee_amount` to only your fee; with `application`, it must cover both.
- (b) "You can specify the fee payer only when you create an account." / "If you set the fee collector to `stripe` ... Stripe deducts its processing fee and your application fee from the payment, then pays you your share." / "The platform pays payment fees for direct charges and fees for Stripe products like Radar, Card Account Updater, and Instant Payouts." / "The platform also pays Connect fees for these accounts".
- (c) `https://docs.stripe.com/connect/direct-charges-fee-payer-behavior.md` (`EXTRA/stripe_docs/fee_payer.md` lines 21-22, 35, 41-51, 107-109).
- (d) [secondary/web]

**36. Direct charges live on the connected account.**
- (a) Create with the `Stripe-Account` header (`{ stripeAccount: 'acct_...' }` request option; the SDK now prefers `stripeContext` for new code, "currently identical"). The client must load Stripe.js with the same account: `loadStripe(pk, { stripeAccount })`. PaymentIntents/Charges are not visible in platform-level queries. Refunds are created with the same header; application fees are not refunded unless `refund_application_fee: true`.
- (b) "Transaction objects such as `PaymentIntents` and `Charges` exist on the connected account, not on the platform." / "We recommend using direct charges for connected accounts that have access to the full Stripe Dashboard." / "Application fees aren’t automatically refunded when issuing a refund."
- (c) `EXTRA/stripe_docs/direct_charges_elements.md` lines 13-24, 244-262, 638-652; `EXTRA/stripe_node_pkg/package/cjs/lib.d.ts` lines 103-119.
- (d) [secondary/web]

**37. Refunds, disputes, async failures on destination charges.**
- (a) Refund debits the platform; add `reverse_transfer: true` to pull funds back from the SGO (and `refund_application_fee: true` if a fee was taken). Disputes debit the platform (amount + fee) with or without `on_behalf_of`; recover by reversing the transfer. If an ACH payment fails after initiation Stripe reverses the transfer automatically. If the destination loses its transfer capability during an ACH delay the transfer is skipped and the funds stay on the platform (detect via `charge.updated` with `transfer_data` null).
- (b) "by default the destination account keeps the funds that were transferred to it, leaving the platform account to cover the negative balance from the refund." / "For destination charges, with or without `on_behalf_of`, Stripe debits dispute amounts and fees from your platform account." / "If the async payment fails, Stripe automatically reverses the transfer."
- (c) `EXTRA/stripe_docs/destination_charges_elements.md` lines 736-805.
- (d) [secondary/web]

**37A. [FACT-CHECK addition] Refunds can sit `pending` and then fail when the paying balance is short.**
- (a) Direct charge: the refund is debited from the SGO's Stripe balance; if it is insufficient the refund is `pending` and fails after 45 days with `insufficient_funds`. Destination charge: the platform's balance is debited; same 45-day rule; and if the refund also asks for a transfer reversal while the SGO's balance is insufficient, the refund request returns an error instead of going `pending`. Since SGO balances pay out to the 25F bank account, a refund weeks after the gift will often hit an empty Stripe balance. Handle `refund.updated` / `refund.failed` and surface the state to a human.
- (b) "If the connected account’s balance is still insufficient 45 days after you create the refund, the refund fails with a `failure_reason` of `insufficient_funds`." / "If the refund request also attempts a transfer reversal, but the connected account has an insufficient balance, the refund request returns an error instead of creating a refund with `pending` status."
- (c) `EXTRA/stripe_docs/connect_charges.md` lines 134-150.
- (d) [secondary/web]

**38. Finding the SGO-side payment for reconciliation.**
- (a) A destination charge creates a Transfer and a separate payment object on the connected account. Expand `latest_charge.transfer.destination_payment` on the PaymentIntent and store that ID next to the charge ID for the SGO's books.
- (b) "If you retrieve a PaymentIntent, expand latest_charge.transfer.destination_payment." / "Don’t use ID prefixes to tell a platform charge from a connected account’s payment."
- (c) `EXTRA/stripe_docs/destination_charges_elements.md` lines 722-734.
- (d) [secondary/web]

**39. Connected accounts: Accounts v2 is the default for new Connect platforms.**
- (a) Create SGOs with `stripe.v2.core.accounts.create` using configurations: `merchant` (accept payments: `card_payments`, `ach_debit_payments`, payouts) and, if you use destination charges, `recipient` (`stripe_balance.stripe_transfers`). `identity.entity_type` accepts `'non_profit'`. `dashboard` (`'full' | 'express' | 'none'`) is permanent. New platforms may be blocked from `POST /v1/accounts` unless v1 support is enabled. Docs say Accounts v2 is GA for Connect users; curl samples still show a `.preview` version header, so confirm at build time whether the SDK default version is accepted (see Open Questions).
- (b) "When building a new Stripe integration, use the Accounts v2 API (`/v2/core/accounts`) unless you’re explicitly instructed to use Accounts v1." / "The `recipient` configuration allows an `Account` to receive funds transfers. It includes the `stripe_balance.stripe_transfers` ... capability, which is required to use indirect charges." / "The `dashboard` you specify when creating a connected account is permanent".
- (c) `EXTRA/stripe_docs/v2_account_creation.md`; `EXTRA/stripe_docs/accounts_v2.md` lines 24-28, 36-75, 124-137; `EXTRA/stripe_docs/hosted_onboarding_v2.md` lines 19-80; SDK `cjs/resources/V2/Core/Accounts.d.ts` lines 4074-4172, 2852.
- (d) [secondary/web]

**40. Onboarding SGOs with Stripe-hosted onboarding.**
- (a) `stripe.v2.core.accountLinks.create({ account, use_case: { type: 'account_onboarding', account_onboarding: { collection_options: { fields: 'eventually_due' }, return_url, refresh_url } } })`, then redirect. Links are single-use and short-lived; `refresh_url` must mint a new link; `return_url` carries no state, so re-read the account's `requirements` afterwards. Do not email the link.
- (b) "You can only use each temporary Account Link URL once" / "This URL passes no state." / "Don’t email, text, or otherwise send account link URLs outside of your platform application."
- (c) `EXTRA/stripe_docs/hosted_onboarding_v2.md` lines 135-162, 332-352; SDK `cjs/resources/V2/Core/AccountLinks.d.ts` lines 122-162.
- (d) [secondary/web]

**41. Stripe pricing (public list prices, US).**
- (a) Cards: 2.9% + 30¢ domestic (+0.5% manually entered, +1.5% international, +1% conversion). ACH Direct Debit: 0.8%, $5.00 cap (1.2% for two-day settlement); $4.00 failed payment; $15.00 disputed payment; $1.50 per instant bank verification (micro-deposit verification free). Card disputes: $15.00 received fee. Invoicing Starter: 0.4% per paid invoice (Plus 0.5%), on top of payment fees. Connect "You handle pricing": $2 per monthly active account + 0.25% + 25¢ per payout; "Stripe handles pricing": no extra platform fees.
- (b) "2.9% + 30¢ per successful transaction for domestic cards" / "0.8% ACH Direct Debit $5.00 cap" / "$4.00 for failed payments" / "0.4% Per paid invoice" / "Platforms that choose to let Stripe bill their connected accounts for payment fees directly do not incur additional account, payout volume, tax reporting, or per-payout fees." / "$2 per monthly active account" / "0.25% + 25¢ per payout sent".
- (c) `https://stripe.com/pricing`, `https://stripe.com/pricing/local-payment-methods`, `https://stripe.com/invoicing/pricing`, `https://stripe.com/connect/pricing` (text extracts `EXTRA/stripe_docs/pricing.txt` lines 437-481, `lpm_pricing.txt` lines 566-579, `invoicing_pricing.txt` lines 315-325, `connect_pricing.txt` lines 323-337; "Micro-deposit verifications are free" at `pricing.txt` line 718). List prices as shown on 2026-11-18; they are not contract prices.
- (d) [secondary/web]

**42. Stripe nonprofit discount: eligibility and process.**
- (a) Requested per Stripe account through a support contact form after the account is activated. Requirements: registered nonprofit with tax documentation; eligible region (US is listed); at least 80% of that account's Stripe volume from "tax-deductible donations"; tuition, membership, ticket, registration and auction payments do not count. Submit: account ID, registered email, a statement that over 80% of volume is tax-deductible donations, EIN or IRS 501(c)(3) letter, tax-exempt documentation. The discounted rate itself is not published on that page: NOT IN SOURCES. Applies to "accounts used primarily for receiving donations", so it would attach to the SGO's own account pricing (direct charges with Stripe as fee collector), not to a for-profit platform's pricing on destination charges (inference from facts 32, 35; ask Stripe).
- (b) "Donation-based volume: At least 80% of your Stripe payment volume comes from tax-deductible donations." / "If your organization has nonprofit status and meets the eligibility criteria, contact our support team ... to request the fee discount for your account."
- (c) `https://support.stripe.com/questions/fee-discount-for-nonprofit-organizations` (article modified 2026-11-16; extracted text `EXTRA/stripe_docs/nonprofit_support_answer.txt`). Contact form: `https://support.stripe.com/contact/email?email=true&subject=Non+Profit+pricing&refcode=Tc9r`.
- (d) [secondary/web]

**43. ACH Direct Debit (`us_bank_account`) in the Payment Element.**
- (a) Supported. Stripe's guide has you attach a Customer to the PaymentIntent, and only `automatic` or `instant` verification can be used with the Payment Element (Financial Connections login, with micro-deposit fallback under `automatic`). Donor must accept a mandate; `billing_details.name` is required. Connected accounts need the ACH capability (`us_bank_account_ach_payments` in v1 naming; `ach_debit_payments` under `merchant` in v2). Minimum 0.50 USD.
- (b) "For ACH Direct Debit with the payment element, you can select only `automatic` or `instant`." / "Set the `us_bank_account_ach_payments` capability to `active` on your platform account, and for any connected accounts you want to enable for ACH debits."
- (c) `EXTRA/stripe_docs/accept_payment_pi.md` lines 997-1061; `https://docs.stripe.com/payments/ach-direct-debit.md` (`EXTRA/stripe_docs/ach.md` lines 9-11, 94, 361-363).
- (d) [secondary/web]

**44. ACH timing, failure, dispute and refund behavior.**
- (a) Delayed-notification method: success or failure can take up to 4 business days (T+4 standard, cutoff 21:00 US/Eastern; T+2 for eligible accounts, cutoff 14:00 US/Eastern). Payments can fail any time after initiation; in rare cases a failure arrives after `succeeded`, and Stripe then creates a dispute and charges a failure fee. Personal-account debits can generally be disputed for 60 calendar days (business accounts: two business days) and such disputes are final. A dispute invalidates the mandate. Refunds: full only, within 180 days, about 3 business days, and cannot be canceled. Micro-deposit verification gives the customer 10 days.
- (b) "can take up to 4 business days to receive acknowledgement of success or failure" / "Customers can generally dispute an ACH Direct Debit payment through their bank for up to 60 calendar days after a debit on a personal account" / "You can’t submit evidence to contest or appeal a final ACH Direct Debit dispute." / "Refunds: ✗ Partial refunds ✓ Full refunds Submission window: 180 days".
- (c) `EXTRA/stripe_docs/ach.md` lines 5, 15-16, 33-36, 121-134, 152-178, 308-324, 332.
- (d) [secondary/web]

**45. ACH mandates are tied to the merchant of record.**
- (a) A mandate authorized on a PaymentIntent with `on_behalf_of` an SGO cannot be used with a different connected account, and the merchant of record decides which Stripe account may create payments with that PaymentMethod. **[FACT-CHECK]** the original stated flatly that the platform cannot re-debit the same bank account for a separate service fee. Stripe's text speaks of "a different connected account", not of the platform itself, so the platform case is an inference. Treat it as "assume not reusable": collect a separate ACH authorization for any platform fee, and confirm in a sandbox. The statement that cards have no comparable constraint was not found in the docs fetched: UNVERIFIED (see Open Question 8).
- (b) "If a mandate is authorized for a PaymentIntent or SetupIntent on_behalf_of a connected account, you can’t use that mandate with a different connected account." / "The merchant of record determines the Stripe account authorized to create payments with a particular PaymentMethod."
- (c) `EXTRA/stripe_docs/ach.md` lines 367-381.
- (d) [secondary/web]

**46. Invoicing API for billing a business (the camp success fee).**
- (a) Flow: create Customer (or a v2 Account with `customer` configuration) → `invoices.create({ customer, collection_method: 'send_invoice', days_until_due })` → `invoiceItems.create({ customer, invoice, amount, currency, description })` (max 250 items) → `invoices.finalizeInvoice(id)` → `invoices.sendInvoice(id)` (emails a hosted invoice page; sending also finalizes). `days_until_due` is required for Stripe to mark an invoice past due. Listen for `invoice.paid` (preferred over `invoice.payment_succeeded` because it also covers out-of-band payments) and `invoice.payment_failed`. In v23, `InvoiceItemCreateParams` has no top-level `price`; use `amount`+`currency`+`description`, or `pricing: { price }`, or `price_data`.
- (b) "Set the collection_method attribute to `send_invoice`. For Stripe to mark an invoice as past due, you must add the days_until_due parameter." / "The maximum number of invoice items is 250." / "Stripe finalizes the invoice as soon as you send it." / "we typically recommend listening to `invoice.paid` rather than `invoice.payment_succeeded`."
- (c) `https://docs.stripe.com/invoicing/integration.md?lang=node` (`EXTRA/stripe_docs/invoicing_integration_node.md` lines 109-203, 596-609); SDK `cjs/resources/InvoiceItems.d.ts` lines 263-339, `Invoices.d.ts` lines 74-102, 1205-1333.
- (d) [secondary/web]

**47. Invoice payment methods.**
- (a) `payment_settings.payment_method_types` on the invoice accepts, among others, `'card'`, `'us_bank_account'`, `'ach_credit_transfer'`, `'customer_balance'`. Offering ACH on B2B invoices cuts the fee from 2.9% + 30¢ to 0.8% capped at $5 (fact 41).
- (b) Type union: `'ach_credit_transfer' | 'ach_debit' | ... | 'card' | ... | 'customer_balance' | ... | 'us_bank_account' | ...`.
- (c) `EXTRA/stripe_node_pkg/package/cjs/resources/Invoices.d.ts` line 1527.
- (d) [secondary/web]

**48. Test mode ("sandboxes") cards and ACH numbers.**
- (a) Cards: `4242424242424242` success; `4000002500003155` requires authentication for off-session payments unless the card was set up for future use; `4000000000003220` 3DS required; `4000000000009995` insufficient funds; `4000000000000002` generic decline; `4000000000000259` succeeds then creates a fraudulent dispute; `4000000000000077` bypasses pending balance (useful when testing transfers); server-side tests should use `pm_card_visa`. Any future expiry, any CVC. ACH manual entry: routing `110000000`; account `000123456789` success, `000111111113` account closed, `000111111116` no account, `000222222227` insufficient funds, `000333333335` debit not authorized, `000555555559` dispute, `000000000009` stays processing. ACH micro-deposit test values: amounts `32` and `45` or descriptor code `SM11AA` verify the account; `10` and `11` (or `SM33CC`) exceed the attempt limit; `40` and `41` (or `SM44DD`) time out. Test ACH payments settle instantly, unlike live mode. Stripe CLI (Stripe's own examples use `localhost:4242/webhook`; the path below is ours): `stripe listen --forward-to localhost:3000/api/webhooks/stripe`; connected-account events: `stripe listen --all-snapshot --forward-connect-to ...`. Stripe's guide tells coding agents to run `stripe sandbox create --help` to provision an anonymous sandbox with working API keys without account registration (not exercised in this research).
- (b) "When writing test code, use a `PaymentMethod` such as pm_card_visa instead of a card number." / "| `000123456789` | `pm_usBankAccount_success` | `110000000` | The payment succeeds."
- (c) `https://docs.stripe.com/testing.md` (`EXTRA/stripe_docs/testing.md` lines 42, 66-72, 410-411, 652, 774, 811, 835); `EXTRA/stripe_docs/ach_accept_pi.md` lines 754-785; `EXTRA/stripe_docs/webhooks_node.md` lines 114, 373; `EXTRA/stripe_docs/accept_payment_pi.md` line 15.
- (d) [secondary/web]

**49. Statement descriptors.**
- (a) For cards you cannot set a full descriptor per payment; use `statement_descriptor_suffix` (combined with the MoR's prefix). For non-card payments (`us_bank_account`) `statement_descriptor` can be set, max 22 characters. Setting `statement_descriptor` on a card charge returns an error.
- (b) "Setting this value for a card charge returns an error. For card charges, set the statement_descriptor_suffix instead."
- (c) `cjs/resources/PaymentIntents.d.ts` lines 2818-2826; `EXTRA/stripe_docs/mor.md` lines 76-81.
- (d) [secondary/web]

#### How to get the two settlement shapes the brief asked for

**50. (i) Land 100% of the designated gift in the SGO's account, platform fee invoiced separately. Three workable shapes; none is "free".**

| Shape | PaymentIntent params | Who is MoR | Lands in SGO Stripe balance | Who bears Stripe processing fee | Refund/dispute debited from |
|---|---|---|---|---|---|
| **i-A Destination + `on_behalf_of`, no fee** | on platform: `on_behalf_of: SGO`, `transfer_data: { destination: SGO }`, no `application_fee_amount`, no `transfer_data.amount` | SGO | **100% of charge** | Platform (debited from platform balance; platform pricing). Whether Connect's "you handle pricing" per-account and per-payout fees also apply depends on how the connected account's fees are configured; not confirmed in the pages fetched: UNVERIFIED | Platform (recover with `reverse_transfer`) |
| **i-B Direct charge, platform pays fees** | on SGO account (`stripeAccount`), no `application_fee_amount`; account created with `fees_collector: 'application'` | SGO | **100% of charge** | Platform (plus Connect fees) | SGO balance for the refunded/disputed amount; the dispute fee is billed to the platform |
| **i-C Direct charge, Stripe bills SGO** | on SGO account, no `application_fee_amount`; `fees_collector: 'stripe'` | SGO | charge **minus Stripe fee** (not 100%) | SGO (inference: at the SGO's own rate; a nonprofit discount, if granted, would attach to that account) | SGO balance, including the dispute fee |

- **[FACT-CHECK] two cautions on this table.** (1) "Lands in SGO Stripe balance" is not the same as "deposited into the section 25F segregated account": Stripe pays out the balance later, net of any refunds, disputes and (in i-C) fees that hit the balance in between (fact 5A). (2) Shape i-A is the only one in which the charge is created on the platform's account and the money passes through the platform's Stripe balance; see fact 2A before choosing it. Shapes i-B and i-C keep the platform out of the money path.
- (a) i-A and i-B put the full designated amount in the SGO's Stripe balance, and the platform then recovers its fee (and, if agreed, the processing cost it fronted) by sending the SGO a Stripe invoice paid from operating funds (fact 46, with the SGO as a Customer of the platform). i-C is the cheapest and cleanest for MoR, but the payout to the 25F bank account is net of Stripe's fee. Whether a net deposit satisfies fact 5, and how any of these interact with fact 15, is NOT IN SOURCES (fact 16).
- (b) Supporting quotes: fact 34 ("by default the entire payment amount is transferred to the destination account"), fact 32 ("Stripe charges the platform directly for destination charges (with or without `on_behalf_of`)"), fact 35.
- (c) Facts 30-37 sources.
- (d) [secondary/web] for mechanics; the choice among shapes is a counsel decision.

**51. (ii) A separate, clearly non-designated service fee on top. Two mechanics.**

| Shape | How | Donor sees | Notes |
|---|---|---|---|
| **ii-A Two charges** | Charge 1 = gift to SGO via i-A/i-B/i-C. Charge 2 = service fee, a plain PaymentIntent on the platform account (platform is MoR, own descriptor, own receipt). | Two statement lines: SGO for the gift, platform for the fee | Cleanest separation. For cards: save the card on a platform Customer during charge 1 (works when charge 1 is created on the platform, i.e. i-A) and confirm charge 2 server-side. For ACH the gift mandate cannot be reused across MoRs (fact 45). Reusing a card saved on an `on_behalf_of` PaymentIntent for a platform-only charge was not confirmed in the docs fetched: UNVERIFIED, test in a sandbox. An off-session second charge also needs the donor's clear advance consent to two charges, and can require authentication (test card `4000002500003155`). Never let a failed fee charge undo or block the gift. |
| **ii-B One charge, exact transfer** | One PaymentIntent on the platform for gift + fee with `transfer_data: { destination: SGO, amount: giftCents }` | One statement line for gift + fee | SGO receives exactly the gift; the platform keeps the fee and pays Stripe from it. MoR is one entity for the whole charge: with `on_behalf_of` the SGO's descriptor covers a fee that is not the SGO's; without it the platform is MoR for the gift. Less clean on "clearly non-designated". |

- (a) In both shapes only the designated amount is recorded/acknowledged as the qualified contribution, the fee is a separate line item in the UI and in the ledger, and the fee never enters the SGO's 25F account. Avoid direct charge + `application_fee_amount` for this purpose: the fee would first land in the SGO's account and then be pulled out.
- (b) "The `transfer_data[amount]` is a positive integer reflecting the amount of the charge to be transferred to the `transfer_data[destination]`."
- (c) `EXTRA/stripe_docs/destination_charges_elements.md` lines 669-700; fact 45.
- (d) [secondary/web] for mechanics; structure choice is a counsel decision.

---

### Group B: Consumer-permissioned income rails

Docs fetched 2026-11-18, saved in `EXTRA/plaid_docs/`, `EXTRA/argyle_docs/`, `EXTRA/pinwheel_docs/`, `EXTRA/truv_docs/`, `EXTRA/fcra/`.

**52. FCRA anchors (for the counsel memo, not a conclusion).**
- (a) A CRA is any person that, "for monetary fees, dues, or on a cooperative nonprofit basis", regularly assembles or evaluates consumer information for the purpose of furnishing consumer reports to third parties, and that uses a means of interstate commerce to do so (all elements matter; **[FACT-CHECK]** the original paraphrase dropped the fee and interstate-commerce elements). A CRA may furnish a report "in accordance with the written instructions of the consumer" (§604(a)(2)). The government-benefit purpose in §604(a)(3)(D) is limited to benefits "granted by a governmental instrumentality"; an SGO scholarship is granted by a private 501(c)(3), so that purpose does not obviously fit (this is a reading of the text for counsel, not a legal conclusion). **[FACT-CHECK addition]** §604(a)(3)(F)(i) also permits furnishing to a person with "a legitimate business need for the information— (i) in connection with a business transaction that is initiated by the consumer" (`EXTRA/fcra/1681b.txt` lines 88-90); a parent's scholarship application may fit that too. Counsel decides.
- (b) "The term “consumer reporting agency” means any person which, for monetary fees, dues, or on a cooperative nonprofit basis, regularly engages in whole or in part in the practice of assembling or evaluating consumer credit information or other information on consumers for the purpose of furnishing consumer reports to third parties" / "(2) In accordance with the written instructions of the consumer to whom it relates." / "(D) ... eligibility for a license or other benefit granted by a governmental instrumentality required by law to consider an applicant’s financial responsibility or status".
- (c) `https://www.law.cornell.edu/uscode/text/15/1681a` and `/1681b` (`EXTRA/fcra/1681a.txt` line 110; `EXTRA/fcra/1681b.txt` lines 72-85).
- (d) [statute] meaning the Fair Credit Reporting Act, 15 U.S.C. 1681a(f) and 1681b(a), via Cornell LII. This is not section 25F. Nothing in the 25F sources mentions the FCRA.

**53. Plaid Income is a product of Plaid Inc., "which is not a consumer reporting agency"; Plaid's CRA is a separate subsidiary (Plaid Check).**
- (a) Plaid Income (Payroll, Bank, Document) = non-CRA data access. Consumer Report (Base Report, Income Insights, etc.) = Plaid Consumer Reporting Agency, Inc. The two cannot be used in the same Link session. Plaid steers new bank-income customers to Plaid Check but still points payroll and document flows to Income.
- (b) "Income is a product of Plaid Inc., which is not a consumer reporting agency. To learn more about products offered by Plaid Consumer Reporting Agency, Inc. (Plaid CRA), see Plaid Check. Income can't be used in the same Link flow as Plaid CRA products." / "Income is currently recommended only for use cases not supported by Consumer Report, such as underwriting outside the US, or Payroll or Document Income based flows."
- (c) `https://plaid.com/docs/income/` (`EXTRA/plaid_docs/income.md`).
- (d) [secondary/web]

**54. Plaid Sandbox is free and self-serve for Income; Plaid Check Sandbox is not granted by default.**
- (a) Sandbox keys come from the Plaid Dashboard with no sales call; host `https://sandbox.plaid.com`. Consumer Report (Plaid Check) Sandbox access must be requested from sales or via a product-access ticket.
- (b) "The Plaid Sandbox is a free and fully-featured environment for application development and testing ... Sandbox API keys can be obtained in the Plaid Dashboard." / "Most products can be immediately tested in Sandbox with no extra configuration." / "Access to Consumer Report in Sandbox is not granted by default. To request access, contact sales".
- (c) `https://plaid.com/docs/sandbox/` (`EXTRA/plaid_docs/sandbox.md`); `https://plaid.com/docs/check/` (`EXTRA/plaid_docs/check.md` line 194).
- (d) [secondary/web]

**55. Plaid's new User APIs apply to new Income integrations (since August 17, 2026).**
- (a) `/user/create` takes `client_user_id` (no PII, max 128 chars) and returns only `user_id` (prefix `usr_`), no `user_token`. It is idempotent per `client_user_id`. Webhooks are renamed `USER_INCOME_VERIFICATION*`. Minimum Node SDK 41.0.0.
- (b) "When calling /user/create, the response includes a single `user_id` instead of a `user_token` and a `user_id`." / "New Income integrations use the new behavior by default as of August 17, 2026."
- (c) `https://plaid.com/docs/api/users/user-apis/` (`EXTRA/plaid_docs/api_user_apis.md`).
- (d) [secondary/web]

**56. Plaid Payroll Income flow, endpoints, and Sandbox credentials.**
- (a) `/user/create` → `/link/token/create` with `user_id`, `products: ["income_verification"]`, `income_verification.income_source_types: ["payroll"]`, optional `income_verification.payroll_income.flow_types: ["payroll_digital_income"]`, and `webhook` → Link on the client → webhook `INCOME` / `USER_INCOME_VERIFICATION` → `/credit/payroll_income/get` with `user_id`. US only, about 80% of the US workforce. Payroll Income cannot share a Link session with other products except Document Income. Sandbox: pick a provider that asks only for username/password/SSN (Paycom, Paychex, Workday), `user_good` / `pass_good`, SSN last four `1234`. Link can be bypassed with `/sandbox/public_token/create` using `institution_id: "ins_135842"`. Sandbox payroll data is fixed: only the default `user_good` works and custom data is not supported.
- (b) "For `products`, use `["income_verification"]`. Payroll Income cannot be used in the same Link session as any other Plaid products, except for Document Income" / "Use `user_good` as the username, `pass_good` as the password, and `1234` as the last 4 digits of your SSN if prompted." / "use `ins_135842` when creating a public token for Payroll Income in Sandbox" / "Payroll Income does not currently support the use of custom Sandbox data or provider-specific scenarios; only the default `user_good` user is compatible with Sandbox Payroll Income."
- (c) `https://plaid.com/docs/income/payroll-income/` (`EXTRA/plaid_docs/payroll_income.md`); link params `EXTRA/plaid_docs/api_link.md` lines 455-540.
- (d) [secondary/web]

**57. Plaid `/credit/payroll_income/get` fields that give prior-year income.**
- (a) Per item: `items[].payroll_income[].w2s[]` with `tax_year` (string), `wages_tips_other_comp` (string; Plaid's reference describes it only as "Wages from tips and other compensation"; that it equals W-2 box 1 is an inference from the name), `social_security_wages`, `medicare_wages_and_tips`, `employer.name`, `employer_id_number`, `document_metadata.download_url` (single use, expires after two minutes); and `pay_stubs[]` with `earnings.total.ytd_amount`, `earnings.total.current_amount`, `earnings.breakdown[].canonical_description`, `net_pay.ytd_amount`, `pay_period_details.pay_date | start_date | end_date | gross_earnings | pay_frequency`, `employer.name`, `employee.name`, `employee.taxpayer_id.id_mask`. Status at `items[].status.processing_status` (`PROCESSING_COMPLETE`, `PROCESSING`, `FAILED`, `APPROVAL_STATUS_PENDING`, `UNKNOWN`). Prior-calendar-year gross = W-2 for `tax_year == Y` and/or the last pay stub with `pay_date` in year Y (`earnings.total.ytd_amount`). Money fields in `w2s` are strings; in `pay_stubs` they are numbers. **[FACT-CHECK additions]** (1) the response also has a top-level nullable `error` object (`error_type`, `error_code`, `error_message`), so check it even on a 2xx; (2) `items[].payroll_income[].form1099s[]` (with `tax_year`) carries 1099 income for gig workers, which the P2 sketch does not map yet; (3) `APPROVAL_STATUS_PENDING` means processing finished "but the user has not yet approved the sharing of the data", so treat it as not ready.
- (b) "**items->payroll_income->w2s->tax_year** (nullable, string)" / "**items->payroll_income->pay_stubs->earnings->total->ytd_amount** (nullable, number) The total year-to-date amount of the earnings." / "This download URL can only be used once and expires after two minutes."
- (c) `https://plaid.com/docs/api/products/income/` (`EXTRA/plaid_docs/api_income.md` lines 2671-5172; every field name in (a) was re-checked against the reference: W-2 fields at lines 3676-3712, pay stub earnings at 3132-3160, pay period details at 3332-3442, status at 4706-4728, `error` at 4738).
- (d) [secondary/web]

**58. Plaid Income webhook and verification.**
- (a) Payload: `{ webhook_type: "INCOME", webhook_code: "USER_INCOME_VERIFICATION", item_id, user_id, verification_status, environment }`; `verification_status` is `VERIFICATION_STATUS_PROCESSING_COMPLETE` or `VERIFICATION_STATUS_PROCESSING_FAILED` (a third value, `VERIFICATION_STATUS_PENDING_APPROVAL`, is deprecated; ignore it rather than treating it as a failure). **[FACT-CHECK]** `PROCESSING_COMPLETE` does not mean usable data: Plaid says it "indicates that the documents have been parsed successfully or that the documents were not parsable", so always fetch and inspect the result, and fall back to upload when it is empty. It fires for Payroll and Document flows, not Bank Income. Sandbox trigger: `/sandbox/income/fire_webhook` (`item_id`, `user_id`, `webhook`, `webhook_code`, `verification_status`). Verification: `Plaid-Verification` header is a JWT (alg must be `ES256`); fetch the JWK by `kid` from `/webhook_verification_key/get`; reject if `iat` is more than 5 minutes old; compare SHA-256 of the raw body with `request_body_sha256` (whitespace-sensitive, so use the raw body).
- (b) "Ensure that the value of the `alg` (algorithm) field in the header is `"ES256"`. Reject the webhook if this is not the case." / "verify that the webhook is not more than 5 minutes old" / "the `request_body_sha256` sent in the JWT payload is sensitive to the whitespace in the webhook body".
- (c) `EXTRA/plaid_docs/api_income.md` lines 6306-6375; `EXTRA/plaid_docs/api_sandbox.md` lines 3180-3242; `https://plaid.com/docs/api/webhooks/webhook-verification/` (`EXTRA/plaid_docs/webhook_verification.md` lines 12-60, 258-269).
- (d) [secondary/web]

**59. Plaid Bank Income (fallback rail).**
- (a) Same `/user/create` + Link pattern with `income_source_types: ["bank"]` and `bank_income.days_requested` (1 to 731). Data via `/credit/bank_income/get` with `user_id`: `bank_income[].items[].bank_income_sources[]` (`income_category`, `income_description`, `start_date`, `end_date`, `pay_frequency`, `total_amount`, `historical_summary[]` with per-period `total_amounts[]` and `transactions[]`). It is **net** deposits, not gross. Sandbox user `user_bank_income` with password `{}` at a non-OAuth test institution (for example `ins_109508`); other test users: `user_credit_bonus`, `user_credit_joint_account`, `user_credit_profile_poor|good|excellent`. `USER_INCOME_VERIFICATION` does not fire for Bank Income.
- (b) "Bank Income allows you to instantly retrieve net income information from a user-connected bank account" / "In Sandbox, you can use the user `user_bank_income` with the password `{}`. The basic Sandbox credentials (`user_good`/`pass_good`) will not return data when used to test Bank Income."
- (c) `https://plaid.com/docs/income/bank-income/` (`EXTRA/plaid_docs/bank_income.md`); `EXTRA/plaid_docs/test_credentials.md` lines 34-46.
- (d) [secondary/web]

**60. Plaid Check (Consumer Report) requirements.**
- (a) US entities and US consumers only. `/user/create` must include `identity` (name, date of birth, emails, phone numbers, addresses with a primary of each). `/link/token/create` needs `products` including `cra_base_report` (+ `cra_income_insights`), `cra_options.days_requested`, and a `consumer_report_permissible_purpose`. Allowed purposes for `decision_stage: DECISIONING`: `ELIGIBILITY_FOR_GOVT_BENEFITS`, `EXTENSION_OF_CREDIT`, `LEGITIMATE_BUSINESS_NEED_OTHER`, `LEGITIMATE_BUSINESS_NEED_TENANT_SCREENING`, `WRITTEN_INSTRUCTION_OTHER`. Requires "an approved Plaid Check application covering the permissible purpose". Reports must be fetched within 24 hours and then expire. Bank-data based (up to 24 months), with modeled "historical gross and net income". New `/cra/report/create` and `/cra/report/get` endpoints went live October 30, 2026.
- (b) "`WRITTEN_INSTRUCTION_OTHER`: In accordance with the written instructions of the consumer pursuant to FCRA Section 604(a)(2)" / "`ELIGIBILITY_FOR_GOVT_BENEFITS`: In connection with an eligibility determination for a government benefit where the entity is required to consider an applicant's financial status pursuant to FCRA Section 604(a)(3)(D)." / "This data must be fetched within 24 hours of report creation."
- (c) `EXTRA/plaid_docs/check.md` lines 18, 100-112; `EXTRA/plaid_docs/check_add.md` lines 14-24, 483-490; `EXTRA/plaid_docs/api_link.md` lines 1089-1111.
- (d) [secondary/web]

**61. Plaid pricing and plans.**
- (a) No public price list. Pricing is shown in the Dashboard when applying for Production. Plans: Trial (free, 10 Production Items, new US/Canada teams; **[FACT-CHECK]** omitted by the original; Income is not on the Trial product list, so it does not help here), Pay-as-you-go (no minimum), Growth (minimum, annual), Custom. Sandbox usage is always free. Income is a one-time fee per successfully connected Item/user; for Payroll/Document Income the charge is incurred when data is available (the `USER_INCOME_VERIFICATION` webhook with `PROCESSING_COMPLETE`). Payroll Income Refresh is per request. No Plaid Check product is available on Pay-as-you-go; Base Report and Income Insights need Growth or Custom, and sole proprietorships need Custom for Plaid Check. `/credit/employment/get` needs a support request on Pay-as-you-go/Growth.
- (b) "A price list is not available in the documentation." / "No Plaid Check products are available on Pay-as-you-go plans." / "For Document Income and Payroll Income, charges will be incurred when data is available to be accessed."
- (c) `https://plaid.com/docs/account/billing/` (`EXTRA/plaid_docs/billing.md` lines 14-39, 82-99).
- (d) [secondary/web]

**62. plaid-node v51 changed its surface 12 days ago.**
- (a) v51 (2026-11-06) introduces `PlaidClient` with grouped methods (`client.user.create`, `client.link.createToken`, `client.credit.getPayrollIncome`, `client.credit.getBankIncome`, `client.sandbox.createPublicToken`, `client.webhook.getVerificationKey`) and returns the body directly; the previous `PlaidApi` (`client.creditPayrollIncomeGet`, `response.data`) lives at `plaid/legacy`. To avoid coupling to a moving SDK, the adapter can call the REST API with `fetch` (JSON POST, `PLAID-CLIENT-ID` and `PLAID-SECRET` headers or body fields, `Plaid-Version: 2020-09-14`).
- (b) "Version 51 introduces a new SDK with endpoints grouped by product, responses returned as the response body, typed errors ... The previous SDK remains available through the `plaid/legacy` entry point".
- (c) `EXTRA/plaid_node_pkg/package/README.md` lines 1-8, 198-212; `dist/cjs/api/resources/*/client/Client.d.ts`.
- (d) [secondary/web]

**63. Argyle: FCRA posture, sandbox, endpoints.**
- (a) Argyle's customer terms say its Open Payroll Platform is not designed to make Argyle a CRA (affiliates may act as one under separate agreements), and if the customer takes adverse action based on the data it must give the consumer the rights it would owe under a consumer report. Model: consumer names Argyle as authorized data-transfer agent. API: HTTP basic auth (`api_key_id:api_key_secret`); Sandbox `https://api-sandbox.argyle.com/v2`, Production `https://api.argyle.com/v2`; keys created in Console. Flow: `POST /v2/users` (returns `id` and `user_token`; tokens expire after one hour; `POST /v2/user-tokens` for returning users) → Web SDK `https://plugin.argyle.com/argyle.web.v5.js`, `Argyle.create({ userToken, sandbox: true, onAccountConnected, onAccountError, onTokenExpired }).open()` → webhooks → `GET /v2/paystubs` (filters `account`, `from_start_date`, `to_start_date`; fields `paystub_date`, `gross_pay`, `gross_pay_ytd`, `net_pay`, `net_pay_ytd`, `gross_pay_list`), `GET /v2/payroll-documents` (`document_type` such as `W-2`, `ocr_data.comp_1` = W-2 wages), `GET /v2/identities`. Government report: order a verification with `report.type: "voie-government"` and optional `self_certification`. Sandbox sample users: `test_1` / `test_2` / `test_3`, password `passgood`, verification codes `8081` / `8082` / `8083`; custom sandbox users can be generated from a plain-language scenario (50 per month). Webhooks: `POST /v2/webhooks`; signature header `X-Argyle-Signature` = hex HMAC-SHA512 of the raw body with the subscription secret; respond 200 within 10 seconds; one retry after 30 seconds. Pricing: not public (site says "Contact sales"). Whether Console sign-up is self-serve: could not be verified (the sign-up URL is a single-page app that returns 200 for any path) **[unverified, from memory: Argyle has offered self-serve Console sign-up]**.
- (b) "It is not designed or intended to cause Argyle to act as a consumer reporting agency or otherwise engage in any activity regulated by the FCRA. Argyle’s Affiliates may act as a consumer reporting agency or a furnisher under separate agreements." / "The consumer directs and names Argyle as their authorized data transfer agent".
- (c) `https://www.argyle.com/legal/open-payroll/customer-terms` (`EXTRA/argyle_docs/legal_open-payroll_customer-terms.txt` lines 102-113); `https://www.argyle.com/faq` (line 148); `https://docs.argyle.com/api-guide/overview.md`, `/overview/sandbox-testing.md`, `/link/initialization/web.md`, `/api-guide/webhooks.md`, `/verticals/government-benefits.md`, `/api-reference/paystubs/list-all-paystubs.md`, `/api-reference/payroll-documents/list-all-payroll-documents.md` (all in `EXTRA/argyle_docs/`).
- (d) [secondary/web]

**63A. [FACT-CHECK addition] Argyle's public customer terms restrict passing data on, which is exactly what this product does.**
- (a) The original Open Question 15 said redisclosure terms were "not in the public docs fetched". Argyle's Open Payroll Customer Terms (last updated October 1, 2026) are public and were in the fetched set. They (i) limit processing to the purpose the consumer is seeking and forbid selling consumer data; (ii) make the customer responsible when it asks Argyle to deliver data to a further recipient; (iii) allow the customer to be a consumer reporting agency "only to the extent disclosed in a Service Order"; (iv) forbid re-delivering previously delivered data for a different user or transaction without the consumer's consent and a refreshed retrieval; (v) require records of the consumer's authorization for five years after the agreement ends. A platform that verifies once and then reports to several SGOs or camps must be designed around (iv). The equivalent Plaid, Pinwheel and Truv production terms were not fetched: NOT IN SOURCES.
- (b) "Customer must not (and must ensure that others receiving Consumer Data through Customer do not): (1) sell any Consumer Data" / "Customer may also be a consumer reporting agency, but only to the extent disclosed in a Service Order." / "must not include Consumer Data or other output of the Open Payroll Platform previously delivered in a consumer report prepared for a different user of the consumer report or a different transaction, or otherwise re-deliver Consumer Data or other output, without both that Consumer’s consent and a refreshed retrieval and delivery of that Consumer Data"
- (c) `https://www.argyle.com/legal/open-payroll/customer-terms` (`EXTRA/argyle_docs/legal_open-payroll_customer-terms.txt` lines 68, 100-112: §2.2.b(iv)-(vi), §2.5.c, §2.5.d(ii)-(iii)).
- (d) [secondary/web] (vendor contract terms; they bind only once signed, and a Service Order can vary them)

**64. Pinwheel: is a CRA; access is sales-gated.**
- (a) Pinwheel states it is a Consumer Reporting Agency. API access and the Dashboard require contacting Sales or a Client Success Manager, so no self-serve sandbox. Hosts: `https://sandbox.getpinwheel.com`, `https://development.getpinwheel.com`, `https://api.getpinwheel.com`; headers `x-api-secret`, `Pinwheel-Version` (required; example `2025-07-08`). Flow: `POST /v1/webhooks` → `POST /v1/link_tokens` with `end_user_id` (no PII), `features: ["employment", "income"]` (and `"tax_forms"` with `solution: "Verify"` for W-2s) → Link → `account.added` webhook → `GET /v1/end_users/{end_user_id}/verification_reports/voe` (and sibling report endpoints), `GET /v1/accounts/{account_id}/tax_forms/{id}?with_parsed_data=true` (parsed data only for W-2). Sandbox credentials: `user_good` / `pass_good`, SSN `123456789`, last four `1234`, MFA `mfa_code`. Pricing not public. The company now leads with deposit switching and bill switch.
- (b) "As a Consumer Reporting Agency (CRA), Pinwheel provides consumer permissioned income and employment data to our customers while ensuring that consumers have full protections available under FCRA." / "To request access to the Pinwheel API, please contact Sales or your Client Success Manager."
- (c) `https://www.pinwheelapi.com/fcra` (`EXTRA/pinwheel_docs/site_fcra.txt` lines 70-78); `https://docs.pinwheelapi.com/public/docs/getting-started.md`, `/api.md`, `/sandbox.md`, `/verify-technical-implementation.md`, `/taxes-technical-implementation.md` (in `EXTRA/pinwheel_docs/`).
- (d) [secondary/web]

**65. Truv: FCRA posture, sandbox, endpoints; now part of Checkr.**
- (a) Truv's FCRA page describes consumer file, dispute and fraud-protection rights for people verified through Truv and says "Truv is FCRA compliant" (it handles consumer-rights requests as a CRA would; the page I fetched does not contain the literal sentence "Truv is a consumer reporting agency"). Truv's site now carries a "Checkr acquires Truv" banner and "Pricing | Checkr". Sandbox: self-serve dashboard keys (`https://dashboard.truv.com/app/development/keys`); one base URL for all environments, `https://prod.truv.com/v1/`, with the key deciding sandbox vs production; headers `X-Access-Client-Id`, `X-Access-Secret`. Flow: `POST /v1/users/` → `POST /v1/users/{user_id}/tokens/` (bridge token) → Truv Bridge widget → `POST /v1/link-access-tokens/` (exchange `public_token`) → `GET /v1/links/{link_id}/income/report/`, `GET /v1/links/{link_id}/statements/` (pay statements), `GET /v1/links/{link_id}/tax/` (tax documents incl. W-2), or `POST /v1/users/{user_id}/reports/`. Sandbox login `goodlogin` / `goodpassword` (MFA variant password `mfa`, code `12345`). Webhooks signed in `X-WEBHOOK-SIGN` (HMAC-SHA256 of the raw body with the Access Secret, sent with a `v1=` prefix). Has a public-sector vertical with self-certification and a "Tax Returns" data source (tax-prep software connections). Pricing: tiers named Launch / Professional / Enterprise, all "Contact sales"; no public unit prices.
- (b) "If you have interacted with Truv as part of an employment or income verification request, you may have rights under the Fair Credit Reporting Act (FCRA), including the right to request your consumer file, dispute inaccurate information, or place fraud protections on your file." / "All environments use the same base URL: `https://prod.truv.com/v1/`. Your credentials determine which environment you're using." (quickstart, line 46; the authentication page says more precisely "Your Access Secret prefix determines which environment the request is routed to.")
- **[FACT-CHECK]** two limits on this fact: (1) Truv's CRA status is not stated in the pages fetched, so `craPosture` for Truv must be `unknown`, not `vendor_is_cra`; (2) that a sandbox account can be created without talking to sales rests on the quickstart linking to the dashboard keys page and a "Start building" button on the pricing page; sign-up was not exercised.
- (c) `https://truv.com/fcra` (`EXTRA/truv_docs/site_fcra.txt` lines 120-127); `https://truv.com/pricing` (`EXTRA/truv_docs/pricing.txt`); `https://docs.truv.com/developers/quickstart.md`, `/api-reference/authentication.md`, `/api-reference/security.md`, `/developers/testing/test-credentials.md`, `/government/products/income-employment.md`, endpoint pages in `EXTRA/truv_docs/`.
- (d) [secondary/web]

**66. CMS Emmy (the spec's reference design) already abstracts two rails: Argyle and Pinwheel.**
- (a) Emmy's code has a provider abstraction (`app/services/aggregators/`) with `sdk/argyle_service.rb`, `sdk/pinwheel_service.rb`, per-provider report classes, and normalized response objects (`identity`, `employment`, `paystub`, `earning`, `deduction`, `income`, `gig`). That shape is a ready model for our provider interface.
- (b) File names: `aggregator_reports/argyle_report.rb`, `aggregator_reports/pinwheel_report.rb`, `response_objects/paystub.rb`.
- (c) `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/emmy/app/app/services/aggregators/`.
- (d) [secondary/web] (CC0 repo checked out locally)

#### Comparison (prior-calendar-year income, consumer-permissioned)

| | Plaid Income (Payroll) | Plaid Check (Income Insights) | Argyle | Pinwheel | Truv |
|---|---|---|---|---|---|
| Sandbox without a sales call | **Yes per Plaid's docs** (Dashboard keys; not exercised) | No (request access) | Console keys; self-serve sign-up UNVERIFIED | **No** (contact Sales) | Probably (quickstart links to dashboard keys; sign-up not exercised) |
| Who is the CRA (vendor's own statement; says nothing about whether **our** product is one) | Vendor says it is not: "Plaid Inc., which is not a consumer reporting agency" | Plaid Consumer Reporting Agency, Inc. | Not Argyle for Open Payroll per its terms; affiliates may be; customer may be one only if disclosed in a Service Order (fact 63A) | Pinwheel ("As a Consumer Reporting Agency (CRA)") | Not stated in pages fetched; Truv handles FCRA consumer-file/dispute rights and says it is "FCRA compliant" |
| Token/link flow | `/user/create` → `/link/token/create` → Link → webhook | same + `identity` + permissible purpose | `POST /v2/users` → `user_token` → Web SDK | `POST /v1/link_tokens` (`end_user_id`) → Link | `POST /v1/users/` → bridge token → Bridge → link access token |
| Prior-year data | `w2s[].tax_year` + `wages_tips_other_comp`; `pay_stubs[].earnings.total.ytd_amount` + `pay_date` | modeled historical gross/net from up to 24 months of bank data | `paystubs` (`gross_pay_ytd`, `paystub_date`); `payroll-documents` W-2 `ocr_data.comp_1` | income/employment reports; `tax_forms` W-2 parsed data | pay statements, tax documents (W-2), income report |
| Webhooks | `INCOME` / `USER_INCOME_VERIFICATION`; JWT (ES256) verification | `USER_CHECK_REPORT_READY` / `CRA_REPORT` | `accounts.*`, `paystubs.*`, `users.fully_synced`, `verifications.updated`; HMAC-SHA512 | `account.added`, report and `tax_forms.added` events | task/order/link events; `X-WEBHOOK-SIGN` (HMAC-SHA256, `v1=` prefix) |
| Public pricing | No list; shown in Dashboard on Production request; one-time fee per connected user | Growth/Custom plans only | None | None | None (tiers, contact sales) |
| Custom sandbox scenarios | **No** for payroll (fixed `user_good`) | Yes (bank test users) | **Yes** (plain-language custom users) | Fixed credentials + error users | Yes (custom sandbox data) |

**67. Recommendation: implement Plaid Payroll Income first, behind a provider interface; plan Argyle as the second adapter.**
- (a) Reasons, from the facts above: it is the only payroll rail whose own docs say Sandbox keys are available from the Dashboard with no extra configuration and that document a headless test flow (fact 54, 56) (**[FACT-CHECK]** the original said the sandbox was "verified end to end"; no Plaid keys were available and nothing was run, so this is a documentation finding only); it returns both W-2s with `tax_year` and pay stubs with YTD gross (fact 57), which map directly to "prior-year ... Forms W-2" and "pay stubs" in the proposed direct method (fact 18); production pricing is visible without a sales call (fact 61); and Link can be bypassed in tests (fact 56). Weaknesses to design around: sandbox payroll data is fixed, so threshold edge cases need our own fixtures at the provider-interface boundary; the Node SDK just changed (fact 62), so call REST directly; and Plaid Inc. is not a CRA, so the product's own FCRA status is still the open counsel question (fact 52, 53). Argyle is the natural second adapter because Emmy already models it (fact 66), it has a government report with applicant self-certification, and it supports custom sandbox users (fact 63). Keep `craPosture` as provider metadata so counsel's answer can switch the default rail without code changes.
- (b) See facts 53-57, 61-63, 66.
- (c) As cited.
- (d) Recommendation (engineering judgment on verified facts).

---

### Group C: IRS transcript path

IRS pages fetched 2026-11-18, saved in `EXTRA/irs/` (`*.body.txt` are the page bodies).

**68. Ways an individual can get a transcript today.**
- (a) (1) Individual Online Account: view, print or download all transcript types; identity verified through Login.gov or ID.me. (2) Get Transcript by Mail: tax return or tax account transcript only, arrives in 5 to 10 calendar days at the address on file. (3) Automated phone line 800-908-9946 (same two types, by mail). (4) Form 4506-T: any transcript type, delivered by mail (Form 4506-T-EZ: tax return transcript only). All free. **[FACT-CHECK]** the original said 4506-T is a "mail/fax request"; how the form is submitted is on the form's instructions, which were not fetched; the pages fetched say only that it "Offers all transcript types delivered by mail" and that the IRS does not fax transcripts.
- (b) "You may register to use Individual Online Account to view, print, or download all transcript types" / "Transcripts that arrive in 5 to 10 calendar days at the address we have on file for you" / "Upon successful registration through Login.gov or IDMe, you can sign in to your Individual Online Account."
- (c) `https://www.irs.gov/individuals/get-transcript` (reviewed 27-Jun-2026); `https://www.irs.gov/individuals/transcript-types-for-individuals-and-ways-to-order-them` (10-Mar-2026); `https://www.irs.gov/individuals/get-transcript-faqs` (09-Nov-2026).
- (d) [IRS web page]

**69. Transcript types and what each shows.**
- (a) Tax return transcript: most line items of the original Form 1040 as filed; current + 3 prior years. Tax account transcript: filing status, taxable income, payment types, later changes; current + 9 prior years online, current + 3 by mail or phone. Record of account: both combined; current + 3 prior years. Wage and income transcript: W-2/1098/1099/5498 data the IRS received; current + 9 prior years; current-year data generally starts appearing the first week of February and may be incomplete; fails to generate online above about 85 income documents. Verification of non-filing letter: available after June 15 for the current tax year.
- (b) "Tax return transcript - shows most line items from your original Form 1040-series tax return as filed ... available for the current and three prior tax years." / "Wage and income transcript - shows data from information returns we receive such as Forms W-2, 1098, 1099, and 5498. Information for the current processing year will generally be available in the first week in February." / "This letter is available after June 15 for the current tax year".
- (c) `EXTRA/irs/transcript_types.body.txt`.
- (d) [IRS web page]

**70. A prior-year return transcript does not exist until the return is filed and processed.**
- (a) For a spring 2027 application the "prior calendar year" is 2026. A TY2026 return transcript is available roughly 2 to 3 weeks after e-filing (6 to 8 weeks after paper filing); later if there is an unpaid balance. Families who have not filed yet (many, in January to April) cannot use this path and need the pay stub / W-2 / rail path instead.
- (b) "refund amount or no balance due, [filed electronically] allow 2-3 weeks after return submission before you request a transcript. [paper] allow 6-8 weeks after you mailed your return".
- (c) `https://www.irs.gov/individuals/transcript-availability` (02-Sep-2026), `EXTRA/irs/transcript_availability.body.txt`.
- (d) [IRS web page]

**71. Transcripts mask personal data but show all money amounts; a Customer File Number can be printed on them.**
- (a) Visible: last 4 of SSN, first 4 characters of first and last name (first 3 if the name has only four letters), first 6 characters of the street address including spaces, all money amounts. So identity matching on an uploaded transcript must be fuzzy (last-4 SSN + name prefix + address prefix). Every self-service channel lets the taxpayer type a Customer File Number (up to 10 digits, must not be an SSN) that prints on the transcript; a lender-style reference number. We can issue a 10-digit number per verification and check that it appears on the uploaded PDF, which binds the document to this request.
- (b) "First four characters of the first and last name for any individual" / "All money amounts, including wage and income, balance due, interest and penalties" / "This number can be up to 10 digits but cannot be a taxpayer identification number" / "The various self-service methods to obtain transcripts (Individual Online Account, Business tax account, Get transcript by mail, the automated phone transcript service at 800-908-9946, Form 4506-T ...) all include a field where a Customer File Number can be entered to display on the transcript."
- (c) `https://www.irs.gov/individuals/about-tax-transcripts` (06-Sep-2026), `EXTRA/irs/about_transcripts.body.txt`.
- (d) [IRS web page]

**72. The IRS forbids companies from using the individual transcript services on a taxpayer's behalf.**
- (a) We must not log in for the parent, collect IRS credentials, or automate their Online Account. The parent retrieves their own transcript and uploads it.
- (b) "The transcript services are for individual taxpayers to retrieve their own transcripts for their own purposes. Use by any other entities is prohibited."
- (c) `https://www.irs.gov/individuals/get-transcript-faqs`, "Transcript services in general" Q3 (`EXTRA/irs/get_transcript_faqs.body.txt`).
- (d) [IRS web page]

**73. Form 4506-T does not deliver to third parties.**
- (a) 4506-T requests any transcript type, but the IRS does not mail 4506-T transcripts to third parties and does not fax transcripts. So 4506-T is only a slower version of the parent's own retrieval, not a way for the platform or SGO to receive data. Processing time for 4506-T: NOT IN SOURCES (pages fetched).
- (b) "Use Form 4506-T to request any of the transcripts: tax return, tax account, wage and income, record of account and verification of non-filling." / "For security reasons, the IRS does not fax transcripts. The IRS also does not mail transcripts to third parties when Form 4506-T is submitted."
- (c) `https://www.irs.gov/forms-pubs/about-form-4506-t` (25-Oct-2026); `EXTRA/irs/about_transcripts.body.txt`.
- (d) [IRS web page]

**74. Form 8821 (Tax Information Authorization) lets a named designee inspect/receive tax information.**
- (a) A taxpayer can authorize "any individual, corporation, firm, organization, or partnership". Designees work under a CAF number; Tax Pro Account supports online authorization requests that the taxpayer approves in their Online Account. Pulling transcripts as a designee then goes through e-Services Transcript Delivery System, described by the IRS as for "tax professionals, with proper authorization". Whether a non-practitioner company can obtain TDS access is NOT IN SOURCES. Not a v1 path.
- (b) "Authorize any individual, corporation, firm, organization, or partnership you designate to inspect and/or receive your confidential information verbally or in writing for the type of tax and the years or periods listed on the form." / "A CAF number is a unique, nine-digit identification number assigned to you through Tax Pro Account or when you file your first POA or TIA with Form 2848 or 8821."
- (c) `https://www.irs.gov/forms-pubs/about-form-8821` (`EXTRA/irs/about_8821.txt` line 245); `https://www.irs.gov/tax-professionals/tax-pro-account` (`EXTRA/irs/tax_pro_account.body.txt` lines 12, 54); `EXTRA/irs/about_transcripts.body.txt`.
- (d) [IRS web page]

**75. IVES (Income Verification Express Service): what it is and what it costs.**
- (a) IVES lets an enrolled participant request transcripts with the taxpayer's consent using Form 4506-C. Online route: participant submits via WebUI (single) or A2A API (bulk); the taxpayer approves and e-signs in their IRS Online Account; delivery is real time after approval. Fax route: 2 to 3 business days. Fee: $4 per transcript requested (wage and income requests are charged per form type per taxpayer per year), and the fee is charged even for rejected, incomplete or no-record requests. The IRS describes participants as "mortgage lenders, banks, credit unions and others" and the purpose as "the loan application process" / "a mortgage, loan, or other service".
- (b) "A $4 fee is required for each transcript requested." / "Transcripts are delivered in real time after the taxpayer approves the request." / "The legacy faxing option is available with a 2-3 business day processing time." / "The IRS only provides tax records to a third party with the consent of the taxpayer."
- (c) `https://www.irs.gov/individuals/income-verification-express-service-for-participants` (10-Mar-2026); `https://www.irs.gov/individuals/income-verification-express-service` (11-Sep-2026); `https://www.irs.gov/individuals/irs-income-verification-express-service-ives-faqs`; `https://www.irs.gov/individuals/income-verification-express-service-for-taxpayers` (19-Apr-2026). Saved in `EXTRA/irs/ives*.body.txt`.
- (d) [IRS web page]

**76. IVES participant enrollment requirements.**
- (a) Step 1: Form 13803 (IVES application), wet-signed and faxed to 833-312-5410, naming a principal and a daily point of contact. Step 2: certification documents signed by the principal (end-user certification if transcripts are used only in your own business; a different certification if you pass transcripts to other third parties; plus an electronic-signature opt-in or opt-out certification); the IRS runs a background investigation and suitability check on the company and listed individuals. Step 3: e-Services registration (about two weeks per user) for WebUI and API client ID. In the client model the participant lists its customer on Form 4506-C line 5d. An A2A test environment exists.
- (b) "Please fax the completed, wet signed enrollment form to the IVES application line: 833-312-5410." / "the IRS will perform a background investigation and suitability check on the company and individuals listed on the application." / "Sign and return this certification if you provide any transcripts to other third parties." / "The registration process takes about two weeks to complete."
- (c) `https://www.irs.gov/individuals/ives-enrollment-procedures` (21-Oct-2026), `EXTRA/irs/ives_enroll.body.txt`; IVES FAQs.
- (d) [IRS web page]

**77. IVES eligibility for a scholarship-eligibility use case is unsettled.**
- (a) The IRS announced an IVES policy change on January 2, 2024 and suspended it on March 6, 2024 pending stakeholder input. The fetched statement does not describe the change; **[unverified, from memory]** it would have limited IVES to mortgage lending. Whether a scholarship income check is an acceptable IVES use: NOT IN SOURCES.
- (b) "Although IRS announced the policy change on Jan. 2, 2024, we are suspending that change as we seek input from you and other stakeholders on possible changes and impacts to the program."
- (c) `https://www.irs.gov/newsroom/irs-statement-to-ives-stakeholders-on-suspension-of-income-verification-express-service-policy-change` (statement dated March 6, 2024; page reviewed 27-Jan-2026).
- (d) [IRS web page]

**78. Realistic v1 for IRS transcripts: guided self-download, then upload.**
- (a) Guide the parent to sign in to their IRS Individual Online Account, open the "Tax Records" page and then the "transcripts" link (path per the IRS FAQ: "click on the “Tax Records” page, and then the link for “transcripts.”", `EXTRA/irs/get_transcript_faqs.body.txt` line 32; the screens behind login were not seen), enter our 10-digit Customer File Number, download the prior-year **tax return transcript** (if they have filed) or the **wage and income transcript** (W-2/1099 data), and upload the PDF. Parse the amounts, check the tax year, fuzzy-match masked identity fields, check the Customer File Number, hash the file, and send low-confidence parses to review. Non-filers: verification of non-filing letter (not available for the current tax year until after June 15) plus other evidence. Do not build IVES, 8821/TDS, or any credential-sharing flow in v1.
- (b) Built from facts 68-77.
- (c) As cited.
- (d) Recommendation (engineering judgment on verified facts).

---

## CODE SKETCHES (TypeScript)

All Stripe sketches target `stripe@23.1.0` / API `2026-10-28.endive`, `@stripe/stripe-js@10.3.0`, `@stripe/react-stripe-js@7.1.0`, Next.js 16 App Router. Verification done: every `ts` / `tsx` block in this section was extracted and compiled with `tsc --strict` (TypeScript 5, exit code 0) against the real packages `stripe@23.1.0`, `@stripe/stripe-js@10.3.0`, `@stripe/react-stripe-js@7.1.0`, `react@19`, `react-plaid-link@5.0.0`, with small stubs for `next/server`, `@/lib/gifts` and `@/lib/ledger`. A negative control confirmed the compiler rejects `payment_method_types` on `paymentIntents.create` and `price` on `invoiceItems.create`. The harness is at `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/tools/typecheck/`. Not done: nothing was run against a live Stripe or Plaid sandbox (no API keys in this session), so runtime behavior (Accounts v2 version acceptance, capability approval, card reuse across merchants of record) is untested; see Open Questions 8-10.

**[FACT-CHECK]** The compile claim was re-checked: the harness sources match the blocks below, and after the fact-check edits (S4 `elements.submit()`, S5 without `export const dynamic`, P2 webhook status mapping and `error` field) every `ts` / `tsx` block was re-extracted and compiled again with `tsc` (strict, exit code 0) against the same package versions. A type check proves parameter names and shapes only. It does not prove that Stripe or Plaid accept the request, and it does not catch the logic gaps called out under S3.

### S1. Server client (lazy, so builds without the key do not crash)

```ts
// lib/stripe.ts
import Stripe from 'stripe';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(key, {
      apiVersion: '2026-10-28.endive', // the version stripe@23.1.0 pins; bump together with the package
      maxNetworkRetries: 2,
      appInfo: { name: 'ecca-plaid', version: '0.1.0' },
    });
  }
  return client;
}
```

### S2. Onboard an SGO as a connected account (Accounts v2 + hosted onboarding)

```ts
// lib/stripe-connect.ts
import { getStripe } from './stripe';

export type FeesCollector = 'stripe' | 'application'; // fixed at creation; cannot be changed later

export async function createSgoAccount(input: {
  legalName: string;
  contactEmail: string;
  feesCollector: FeesCollector;     // 'stripe' => shape i-C; 'application' => shape i-B
  needsTransfers: boolean;          // true when using destination charges (shape i-A)
  sgoId: string;
}) {
  const stripe = getStripe();
  const account = await stripe.v2.core.accounts.create(
    {
      contact_email: input.contactEmail,
      display_name: input.legalName,
      dashboard: 'full',            // permanent; Stripe recommends direct charges only for full-dashboard accounts
      identity: {
        country: 'us',
        entity_type: 'non_profit',
        business_details: { registered_name: input.legalName },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
            ach_debit_payments: { requested: true },
          },
        },
        ...(input.needsTransfers
          ? { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } }
          : {}),
      },
      defaults: {
        currency: 'usd',
        locales: ['en-US'],
        responsibilities: { fees_collector: input.feesCollector, losses_collector: 'stripe' },
      },
      metadata: { sgo_id: input.sgoId, purpose: 'section_25f_segregated_account' },
      include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
    },
    { idempotencyKey: `sgo_${input.sgoId}_acct_v1` },
  );
  return account; // account.id is 'acct_...'
}

export async function createSgoOnboardingLink(accountId: string, origin: string) {
  const stripe = getStripe();
  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        collection_options: { fields: 'eventually_due' },
        refresh_url: `${origin}/sgo/stripe/refresh`, // must mint a new link and redirect
        return_url: `${origin}/sgo/stripe/return`,   // carries no state; re-read account.requirements
      },
    },
  });
  return link.url; // single use; redirect the signed-in SGO admin; never email it
}
```

Note: Stripe's v2 curl samples send `Stripe-Version: 2026-10-28.preview`. If the SDK default version is rejected for `/v2/core/accounts` on your account, pass `{ apiVersion: '2026-10-28.preview' }` as a request option for these two calls (Open Question 9).

### S3. Create the gift PaymentIntent (strategy switch; nothing nets a platform fee out of the gift by default)

```ts
// app/api/gifts/[giftId]/payment-intent/route.ts
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { loadGiftForCheckout } from '@/lib/gifts'; // your code

export const runtime = 'nodejs';

type SettlementStrategy =
  | 'DEST_OBO_FULL_TO_SGO'            // i-A: destination + on_behalf_of, 100% transfers, platform pays Stripe
  | 'DIRECT_NO_APP_FEE'               // i-B or i-C depending on the account's fees_collector
  | 'DEST_OBO_EXACT_TRANSFER_PLUS_FEE'; // ii-B: one charge = gift + service fee, SGO receives exactly the gift

export async function POST(_req: Request, { params }: { params: Promise<{ giftId: string }> }) {
  const { giftId } = await params;
  const gift = await loadGiftForCheckout(giftId);
  // gift: { id, designatedCents, serviceFeeCents, strategy, sgo: { stripeAccountId, legalName, listedOnIrsSgoList },
  //         donor: { stripeCustomerId }, designationAcceptedAt, creditEligibleFrom }
  if (!gift.designationAcceptedAt) return NextResponse.json({ error: 'designation_required' }, { status: 400 });
  if (!gift.sgo.listedOnIrsSgoList) return NextResponse.json({ error: 'sgo_not_listed' }, { status: 409 });
  if (!Number.isInteger(gift.designatedCents) || gift.designatedCents < 50) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
  }

  const stripe = getStripe();
  const strategy: SettlementStrategy = gift.strategy;

  const base: Stripe.PaymentIntentCreateParams = {
    amount: gift.designatedCents,
    currency: 'usd',                                         // fact 1: U.S. dollars only
    allowed_payment_method_types: ['card', 'us_bank_account'], // fact 23: no crypto, no BNPL
    payment_method_options: { us_bank_account: { verification_method: 'automatic' } },
    description: `Section 25F qualified contribution to ${gift.sgo.legalName}`,
    metadata: {
      gift_id: gift.id,
      kind: 'section_25f_designated_gift',
      designated_cents: String(gift.designatedCents),
      strategy,
    },
  };

  let pi: Stripe.PaymentIntent;

  if (strategy === 'DEST_OBO_FULL_TO_SGO') {
    pi = await stripe.paymentIntents.create(
      {
        ...base,
        customer: gift.donor.stripeCustomerId,               // platform Customer (ACH guide expects a customer)
        on_behalf_of: gift.sgo.stripeAccountId,              // SGO is settlement merchant / business of record
        transfer_data: { destination: gift.sgo.stripeAccountId }, // no amount => entire charge transfers
        // no application_fee_amount
      },
      { idempotencyKey: `gift_${gift.id}_pi_v1` },
    );
  } else if (strategy === 'DIRECT_NO_APP_FEE') {
    pi = await stripe.paymentIntents.create(
      { ...base },                                           // charge lives on the SGO's account
      { idempotencyKey: `gift_${gift.id}_pi_v1`, stripeAccount: gift.sgo.stripeAccountId },
    );
    // Client must use loadStripe(pk, { stripeAccount: gift.sgo.stripeAccountId }).
    // A Customer, if used, must be created on the connected account.
  } else {
    // DEST_OBO_EXACT_TRANSFER_PLUS_FEE
    pi = await stripe.paymentIntents.create(
      {
        ...base,
        amount: gift.designatedCents + gift.serviceFeeCents,
        customer: gift.donor.stripeCustomerId,
        on_behalf_of: gift.sgo.stripeAccountId,
        transfer_data: { destination: gift.sgo.stripeAccountId, amount: gift.designatedCents },
        metadata: { ...base.metadata, service_fee_cents: String(gift.serviceFeeCents) },
      },
      { idempotencyKey: `gift_${gift.id}_pi_v1` },
    );
  }

  return NextResponse.json({
    clientSecret: pi.client_secret,
    connectedAccountId: strategy === 'DIRECT_NO_APP_FEE' ? gift.sgo.stripeAccountId : null,
  });
}
```

If the donor changes the amount after the intent exists, call `stripe.paymentIntents.update(pi.id, { amount, ... })` (and, on the client, `elements.fetchUpdates()`), or create a new gift row with a new idempotency key. Reusing the same key with different params returns an error (fact 24).

**[FACT-CHECK] required change before shipping S3.** As written, the route calls `paymentIntents.create` every time it is hit and relies on the key `gift_<id>_pi_v1` to return the same intent. That only holds while Stripe still has the key (it may prune keys after 24 hours, fact 24A). A donor who reopens the pay page two days later would get a second PaymentIntent for the same gift. Persist `pi.id` on the gift row the first time, and on later calls do `stripe.paymentIntents.retrieve(gift.stripePaymentIntentId)` (with `{ stripeAccount }` for direct charges) and return its `client_secret` if the intent is still payable. The same applies to S6 (service fee), S7 (invoice) and S8 (refund). The sketch also does not implement the January 1, 2027 gate (Engineering Implication 8) or the SGO-list removal-date check (fact 14); add both before live mode.

### S4. Client: Payment Element

```tsx
// app/give/[giftId]/pay/PayForm.tsx
'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

function Inner({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    // Stripe's guide: validate the form and collect wallet details (Apple Pay / Google Pay) first.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Please check your payment details.');
      setBusy(false);
      return;
    }
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
    if (error) setError(error.message ?? 'Payment could not be completed.'); // otherwise the browser is redirected
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || busy}>Give</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function PayForm(props: { clientSecret: string; connectedAccountId: string | null; returnUrl: string }) {
  // Memoize: loadStripe must not run on every render. Pass stripeAccount only for direct charges.
  const stripePromise = useMemo(
    () =>
      loadStripe(
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
        props.connectedAccountId ? { stripeAccount: props.connectedAccountId } : undefined,
      ),
    [props.connectedAccountId],
  );
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: props.clientSecret }}>
      <Inner returnUrl={props.returnUrl} />
    </Elements>
  );
}
```

Return page: read `payment_intent_client_secret` from the query string, call `stripe.retrievePaymentIntent(clientSecret)`, and show `succeeded` / `processing` ("your bank payment is pending") / `requires_payment_method` (failed; try again). The database state changes only from webhooks.

### S5. Webhook route handler (raw body, signature, dedupe)

```ts
// app/api/webhooks/stripe/route.ts
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { recordEventOnce, onGiftSucceeded, onGiftProcessing, onGiftFailed,
         onDispute, onRefund, onInvoicePaid, onInvoiceFailed, onAccountUpdated } from '@/lib/ledger'; // your code

export const runtime = 'nodejs'; // the default; stated for clarity (the 'edge' value is deprecated in Next 16)
// No `export const dynamic`: POST handlers are not cached, and Next 16 removes `dynamic` when Cache Components is enabled.

// Two destinations in Stripe: "Your account" and "Connected accounts". Each has its own whsec_ secret.
const SECRETS = [process.env.STRIPE_WEBHOOK_SECRET_PLATFORM, process.env.STRIPE_WEBHOOK_SECRET_CONNECT]
  .filter((s): s is string => Boolean(s));

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const rawBody = await request.text(); // never request.json() before verifying
  const stripe = getStripe();

  let event: Stripe.Event | null = null;
  for (const secret of SECRETS) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret); // default tolerance 300 s; do not pass 0
      break;
    } catch {
      /* try the next secret */
    }
  }
  if (!event) return new Response('bad signature', { status: 400 });

  // Events can repeat and arrive out of order: insert event.id under a unique index and stop if it exists.
  const firstTime = await recordEventOnce(event.id, event.type, event.account ?? null);
  if (!firstTime) return Response.json({ received: true, duplicate: true });

  switch (event.type) {
    case 'payment_intent.succeeded':      await onGiftSucceeded(event.data.object, event.account ?? null); break;
    case 'payment_intent.processing':     await onGiftProcessing(event.data.object); break; // ACH initiated
    case 'payment_intent.payment_failed': await onGiftFailed(event.data.object); break;
    case 'charge.dispute.created':        await onDispute(event.data.object); break;
    case 'charge.refunded':               await onRefund(event.data.object); break;
    case 'invoice.paid':                  await onInvoicePaid(event.data.object); break;
    case 'invoice.payment_failed':        await onInvoiceFailed(event.data.object); break;
    case 'account.updated':               await onAccountUpdated(event.data.object); break;
    default: break;
  }
  return Response.json({ received: true });
}
```

Keep handlers short or push work to the queue so the 2xx goes out quickly. Local testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and, for connected-account events, `stripe listen --all-snapshot --forward-connect-to localhost:3000/api/webhooks/stripe`.

### S6. Shape ii-A: separate service-fee charge on the platform (cards)

```ts
// lib/service-fee.ts: run from the payment_intent.succeeded handler of the gift (strategy DEST_OBO_FULL_TO_SGO)
import { getStripe } from './stripe';

export async function chargeServiceFee(input: {
  giftId: string; customerId: string; paymentMethodId: string; feeCents: number;
}) {
  const stripe = getStripe();
  try {
    return await stripe.paymentIntents.create(
      {
        amount: input.feeCents,
        currency: 'usd',
        customer: input.customerId,
        payment_method: input.paymentMethodId, // card saved on the platform Customer during the gift
        allowed_payment_method_types: ['card'],
        confirm: true,
        off_session: true,
        description: 'Platform service fee (not a charitable contribution; not part of the section 25F gift)',
        statement_descriptor_suffix: 'SERVICE FEE',
        metadata: { gift_id: input.giftId, kind: 'platform_service_fee_non_designated' },
        // no on_behalf_of, no transfer_data: the platform is the merchant of record for this charge
      },
      { idempotencyKey: `gift_${input.giftId}_servicefee_v1` },
    );
  } catch (err) {
    // Never roll back or block the gift because the fee failed. Record and follow up.
    return null;
  }
}
```

To have the card available for this second charge, add `setup_future_usage: 'off_session'` and `customer` to the gift PaymentIntent, show the donor both amounts and the two-charge disclosure before confirmation, and read `payment_intent.payment_method` in the webhook. Two cautions: (1) ACH mandates authorized `on_behalf_of` an SGO cannot be reused by another account (fact 45), so limit ii-A to card gifts or collect a second authorization; (2) reuse of a card saved on an `on_behalf_of` PaymentIntent for a platform-only charge is not confirmed by the docs fetched; test it in a sandbox before relying on it (Open Question 8).

### S7. Stripe Invoicing: bill a camp its success fee

```ts
// lib/camp-billing.ts
import { getStripe } from './stripe';

export async function ensureCampCustomer(camp: { id: string; legalName: string; billingEmail: string }) {
  const stripe = getStripe();
  return stripe.customers.create(
    { name: camp.legalName, email: camp.billingEmail, metadata: { camp_id: camp.id } },
    { idempotencyKey: `camp_${camp.id}_customer_v1` },
  );
}

export async function invoiceSuccessFee(input: {
  customerId: string; bookingId: string; feeCents: number; description: string; netDays?: number;
}) {
  const stripe = getStripe();

  const invoice = await stripe.invoices.create(
    {
      customer: input.customerId,
      collection_method: 'send_invoice',
      days_until_due: input.netDays ?? 30,          // payment terms; required for "past due" tracking
      auto_advance: false,                          // we finalize explicitly
      pending_invoice_items_behavior: 'exclude',
      payment_settings: { payment_method_types: ['us_bank_account', 'card'] },
      description: 'Success fee for a completed scholarship-funded booking',
      metadata: { booking_id: input.bookingId, kind: 'camp_success_fee' },
    },
    { idempotencyKey: `booking_${input.bookingId}_invoice_v1` },
  );

  await stripe.invoiceItems.create(
    {
      customer: input.customerId,
      invoice: invoice.id,
      amount: input.feeCents,                       // integer cents
      currency: 'usd',
      description: input.description,
      metadata: { booking_id: input.bookingId },
    },
    { idempotencyKey: `booking_${input.bookingId}_item_v1` },
  );

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
  const sent = await stripe.invoices.sendInvoice(finalized.id!); // emails the hosted invoice page
  return { id: sent.id, hostedUrl: sent.hosted_invoice_url, pdf: sent.invoice_pdf, status: sent.status };
}
```

Mark paid from `invoice.paid`. Voiding uses `stripe.invoices.voidInvoice(id)`. The same function, with the SGO as the Customer, implements "platform fee invoiced separately" for shape i-A/i-B. The camp fee must never be an `application_fee_amount` on a scholarship payment or a deduction from a family payment (spec constraint).

### S8. Refund of a destination-charge gift (only if counsel allows refunds of designated gifts)

```ts
await getStripe().refunds.create(
  { payment_intent: paymentIntentId, reverse_transfer: true }, // pulls the funds back from the SGO
  { idempotencyKey: `gift_${giftId}_refund_v1` },
);
// Direct charge: same call with { stripeAccount: sgoAccountId } and without reverse_transfer.
```

### P1. Provider interface for income rails

```ts
// lib/rails/types.ts
export type RailProviderId = 'plaid_payroll' | 'plaid_bank' | 'argyle' | 'truv' | 'pinwheel' | 'fixture';

export interface RailProviderInfo {
  id: RailProviderId;
  /** For the evidence pack and for counsel-driven routing. Text comes from the vendor's own statements. */
  craPosture: 'vendor_states_not_cra' | 'vendor_is_cra' | 'unknown';
  dataBasis: 'payroll_gross' | 'bank_net_deposits';
}

export interface W2Evidence {
  taxYear: number;
  employerName: string | null;
  employerEinMasked: string | null;
  box1WagesCents: number | null;          // wages, tips, other compensation
  box3SocialSecurityWagesCents: number | null;
  box5MedicareWagesCents: number | null;
  providerDocumentId: string | null;
}

export interface PaystubEvidence {
  payDate: string;                        // YYYY-MM-DD
  periodStart: string | null;
  periodEnd: string | null;
  grossCurrentCents: number | null;
  grossYtdCents: number | null;
  netYtdCents: number | null;
  employerName: string | null;
  providerDocumentId: string | null;
}

export interface IncomeEvidence {
  provider: RailProviderInfo;
  providerUserRef: string;                // e.g. Plaid user_id (usr_...)
  fetchedAt: string;                      // ISO timestamp
  w2s: W2Evidence[];
  paystubs: PaystubEvidence[];
  warnings: string[];
  rawResponseSha256: string;              // hash the raw payload; store the hash, not the payload, long term
}

export interface RailProvider {
  info: RailProviderInfo;
  /** Create (or fetch) the provider-side user and return what the browser needs to open the widget. */
  startSession(input: { householdAdultId: string; webhookUrl: string }): Promise<{ providerUserRef: string; linkToken: string }>;
  /** Verify and normalize an incoming webhook. Must use the raw body. */
  parseWebhook(rawBody: string, headers: Headers): Promise<{ providerUserRef: string; status: 'ready' | 'failed' | 'ignored' }>;
  /** Pull and normalize data once the provider says it is ready. */
  fetchIncome(providerUserRef: string): Promise<IncomeEvidence>;
}
```

```ts
// lib/rails/prior-year.ts: pure function; unit-test with fixtures, not with the vendor sandbox
import type { IncomeEvidence } from './types';

export interface PriorYearWages {
  incomeYear: number;
  byW2Box1Cents: number | null;       // sum of box 1 across W-2s for the year
  byW2Box5Cents: number | null;       // sum of Medicare wages (closer to gross than box 1)
  byFinalPaystubYtdCents: number | null; // per employer: latest pay stub dated in the year; summed
  coverage: 'w2_and_paystub' | 'w2_only' | 'paystub_only' | 'none';
  notes: string[];
}

export function priorYearWages(ev: IncomeEvidence, incomeYear: number): PriorYearWages {
  const notes: string[] = [];
  const w2s = ev.w2s.filter((w) => w.taxYear === incomeYear);
  const sum = (xs: Array<number | null>) => (xs.length && xs.every((x) => x != null) ? xs.reduce<number>((a, b) => a + (b as number), 0) : null);

  const lastStubByEmployer = new Map<string, { payDate: string; ytd: number }>();
  for (const s of ev.paystubs) {
    if (!s.payDate.startsWith(String(incomeYear)) || s.grossYtdCents == null) continue;
    const key = s.employerName ?? 'unknown';
    const cur = lastStubByEmployer.get(key);
    if (!cur || s.payDate > cur.payDate) lastStubByEmployer.set(key, { payDate: s.payDate, ytd: s.grossYtdCents });
  }
  for (const [employer, v] of lastStubByEmployer) {
    if (v.payDate < `${incomeYear}-12-01`) notes.push(`Latest ${incomeYear} pay stub for ${employer} is dated ${v.payDate}; YTD may not cover the full year.`);
  }
  const stubTotal = lastStubByEmployer.size ? [...lastStubByEmployer.values()].reduce((a, b) => a + b.ytd, 0) : null;

  const coverage = w2s.length && stubTotal != null ? 'w2_and_paystub' : w2s.length ? 'w2_only' : stubTotal != null ? 'paystub_only' : 'none';
  if (ev.provider.dataBasis === 'bank_net_deposits') notes.push('Bank data is net deposits, not gross income.');
  return {
    incomeYear,
    byW2Box1Cents: sum(w2s.map((w) => w.box1WagesCents)),
    byW2Box5Cents: sum(w2s.map((w) => w.box5MedicareWagesCents)),
    byFinalPaystubYtdCents: stubTotal,
    coverage,
    notes,
  };
}
```

The decision engine (another module) decides how to compare these measures to the threshold. A safe default while the rules are unsettled: eligible only if the **highest** available measure, plus all other declared household income, is at or below the threshold; ineligible only if the **lowest** is above it; otherwise `needs_review`. (This default is my suggestion, not something in the sources.)

### P2. Plaid Payroll Income adapter: exact Sandbox flow (REST via fetch)

Base URL `https://sandbox.plaid.com`. Every call is `POST` with `Content-Type: application/json`. Credentials go in headers `PLAID-CLIENT-ID` and `PLAID-SECRET` (or as `client_id` / `secret` body fields). Version header `Plaid-Version: 2020-09-14`.

```ts
// lib/rails/plaid.ts
import { createHash } from 'node:crypto';
import type { IncomeEvidence, RailProvider } from './types';

const BASE = process.env.PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';

async function plaid<T>(path: string, body: Record<string, unknown>): Promise<{ json: T; raw: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
      'PLAID-SECRET': process.env.PLAID_SECRET!,
      'Plaid-Version': '2020-09-14',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Plaid ${path} failed with ${res.status}: ${raw.slice(0, 500)}`); // error bodies have error_type / error_code
  return { json: JSON.parse(raw) as T, raw };
}

const toCents = (v: string | number | null | undefined) =>
  v == null || v === '' ? null : Math.round(Number(v) * 100);

export const plaidPayroll: RailProvider = {
  info: { id: 'plaid_payroll', craPosture: 'vendor_states_not_cra', dataBasis: 'payroll_gross' },

  async startSession({ householdAdultId, webhookUrl }) {
    // 1. /user/create: idempotent per client_user_id; no PII in client_user_id; returns { user_id: "usr_...", request_id }
    const user = await plaid<{ user_id: string }>('/user/create', { client_user_id: householdAdultId });

    // 2. /link/token/create: returns { link_token, expiration, request_id }
    //    Plaid's own sample sends both the top-level user_id (from /user/create) and user.client_user_id (our id;
    //    Plaid: "currently used as a means of searching logs for the given user in the Plaid Dashboard").
    //    The `user` object is "Required if `user_id` isn't included".
    const link = await plaid<{ link_token: string; expiration: string }>('/link/token/create', {
      user_id: user.json.user_id,
      user: { client_user_id: householdAdultId },
      client_name: 'Your App Name',
      language: 'en',
      country_codes: ['US'],
      products: ['income_verification'],            // Payroll Income cannot be combined with other products
      income_verification: {
        income_source_types: ['payroll'],
        payroll_income: { flow_types: ['payroll_digital_income'] }, // omit to also offer document upload in Link
      },
      webhook: webhookUrl,
    });
    return { providerUserRef: user.json.user_id, linkToken: link.json.link_token };
  },

  async parseWebhook(rawBody, headers) {
    // Verify first: 'plaid-verification' header is a JWT. Require alg ES256, fetch the JWK for its kid from
    // /webhook_verification_key/get { key_id }, verify the signature, require iat within 5 minutes, and compare
    // sha256(rawBody) with the request_body_sha256 claim using a constant-time comparison. (Use the 'jose' package.)
    await verifyPlaidWebhook(rawBody, headers.get('plaid-verification'));
    const b = JSON.parse(rawBody) as {
      webhook_type: string; webhook_code: string; user_id?: string; item_id?: string; verification_status?: string;
    };
    if (b.webhook_type !== 'INCOME' || b.webhook_code !== 'USER_INCOME_VERIFICATION' || !b.user_id) {
      return { providerUserRef: b.user_id ?? '', status: 'ignored' };
    }
    // COMPLETE can still mean "documents were not parsable": 'ready' only means "go fetch and inspect".
    // The deprecated VERIFICATION_STATUS_PENDING_APPROVAL (and anything unknown) is ignored, not treated as failure.
    const status =
      b.verification_status === 'VERIFICATION_STATUS_PROCESSING_COMPLETE' ? 'ready'
      : b.verification_status === 'VERIFICATION_STATUS_PROCESSING_FAILED' ? 'failed'
      : 'ignored';
    return { providerUserRef: b.user_id, status };
  },

  async fetchIncome(userId): Promise<IncomeEvidence> {
    // 3. /credit/payroll_income/get { user_id } -> { items: [...], request_id }
    const { json, raw } = await plaid<PayrollIncomeGetResponse>('/credit/payroll_income/get', { user_id: userId });
    const warnings: string[] = [];
    const w2s: IncomeEvidence['w2s'] = [];
    const paystubs: IncomeEvidence['paystubs'] = [];
    if (json.error) warnings.push(`Plaid error ${json.error.error_type ?? ''}/${json.error.error_code ?? ''}`); // nullable top-level error

    for (const item of json.items ?? []) {
      if (item.status?.processing_status && item.status.processing_status !== 'PROCESSING_COMPLETE') {
        warnings.push(`Item ${item.item_id} status ${item.status.processing_status}`);
      }
      for (const pi of item.payroll_income ?? []) {
        for (const w of pi.w2s ?? []) {
          w2s.push({
            taxYear: Number(w.tax_year),
            employerName: w.employer?.name ?? null,
            employerEinMasked: w.employer_id_number ?? null,
            box1WagesCents: toCents(w.wages_tips_other_comp),
            box3SocialSecurityWagesCents: toCents(w.social_security_wages),
            box5MedicareWagesCents: toCents(w.medicare_wages_and_tips),
            providerDocumentId: w.document_id ?? null,
          });
        }
        for (const s of pi.pay_stubs ?? []) {
          if (!s.pay_period_details?.pay_date) continue;
          paystubs.push({
            payDate: s.pay_period_details.pay_date,
            periodStart: s.pay_period_details.start_date ?? null,
            periodEnd: s.pay_period_details.end_date ?? null,
            grossCurrentCents: toCents(s.earnings?.total?.current_amount),
            grossYtdCents: toCents(s.earnings?.total?.ytd_amount),
            netYtdCents: toCents(s.net_pay?.ytd_amount),
            employerName: s.employer?.name ?? null,
            providerDocumentId: s.document_id ?? null,
          });
        }
      }
    }
    return {
      provider: this.info, providerUserRef: userId, fetchedAt: new Date().toISOString(),
      w2s, paystubs, warnings, rawResponseSha256: createHash('sha256').update(raw).digest('hex'),
    };
  },
};

// Only the fields used above; all are nullable in Plaid's reference. W-2 amounts are strings, pay stub amounts are numbers.
interface PayrollIncomeGetResponse {
  items?: Array<{
    item_id: string; institution_id?: string; institution_name?: string;
    status?: { processing_status?: 'UNKNOWN' | 'PROCESSING_COMPLETE' | 'PROCESSING' | 'FAILED' | 'APPROVAL_STATUS_PENDING' | null } | null;
    updated_at?: string | null;
    payroll_income?: Array<{
      account_id?: string | null;
      w2s?: Array<{
        document_id?: string; tax_year?: string | null; employer_id_number?: string | null;
        wages_tips_other_comp?: string | null; social_security_wages?: string | null; medicare_wages_and_tips?: string | null;
        employer?: { name?: string | null };
      }>;
      pay_stubs?: Array<{
        document_id?: string | null;
        earnings?: { total?: { current_amount?: number | null; ytd_amount?: number | null } };
        net_pay?: { current_amount?: number | null; ytd_amount?: number | null };
        pay_period_details?: { pay_date?: string | null; start_date?: string | null; end_date?: string | null; gross_earnings?: number | null; pay_frequency?: string | null };
        employer?: { name?: string | null };
      }>;
    }>;
  }>;
  error?: { error_type?: string; error_code?: string; error_message?: string } | null;
  request_id: string;
}

declare function verifyPlaidWebhook(rawBody: string, jwt: string | null): Promise<void>; // implement per fact 58
```

Browser side (`react-plaid-link@5`):

```tsx
'use client';
import { usePlaidLink } from 'react-plaid-link';

export function ConnectPayroll({ linkToken, onDone, onFallback }: { linkToken: string | null; onDone: () => void; onFallback: () => void }) {
  const { open, ready } = usePlaidLink({
    token: linkToken,                         // may be null until fetched
    onSuccess: () => onDone(),                // data readiness comes from the webhook, not from this callback
    onExit: () => onFallback(),               // declined or failed: fall back to upload without restarting intake
  });
  return <button onClick={() => open()} disabled={!ready}>Connect payroll</button>;
}
```

Sandbox walk-through
1. Get Sandbox `client_id` and `secret` from `https://dashboard.plaid.com` (no sales call).
2. Interactive: open Link with the token; choose Paycom, Paychex or Workday; username `user_good`, password `pass_good`, SSN last four `1234`.
3. Headless (CI): after `/user/create`, call `/sandbox/public_token/create` with `{ "institution_id": "ins_135842", "initial_products": ["income_verification"], "user_id": "usr_...", "options": { "income_verification": { "income_source_types": ["payroll"] } } }`. Its output is not used; the call only initializes the user. Then call `/credit/payroll_income/get`. (**[FACT-CHECK]** the original omitted `options.income_verification`; Plaid's reference says "This field is required if `income_verification` is included in the `initial_products` array", `EXTRA/plaid_docs/api_sandbox.md` lines 151-159. Not run against a sandbox.)
4. Webhook test: `/sandbox/income/fire_webhook` with `{ "item_id": "...", "user_id": "usr_...", "webhook": "https://.../api/webhooks/plaid", "webhook_code": "USER_INCOME_VERIFICATION", "verification_status": "VERIFICATION_STATUS_PROCESSING_COMPLETE" }`.
5. Expected responses: `/user/create` → `{ "user_id": "usr_9nSp2KuZ2x4JDw", "request_id": "Aim3b" }`; webhook body → `{ "webhook_type": "INCOME", "webhook_code": "USER_INCOME_VERIFICATION", "item_id": "...", "user_id": "usr_...", "verification_status": "VERIFICATION_STATUS_PROCESSING_COMPLETE", "environment": "sandbox" }`.
6. Bank Income fallback in Sandbox: `/sandbox/public_token/create` with a non-OAuth test institution such as First Platypus Bank `ins_109508` (**[FACT-CHECK]** the original suggested `ins_20`, which appears in Plaid's docs only inside sample responses; `ins_109508` is the one Plaid names for this), `initial_products: ["income_verification"]`, `user_id`, and `options: { override_username: "user_bank_income", override_password: "{}", income_verification: { income_source_types: ["bank"], bank_income: { days_requested: 731 } } }`, then `/credit/bank_income/get` with `user_id`.

---

## ENGINEERING IMPLICATIONS

Payments: structure
1. Put settlement behind one `SettlementStrategy` setting per SGO (S3). Ship with a strategy that takes **no** platform cut from a designated gift. The spec forbids a live cut before the counsel memo, and the sources are silent on fees (fact 16).
2. Make the SGO the merchant of record for the gift in every strategy (direct charge, or destination charge with `on_behalf_of`). Checkout page, receipt, statement descriptor and acknowledgment must all name the SGO (fact 31). **[FACT-CHECK]** the cautious default while the fee memo is open is a direct charge on the SGO's own Stripe account (shapes i-B / i-C): the platform never holds the gift. A destination charge puts the gift through the platform's Stripe balance first; do not ship that until counsel has read fact 2A ("directly to one or more SGOs, rather than through one or more entities"). The trade-off is that with direct charges refunds, chargebacks and ACH returns are debited from the SGO's balance (fact 5A), so that risk allocation has to be agreed with the SGO.
3. One Stripe connected account per SGO 25F segregated account (per covered State for multistate SGOs). Its payout bank account must be the 25F segregated account, and nothing except designated gifts may be charged through it (facts 5, 7). (**[FACT-CHECK]** this is an inference from facts 5 and 7, not source text, and it has a cost: Stripe can debit that same bank account for chargebacks and negative balances; settle implication 40 and Open Question 2a with counsel and the SGO first.) Non-designated gifts and all fees need a different account or flow.
4. Store money as integer cents, currency `usd` only. Reject any other currency. Pass `allowed_payment_method_types: ['card', 'us_bank_account']` explicitly; never rely on Dashboard defaults, which can enable crypto/stablecoin or BNPL (facts 1, 23).
5. `payment_method_types` no longer exists on PaymentIntent create in `stripe@23`; code copied from older tutorials will not type-check (fact 20).
6. Record on every gift: designation flag + timestamp + copy version, donor legal name and address, spouse split if any, SGO id and EIN, SGO-list snapshot (listed yes/no, list date), strategy, PaymentIntent id, charge id, destination payment id (fact 38), payment method type, the three timestamps (intent created, donor confirmed, `succeeded` event), fee line items, and e-delivery consent (facts 3, 8, 9, 11, 14).
7. Gift state machine: `draft → requires_payment → processing (ACH) → succeeded → [refunded | disputed | ach_returned]` and `failed`. Acknowledgment totals are computed from gifts that are `succeeded` and not reversed. ACH can fail or be disputed after success (fact 44), so the January 31 acknowledgment job and the February 28 report must run from the ledger at generation time, and a later reversal must trigger a corrected acknowledgment workflow.
8. Date gate: refuse to create or confirm a designated gift before 2027-01-01 in live mode (fact 13). Use the same gate in the UI and in the PaymentIntent route. Keep sandbox ungated.
9. Before creating the PaymentIntent, re-check that the SGO is on the list snapshot and that the SGO's Stripe account can accept charges. Block otherwise (fact 14).
10. No "undo designation" and no automatic refund button for designated gifts. Route refund requests to a human until counsel sets the rule (fact 3).
11. Idempotency keys on every create call, derived from our own ids (`gift_<id>_pi_v1`, `booking_<id>_invoice_v1`). Bump the suffix only when parameters legitimately change (fact 24). **[FACT-CHECK]** keys are a short-window guard only (Stripe may prune them after 24 hours). Also persist each Stripe object id on our row under a unique constraint and retrieve instead of re-creating (fact 24A).
12. Webhook route: Node runtime, `await request.text()`, `constructEvent`, two secrets (platform + connected accounts), unique index on `event.id`, tolerate out-of-order delivery, respond fast and queue the work (facts 25-29). Fulfillment must not depend on the browser returning.
13. Disputes: with destination charges the platform's balance is debited for the gift amount plus the dispute fee, then you may reverse the transfer; with direct charges the SGO's balance is debited (facts 30, 37). Decide and document who bears chargebacks before choosing a shape; keep a platform balance buffer if using shape i-A.
14. Shape i-A/i-B make the platform pay Stripe processing on every gift (about $49.60 on a $1,700 domestic card gift at list price, 2.9% + 30¢; $5.00 by ACH, 0.8% capped) and, for i-B, Connect platform fees (fact 41; for i-A whether Connect fees apply is UNVERIFIED, see the fact 50 table). Build the SGO invoice job (S7) and the cost report at the same time, or the platform funds processing out of pocket. Offer ACH prominently.
15. Service-fee copy: if a donor-paid fee exists, show it as its own line, label it as not a charitable contribution and not part of the 25F gift, and keep it out of the acknowledgment amount (spec + fact 8). The "effectively free" claim must then be qualified in the tax-math panel.
16. Individuals only: add an attestation checkbox and block obviously non-individual donor names; do not offer invoices/POs for gifts (fact 12).
17. Joint gifts: one payment, two donor records. Validate each spouse's portion and keep two acknowledgment rows (fact 11).

Payments: business billing
18. Camps are Stripe Customers of the platform, billed with `send_invoice`, net terms via `days_until_due`, ACH and card enabled. Track `invoice.paid` / `invoice.payment_failed` / `invoice.overdue`. Never implement the camp fee as an application fee on a scholarship payment or as a deduction from a family payment (S7, spec).
19. Budget for Stripe Invoicing's 0.4% per paid invoice plus payment fees (fact 41).

Stripe account setup
20. The platform Stripe account, Connect platform profile and all rail accounts belong to the parent's entity (spec). Tell each SGO to request Stripe's nonprofit pricing on its own account, and expect questions about the "80% tax-deductible donations" test (fact 42, Open Question 4).
21. Prefer Accounts v2 for SGO accounts; `fees_collector` and `dashboard` are permanent, so the settlement strategy must be decided before SGO onboarding or SGOs will need new accounts later (facts 35, 39).

Rails
22. Build `RailProvider` first, with a `fixture` provider that returns hand-written `IncomeEvidence`. All threshold and edge-case tests run against fixtures; vendor sandboxes are only for contract tests (Plaid payroll sandbox data is fixed; fact 56).
23. Implement Plaid Payroll Income first (P2) using REST via `fetch`; do not pin the code to plaid-node v51's new surface yet (fact 62). Use the new `user_id` flow (fact 55). `client_user_id` must be an opaque internal id, never an email or phone.
24. The auto-submit toggle must fall back to upload on `onExit`, on a `VERIFICATION_STATUS_PROCESSING_FAILED` webhook, on an empty result, or on a timeout, without restarting intake (spec; P2).
25. A payroll connection proves wages at connected employers only. It is evidence toward household income, not the total (fact 19). The intake must still collect other adults' income, other cash income (child support, alimony), and a certification, and the engine must mark partial coverage `needs_review` rather than pass silently.
26. Prior calendar year: compute from the W-2 for year Y and from the last pay stub dated in year Y; expose both and the gap between them (P1). In January to mid-February the W-2 for Y may not be in the payroll portal yet; rely on the final pay stub YTD and flag it.
27. Bank Income is net deposits. Treat it as supporting evidence that always goes to `needs_review` for a gross-income test (fact 59).
28. Store provider identifiers, document ids and a hash of the raw response; do not store raw rail payloads or pay stub PDFs past the SGO-agreed window. Plaid document download URLs are single-use and expire in two minutes, so fetch-and-hash immediately if a copy is needed (fact 57).
29. Carry `craPosture` and the consent record (copy version, timestamp, named recipient SGO, purpose, duration) into the evidence pack. The parent's instruction to share should be explicit and in writing, per the spec's consumer-directed design and FCRA §604(a)(2) wording (fact 52).
30. Verify every rail webhook against the raw body: Plaid JWT/ES256 with `request_body_sha256` (fact 58); Argyle HMAC-SHA512 `X-Argyle-Signature` (fact 63); Truv `X-WEBHOOK-SIGN` (fact 65).
31. Cost control: Plaid bills Payroll Income once per user when data becomes available (fact 61). Create the Link token only after consent and after the parent picks auto-submit.

IRS transcripts
32. v1 = guided self-download and upload (fact 78). Provide step-by-step instructions, a generated 10-digit Customer File Number, and a parser for the tax return transcript and the wage and income transcript.
33. Matching on masked data: last four of SSN, first four letters of first and last name, first six characters of street address, tax year, Customer File Number (fact 71). Mismatch → `needs_review`, never auto-fail or auto-pass.
34. Never ask for IRS credentials, never automate the IRS Online Account, never offer to "fetch it for you" (fact 72).
35. Seasonal messaging: before the family has filed for the prior year there is no return transcript; steer them to W-2 / final pay stub / rail (facts 69, 70).
36. Leave an `irs_ives` provider slot in the interface but do not build it: enrollment needs a faxed wet-signed Form 13803, IRS suitability checks, e-Services registration, $4 per transcript, and an eligibility question that is not settled (facts 75-77).

Added by the fact-check (payments)
37. Do not ask donors for an SSN or TIN. The IRS report needs name, address and amount per unique donor number, and Treasury says the donor number exists to avoid TIN collection (fact 9).
38. Treat every proposed-reg rule as configurable and every in-force rule as fixed. In force now (temporary regs): designation at the time of the gift, irrevocability, goods/services subtraction, cash in U.S. dollars, no digital assets, acknowledgment contents and January 31, IRS report and February 28, unique donor number. Proposed only: spouse and partnership rules in §1.25F-2, donor reliance on the list, the 90 percent income definition, multistate allocation, household-income definition and verification methods (facts 1, 3, 4, 8-10, 13A).
39. Keep a gross, per-gift ledger reconciled to Stripe balance transactions. Stripe nets refunds, disputes and (in shape i-C) fees inside the SGO's Stripe balance and can debit the SGO's bank account when that balance goes negative (fact 5A). Acknowledgment and IRS-report totals must come from the ledger, never from payout amounts.
40. Decide with the SGO which bank account is the Stripe external account, and who funds chargebacks, ACH returns and dispute fees, before onboarding. If the external account is the 25F segregated account, Stripe debits for negative balances come out of it (fact 5A, Open Question 2a). Never use Stripe Account Debits against an SGO's 25F-linked account to collect a platform fee.
41. Handle `refund.updated` / `refund.failed` and the `pending` refund state; a refund can fail 45 days later for insufficient balance (fact 37A).
42. Call `elements.submit()` before `confirmPayment` (fact 22). Apple Pay and Google Pay are card wallets and will show up when `card` is allowed.
43. Create Stripe webhook destinations with the Snapshot payload format if the handler uses `constructEvent`; the Dashboard default is Thin (fact 28).
44. If the app turns on Next.js Cache Components, route files must not export `dynamic`, `revalidate` or `fetchCache` (removed in v16 under that mode; `https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config.md`, fetched 2026-11-18).
45. Pass the designation to the SGO, not just to our database: the definition requires the donor to designate "to the recipient SGO" (fact 3). The SGO-facing export or webhook must carry the designation flag, amount, timestamp and donor identity for every gift.

Added by the fact-check (rails)
46. In the Plaid adapter treat a `PROCESSING_COMPLETE` webhook as "fetch and inspect", check the top-level `error`, treat `APPROVAL_STATUS_PENDING` as not ready, and fall back to upload on an empty result (facts 57, 58).
47. Model 1099 income (`form1099s`) before claiming gig-worker coverage; the P2 sketch maps W-2s and pay stubs only (fact 57).
48. Set `craPosture: 'unknown'` for Truv; only Pinwheel states in the fetched pages that it is a CRA (facts 64, 65). The field records the vendor's statement about itself. It is not a determination about our own FCRA status.
49. If Argyle becomes a rail, design for its terms: one consented delivery per recipient and transaction, no re-delivery of stored data to a second SGO or camp without fresh consent and a refreshed retrieval, and authorization records kept for five years after the contract ends (fact 63A).

---

## OPEN QUESTIONS / AMBIGUITIES

Section 25F (the sources do not settle these)
1. **Platform and processor fees.** Does a platform fee, or a card/ACH processing fee netted before payout, reduce the "qualified contribution", break "depositing all qualified contributions into its section 25F segregated account", or count against the 10 percent? NOT IN SOURCES (fact 16). This decides between shapes i-A, i-B, i-C and ii-A, ii-B.
2. **Who may receive the charge.** Is a destination charge (created on the platform's Stripe account, with the SGO as settlement merchant via `on_behalf_of`, funds transferred immediately) a contribution "to a scholarship granting organization", made "directly ... rather than through one or more entities" (fact 2A, `PR` lines 596-599)? NOT IN SOURCES. A direct charge on the SGO's own Stripe account avoids the question, which is a reason to prefer shapes i-B / i-C unless counsel clears i-A.
2a. **[FACT-CHECK addition] Is a Stripe balance part of, or outside, the "section 25F segregated account"?** Gifts sit in the SGO's Stripe balance until payout, can be netted against refunds, disputes and fees there, and a negative balance can be debited from the SGO's bank account (fact 5A). Whether that satisfies "depositing all qualified contributions into its section 25F segregated account", which "must contain only qualified contributions and the earnings therefrom": NOT IN SOURCES.
3. **When an electronic contribution is "made".** Card authorization time vs capture vs settlement; ACH initiation vs settlement (up to 4 business days) vs later return. Matters for the January 1, 2027 start, December 31 cutoffs, and SGO-list reliance "on the date the donor makes a qualified contribution". NOT IN SOURCES (fact 17).
4. **Stripe nonprofit pricing vs 25F gifts.** Stripe requires 80% of volume from "tax-deductible donations". A 25F gift for which a credit is allowed is not taken into account under section 170 (`USC` line 230). Whether Stripe counts such gifts as qualifying volume is unknown; ask Stripe support in writing. Also unknown: the discounted rate itself, and whether it applies to connected accounts.
5. **Refunds, chargebacks and ACH returns of a designated gift.** Designation is irrevocable (fact 3) and the gift must be deposited regardless of credit outcome (fact 6). What happens to the acknowledgment, the unique donor number totals and the IRS report after a refund or a dispute is NOT IN SOURCES.
6. **Unique donor number format.** Provided by IRS instructions to registered SGOs; not in the source files (fact 10).
7. **Which instant/time zone governs the January 1, 2027 gate.** NOT IN SOURCES.

Stripe (verify in a sandbox before relying on it)
8. Reusing a card saved during an `on_behalf_of` destination charge for a second, platform-only charge (shape ii-A). Mandate reuse is explicitly blocked for ACH (fact 45); the card case was not found in the docs fetched.
9. Whether `stripe.v2.core.accounts.create` works on the SDK's default version `2026-10-28.endive` for this platform, or needs the `2026-10-28.preview` version shown in Stripe's curl samples. (**[FACT-CHECK]** evidence it should work on the GA version, short of a live test: Stripe says "The Accounts v2 API is generally available for Connect users", `EXTRA/stripe_docs/accept_payment_pi.md` line 297, and its changelog lists Accounts v2 changes under the GA `2026-10-28.endive` and `2026-09-30.endive` versions, `EXTRA/stripe_docs/changelog.md` lines 54, 134, 136.) Also whether a new platform can still call `/v1/accounts` if a v1-style account is ever needed (fact 39).
10. Whether a `non_profit` v2 account with `fees_collector: 'stripe'` and `dashboard: 'full'` is accepted with both `merchant` and `recipient` configurations, and which onboarding requirements Stripe imposes on a 501(c)(3) SGO. Not tested.
11. Stripe's own acceptable-use review of a donation platform for tax-credit scholarships (platform profile, fundraising terms): not researched; ask Stripe during Connect onboarding.
12. Whether Stripe-emailed receipts (`receipt_email`) should be suppressed so donors do not confuse them with the SGO's timely written acknowledgment. Product/counsel choice.

Rails
13. **FCRA status of the product itself** when it assembles rail data and furnishes a yes/no plus evidence to an SGO, and which permissible purpose applies. `ELIGIBILITY_FOR_GOVT_BENEFITS` maps to FCRA §604(a)(3)(D), which covers benefits "granted by a governmental instrumentality"; an SGO scholarship is privately granted. `WRITTEN_INSTRUCTION_OTHER` (§604(a)(2)) looks like the closer fit. Counsel must decide (facts 52, 60).
14. Whether a non-CRA rail (Plaid Income, Argyle Open Payroll) or a CRA rail (Pinwheel, Plaid Check) is the safer posture for this use. (**[FACT-CHECK]** the original listed Truv as a CRA rail; the pages fetched do not say that, so Truv's status is unknown, fact 65.) Argyle's terms also impose consumer-report-like adverse-action duties on the customer (fact 63).
15. Whether each vendor's production terms allow a scholarship-eligibility use case, and redisclosure of data to SGOs. **[FACT-CHECK]** partly answered for Argyle by its public customer terms (fact 63A: purpose limit, no sale, re-delivery only with fresh consent and a refreshed retrieval, CRA status only via a Service Order). Plaid, Pinwheel and Truv production terms were not fetched: NOT IN SOURCES.
16. Unit pricing for every rail. None publish a price list (facts 61, 63-65). Plaid shows prices in the Dashboard at Production application.
17. Argyle self-serve sandbox sign-up could not be verified (fact 63). Truv's status and roadmap after the Checkr acquisition are unknown (fact 65).
18. Whether final regulations keep "or may be verified through other relevant data sources" (fact 18). Comments are due December 1, 2026 (`PR` lines 99-100; confirmed in the rule itself, not only the spec).
19. How "annual income" under 24 CFR 5.609 maps to W-2 box 1 vs box 5 vs pay stub gross (pre-tax deductions). The proposed rule points to 24 CFR 5.609 but the mapping is NOT IN SOURCES; the P1 default sends disagreements to review.

IRS transcripts
20. Whether IVES accepts a scholarship-eligibility use case, and the content and future of the suspended January 2, 2024 policy change (fact 77).
21. Whether a non-practitioner company can be a Form 8821 designee with Transcript Delivery System access (fact 74). NOT IN SOURCES.
22. Form 4506-T processing time and whether wage and income data for the prior year is complete enough by the time families apply (fact 69 says data "generally" starts appearing the first week of February and may not include every form).
23. Exact on-screen steps and field labels inside the IRS Individual Online Account (behind login; not verifiable by curl; only the "Tax Records" then "transcripts" path is confirmed by the public FAQ). Write the parent instructions from a real walkthrough, not from this file.
24. **[FACT-CHECK addition]** Whether the IRS will give individuals unmasked wage and income transcripts for this purpose. The IRS says it "will provide unmasked Wage and Income transcripts when needed for preparing and filing tax returns" (`EXTRA/irs/about_transcripts.body.txt`); income verification for a scholarship is not that purpose, so plan for masked transcripts.

---

## VERIFICATION LOG

Fact-check date: 2026-11-18. Method: every quote in the file was searched for in its cited source after normalizing whitespace, curly quotes and Markdown link markup; line numbers were compared; each plain-English rule was read against its quote; confidence tags were compared with where the text actually sits (statute, temporary reg text, proposed reg text, preamble, vendor page). Scripts and re-fetched pages are in `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/factcheck_tools/` and `EXTRA/factcheck_payments/`.

What was checked
- All 78 original numbered facts, the version table, the two settlement tables, the rail comparison table, 12 code blocks, 36 engineering implications and 23 open questions. About 230 individual claims (quotes, numbers, dates, field names, endpoints, line citations).
- Section 25F quotes (facts 1-19): all found verbatim in `PR`, `TR`, `USC` or `IRS-I` at or within a few lines of the cited location.
- npm versions: registry `latest` re-fetched for `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js`, `plaid`, `react-plaid-link`, `next`, `react`; all match the table, including publish dates.
- Vendor pages: 11 Stripe and Plaid pages re-fetched and compared byte for byte with the author's saved copies (identical); 4 IRS pages and the Stripe nonprofit article re-fetched (same size, key sentences present). The saved sources are genuine.
- SDK claims: checked against the unpacked tarballs (`stripe@23.1.0` types and CHANGELOG, `plaid@51.0.0` README and client types, `react-plaid-link@5.0.0` README).
- Code: the author's type-check harness was re-run (exit 0) and its sources matched the code blocks; after edits the blocks were re-extracted and compiled again (exit 0).

Corrections made (wrong or overstated in the original)
1. Facts 1, 3, 4: tagged "proposed-reg: not final" only. The same text is in temporary reg §1.25F-1T(a)(12), which is in force. Tags and citations corrected.
2. Fact 5: temporary-reg citations added (§1.25F-5T(d)(3)(ii), §1.25F-1T(a)(18)); the Stripe mapping is now labeled as inference; the unsettled status of processor balances is stated.
3. Fact 10: the claim that the unique donor number is keyed by (SGO, donor, calendar year) was broader than the source. Reuse across years is NOT IN SOURCES.
4. Fact 11: the "per-spouse split" was presented as required; the IRS page does not say how a combined payment is split.
5. Fact 13: a T.D. 10057 preamble sentence was tagged "temporary-reg: in force". Retagged as preamble.
6. Fact 15: the statement that a netted processing or platform fee "does not shrink the SGO's income; it is an expense inside the SGO's 10 percent" is an inference, not source text. Downgraded.
7. Fact 16: the negative-search claim missed the preamble sentence "directly to one or more SGOs, rather than through one or more entities" (`PR` lines 596-599). Added, with its pass-through-entity context.
8. Fact 17: said Publication 526 was not in the source set. It is (`EXTRA/p526_txt/`); its section 170 timing text is now quoted and clearly separated from section 25F.
9. Fact 24: "stored at least 24 hours" and the permanent deterministic keys in the sketches overstated what idempotency keys guarantee. Stripe may prune keys after 24 hours and then treats a reuse as a new request.
10. Facts 25, 27, 28, 48: line numbers were those of `webhooks.md` but cited under `webhooks_node.md`. Corrected.
11. Fact 28: implied `payment_intent.*` and similar events exist only as snapshot events; thin events for v1 resources became generally available on 2026-09-30.
12. Fact 35 and the fact 50 table: "SGO's own pricing" is an inference; dispute-fee payer added (platform when `fees_collector` is `application`).
13. Fact 45: "the platform cannot re-debit the bank account" is an inference from text about "a different connected account"; "cards have no such constraint" is UNVERIFIED.
14. Fact 48: `4000002500003155` description made exact; Stripe's examples use port 4242; `stripe sandbox create` was not exercised.
15. Fact 52: the CRA definition paraphrase dropped statutory elements; §604(a)(3)(F)(i) added.
16. Fact 57: "W-2 box 1" is an inference from the field name; the top-level `error` object and `form1099s` were missing.
17. Fact 58: `VERIFICATION_STATUS_PROCESSING_COMPLETE` was treated as "data ready"; Plaid says it can also mean the documents were not parsable. Deprecated third status noted.
18. Fact 61: the Trial plan was omitted (it does not include Income).
19. Fact 65 and comparison table: Truv was listed among CRA rails; the fetched pages do not say Truv is a CRA. Marked unknown.
20. Fact 67: "verified end to end" replaced; nothing was run against a Plaid sandbox.
21. Fact 68: Form 4506-T described as a "mail/fax request"; the pages fetched do not say how it is submitted.
22. Facts 44, 69, 71, 75: small precision fixes (T+2 cutoff, business-account dispute window, transcript year ranges, three-character masking, IVES fee on rejected requests). Fact 19: the prior-calendar-year rule is statutory (`USC` line 161) and is now tagged so. Fact 50 table: the claim that Connect "you handle pricing" fees apply to shape i-A is marked UNVERIFIED.
23. Code: S4 now calls `elements.submit()`; S5 no longer exports `dynamic`; P2 no longer carries a made-up quotation ("primarily used for logging"), ignores the deprecated webhook status and checks the `error` field; a required-change note was added under S3 (create-on-every-call, missing date gate and list check).
24. Sandbox walk-through: step 3 lacked the `options.income_verification` object Plaid marks as required; step 6 suggested `ins_20`, which Plaid's docs use only in sample responses (replaced with `ins_109508`).
25. Open Question 15 said redisclosure terms were not in the public docs fetched; Argyle's customer terms were fetched and do address it. Open Question 18 now cites the rule for the December 1, 2026 comment date.

Facts added (omissions)
- 2A (Treasury's "directly ... rather than through one or more entities" reading), 5A (Stripe debits from the SGO's balance and bank account), 13A (legal status and reliance statement for the three rule sources), 15A (only scholarship spending counts; safe harbor and administrative money), 24A (durable uniqueness in our database), 37A (pending and failed refunds), 63A (Argyle redisclosure terms); an addition to fact 9 (do not collect donor SSNs); additions to fact 14 (reliance exception, strike-through and removal date); Engineering Implications 37-49; Open Questions 2a and 24.

Could not be verified (still open; do not treat as fact)
- Anything at runtime: no Stripe or Plaid call was made. Accounts v2 on the GA API version, capability approval for a `non_profit` account, ACH and card reuse across merchants of record, the headless Plaid sandbox flow, `stripe sandbox create`.
- Argyle Console self-serve sign-up (author's "[unverified, from memory]" stands); Truv self-serve sign-up and Truv's CRA status.
- Revenue Ruling 78-38 (not in the source set).
- The content of the IVES policy change announced January 2, 2024 (author's "[unverified, from memory]" stands).
- The unique donor number format; the per-spouse split of a combined gift; when an electronic contribution is "made" for section 25F; treatment of platform and processor fees, refunds, chargebacks and processor balances under section 25F. All NOT IN SOURCES.
- Stripe's discounted nonprofit rate, whether section 25F gifts count as "tax-deductible donations" for that program, and whether an SGO billed directly by Stripe pays its own rate.
- Plaid, Pinwheel and Truv production contract terms on redisclosure; unit pricing for every rail.
- How Form 4506-T is submitted and how long it takes; the screens inside the IRS Individual Online Account.

Nothing in the original was found to be fabricated. The closest cases were the unsupported `ins_20` suggestion and the pseudo-quotation "primarily used for logging"; both are corrected above.
