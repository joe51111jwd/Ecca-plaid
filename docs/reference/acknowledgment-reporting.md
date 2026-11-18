# Section 25F research: SGO written acknowledgment, unique donor number, IRS SGO portal, SGO annual reporting, State SGO lists

Research date: 2026-11-18. Scope: drives Piece 1 (donor checkout) acknowledgment/receipt generator, the IRS reporting exports, and the SGO list gate.

Everything below comes from the source files, not from memory. Where the sources are silent the text says **NOT IN SOURCES**.

**Fact-check status (2026-11-18).** An adversarial fact-checker re-verified every quote, line cite, paraphrase and confidence tag against the sources, re-fetched the four IRS pages and the Federal Register API, and edited this file in place. Corrections and additions are marked `[FC]` where they change a rule; the full list is in the VERIFICATION LOG at the end. Facts added by the fact-checker carry an `a` suffix and an `[FC]` mark in the heading (F12a, F39a, F46a, F49a, F69a) so existing fact numbers did not move. F32a is the original author's.

**Read this before using any tag.** `[temporary-reg: in force]` means "regulation text of T.D. 10057". On the research date (2026-11-18) T.D. 10057 is published but its stated effective date is December 1, 2026 (F1). It will be in force before the first creditable gift (January 1, 2027), but copy written before December 1, 2026 must not say the rules "are in effect today". `[proposed-reg: not final]` and any preamble statement about a proposed section (reliance on the IRS SGO list, Form 8525 presumption, spouse treatment, operational report, audit) is NOT settled law and can change in the final regulations.

## Source key

All paths are under `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/`.

