# Donor-side rules for the IRC section 25F credit

Research file for Piece 1 (donor checkout + tax-math panel). Prepared 2026-11-18.
Everything about section 25F below comes from the source files listed in the table below (the supplied files plus two IRS documents downloaded on 2026-11-18 and one third-party web page, all kept in `sources/extra/donor-credit-rules/`), never from memory. Where the sources are silent the file says **NOT IN SOURCES**.
This is an engineering reference, not legal or tax advice.

## How to read this file

Source keys (all absolute paths):

| Key | File | What it is |
|---|---|---|
| STAT | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/usc_25F.txt` | 26 U.S.C. 25F (Cornell LII text) |
| TEMP | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/temp_regs_TD10057.txt` | T.D. 10057, temporary regulations, 91 FR 62655 (Oct 2, 2026) |
| PROP | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/proposed_rule_REG-117199-25.txt` | REG-117199-25, proposed regulations, 91 FR 62818 (Oct 2, 2026) |
| IRSIND | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/irs_fstc_individuals.txt` | IRS page "FSTC for individuals" (last updated 18-Nov-2026), https://www.irs.gov/credits-deductions/individuals/federal-scholarship-tax-credit-fstc-for-individuals |
| IRSST | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/irs_fstc_states.txt` | IRS page "FSTC - Participating states" (last updated 16-Nov-2026) |
| IRSMAIN | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/donor-credit-rules/irs_fstc_main.txt` | IRS FSTC landing page, fetched 2026-11-18 from https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc (text extract of `irs_fstc_main.html` in the same folder) |
| P526 | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/donor-credit-rules/p526_raw.txt` | IRS Publication 526 (2025), fetched 2026-11-18 from https://www.irs.gov/pub/irs-pdf/p526.pdf (`pdftotext` output of `p526.pdf` in the same folder). Section 170 guidance, NOT section 25F guidance |
| SGOLIST | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/donor-credit-rules/sgolist_texas.txt` | Third-party directory page https://sgolist.com/states/texas (downloaded by another research agent on 2026-11-18; copied here). Not an official source |
| IRSPORTAL | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/irs_hub/fstc_state_portal.txt` | IRS page "FSTC State Portal" (last updated 13-Nov-2026), https://www.irs.gov/government-entities/federal-state-local-governments/fstc-state-portal (saved by another research agent; added by the fact-checker) |
| TXCONST | `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/tx_constitution_full.txt` | Texas Constitution, "Includes Amendments Through the November 4, 2025, Constitutional Amendment Election" (text extract of the Texas Legislative Council PDF, https://tlc.texas.gov/docs/legref/TxConst.pdf, saved by another research agent; added by the fact-checker). Not a section 25F source |

Fact-check status (2026-11-18): this file was adversarially re-verified against the sources. Facts with a letter suffix (F8a, F17a, F30a, F37a, F50a, F54a, F56a) and every note marked "Fact-check" were added or changed by the fact-checker. What was checked and changed is listed in the VERIFICATION LOG at the end.

Citation format: `SRC: KEY Lstart-end | [tag]`. Line numbers are line numbers in the plain-text file. Quotes are verbatim; line wraps are collapsed (a word the Federal Register split at a hyphen across two lines is rejoined, e.g. `dollar-for-` + `dollar`), `[...]` marks an elision, and Federal Register page markers such as `[[Page 62856]]` that fall inside a quoted passage are dropped. Every block quote in this file was machine-checked against its cited file and line range (`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/research/_scripts/check_quotes.py`), and re-checked after the fact-check edits with an independently written checker (`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/research/_scripts/donor_factcheck_quotes.py`): 147 block quotes, 0 mismatches. The Federal Register text writes quotation marks as two backticks and two apostrophes; that is preserved.

Confidence tags: `[statute]`, `[temporary-reg: in force]`, `[proposed-reg: not final]`, `[preamble/economic-analysis]`, `[IRS web page]`, `[secondary/web]`.

How to read the tags (Fact-check):
- `[temporary-reg: in force]` means regulation text of T.D. 10057 (Temp. Reg. 1.25F-1T, 1.25F-4T, 1.25F-5T). On the date of this file (2026-11-18) these regulations are published but not yet effective: they take effect December 1, 2026 and expire October 1, 2029 (F63). They will be in force before the first eligible gift on January 1, 2027.
- `[proposed-reg: not final]` means regulation text of REG-117199-25, including the worked examples printed inside the proposed regulation. It is not law. It can be relied on only under the condition in F64.
- `[preamble/economic-analysis]` means Treasury's explanation published with either document (including the DATES captions and the Special Analyses). It shows how Treasury reads the rules but is not regulation text.
- `[IRS web page]` means an irs.gov page or IRS publication. It is not binding authority and can change without notice; the three FSTC pages were re-fetched on 2026-11-18 and their visible text matched the saved copies.
- A plain-English line that goes beyond its quote is marked "Inference" or "derived". Treat those as engineering judgment, not as rules.

## Status map: what is law, what is temporary, what is only proposed

This matters for copy and for how hard-coded each rule should be.

| Donor-side rule | Where it lives | Status |
|---|---|---|
| Individual citizen/resident; credit = qualified contributions; $1,700 cap; State-credit reduction; no section 170 double benefit; 5-year FIFO carryforward; effective for taxable years ending after Dec 31, 2026 | Statute, section 25F(a), (b), (e), (f) | Law |
| Definition of qualified contribution (made by an individual; designation at time of contribution; irrevocable; goods/services subtracted); definition of cash; acknowledgment contents and Jan 31 deadline; unique donor number; Feb 28 IRS report; IRS SGO list and removal | Temp. Reg. 1.25F-1T, 1.25F-4T, 1.25F-5T | Temporary regulations. Published Oct 2, 2026; effective Dec 1, 2026 (so in force before the first eligible gift on Jan 1, 2027, but 13 days after the date of this file); reg text says they apply on or after Sept 1, 2026 and expire Oct 1, 2029 (TEMP L46-49, L1562-1564) |
| ALL of the credit computation rules in Prop. Reg. 1.25F-2: spouses on a joint return as separate taxpayers ($3,400), State-credit ordering (reduction before cap; non-qualified amounts absorb State credits first), pass-through exclusion, donor reliance on the IRS SGO list, section 26 liability limit detail, carryforward-before-current-year ordering, section 170 treatment of carried-forward amounts, Form 8525 and the missing-donor-number presumption; also the definitions of "resident of the United States", "State credit", "unused credit" | Proposed regulations only (the temporary regulations reserve 1.25F-1T(a)(15), (22), (26) and contain no 1.25F-2T) | Proposed, not final. Comments due Dec 1, 2026; hearing Dec 15, 2026. Taxpayers may rely on them for contributions made on or after Jan 1, 2027 if followed in their entirety and consistently (see F64) |
| (Fact-check addition) One combined payment "on behalf of both spouses" with both names; a separate acknowledgment and donor number for each spouse; the SGO must appear on a State's list "at the time of the contribution"; no credit "until that state elects to participate and submits its approved SGOs"; IRS SGO list to be posted December 31, 2026 through Tax Exempt Organization Search; Form 8525 available for the 2028 filing season; the list of 31 States | IRS web pages only (IRSIND, IRSST, IRSMAIN, IRSPORTAL) | Informal IRS guidance. Not statute or regulation; can change without notice (F17, F17a, F18, F54a, F58, F65, F8) |
| (Fact-check addition) Texas | IRS web page: on the list of States with an advance election for 2027 | Not yet a completed election. Texas must submit its State SGO list by February 15, 2027 or no Texas organization is an SGO for 2027 (F8a, F58) |

---

# FACTS

## A. Who can claim the credit

### F1. Only an individual who is a U.S. citizen or U.S. resident can claim the credit
(a) The credit is for a natural person (an "individual") who is a citizen or resident of the United States. Checkout is individuals-only.

> In the case of an individual who is a citizen or resident of the United States (within the meaning of section 7701(a)(9)), there shall be allowed as a credit against the tax imposed by this chapter for the taxable year an amount equal to the aggregate amount of qualified contributions made by the taxpayer during the taxable year.

SRC: STAT L143 | [statute]

### F2. "Resident of the United States" means a federal tax resident; "United States" is only the 50 States and D.C.
(a) Resident = an individual who is a resident of the United States under section 7701(b), or a person treated as resident by a section 6013(g) or (h) election. Residence in a territory does not count as residence in the "United States" for this definition. Inference: a U.S. citizen qualifies wherever the citizen lives, because the statute says "citizen or resident" (F1); the sources give no example of a citizen living abroad or in a territory. (Fact-check: the sources do not explain what sections 7701(b) and 6013(g)/(h) contain. The checkout should ask the donor to attest "U.S. citizen or U.S. resident for federal income tax purposes" and not try to decide residency itself.)

> The term resident of the United States means an individual who is a resident of the United States under section 7701(b) or in accordance with an election under section 6013(g) or (h). For this purpose, the term United States means only the 50 States and the District of Columbia. See section 7701(a)(9).

SRC: PROP L4961-4965 | [proposed-reg: not final] (this definition is reserved in the temporary regulations: TEMP L1531 "(13)-(15) [Reserved]")

### F3. Part-year citizens/residents: only contributions made while a citizen or resident count
(a) If the donor is a citizen/resident for only part of the tax year, only qualified contributions made during that part of the year count.

> an individual taxpayer who is a U.S. citizen or a resident of the United States for all or any portion of a taxable year is allowed a nonrefundable credit determined in accordance with paragraph (c) of this section for qualified contributions made by the taxpayer in the portion of that taxable year during which the taxpayer is a U.S. citizen or a resident of the United States (section 25F credit).

SRC: PROP L5020-5026 | [proposed-reg: not final]

### F4. The contribution itself must be "made by an individual"
(a) The in-force definition of qualified contribution requires the cash contribution to be made by an individual. A gift from an entity is not a qualified contribution.

> The term qualified contribution means a charitable contribution of cash made by an individual to an SGO to the extent that the donor designates to the recipient SGO, at the time of making the contribution, that the contribution is intended to be a qualified contribution for purposes of section 25F.

SRC: TEMP L1514-1519 | [temporary-reg: in force] (identical text proposed at PROP L4932-4937)

### F5. Partnership and S corporation contributions do not pass through as qualified contributions
(a) A partner or S corporation shareholder cannot count a share of the entity's gift to an SGO toward the section 25F credit, even if that share is deductible under section 170. The individual must give directly.

> A partner may not take into account such partner's distributive share of the partnership's charitable contributions to an SGO in determining the amount of the partner's qualified contributions under section 25F and paragraph (a) of this section. Similarly, a shareholder of an S corporation may not take into account such shareholder's pro rata share of the S corporation's charitable contributions to an SGO in determining the amount of the shareholder's qualified contributions under section 25F and paragraph (a) of this section. This paragraph (a)(3) applies whether or not a partner or an S corporation shareholder may treat the partner's or shareholder's share of such contributions as deductible under section 170.

SRC: PROP L5055-5065 | [proposed-reg: not final]

> The Treasury Department and the IRS interpret the language of section 25F(a) to limit the section 25F credit to individuals making qualified contributions directly to one or more SGOs, rather than through one or more entities.

SRC: PROP L596-599 | [preamble/economic-analysis]

> because pass-through entities have the alternative of distributing cash to their partners or shareholders, who in turn could contribute directly to SGOs, these effects may be small.

SRC: PROP L3681-3684 | [preamble/economic-analysis]

### F6. Estates, trusts, C corporations, donor-advised funds, private foundations, employer matching gifts
(a) **NOT IN SOURCES** by name. A search of STAT, TEMP and PROP finds no rule that addresses estates, trusts as donors, C corporations, donor-advised funds, private foundations as donors, or employer matching gifts. What the sources do say is F1 (statute: "individual"), F4 (reg: "made by an individual") and F5 ("directly ... rather than through one or more entities"). Treat every non-individual payer as not eligible unless counsel says otherwise.

SRC: STAT L143; TEMP L1514-1519; PROP L596-599 | [statute] / [temporary-reg: in force] / [preamble/economic-analysis]

### F7. The donor's State of residence does not matter
(a) A donor anywhere may give to an SGO on any covered State's list. A donor living in a non-participating State can earn the credit by giving to (for example) a Texas-listed SGO.

> A taxpayer may make a qualified contribution to any SGO on any State SGO list, regardless of the taxpayer's State of residence.

SRC: PROP L5032-5034 | [proposed-reg: not final]

> For example, a taxpayer residing in State X may contribute to an SGO in State Y so long as the SGO is on State Y's SGO list.

SRC: PROP L536-538 | [preamble/economic-analysis]

> Taxpayers may receive the FSTC for contributions to these approved SGOs, regardless of the taxpayer’s own state of residence.

SRC: IRSST L423 | [IRS web page]

### F8. The SGO must be on the list of a State that elected in ("covered State"); Texas is on the IRS list of States that made an ADVANCE election for 2027
(a) No credit unless the recipient is an SGO on a covered State's list for that calendar year. As of Nov 13, 2026 the IRS lists 31 participating States for 2027, including Texas. Fact-check correction: the IRS page heading is "Advance elections to participate under Section 25F for 2027" (IRSST L421), so what Texas has made is an advance election, which is not complete until Texas submits its State SGO list (see F8a and F58). The 31 States are (IRSST L428-457; "Nebraska" and "Nevada" run together on one line of the text extract: Alabama, Alaska, Arkansas, Colorado, Florida, Georgia, Idaho, Indiana, Iowa, Kansas, Kentucky, Louisiana, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, South Carolina, South Dakota, Tennessee, Texas, Utah, Virginia, West Virginia, Wyoming).

> The term “covered State” means one of the States, or the District of Columbia, that, for a calendar year, voluntarily elects to participate under this section and to identify scholarship granting organizations in the State, in accordance with subsection (g).

SRC: STAT L157 | [statute]

> Participating states for 2027 (as of Nov. 13, 2026)

SRC: IRSST L425 | [IRS web page]

> Taxpayers can’t claim the credit for qualifying donations in a state until that state elects to participate and submits its approved SGOs to the IRS.

SRC: IRSMAIN L18 | [IRS web page]

### F8a. (Fact-check addition) A 2027 advance election can lapse: the State must still deliver its SGO list by February 15, 2027, and the election is for one calendar year only
(a) For 2027 every State's election is an advance election on Form 15714, due on or before January 1, 2027. It is "perfected" only when the State provides its State SGO list (deadline February 15, 2027 for 2027, F58). A State that does not perfect has in effect opted out, and no organization in that State is an SGO for that year (F58). Once perfected, the election cannot be revoked for that year. Each election covers a single calendar year, so 2028 needs a new election and a new list. Consequence for a Texas-first product: being on the IRS advance-election list today does not yet make any Texas organization an SGO.

> For calendar year 2027 only, a State must submit an advance election on Form 15714, Advance Election to Participate Under Section 25F for 2027, on or before January 1, 2027.

SRC: TEMP L1751-1754 | [temporary-reg: in force]

> The State election is made only for a single calendar year, and all the requirements in this paragraph (c) must be satisfied for each year for which an election is made.

SRC: TEMP L1733-1735 | [temporary-reg: in force]

> The advance election procedure in Sec.  1.25F-5T(c)(3), discussed in part III.C.2. of this Explanation of Provisions, enables a State to opt in for an upcoming calendar year by making an advance election and then later, in effect, opt out by failing to perfect the election in accordance with Sec.  1.25F-5T(c)(3)(ii). The Treasury Department and the IRS do not interpret section 25F(g) as allowing for any revocation once a State has completed its State election for the year, including an advance election that has been perfected.

SRC: TEMP L406-414 | [preamble/economic-analysis]

> Advance elections to participate under Section 25F for 2027

SRC: IRSST L421 | [IRS web page]

> For 2027: States must submit their list of qualifying SGOs by February 15, 2027. This includes participating states that made advance elections

SRC: IRSPORTAL L43 | [IRS web page]

### F9. The rules do not require the SGO to collect the donor's SSN/TIN; the unique donor number is used instead
(a) Do not ask for SSN/ITIN at checkout. Matching is done by unique donor number plus name and address (F70). Fact-check caveat: the SGO's annual report also includes "any other information the IRS deems necessary ... as may be described in future guidance" (F70, item D), so future guidance could add data elements; nothing in the current sources adds a TIN.

> The Treasury Department and the IRS share the stakeholders' concern that requiring taxpayers to provide TINs to SGOs when making a qualified contribution would be burdensome, could chill an individual's desire to make contributions to an SGO, and might result in unnecessary exposure of sensitive taxpayer information.

SRC: PROP L774-778 | [preamble/economic-analysis]

> The use of the donor number avoids the need to have SGOs collect and report each donor's taxpayer identification number, such as a social security number.

SRC: PROP L3712-3714 | [preamble/economic-analysis]

## B. Credit amount and the $1,700 cap

### F10. Base amount: the aggregate of the taxpayer's qualified contributions made during the taxable year
(a) Dollar-for-dollar. Sum across all SGOs and all gifts in the donor's tax year (see Example 3 in section M, which adds $1,500 to Org X and $500 to Org Y).

> Section 25F creates a dollar-for-dollar nonrefundable Federal tax credit of up to $1,700 for contributions made by individuals to scholarship granting organizations (SGOs).

SRC: PROP L2457-2460 | [preamble/economic-analysis]

(Statutory text: see F1, STAT L143.)

### F11. Cap: $1,700 per taxpayer per taxable year
(a) Hard cap of $1,700 on the credit generated for a taxable year, per taxpayer. The statute text in STAT contains no inflation adjustment for this number.

> The credit allowed under subsection (a) to any taxpayer for any taxable year shall not exceed $1,700.

SRC: STAT L148 | [statute]

### F12. Formula: lesser of (qualified contributions minus State credits, floored at zero) and $1,700
(a) `credit = min( max(QC_total - stateCredits_on_QC, 0), 1700 )`, computed per taxpayer per taxable year.

> A taxpayer's section 25F credit is the lesser of: (i) The aggregate amount of qualified contributions made during the taxable year while the taxpayer was a United States citizen or a resident of the United States reduced (but not to below zero) by the sum of any State credits with regard to those qualified contributions; or (ii) $1,700.

SRC: PROP L5087-5094 | [proposed-reg: not final]

### F13. Ordering: subtract the State credit FIRST, then apply the $1,700 cap
(a) The cap is applied after the State-credit reduction, not before. A $2,500 qualified contribution with a $500 State credit is NOT limited to $1,200; under the proposed rule it is min(2,500 - 500, 1,700) = $1,700 (the $1,700 result is arithmetic from F12; the preamble states only the rejected $1,200 number).

> Because the Treasury Department and the IRS interpret section 25F(b) as limiting the credit to $1,700 only after applying the State credit reduction, proposed Sec.  1.25F-2(a) and (c)(1) would clarify that the amount of the taxpayer's qualified contributions is reduced by the amount of State credits for such qualified contributions before applying the $1,700 limitation.

SRC: PROP L674-680 | [preamble/economic-analysis]

> Such an interpretation would, for example, limit a taxpayer's section 25F credit for a $2,500 qualified contribution for which the taxpayer claims a $500 State credit to $1,200 (that is, $1,700 in creditable qualified contributions after application of the section 25F(b)(1) limitation less the $500 State credit after the subsequent application of the State credit reduction in section 25F(b)(2)).

SRC: PROP L660-666 | [preamble/economic-analysis] (this is the interpretation Treasury REJECTED)

### F14. The three computation steps, as Treasury describes them
(a) Step 1: total qualified contributions for the year. Step 2: subtract State credits allowed with regard to those qualified contributions (only credits based on qualified contributions count). Step 3: lesser of $1,700 or the step 2 result.

> first, the taxpayer determines the aggregate amount of the taxpayer's qualified contributions for the taxable year; second, subtract from that amount the sum of any State credits that were allowed with regard to those qualified contributions; and third, determine the lesser of $1,700 or the amount computed in the second step. In computing the State credits in the second step described in the preceding sentence, only the credits allowed based on qualified contributions would be taken into account; any credit allowed for a contribution that is not a qualified contribution would not be taken into account.

SRC: PROP L691-700 | [preamble/economic-analysis]

## C. Joint returns and spouses

### F15. Spouses filing jointly are separate taxpayers for the $1,700 cap
(a) Each spouse has an own $1,700 cap, so a joint return can show up to $3,400. This is in the proposed regulations and the IRS web pages; the statute itself only says "any taxpayer".

> For purposes of section 25F(b)(1), married taxpayers who elect to file a joint return under section 6013(a) and Sec.  1.6013-1(a) are treated as separate taxpayers.

SRC: PROP L5050-5053 | [proposed-reg: not final]

> Married couples filing jointly may each be able to claim a $1,700 credit, for a total credit of $3,400 on the joint return.

SRC: IRSIND L404 | [IRS web page]

### F16. Each spouse must make their own qualified contributions
(a) $3,400 requires that EACH spouse has made qualified contributions. In the regulation's example each spouse contributes, each designates, and each gets an acknowledgment. Inference (no example in the sources): if only one spouse is the donor of $3,400, that spouse's cap is still $1,700 and the other spouse has no qualified contribution.

> The Treasury Department and the IRS interpret section 25F to limit the credit amount that may be claimed to $1,700 per individual taxpayer, allowing married couples filing jointly to potentially claim up to $3,400 on their joint tax return provided that each spouse has made qualified contributions of up to $1,700.

SRC: PROP L575-579 | [preamble/economic-analysis]

### F17. One combined payment on behalf of both spouses is contemplated (IRS web page only): give both names and say it is for both
(a) The IRS web page contemplates "simultaneous qualified contributions" by spouses (its example is "a combined $3,400 qualified contribution on behalf of both spouses") and says they "should" give both names to the SGO and say the donation is on behalf of both. How the SGO splits a combined amount between the spouses is NOT IN SOURCES (a combined $3,400 is consistent with $1,700 each, but the page states no split).

> If spouses who will be filing a married filing jointly tax return make simultaneous qualified contributions (e.g., a combined $3,400 qualified contribution on behalf of both spouses), they should provide both names to the SGO and indicate to the SGO the donation is on behalf of both spouses.

SRC: IRSIND L416 | [IRS web page]

### F17a. (Fact-check caution) The combined-payment route exists only on an IRS web page
(a) Neither the statute nor the temporary or proposed regulation text mentions a combined payment on behalf of both spouses. The only joint-filer example in the proposed regulation (Example 2, F74) has each spouse contribute $2,000, each designate, and each receive an acknowledgment. The safest record is therefore one that looks like Example 2: two donors, two amounts, two designations, even if the money moves in one payment. Whether one spouse's separate funds can be the other spouse's contribution is NOT IN SOURCES (Open Questions 2).

SRC: IRSIND L416; PROP L5174-5189 (quoted in F74) | [IRS web page] / [proposed-reg: not final]

### F18. Each spouse gets a separate acknowledgment and a separate unique donor number (stated on the IRS web page; consistent with the regulation's "each donor")
(a) Two donors, two acknowledgments, two donor numbers, even for one payment. The sentence about spouses is on the IRS web page only; the regulation text requires an acknowledgment "to each donor" and a unique donor number "for each donor" (F67, F69), and Example 2 has each spouse receive an acknowledgment (F74).

> Each spouse should receive a separate timely written acknowledgement with their own unique donor number.

SRC: IRSIND L418 | [IRS web page]

### F19. On a joint return the tax-liability limit is the couple's combined limit
(a) The two spouses' credits are added and tested against one combined section 26(a) limitation.

> Each of B and C's contributions result in a $1,700 allowed section 25F credit, resulting in a total of $3,400 that may be claimed on B and C's joint return. The credit will be subject to their combined tax liability limitation under section 26(a).

SRC: PROP L5181-5184 | [proposed-reg: not final]

### F20. A State credit counts against a spouse whether or not the State return is joint
(a) The State-credit definition covers a credit allowed on a State return "whether or not such return is filed jointly with a spouse". How a State credit on a joint State return is split between the two spouses' separate federal computations is NOT IN SOURCES.

SRC: PROP L4983-4989 (quoted in F22) | [proposed-reg: not final]

### F21. Married filing separately, head of household, etc.
(a) **NOT IN SOURCES** as special cases. The cap is "per taxpayer" (F11) and only joint filers are specifically addressed (F15). Nothing in the sources reduces the cap for other filing statuses.

## D. Reduction for State tax credits

### F22. Statutory rule and the proposed definition of "State credit"
(a) The federal credit is reduced by the amount allowed as a credit on any State tax return of the taxpayer for the same qualified contributions. "State credit" = any tax credit offered by a State (any State, not only the SGO's State) for making a contribution to an SGO that is allowed on the taxpayer's State return. State credit carryforwards or carrybacks attributable to the contribution are treated as allowed in the year of the contribution, so the full State credit reduces the federal credit in the contribution year even if the State spreads it over several years.

> The amount allowed as a credit under subsection (a) for a taxable year shall be reduced by the amount allowed as a credit on any State tax return of the taxpayer for qualified contributions made by the taxpayer during the taxable year.

SRC: STAT L152 | [statute]

> The term State credit means any tax credit offered by a State for making a contribution to an SGO that is allowed on a State tax return of the taxpayer (whether or not such return is filed jointly with a spouse) for the taxable year. For this purpose, any State tax credit carryforward or carryback amount attributable to a contribution to an SGO will be treated as allowed for the taxable year of the contribution.

SRC: PROP L4983-4992 | [proposed-reg: not final] (reserved in the temporary regulations: TEMP L1547 "(22) [Reserved]")

### F23. Ordering rule: a State credit is absorbed first by the NON-qualified part of the donor's contributions
(a) If the donor's cash contributions to an SGO include both a designated (qualified) amount and a non-designated amount, and a State credit is allowed for those contributions, the State credit is treated as coming first from the non-designated amount; only any remainder reduces the qualified contributions. The comparison is State-credit dollars against non-qualified contribution dollars, one for one: in Example 4 a $400 State credit (10 percent of a $4,000 gift) is fully absorbed by the $2,300 non-qualified portion, and the $1,700 qualified portion is not reduced at all.

> For purposes of this section, if a State credit is allowed with respect to an individual's contributions of cash to an SGO that includes both a qualified contribution and an amount that is not a qualified contribution, then the State credit will be treated as first being allowed with respect to the amount of the donor's contribution that is not a qualified contribution and only thereafter treated as being allowed with respect to the donor's qualified contributions to an SGO.

SRC: PROP L5095-5102 | [proposed-reg: not final]

> This ordering rule preserves the maximum amount of qualified contributions available for a section 25F credit.

SRC: PROP L707-708 | [preamble/economic-analysis]

### F24. A State income tax DEDUCTION does not reduce the federal credit
(a) Only State credits reduce the section 25F credit. State deductions do not.

> the allowance of a deduction (as opposed to a credit) for State income tax purposes generally would not affect the amount of the section 25F credit.

SRC: PROP L712-714 | [preamble/economic-analysis]

### F25. Purpose of the reduction: combined federal + State benefit should not exceed the gift
(a) Useful for copy: the reduction exists so the donor does not get back more than was given.

> The Treasury Department and the IRS view the State credit reduction as intended to prevent a taxpayer from receiving combined Federal and State tax benefits exceeding the value of the taxpayer's qualified contributions.

SRC: PROP L667-670 | [preamble/economic-analysis]

### F26. Wording varies between State credits "allowed" and "claimed"
(a) The operative rule (F12, F22) uses "allowed on a State tax return". The summary paragraph and Example 3 say "claimed". The sources do not say what happens if a donor is entitled to a State credit but does not claim it (see Open Questions 5).

> reduced by the amount of any State credits claimed for such qualified contributions, and subject to a cap of $1,700.

SRC: PROP L5036-5038 | [proposed-reg: not final]

> taxpayers must first determine the aggregate amount of qualified contributions for the tax year and then determine which State credits were claimed on the taxpayer's State tax return or otherwise allowed with respect to those qualified contributions.

SRC: PROP L2639-2643 | [preamble/economic-analysis]

### F27. An organization can generate State credits and still not be a section 25F SGO
(a) Being a State tax-credit scholarship organization is not enough. If it is not on a covered State's SGO list, no federal credit.

> a contribution to an organization that qualifies for State tax credits but is not included on the State SGO list of one or more covered States in which the SGO is located, does not give rise to the section 25F credit.

SRC: TEMP L205-208 | [preamble/economic-analysis]

### F28. Each electing State must describe its own SGO tax credit to the IRS
(a) A future data source for "does this State have a credit": every State election must describe any State tax credit available for contributions to SGOs. Whether and where the IRS will publish these descriptions is NOT IN SOURCES. Whether Texas offers any such credit is NOT IN the statute, regulations or IRS pages. The only statement found is on an unofficial third-party directory site, quoted below; treat it as unverified.

> Describe any tax credit (including relevant State statutes, regulations, and other authoritative guidance) available under State law for contributions made to SGOs during the calendar year for which the State is electing to participate under section 25F; and

SRC: TEMP L1818-1821 | [temporary-reg: in force]

> Texas has no state income tax, so the federal credit is the primary tax benefit for Texas donors.

SRC: SGOLIST L41 | [secondary/web]

Fact-check addition: the "no state income tax" half of that sentence is confirmed by a primary Texas source saved by another research agent (the Texas Constitution prohibits a tax on individuals' net incomes). That means a Texas individual has no Texas individual income tax return on which a credit could be allowed. It does NOT establish that Texas has no State tax credit of any kind for contributions to SGOs; the federal definition of "State credit" is not limited to income taxes (F22), and a donor who files a return in another State can still have a State credit there (F7, F22).

> INDIVIDUAL INCOME TAX PROHIBITED. The legislature may not impose a tax on the net incomes of individuals, including an individual’s share of partnership and unincorporated association income.

SRC: TXCONST L7851-7853 | [secondary/web] (Texas Constitution, Article VIII, section 24-a, official Texas Legislative Council text; a primary Texas source but not a section 25F source, so it carries no 25F authority tag)

## E. Nonrefundability and the tax-liability limit

### F29. The credit is nonrefundable and is allowed against the tax imposed by sections 1 and 55(a)
(a) The credit can reduce federal income tax to zero but cannot create a refund. It is allowed against the tax imposed by sections 1 and 55(a). (Fact-check: the sources give only the section numbers. The labels "regular income tax" for section 1 and "alternative minimum tax" for section 55(a) are general Code knowledge, not in any source file; cite the section numbers in anything formal.)

> A section 25F credit is allowed against the tax imposed for the taxable year by sections 1 and 55(a).

SRC: PROP L5026-5027 | [proposed-reg: not final]

> As a nonrefundable credit, the section 25F credit claimed in a particular year cannot exceed the tax liability of the individual taxpayer for that year.

SRC: PROP L523-526 | [preamble/economic-analysis]

### F30. Section 26 ordering: the limit is section 26(a) liability AFTER the credits in sections 21, 22, 24, 25, 25A, 25B, 25C and 25E
(a) `usableLimit = section26(a)_limitation - (credits allowable under sections 21, 22, 24, 25, 25A, 25B, 25C, 25E)`. The statute's wording is "credits allowable under this subpart (other than this section, section 23, and section 25D)"; the proposed regulation spells that out as the eight sections listed. So the section 25F credit comes after those eight credits. Its order relative to the section 23 and section 25D credits (the other two carryforward credits) is NOT stated in the sources. The preamble itself labels section 23 the adoption credit and 25D the residential clean energy credit at PROP L744-745. UNVERIFIED (Fact-check): the following plain-English names for the eight sections are from general Code knowledge, are not in any source file, and were not checked against the current Code, so do not print them in donor-facing copy without a tax reviewer: 21 child and dependent care, 22 elderly/disabled, 24 child tax credit, 25 mortgage interest credit, 25A education credits, 25B saver's credit, 25C home energy improvement, 25E used clean vehicle. Refer to them by section number, as the regulation does.

> The section 25F credit allowed for a taxable year may not exceed the taxpayer's tax liability as defined in section 26(a), based on the tax imposed for such taxable year as reduced by the sum of the nonrefundable personal credits allowable under sections 21, 22, 24, 25, 25A, 25B, 25C and 25E.

SRC: PROP L5103-5107 | [proposed-reg: not final]

(Statute: see F31 quote, STAT L235.)

### F30a. (Fact-check addition) Treasury describes the eight credits as the ones "that may not be carried forward"; the sources do not reproduce section 26(a) itself
(a) The preamble explains why those eight sections are listed: they are the nonrefundable personal credits that cannot be carried forward, so they are taken first. What "the limitation imposed by section 26(a)" is, in numbers, is NOT IN SOURCES: the sources only name the section and say the credit is allowed against the tax imposed by sections 1 and 55(a) (F29). A tax-math panel therefore cannot compute a donor's real limit from these sources; at most it can take the donor's own estimate of federal income tax after other credits as an input.

> Proposed Sec.  1.25F-2(d) would clarify that the credit allowed under section 25F for a taxable year may not exceed the taxpayer's tax liability as defined in section 26(a), based on the tax imposed for such taxable year as reduced by the sum of the nonrefundable personal credits that may not be carried forward (specifically, the credits allowed under sections 21, 22, 24, 25, 25A, 25B, 25C, and 25E).

SRC: PROP L735-740 | [preamble/economic-analysis]

## F. Carryforward of unused credit

### F31. Credit that exceeds the liability limit carries to the next year and is added to that year's credit
(a) Unused credit (the part blocked by the liability limit) is not lost; it carries forward.

> If the credit allowable under subsection (a) for any taxable year exceeds the limitation imposed by section 26(a) for such taxable year reduced by the sum of the credits allowable under this subpart (other than this section, section 23, and section 25D), such excess shall be carried to the succeeding taxable year and added to the credit allowable under subsection (a) for such taxable year.

SRC: STAT L235 | [statute]

> The term unused credit means the amount of the credit determined under Sec.  1.25F-2(c) for a taxable year that is not used by reason of the tax liability limitation in section 26(a).

SRC: PROP L5008-5010 | [proposed-reg: not final]

### F32. Five-year life, first-in first-out
(a) A credit that arose in year Y can be used in Y+1 through Y+5 and expires for Y+6. Oldest credits are used first.

> No credit may be carried forward under this subsection to any taxable year following the fifth taxable year after the taxable year in which the credit arose. For purposes of the preceding sentence, credits shall be treated as used on a first-in first-out basis.

SRC: STAT L239 | [statute]

### F33. Carryforwards are used BEFORE the current year's new credit
(a) In any year, apply available carryforwards (oldest first) against the liability limit, and only then the credit generated by that year's contributions.

> Section 25F credits carried forward to a taxable year pursuant to this paragraph (e) are used on a first-in first-out basis. Thus, a section 25F credit carried forward must be used prior to using any section 25F credit that arose for such taxable year.

SRC: PROP L5121-5125 | [proposed-reg: not final]

### F34. The $1,700 cap limits the credit GENERATED per year, not the credit USED per year
(a) More than $1,700 of section 25F credit can be used in one year if it consists of carryforwards (Example 5 uses $4,500 in 2033). But the amount that enters the carryforward pool from any one year is at most $1,700: in Example 5, 2032 has $2,000 of qualified contributions and a carryforward of $1,700, not $2,000.

> Although a taxpayer cannot claim a section 25F credit of more than $1,700 for any taxable year, the cumulative amount of section 25F(f) credit carryforwards can be used against a tax liability of more than $1,700 for a single taxable year.

SRC: PROP L748-751 | [preamble/economic-analysis]

> After taking the lesser of these two amounts, the amount allowable as a credit is then augmented by the value of any unused credit carried forward to the tax year from an earlier year.

SRC: PROP L2656-2658 | [preamble/economic-analysis]

## G. Coordination with the section 170 charitable deduction

### F35. No double benefit: the credited part of a qualified contribution is not a section 170 contribution
(a) Whatever amount gets a section 25F credit cannot also be deducted.

> Any qualified contribution for which a credit is allowed under this section shall not be taken into account as a charitable contribution for purposes of section 170.

SRC: STAT L230 | [statute]

### F36. Amounts blocked by the liability limit but carried forward are treated as "allowed", so they are NOT deductible
(a) A donor with too little tax liability cannot switch the unused credit into a deduction; if it may be carried forward it counts as allowed for the double-benefit rule.

> Any qualified contribution for which a credit is allowed under section 25F may not be taken into account as a charitable contribution for purposes of section 170. For this purpose, an amount is treated as allowed if it may be carried forward pursuant to paragraph (e) of this section.

SRC: PROP L5126-5130 | [proposed-reg: not final]

### F37. The part of a qualified contribution for which no credit is allowed (for example the excess over $1,700) "may be deductible" under section 170
(a) Excess over the cap is not creditable and not carried forward; it may be deductible as an ordinary charitable contribution if the normal section 170 rules are met (Example 1: $300 of a $2,000 gift; Example 2: $600 of $4,000). The sources say "may be", not "is".

> Any portion of a qualified contribution for which a credit under section 25F is not allowed may be deductible as a charitable contribution if it meets the requirements of section 170 and the regulations thereunder.

SRC: PROP L5130-5133 | [proposed-reg: not final]

### F37a. (Fact-check addition) Treasury's own wording of the deductible remainder: the portion "not taken into account in determining the section 25F credit"
(a) The preamble restates F37 with different words. Both versions are conditional ("may be deductible ... if ... meets the requirements of section 170"). Neither says what those section 170 requirements are; the 25F sources do not describe them.

> the portion of a qualified contribution not taken into account in determining the section 25F credit may be deductible as a charitable contribution if such contribution meets the requirements of section 170 and the regulations thereunder.

SRC: PROP L721-725 | [preamble/economic-analysis]

### F38. Whether the portion wiped out by a State credit is deductible
(a) No example or sentence addresses this case by name. Fact-check correction: the general rule in F37 is worded broadly enough to cover it ("Any portion of a qualified contribution for which a credit under section 25F is not allowed may be deductible ... if it meets the requirements of section 170 and the regulations thereunder", PROP L5130-5133), so the proposed rule does not rule a deduction out, but it also does not say one is allowed. Whether a contribution that earned a State tax credit "meets the requirements of section 170" is decided by section 170 and its regulations, which are **NOT IN SOURCES**. Example 3 (where $400 is removed by a State credit) says nothing about deducting that $400. Do not tell a donor this amount is deductible.

SRC: PROP L5130-5133 (quoted in F37); PROP L5202-5208 (Example 3, F75) | [proposed-reg: not final]

### F39. SGOs are still ordinary section 501(c)(3) charities for receipts on non-credited amounts
(a) The usual section 170 written-acknowledgment rule for gifts of $250 or more still applies to SGOs, which matters if the donor will deduct any non-credited portion.

> As SGOs are section 501(c)(3) charitable organizations, these organizations are already required to provide a contemporaneous written acknowledgment for contributions of $250 or more and may be required to report information concerning certain substantial contributors to the IRS.

SRC: PROP L3715-3719 | [preamble/economic-analysis]

## H. What a "qualified contribution" is

### F40. Statutory definition
(a) A charitable contribution of cash to an SGO that uses it to fund scholarships for eligible students solely within the State where the SGO is listed.

> The term “qualified contribution” means a charitable contribution of cash to a scholarship granting organization that uses the contribution to fund scholarships for eligible students solely within the State in which the organization is listed pursuant to subsection (g).

SRC: STAT L168 | [statute]

Whether the SGO actually uses the money for in-State students is outside the donor's control; the donor's protection is the list-reliance rule (F54). Treasury reads "solely within the State" as referring to where the student lives:

> The Treasury Department and the IRS interpret the statutory language ``eligible students solely within the State in which the organization is listed'' to refer to the residence of the student, rather than where a school is located.

SRC: PROP L1396-1399 | [preamble/economic-analysis]

### F41. Regulatory definition: qualified only "to the extent" the donor designates it, at the time of the gift, to the recipient SGO
(a) Three conditions on designation: (1) made by the donor, (2) to the recipient SGO, (3) at the time of making the contribution. "To the extent" means partial designation is allowed (Example 4: $1,700 of a $4,000 gift). A gift with no designation at the time it is made is not a qualified contribution; the sources give no way to designate later.

Quote: see F4 (TEMP L1514-1519).

> Under this definition, a donor is required to designate to the recipient SGO, at the time of making the contribution, that the contribution is intended to be a qualified contribution, which requires the SGO to deposit the contribution into the SGO's section 25F segregated account as part of the SGO's compliance with sections 25F(c)(3) and 25F(c)(5)(B).

SRC: TEMP L185-190 | [preamble/economic-analysis]

> Make a qualified contribution of cash to an approved SGO. Tell the SGO your payment is a section 25F qualified contribution.

SRC: IRSIND L415 | [IRS web page]

### F42. The designation is irrevocable, for both donor and SGO
(a) Once designated, neither the donor nor the SGO can undo the designation. The form the designation must take (checkbox, writing, signature) is NOT IN SOURCES.

> Such designation, once made, is irrevocable.

SRC: TEMP L1519 | [temporary-reg: in force]

> Once a qualified contribution is designated as such by a donor, neither the donor nor the recipient organization would be permitted to revoke such designation to reduce administrative burden and provide certainty.

SRC: PROP L861-864 | [preamble/economic-analysis]

### F43. A designated gift goes into the SGO's section 25F segregated account whether or not the donor ever gets a credit
(a) Designation drives where the money goes. Even a donor who ends up with no usable credit has a designated gift locked into the segregated account.

> A contribution designated by a donor as a qualified contribution would need to be deposited in this section 25F segregated account regardless of whether the donor ultimately receives a tax credit for the qualified contribution.

SRC: PROP L858-861 | [preamble/economic-analysis]

> The term section 25F segregated account means the separate account exclusively for qualified contributions and the earnings therefrom that the SGO must maintain pursuant to section 25F(c)(5)(B).

SRC: TEMP L1538-1541 | [temporary-reg: in force]

### F44. "Cash" means U.S.-dollar money payments; digital assets are excluded
(a) Allowed: physical currency, check, money order, electronic transfer, after-tax payroll deduction, "or other similar method", all in U.S. dollars. Not allowed: any digital asset. Credit and debit cards are named only in the preamble, as an example of electronic transfer. Non-cash property (stock, etc.) is outside the definition because the statute requires cash.

> (A) Means physical currency, check, money order, electronic transfer, after-tax payroll deduction, or other similar method, in each case all in U.S. dollars, and (B) Does not mean any digital asset.

SRC: TEMP L1527-1530 | [temporary-reg: in force]

> the term ``cash'' means physical currency, check, money order, electronic transfer (including, for example, by credit or debit card), after-tax payroll deduction, or other similar method, in each case all in U.S. dollars, but does not include any digital assets.

SRC: TEMP L181-184 | [preamble/economic-analysis]

### F45. Goods or services from the SGO reduce the qualified contribution
(a) Quid pro quo: `qualifiedContribution = designated cash - value of goods/services the SGO provides as consideration`. The rule speaks only of goods or services provided by the SGO.

> If the SGO provides any goods or services as consideration for any part of the contribution, then the value of those goods and services must be subtracted from the amount of the charitable contribution to arrive at the amount of the qualified contribution.

SRC: TEMP L1521-1524 | [temporary-reg: in force]

### F46. Multistate SGOs: the donor chooses which covered State's segregated account receives the gift
(a) If the SGO is on more than one State's list, the SGO must let the donor allocate the qualified contribution among those States, and must deposit accordingly. For a single-State (Texas-only) SGO there is nothing to choose.

> The SGO must allow donors to designate how their qualified contribution should be allocated among one or more of those covered States, and all qualified contributions must be deposited into the SGO's section 25F segregated account for one or more of those covered States in accordance with donor designations.

SRC: PROP L5375-5379 | [proposed-reg: not final]

> If the SGO is a multistate SGO, the donor would be able to direct the recipient SGO to allocate the qualified contribution to the multistate SGO's section 25F segregated account for any one or more of the covered States on whose State SGO list the SGO appears.

SRC: TEMP L190-194 | [preamble/economic-analysis]

### F47. The designation requirement will also appear in the Form 8525 instructions
(a) The donor-facing IRS instructions will repeat that the donor must identify the gift as a qualified contribution to the SGO at the time of the gift.

> To make a qualified contribution as defined in proposed Sec.  1.25F-1(a)(12), a taxpayer would be required to identify, to the recipient SGO at the time of making the contribution, that the contribution is intended to be a qualified contribution and should be deposited in the SGO's section 25F segregated account (or, if the SGO is a multistate SGO, that the qualified contribution should be allocated to the SGO's section 25F segregated account for one or more of the covered States on whose State SGO list the SGO appears). This third-party disclosure requirement will be listed within the instructions for Form 8525, Federal Scholarship Tax Credit (or successor).

SRC: PROP L4103-4113 | [preamble/economic-analysis]

## I. Earmarking and self-dealing (what a donor may not do)

### F48. No earmarking for a particular student
(a) The rule is written as an SGO requirement: the SGO may not earmark or set aside contributions for scholarships on behalf of any particular student. An SGO that does so fails the SGO definition. The sources contain no separate donor-level penalty, but see F55(ii): a donor who is responsible for, or aware of, the act that gets an SGO removed loses list reliance. Whether a donor may restrict a gift to a particular school or program (as opposed to a student) is NOT IN SOURCES.

> such organization does not earmark or set aside contributions for scholarships on behalf of any particular student, and

SRC: STAT L210 | [statute]

> (vii) Does not earmark or set aside contributions for scholarships on behalf of any particular student.

SRC: PROP L5346-5347 | [proposed-reg: not final]

### F49. No scholarships to "disqualified persons"; a large donor and the donor's family can be disqualified
(a) An SGO may not award a scholarship to a disqualified person. Disqualified persons include a "substantial contributor" and members of the substantial contributor's family. So a large donor's child, grandchild, niece or nephew cannot receive a scholarship from that SGO.

> A scholarship granting organization may not award a scholarship to any disqualified person.

SRC: STAT L222 | [statute]

> The term disqualified person means, with respect to an SGO, a person who is: (i) A substantial contributor to the SGO or to the section 25F segregated account, as defined in paragraph (d)(2) of this section; (ii) An officer, director, or trustee of the SGO, as well as an individual having powers and responsibilities similar to those of such persons; (iii) Any individual participating in, including as a member of a committee, the selection of scholarship recipients or the determination of scholarship awards; and (iv) A member of the family, as defined in paragraph (d)(3) of this section, of any individual described in paragraph (d)(1)(i), (ii), or (iii) of this section.

SRC: PROP L5639-5651 | [proposed-reg: not final]

### F50. "Substantial contributor" test: more than $5,000 AND more than 2 percent, in the SGO's taxable year; spouses are combined
(a) A person is a substantial contributor if, during the SGO's taxable year, the person gave more than $5,000 in total to the SGO AND that amount is more than 2 percent of total contributions the SGO received that year. The same two-part test is applied separately to the section 25F segregated account. Contributions by a spouse are attributed to the individual. Status is determined at the close of the SGO's taxable year, and lasts for that year and the next. All contributions count (designated or not). A donor who only ever gives the $1,700 (or a couple giving $3,400) stays under $5,000.

> The term substantial contributor means any person who contributed an aggregate amount of more than $5,000 to the SGO during the taxable year, if such amount is more than 2 percent of the total contributions received by the SGO during the taxable year. For this purpose, an individual will be treated as making all contributions made by his or her spouse. In addition, the term substantial contributor means any person who contributed an aggregate amount of more than $5,000 to a section 25F segregated account during the taxable year, if such amount is more than 2 percent of the total contributions received by the section 25F segregated account during the taxable year. A person's status as a substantial contributor is determined as of the close of each taxable year of the SGO.

SRC: PROP L5652-5664 | [proposed-reg: not final]

> An individual described in paragraph (d)(1)(i) of this section will be treated as a substantial contributor for any taxable year of the SGO in which the individual is so described and for the immediately succeeding taxable year of the SGO.

SRC: PROP L5690-5693 | [proposed-reg: not final]

### F50a. (Fact-check addition) "Excepted scholarships": an award made before the donor crossed the thresholds is protected if the SGO could not have known
(a) Because substantial-contributor status is fixed only at the SGO's year-end, a scholarship already awarded to a donor's family member is not treated as an award to a disqualified person if both conditions held at the time of the award: (A) measured on contributions received through the award date, the recipient would not have been a disqualified person, and (B) the SGO did not know and did not reasonably expect the recipient would become one. A pledge or stated intent to give more later defeats (B) (see Example 3 in F53, where C "did not make a pledge or otherwise inform Q of any intent to make additional contributions"). For a multistate SGO, being a disqualified person at the segregated-account level applies only to that State's account (PROP L5388-5390). Product consequence: recurring-gift schedules and pledges are information the SGO "knows"; surface them to the SGO.

> A scholarship awarded by an SGO to a substantial contributor or a substantial contributor's family member will not be treated as an award to a disqualified person if, at the time the scholarship was awarded: (A) The recipient would not have been a disqualified person had the substantial contributor determination been made as of the date of the award, based on contributions received by the SGO through that date; and (B) The SGO did not know and did not reasonably expect that the recipient would be a disqualified person based on the substantial contributor determination made as of the close of the taxable year.

SRC: PROP L5665-5675 | [proposed-reg: not final]

### F51. Who counts as "family"
(a) Spouse; ancestors and descendants of the individual or the spouse; siblings of the individual or the spouse; descendants of those siblings; and spouses of any of those ancestors, descendants, siblings or sibling-descendants. Adopted children and step-children count as descendants.

> The family of any individual includes only: (A) The individual's spouse; (B) The ancestors and descendants of the individual or the individual's spouse; (C) The siblings of the individual or the individual's spouse; (D) The descendants of siblings described in paragraph (d)(3)(i)(C) of this section; and (E) The spouse of any individual described in paragraph (d)(3)(i)(B), (C), or (D) of this section.

SRC: PROP L5676-5685 | [proposed-reg: not final]

### F52. Ordinary (small) donors' families are NOT barred from scholarships
(a) Treasury declined to bar scholarships to family members of all donors. Only substantial contributors (and insiders) trigger the bar. This does not relax the earmarking ban in F48.

> A few stakeholders suggested a rule completely prohibiting SGOs from providing scholarships to the family members of any donors. The proposed regulations do not adopt the recommendation.

SRC: PROP L1522-1524 | [preamble/economic-analysis]

### F53. Worked examples of the substantial-contributor test (usable as unit tests for a "large donor" flag)
(a) Three examples in Prop. Reg. 1.25F-3(d)(5). Summary of the numbers (verbatim sentences quoted):
- Example 1: A gives $6,000; SGO O's total contributions for 2027 are $450,000; 6,000/450,000 = 1.33 percent; NOT a substantial contributor.
- Example 2: B gives $6,000 on July 1, 2027; SGO P's total for 2027 is $280,000; 2.14 percent; IS a substantial contributor for 2027 and 2028.
- Example 3: C gives $7,000 on Feb 10, 2027 and $7,000 on Nov 16, 2027; SGO Q's total for 2027 is $650,000; $14,000 = 2.15 percent; IS a substantial contributor for 2027 and 2028; but a scholarship awarded to C's daughter on Aug 15, 2027 (when Q had received $400,000 and only C's first $7,000, i.e. under 2 percent, and Q had no reason to expect more) is an "excepted scholarship".

> Therefore, as of December 31, 2027, O had received $450,000 from all sources as total contributions and bequests during the year, and A's $6,000 contribution represented 1.33 percent of the total contributions and bequests received by O during 2027.

SRC: PROP L5719-5722 | [proposed-reg: not final]

> Therefore, as of December 31, 2027, P had received $280,000 from all sources as total contributions and bequests during the year, and B's $6,000 contribution represented 2.14 percent of P's total contributions and bequests during 2027.

SRC: PROP L5735-5738 | [proposed-reg: not final]

> B will be treated as a substantial contributor for the tax year ending December 31, 2027, and for the following tax year ending December 31, 2028. Generally, any scholarships awarded to B's family members during the tax years ending December 31, 2027, or December 31, 2028, will be treated as scholarships awarded to a disqualified person.

SRC: PROP L5741-5746 | [proposed-reg: not final]

> As of December 31, 2027, Q had received $650,000 from all sources as total contributions and bequests during the year, and C's total contributions of $14,000 represented 2.15 percent of Q's total contributions and bequests during 2027.

SRC: PROP L5760-5763 | [proposed-reg: not final]

Fact-check additions (two outcome sentences the summary above left out; both are needed for unit tests). Dates in the examples: A gives on May 2, 2027 (PROP L5710).

> However, any scholarship awards made to B's family members prior to July 1, 2027, may qualify as an excepted scholarship if the requirements of paragraph (d)(2)(ii) of this section are met.

SRC: PROP L5746-5748 | [proposed-reg: not final]

> However, C is otherwise considered a disqualified person for the tax years ending December 31, 2027, and December 31, 2028, and any scholarships awarded to C's family members in 2028 will be treated as scholarships awarded to a disqualified person.

SRC: PROP L5778-5782 | [proposed-reg: not final]

## J. Reliance on the IRS SGO list, and removal of an SGO

### F54. A donor may rely on the IRS SGO list as it stands at the time of the contribution
(a) If the organization is on the IRS SGO list and not shown as removed at the time the contribution is made, the donor may rely on that to establish the gift went to an SGO. Later removal does not undo a gift made before removal (subject to F55).

> Except as provided in paragraph (b)(2) of this section, a taxpayer may rely on the fact that an organization is listed on the IRS SGO list (and not listed as removed from that list) at the time a contribution is made to establish that the taxpayer's contribution is being made to an SGO.

SRC: PROP L5066-5070 | [proposed-reg: not final]

> A donor may rely on the IRS SGO list on the date the donor makes a qualified contribution. If an organization is removed from the list during the year, only contributions made before the removal date may qualify for the credit.

SRC: IRSIND L412 | [IRS web page]

### F54a. (Fact-check addition) The organization must already be State-listed when the gift is made; a gift made before the State submits its list is not protected by anything in the sources
(a) The statute makes list inclusion part of the definition of an SGO ("included on the list submitted for the applicable covered State ... for the applicable year", STAT L189). The IRS web pages go further and tie it to the time of the gift: the credit is for contributions to an SGO that "at the time of the contribution, appears on a State's list", and taxpayers "can't claim the credit for qualifying donations in a state until that state elects to participate and submits its approved SGOs to the IRS" (IRSMAIN L18, quoted in F8). Treasury's preamble says taxpayers need the State's certification "prior to donating". No regulation text says what happens to a gift made on, say, January 5, 2027 to an organization that Texas lists on February 10, 2027; but every statement found points the same way, and no source says such a gift qualifies. Treat a gift made before the organization appears on the State's submitted list (and, for reliance, on the IRS SGO list) as NOT credit-eligible.

> Individual taxpayers may claim the FTSC for contributions to any SGO which, at the time of the contribution, appears on a State’s list of approved SGOs in that State.

SRC: IRSST L423 | [IRS web page] ("FTSC" is as printed on the IRS page)

> In order for the section 25F credit to operate as intended by Congress, taxpayers require certainty that a State has certified that an SGO satisfies the statutory requirements of section 25F prior to donating funds to organizations beginning on January 1, 2027.

SRC: TEMP L863-866 | [preamble/economic-analysis]

> In order for a contribution made by a taxpayer to an organization in a covered State to be a qualified contribution eligible for a section 25F credit, among other requirements, section 25F requires the State to have identified the organization as an SGO that satisfies the requirements of section 25F(c)(5) for the applicable calendar year.

SRC: PROP L178-183 | [preamble/economic-analysis]

> Until Texas submits that list, no SGO in Texas qualifies.

SRC: SGOLIST L36 | [secondary/web] (unofficial directory site; consistent with the IRS statements above, not independent authority)

### F55. Reliance is lost if the donor knew, or was involved
(a) No reliance if the donor (i) knew at the time of the gift that the organization did not meet the SGO requirements, or (ii) was at least partly responsible for, or aware of, the act, failure to act, or change that later led to the organization's removal.

> A taxpayer may not rely on the fact that an organization is listed on the IRS SGO list (and not listed as removed from that list) at the time a contribution is made to establish that the organization is an SGO if the taxpayer: (i) Had knowledge that the recipient organization did not satisfy the requirements of section 25F(c)(5) and Sec.  1.25F-3(b) at the time the contribution was made; or (ii) Was at least in part responsible for, or was aware of, the act, the failure to act, or the substantial and material change on the part of the organization that gave rise to the removal of the organization from the IRS SGO list in accordance with Sec.  1.25F-5(d)(8) after the date of the taxpayer's contribution.

SRC: PROP L5075-5086 | [proposed-reg: not final]

### F56. Contributions made after the removal date are not qualified contributions
(a) Removal has a date. Gifts after that date do not qualify (the economic analysis adds "except to the extent a taxpayer may rely on the IRS SGO list", i.e. the list's own status and date control). The IRS shows a removed SGO in strike-through text with the removal date. Checkout must stop taking designated gifts for a removed SGO.

> The organization will be removed from the relevant part of the IRS SGO list for the current year to ensure that any contributions to the organization after the date of its removal from the State or IRS SGO list are not treated as qualified contributions.

SRC: TEMP L720-723 | [preamble/economic-analysis]

> If an SGO is removed from the IRS SGO list, its name and identifying information will be displayed in strike-through text, along with the date of the organization's removal from the list, to provide taxpayers with the information they may need in determining if their contribution is being made, or was made, to a valid SGO and thus is a qualified contribution eligible for the section 25F credit.

SRC: TEMP L760-766 | [preamble/economic-analysis]

> An organization may be removed from the IRS SGO list, and will be shown on that list as having been removed as of the date the IRS removes the organization from that list, in the following circumstances:

SRC: TEMP L1980-1982 | [temporary-reg: in force]

> Contributions made after the date of removal from the State SGO list would not be treated as qualified contributions under section 25F, except to the extent a taxpayer may rely on the IRS SGO list.

SRC: PROP L3262-3264 | [preamble/economic-analysis]

### F56a. (Fact-check addition) Treasury chose the removal date as the cut-off on purpose: gifts before removal stay good, gifts after do not
(a) Treasury considered and rejected two alternatives: disallowing every contribution made in the year of removal, and allowing contributions for the whole year even after removal. So the removal date splits the year. This supports storing the list status and timestamp with each payment.

> Alternatives to these proposed rules would be to disallow contributions made at any time during the year of removal (thus depriving taxpayers otherwise entitled to the credit for a qualified contribution) or allowing contributions made during the entire year, even after the SGO became disqualified.

SRC: PROP L3265-3269 | [preamble/economic-analysis]

### F57. The IRS list only shows SGOs that consented to be listed; no consent means no list reliance
(a) An SGO can be validly on a State list but absent from the public IRS list because it did not authorize disclosure. Donors to such an SGO cannot use the list-reliance rule and need "other evidence" that it is an SGO.

> For those SGOs that have authorized the disclosure of their information on the IRS SGO list, the IRS SGO list will contain each SGO included on a State SGO list for each of the covered States for the calendar year and reflect each removal from a State SGO list and the date of the removal.

SRC: TEMP L2014-2018 | [temporary-reg: in force]

> If an SGO does not consent to the disclosure of its information on the IRS SGO list, a taxpayer would not be able to use the reliance offered by the IRS SGO list for purposes of establishing that the taxpayer's contribution to that organization is a qualified contribution. Instead, the taxpayer would need to rely on other evidence to establish that the organization is an SGO.

SRC: PROP L2327-2332 | [preamble/economic-analysis]

> Note: some approved SGOs may not appear on the IRS SGO list on the IRS’s website because the SGO didn’t consent to be listed.

SRC: IRSIND L413 | [IRS web page]

### F58. Where and when the IRS SGO list appears; the 2027 State-list deadline
(a) The IRS says the list will be available through its Tax Exempt Organization Search page and posted on December 31, 2026. For 2027 only, a State may deliver its SGO list as late as February 15, 2027; after the deadline a State cannot add organizations for that calendar year. If a State that made an advance election never delivers its list, no organization in that State is an SGO for the year.

> Before contributing, check if the organization is an approved SGO and located in a participating state by searching the IRS SGO list which will be available on the IRS Tax Exempt Organization Search page. The list of qualified SGOs will be posted on December 31, 2026.

SRC: IRSIND L411 | [IRS web page]

> For calendar year 2027 only, a State may provide its State SGO list on or before February 15, 2027.

SRC: TEMP L1767-1768 | [temporary-reg: in force]

> a State may not make any additions to the State SGO list for a calendar year after the deadline provided in paragraph (c)(3)(ii) or (c)(4) of this section, as applicable.

SRC: TEMP L1959-1962 | [temporary-reg: in force]

> Accordingly, no organization in that State would qualify as an SGO for the calendar year for which the advance election was not perfected.

SRC: TEMP L1774-1775 | [temporary-reg: in force]

An organization can also be on a State list while its section 501(c)(3) application is still pending; it reaches the IRS list only later, so "on the State list" and "on the IRS list" can differ in time:

> Upon determining that an organization described in paragraph (d)(5) of this section qualifies for tax-exempt status and that the effective date of such tax-exempt status is on or before January 1 of the calendar year for which the State SGO list applies, the IRS will add the organization to the IRS SGO list for that year if, and as soon as, the organization authorizes publication of its information to be included on that list.

SRC: TEMP L2020-2026 | [temporary-reg: in force]

### F59. A multistate SGO removed by one State stays listed for its other States
(a) Listing status is per covered State. Track (SGO, State) pairs, not just SGOs.

> If a State removes a multistate SGO from its State SGO list under paragraph (d)(7)(iii) of this section, but the SGO continues to satisfy all applicable requirements for an SGO in a different covered State on whose State SGO list it appears, as well as the applicable requirements as described in paragraph (e)(1) of this section in such other State(s), the SGO will remain on the IRS SGO list with respect to such other covered State(s), subject to any further discretionary examination of the SGO by such other covered States or the IRS.

SRC: TEMP L2004-2012 | [temporary-reg: in force]

## K. Timing and effective dates

### F60. Statutory effective date: taxable years ending after December 31, 2026
(a) For a calendar-year individual the first year is tax year 2027.

> Section applicable to taxable years ending after Dec. 31, 2026

SRC: STAT L270 | [statute]

### F61. Qualified contributions can begin on January 1, 2027
(a) The first day a gift can be a qualified contribution is January 1, 2027.

> Taxpayers may begin making qualified contributions on January 1, 2027.

SRC: TEMP L898-899 | [preamble/economic-analysis]

> Beginning Jan. 1, 2027, individual donors may be able to claim a nonrefundable FSTC, commonly known as the Education Freedom Tax Credit, of up to $1,700 for charitable contributions of cash to certain public charities that grant scholarships for qualifying elementary and secondary educational expenses.

SRC: IRSIND L404 | [IRS web page]

### F62. The credit year is the year the contribution is "made"; the 25F sources do not define when that is
(a) The credit is for contributions "made by the taxpayer during the taxable year" (F1), SGO reporting is by calendar year (F67, F70), and reliance is tested "at the time a contribution is made" (F54). But **NOT IN SOURCES**: no section 25F source says when a card charge, ACH debit, mailed check or payroll deduction is treated as made, or which time zone decides a midnight December 31 gift.

For reference only, the IRS's general section 170 guidance (not a 25F rule; whether it carries over is for counsel). Fact-check: these three quotes are from IRS Publication 526 (2025), an official IRS publication, so the source-type tag was changed from `[secondary/web]` to `[IRS web page]`; that does not make them section 25F authority. They are UNVERIFIED as section 25F rules: no section 25F source adopts them.

> Time of making contribution. Usually, you make a contribution at the time of its unconditional delivery.

SRC: P526 L2103 | [IRS web page] (Publication 526, section 170 only; not section 25F authority)

> Checks. A check you mail to a charity is considered delivered on the date you mail it.

SRC: P526 L2104-2105 | [IRS web page] (Publication 526, section 170 only; not section 25F authority)

> Credit card. Contributions charged on your bank credit card are deductible in the year you make the charge.

SRC: P526 L2109-2111 | [IRS web page] (Publication 526, section 170 only; not section 25F authority)

### F63. Applicability of the temporary regulations
(a) Effective December 1, 2026; reg text applies on or after September 1, 2026; expires October 1, 2029.

> These temporary regulations are effective on December 1, 2026.

SRC: TEMP L46-47 | [preamble/economic-analysis] (Fact-check: this sentence is in the DATES caption of T.D. 10057, not in the regulation text, so the tag was changed from `[temporary-reg: in force]`. Note the date: on 2026-11-18 the temporary regulations are published but not yet effective.)

> These temporary regulations under Sec. Sec.  1.25F-1T, 4T, and 5T apply on or after September 1, 2026, so that the Treasury Department and the IRS have procedural rules in place with which to develop the necessary implementation processes. See section 7805(b)(2). The temporary regulations expire on October 1, 2029.

SRC: TEMP L828-832 | [preamble/economic-analysis]

> This section applies on or after September 1, 2026. The applicability of this section expires on or before October 1, 2029.

SRC: TEMP L1562-1564 | [temporary-reg: in force]

### F64. Applicability of the proposed regulations, and reliance before they are final
(a) The proposed rules will apply to taxable years ending on or after the date final regulations are published. Until then donors, SGOs and States may rely on the proposed rules for qualified contributions made on or after January 1, 2027, but only if they follow the applicable portions in their entirety and consistently. Comments are due December 1, 2026.

> Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent manner.

SRC: PROP L2406-2413 | [preamble/economic-analysis]

> This section applies to taxable years ending on or after [date of publication of the final regulations in the Federal Register].

SRC: PROP L5290-5292 | [proposed-reg: not final]

> Written or electronic comments must be received by December 1, 2026.

SRC: PROP L99-100 | [preamble/economic-analysis]

## L. Substantiation: acknowledgment, unique donor number, Form 8525

### F65. The donor claims the credit on Form 8525, attached to Form 1040, listing each SGO's unique donor number
(a) The donor must report, for each SGO given to in the year, the unique donor number from that SGO's acknowledgment. Form 8525 will first be available in the 2028 filing season, for 2027 contributions. The form's fields beyond "the required SGO and unique donor number" are NOT IN SOURCES. I could not retrieve a published or draft Form 8525: the three irs.gov addresses tried on 2026-11-18 (`forms-pubs/about-form-8525`, `pub/irs-pdf/f8525.pdf`, `pub/irs-dft/f8525--dft.pdf`) returned 404.

> A taxpayer who claims the section 25F credit on the taxpayer's Federal income tax return must substantiate the credit on Form 8525, Federal Scholarship Tax Credit (or successor form), by reporting such information as may be required in the form and instructions, including, for each SGO to which the taxpayer has made a qualified contribution during the taxable year, the unique donor number that the SGO was required to provide as part of a timely written acknowledgement in accordance with Sec.  1.25F-4(c).

SRC: PROP L5135-5142 | [proposed-reg: not final]

> Complete Form 8525, Federal Scholarship Tax Credit, listing the required SGO and unique donor number. Note: Form 8525 will be available for the 2028 filing season for contributions made to SGOs during calendar year 2027.

SRC: IRSIND L420 | [IRS web page]

> These collections will be made by individual taxpayers as part of filing a Form 1040, including completing new Form 8525, Federal Scholarship Tax Credit (or successor form), and attaching the form to the taxpayer's Form 1040 when the taxpayer files the return.

SRC: PROP L4096-4099 | [preamble/economic-analysis]

### F66. Missing donor number = presumed no qualified contribution (rebuttable)
(a) If the donor number for an SGO is not on Form 8525, the IRS presumes no qualified contribution was made to that SGO. The donor can rebut with the SGO's timely written acknowledgment showing the number, or other evidence of the amount and of the designation, within the time the IRS gives.

> A taxpayer that does not provide the required donor number(s) on the taxpayer's Form 8525, Federal Scholarship Tax Credit (or successor form), will be presumed not to have made a qualified contribution to that SGO. However, this presumption may be rebutted by the taxpayer's submission of the timely written acknowledgement from the SGO that includes such unique donor number or other evidence satisfactory to the Commissioner of the amount of the contribution(s) from the taxpayer and the fact that the contributions were designated as qualified contributions, all within the response time prescribed in a written request from the IRS.

SRC: PROP L5143-5152 | [proposed-reg: not final]

### F67. The timely written acknowledgment: five required items
(a) The SGO must give each donor an acknowledgment with: (A) the SGO's EIN; (B) the total the donor designated as qualified contributions to that SGO during the calendar year; (C) the donor's unique donor number; (D) a statement whether the SGO provided any goods or services in consideration; (E) a description and good-faith value estimate of any such goods or services. Note (B) is the designated total, not the credit amount. Donor name, SGO name and gift dates are not in the required list.

> An organization must provide a timely written acknowledgement to each donor that includes the following information: (A) The organization's EIN; (B) The total amount of contributions made by the donor to the organization during the calendar year that the donor designated as qualified contributions; (C) The unique donor number the organization created for the donor in accordance with paragraph (b)(4) of this section; (D) A statement as to whether or not the organization provided any goods or services in consideration, in whole or in part, for any qualified contributions made by the donor to the SGO during the calendar year; and (E) A description and good faith estimate of the value of any goods or services described in paragraph (c)(1)(i)(D) of this section, if any.

SRC: TEMP L1616-1631 | [temporary-reg: in force]

### F68. Acknowledgment deadline January 31; electronic delivery only with unwithdrawn donor consent
(a) Due no later than January 31 of the year after the gift. May be on paper "or in any other form acceptable to the donor", including electronically if the donor consents and has not withdrawn consent before it is furnished.

> An organization must provide the timely written acknowledgement no later than January 31 of the calendar year following the calendar year in which a donor made a qualified contribution to the organization. The timely written acknowledgement can be provided in writing or in any other form acceptable to the donor, including by electronic delivery if the donor consents to receive the statement electronically and does not withdraw the consent before the statement is furnished.

SRC: TEMP L1633-1639 | [temporary-reg: in force]

### F69. Unique donor number: created by each SGO, per donor, in a uniform IRS format; the SGO must be registered in the IRS SGO portal first
(a) Each SGO creates one unique donor number for each donor who designated at least one payment in the calendar year, following IRS-supplied instructions. A donor giving to two SGOs gets two different numbers. The SGO cannot generate numbers (and so the donor cannot substantiate) until the SGO has registered in the IRS SGO portal. The number's format, and whether it is reused across years, are NOT IN SOURCES.

> The IRS will review the registration submission to verify that all the required information has been submitted and will provide the organization with instructions for creating a unique donor number for each donor who has designated at least one payment to the organization as a qualified contribution to the SGO during the calendar year.

SRC: TEMP L1609-1614 | [temporary-reg: in force]

> Because each SGO will be generating its own unique donor numbers, a taxpayer making qualified contributions to more than one SGO would receive a different donor number from each SGO.

SRC: PROP L792-795 | [preamble/economic-analysis]

> Until the organization has registered in the IRS SGO portal, the organization will not be able to comply with the acknowledgement and reporting requirements in paragraph (c) of this section, and that compliance is a necessary part of substantiating that a donor's qualified contribution is eligible for the credit allowed under section 25F.

SRC: TEMP L1590-1595 | [temporary-reg: in force]

### F70. The SGO reports each donor to the IRS by February 28: name, address, aggregate qualified contributions, keyed by donor number
(a) What the donor types at checkout (name, address) is what the SGO reports to the IRS and what the IRS matches against the donor's return.

> An organization must annually report to the IRS the following information with respect to each unique donor number assigned by the organization as set forth in paragraph (b)(4) of this section: (A) The donor's name; (B) The donor's address; (C) The aggregate amount of qualified contributions made by the donor to the organization during the calendar year; and (D) Any other information the IRS deems necessary for purposes of administering the requirements of section 25F as may be described in future guidance.

SRC: TEMP L1641-1650 | [temporary-reg: in force]

> An organization must report the information described in paragraph (c)(2)(i) of this section no later than February 28 of the year following the year in which such qualified contributions were made.

SRC: TEMP L1651-1654 | [temporary-reg: in force]

> This information is necessary to allow the IRS to validate donor information collected by SGOs against filed tax returns claiming the section 25F credit.

SRC: TEMP L1159-1161 | [preamble/economic-analysis]

### F71. Donor recordkeeping
(a) The donor is expected to keep records needed to compute the credit: qualified contributions, any State credit taken on those contributions, the liability limit, and carryforwards. Fact-check caveat: this sentence is Treasury's Paperwork Reduction Act description of the proposed rule. The text of Prop. Reg. 1.25F-2 itself (PROP L5019-5292) has no separate recordkeeping paragraph; its only donor-side substantiation rules are the Form 8525 requirement and the presumption (F65, F66). The preamble treats these as general tax records (PROP L4075-4077).

> Proposed Sec.  1.25F-2 would require the taxpayer to keep records of any information needed to calculate the amount of any section 25F credit from the taxpayer's qualified contributions (including any State credit the taxpayer will take on the taxpayer's State tax return with regard to the taxpayer's qualified contributions), as well as any limitations on the amount of the credit based on the taxpayer's tax liability to calculate the amount of credit able to be claimed and to determine any carryforward of unused credits.

SRC: PROP L4068-4075 | [preamble/economic-analysis]

### F72. The IRS's own four-step donor instructions
(a) (1) Make a qualified cash contribution to an approved SGO and tell the SGO it is a section 25F qualified contribution; (2) get the acknowledgment by January 31 with the donor number; (3) complete Form 8525; (4) file it with the 2027 return. The IRS states donor eligibility as two conditions only: make a qualified cash contribution to an eligible SGO, and claim the credit on the federal return "subject to applicable limitations".

> Claim the credit on the donor’s federal income tax return, subject to applicable limitations.

SRC: IRSIND L409 | [IRS web page]

> Obtain a timely written acknowledgement, which will be provided by the SGO on or before January 31 of the year following the year the qualified contribution is made. The timely written acknowledgement will include the individual donor’s unique donor number.

SRC: IRSIND L418 | [IRS web page]

> File Form 8525 with your 2027 federal income tax return.

SRC: IRSIND L421 | [IRS web page]

---

# M. NUMERIC EXAMPLES, REPRODUCED EXACTLY (unit-test material)

Preface to the examples in the regulation:

> The following examples illustrate the application of the rules of this section. For purposes of these examples, Org X and Org Y are listed on the IRS SGO list at the time of the contribution. In each case, the taxpayer provides the unique donor number for each SGO on the taxpayer's Form 8525, Federal Scholarship Tax Credit (or any successor form).

SRC: PROP L5153-5158 | [proposed-reg: not final]

### F73. Example 1: annual limitation and no double benefit

> (1) Example 1: Annual limitation and no double benefit--(i) Facts. In January 2027, Taxpayer A contributes $2,000 to Org X, designates the entire amount of the contribution as a qualified contribution, and receives a timely written acknowledgement in accordance with Sec.  1.25F-4(c). A's qualified contribution does not satisfy the requirements for any State credit. (ii) Analysis. A's $2,000 qualified contribution results in a $1,700 allowed section 25F credit that may be claimed on A's return for 2027, subject to the tax liability limitation under section 26(a). See paragraph (c) of this section. This $1,700 portion of the qualified contribution cannot be taken into account as a charitable contribution for purposes of section 170. The remaining $300 from the $2,000 qualified contribution may be deductible as a charitable contribution if it meets the requirements of section 170 and the regulations thereunder.

SRC: PROP L5159-5173 | [proposed-reg: not final]

### F74. Example 2: married taxpayers filing jointly

> (2) Example 2: Married taxpayers filing jointly--(i) Facts. In January 2027, Taxpayer B and Taxpayer C are a married couple. B and C each contribute $2,000 to Org X. Each designates the entire amount of their contribution as a qualified contribution and each receives a timely written acknowledgement in accordance with Sec.  1.25F-4(c). Neither B's nor C's contribution satisfies the requirements for any state credits. (ii) Analysis. Each of B and C's contributions result in a $1,700 allowed section 25F credit, resulting in a total of $3,400 that may be claimed on B and C's joint return. The credit will be subject to their combined tax liability limitation under section 26(a). See paragraph (c) of this section. The $3,400 of qualified contributions cannot be taken into account as a charitable contribution for purposes of section 170. The remaining $600 from the combined $4,000 qualified contributions may be deductible as a charitable contribution if it meets the requirements of section 170 and the regulations thereunder.

SRC: PROP L5174-5189 | [proposed-reg: not final]

### F75. Example 3: State credit reduces the section 25F credit

> (3) Example 3: State credit reduces credit under section 25F--(i) Facts. In January 2027, Taxpayer D contributes $1,500 to Org X and $500 to Org Y. D designates the entire amount of each contribution as a qualified contribution and receives a timely written acknowledgement for each in accordance with Sec.  1.25F-4(c). In addition, Org X qualifies as a State tuition granting organization under the laws of State Q. State Q offers a State credit equal to 40 percent of an individual's contributions up to $1,000 to a State tuition granting organization, and D's $1,500 contribution to Org X also satisfies the requirements for the State credit. In February 2028, D files a 2027 Form 1040 and the appropriate State Q income tax return. D claims a State credit of $400 on the State Q income tax return. (ii) Analysis. D's $2,000 of qualified contributions are reduced by $400, the amount of State credits claimed on the taxpayer's State tax return with regard to those qualified contributions. The remaining $1,600 of qualified contributions is less than $1,700, so D is allowed a $1,600 section 25F credit that may be claimed on D's return for 2027, subject to the tax liability limitation under section 26(a) and paragraph (d) of this section. See paragraph (c) of this section.

SRC: PROP L5190-5208 | [proposed-reg: not final]

### F76. Example 4: taxpayer designates less than the entire contribution

> (4) Example 4: Taxpayer designates less than the entire contribution as a qualified contribution--(i) Facts. In January 2027, Taxpayer E contributes $4,000 to Org X. E designates $1,700 as a qualified contribution and receives a timely written acknowledgement in accordance with Sec.  1.25F-4(c). In addition, Org X qualifies as a State tuition granting organization under the laws of State Z. State Z offers a $400 State credit equal to 10 percent of an individual's contributions of up to $4,000 to a State tuition granting organization, and E's entire contribution (both the qualified contribution and non-qualified contribution portions) also satisfies the requirements for the State credit. In February 2028, E files a 2027 Form 1040 and the appropriate State Z income tax return. E claims a State tax credit of $400 on the State Z income tax return. (ii) Analysis. Based on the ordering provision in paragraph (c)(2) of this section, E's $400 State credit is treated as being allowed first from the $2,300 non-qualified contribution to the SGO, so the $1,700 qualified contribution is not reduced by the $400 State credit. E's $1,700 qualified contribution to the SGO results in $1,700 of allowed section 25F credit that may be claimed on E's return for 2027, subject to the tax liability limitation under section 26(a) and paragraph (d) of this section. See paragraph (c) of this section.

SRC: PROP L5209-5229 | [proposed-reg: not final]

### F77. Example 5: credit carryforward (with both tables)

> (5) Example 5: Credit carryforward--(i) Facts. Taxpayer F has credit carryforwards under section 25F(f) for the last five years, as shown in Table 1 in this paragraph (h)(4)(i). F made qualified contributions of $2,000 in 2033 and has a limitation under section 26(a) of $4,500 for that year. F has no other nonrefundable credits. The difference between the qualified contribution in the year the carryforward was generated and the credit used in such year is based on F's section 26(a) limitation for each year.

SRC: PROP L5230-5241 | [proposed-reg: not final]

(The cross-reference "paragraph (h)(4)(i)" is as printed; the table is headed "Table 1 to Paragraph (h)(5)(i)".)

Table 1 to Paragraph (h)(5)(i) (PROP L5243-5257), values exactly as printed:

| Year | Cumulative carryforward from prior years | Qualified contributions | Section 25F credit used after application of section 26(a) | Carryforward from that year to future years under section 25F(f) and paragraph (e) of this section |
|---|---|---|---|---|
| 2027 | 0 | $1,000 | $900 | $100 |
| 2028 | $100 | 1,000 | 0 | 1,000 |
| 2029 | 1,100 | 1,000 | 0 | 1,000 |
| 2030 | 2,100 | 1,500 | 0 | 1,500 |
| 2031 | 3,600 | 1,500 | 0 | 1,500 |
| 2032 | 5,100 | 2,000 | 0 | 1,700 |

> (ii) Analysis for 2033. In taxable year 2033, F may use the section 25F(f) credit carryforwards from taxable years 2028 through 2032, but the carryforward from taxable year 2027 has expired as it was from more than five taxable years preceding the current taxable year. See paragraph (e)(2) of this section. As a result, the cumulative carryforward to 2033 is the sum of the amount carried forward to 2032 ($5,100) less the amount from 2027 ($100), plus the carryforward from 2032 ($1,700), for a total carryforward available in 2033 of $6,700. F's section 26(a) limitation of $4,500 will determine the amount of carryforwards F may use against F's income tax for taxable year 2033. Pursuant to paragraph (e)(3) of this section, F uses the credits in the following order: $1,000 from 2028, $1,000 from 2029, $1,500 from 2030, and $1,000 from 2031 for a total of $4,500. The remaining $500 from 2031, $1,700 from 2032, and the $1,700 from 2033 will be carried forward to a future year because they are limited by the section 26(a) limitation. See paragraphs (d) and (e) of this section.

SRC: PROP L5259-5274 | [proposed-reg: not final]

Table 2 to Paragraph (h)(5)(ii) (PROP L5276-5288), values exactly as printed:

| Year | Carryforward to future years | Carryforward used in 2033 | Carryforwards to 2034 |
|---|---|---|---|
| 2027 | $100 | $0--(expired) | $0 |
| 2028 | 1,000 | $1,000 | 0 |
| 2029 | 1,000 | $1,000 | 0 |
| 2030 | 1,500 | $1,500 | 0 |
| 2031 | 1,500 | $1,000 (partially used) | 500 |
| 2032 | 1,700 | $0 | 2,200 |
| 2033 (current year) | 1,700 | $0 | 3,900 |

Reading notes for Table 2 (my observation, checked arithmetically): the last column is a running total, not a per-year amount (500; 500 + 1,700 = 2,200; 2,200 + 1,700 = 3,900). Per-origin-year balances carried to 2034 are 2031: $500, 2032: $1,700, 2033: $1,700.

### F78. Economic-analysis example: $5,000 gift, $1,700 designated, State credit of 100 percent up to $2,000

> To illustrate this benefit, consider an example taxpayer who lives in a State that allows a 100% tax credit of up to $2,000 for contributions to SGOs. Suppose this taxpayer makes a cash contribution of $5,000 to an SGO and designates $1,700 of this contribution as a section 25F qualified contribution. For simplicity, further suppose that this taxpayer does not itemize the taxpayer's Federal deductions.

SRC: PROP L2662-2668 | [preamble/economic-analysis]

> The proposed regulation allows the taxpayer to count the $3,300 that is not designated as a ``qualified contribution'' toward the State tax credit (if otherwise eligible). In this example, the taxpayer could then receive $2,000 in State tax credits and the remaining $1,700 of the qualified contribution would qualify for the section 25F credit, without violating the section 25F(e) denial of double benefit requirement. Under the proposed regulations, this contribution would reduce the taxpayer's Federal tax liability by $1,700, and reduce the State tax liability by $2,000, for a total tax benefit of $3,700.

SRC: PROP L2669-2677 | [preamble/economic-analysis]

> Under this alternative, the taxpayer would have been required to reduce their $1,700 qualified contribution to zero, because the taxpayer claimed $2,000 as a credit against State tax liability. Under this alternative, the taxpayer's $5,000 contribution would not reduce the taxpayer's Federal tax liability, but would reduce the State tax liability by $2,000, for a total tax benefit of $2,000.

SRC: PROP L2680-2686 | [preamble/economic-analysis] (the REJECTED alternative ordering)

### Test-vector table (my restatement of the examples above; inputs and expected outputs)

All of these were re-computed with a reference script (`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/research/_scripts/verify_examples.py`) and reproduce the published numbers.

| ID | Source | Inputs | Expected |
|---|---|---|---|
| T1 | Example 1 | QC designated 2,000; State credit 0 | credit 1,700; not creditable and "may be deductible" 300 |
| T2 | Example 2 | Spouse B QC 2,000; spouse C QC 2,000; no State credit; joint return | B 1,700 + C 1,700 = 3,400; "may be deductible" 600; one combined section 26(a) limit |
| T3 | Example 3 | QC 1,500 (Org X) + 500 (Org Y) = 2,000; State credit 400 (40% of first 1,000) on the Org X gift; no non-qualified amount | 2,000 - 400 = 1,600; credit 1,600 |
| T4 | Example 4 | Gift 4,000 to Org X; designated 1,700; non-qualified 2,300; State credit 400 (10% of up to 4,000) on the whole gift | State credit absorbed by the 2,300; QC stays 1,700; credit 1,700 |
| T5 | Preamble II.F (rejected reading) | QC 2,500; State credit 500 | Rejected answer 1,200. Under the proposed rule: min(2,500 - 500, 1,700) = 1,700 (derived by formula; the 1,700 figure is not printed in the source) |
| T6 | Economic analysis | Gift 5,000; designated 1,700; non-qualified 3,300; State credit 2,000 | credit 1,700; total federal + State benefit 3,700. Rejected alternative: federal 0, total 2,000 |
| T7 | Example 5, Table 1 | Per-year (QC, section 26(a) limit): 2027 (1,000, 900); 2028 (1,000, 0); 2029 (1,000, 0); 2030 (1,500, 0); 2031 (1,500, 0); 2032 (2,000, 0). Limits for 2027-2032 are implied by the "credit used" column | used: 900, 0, 0, 0, 0, 0; carryforward generated: 100, 1,000, 1,000, 1,500, 1,500, 1,700; cumulative carryforward entering each year: 0, 100, 1,100, 2,100, 3,600, 5,100 |
| T8 | Example 5, 2033 | Enter 2033 with buckets 2027: 100, 2028: 1,000, 2029: 1,000, 2030: 1,500, 2031: 1,500, 2032: 1,700; 2033 QC 2,000; 2033 section 26(a) limit 4,500; no other credits | 2027 bucket expired (0 used); available carryforward 6,700; used 1,000 (2028) + 1,000 (2029) + 1,500 (2030) + 1,000 (2031) = 4,500; current-year 1,700 not used; carried to 2034: 2031: 500, 2032: 1,700, 2033: 1,700 (total 3,900) |

---

# ENGINEERING IMPLICATIONS

## 1. Put all credit math in one versioned module

- Constants: `CAP = 1700` USD per taxpayer per taxable year (F11); `CARRYFORWARD_YEARS = 5` (F32); `FIRST_ELIGIBLE_DATE = 2027-01-01` (F61). Tag each rule in code with its authority level (statute / temporary / proposed) so the proposed-only pieces (joint = separate taxpayers, State-credit ordering, FIFO-before-current) can be changed in one place if final regulations differ.
- Use integer cents. The sources work in whole dollars and state no rounding rule (NOT IN SOURCES).
- Core function (per taxpayer, per tax year), matching F12, F13, F23:

```
reduction = 0
for each State credit s the donor expects to be allowed for gifts to SGOs:
    # s.amount            = State credit dollars (include amounts the State will carry forward/back, F22)
    # s.nonQualifiedBase  = non-designated cash given to the SGO(s) that this State credit is also allowed for
    reduction += max(0, s.amount - s.nonQualifiedBase)        # F23: non-qualified dollars absorb the credit first, 1:1
    # (if several State credits apply, do not let two credits absorb against the same non-qualified dollars;
    #  the sources give no multi-credit example, see Open Questions 5)