| Key | File | What it is |
|---|---|---|
| TD | `sources/temp_regs_TD10057.txt` | Temporary regulations, T.D. 10057, 91 FR 62655 (Oct 2, 2026). Preamble = lines 1-1466; regulation text = lines 1467-2067 |
| NPRM | `sources/proposed_rule_REG-117199-25.txt` | Proposed rule REG-117199-25, 91 FR 62818 (Oct 2, 2026). Regulation text starts near line 4546. The file contains NUL bytes: use `grep -a`, or `tr -d '\000'` first (line numbers are unchanged by that) |
| USC | `sources/usc_25F.txt` | 26 U.S.C. 25F (Cornell LII text) |
| IRS-IND | `sources/irs_fstc_individuals.txt` | IRS page "Federal Scholarship Tax Credit (FSTC) for individuals", https://www.irs.gov/credits-deductions/individuals/federal-scholarship-tax-credit-fstc-for-individuals ("Page Last Reviewed or Updated: 18-Nov-2026", line 428) |
| IRS-ST | `sources/irs_fstc_states.txt` | IRS page "Federal Scholarship Tax Credit (FSTC) - Participating states", https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc-participating-states ("Page Last Reviewed or Updated: 16-Nov-2026", line 459) |
| IRS-HUB | `sources/extra/irs_hub/fstc_hub.txt` | IRS FSTC hub page, https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc (fetched 2026-11-18; HTML footer says "Page Last Reviewed or Updated: 23-Oct-2026"). Raw HTML: `sources/extra/irs_hub/fstc_hub.html` |
| IRS-PORTAL | `sources/extra/irs_hub/fstc_state_portal.txt` | IRS "FSTC State Portal" page, https://www.irs.gov/government-entities/federal-state-local-governments/fstc-state-portal (fetched 2026-11-18; HTML footer says "Page Last Reviewed or Updated: 13-Nov-2026"). Raw HTML: `sources/extra/irs_hub/fstc_state_portal.html` |
| F15714 | `sources/extra/irs_hub/f15714_raw.txt` | Form 15714 (12-2025), text of https://www.irs.gov/pub/irs-pdf/f15714.pdf (fetched 2026-11-18) |
| FRJSON | `sources/fr_proposed.json` | Federal Register API metadata for the proposed rule |
| ECFR | `sources/extra/ecfr_25F/sec_1.25F-4T.xml` | eCFR API response for 26 CFR 1.25F-4T as of 2026-11-16 (fetched 2026-11-18) |
| P526 | `sources/extra/p526_txt/p526_raw.txt` | IRS Publication 526 (2025 returns), text of the PDF another agent saved at `sources/extra/p526.pdf`. It is about section 170, NOT section 25F |
| SGODESK | `sources/sgodesk.txt` | sgodesk.com home page (a competitor's marketing page; secondary) |
| FR-PRA | `sources/extra/factcheck_ack/govinfo_2026-21477.txt` | `[FC]` IRS Paperwork Reduction Act notice, 91 FR 66621 (Oct 21, 2026), FR Doc. 2026-21477, text of https://www.govinfo.gov/content/pkg/FR-2026-10-21/html/2026-21477.htm (fetched 2026-11-18 by the fact-checker). A notice, not a rule |
| FR-HEAR | `sources/extra/factcheck_ack/govinfo_2026-23032.txt` | `[FC]` Notification of change to telephonic-only hearing for REG-117199-25, 91 FR 72837 (Nov 12, 2026), FR Doc. 2026-23032, text of https://www.govinfo.gov/content/pkg/FR-2026-11-12/html/2026-23032.htm (fetched 2026-11-18 by the fact-checker) |
| FR-API | `sources/extra/factcheck_ack/probe_www_federalregister_gov_api_v1_documents_2026_20264_json`, `..._2026_20277_json`, `fr_search_25F.json`, `fr_search_25F_b.json` | `[FC]` Federal Register API responses fetched 2026-11-18 by the fact-checker: document records for the T.D. and the NPRM, and two searches for later section 25F documents |

The fact-checker also saved same-day re-fetches of the four IRS pages (`sources/extra/factcheck_ack/irs_fstc_*_recheck.html`); their body text is identical to the copies cited below.

How each fact is laid out: the bold sentence and the text after it are (a) the plain-English rule; each `Quote [KEY:lines]: "..."` line is (b) the verbatim quote and (c) its source file key and line numbers; the `Confidence` line is (d).

Quote convention: quotes are verbatim; only line-wrap whitespace is collapsed to single spaces and words hyphen-split across a line wrap are rejoined. `[...]` marks an elision. The author machine-checked the original 120 quotes on 2026-11-18 (script: `scripts_ack/verify_quotes.py`, which tolerates a one-line offset). The fact-checker re-checked every quote, including the ones added in the fact-check pass, with an independent script that requires the quote to sit inside the exact cited line range (`verify_ack/vq.py`); two off-by-one line ranges were corrected (F36, F50) and no quote was found to be altered or fabricated. The regulations spell it "acknowledgement"; the IRS hub page spells it "acknowledgment".

## The short version

1. The regulation lists five required elements for the acknowledgement: SGO EIN, the donor's calendar-year total designated as qualified contributions, the unique donor number, a goods-or-services statement, and a description and value estimate if any were provided (F6). A donor may designate only part of a gift; only the designated part counts (F12a).
2. It is due by January 31 of the next calendar year, and can be electronic only with the donor's unwithdrawn consent (F9, F10).
3. Each spouse gets a separate acknowledgement and a separate donor number, per the IRS page (F16). The regulation text itself says only "each donor".
4. The SGO creates the donor number from IRS instructions it can only get after registering in the IRS SGO portal. The number's format is not public (F20 to F23).
5. The SGO reports to the IRS, by February 28 of the next year, through the portal: per donor number, the donor's name, address and aggregate qualified contributions. No SSN (F33, F34, F25).
6. File formats, the portal's URL, corrections, penalties and retention periods are not in any source (F32a, F35, F44).
7. A gift earns the credit only if the SGO is on a covered State's SGO list for that calendar year. 2027 State lists are due February 15, 2027; a State that misses it has no SGOs for 2027; no additions after the deadline; removals can happen any time and cut off later gifts (F51, F52, F58, F59, F68). An advance election is not final: a State on today's IRS list can still drop out for 2027 simply by not filing its SGO list (F49a).
8. The IRS says it will post the IRS SGO list on its Tax Exempt Organization Search page on December 31, 2026. SGOs appear only if they opted in (F64, F65).
9. The IRS page lists 31 States as having made advance elections for 2027, as of November 13, 2026, including Texas (F71). No source shows that any State has filed its SGO list yet.
10. Donors claim the credit on Form 8525 with the SGO and the donor number; the form is not yet published (F73).
11. The donor-side rules (reliance on the IRS SGO list, the Form 8525 presumption, spouses as separate taxpayers) exist only in the PROPOSED regulations and IRS web pages. The temporary regulations cover only SGO registration, acknowledgement, the contribution report, and State elections and lists (F2, F40).

Confidence tags: `[statute]`, `[temporary-reg: in force]`, `[proposed-reg: not final]`, `[preamble/economic-analysis]`, `[IRS web page]`, `[secondary/web]`.

Cross-reference tip: temporary sections end in "T" (1.25F-1T, -4T, -5T). The proposed sections 1.25F-1, -4(b), -4(c), -5 carry substantially the same text; the acknowledgement and contribution-report paragraphs (c)(1) and (c)(2) are word-for-word the same, and the handful of differences elsewhere are listed in F2. Proposed 1.25F-2, 1.25F-3, 1.25F-4(a), (d) and (e) have NO temporary counterpart and are not in force.

---

## FACTS

### A. Which rules are binding today

**F1. The temporary regulations are the binding rules for acknowledgment, donor numbers, SGO registration, the annual contribution report, and State lists.** They are effective December 1, 2026 and apply on or after September 1, 2026. The regulation text says applicability "expires on or before October 1, 2029"; the preamble says they "expire on October 1, 2029". `[FC]` As of the research date (2026-11-18) the effective date has NOT yet arrived (13 days away). Treat the text as the rule to build to, but do not describe it as already in effect in anything shipped before December 1, 2026.
- Quote [TD:46-47]: "Effective date: These temporary regulations are effective on December 1, 2026."
- Quote [TD:1658-1660]: "This section applies on or after September 1, 2026. The applicability of this section expires on or before October 1, 2029."
- Quote [TD:831-832]: "The temporary regulations expire on October 1, 2029."
- Note: as of 2026-11-16 the eCFR shows 26 CFR 1.25F-4T only as a placeholder pointing at the Oct 2, 2026 amendment, and the eCFR version history lists a single version dated 2026-10-02 (file `sources/extra/ecfr_25F/versions_25F4T.json`). I found no correcting amendment. Quote [ECFR:4]: "Link to an amendment published at 91 FR 62668, Oct. 2, 2026."
- `[FC]` Re-check on 2026-11-18: the Federal Register API record for T.D. 10057 (document 2026-20264) returns `"corrections": []`, `"correction_of": null`, `"effective_on": "2026-12-01"`; the record for the NPRM (2026-20277) also returns `"corrections": []` (source key FR-API). The eCFR version API still lists a single 2026-10-02 version for 1.25F-4T and 1.25F-5T. The govinfo HTML of the T.D. is byte-identical to the local `sources/temp_regs_TD10057.htm`, from which the cited `.txt` was made. So no published correction to either document was found as of 2026-11-18.
- Confidence: [temporary-reg: in force] for the text, subject to the December 1, 2026 effective date above; the expiry sentence at TD:831-832 is [preamble/economic-analysis]; eCFR and Federal Register API notes are [secondary/web].

**F2. The proposed regulations repeat the temporary text for these topics, with a few differences, and may be relied on for 2027 gifts if followed in full.** Comments close December 1, 2026; final rules can change any of this.
- Quote [TD:118-120]: "The text of the proposed regulations is identical to the text of the temporary regulations at Sec. Sec. 1.25F-1T, 1.25F-4T(b) and (c), and 1.25F-5T"
- Quote [TD:121-123]: "(except that the temporary regulations cross-reference other provisions of the temporary regulations and do not refer to any provision of the proposed regulations)"
- Quote [NPRM:2406-2413]: "Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent manner."
- Quote [FRJSON:1]: "Written or electronic comments must be received by December 1, 2026."
- `[FC]` Correction: the original said "word for word". That overstates it. A text diff of the temporary sections against the proposed sections (fact-checker script `verify_ack/difftext.py`) shows: (1) paragraphs 1.25F-4(c)(1) and (c)(2) (acknowledgement contents and deadline, contribution report contents and deadline) are identical; (2) 1.25F-1 in the proposed rule has extra definitions that the temporary rule marks "[Reserved]" (disqualified person, eligible student, foster child, qualified digital wallet, qualified elementary or secondary education expense, resident of the United States, school, sibling, State credit, unused credit), while the definitions this topic uses (guidance, IRS SGO list, IRS SGO portal, qualified contribution, cash, State SGO list, timely written acknowledgement) are the same; (3) the proposed text adds cross-references to proposed-only sections 1.25F-2, 1.25F-3 and 1.25F-4(d) and (e); and (4) three additions of substance sit in proposed 1.25F-5(d): a State's public SGO list must also state the donor reliance rule (F56), the IRS SGO list paragraph points to the reliance rule, and the IRS removal ground reads "failed to comply with the requirements in Sec. 1.25F-4" instead of "the applicable reporting, recordkeeping, or audit requirements" (F37).
- Quote [NPRM:6442-6443]: "For donor reliance on the IRS SGO list, see Sec. 1.25F-2(b)."
- `[FC]` The proposed sections would apply only to taxable years ending on or after the final regulations are published; until then they are reliance-only.
- Quote [NPRM:6076-6078]: "This section applies to taxable years ending on or after [date of publication of the final regulations in the Federal Register]."
- `[FC]` The December 15, 2026 public hearing on the proposed rule was changed to telephone-only by a notice published November 12, 2026 (91 FR 72837). The comment deadline did not change.
- Quote [FR-HEAR:40-41]: "The public hearing scheduled to be held on December 15, 2026, at 10 a.m. ET, has been changed to a telephonic-only hearing."
- Confidence: [preamble/economic-analysis] for the reliance statement and for the identical-text statement (both are preamble sentences, not regulation text); the proposed text quotes are [proposed-reg: not final]; the hearing notice is [secondary/web] (official Federal Register notice, not a rule).

**F3. Statutory hook.** The statute itself says nothing about acknowledgments, donor numbers, portals or report deadlines. It delegates recordkeeping and information reporting to Treasury.
- Quote [USC:255-260]: "The Secretary shall issue such regulations or other guidance as the Secretary determines necessary to carry out the purposes of this section, including regulations or other guidance— (1) providing for enforcement of the requirements under subsections (d) and (g), and (2) with respect to recordkeeping or information reporting for purposes of administering the requirements of this section."
- Confidence: [statute]

**F4. "Guidance" can arrive inside the portal itself.** Several rules carry a guidance override (`[FC]` exact wordings: "Except to the extent otherwise provided in guidance" at TD:1576 for registration; "Unless otherwise provided in guidance" at TD:1654 for the report channel; "Except to the extent provided otherwise in guidance" at TD:1959 for late additions to a State list; the original put a paraphrase in quotation marks). Guidance includes forms, instructions and publications on irs.gov and material delivered through the two IRS portals. Engineers must expect rule details (for example the donor number format) to exist only behind the SGO's portal login.
- Quote [TD:1481-1486]: "The term guidance means guidance published in the Federal Register or Internal Revenue Bulletin (see Sec. Sec. 601.601(d)(2) and 601.602 of this chapter) or, as appropriate, in forms, instructions, and publications available on https://www.irs.gov and through the IRS SGO portal or IRS State section 25F portal, as applicable."
- Confidence: [temporary-reg: in force]

### B. The timely written acknowledgement (SGO to donor)

**F5. Definition.** The "timely written acknowledgement" is the written acknowledgement the SGO must give donors for qualified contributions made during a calendar year.
- Quote [TD:1557-1560]: "The term timely written acknowledgement means the written acknowledgement an SGO must provide to donors with respect to qualified contributions made during the calendar year in accordance with Sec. 1.25F-4T(c)(1)."
- Confidence: [temporary-reg: in force]

**F6. Required contents: five listed elements.** (A) the SGO's EIN; (B) the total amount the donor gave the SGO during the calendar year and designated as qualified contributions; (C) the unique donor number the SGO created for that donor; (D) a statement whether or not the SGO provided any goods or services in consideration for any of those contributions; (E) a description and good-faith estimate of the value of those goods or services, if any. `[FC]` The regulation says the acknowledgement "includes the following information", so the five are a required minimum; nothing in the text forbids adding other content (F7), and future guidance can add requirements (F4).
- Quote [TD:1616-1631]: "An organization must provide a timely written acknowledgement to each donor that includes the following information: (A) The organization's EIN; (B) The total amount of contributions made by the donor to the organization during the calendar year that the donor designated as qualified contributions; (C) The unique donor number the organization created for the donor in accordance with paragraph (b)(4) of this section; (D) A statement as to whether or not the organization provided any goods or services in consideration, in whole or in part, for any qualified contributions made by the donor to the SGO during the calendar year; and (E) A description and good faith estimate of the value of any goods or services described in paragraph (c)(1)(i)(D) of this section, if any."
- Confidence: [temporary-reg: in force]

**F7. What the regulation does NOT require on the acknowledgement.** The regulation text does not list the donor's name, the donor's address, the SGO's name, the date of each gift, a per-gift breakdown, the State account a multistate gift was allocated to, a signature, or any IRS form number. Stakeholders asked for a standardized form with name, address, SGO name, EIN and amount; the regulation adopted its own five-element list instead. No IRS-issued standard acknowledgement form or template appears anywhere in the sources: **NOT IN SOURCES**. The burden table assumes each SGO drafts its own template.
- Quote [TD:288-291]: "Many stakeholders recommended that SGOs provide a standardized donor acknowledgement form to taxpayers that would include the donor's name and address, the name of the SGO and its EIN, and the amount of the qualified contribution."
- Quote [TD:1247-1249]: "Collection--Drafting Template for Acknowledgement and unique ID generation process"
- Confidence: [preamble/economic-analysis] for the stakeholder history; the absence is read from [temporary-reg: in force] text at TD:1616-1631.

**F8. One preamble passage lists the contents without the EIN. The regulation text controls.** The Paperwork Reduction Act summary omits the EIN; the operative text (F6) and the main preamble (TD:298-305) both include it. Build to F6.
- Quote [TD:1135-1141]: "The timely written acknowledgement must include the total amount of contributions made by the donor, the unique donor number the SGO created for the donor (pursuant to Sec. 1.25F-4T(b)(4)), and a statement as to whether or not the SGO provided any goods or services in consideration, in whole or in part, for any qualified contributions made by the donor and if so, a description and good faith estimate of the value of any goods or services."
- Confidence: [preamble/economic-analysis]

**F9. Deadline: no later than January 31 of the calendar year after the calendar year of the gift.** For gifts made in calendar year 2027 the deadline is January 31, 2028 (a Monday; derived, not quoted). The rule keys on the calendar year, not the SGO's or donor's fiscal year. Nothing in the sources addresses a weekend or holiday roll-forward, an extension, or a penalty amount for lateness: **NOT IN SOURCES**. "No later than" means earlier delivery is allowed.
- Quote [TD:1632-1635]: "An organization must provide the timely written acknowledgement no later than January 31 of the calendar year following the calendar year in which a donor made a qualified contribution to the organization."
- Quote [IRS-IND:418]: "Obtain a timely written acknowledgement, which will be provided by the SGO on or before January 31 of the year following the year the qualified contribution is made."
- Confidence: [temporary-reg: in force]; [IRS web page]

**F10. Delivery: paper or any other form acceptable to the donor. Electronic delivery is allowed only if the donor consents and has not withdrawn consent before the acknowledgement is furnished.** The sources give no required wording, format, disclosure list, or withdrawal mechanism for that consent: **NOT IN SOURCES**. The IRS anticipates that most acknowledgements will be electronic and fewer than 1% on paper (a burden estimate, not a rule). `[FC]` Two preamble summaries (TD:1141-1143 and NPRM:3979-3981) say "including by electronic delivery" without repeating the consent condition; the regulation text below controls, so consent is required.
- Quote [TD:1635-1639]: "The timely written acknowledgement can be provided in writing or in any other form acceptable to the donor, including by electronic delivery if the donor consents to receive the statement electronically and does not withdraw the consent before the statement is furnished."
- Quote [TD:1192-1194]: "The IRS anticipates that most acknowledgements will be issued electronically to contributors and less than 1% may be issued as a paper version."
- Confidence: [temporary-reg: in force]; burden footnote is [preamble/economic-analysis]

**F11. The amount is an annual, per-donor, per-SGO total.** Element (B) is the total the donor gave "to the organization during the calendar year" and designated. So one acknowledgement covers all of a donor's designated gifts to that SGO in that calendar year. Whether an SGO may satisfy the rule with an acknowledgement issued at the time of each gift (before year-end), or must reissue a year-end total if the donor gives again: **NOT IN SOURCES**.
- Quote [TD:1620-1622]: "(B) The total amount of contributions made by the donor to the organization during the calendar year that the donor designated as qualified contributions;"
- Confidence: [temporary-reg: in force]

**F12. Designation must happen at the time of the gift and is irrevocable.** A gift is a qualified contribution only "to the extent" the donor designates it to the SGO when making it. Neither donor nor SGO may revoke. A designated gift must go into the section 25F segregated account whether or not the donor ends up getting a credit.
- Quote [TD:1514-1519]: "The term qualified contribution means a charitable contribution of cash made by an individual to an SGO to the extent that the donor designates to the recipient SGO, at the time of making the contribution, that the contribution is intended to be a qualified contribution for purposes of section 25F. Such designation, once made, is irrevocable."
- Quote [NPRM:858-864]: "A contribution designated by a donor as a qualified contribution would need to be deposited in this section 25F segregated account regardless of whether the donor ultimately receives a tax credit for the qualified contribution. Once a qualified contribution is designated as such by a donor, neither the donor nor the recipient organization would be permitted to revoke such designation to reduce administrative burden and provide certainty."
- Quote [IRS-IND:415]: "Make a qualified contribution of cash to an approved SGO. Tell the SGO your payment is a section 25F qualified contribution."
- Confidence: [temporary-reg: in force]; NPRM passage is [preamble/economic-analysis]; [IRS web page]

**F12a. `[FC]` A donor may designate only part of one payment. Only the designated part is a qualified contribution, and only that part belongs in acknowledgement element (B) and in the IRS report.** The temporary definition says "to the extent that the donor designates" (F12). The proposed rule gives a worked example: a $4,000 payment of which the donor designates $1,700; the other $2,300 is a "non-qualified contribution" to the same SGO. The checkout must therefore store a designated amount separately from the payment amount, and must not assume they are equal. The example is in the proposed rule only.
- Quote [NPRM:5209-5213]: "(4) Example 4: Taxpayer designates less than the entire contribution as a qualified contribution--(i) Facts. In January 2027, Taxpayer E contributes $4,000 to Org X. E designates $1,700 as a qualified contribution and receives a timely written acknowledgement in accordance with Sec. 1.25F-4(c)."
- Quote [NPRM:5223-5225]: "E's $400 State credit is treated as being allowed first from the $2,300 non-qualified contribution to the SGO, so the $1,700 qualified contribution is not reduced by the $400 State credit."
- Confidence: [proposed-reg: not final] for the example; the "to the extent" wording is [temporary-reg: in force]

**F13. Goods or services reduce the qualified contribution.** If the SGO gives the donor anything in exchange, its value is subtracted from the qualified contribution, and the acknowledgement must describe it and estimate its value in good faith (F6 (D), (E)). The statement in (D) is required either way ("whether or not").
- Quote [TD:1521-1524]: "If the SGO provides any goods or services as consideration for any part of the contribution, then the value of those goods and services must be subtracted from the amount of the charitable contribution to arrive at the amount of the qualified contribution."
- Confidence: [temporary-reg: in force]

**F14. "Cash" covers card and electronic payments in U.S. dollars; digital assets are excluded.**
- Quote [TD:1527-1530]: "(A) Means physical currency, check, money order, electronic transfer, after-tax payroll deduction, or other similar method, in each case all in U.S. dollars, and (B) Does not mean any digital asset."
- Quote [TD:182-183]: "electronic transfer (including, for example, by credit or debit card)"
- Confidence: [temporary-reg: in force]; the card example is [preamble/economic-analysis]

**F15. Only individuals. The donor is the individual who makes the gift.** The qualified contribution definition says "made by an individual" (F12). The proposed rule bars counting gifts made through partnerships or S corporations. `[FC]` The sources name only partnerships and S corporations. They do not mention donor-advised funds, trusts, estates, C corporations or employer matching gifts: **NOT IN SOURCES**. Excluding those from the credit-designated path is a cautious reading of "made by an individual", not a quoted rule.
- Quote [NPRM:5054-5058]: "A partner may not take into account such partner's distributive share of the partnership's charitable contributions to an SGO in determining the amount of the partner's qualified contributions under section 25F and paragraph (a) of this section."
- Quote [NPRM:5058-5063]: "Similarly, a shareholder of an S corporation may not take into account such shareholder's pro rata share of the S corporation's charitable contributions to an SGO in determining the amount of the shareholder's qualified contributions under section 25F and paragraph (a) of this section."
- Confidence: [temporary-reg: in force] for "made by an individual"; [proposed-reg: not final] for the partnership and S corporation rule

**F16. Each spouse gets a separate acknowledgement and a separate unique donor number.** This sentence is on the IRS individuals page; the regulation text says only "each donor". The proposed rule treats spouses filing jointly as separate taxpayers, and its joint example has each spouse contribute and each receive an acknowledgement.
- Quote [IRS-IND:418]: "Each spouse should receive a separate timely written acknowledgement with their own unique donor number."
- Quote [NPRM:5050-5053]: "For purposes of section 25F(b)(1), married taxpayers who elect to file a joint return under section 6013(a) and Sec. 1.6013-1(a) are treated as separate taxpayers."
- Quote [NPRM:5175-5178]: "B and C each contribute $2,000 to Org X. Each designates the entire amount of their contribution as a qualified contribution and each receives a timely written acknowledgement in accordance with Sec. 1.25F-4(c)."
- Confidence: [IRS web page] for the separate-acknowledgement sentence; [proposed-reg: not final] for separate-taxpayer treatment

**F17. A single combined payment from both spouses is contemplated, if both names are given and the SGO is told the gift is for both.** How to split one combined payment between the two spouses when they do not say (for example 50/50), and whether an uneven split is allowed: **NOT IN SOURCES**. The only example is $3,400 combined.
- Quote [IRS-IND:416]: "If spouses who will be filing a married filing jointly tax return make simultaneous qualified contributions (e.g., a combined $3,400 qualified contribution on behalf of both spouses), they should provide both names to the SGO and indicate to the SGO the donation is on behalf of both spouses."
- Confidence: [IRS web page]

**F18. The acknowledgement is the donor's backup proof.** Under the proposed rule, a donor who leaves the donor number off Form 8525 is presumed not to have made the gift, and can rebut that by sending the IRS the timely written acknowledgement that shows the number. The temporary regulation separately says SGO compliance with the acknowledgement and reporting rules is "a necessary part of substantiating" the donor's credit.
- Quote [NPRM:5143-5152]: "A taxpayer that does not provide the required donor number(s) on the taxpayer's Form 8525, Federal Scholarship Tax Credit (or successor form), will be presumed not to have made a qualified contribution to that SGO. However, this presumption may be rebutted by the taxpayer's submission of the timely written acknowledgement from the SGO that includes such unique donor number or other evidence satisfactory to the Commissioner of the amount of the contribution(s) from the taxpayer and the fact that the contributions were designated as qualified contributions, all within the response time prescribed in a written request from the IRS."
- Quote [TD:1590-1595]: "Until the organization has registered in the IRS SGO portal, the organization will not be able to comply with the acknowledgement and reporting requirements in paragraph (c) of this section, and that compliance is a necessary part of substantiating that a donor's qualified contribution is eligible for the credit allowed under section 25F."
- Confidence: [proposed-reg: not final]; [temporary-reg: in force]

**F19. The existing section 170 acknowledgment rule still exists alongside this one.** Treasury notes SGOs, as 501(c)(3) charities, already must give a contemporaneous written acknowledgment for gifts of $250 or more. The part of a gift for which no section 25F credit is allowed may be deductible under section 170 if section 170's rules are met. The section 25F sources do not say whether one document can serve as both the section 25F acknowledgement and the section 170 acknowledgment: **NOT IN SOURCES**. Publication 526 (a section 170 document, written for 2025 returns, silent on section 25F) says a section 170 acknowledgment that covers several $250+ gifts must list each gift and its date.
- Quote [NPRM:3715-3719]: "As SGOs are section 501(c)(3) charitable organizations, these organizations are already required to provide a contemporaneous written acknowledgment for contributions of $250 or more and may be required to report information concerning certain substantial contributors to the IRS."
- Quote [NPRM:5130-5133]: "Any portion of a qualified contribution for which a credit under section 25F is not allowed may be deductible as a charitable contribution if it meets the requirements of section 170 and the regulations thereunder."
- Quote [P526:2858-2861]: "If you made more than one contribution of $250 or more, you must have either a separate acknowledgment for each or one acknowledgment that lists each contribution and the date of each contribution and shows your total contributions."
- Confidence: [preamble/economic-analysis]; [proposed-reg: not final]; P526 is [secondary/web] for section 25F purposes

### C. The unique donor number

**F20. What it is.** A number the SGO creates, following IRS instructions, for each donor who designated at least one payment to that SGO as a qualified contribution during the calendar year. All SGOs use one uniform format.
- Quote [TD:1609-1614]: "The IRS will review the registration submission to verify that all the required information has been submitted and will provide the organization with instructions for creating a unique donor number for each donor who has designated at least one payment to the organization as a qualified contribution to the SGO during the calendar year."
- Confidence: [temporary-reg: in force]

**F21. The SGO generates it, not the IRS and not the donor.** The IRS supplies instructions; the SGO creates the number. A donor who gives to two SGOs gets two different numbers.
- Quote [TD:1623-1624]: "(C) The unique donor number the organization created for the donor in accordance with paragraph (b)(4) of this section;"
- Quote [NPRM:792-795]: "Because each SGO will be generating its own unique donor numbers, a taxpayer making qualified contributions to more than one SGO would receive a different donor number from each SGO."
- Confidence: [temporary-reg: in force]; NPRM passage is [preamble/economic-analysis]

**F22. No number can exist until the SGO has registered in the IRS SGO portal.** The instructions for creating the number are released only after registration.
- Quote [TD:262-268]: "Because an organization will not be able to generate the unique donor number to provide to a donor until the organization registers in the IRS SGO portal, and because a donor will need that unique donor number to substantiate a qualified contribution, Sec. 1.25F-4T(b)(2) requires an organization to complete the registration process with the IRS as soon as possible and preferably before the organization appears on any State SGO list."
- Confidence: [preamble/economic-analysis] restating [temporary-reg: in force] text at TD:1588-1595

**F23. Format: NOT IN SOURCES.** No source states the length, character set, prefix, check digit, whether the SGO's EIN is embedded, or whether the number is sequential. The only description is "a uniform format to be used by all SGOs", delivered through the portal instructions.
- Quote [TD:1491-1497]: "The term IRS SGO portal consists of the module(s) on https://www.irs.gov that an SGO is required by Sec. 1.25F-4T(b) to use, in accordance with the instructions provided therein, to electronically obtain instructions for creating a unique donor number in a uniform format to be used by all SGOs, authorize disclosure of its name and identifying information on the IRS SGO list, and report specified information."
- Confidence: [temporary-reg: in force]

**F24. Same number every year, or a new one each year? NOT IN SOURCES.** The text ties the number to a donor who designated a payment "during the calendar year" (F20) and the report is "with respect to each unique donor number assigned" for the calendar year (F33). Neither says whether a returning donor keeps the prior year's number.
- Confidence: n/a (gap)

**F25. Why it exists: it replaces the SSN. SGOs are not asked to collect or report a donor's taxpayer identification number.** The IRS will match SGO reports to tax returns using the donor number. `[FC]` This is a statement of Treasury's design intent in the preambles, not a prohibition in the regulation text. The required report fields (F33) contain no TIN, but both the registration and the report rules reserve "any other information the IRS deems necessary" for future guidance, so a later change cannot be ruled out.
- Quote [NPRM:3712-3714]: "The use of the donor number avoids the need to have SGOs collect and report each donor's taxpayer identification number, such as a social security number."
- Quote [NPRM:774-778]: "The Treasury Department and the IRS share the stakeholders' concern that requiring taxpayers to provide TINs to SGOs when making a qualified contribution would be burdensome, could chill an individual's desire to make contributions to an SGO, and might result in unnecessary exposure of sensitive taxpayer information."
- Quote [TD:927-929]: "In addition, the IRS must establish systems to facilitate matching of reported qualified contributions against individual income tax returns."
- Confidence: [preamble/economic-analysis]

**F26. Treasury expects SGOs to build a generation and tracking process.**
- Quote [TD:1186-1190]: "The IRS anticipates that SGOs already have procedures in place to generate acknowledgements to donors for other purposes, but the IRS anticipates SGOs will need some time to create a process for generating and tracking the unique donor number and including that number in the acknowledgement."
- Confidence: [preamble/economic-analysis]

### D. The IRS SGO portal and SGO registration

**F27. What the portal is and does.** It is one or more modules on irs.gov with three functions: get the donor number instructions, authorize the IRS to publish the SGO on the IRS SGO list, and file reports. The IRS hub page calls it the "FSTC SGO Portal". (Definition quoted at F23.)
- Quote [IRS-HUB:41]: "Once qualified, SGOs must meet ongoing financial, recordkeeping, donor acknowledgment, and IRS reporting requirements, including registering and reporting through the FSTC SGO Portal."
- Confidence: [temporary-reg: in force]; [IRS web page]

**F28. Who must register.** Any organization that plans to solicit qualified contributions. Registration is electronic only.
- Quote [TD:1576-1579]: "Except to the extent otherwise provided in guidance, an organization that plans to solicit qualified contributions must electronically register through the IRS SGO portal in accordance with the instructions provided therein."
- Confidence: [temporary-reg: in force]

**F29. When.** "As soon as possible and preferably before" the organization appears on any State SGO list. Being on a State list is therefore not a stated prerequisite to registering. The good-cause statement describes registration as something completed before January 1, 2027. No hard registration deadline date appears in the regulation text: **NOT IN SOURCES**.
- Quote [TD:1588-1590]: "An organization must register with the IRS as soon as possible and preferably before the organization appears on any State SGO list."
- Quote [TD:899-902]: "The first step in an SGO creating standardized unique donor numbers is an electronic registration process that is completed through the IRS SGO portal before January 1, 2027."
- `[FC]` The temporary rule's trigger is an organization "that plans to solicit qualified contributions" (F28). The proposed rule's overview paragraph, which has no temporary counterpart, describes the duty as falling on each organization "that receives an amount designated as a qualified contribution". Either way, an SGO taking designated gifts through this product must be registered.
- Quote [NPRM:5792-5795]: "Paragraph (b) of this section provides that each organization that receives an amount designated as a qualified contribution must complete a mandatory registration process through the IRS SGO portal."
- Confidence: [temporary-reg: in force]; second quote [preamble/economic-analysis]; third quote [proposed-reg: not final]

**F30. Information the SGO must supply to register.** Name, EIN, address, telephone number, year of formation; a contact person who can legally bind the organization or holds a Form 2848 power of attorney; the organization's taxable year; anything else the IRS adds in guidance.
- Quote [TD:1599-1608]: "(i) The organization's name, IRS employer identification number (EIN), address, telephone number, and year of formation; (ii) The name of a person whom the IRS may contact if there is an issue with the registration, and who either possesses legal authority to bind the organization or provides a properly executed power of attorney on Form 2848, Power of Attorney and Declaration of Representative; (iii) The organization's taxable year; and (iv) Any other information the IRS deems necessary for purposes of administering the requirements of section 25F as provided in guidance."
- Confidence: [temporary-reg: in force]

**F31. After registration the IRS checks completeness and releases the donor number instructions.** (Quoted at F20.) The sources give no turnaround time: **NOT IN SOURCES**.
- Confidence: [temporary-reg: in force]

**F32. Listing on the public IRS SGO list is opt-in, per calendar year.** The SGO must authorize disclosure under section 6103(c) for a calendar year, through the portal, if it wants to be published for that year. The preamble says "periodically authorize".
- Quote [TD:1583-1587]: "An organization must authorize disclosure in accordance with section 6103(c) of its name and identifying information on the IRS SGO list for a calendar year if the organization wants the IRS to publish such information on the IRS SGO list for that year."
- Quote [TD:256-259]: "The organization also uses the IRS SGO portal to periodically authorize disclosure of the organization's name and identifying information on the IRS SGO list for a calendar year, available on https://www.irs.gov."
- Confidence: [temporary-reg: in force]; second quote [preamble/economic-analysis]

**F32a. Portal mechanics: NOT IN SOURCES.** The portal's URL, opening date, sign-in method, file upload format, any API, bulk upload, size limits, and whether a software vendor can act for an SGO are not in any source. On 2026-11-18 the IRS hub page named the SGO portal but linked no page for it, and my guessed irs.gov URLs for an SGO portal page returned 404. (The State portal, by contrast, has a public page and a sign-in at `https://sa.www4.irs.gov/tpip/fstc/state`, IRS-PORTAL line 7.)
- `[FC]` Confirmed on re-fetch 2026-11-18: the hub page's "Resources for SGOs" block links only to Tax Exempt Organization Search and Charities & Nonprofits, with no SGO portal link; two guessed SGO-portal URLs on irs.gov returned HTTP 404. The author's own 404 probes could not be reproduced exactly because the URLs tried were not recorded. The regulation's only statement about location is that the portal "consists of the module(s) on https://www.irs.gov" (F23).
- Confidence: n/a (gap)

### E. The annual contribution report (SGO to IRS)

**F33. Data elements: one record per unique donor number, with exactly these fields.** Donor's name; donor's address; aggregate amount of qualified contributions that donor made to the SGO during the calendar year; plus anything the IRS adds in future guidance. No TIN, no gift dates, no per-gift rows are required by the text.
- Quote [TD:1640-1650]: "An organization must annually report to the IRS the following information with respect to each unique donor number assigned by the organization as set forth in paragraph (b)(4) of this section: (A) The donor's name; (B) The donor's address; (C) The aggregate amount of qualified contributions made by the donor to the organization during the calendar year; and (D) Any other information the IRS deems necessary for purposes of administering the requirements of section 25F as may be described in future guidance."
- Confidence: [temporary-reg: in force]

**F34. Deadline: no later than February 28 of the year after the gifts. Channel: the IRS SGO portal, unless guidance says otherwise.** For calendar year 2027 gifts that is February 28, 2028 (a Monday; derived). 2028 is a leap year, so the deadline is February 28, not the last day of February. No weekend rule, extension, or late penalty is stated: **NOT IN SOURCES**.
- Quote [TD:1651-1656]: "An organization must report the information described in paragraph (c)(2)(i) of this section no later than February 28 of the year following the year in which such qualified contributions were made. Unless otherwise provided in guidance, the reporting must be done through the IRS SGO portal in accordance with the instructions provided therein."
- Confidence: [temporary-reg: in force]

**F35. File format, field names, corrections and amendments: NOT IN SOURCES.** No source describes a file layout, a form number for this report, how to correct a submitted report, or how to report a refund or reversal after submission. The only description is "through the IRS SGO portal in accordance with the instructions provided therein".
- Confidence: n/a (gap)

**F36. Purpose and matching.** The IRS will check the report against returns that claim the credit, and wants early detection of mismatches.
- Quote [TD:1159-1166]: "This information is necessary to allow the IRS to validate donor information collected by SGOs against filed tax returns claiming the section 25F credit. Availability of this information through the portal may facilitate earlier identification and resolution of discrepancies between filed returns and SGO data, allowing for timelier resolution of any disparities and limiting duplication, fraud, or abuse in the operation of the credit."
- Confidence: [preamble/economic-analysis]

**F37. Consequence of not reporting: the IRS may remove the SGO from the IRS SGO list.** Under the proposed rule, satisfying section 1.25F-4 is also part of the definition of an SGO, and the proposed annual certification includes a statement that every donor got a timely written acknowledgement.
- Quote [TD:1989-1995]: "The IRS may remove an organization from the IRS SGO list following a determination that the organization has failed to comply with a requirement of section 25F (other than the tax-exempt status requirement in section 25F(c)(5)(A)) or has failed to comply with the applicable reporting, recordkeeping, or audit requirements, including a failure to report qualified contributions in accordance with Sec. 1.25F-4T(c)."
- Quote [NPRM:5320-5321]: "(6) Satisfies the reporting and recordkeeping requirements in Sec. 1.25F-4."
- Quote [NPRM:5919]: "(F) Provided each donor a timely written acknowledgement; and"
- `[FC]` Why the proposed definition matters to donors: if final regulations keep proposed 1.25F-3(b)(6), an organization that fails the acknowledgement or reporting rules would fall outside the definition of an SGO. What that would do to credits already claimed by its donors is not addressed: **NOT IN SOURCES** (the proposed reliance rule, F67, is the only donor protection described). The IRS removal decision is appealable by the SGO (F60).
- Confidence: [temporary-reg: in force]; NPRM items [proposed-reg: not final]

**F38. Expected scale.** Treasury's planning numbers: 600 to 700 SGOs, 11 million contributors, about 16,923 contributors per SGO per year. Size exports and batch jobs for tens of thousands of donor rows per SGO.
- Quote [TD:1198-1200]: "SGOs will give information to multiple contributors each year (11 million total contributors divided by 650 SGOs = approximately 16,923 contributors per SGO per year)."
- Confidence: [preamble/economic-analysis]

**F39. Paperwork control number.** Registration, the acknowledgement and the annual contribution report sit under OMB control number 1545-2335.
- Quote [TD:1166-1168]: "This annual reporting will be approved by OMB under control number 1545-2335 pursuant to the emergency procedures in 5 CFR 1320.13"
- Confidence: [preamble/economic-analysis]

**F39a. `[FC]` The IRS's own paperwork notice for control number 1545-2335 lists only one form number, Form 15714 (the State advance election). It lists no IRS form number for the acknowledgement or for the annual contribution report.** This supports F7 and F35: as of October 21, 2026 there is no numbered IRS form for either. The notice says the collection is unchanged from the emergency approval, covers SGO portal registration, reporting, recordkeeping, third-party disclosure and "timely written acknowledgments to donors", and takes comments until December 21, 2026. The notice does not describe file layouts or the portal.
- Quote [FR-PRA:70-73]: "OMB Control Number: 1545-2335. Form Number: 15714. Regulation Project Number: Treasury Decision 10057, Revenue Procedure 2026-6."
- Quote [FR-PRA:88-92]: "In addition, T.D. 10057 provides procedures for registering SGOs through an IRS electronic SGO portal; reporting, recordkeeping, and third-party disclosure of qualified contributions received by SGOs; and providing timely written acknowledgments to donors."
- Quote [FR-PRA:93-95]: "Current Actions: There is no change to the previously approved information collection. Type of Review: Extension of a currently approved collection."
- Quote [FR-PRA:31-32]: "DATES: Written comments should be received on or before December 21, 2026 to be assured of consideration."
- Confidence: [secondary/web] (an official IRS Federal Register notice, 91 FR 66621; not a rule and not part of the two primary rule documents)

### F. Proposed-only SGO reporting (not in the temporary regulations)

**F40. The temporary regulation reserves paragraphs (a), (d) and (e) of section 1.25F-4T.** The operational report and the audit below exist only in the proposed rule.
- Quote [TD:1574]: "(a) [Reserved]"
- Quote [TD:1657]: "(d) and (e) [Reserved]"
- Confidence: [temporary-reg: in force]

**F41. Proposed annual certification and operational report (proposed 1.25F-4(d)).** An organization on a State SGO list for any part of a calendar year within its taxable year would certify compliance (including item (F), acknowledgements delivered) and report these items for its taxable year: number of students who applied; number selected under the 1.25F-3(c)(6)(iii)(C) safe harbor; number of scholarships awarded; highest, lowest and average scholarship; number of schools attended by recipients; aggregate data by category of qualified expense; the organization's income; total spent on scholarships in-State and how much counts toward the prior-year and current-year 90 percent tests; percentage of prior-year income spent; percentage of current-year income spent; anything else in guidance (NPRM:5971-5999). Multistate SGOs report separately per State account (NPRM:6005-6009). `[FC]` Precision: the item list at NPRM:5971-5999 is written for a single-State SGO reporting at the organization level; a single-State SGO using the proposed 1.25F-3(c)(2) safe harbor reports the same items for its section 25F segregated account instead (NPRM:6000-6004). This report runs on the SGO's taxable year, unlike the acknowledgement and the contribution report, which run on the calendar year. None of this is in the temporary regulations, and the proposed section would apply only to taxable years ending on or after publication of final regulations (F2).
- Quote [NPRM:5888-5891]: "An organization that has been included on a State SGO list for any part of a calendar year within its taxable year must annually provide a certification and certain information to the IRS."
- Confidence: [proposed-reg: not final]

**F42. Proposed timing and channel for that operational report.** At the time and in the manner the IRS prescribes; attached to the annual information return (Form 990 series) if the organization must file one; otherwise filed separately by the 15th day of the 5th month after the period closes; a copy goes to each State that lists the SGO. The form's name or number is **NOT IN SOURCES**.
- Quote [NPRM:6010-6022]: "Except to the extent otherwise provided in guidance, the certification and information required by paragraphs (d)(2) and (3) of this section must be provided at such time and in such manner as the IRS may prescribe by publication, form, or instructions. For organizations required to file an annual information return under section 6033(a), the required form must be included as an attachment. An organization that is not required to file an annual information return under section 6033(a) must provide this form separately to the IRS on or before the 15th day of the 5th calendar month following the close of the period for which the form reports the required certifications and information. Organizations must concurrently provide a copy of the form to each State on whose State SGO list the organization appears in accordance with guidance."
- Confidence: [proposed-reg: not final]

**F43. Proposed annual audit (proposed 1.25F-4(e)).** Annual financial and programmatic audit by a qualified independent third party, results to each listing State; organizations with total receipts of $500,000 or less may use a committee of independent persons, report signed under penalties of perjury (NPRM:6029-6042).
- Quote [NPRM:6023-6027]: "Each organization that was an SGO during any part of the preceding taxable year must undergo an annual financial and programmatic audit by a qualified independent third party and provide the audit results to each covered State on whose State SGO list the SGO appeared"
- Confidence: [proposed-reg: not final]

### G. Recordkeeping

**F44. No section 25F-specific retention period or record list exists for contribution records.** The temporary regulation is titled "Reporting and recordkeeping requirements for SGOs" but its operative paragraphs are registration, acknowledgement and reporting. The preamble classes the underlying records as general tax records under section 1.6001-1(e) and gives the general standard: keep records as long as they may be material to tax administration. A number of years is **NOT IN SOURCES**.
- Quote [TD:1122-1129]: "The collections of information in Sec. 1.25F-4T(c) include recordkeeping requirements related to the section 25F credit. An SGO will use these records to enable it to provide the donor with a timely written acknowledgement of a contribution and to report to the IRS the necessary information about qualified contributions made by the donor to the SGO during the calendar year. These recordkeeping requirements are considered general tax records under Sec. 1.6001-1(e)."
- Quote [TD:1006-1008]: "Books or records relating to a collection of information must be retained if their contents may become material in the administration of any Internal Revenue law."
- Quote [NPRM:1586-1589]: "Proposed Sec. 1.25F-4 would provide reporting and recordkeeping requirements for organizations for purposes of section 25F that supplement the general recordkeeping requirements under section 6001 imposed on all persons liable for a tax imposed under Title 26."
- Confidence: [preamble/economic-analysis]

**F45. Segregated-account books.** A State must certify, for each listed SGO, that the SGO deposits all qualified contributions into its section 25F segregated account and keeps a complete set of books and records for that account. The checkout ledger feeds those books.
- Quote [TD:1858-1863]: "The organization prevents the co-mingling of qualified contributions with other amounts by maintaining a section 25F segregated account, which must contain only qualified contributions and the earnings therefrom, depositing all qualified contributions into its section 25F segregated account and maintaining a complete set of books and records for its section 25F segregated account;"
- Confidence: [temporary-reg: in force]

**F46. Donors must keep their own records too.**
- Quote [NPRM:4068-4072]: "Proposed Sec. 1.25F-2 would require the taxpayer to keep records of any information needed to calculate the amount of any section 25F credit from the taxpayer's qualified contributions (including any State credit the taxpayer will take on the taxpayer's State tax return with regard to the taxpayer's qualified contributions)"
- `[FC]` Tag note: this is a preamble description of a PROPOSED section; proposed 1.25F-2 has no temporary counterpart.
- Confidence: [preamble/economic-analysis] (describing a proposed rule; not final)

**F46a. `[FC]` The proposed rule would also make SGOs track each contributor's yearly total against a "substantial contributor" test, with spouses' gifts combined.** This is a second, proposed-only reason the donor ledger must total gifts per person per SGO taxable year and must link spouses. A person who gave more than $5,000 in the SGO's taxable year, where that is more than 2 percent of total contributions received (tested for the SGO and separately for a section 25F segregated account), would be a "disqualified person" who cannot be awarded a scholarship. The test covers all contributions, not only designated ones. Detail belongs to the disqualified-person topic; it is flagged here only because the checkout ledger is the data source.
- Quote [NPRM:5652-5657]: "(2) Substantial contributor--(i) In general. The term substantial contributor means any person who contributed an aggregate amount of more than $5,000 to the SGO during the taxable year, if such amount is more than 2 percent of the total contributions received by the SGO during the taxable year. For this purpose, an individual will be treated as making all contributions made by his or her spouse."
- Quote [NPRM:4016-4021]: "records to allow an SGO to verify whether the amount that any person, who contributed an aggregate amount of more than $5,000 to the organization during the taxable year, contributed more than 2 percent of the total contributions received by the organization through the end of the taxable year."
- Confidence: [proposed-reg: not final]; second quote [preamble/economic-analysis]

### H. State election and State SGO lists

**F47. Statute: the State list is due by January 1 each year, "as early as practicable" in the first year, and an organization is an SGO only if it is on the list for the applicable year.**
- Quote [USC:245]: "Not later than January 1 of each calendar year (or, with respect to the first calendar year for which this section applies, as early as practicable), a State that voluntarily elects to participate under this section shall provide to the Secretary a list of the scholarship granting organizations that meet the requirements described in subsection (c)(5) and are located in the State."
- Quote [USC:189]: "which is included on the list submitted for the applicable covered State under subsection (g) for the applicable year."
- Confidence: [statute]

**F48. Definitions.** A "covered State" is one that makes the election for a particular calendar year. The "State SGO list" is the list for a particular calendar year. "State" means the 50 States and D.C. (TD:1545-1546).
- Quote [TD:1477-1479]: "The term covered State means a State that makes a State election, in accordance with Sec. 1.25F-5T(c), to participate under section 25F for a particular calendar year."
- Quote [TD:1552-1556]: "The term State SGO list means the list of all SGOs located in the State that the covered State submits to the IRS for a particular calendar year in accordance with Sec. 1.25F-5T(d) (and that may be changed during such calendar year in accordance with Sec. 1.25F-5T(d)(7))."
- Confidence: [temporary-reg: in force]

**F49. Elections are annual.** Each year needs its own election and its own list.
- Quote [TD:1733-1735]: "The State election is made only for a single calendar year, and all the requirements in this paragraph (c) must be satisfied for each year for which an election is made."
- Confidence: [temporary-reg: in force]

**F49a. `[FC]` An advance election can lapse; a completed election cannot be revoked.** Treasury says a State that made an advance election can "in effect, opt out" by not filing its State SGO list on time, and that once the election is completed (list filed) there is no revocation for that year. For the gate: the 31 States in F71 are advance-election States, and any of them can still end up with no SGOs for 2027 (F52). After a State files its list, the State stays in for the year, though individual SGOs can still be removed (F59, F60).
- Quote [TD:406-414]: "The advance election procedure in Sec. 1.25F-5T(c)(3), discussed in part III.C.2. of this Explanation of Provisions, enables a State to opt in for an upcoming calendar year by making an advance election and then later, in effect, opt out by failing to perfect the election in accordance with Sec. 1.25F-5T(c)(3)(ii). The Treasury Department and the IRS do not interpret section 25F(g) as allowing for any revocation once a State has completed its State election for the year, including an advance election that has been perfected."
- Confidence: [preamble/economic-analysis]

**F50. For 2027 a State must have filed an advance election on Form 15714 on or before January 1, 2027.** Form 15714 carries no SGO list. `[FC]` So a State not on the IRS advance-election list by January 1, 2027 cannot have SGOs for 2027, and the F71 list can still grow until then. For later years the rules differ: a State's first-ever election must be an advance election "as provided in future guidance"; a returning State may either file an advance election between January 2 and September 30 of the prior year, or elect together with its list between October 1 and January 1 (F51).
- Quote [TD:1751-1754]: "For calendar year 2027 only, a State must submit an advance election on Form 15714, Advance Election to Participate Under Section 25F for 2027, on or before January 1, 2027."
- Quote [F15714:139-140]: "An Advance Election through this Form 15714 is effective only for calendar year 2027."
- Quote [F15714:62-63]: "I hereby confirm that this Advance Election does not include any attachments, including any list of scholarship granting organizations or information relating to such organizations."
- Quote [TD:1756-1758]: "(2) Future years. For calendar years after 2027, a State making its first election to participate under section 25F must submit an advance election as provided in future guidance."
- Quote [TD:1744-1748]: "a State may submit an advance election through the IRS State section 25F portal on or after January 2 and on or before September 30 of the calendar year immediately preceding the calendar year for which the election is being made."
- Confidence: [temporary-reg: in force]; [IRS web page] for the form

**F51. The 2027 transition date: a State may provide its 2027 State SGO list on or before February 15, 2027.** In later years the list is due on or before January 1 of the year and not earlier than October 1 of the prior year; "on or before January 1" runs to 11:59 p.m. on January 1 (time zone not stated). `[FC]` The 11:59 p.m. statement was made about the January 1 deadline for years after 2027; no source says what clock time closes February 15, 2027.
- Quote [TD:1767-1768]: "For calendar year 2027 only, a State may provide its State SGO list on or before February 15, 2027."
- Quote [TD:1759-1765]: "If a State has submitted an advance election in accordance with paragraph (c)(3)(i) of this section, the State must perfect its election by providing its State SGO list for a calendar year, with the information and certifications required in paragraph (c)(5) of this section, on or before January 1 of that year, but not earlier than October 1 of the immediately preceding calendar year."
- Quote [TD:498]: "that year'' means up to 11:59 p.m. on January 1."
- Quote [IRS-PORTAL:42-43]: "All participating states must submit their list of SGOs to the IRS by January 1 each year. For 2027: States must submit their list of qualifying SGOs by February 15, 2027."
- Confidence: [temporary-reg: in force]; 11:59 p.m. gloss is [preamble/economic-analysis]; [IRS web page]

**F52. If a State misses the list deadline, nothing in that State is an SGO for that year.**
- Quote [TD:1771-1775]: "a failure to perfect its advance election within the time period set forth in this paragraph (c)(3)(ii) would result in a failure to meet the requirements of section 25F(g). Accordingly, no organization in that State would qualify as an SGO for the calendar year for which the advance election was not perfected."
- Confidence: [temporary-reg: in force]

**F53. The IRS publishes the list of States that made an advance election.**
- Quote [TD:1776-1778]: "The IRS will maintain and publish on https://www.irs.gov a list of States that have made an advance election."
- Confidence: [temporary-reg: in force]

**F54. What the State submits for each SGO.** Name, EIN, address, telephone number; federal tax-exempt status (recognized 501(c)(3) public charity, or application pending); anything else in future guidance. Plus per-SGO certifications (located in the State; segregated account; meets section 25F(d); State has classified it single-State or multistate, reviewed its audit report and its IRS certifications, and investigated failures) at TD:1854-1883.
- Quote [TD:1841-1853]: "For each organization named on the State SGO list, a State must provide: (i) The name, EIN, address, and telephone number of the organization; (ii) The Federal tax-exempt status of the organization, meaning that the organization either is currently described in section 501(c)(3), exempt from tax under section 501(a), and not a private foundation as defined in section 509(a), or, if paragraph (d)(5) of this section applies, that the organization's application for recognition of tax-exempt status is pending with the IRS; and (iii) Any other information the IRS deems necessary for purposes of administering the requirements of section 25F as may be described in future guidance."
- Confidence: [temporary-reg: in force]

**F55. Organizations with a pending exemption application can be on a State list, flagged as pending, and reach the IRS SGO list later.** The IRS adds them once it recognizes exemption effective on or before January 1 of the list year and the organization authorizes publication.
- Quote [TD:1927-1928]: "(iii) The State SGO list indicates that such organization's tax-exempt status is pending IRS recognition; and"
- Quote [TD:2020-2026]: "Upon determining that an organization described in paragraph (d)(5) of this section qualifies for tax-exempt status and that the effective date of such tax-exempt status is on or before January 1 of the calendar year for which the State SGO list applies, the IRS will add the organization to the IRS SGO list for that year if, and as soon as, the organization authorizes publication of its information to be included on that list."
- Confidence: [temporary-reg: in force]

**F56. Any public SGO list a State keeps must match its latest submitted State SGO list and carry the IRS SGO list's URL.** `[FC]` Precision: the rule is a certification the State makes about its own policies, and it applies only if the State maintains a public list ("any publicly available list"); nothing requires a State to publish one. Where a State does publish one, it is a usable second data source for the gate, but it is not the list the proposed donor reliance rule points to (that is the IRS SGO list, F67). The proposed version of this paragraph adds a third item: the State's public list must also state the donor reliance rule.
- Quote [TD:1945-1947]: "(iii) Require that any publicly available list of SGOs maintained by the State is identical to the most recently submitted State SGO list and includes the IRS SGO list's URL (Uniform Resource Locator); and"
- Quote [NPRM:6367-6371]: "(iii) Require that any publicly available list of SGOs maintained by the State is identical to the most recently submitted State SGO list, includes the IRS SGO list's URL (Uniform Resource Locator), and states that a taxpayer may rely on an organization's inclusion on the IRS SGO list in accordance with Sec. 1.25F-2(b); and"
- Confidence: [temporary-reg: in force]; the NPRM version is [proposed-reg: not final]

**F57. Changing a list before the deadline.** A State may replace or supplement its list any time before the deadline for that year.
- Quote [TD:1953-1957]: "A State may replace or supplement its State SGO list for a calendar year at any time before the deadline for perfecting or completing an election for that year by submitting the change in the IRS State section 25F portal in accordance with future guidance."
- Confidence: [temporary-reg: in force]

**F58. No additions after the deadline.** After February 15, 2027 a State cannot add an SGO to its 2027 list (unless guidance later allows). A late organization waits for the 2028 list.
- Quote [TD:1959-1964]: "Except to the extent provided otherwise in guidance, a State may not make any additions to the State SGO list for a calendar year after the deadline provided in paragraph (c)(3)(ii) or (c)(4) of this section, as applicable. Any additions a State seeks to make after that deadline may be included as part of the State's submission of its State SGO list for the following calendar year."
- Confidence: [temporary-reg: in force]

**F59. Removal can happen any time during the year.** If the SGO asks, the State must remove it. The State may also remove an SGO after a due-process procedure. Either way the State marks the removal and its effective date on its list and promptly tells the IRS through the State portal.
- Quote [TD:1965-1970]: "If an SGO requests to be removed from a State SGO list, a State must comply, indicate the removal and its effective date on that list, and promptly notify the IRS of that removal through the IRS State section 25F portal so the IRS can remove the SGO from the IRS SGO list for the current year."
- Quote [TD:1971-1978]: "A State may remove an SGO from its State SGO list if the State determines, through a procedure providing due process to the organization, that the SGO is not located in the State, or that the SGO does not satisfy the requirements for an SGO in section 25F(c)(5) or (d) or the applicable State requirements described in paragraph (e)(1) of this section. The State must promptly notify the IRS of the removal and its effective date through the IRS State section 25F portal."
- `[FC]` The words "at any time during the calendar year" come from the preamble's description of this paragraph, not from the regulation text itself, which sets no time limit. The IRS's burden estimate treats mid-year removals as rare (about 1% of SGOs).
- Quote [TD:702-704]: "Section 1.25F-5T(d)(7)(iii) provides that a State may remove an SGO from its State SGO list at any time during the calendar year to which that list applies."
- Quote [TD:1181-1185]: "The IRS anticipates that few States will be required, or choose, to report changes throughout the year. Therefore, the IRS estimates only 15% of the States (8) will do this for approximately 1% of the total SGO population (7)."
- Confidence: [temporary-reg: in force]; the two `[FC]` quotes are [preamble/economic-analysis]

**F60. The IRS can also remove an SGO from the IRS SGO list on its own.** It will remove one that is no longer a 501(c)(3) public charity; it may remove one for non-compliance (F37); it will remove one a State has removed. The list shows the removal "as of the date the IRS removes the organization from that list".
- Quote [TD:1980-1982]: "An organization may be removed from the IRS SGO list, and will be shown on that list as having been removed as of the date the IRS removes the organization from that list, in the following circumstances:"
- Quote [TD:2001-2003]: "If a State removes an SGO from its State SGO list in accordance with paragraph (d)(7)(iii) of this section, the IRS will remove an SGO from the relevant part of the IRS SGO list."
- `[FC]` Added detail. The mandatory ground is loss of status: the organization is not a section 501(c)(3) organization exempt under section 501(a), or it is a private foundation; the preamble adds automatic revocation "by function of section 6033(j)" (what triggers section 6033(j) is not explained in these sources). The discretionary non-compliance ground is a "Federal tax controversy", so the SGO can ask the IRS Independent Office of Appeals to review it. No source says whether the SGO stays on the IRS SGO list while an appeal is pending: **NOT IN SOURCES**.
- Quote [TD:1983-1987]: "(i) Removal following change in tax-exempt status. The IRS will remove an organization from the IRS SGO list if: (A) The organization is not described in section 501(c)(3) and exempt from tax under section 501(a); or (B) The organization is a private foundation."
- Quote [TD:727-730]: "the IRS will remove an organization from the IRS SGO list following its determination that the organization is not a section 501(c)(3) public charity or automatic revocation of the organization's tax-exempt status by function of section 6033(j)."
- Quote [TD:1995-1999]: "Such an IRS determination is a Federal tax controversy under section 7803(e)(3), which gives the SGO an opportunity to seek review of the determination by the IRS Independent Office of Appeals in the time and manner prescribed in applicable forms, instructions, or other administrative guidance."
- Confidence: [temporary-reg: in force]; TD:727-730 is [preamble/economic-analysis]

**F61. Multistate SGOs are listed per State.** Removal by one State removes the SGO only from that State's part of the IRS list. A donor to a multistate SGO can direct the gift to the account for any State that lists it.
- Quote [TD:2009-2012]: "the SGO will remain on the IRS SGO list with respect to such other covered State(s), subject to any further discretionary examination of the SGO by such other covered States or the IRS."
- Quote [TD:190-194]: "If the SGO is a multistate SGO, the donor would be able to direct the recipient SGO to allocate the qualified contribution to the multistate SGO's section 25F segregated account for any one or more of the covered States on whose State SGO list the SGO appears."
- Confidence: [temporary-reg: in force]; second quote [preamble/economic-analysis]

**F62. State portal facts (for context).** States use a separate "IRS State section 25F portal" (IRS web name: "FSTC State Portal"), with up to two designated officials and a special-purpose EIN issued after Form 15714 is filed. For 2027 the IRS may offer alternative submission procedures, so lists may not all arrive through the portal. `[FC]` The original cited only the last sentence; the supporting quotes for the other two claims are added below. The State portal page also shows the sign-in pattern the IRS uses for this program (a Login.gov or "IDMe" account, as the page spells it; registration as a "Designated Official" in IRS Business Tax Account; activation PIN mailed in 5 to 10 days). No source says the SGO portal will work the same way.
- Quote [TD:385-390]: "the IRS is considering the creation of alternative temporary procedures that would be outlined in future guidance to help ensure that all States that wish to participate under section 25F are reasonably able to complete their registration for the IRS State section 25F portal or otherwise submit the State election and State SGO list."
- Quote [TD:1692-1697]: "The Governor of the State or such other individual, agency, or entity as is designated under State law to make elections with respect to Federal tax benefits on behalf of the State may authorize up to two designated officials, as described in paragraph (b)(2)(ii) of this section, to register for and use the IRS State section 25F portal."
- Quote [IRS-PORTAL:27]: "To receive the FSTC State Portal EIN, the state must file Form 15714, Advance Election to Participate Under Section 25F for 2027 PDF [/pub/irs-pdf/f15714.pdf]. The IRS will provide the EIN to the point of contact identified on the form."
- Quote [IRS-PORTAL:22]: "Get the PIN by mail in 5 to 10 days"
- Confidence: [preamble/economic-analysis] for the alternative procedures; [temporary-reg: in force] for the two designated officials; [IRS web page] for the EIN and PIN details

### I. The IRS SGO list, donor reliance, and the effect of removal

**F63. The IRS SGO list is the IRS's aggregate of all State SGO lists, published on irs.gov.** It contains, for each covered State and calendar year, each listed SGO that authorized disclosure, and shows each removal and its date.
- Quote [TD:1487-1490]: "The term IRS SGO list means the aggregated list of SGOs included on one or more State SGO lists that the IRS maintains and publishes on https://www.irs.gov in accordance with Sec. 1.25F-5T(d)(9)."
- Quote [TD:2014-2018]: "The IRS will maintain and publish the IRS SGO list on https://www.irs.gov. For those SGOs that have authorized the disclosure of their information on the IRS SGO list, the IRS SGO list will contain each SGO included on a State SGO list for each of the covered States for the calendar year and reflect each removal from a State SGO list and the date of the removal."
- `[FC]` Note the wording: the published IRS list reflects removals "from a State SGO list and the date of the removal", while paragraph (d)(8) says a removed organization is shown as removed "as of the date the IRS removes" it (F60). The two dates can differ (Q9). The paragraph heading and the section roadmap also speak of publishing "the names of covered States and their State SGO lists".
- Quote [TD:1838-1840]: "Paragraph (d)(9) of this section provides for the publication of the names of covered States and their State SGO lists on https://www.irs.gov."
- Confidence: [temporary-reg: in force]

**F64. Where and when: the IRS individuals page says the IRS SGO list "will be available on the IRS Tax Exempt Organization Search page" and "will be posted on December 31, 2026".** The regulations themselves say only "on https://www.irs.gov"; the December 31, 2026 date and the Tax Exempt Organization Search location come from the IRS web page alone and are a statement of intent, not a rule. The data format (searchable page, download, API) is **NOT IN SOURCES**. Because States have until February 15, 2027 to file 2027 lists (F51), the December 31, 2026 posting may be incomplete; no source reconciles the two dates. `[FC]` On 2026-11-18 a plain request to https://www.irs.gov/charities-non-profits/tax-exempt-organization-search (the link target on the IRS hub page) returned HTTP 403 to this environment, so whether any SGO data is already there is UNVERIFIED.
- Quote [IRS-IND:411]: "Before contributing, check if the organization is an approved SGO and located in a participating state by searching the IRS SGO list which will be available on the IRS Tax Exempt Organization Search page. The list of qualified SGOs will be posted on December 31, 2026."
- Confidence: [IRS web page]

**F65. Some valid SGOs will not be on the IRS SGO list, because listing is opt-in.** For those, the proposed rule says the donor cannot use the list-reliance rule and needs other evidence that the organization is an SGO.
- Quote [IRS-IND:413]: "Note: some approved SGOs may not appear on the IRS SGO list on the IRS’s website because the SGO didn’t consent to be listed."
- Quote [NPRM:2327-2332]: "If an SGO does not consent to the disclosure of its information on the IRS SGO list, a taxpayer would not be able to use the reliance offered by the IRS SGO list for purposes of establishing that the taxpayer's contribution to that organization is a qualified contribution. Instead, the taxpayer would need to rely on other evidence to establish that the organization is an SGO."
- `[FC]` Tag note: the second quote is from the PROPOSED rule's preamble and describes the proposed reliance rule (F67). The temporary regulations' preamble does not contain this sentence. Treat it as Treasury's stated view, not settled law.
- Confidence: [IRS web page]; [preamble/economic-analysis] (of the proposed rule; not final)

**F66. Removed SGOs stay visible, struck through, with the removal date.**
- Quote [TD:760-766]: "If an SGO is removed from the IRS SGO list, its name and identifying information will be displayed in strike-through text, along with the date of the organization's removal from the list, to provide taxpayers with the information they may need in determining if their contribution is being made, or was made, to a valid SGO and thus is a qualified contribution eligible for the section 25F credit."
- Confidence: [preamble/economic-analysis]

**F67. Donor reliance rule (proposed).** A donor may rely on the organization being on the IRS SGO list, and not shown as removed, at the time of the gift. Reliance is lost if the donor knew the organization did not qualify, or was partly responsible for or aware of what caused a later removal.
- Quote [NPRM:5066-5070]: "Except as provided in paragraph (b)(2) of this section, a taxpayer may rely on the fact that an organization is listed on the IRS SGO list (and not listed as removed from that list) at the time a contribution is made to establish that the taxpayer's contribution is being made to an SGO."
- Quote [NPRM:5079-5086]: "(i) Had knowledge that the recipient organization did not satisfy the requirements of section 25F(c)(5) and Sec. 1.25F-3(b) at the time the contribution was made; or (ii) Was at least in part responsible for, or was aware of, the act, the failure to act, or the substantial and material change on the part of the organization that gave rise to the removal of the organization from the IRS SGO list in accordance with Sec. 1.25F-5(d)(8) after the date of the taxpayer's contribution."
- Quote [IRS-IND:412]: "A donor may rely on the IRS SGO list on the date the donor makes a qualified contribution."
- `[FC]` Status warning: the reliance rule is proposed 1.25F-2(b). It has NO temporary counterpart, so it is not in the regulations that take effect December 1, 2026. Donors can use it for 2027 gifts only through the general permission to rely on the proposed regulations (F2), and final regulations may change it. The IRS page states it without that caveat. Donor-facing copy should say the IRS has said donors "may rely" on the list, and should not promise that a listed SGO guarantees the credit.
- Confidence: [proposed-reg: not final]; [IRS web page]

**F68. Effect of removal on donors: gifts after the removal date do not count; gifts before it may.**
- Quote [TD:720-723]: "The organization will be removed from the relevant part of the IRS SGO list for the current year to ensure that any contributions to the organization after the date of its removal from the State or IRS SGO list are not treated as qualified contributions."
- Quote [IRS-IND:412]: "If an organization is removed from the list during the year, only contributions made before the removal date may qualify for the credit."
- `[FC]` Added: the proposed rule's economic analysis says the cut-off runs from removal from the STATE list, softened by the proposed reliance rule: a gift made after the State removes the SGO but while the IRS SGO list still shows it as listed may be protected "to the extent a taxpayer may rely on the IRS SGO list". No regulation text states a cut-off rule in terms; it follows from the SGO definition (an SGO must be on the State list) plus the proposed reliance rule. Treasury also says it rejected two alternatives: disallowing all gifts made in the year of removal, and allowing gifts for the whole year.
- Quote [NPRM:3262-3264]: "Contributions made after the date of removal from the State SGO list would not be treated as qualified contributions under section 25F, except to the extent a taxpayer may rely on the IRS SGO list."
- Confidence: [preamble/economic-analysis] (the NPRM sentence concerns a proposed rule; not final); [IRS web page]

**F69. A gift to an organization that is not on a covered State's SGO list earns no federal credit, even if it earns a State credit. The IRS says no credit until the State has elected and submitted its SGOs.**
- Quote [TD:205-208]: "a contribution to an organization that qualifies for State tax credits but is not included on the State SGO list of one or more covered States in which the SGO is located, does not give rise to the section 25F credit."
- Quote [IRS-HUB:17]: "Taxpayers can’t claim the credit for qualifying donations in a state until that state elects to participate and submits its approved SGOs to the IRS."
- Quote [IRS-ST:423]: "Individual taxpayers may claim the FTSC for contributions to any SGO which, at the time of the contribution, appears on a State’s list of approved SGOs in that State."
- Confidence: [preamble/economic-analysis]; [IRS web page] (the IRS page's "FTSC" typo is in the original)

**F69a. `[FC]` Start date, and Treasury's stated expectation that State certification comes before the gift.** Qualified contributions can begin January 1, 2027, and SGOs must be able to track designated contributions from that date. In explaining why the temporary rules were issued without prior comment, Treasury says donors need certainty that a State has certified the SGO "prior to donating". This is the strongest source statement bearing on gifts made between January 1, 2027 and the day a State files its 2027 list (Q11); it is a preamble statement of purpose, not a rule that such a gift fails.
- Quote [TD:898-899]: "Taxpayers may begin making qualified contributions on January 1, 2027."
- Quote [TD:850-852]: "Beginning on January 1, 2027, individual taxpayers will be able to make contributions to any eligible SGOs that have been certified by the States on whose SGO list they appear."
- Quote [TD:863-866]: "In order for the section 25F credit to operate as intended by Congress, taxpayers require certainty that a State has certified that an SGO satisfies the statutory requirements of section 25F prior to donating funds to organizations beginning on January 1, 2027."
- Quote [TD:859-862]: "SGOs must be required and able to track contributions received that are designated as qualified contributions that may give rise to credits to individual taxpayers as of January 1, 2027."
- Confidence: [preamble/economic-analysis]

**F70. The donor's own State does not matter.**
- Quote [IRS-ST:423]: "Taxpayers may receive the FSTC for contributions to these approved SGOs, regardless of the taxpayer’s own state of residence."
- Quote [NPRM:5032-5034]: "A taxpayer may make a qualified contribution to any SGO on any State SGO list, regardless of the taxpayer's State of residence."
- Confidence: [IRS web page]; [proposed-reg: not final]

### J. Participating States per the IRS page

**F71. The IRS page lists 31 States as having elected to participate for 2027, "as of Nov. 13, 2026". Texas is on it.** The page was last reviewed or updated 16-Nov-2026. The section heading on the page is "Advance elections to participate under Section 25F for 2027", so these are advance elections that still must be perfected with a State SGO list by February 15, 2027 (F51, F52). The list, in the page's order (two columns on the page; the text extract fuses "Nebraska" and "Nevada" at the column break, the HTML shows them as separate entries):

1. Alabama
2. Alaska
3. Arkansas
4. Colorado
5. Florida
6. Georgia
7. Idaho
8. Indiana
9. Iowa
10. Kansas
11. Kentucky
12. Louisiana
13. Mississippi
14. Missouri
15. Montana
16. Nebraska
17. Nevada
18. New Hampshire
19. New Mexico
20. North Carolina
21. North Dakota
22. Ohio
23. Oklahoma
24. South Carolina
25. South Dakota
26. Tennessee
27. Texas
28. Utah
29. Virginia
30. West Virginia
31. Wyoming

- Quote [IRS-ST:425-426]: "Participating states for 2027 (as of Nov. 13, 2026) The following states have elected to participate under Section 25F for 2027:"
- Quote [IRS-ST:459]: "Page Last Reviewed or Updated: 16-Nov-2026"
- Source for the list: IRS-ST lines 428-457; HTML at `sources/irs_fstc_states.html` line 1089.
- `[FC]` Verified: the saved HTML table has two cells, 16 names (Alabama to Nebraska) and 15 names (Nevada to Wyoming), 31 in total, matching the list above name for name. A same-day re-fetch of the live page (2026-11-18) is identical. The page lists States only; it does not list the District of Columbia or any SGO. The page's own verb is "have elected to participate"; under the regulations these are advance elections that become effective only if the State files its SGO list (F49a, F52), and the State portal page says the February 15, 2027 list deadline applies to them.
- Quote [IRS-PORTAL:43]: "For 2027: States must submit their list of qualifying SGOs by February 15, 2027. This includes participating states that made advance elections [/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc-participating-states]."
- Confidence: [IRS web page]

**F72. A secondary source is stale on this count.** SGO Desk's site says 30 States as of September 14, 2026. Use the IRS page and store its as-of date.
- Quote [SGODESK:145]: "Thirty States were on the IRS participating list as of September 14, 2026, and others are still deciding."
- Confidence: [secondary/web]

### K. Form 8525 (what the donor does)

**F73. The donor claims the credit on Form 8525, "Federal Scholarship Tax Credit", listing "the required SGO and unique donor number", and files it with the 2027 return.** The form will be available for the 2028 filing season. What "the required SGO" information is (name, EIN, both) is **NOT IN SOURCES**; the form and instructions are not published (irs.gov/pub/irs-pdf/f8525.pdf returned 404 on 2026-11-18).
- Quote [IRS-IND:420]: "Complete Form 8525, Federal Scholarship Tax Credit, listing the required SGO and unique donor number. Note: Form 8525 will be available for the 2028 filing season for contributions made to SGOs during calendar year 2027."
- Quote [IRS-IND:421]: "File Form 8525 with your 2027 federal income tax return."
- Quote [IRS-HUB:54]: "Complete and file Form 8525, Federal Scholarship Tax Credit, listing the required SGO and donor number."
- `[FC]` Confirmed on 2026-11-18: irs.gov returned HTTP 404 for `/pub/irs-pdf/f8525.pdf`, `/pub/irs-pdf/i8525.pdf`, `/pub/irs-dft/f8525--dft.pdf` and `/forms-pubs/about-form-8525`. No field, line number or layout of Form 8525 is known; do not mock one up as if it were the IRS form. The IRS page's wording, "File Form 8525 with your 2027 federal income tax return", assumes a calendar-year filer; the proposed-rule preamble says the form is attached to Form 1040 (F74).
- Confidence: [IRS web page]

**F74. Proposed regulation on Form 8525: one donor number per SGO, plus whatever the form and instructions require.** The form is attached to Form 1040. (Presumption for a missing number: F18.)
- Quote [NPRM:5134-5142]: "A taxpayer who claims the section 25F credit on the taxpayer's Federal income tax return must substantiate the credit on Form 8525, Federal Scholarship Tax Credit (or successor form), by reporting such information as may be required in the form and instructions, including, for each SGO to which the taxpayer has made a qualified contribution during the taxable year, the unique donor number that the SGO was required to provide as part of a timely written acknowledgement in accordance with Sec. 1.25F-4(c)."
- Quote [NPRM:4096-4099]: "These collections will be made by individual taxpayers as part of filing a Form 1040, including completing new Form 8525, Federal Scholarship Tax Credit (or successor form), and attaching the form to the taxpayer's Form 1040 when the taxpayer files the return."
- Confidence: [proposed-reg: not final]; [preamble/economic-analysis]

**F75. The Form 8525 instructions will also carry the designation requirement.**
- Quote [NPRM:4110-4113]: "This third-party disclosure requirement will be listed within the instructions for Form 8525, Federal Scholarship Tax Credit (or successor)."
- Confidence: [preamble/economic-analysis]

**F76. The IRS's donor steps, in order.** (1) Give cash to an approved SGO and tell it the payment is a section 25F qualified contribution; spouses giving together give both names. (2) Get the timely written acknowledgement by January 31 with the donor number, one per spouse. (3) Complete Form 8525 with the SGO and donor number. (4) File it with the 2027 return. (Quotes at F12, F16, F17, F9, F73; IRS-IND lines 415-421.) Eligibility per the same page:
- Quote [IRS-IND:407-409]: "To be eligible for the credit, an individual donor must: Make a qualified cash contribution to an eligible SGO. Claim the credit on the donor’s federal income tax return, subject to applicable limitations."
- Confidence: [IRS web page]

---

## ENGINEERING IMPLICATIONS

Labels: MUST = required by a quoted source. SHOULD = my recommendation where the sources leave room. Column and field names below are internal names for this codebase, not IRS field names (the IRS layout is NOT IN SOURCES).

### E1. Acknowledgement generator

1. MUST print all five required elements (F6): SGO EIN; calendar-year total designated as qualified contributions; unique donor number; a goods-or-services statement that is present even when the answer is "none"; description and good-faith value estimate when goods or services were provided.
2. MUST produce one acknowledgement per donor, per SGO, per calendar year, with the total for that calendar year (F11). A spouse is a separate donor: two donor records, two donor numbers, two documents (F16).
3. MUST NOT issue an official acknowledgement without a real donor number. A real number requires that the SGO has registered in the IRS SGO portal and received the IRS instructions (F22). Model `donor_number` as nullable with a status such as `pending_sgo_registration`.
4. MUST deliver by January 31 of the following year (F9). SHOULD schedule the batch in the first half of January, with a hard internal cutoff several days before January 31, and an exceptions queue. Do not code a weekend roll-forward (not in sources).
5. MUST record electronic-delivery consent before sending electronically, and MUST re-check at send time that consent has not been withdrawn (F10). Store: consent text version, timestamp, the email address consented to, and any withdrawal timestamp. MUST have a non-electronic path (postal mail to the address on file) for donors with no consent or withdrawn consent, and SHOULD use it for a hard-bounced email.
6. SHOULD add fields the regulation does not require but that every downstream use needs, visually separated from the required block: SGO legal name and address; donor name and mailing address exactly as they will be reported to the IRS (F33); calendar year; itemized list of gifts with date and amount (this also serves the section 170 acknowledgment for any excess, F19); issue date; a document version id. Keep the required block identical in wording across SGOs.
7. SHOULD keep the checkout email receipt and the official acknowledgement as two document types. The instant receipt should say it is a payment receipt and that the official section 25F acknowledgement with the donor number will follow by January 31, unless the SGO is registered and a number already exists. Whether an at-gift acknowledgement satisfies the rule is an open question (Q4).
8. MUST default the goods-or-services answer from data, not from copy. If the SGO gives nothing in return (the normal case), print an explicit "no goods or services" statement. If anything is provided, capture description and estimated value at gift time and reduce the qualified amount (F13). SHOULD block SGOs from attaching perks to designated gifts in v1 so the acknowledged total and the reported total are the same number (Q6).
9. SHOULD support reissue. Any change to a donor's calendar-year total (new gift, refund, correction) creates a new version that supersedes the old one; keep every version and its delivery log.
10. SHOULD NOT ask for or store SSN/ITIN for this flow. The donor number exists so that SGOs do not have to collect one (F25).
11. Acknowledgement copy SHOULD NOT promise the credit. The credit depends on tax liability, State credits and SGO status, none of which the acknowledgement certifies.

### E2. Unique donor number service

1. Build an interface (for example `DonorNumberScheme.generate(sgo, donor, calendar_year)`), with the real scheme loaded per SGO from the instructions the SGO receives in the portal. The format is NOT IN SOURCES (F23), so do not hard-code length, charset or check digits.
2. A sandbox scheme is fine for tests, but its output MUST be visibly non-production (for example prefixed `SANDBOX-`) and MUST be rejected by the official acknowledgement and IRS export code paths.
3. Uniqueness scope: unique per donor within one SGO (F21). `[FC]` That scope is an inference from "each SGO will be generating its own unique donor numbers"; because the format is NOT IN SOURCES (F23), whether the uniform format also makes numbers unique across SGOs (for example by embedding the EIN) is unknown. Always store and display the number together with the SGO's EIN, never alone. Store `(sgo_id, donor_id, calendar_year, donor_number, scheme_version, generated_at)`. Whether numbers persist across years is unknown (F24), so key by calendar year now and allow the same value to be reused later without a schema change.
4. Never share a donor number across SGOs, and never reuse one for a different donor.
5. Donor identity resolution matters: two checkouts by the same person to the same SGO in one year must land on one donor record and one number, or the acknowledgement total and the IRS row will be split. Match on verified email plus normalized name and address, and give SGO staff a merge tool with an audit log.

### E3. SGO onboarding and portal registration

1. Collect and store what the SGO needs to register (F30): legal name, EIN, address, telephone, year of formation, contact person with authority to bind (or Form 2848 on file), taxable year.
2. Track per SGO: `irs_portal_registered_at`, `donor_number_instructions_received_at`, and per calendar year `irs_list_disclosure_authorized` (F32).
3. `[FC]` Reworded: the sources do not say who may operate the SGO portal on an SGO's behalf, or whether a vendor can (Q3). What they do say is that the registration must name a contact who either has legal authority to bind the organization or provides a Form 2848 power of attorney (F30). So do not design for the platform registering on the SGO's behalf. Treat registration as an SGO-performed step with a checklist and an attestation upload.
4. Gate: an SGO cannot go live for credit-designated gifts until it is (a) on a covered State's SGO list for the gift's calendar year and (b) registered in the IRS SGO portal. (b) is my recommendation, since without it no acknowledgement or report can be produced (F18, F22).

### E4. Annual IRS contribution report export

1. One row per unique donor number with: donor number, donor name, donor address, aggregate qualified contributions for the calendar year (F33). Also carry SGO EIN, SGO name and calendar year in the file header or as columns for traceability.
2. Due February 28 of the following year (F34). Compute the date as the literal 28th. Put it on the compliance calendar with the January 31 date.
3. Format is unknown (F35). Emit CSV and JSON from one canonical internal record, behind an adapter so the IRS layout can be added when the portal instructions are available. Do not name the file or columns as if they were IRS-defined.
4. Reconciliation checks that SHOULD gate every export (`[FC]` relabeled: these are internal controls recommended by the author, not checks any source prescribes; the duties they protect are F20, F33 and F45): every donor with at least one designated, settled gift in the year has exactly one donor number; row total equals the sum of that donor's ledger entries; row total equals the latest acknowledgement version's total (or differs only by goods-or-services value, see Q6); grand total equals deposits into the section 25F segregated account for the year net of reversals; no sandbox numbers; no blank names or addresses.
5. Keep an immutable snapshot of each export (hash, generated_at, generated_by, row count, total) and a field for the SGO to record the portal submission date and any confirmation reference. Corrections are versioned exports; the IRS correction procedure is unknown (F35).
6. Size for 20,000+ rows per SGO (F38).

### E5. SGO list gate

1. Data model: `state_participation(state, calendar_year, status, source_url, as_of_date)` and `sgo_listing(sgo_ein, state, calendar_year, on_state_list, on_irs_list, exempt_status: recognized|pending, removed_effective_date, irs_removed_date, source, checked_at, evidence_hash)`. Listing is per State and per calendar year (F48, F49, F61).
2. Seed `state_participation` for 2027 with the 31 States in F71, as-of 2026-11-13, status `advance_election` (no source confirms that any State has submitted its list yet). Flip to `list_submitted` only on evidence. A State that misses February 15, 2027 has no SGOs for 2027 (F52). `[FC]` The seed is not frozen: more States may file Form 15714 up to January 1, 2027 (F50), and any listed State may lapse by not filing its SGO list (F49a). Re-pull the IRS page on a schedule, store its as-of date and "Page Last Reviewed or Updated" date each time, and never show an advance-election State to donors as "participating" without the qualifier that its SGO list is still due.
3. Until the IRS SGO list exists (first posting December 31, 2026, F64), any list in the product is provisional and MUST be labeled so, as the spec already says.
4. Before taking a credit-designated gift, check at payment time that the SGO is listed for the current calendar year and not removed, and store that check result with the gift (timestamp, source, evidence hash). This is the donor's reliance evidence (F67).
5. On removal: stop accepting credit-designated gifts for that SGO and State immediately; store both the State's effective date and the IRS removal date if they differ; treat the removal day itself as blocked (F68, Q9). Gifts already taken before removal stay in the ledger, acknowledgement and report.
6. No additions after the deadline (F58): after February 15, 2027 a State's 2027 list can only shrink, unless later guidance allows additions. `[FC]` The IRS SGO list is a different object and can still gain entries after that date: pending-exemption organizations the IRS adds once exemption is recognized (F55), and, by inference from the per-year opt-in (F32), listed SGOs that authorize disclosure late. Do not code "IRS list entries can only decrease after February 15".
7. SGOs that did not consent to IRS publication will not be on the IRS list (F65). Support a second evidence path (the State's own public list where the State publishes one; if it does, it must match the submitted list, F56) and show the donor a plain warning that the IRS list-reliance rule may not be available for that SGO. `[FC]` A State is not required to publish a list, so this path may not exist for every State; whether Texas publishes one is NOT IN SOURCES (Q23).
8. Organizations flagged "pending" on a State list (F55): SHOULD NOT be offered for credit-designated gifts until they appear on the IRS SGO list.
9. The IRS list's format is unknown (F64). Plan for a manual or scripted refresh with a human review step, and re-check on a schedule (daily in January and February 2027). Do not assume an API.
10. Re-verify everything each January 1: elections and lists are annual (F49), and from 2028 on lists are due January 1 (F51).
11. Multistate SGOs: capture which State account the donor directs the gift to and check listing for that State (F61).

### E6. Checkout data that the acknowledgement and report depend on

1. Capture at payment time, per donor (per spouse): legal name, mailing address, designation flag and the exact designation text shown, designated amount, timestamp. Designation cannot be added or removed later (F12). `[FC]` Store `designated_amount` as its own field, separate from `payment_amount`: a donor may designate less than the whole payment (F12a). Only `designated_amount` (less any goods or services, F13) feeds the acknowledgement total and the IRS report. Any non-designated remainder is a "non-qualified contribution" (the proposed rule's term, F12a); it must not go into the section 25F segregated account, which "must contain only qualified contributions and the earnings therefrom" (F45), and must not appear in element (B).
2. Joint gifts: require both spouses' names and an explicit per-spouse designated amount; never infer a split (F17). Create two donor records. `[FC]` Keep a link between the two spouse records: the proposed substantial-contributor test combines spouses' gifts (F46a).
3. Individuals only (F15). No business names, partnerships or S corporations in the credit-designated path (partnerships and S corporations are named in the proposed rule). `[FC]` Excluding donor-advised funds, trusts and corporate cards is a cautious product choice based on "made by an individual"; those cases are NOT IN SOURCES.
4. Payment method must be a cash type in U.S. dollars (F14); no crypto.
5. Record the contribution date used for calendar-year assignment and state the rule in one place. The section 25F sources do not define when a card or ACH gift is "made" (Q10).
6. Hold credit-designated checkout until January 1, 2027: "Taxpayers may begin making qualified contributions on January 1, 2027" (F69a), and the IRS pages say the credit begins January 1, 2027.

### E7. Compliance calendar constants (one module, with source cites)

| Date | Event | Source |
|---|---|---|
| 2026-12-01 | Temporary regulations effective; comments on proposed rule close | F1, F2 |
| 2026-12-15 | Public hearing on the proposed rule, 10 a.m. ET, telephone-only `[FC]` | F2 |
| 2026-12-21 | Comments close on the IRS paperwork notice for OMB 1545-2335 `[FC]` | F39a |
| 2026-12-31 | IRS web page says the IRS SGO list will be posted (web page statement, not a rule) | F64 |
| 2027-01-01 | Last day for a State's 2027 advance election (Form 15714); first day qualified contributions can be made | F50, F69a |
| 2027-02-15 | Last day for a State to provide its 2027 State SGO list | F51 |
| 2028-01-31 | Acknowledgements due for calendar-year 2027 gifts | F9 |
| 2028-02-28 | Annual contribution report due for calendar-year 2027 | F34 |
| 2028 filing season | Form 8525 available; filed with the 2027 return | F73 |
| 2029-10-01 | Temporary regulations expire | F1 |

Keep rule text, deadlines, required-field lists and the State list in a single versioned rules module so final regulations can be swapped in without touching the UI.

### E8. Suggested acknowledgement layout (draft for counsel; not an IRS form)

```
[SGO legal name]                                   (recommended, not required)
[SGO address]                                      (recommended, not required)
SGO EIN: __-_______                                REQUIRED  1.25F-4T(c)(1)(i)(A)

Timely written acknowledgement of section 25F qualified contributions
Calendar year: 2027                                (recommended)

Donor: [name]                                      (recommended; must match IRS report row)
Address: [mailing address]                         (recommended; must match IRS report row)
Unique donor number: [number]                      REQUIRED  (c)(1)(i)(C)

Total contributions you made to [SGO] during calendar year 2027 that you
designated as qualified contributions: $______     REQUIRED  (c)(1)(i)(B)

Goods or services: [SGO] did / did not provide any goods or services in
consideration, in whole or in part, for these contributions.
                                                   REQUIRED  (c)(1)(i)(D)
[If provided] Description: ______  Good faith estimate of value: $______
                                                   REQUIRED if any  (c)(1)(i)(E)

Itemization: [date] [amount] ...                   (recommended; helps section 170 for any excess)
Issued: [date]   Document version: [id]            (recommended)
```

---

## OPEN QUESTIONS / AMBIGUITIES

Each item is something the sources do not settle. None should be guessed in code or copy.

- **Q1. Donor number format.** Length, characters, structure, check digit, embedded EIN: NOT IN SOURCES. Available only through the SGO's portal instructions (F23).
- **Q2. Donor number lifetime.** New number each calendar year or one number per donor per SGO forever: NOT IN SOURCES (F24).
- **Q3. SGO portal mechanics.** URL, launch date, authentication, upload format, API, bulk limits, vendor or delegated access, turnaround for instructions: NOT IN SOURCES (F32a). As of 2026-11-18 irs.gov has a State portal page but I found no SGO portal page.
- **Q4. Timing of the acknowledgement relative to each gift.** The rule is an annual total due by January 31. Whether a per-gift acknowledgement issued right after payment counts, and whether a later gift in the same year requires a superseding document: NOT IN SOURCES (F11).
- **Q5. Electronic consent mechanics.** No prescribed consent language, disclosures, hardware or software statement, or withdrawal procedure: NOT IN SOURCES (F10).
- **Q6. Acknowledged amount versus reported amount when goods or services are provided.** Acknowledgement element (B) is the total "designated as qualified contributions"; the IRS report element (C) is the "aggregate amount of qualified contributions", and a qualified contribution is net of goods or services (F13). The sources do not say whether (B) is gross or net. With no goods or services the two are equal.
- **Q7. Refunds, chargebacks, failed ACH after designation.** Designation is irrevocable (F12), but the sources do not say how a returned or refunded payment is treated on the acknowledgement or the IRS report: NOT IN SOURCES.
- **Q8. Platform or processing fees.** Whether a fee withheld by a platform or processor reduces the amount to acknowledge and report: NOT IN SOURCES in the section 25F materials (the spec already flags this for counsel).
- **Q9. Which removal date controls, and the boundary.** The State records an "effective date"; the IRS list shows removal "as of the date the IRS removes" (F59, F60); the preamble says gifts "after the date of its removal from the State or IRS SGO list" do not count, while the IRS page says only gifts "before the removal date" may count (F68). Gifts on the removal date itself, time of day, and time zone: NOT IN SOURCES. `[FC]` The proposed rule's economic analysis adds that a gift after removal from the State list may still be protected "to the extent a taxpayer may rely on the IRS SGO list" (F68), which points to the IRS list's displayed status at the time of the gift as the donor-side test, but that rests on the proposed reliance rule only. All statements of the cut-off are in preambles or on the IRS web page; none is in regulation text.
- **Q10. When a gift is "made" for calendar-year assignment and list checks.** Card authorization, capture, settlement, ACH initiation or clearing: NOT IN SOURCES for section 25F. Publication 526, a section 170 document, says card gifts count in the year of the charge (P526 lines 2109-2111: "Credit card. Contributions charged on your bank credit card are deductible in the year you make the charge."). Whether that carries over to section 25F is not stated.
- **Q11. Gifts made between January 1, 2027 and the day a State files its 2027 list (up to February 15, 2027).** The statute requires the organization to be on the list "for the applicable year"; the IRS pages say the SGO must appear on the State's list "at the time of the contribution" and that there is no credit "until" the State submits its SGOs (F69). No source says a later-filed 2027 list reaches back to January 1. Also unreconciled: the IRS list "will be posted on December 31, 2026" while State lists are not due until February 15, 2027 (F64). `[FC]` The temporary regulations' preamble says donors need certainty that a State has certified the SGO "prior to donating" (F69a), which supports the conservative reading but is not a rule. Conservative build: no credit-designated gift until the SGO is verifiably listed.
- **Q12. SGOs not on the IRS list by choice.** What "other evidence" suffices for the donor is not defined (F65).
- **Q13. Pending-exemption SGOs.** Whether gifts made while the organization is on a State list as "pending", before the IRS adds it to the IRS SGO list, qualify: not addressed directly (F55).
- **Q14. Form 8525 content.** What "the required SGO" means (name, EIN, address), the line layout, how spouses on a joint return list their separate numbers, and whether the gift amount per SGO is entered: NOT IN SOURCES; form and instructions unpublished (F73).
- **Q15. Joint payments.** How to allocate a single combined payment between spouses, and whether each spouse's acknowledgement must reference the other: NOT IN SOURCES (F17).
- **Q16. Donor name and address matching.** Whether the name and address reported by the SGO must match the donor's tax return, which address to use (mailing or residence), and how foreign addresses are handled: NOT IN SOURCES (F33).
- **Q17. Report corrections and penalties.** How to amend a filed contribution report, any late-filing or incorrect-acknowledgement penalty, any extension: NOT IN SOURCES. The only stated consequence is possible removal from the IRS SGO list (F37).
- **Q18. Weekend and holiday deadlines.** No roll-forward rule is stated for January 31 or February 28 (F9, F34). (January 31, 2028 and February 28, 2028 both fall on a Monday.)
- **Q19. Retention period.** No number of years for SGO contribution records (F44).
- **Q20. Multistate allocation on the acknowledgement and report.** The required elements do not include the State account a gift was directed to (F6, F33, F61). Future guidance could add it.
- **Q21. One document for both section 25F and section 170.** Not addressed (F19).
- **Q22. IRS SGO list data format.** Search page only, bulk file, or API: NOT IN SOURCES (F64).
- **Q23. Texas specifics.** Which Texas office compiles and publishes the Texas State SGO list, and whether Texas has submitted it: NOT IN SOURCES. Texas appears only as an advance-election State (F71).
- **Q24. Final regulations.** Comments close December 1, 2026 (hearing December 15, 2026 per FRJSON; changed to telephone-only by a notice published November 12, 2026, F2). Acknowledgement contents, deadlines, spouse treatment, reliance, and the proposed operational report (F41 to F43) can all change. Additional data elements "as may be described in future guidance" are expressly reserved for both the portal registration and the annual report (F30, F33).
- **Q25. Sources I could not reach.** federalregister.gov refused this environment (HTTP 403); ecfr.gov answered some requests and refused one; the irs.gov site search and the Tax Exempt Organization Search page returned 403. So I could not check for corrections or follow-up guidance published after October 2, 2026, beyond the single eCFR version check in F1. Someone with normal web access should check irs.gov for an FSTC SGO Portal page, Form 8525 and its instructions, and any correction to T.D. 10057 before launch.
  - `[FC]` Update from the fact-check pass (2026-11-18): the Federal Register API and govinfo.gov DID answer plain requests this time. Result: no correction is linked to T.D. 10057 or to the NPRM; a search for documents mentioning "scholarship granting" or "section 25F" published since September 1, 2026 returned only four: the T.D., the NPRM, the paperwork notice of October 21, 2026 (F39a) and the hearing-format notice of November 12, 2026 (F2). The fact-checker also downloaded Internal Revenue Bulletins 2026-39 (September 21, 2026) through 2026-47 (November 16, 2026, the latest posted; 2026-48 returned 404) from irs.gov/irb and searched each for "25F", "10057", "117199" and "scholarship tax": no hits, so no section 25F notice, revenue procedure or announcement appears in those nine bulletins (files `sources/extra/factcheck_ack/irb_2026-*.html`). Still unreached: the Tax Exempt Organization Search page (HTTP 403), regulations.gov, IRS news releases, and anything behind the portals. Form 8525, its instructions, an "About Form 8525" page and two guessed SGO-portal URLs all returned HTTP 404 on irs.gov.
- **Q26. `[FC]` Showing a non-designated remainder.** When a donor designates only part of a payment (F12a), whether the section 25F acknowledgement may or should also show the non-designated part (for the donor's section 170 records) is NOT IN SOURCES. Element (B) itself covers only designated amounts.
- **Q27. `[FC]` SGO status during an IRS appeal.** Whether an SGO stays on the IRS SGO list while it appeals an IRS non-compliance determination, and how gifts made in that window are treated: NOT IN SOURCES (F60).
- **Q28. `[FC]` Who may act for an SGO in the portal.** Whether a software vendor or other agent may register, obtain the donor-number instructions, or file the contribution report for an SGO is NOT IN SOURCES. The only stated requirement is a named contact with authority to bind the organization or a Form 2848 (F30).

---

## VERIFICATION LOG

Adversarial fact-check, 2026-11-18. Scripts are in `verify_ack/` under the scratchpad; downloads are in `sources/extra/factcheck_ack/`.

### What was checked

1. **Every quote.** All 120 original `Quote [KEY:lines]` entries were re-located with an independent script that requires the text to sit inside the exact cited line range of the cited file (no line tolerance). 118 passed as cited; 2 were verbatim but cited one line short (fixed, see below). After the edits the file holds 155 such quotes and all 155 pass. A second pass checked the shorter phrases quoted inside prose; one paraphrase in quotation marks was found and fixed (F4), and one of the fact-checker's own was fixed (F73).
2. **Every paraphrase against its quote.** T.D. 10057 was read in full (all 2,079 lines). In the NPRM the fact-checker read the preamble parts on the credit, reliance, substantiation, SGO reporting, list changes, removal and publication, the applicability date, the economic analysis of reporting, and the Paperwork Reduction Act section, plus proposed 1.25F-1, 1.25F-2, 1.25F-3(b) and (d)(2), 1.25F-4 and 1.25F-5(d)(6) to (9). The statute, the four IRS pages, Form 15714, and the cited parts of Publication 526 and the SGO Desk page were read.
3. **Temporary versus proposed text.** A normalized text diff of 1.25F-1T, 1.25F-4T(b) and (c) and 1.25F-5T against proposed 1.25F-1, 1.25F-4(b) and (c) and 1.25F-5 (`verify_ack/difftext.py`).
4. **Confidence tags.** Each fact's tag was compared with where the quote sits: regulation text (TD lines 1467-2067; NPRM lines 4847 onward) or preamble.
5. **Live sources, plain requests only.** The four IRS pages were re-fetched and their body text compared with the saved copies (identical; footers 18-Nov-2026, 16-Nov-2026, 23-Oct-2026, 13-Nov-2026). The 31-State list was checked against the HTML table cell by cell. Form 15714 PDF re-downloaded (same size). Federal Register API records for both rule documents, two Federal Register searches, the eCFR version API, govinfo copies of the T.D. and of two later notices, Internal Revenue Bulletins 2026-39 to 2026-47, and probes for Form 8525 and an SGO portal page.
6. **Gap claims.** The main "NOT IN SOURCES" statements were tested by keyword search of both rule documents (weekend or holiday rules, refunds, fees, corrections, retention periods, penalties, TIN, when a gift is made, vendors or agents, donor-advised funds, trusts). None was contradicted. The statute was searched for acknowledgement, donor number, portal and reporting deadlines; it has none (F3).
7. **Derived dates.** January 31, 2028 and February 28, 2028 are both Mondays; 2028 is a leap year. Confirmed.

### What was changed

Corrections to existing content:
- **F1**: said the temporary regulations "expire October 1, 2029". The regulation text says applicability "expires on or before October 1, 2029". Also made explicit that the December 1, 2026 effective date is still in the future on the research date, and added a banner on what `[temporary-reg: in force]` means until then. Preamble sentence re-tagged.
- **F2**: said the proposed text repeats the temporary text "word for word". It does not: the acknowledgement and report paragraphs are identical, but the proposed text has extra definitions, cross-references to proposed-only sections, and three substantive additions in 1.25F-5(d). Differences now listed. The "identical text" statement was tagged as regulation text; it is a preamble sentence and is re-tagged. The cross-reference tip under the short version was corrected the same way, and proposed 1.25F-4(a) added to the proposed-only list.
- **F4**: a paraphrase was shown in quotation marks; replaced with the three exact wordings and line cites.
- **F6** and short version item 1: "exactly five elements" softened to "five listed elements"; the text says "includes the following information".
- **F10**: "Treasury expects nearly all" corrected to the source's "The IRS anticipates that most ... less than 1%" (a burden footnote).
- **F15** and **E6 item 3**: donor-advised funds were listed as excluded as if sourced. The sources name only partnerships and S corporations; the rest is now marked as an inference and NOT IN SOURCES.
- **F36**: line cite TD:1159-1165 corrected to TD:1159-1166.
- **F50**: line cite TD:1751-1753 corrected to TD:1751-1754.
- **F56**: "a usable second data source" qualified: a State is not required to publish a list.
- **F59**: "any time during the year" now attributed to the preamble, where it appears, not to the regulation text.
- **F62**: two of its three claims had no quote; supporting quotes added.
- **F64**: "first posting December 31, 2026" reworded to what the IRS page says, and marked as a web-page statement of intent.
- **F65**, **F46**, **F68**: tags clarified where the quote is a preamble statement about a PROPOSED rule.
- **F67**: added a status warning that the donor reliance rule has no temporary counterpart.
- **E3 item 3**: "the platform cannot register for the SGO unless..." was stated as a rule; reworded to what the sources say.
- **E4 item 4**: "MUST" relabeled "SHOULD" (author's internal controls, not source requirements).
- **E5 item 6**: "the 2027 list can only shrink" corrected to distinguish the State list from the IRS SGO list, which can still gain entries.
- Short version items 7, 9 and new item 11; quote-convention paragraph; source key.

Facts added (omissions found in the sources):
- **F12a** partial designation of a payment (proposed Example 4).
- **F29** addition: proposed 1.25F-4(a) registration trigger.
- **F37** addition: consequence of the proposed SGO definition.
- **F39a** IRS paperwork notice, 91 FR 66621 (October 21, 2026): only Form 15714 is listed under OMB 1545-2335.
- **F41** addition: single-State versus safe-harbor versus multistate scope; taxable-year basis.
- **F46a** proposed substantial-contributor tracking, spouses combined.
- **F49a** an advance election can lapse; a completed election cannot be revoked.
- **F50** additions: Form 15714 Part V; first-election and later-year election windows.
- **F60** additions: mandatory removal grounds, section 6033(j), IRS Independent Office of Appeals review.
- **F63** addition: State-removal date versus IRS-removal date wording.
- **F68** addition: removal from the State list and the proposed reliance carve-out.
- **F69a** January 1, 2027 start and the "prior to donating" statement.
- **F71** addition: cell-by-cell verification and the State portal sentence on advance-election States.
- **F2**, **Q24**: hearing changed to telephone-only, 91 FR 72837 (November 12, 2026).
- **F1**, **Q25**: no correction to either rule document in the Federal Register API; no section 25F item in Internal Revenue Bulletins 2026-39 to 2026-47.
- **Q26**, **Q27**, **Q28** new open questions; **E2 item 3**, **E5 items 2 and 7**, **E6 items 1, 2 and 6**, **E7** additions.

Nothing was removed as fabricated: no invented number, date, form name or field was found.

### UNVERIFIED items (could not be confirmed from any source)

- Whether the IRS SGO list, or any SGO data, is already on the Tax Exempt Organization Search page: the page returned HTTP 403 to plain requests (F64).
- The author's statement that guessed SGO-portal URLs returned 404: the URLs tried were not recorded. The fact-checker's own guesses also returned 404, which shows only that those addresses do not exist, not that no SGO portal page exists (F32a).
- The author's statement that federalregister.gov refused requests: not reproduced; it answered on 2026-11-18 (Q25).
- Whether any State, Texas included, has filed its 2027 State SGO list: no source says (F71, Q23).
- Anything published only inside the IRS SGO portal or the State portal, including the donor-number format (F23).
- regulations.gov docket contents and IRS news releases were not checked.