qcNet   = max(0, sum(designated amounts net of goods/services) - reduction)   # F12, F45
credit  = min(qcNet, 1700)                                     # F13: cap applied last
notCreditable = sum(designated) - credit                       # may be deductible under section 170 only "if it meets the requirements" (F37)
```

- Fact-check notes on the block above. (i) The line `max(0, s.amount - s.nonQualifiedBase)` is an extrapolation of the ordering rule (F23) to the partial-spillover case (State credit larger than the non-designated amount). The published examples only show full absorption (Example 4 in F76 and the economic-analysis example in F78) or no non-designated amount at all (Example 3 in F75). The extrapolation follows the regulation's words ("first ... the amount ... that is not a qualified contribution and only thereafter ... the donor's qualified contributions") but has no worked example behind it; label any preview that depends on it as an estimate. (ii) `sum(designated)` in the last line must be the same goods/services-net figure used two lines earlier (F45). (iii) Split `notCreditable` into two display buckets: the part over the $1,700 cap, which the regulation's examples describe as "may be deductible" (F73, F74), and the part removed by a State credit, for which the sources give no example and no assurance (F38). Never show either bucket as "deductible" without the "may be ... if it meets the requirements of section 170" condition.
- Joint return: run the function once per spouse, then add (F15, F16). Never compute `min(coupleTotal, 3400)`: a couple where one spouse designates $3,400 and the other $0 is $1,700 under the per-taxpayer rule (inference, see Open Questions 3).
- Liability and carryforward (only if the panel offers an optional "my estimated tax" input; never invent a liability):

```
limit = max(0, taxUnderSections1and55 - creditsUnderSections21_22_24_25_25A_25B_25C_25E)   # F29, F30
drop buckets whose originYear < currentYear - 5                                           # F32
use buckets oldest-first against limit, then the current-year credit                       # F33
new bucket(currentYear) = current-year credit not used (never more than 1,700)             # F34
```

- Fact-check note on the block above: `taxUnderSections1and55` is a stand-in. The regulation says "tax liability as defined in section 26(a)" (F30) and the sources never spell out that definition (F30a), so the first line is a simplification, not a sourced formula. Take the limit as a donor-entered estimate ("federal income tax you expect to owe for the year after your other credits") and say so on screen; do not compute it. On a joint return there is one combined limit for both spouses' credits (F19); how carryforward buckets are tracked per spouse is NOT IN SOURCES (Open Questions 17).

- Unit tests: implement T1 through T8 exactly. T4 separates the correct one-for-one absorption reading (State-credit dollars against non-qualified contribution dollars) from a pro-rata reading: an implementation that attributes 10 percent of the credit base to each dollar would wrongly return 1,530 instead of 1,700 (the 1,530 is my arithmetic for the wrong reading, not a number in the sources). T6 separates non-qualified-first ordering (1,700) from qualified-first ordering (0). T5 separates reduce-then-cap (1,700) from cap-then-reduce (1,200). T7's 2032 row is the test that the cap applies before carryforward.

## 2. Checkout gates (block the "credit-eligible" path unless all are true)

1. Payment time is on or after 2027-01-01 (F60, F61). Because the sources do not define the time zone or the moment a payment is "made" (F62), use a conservative product default: open the credit-eligible path only once it is January 1, 2027 everywhere in the 50 States (00:00 Hawaii time, 10:00 UTC), and require the payment to be both initiated and charged after that moment. Do not take a 2026 authorization, pledge or scheduled payment and treat its 2027 capture as a qualified contribution without counsel sign-off. These are product choices, not rules from the sources.
2. The SGO is on the IRS SGO list for the relevant covered State and not shown as removed at the moment of the charge (F54, F56, F59). Re-check at charge time for every payment, including each installment of a recurring gift. Store a snapshot (list retrieval timestamp, SGO name/EIN, State, status) with the payment as the donor's reliance evidence.
3. The SGO has authorized public listing (F57). If an SGO is on a State list but not on the public IRS list, either do not offer it or show a warning that list reliance is unavailable.
4. The SGO has completed IRS SGO portal registration, so it can create unique donor numbers (F69). Without that the donor cannot complete Form 8525 (F66).
5. Donor attests: an individual giving personally (not a business, partnership, S corporation, trust, estate, fund or foundation) (F1, F4, F5, F6), and a U.S. citizen or U.S. tax resident (F1, F2). Do not offer a "company" donor type on the credit-eligible path.
6. Payment method is U.S.-dollar cash: card, ACH/electronic transfer, check, money order, currency, after-tax payroll deduction. No crypto, no stock, no non-USD presentment (F44).
7. Until the IRS list exists (IRS says December 31, 2026, F58) and Texas has delivered its list (deadline February 15, 2027, F58), any provisional SGO list must be labeled provisional, and gifts to SGOs not yet on the IRS list must not be labeled credit-eligible (see Open Questions 6).
8. (Fact-check addition) The SGO's State has actually submitted its State SGO list for the calendar year of the gift, i.e. the advance election is perfected (F8a, F54a). Model State status per calendar year as `advance_election_only` / `list_submitted` / `not_participating`, and keep the credit-eligible path closed for a State in `advance_election_only`. For Texas in 2027 this means the path may not open on January 1, 2027: it opens when Texas's list is submitted and the SGO shows on the IRS SGO list. A gift taken before that is not protected by any source (F54a). Re-evaluate every January 1, because each election and list covers one calendar year only (F8a).

## 3. Designation UX and record

- A required, explicit designation step at the time of payment, addressed to the SGO: "I designate $X of this payment as a qualified contribution under Internal Revenue Code section 25F." Store: designated amount, non-designated amount, timestamp, exact copy version shown, donor identity, SGO, State allocation (F41, F46).
- The designation must reach "the recipient SGO" at the time of the contribution (F41). The platform should act for the SGO at checkout and transmit the designation with the payment record immediately (see Open Questions 9 on agency).
- Irrevocable (F42): show this before payment; offer no "undesignate" or "convert to regular gift" function to donors or SGO staff; and never retro-designate a past undesignated gift.
- Allow partial designation (F41, Example 4). Default the designated amount to `min(gift, 1700)` per taxpayer and explain that designating more than $1,700 produces no additional federal credit in any year (F34) while still locking the money into the segregated account (F43); the non-designated remainder is an ordinary gift that can absorb a State credit first (F23). Do not hard-block a higher designation: Examples 1 and 2 designate $2,000. (Fact-check: "designating more than $1,700 produces no additional federal credit" is derived, not quoted. It holds for a fixed total gift under the proposed formulas in F12 and F23, with or without a State credit, and the over-cap part does not carry forward (F34). It was checked by algebra, not against a source sentence. Giving a larger total gift can raise the credit when a State credit would otherwise reduce it, as in the preamble's $2,500 / $500 case, F13.)
- Multistate SGO: require a State allocation (F46). Single-State Texas SGO: record "Texas".
- Goods/services: capture from the SGO whether anything is provided in return; if yes, capture description and good-faith value and subtract it from the qualified amount (F45, F67). Default "none", and do not attach perks (event tickets, merchandise) to designated gifts.

## 4. Joint-filer flow

- Collect both spouses' full names (F17) and an explicit amount per spouse. One payment may cover both, but the record must show it is "on behalf of both spouses" and how much is each spouse's contribution. The even-split default is a product choice; the split rule itself is NOT IN SOURCES.
- Each spouse is a separate donor record with an own designation, own unique donor number and own acknowledgment (F16, F18). Electronic-delivery consent is per donor (F68); get it from each spouse or mail paper to the one who has not consented.
- Panel copy: "up to $1,700 for each spouse who makes a qualified contribution; up to $3,400 on a joint return" and "this joint-return treatment is in proposed regulations and IRS guidance and is not yet final" (F15).
- Both spouses' gifts count together toward the $5,000 substantial-contributor threshold (F50).

## 5. Tax-math panel content (preview only)

Must show:
- $1,700 per taxpayer per year; dollar-for-dollar; nonrefundable: "only reduces federal income tax you actually owe" (F10, F11, F29).
- State-credit input: "State tax credit you expect to be allowed for this gift, in any State, including any part your State would carry to another year" (F22), plus the non-designated amount, feeding the F23 ordering. Note that State deductions do not count (F24).
- Liability limit in plain words: the credit is limited to federal income tax after certain other nonrefundable credits (F30); unused credit carries forward up to five years, oldest first (F31-F33).
- Section 170: the credited amount is not deductible; credit carried forward is also not deductible; only the part for which no credit is allowed "may be" deductible if section 170 rules are met (F35-F37).
- What to keep: the acknowledgment and donor number, needed for Form 8525, which the IRS says will be available for the 2028 filing season (F65).
- Labels: "Preview, not tax advice"; "Based on proposed regulations (REG-117199-25) that are not final".

Must not say:
- "Free", "costs you nothing", or "guaranteed" without the nonrefundable/liability qualifier.
- That the amount above $1,700 "is deductible" (sources: "may be deductible").
- That $3,400 is available to a couple when only one spouse gives.
- Anything implying the gift will fund a specific child (F48).
- (Fact-check additions) That the part of a designated gift cancelled by a State credit is deductible (F38). That a gift to a Texas organization "qualifies" or that Texas "participates" without the qualifier that Texas has made an advance election and must still submit its SGO list by February 15, 2027 (F8a, F54a). That the temporary or proposed regulations are "final" or "the law" (F63, F64). Plain-English names for the credits in sections 21 through 25E (F30, unverified).

## 6. No earmarking, no related-student linkage

- No field, memo, URL parameter or campaign page that names or identifies a student, and no "give so that [family/child] gets a scholarship" flow (F48). If a free-text note field exists, keep it off the credit-eligible path or review it.
- Do not connect the donor checkout to a specific family's intake or camp booking from Piece 2. A donor attestation that the gift is not made in exchange for, or conditioned on, a scholarship for a particular student is a prudent addition (derived from F40 "charitable contribution", F48, F55(ii)).
- Large-donor flag: when a donor's (plus spouse's) total gifts to one SGO in the SGO's taxable year exceed $5,000, flag to the SGO that the 2 percent test may make the donor a substantial contributor whose family cannot receive scholarships that year and the next (F49-F51). Give the SGO the running numerator; the SGO has the denominator. Test with F53's three examples.

## 7. Acknowledgment and reporting hooks

- An immediate email receipt does not by itself satisfy the acknowledgment rule unless it carries all five items in F67, including the calendar-year designated total and the unique donor number. Plan for an official acknowledgment per donor, per SGO, per calendar year, delivered by January 31 (F68). Because item (B) is the calendar-year total, generate the official document after year-end (or regenerate it if the donor gives again).
- For gifts with a non-designated or over-cap portion the donor may want to deduct, also show gift dates and amounts and the goods/services statement so the same document can serve as a section 170 acknowledgment (F39; P526 L2854-2857).
- Store per donor per SGO per calendar year: legal name, mailing address, aggregate designated amount, donor number (F70). Ask for the name "as it appears on your federal tax return" (recommendation; purpose is IRS matching, F70).
- Do not collect SSN/TIN from donors (F9).
- E-delivery consent: explicit, stored with timestamp and version, withdrawable; honor withdrawal by switching to paper before furnishing (F68).
- Donor dashboard: list each SGO, EIN and unique donor number for Form 8525 (F65). Remind donors that a missing number triggers the presumption in F66.

## 8. Fees, refunds, chargebacks

- The only amount-reduction rule in the sources is goods/services provided by the SGO (F45). The acknowledgment must state the total the donor designated (F67), and every designated dollar must be deposited in the segregated account (F43). So a platform fee netted out of a designated gift is not addressed by the sources and conflicts on its face with "deposit the designated amount"; keep any platform fee as a separate, non-designated line until counsel rules (matches the spec's open question).
- Refunds, chargebacks, failed ACH and bounced checks on designated gifts: NOT IN SOURCES, and designation is irrevocable (F42). Do not build self-serve refunds for designated gifts; route to the SGO and counsel, and make sure year-end totals (F67, F70) reflect only money actually received.

## 9. Year-end and list-change operations

- Timestamp every payment in UTC plus donor-local time; show a year-end notice that the tax year of a gift depends on when it is made and that this rule is not yet spelled out for section 25F (F62).
- Ingest the IRS SGO list on a schedule; on a removal (strike-through with date), stop designated gifts to that SGO/State immediately, cancel scheduled charges, and keep the pre-removal snapshots (F56).
- Each calendar year is a new State election and a new list (STAT L157 "for a calendar year"); do not assume an SGO listed for 2027 is listed for 2028.

## 10. Cross-check of the product spec (frame_1.txt) against the sources

The spec's Piece 1 summary is consistent with the sources. Points to tighten when writing code and copy:

- "Spouses filing jointly are treated as separate taxpayers ... a couple can reach $3,400 if each spouse makes qualifying contributions": correct, and proposed-only (F15, F16). Keep the "if each spouse" condition in every place $3,400 appears.
- "a split so each spouse can be associated with up to $1,700": the per-spouse figure is a cap on the credit, not on the gift or the designation. Examples 1 and 2 designate $2,000 per person (F73, F74). Guide, do not hard-limit.
- "Excess over the allowed credit may be deductible under section 170": true only for the part for which no credit is allowed (over the cap). Credit that is merely unused because of low tax liability carries forward and is NOT deductible (F36).
- "Cash ... includes ... electronic transfer (including a credit or debit card)": cards are named in the preamble, not in the regulation text (F44). Fine to accept cards; cite accordingly.
- "may rely on the organization's presence on the IRS SGO list at the time of the gift": add the two exceptions (F55) and the consent gap (F57) to the internal logic, and the removal-date rule (F56) to the SGO search.
- "Each spouse who contributes should receive a separate acknowledgment and a separate unique donor number": this sentence comes from the IRS web page (F18); the regulation text says "each donor" (F67, F69).
- "The IRS SGO list will not be complete until states file lists, due February 15, 2027": correct for 2027 (F58); the IRS separately says the list will be posted December 31, 2026 (F58). See Open Questions 6 for gifts made in between.
- "Confirm Texas treatment with counsel; secondary sources report that Texas does not currently have a separate state scholarship tax credit": nothing in the statute, regulations or IRS pages confirms or denies this; one unofficial site says Texas has no state income tax (F28, Open Questions 7). Keep the State-credit field for all donors, since donors can live in any State (F7) and the reduction counts a credit on "any State tax return" (F22).
- (Fact-check addition) "Gifts that are meant to earn the credit cannot be accepted before January 1, 2027, so the checkout can be built and tested in December and held behind a date check": a date check alone is not enough for Texas. The path must also stay closed until Texas has submitted its State SGO list and the SGO is on the IRS SGO list (F8a, F54a, gate 8). The spec's own risk note ("A gift to an organization that is not on a valid list does not earn the credit") agrees.
- (Fact-check addition) "a gift charged to a credit card is treated as made when the charge is made (Revenue Ruling 78-38; IRS Publication 526)": the Publication 526 sentence is confirmed (F62, P526 L2109-2111). Revenue Ruling 78-38 is UNVERIFIED: it does not appear in any source file. Both are section 170 authorities; no section 25F source adopts them (F62).
- (Fact-check addition) "Section 25F allows a credit equal to the donor's qualified contributions": correct only together with the three limits (State-credit reduction, $1,700 cap, liability limit; F12, F30). The spec states those limits elsewhere; keep them attached wherever this sentence is reused in copy.

---

# OPEN QUESTIONS / AMBIGUITIES (the sources do not settle these)

1. **When is a contribution "made"?** No section 25F source defines the moment for card charges, ACH, mailed checks or payroll deductions, or the time zone for the January 1, 2027 start and December 31 year-ends. Publication 526's section 170 rules (delivery; mailing date for checks; charge date for credit cards) are the closest IRS statement but are not 25F guidance (F62).
2. **Joint payment split.** The IRS page allows one combined payment "on behalf of both spouses" with both names (F17) but no source says how the SGO attributes dollars to each spouse if the amount is not an even split, or whether funds from one spouse's separate account can be the other spouse's contribution.
3. **One spouse gives everything.** That a lone-donor spouse is capped at $1,700 is an inference from "separate taxpayers" (F15) and "provided that each spouse has made qualified contributions" (F16); there is no example. Community-property effects (Texas is the wedge State) are NOT IN SOURCES.
4. **Joint State return.** How a State credit allowed on a joint State return is divided between two spouses' separate federal computations (F20).
5. **State credit "allowed" vs "claimed".** Whether a State credit the donor could have taken but did not claim still reduces the federal credit (F26). Also how to attribute a State credit when it is only partly absorbed by non-qualified amounts across several SGOs: F23 gives the principle and Examples 3, 4 and F78 give only full-absorption or no-absorption cases; there is no partial-spillover example.
6. **Gifts between January 1, 2027 and the day the SGO first appears on the IRS list.** States may deliver 2027 lists until February 15, 2027 (F58). The statute requires the SGO to be on the State's list "for the applicable year" (STAT L189), while the proposed reliance rule looks at the IRS list "at the time a contribution is made" (F54). Whether an early-January gift to an organization that is listed a few weeks later qualifies is not stated in the statute or in any regulation text. Fact-check correction: the sources are not neutral on this. Two IRS web pages say the SGO must appear on a State's list "at the time of the contribution" and that taxpayers "can't claim the credit ... until that state elects to participate and submits its approved SGOs to the IRS", and Treasury's preamble says the State certification comes "prior to donating" (F54a). No source says a pre-listing gift is cured by later listing. So the question is open only in the sense that regulation text is silent; the working assumption must be that such a gift does not qualify. Product rule: no "credit-eligible" label until the State's list is submitted and the SGO is on the IRS list (gate 8).
7. **Texas State credit.** Whether Texas offers any State tax credit for contributions to SGOs is not in the statute, regulations or IRS pages. States must describe such credits in their election (F28) but the sources do not show Texas's filing. An unofficial directory site says Texas has no state income tax (F28, [secondary/web]), and the Texas Constitution text saved in the sources prohibits a tax on individuals' net incomes (F28, TXCONST L7851-7853), which confirms there is no Texas individual income tax return. That still does not answer whether Texas offers some other State tax credit for SGO contributions; confirm with counsel before defaulting the State-credit field to zero for Texas residents, and keep the field for donors who file in other States.
8. **Platform fees.** How a third-party platform fee (taken from the gift, added on top, or invoiced to the SGO) affects the amount of the qualified contribution and the acknowledgment total is NOT IN SOURCES (F45 covers only goods or services provided by the SGO).
9. **Payment to a platform vs "to" the SGO.** Whether a payment collected by a for-profit platform and later remitted is a contribution "to" the SGO, when it is made, and whether a designation given to the platform counts as given "to the recipient SGO" at the time of the contribution (F41) are NOT IN SOURCES. The word "agent" does not appear anywhere in STAT, TEMP or PROP.
10. **Refunds, chargebacks, returned payments** of designated gifts, given irrevocability (F42): NOT IN SOURCES.
11. **Form of designation.** No source prescribes wording, writing, signature, or whether a checkbox suffices (F42). The Form 8525 instructions are expected to restate the requirement (F47) but are not published.
12. **Form 8525 fields.** Only "the required SGO and unique donor number" are known (F65). The form and instructions are not yet available; whether spouses file one form or two is NOT IN SOURCES.
13. **Unique donor number format and lifetime.** Uniform format comes from IRS portal instructions that are not in the sources; whether a donor keeps the same number with the same SGO in later years is not stated (F69).
14. **Non-individual payers.** Estates, trusts, C corporations, donor-advised funds, private foundations, employer matches, and gifts from a joint or business bank account or card are not addressed by name (F6).
15. **Section 170 details.** Whether the portion eliminated by a State credit is deductible (F38); whether an unused carryforward that expires after five years ever becomes deductible (F36 treats it as "allowed" while it may be carried forward; nothing addresses expiry).
16. **Ordering among the three carryforward credits.** The 25F credit comes after the credits in sections 21, 22, 24, 25, 25A, 25B, 25C and 25E (F30); its order relative to sections 23 and 25D is not given.
17. **Carryforward after status changes.** Treatment of carryforwards on marriage, divorce, death of a spouse, or switching between joint and separate returns is NOT IN SOURCES.
18. **Other filing statuses.** Nothing addresses married filing separately or other statuses beyond "per taxpayer" (F21).
19. **Donor restrictions short of naming a student** (a particular school, grade, program or neighborhood): NOT IN SOURCES; only "any particular student" is prohibited (F48), and multistate State allocation is expressly allowed (F46).
20. **Fiscal-year individuals.** The credit is by the donor's taxable year while SGO acknowledgments and reports are by calendar year; the sources give no reconciliation rule (almost all individuals are calendar-year filers).
21. **Finality.** Everything tagged [proposed-reg: not final] can change. Comments close December 1, 2026 and a hearing is set for December 15, 2026 (PROP L99-105). Treasury asked for comments "on all aspects of the proposed regulations" (PROP L4471-4473).
22. **(Fact-check addition) Designated but never claimed.** A donor is not required to claim the credit (TEMP L1346-1349: "an individual taxpayer is not required to claim a credit under section 25F"). Whether a donor who designates a gift, then chooses not to claim the credit (or cannot substantiate it), may deduct the gift under section 170 instead is NOT IN SOURCES. The statute bars a deduction for a qualified contribution "for which a credit is allowed" (F35) and the proposed rule treats an amount as allowed "if it may be carried forward" (F36); neither addresses a credit that is available but not claimed. The designation itself stays irrevocable and the money stays in the segregated account either way (F42, F43).
23. **(Fact-check addition) Will Texas's 2027 election be perfected, and when?** As of the sources, Texas has only an advance election (F8, F8a). If Texas does not submit its State SGO list by February 15, 2027, no Texas organization is an SGO for 2027 (F58). The date on which Texas will submit, and which organizations will be on the list, are NOT IN SOURCES. This is the main schedule risk for a Texas-first checkout.
24. **(Fact-check addition) Life of the temporary regulations.** The temporary regulations (designation, cash, acknowledgment, donor number, reporting, State lists) expire October 1, 2029 (F63). What replaces them is unknown until final regulations are published.
25. **(Fact-check addition) Partial State-credit spillover.** The amount by which a State credit larger than the donor's non-designated contributions reduces the qualified contributions is computed in this file by extrapolation (Engineering Implications 1); no example in the sources shows it.

---

# VERIFICATION LOG (adversarial fact-check, 2026-11-18)

Scope: every fact F1 through F78, the status map, the test-vector table, the Engineering Implications and the Open Questions were checked against the source files. Nothing about section 25F was taken from memory.

## What was checked

1. **Quotes.** All 130 original block quotes were re-checked with an independently written script (`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/research/_scripts/donor_factcheck_quotes.py`): each quote must appear verbatim inside its cited line range after whitespace collapse, removal of `[[Page n]]` markers and rejoining of words split at a line-end hyphen. Result: 130 of 130 verbatim at the cited lines. The checker was negative-tested (two quotes deliberately altered by one digit were both reported as missing). After the edits the file has 147 block quotes; both the fact-checker's script and the author's script report 0 mismatches.
2. **Whole-document reads.** T.D. 10057 was read end to end (2,079 lines). In REG-117199-25 the following were read in full: lines 1-930 (preamble parts I-III.C), 1380-1560 (student residence, priority, disqualified persons), 2285-2705 (IRS list, applicability date, economic analysis of the credit calculation), 3190-3270, 3660-3740, 4060-4118, and the proposed regulation text 4780-5400 and 5630-5790 (Prop. Reg. 1.25F-1, 1.25F-2, the SGO definition and disqualified-person rules). The statute text was read in full. Keyword searches over both rule files covered: refund, pledge, recurring, installment, postmark, mailed, year-end, employer, matching gift, donor-advised, estate, trust, C corporation, fiscal year, itemiz-, nonresident, possession, territory, community property, filing separately, agent, intermediary, platform, processor, fee, chargeback, credit card, payroll, digital asset, non-cash, stock, earmark, quid pro quo, goods or services, designat-, Form 8525, Form 1040, 170(c), 170(f)(8). These confirmed the file's "NOT IN SOURCES" statements for payment timing, refunds, platform fees, agents, estates/trusts and filing statuses other than joint.
3. **Tags.** Each `SRC` line was compared with where the cited lines sit (regulation text vs preamble vs DATES caption vs web page). Every quote tagged `[temporary-reg: in force]` is in the regulation text of T.D. 10057 (lines 1470-2067) except one, corrected below. Every quote tagged `[proposed-reg: not final]` is in the proposed regulation text (lines 4847 onward). No proposed-regulation content was found tagged as statute or as temporary regulation.
4. **Numbers and dates.** $1,700 cap; $3,400 joint; five-year carryforward; $5,000 and 2 percent thresholds; January 1, 2027; January 31 and February 28 deadlines; February 15, 2027 list deadline; December 1 and December 15, 2026 comment and hearing dates; December 1, 2026 effective date, September 1, 2026 applicability and October 1, 2029 expiry of the temporary regulations; 91 FR 62655 and 91 FR 62818; 31 States as of November 13, 2026 (counted). All match the sources.
5. **Examples and test vectors.** Examples 1-5, both tables, and the economic-analysis example were compared line by line with PROP L5153-5288 and L2662-2686. T1-T8 were recomputed with a separate reference script (`/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/factcheck_donor_scripts/vec.py`); all reproduce the printed numbers, including Table 1's cumulative column and the $6,700 / $4,500 / $3,900 figures for 2033. The derived claim that designating more than $1,700 of a fixed gift never raises the credit was checked by brute force over gifts and State credits from $0 to $6,000.
6. **Live re-fetch.** The three IRS FSTC pages (individuals, participating states, main) were re-downloaded with plain curl on 2026-11-18; their visible text is identical to the saved copies. Five irs.gov addresses for Form 8525 or its instructions (`forms-pubs/about-form-8525`, `pub/irs-pdf/f8525.pdf`, `pub/irs-pdf/i8525.pdf`, `pub/irs-dft/f8525--dft.pdf`, `pub/irs-dft/i8525--dft.pdf`) returned 404, confirming F65's statement that the form is not yet retrievable. Downloads are in `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/sources/extra/factcheck_donor/`.
7. **Spec cross-check.** The spec sentences quoted in Engineering Implications 10 were found in `spec/frame_1.txt` (lines 68, 70, 103, 107, 111, 115, 140, 149).

## Corrections made

1. **F8 (wrong emphasis, now corrected).** Title said "Texas has elected for 2027". The IRS page lists States under the heading "Advance elections to participate under Section 25F for 2027". An advance election is not complete until the State submits its SGO list. Title and text now say so; new fact F8a gives the rule (advance election on Form 15714 by January 1, 2027; perfection by list; lapse if not perfected; no revocation once perfected; one calendar year only).
2. **F63 (tag).** "These temporary regulations are effective on December 1, 2026" is in the DATES caption, not the regulation text. Tag changed from `[temporary-reg: in force]` to `[preamble/economic-analysis]`; the preamble's applicability/expiry sentence (TEMP L828-832) was added. A tag legend near the top now states that the temporary regulations are not yet effective on the date of this file.
3. **F62 (tag).** The three Publication 526 quotes were tagged `[secondary/web]`; Publication 526 is an IRS publication. Retagged `[IRS web page]` with an explicit "section 170 only, not section 25F authority, UNVERIFIED as a 25F rule" note.
4. **F38 (overstated "NOT IN SOURCES").** The general rule in Prop. Reg. 1.25F-2(f) ("Any portion ... for which a credit under section 25F is not allowed may be deductible ... if it meets the requirements of section 170") is broad enough to reach the State-credit-reduced portion, so the sources are not silent; they are conditional. F38 now says that, and that the section 170 requirements themselves are not in the sources. F37a adds the preamble's parallel wording.
5. **Open Questions 6 (understated).** The file said the treatment of a gift made before the organization is listed "is not stated". Regulation text is silent, but two IRS pages and Treasury's preamble all require listing at or before the time of the gift, and nothing supports a cure by later listing. New fact F54a collects those statements; Open Questions 6 and a new checkout gate 8 now treat pre-listing gifts as not credit-eligible.
6. **F29 and F30 (unsourced labels).** The plain-English names of the credits in sections 21, 22, 24, 25, 25A, 25B, 25C and 25E, and the labels "regular income tax" / "AMT" for sections 1 and 55(a), came from general knowledge. Marked UNVERIFIED (F30) or flagged as not in the sources (F29) and excluded from donor copy. F30a adds Treasury's explanation that these are the credits "that may not be carried forward" and records that section 26(a) itself is not described in the sources.
7. **F9 (title broader than source).** "The SGO does not collect the donor's SSN/TIN" changed to "The rules do not require the SGO to collect ...", with the caveat that the annual report may include other information under future guidance.
8. **F2 (inference marked).** "Citizens qualify regardless of where they live" is now marked as inference, and the gloss "resident alien" was replaced by the regulation's own words; the checkout should take an attestation, not decide residency.
9. **F17 and F18 (softened) and F17a (added).** In F17 "can be made" was replaced with what the IRS page says ("should provide both names"), and a caution added that the combined-payment route appears only on an IRS web page; the proposed regulation's joint example has each spouse contribute and designate. F18's title and text now say the spouse-specific sentence is IRS-web-only while "each donor" is regulation text.
10. **F71 (source characterised).** The recordkeeping statement is the Paperwork Reduction Act description; Prop. Reg. 1.25F-2 has no recordkeeping paragraph. Noted.
11. **Engineering Implications.** Added: notes that the partial-spillover line and the liability-limit line of the pseudo-code are extrapolations or simplifications; a split of the non-creditable amount into "over the cap" and "removed by State credit"; gate 8 (State list submitted); the "derived" label on the $1,700 designation default; four additions to the "must not say" list; three additions to the spec cross-check (date check is not enough for Texas; Revenue Ruling 78-38 is not in the sources; keep the limits attached to "credit equal to qualified contributions").

## Facts added (omissions found in the sources)

- **F8a** advance election, perfection, lapse, one-year scope (TEMP L1751-1754, L1733-1735, L406-414; IRSST L421; IRSPORTAL L43).
- **F17a** combined spouse payment is IRS-web-only.
- **F30a** eight credits "that may not be carried forward"; section 26(a) not reproduced (PROP L735-740).
- **F37a** preamble wording of the deductible remainder (PROP L721-725).
- **F50a** excepted-scholarship rule for substantial contributors (PROP L5665-5675), plus two outcome sentences added to F53 (PROP L5746-5748, L5778-5782).
- **F54a** listing must precede the gift (IRSST L423; TEMP L863-866; PROP L178-183; SGOLIST L36).
- **F56a** Treasury's rejected alternatives on mid-year removal (PROP L3265-3269).
- **F28 addition** Texas Constitution, Article VIII, section 24-a (TXCONST L7851-7853): no tax on individuals' net incomes. Confirms "no Texas individual income tax"; does not settle whether Texas has any other State credit.
- **Status map** two rows added (IRS-web-only items; Texas advance-election status).
- **Open Questions 22-25** added (designated but not claimed; Texas perfection risk; expiry of the temporary regulations; partial State-credit spillover).

## Items that remain UNVERIFIED or not settled by the sources

- Plain-English names of the credits in sections 21 through 25E (F30) and of the taxes in sections 1 and 55(a) (F29): not in any source file.
- Publication 526 timing rules as section 25F rules (F62): section 170 guidance only.
- Revenue Ruling 78-38 (cited in the product spec, Engineering Implications 10): not in any source file.
- Whether Texas offers any State tax credit for contributions to SGOs (F28, Open Questions 7): only the absence of an individual income tax is confirmed.
- The content of section 26(a), section 7701(b), section 6013(g)/(h) and the section 170 requirements: referenced by the sources but not reproduced in them.
- Everything listed under OPEN QUESTIONS / AMBIGUITIES.

## Nothing removed as fabricated

No quote, number, date, form name or field in the original file was found to be invented. The errors found were of emphasis, tagging and scope (items 1-10 above), plus omissions.
