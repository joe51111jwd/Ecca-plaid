# SGO obligations and income-verification rules under IRC section 25F

Research file for Piece 3 (verification core) and Piece 2 (family intake). Prepared 2026-11-18.
Everything about section 25F below comes from the local source files, not from memory. Where the sources are silent the file says **NOT IN SOURCES**.
This is an engineering reference, not legal or tax advice.

**Fact-check status (2026-11-18):** an independent adversarial pass re-verified every quote, line citation, number and tag in this file against the sources. Corrections are marked "Fact-check:" where they change the meaning of a fact, facts F87 to F100 were added for material the first pass missed, and the full list of what was checked and changed is in the VERIFICATION LOG at the end. No fabricated quote was found. Nothing in this file should be read as settled law unless its tag is `[statute]`.

Companion file: `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/research/hud-ami-and-annual-income.md` has the county-by-county HUD numbers, the Texas test vectors and a line-by-line income-category table for 24 CFR 5.609. This file covers what an SGO must do, which verification methods are allowed, and what must be kept and reported. The two files agree on the numbers they share.

## How to read this file

Source keys (all paths are under `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/`):

| Key | File | What it is |
|---|---|---|
| STAT | `sources/usc_25F.txt` | 26 U.S.C. 25F (Cornell LII text) |
| PROP | `sources/proposed_rule_REG-117199-25.txt` | REG-117199-25, proposed regulations, 91 FR 62818 (Oct 2, 2026). Preamble lines 124-2413, special analyses 2415-4461, proposed regulation text 4546-6492 |
| TEMP | `sources/temp_regs_TD10057.txt` | T.D. 10057, temporary regulations, 91 FR 62655 (Oct 2, 2026) |
| IRSIND | `sources/irs_fstc_individuals.txt` | IRS page "FSTC for individuals" (last updated 18-Nov-2026) |
| IRSST | `sources/irs_fstc_states.txt` | IRS page "FSTC - Participating states" (last updated 16-Nov-2026) |
| IRSMAIN | `sources/extra/irs_fstc_main.txt` | IRS FSTC landing page (page says last updated 23-Oct-2026; fetched 2026-11-18 by another agent) |
| HUDIL | `hud/IncomeLimitsMethodology-FY26.txt` | HUD "Methodology for Determining FY 2026 Section 8 Income Limits" |
| XLSX | `hud/Section8-FY26.xlsx` | HUD FY 2026 Section 8 income limits data (sheet `Section8-FY26`) |
| CFR609 / CFR100 / CFR403 | `sources/extra/ecfr/title24_sec_5.609_2026-11-01.txt`, `..._5.100_...`, `..._5.403_...` | eCFR text of 24 CFR 5.609, 5.100, 5.403 as of 2026-11-01 (https://www.ecfr.gov/current/title-24/section-5.609 etc.; fetched by another agent) |
| USC530 / USC142 / USC42 | `sources/extra/sgo_verif/usc_530.txt`, `usc_142.txt`, `usc_42.txt` | 26 U.S.C. 530, 142, 42 from Cornell LII, fetched 2026-11-18 for this file (https://www.law.cornell.edu/uscode/text/26/530, /142, /42) |
| IRB | `sources/extra/sgo_verif/irb_2026-38.txt` ... `irb_2026-47.txt` | Internal Revenue Bulletins 2026-38 through 2026-47 (https://www.irs.gov/irb/2026-NN_irb), fetched 2026-11-18 for this file |
| EFTC | `sources/extra/eftccredit_sgos_texas.txt` | eftccredit.com Texas SGO page (secondary, fetched by another agent) |
| SGODESK | `sources/sgodesk.txt` | sgodesk.com (secondary, vendor marketing) |

Citation format: each verbatim quote is a `>` line followed by `SRC: KEY Lstart-end | [tag]`. Line numbers are line numbers in the plain-text file. Line wraps are collapsed, `[...]` marks an elision, and Federal Register page markers such as `[[Page 62827]]` inside a quoted passage are dropped. The Federal Register text writes quotation marks as two backticks and two apostrophes; that is preserved. All quotes in this file were machine-checked against the source text with `research/_scripts/sgo_check_quotes.py`, and again by the fact-check pass with a separately written checker, `factcheck_sgo_scripts/fc_quotes.py` (under the scratchpad root).

Confidence tags: `[statute]`, `[temporary-reg: in force]`, `[proposed-reg: not final]`, `[preamble/economic-analysis]`, `[IRS web page]`, `[secondary/web]`. Two cautions on tags. First, `[temporary-reg: in force]` is used only for the regulation text of T.D. 10057; quotes from that document's preamble or DATES caption carry `[preamble/economic-analysis]`. Second, on this file's date the temporary regulations are published but their stated effective date (December 1, 2026) has not arrived; see the timing note in F2. Two extra tags are used where needed: `[HUD regulation/methodology]` for HUD material that the proposed rule points to, and `[derived]` for something I computed from the data files or established by searching the sources. If you need only the six standard tags, treat both extras as `[secondary/web]`: neither is section 25F authority.

"Prop. Reg." means a section of the proposed regulations in REG-117199-25. "SGO" means scholarship granting organization. "AMGI" means area median gross income.

## Status map: what is law, what is temporary, what is only proposed

| Rule | Where it lives | Status |
|---|---|---|
| Eligible student = household income for the prior calendar year not greater than 300% of AMGI, and eligible to enroll in a public school | Section 25F(c)(2) | Statute |
| SGO must verify "annual household income and family size" and limit awards to students under the limit | Section 25F(d)(1)(F) | Statute |
| 10+ students not all at the same school; 90% of income on scholarships; qualified expenses only; priority for prior recipients then siblings; no earmarking; no awards to disqualified persons; segregated account | Section 25F(c)(5), (d) | Statute |
| Definitions of eligible student, AMGI, household, foster child, qualified digital wallet, qualified expense, school, sibling | Prop. Reg. 1.25F-1(a)(4), (5), (13), (14), (17), (19) | Proposed only. The same paragraph numbers are "[Reserved]" in the temporary regulations |
| Household income definition, family size, shared-custody rule, the two verification methods, the two safe harbors | Prop. Reg. 1.25F-3(c)(6) | Proposed only. There is no section 1.25F-3T |
| Payment methods, digital wallet, residency ("solely within the State"), priority flexibility, disqualified-person detail, 90% timing, 85% safe harbor | Prop. Reg. 1.25F-3(b), (c), (d) | Proposed only |
| SGO annual certification, annual information report, annual audit | Prop. Reg. 1.25F-4(d), (e) | Proposed only. Paragraphs (d) and (e) are "[Reserved]" in 1.25F-4T |
| SGO portal registration, donor acknowledgement, donor-level report to IRS | Reg. 1.25F-4T(b), (c) | Temporary regulation (published Oct 2, 2026; effective Dec 1, 2026; applies on or after Sep 1, 2026; expires on or before Oct 1, 2029) |
| What a State must certify about each SGO and what a State must require of SGOs; removal from the State and IRS SGO lists; appeal of an IRS removal | Reg. 1.25F-5T(d), (e) | Temporary regulation (same dates) |
| Applicability of every proposed section | Prop. Reg. 1.25F-1 to 1.25F-5 | Proposed to apply only to taxable years ending on or after the final regulations are published. Until then they are optional reliance authority (F3, F87) |
| Official 300% limit table by area and family size | "will be published in the Internal Revenue Bulletin annually" | Not published in Bulletins 2026-38 through 2026-47 (through Nov 16, 2026). See F32 |

## The short version

1. The income test is statutory: household income for the calendar year before the scholarship application date must be not greater than 300% of AMGI. An application dated in 2027 looks at calendar-year 2026 income.
2. Every rule about how to verify (methods, documents, household definition, cash-only income, shared custody) is in the proposed regulations only. The temporary regulations do not contain them. SGOs may rely on the proposed regulations, for qualified contributions made on or after January 1, 2027 and until final regulations are published, only if they follow the portions applicable to them "in their entirety and in a consistent manner".
3. Two verification methods plus two safe harbors. Direct: review of documents (pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income or a certification that there is none) "or may be verified through other relevant data sources". Categorical: written documentation such as an award letter dated within the last 12 months showing someone in the household is currently approved for SNAP, TANF, WIC, Section 8 housing or SSI.
4. The regulation text and the preamble describe the "other relevant data sources" clause differently. The regulation text makes other data sources a stand-alone alternative to document review, and the "certification" in the regulation text is a certification that there is no other income. The preamble instead describes "a certification that would verify income through other relevant data sources". See F40, F41 and F43.
5. Household = the student plus everyone residing with the student. Family size = number of persons in that household. Shared custody: the household where the student lives longest in the year; if equal time, the household with the highest income.
6. Household income = "annual income" under 24 CFR 5.609, minus imputed returns on assets, including child support and alimony even if not taxable, excluding non-cash receipts. It is not AGI.
7. AMGI is to be Section 8-consistent with family-size adjustments. Treasury's worked example is 3 x area median x family-size multiplier (0.70 / 0.80 / 0.90 / 1.00 / 1.08 / 1.16 / 1.24 / 1.32). The regulation text can also be read as HUD's adjusted income limits scaled up, which gives different numbers in 143 of 254 Texas counties. See F34.
8. No re-verification interval, no record-retention period, and no list of verification records to keep is stated. The audit and certification rules tell you what must be provable.
9. Annual audit (proposed): by an external independent professional or accredited body if total receipts exceed $500,000; at $500,000 or less the SGO may instead use a committee of independent persons. It must cover the SGO's procedures "for verifying each such student's eligibility" and also "Verification that the organization met all of the operational requirements", so both the procedure and the individual files have to stand up (F58). Results go to the State.
10. Nothing in the sources addresses SGOs using a vendor for income verification. The third parties the rules do mention have other jobs: digital-wallet providers verify spending, and auditors review the SGO. The economic analysis prices direct verification using a commercial employment-verification service (The Work Number).
11. Summer camps and after-school programs are not mentioned. Qualified expenses are whatever section 530(b)(3)(A) covers, each tied to enrollment or attendance at a K-12 school, and separate guidance is promised.

---

## FACTS

### A. Legal status of the rules

**F1. Section 25F applies to taxable years ending after December 31, 2026.**

(a) The credit, and therefore the SGO rules, start with 2027.

> Section applicable to taxable years ending after Dec. 31, 2026, see section 70411(c)(1) of Pub. L. 119–21, set out in an Effective Date of 2025 Amendment note under section 25 of this title.

SRC: STAT L270 | [statute]

**F2. The temporary regulations cover only SGO registration, donor acknowledgement and reporting, and State elections. They do not contain the eligibility or verification rules.**

(a) The temporary regulations add sections 1.25F-1T, 1.25F-4T and 1.25F-5T only. In 1.25F-1T the paragraphs that would define disqualified person, eligible student and foster child are reserved, as are the paragraphs for qualified digital wallet, qualified expense, school and sibling. In 1.25F-4T the annual certification and audit paragraphs are reserved. There is no section 1.25F-3T. So no final or temporary regulation defines household, household income or a verification method; apart from the statute itself, those rules exist only as proposals.

> The temporary regulations contained in this Treasury decision provide reporting and recordkeeping requirements for SGOs and requirements for elections that States must make to participate under section 25F.

SRC: TEMP L113-116 | [preamble/economic-analysis] (preamble to T.D. 10057, not regulation text)

> (3)-(5) [Reserved]

SRC: TEMP L1480 | [temporary-reg: in force]

> (13)-(15) [Reserved]

SRC: TEMP L1531 | [temporary-reg: in force]

> (d) and (e) [Reserved]

SRC: TEMP L1657 | [temporary-reg: in force]

> This section applies on or after September 1, 2026. The applicability of this section expires on or before October 1, 2029.

SRC: TEMP L1562-1564 | [temporary-reg: in force]

Timing note: the Treasury decision states an effective date of December 1, 2026 and an applicability date of September 1, 2026. As of this file's date (November 18, 2026) the stated effective date is still two weeks away. This file uses the tag `[temporary-reg: in force]` for the regulation text of these rules anyway, because they will be effective before any 2027 gift or scholarship. Fact-check: in copy written before December 1, 2026, say "temporary regulations published October 2, 2026, effective December 1, 2026", not "in force". They also expire: each temporary section says its applicability "expires on or before October 1, 2029".

> Effective date: These temporary regulations are effective on December 1, 2026.

SRC: TEMP L46-47 | [preamble/economic-analysis] (DATES caption of T.D. 10057)

**F3. SGOs may rely on the proposed regulations for 2027, but only if they follow them completely and consistently.**

(a) This is the legal basis for building to the proposed verification methods now. The reliance statement is in the preamble, not in the regulation text. Its exact scope is: qualified contributions made on or after January 1, 2027, in taxable years ending before final regulations are published, and only for those who follow the portions applicable to them "in their entirety and in a consistent manner". It does not say the proposed rules are binding, and by their own terms they would apply only after final regulations are published (F87). The inference that mixing proposed-rule methods with home-made shortcuts weakens an SGO's reliance position is this file's reading of "in their entirety", not a statement in the sources.

> Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent manner.

SRC: PROP L2406-2413 | [preamble/economic-analysis]

**F4. Comments are due December 1, 2026, and Treasury asks for comments on everything.**

> Written or electronic comments must be received by December 1, 2026.

SRC: PROP L99-100 | [preamble/economic-analysis]

> The Treasury Department and the IRS request comments on all aspects of the proposed regulations.

SRC: PROP L4471-4473 | [preamble/economic-analysis]

**F5. Even under the temporary regulations (effective December 1, 2026), the State must certify that each listed SGO meets all operational requirements of section 25F(d), which include income verification.**

(a) Verification is therefore something the State has to be satisfied about before listing, not only something the IRS might audit later. Fact-check: two qualifications. This certification is subject to the transition rule in 1.25F-5T(d)(4): until an SGO has first reported on its operations, the State may rely on the SGO's governing documents and written policies (F60). And the temporary text refers only to "section 25F(d)", meaning the statutory duty to verify income and family size; the proposed version of the same paragraph adds "and Sec. 1.25F-3(c)", which is where the specific verification methods live (F90).

> (iii) The organization meets all the operational requirements described in section 25F(d);

SRC: TEMP L1864-1865 | [temporary-reg: in force]

### B. Eligible student and the income requirement

**F6. Statutory definition of eligible student. Two tests: household income, and eligibility to enroll in a public school.**

> is a member of a household with an income which, for the calendar year prior to the date of the application for a scholarship, is not greater than 300 percent of the area median gross income (as such term is used in section 42), and

SRC: STAT L161 | [statute]

> is eligible to enroll in a public elementary or secondary school.

SRC: STAT L164 | [statute]

**F7. The proposed regulation repeats the statutory definition without adding detail on timing.**

> (4) Eligible student--(i) In general. The term eligible student means an individual who: (A) Is a member of a household with an income that, for the calendar year prior to the date of the application for a scholarship, is not greater than 300 percent of the area median gross income; and (B) Is eligible to enroll in a public elementary or secondary school.

SRC: PROP L4860-4870 | [proposed-reg: not final]

**F8. "Eligible to enroll in a public school" does not mean the student must be enrolled anywhere at application or award time.**

(a) Do not ask "is the child enrolled in public school" as an eligibility gate. What the SGO must verify is that the student is eligible to enroll in a public elementary or secondary school. How to verify that (age, grade, residency) is NOT IN SOURCES.

> The definition of eligible student does not itself require that the student be enrolled in or attending a school at the time of the scholarship application or award.

SRC: PROP L493-496 | [preamble/economic-analysis]

**F9. The SGO must verify income and family size, and must limit awards to students under the limit.**

> verifies the annual household income and family size of eligible students who apply for scholarships to ensure such students meet the requirement of subsection (c)(2)(A), and

SRC: STAT L214 | [statute]

> limits the awarding of scholarships to eligible students who are a member of a household for which the income does not exceed the amount established under subsection (c)(2)(A).

SRC: STAT L217 | [statute]

> (iv) Verifies that scholarships are awarded only to eligible students who are members of a household described in paragraph (c)(6) of this section and who are eligible to enroll at a public elementary or secondary school;

SRC: PROP L5332-5335 | [proposed-reg: not final]

**F10. The SGO must use one or more of the methods listed in paragraph (c)(6)(iii). The proposed text states no general "any reasonable method" option.**

(a) Every decision the engine returns must name which listed method it used. Paragraph (c)(6)(iii) contains four items: the direct method, the categorical method and the two safe harbors. Fact-check: the list is exclusive in form ("must use one or more of the methods described"), but the direct method itself ends with the undefined phrase "or may be verified through other relevant data sources" (F40), so the boundary of what counts as the direct method is open, not closed.

> A scholarship recipient must be an eligible student who satisfies the household income requirement described in section 25F(c)(2)(A), Sec. 1.25F-1(a)(4), and paragraph (c)(6)(ii) of this section. An SGO must use one or more of the methods described in paragraph (c)(6)(iii) of this section to verify that a scholarship recipient is an eligible student who satisfies this household income requirement.

SRC: PROP L5487-5493 | [proposed-reg: not final]

**F11. The comparison is "not greater than": income equal to the limit passes.**

> a child in this household could be eligible to receive a scholarship funded by section 25F if the household's income was less than, or equal to, $270,000 (3 * $100,000 * 0.90).

SRC: PROP L2759-2762 | [preamble/economic-analysis]

**F12. An SGO may set its own stricter income cap. 300% is a ceiling, not a requirement.**

(a) The engine needs a per-SGO cap parameter at or below 300%. The sources give 50% and 80% as examples only.

> The statute allows an SGO to give scholarships up to that income limit, but an SGO may focus on students below that limit. For example, an SGO that limits scholarships to students that are members of households with an income not greater than 50% of area median gross income, and that otherwise meets all the requirements under section 25F to be an eligible SGO, would be an eligible SGO for purposes of section 25F.

SRC: PROP L1195-1201 | [preamble/economic-analysis]

> or to students whose household income is less than 80 percent of the area median gross income, provided that the SGO meets the statutory and regulatory requirements for SGOs.

SRC: TEMP L228-230 | [preamble/economic-analysis] (preamble to T.D. 10057; the same sentence is in the proposed-rule preamble at PROP L458-460)

### C. Which year's income counts, how often to verify, and priority

**F13. The income year is the calendar year before the date of the scholarship application.**

(a) `income_year = year(application_date) - 1`. The engine cannot run without an application date. The proposed regulations do not define "date of the application" (submitted, completed, received by the SGO) and do not say what happens when an application straddles January 1. A stakeholder asked for clarification of the timeframe; the proposed text just repeats the statute.

> Section 25F(d)(1)(F) requires an SGO to verify the annual household income of eligible students who apply for scholarships. This includes verifying that the student is an individual who is a member of a household with an income that, for the calendar year prior to the date of the application for a scholarship, is not greater than 300 percent of the area median gross income.

SRC: PROP L1153-1158 | [preamble/economic-analysis]

> One stakeholder suggested that the forthcoming regulations clarify the relevant timeframe for measuring the student's household income.

SRC: PROP L1160-1162 | [preamble/economic-analysis]

**F14. How often eligibility must be re-verified is not stated as a rule. The texts tie verification to each application and describe eligibility as an annual determination that holds "as of the time when the scholarship is paid".**

(a) The statute says the SGO verifies "annual" household income of students "who apply". The preamble, explaining why multi-year awards only count when paid, says the SGO determines annual income and family size and that the recipient must be an eligible student "in each case as of the time when the scholarship is paid". Read together: a new application means a new income year and a new verification, and a multi-year award does not obviously lock in eligibility for later payments. A specific re-verification interval, or a statement that a verification stays valid for N months, is NOT IN SOURCES.

> This is consistent with the annual accounting and eligibility principles reflected in the statutory requirements of section 25F, including the requirement that the SGO determine the ``annual'' household income and family size of eligible students and that the scholarship recipient be an eligible student located in the State, in each case as of the time when the scholarship is paid.

SRC: PROP L1028-1034 | [preamble/economic-analysis]

> Given this cash method of accounting requirement, funds allocated for future disbursements (for example, multi-year scholarships) would not be considered ``spent'' until they are paid.

SRC: PROP L1024-1026 | [preamble/economic-analysis]

> proposed Sec. 1.25F-3(c)(6) would require an SGO to verify the annual household income and family size of students who apply for scholarships using one or more of the methods described in proposed Sec. 1.25F-3(c)(6) to ensure the scholarship applicants meet the definition of an eligible student;

SRC: PROP L4027-4031 | [preamble/economic-analysis] (Paperwork Reduction Act section)

**F15. Prior-year recipients and siblings get priority in awards. No continued-eligibility rule for them appears in the sources.**

(a) The priority is among "eligible students". A returning student must still be an eligible student, so the income test applies again (this follows from the wording "provides a scholarship to eligible students with a priority for" and from F14; the sources do not state it as a separate rule). No grandfathering or continued-eligibility rule for returning students or siblings appears anywhere in the sources: the fact-check pass searched both rule documents for "continue", "grandfather", "renew", "re-verif" and "recertif" and found nothing on point. Order: first, students awarded a scholarship the previous school year; then eligible students with a sibling who was awarded a scholarship from the same SGO. The statutory wording for returning students does not say "from such organization"; the sibling clause does.

> (D) such organization provides a scholarship to eligible students with a priority for—

SRC: STAT L202 | [statute]

> students awarded a scholarship the previous school year, and

SRC: STAT L204 | [statute]

> after application of clause (i), any eligible students who have a sibling who was awarded a scholarship from such organization,

SRC: STAT L207 | [statute]

> (vi) Awards scholarships with a priority, in accordance with paragraph (c)(8) of this section, for eligible students awarded a scholarship for the previous school year and, thereafter, for any eligible students who have a sibling who was awarded a scholarship from such SGO; and

SRC: PROP L5341-5345 | [proposed-reg: not final]

**F16. The priority rule is flexible by expense type.**

(a) Priority matters most for tuition-type awards (so a child can stay at the same school). For tutoring or special-needs awards the SGO may prioritise by need instead.

> (8) Priority in awarding scholarships. In complying with section 25F(d)(1)(D), which requires that scholarships be awarded with priority consideration being given to eligible students awarded a scholarship for the previous school year and, thereafter, to any eligible students solely within the State who have a sibling who was awarded a scholarship from that SGO, an SGO has flexibility to consider the particular needs of potential scholarship recipients and the type of expenses for which the scholarship is being awarded. For example, a prior scholarship recipient should be given priority with regard to an award for tuition, fees, and room and board to ensure that the eligible student is able to continue attending the same school. Similarly, the siblings of such an award recipient should be given priority so that siblings are able to attend the same school. However, if a scholarship is awarded based on need for individual academic tutoring or special needs services, the fact that a student was a previous scholarship recipient, or that a student has a sibling who was a previous scholarship recipient, may not be relevant and priority instead can be based on need for the services.

SRC: PROP L5621-5638 | [proposed-reg: not final]

**F17. "Sibling" is broad.**

> (19) Sibling. The term sibling means an individual's brothers and sisters, adopted siblings, foster siblings, half-siblings, and step-siblings.

SRC: PROP L4976-4978 | [proposed-reg: not final]

**F18. Because of the priority and disqualified-person rules, Treasury says blind or anonymised selection is impossible.**

(a) Treasury made this statement while refusing an exception to the disqualified-person rules for SGOs that use blind selection. The design consequence drawn here is this file's inference, not a statement in the sources: the SGO must know who the applicant is, whether they were a prior recipient, and who their family is, so a verification result that hides identity from the SGO is not enough for the SGO's award step.

> Moreover, section 25F requires that SGOs prioritize students awarded a scholarship the previous year and students with a sibling who was awarded a scholarship by such organization, meaning that truly ``blind'' or ``anonymized'' selection procedures are impossible.

SRC: PROP L1449-1453 | [preamble/economic-analysis]

### D. Household, family size, and students who live in more than one household

**F19. Household = the student plus the group of persons residing with the student. No kinship test.**

> (iii) Household. The term household includes the individual whose status as an eligible student is being determined, and the group of persons residing with that individual. See Sec. 1.25F-3(c)(6)(ii)(B) if an individual resides in multiple households during the year.

SRC: PROP L4880-4883 | [proposed-reg: not final]

**F20. Family size and the shared-custody rule (regulation text, quoted in full).**

(a) Family size is a head count of the household, student included. If the student lives in more than one household during the calendar year, use the household where the student resides for the longest period of time during the year. If time is equal, use "the household of the taxpayer with the highest household income". The text does not say how to measure time (nights, days, custody order), which "year" is meant when the application is mid-year (it says "during the calendar year" and then "during the year"), or how an SGO is to obtain the other household's income to apply the tie-break.

> (B) Family size. Family size is equal to the number of persons who are part of a household. A student's household includes the individual whose status as an eligible student is being determined, as well as each other person residing with that individual. For purposes of determining the number of members of the student's household in situations in which the student resides in more than one household during the calendar year (for example, in cases of shared custody), the relevant household is the one in which the student resides for the longest period of time during the year or, if the time spent by the student in each household is equal, then the household of the taxpayer with the highest household income.

SRC: PROP L5500-5510 | [proposed-reg: not final]

**F21. Preamble explanation of the household and shared-custody rules.**

> The Section 8 regulations at 24 CFR 5.100 define the term ``household'' as ``family, foster children and adults, and PHA-approved live-in aide.'' This definition then refers to 24 CFR 5.403 for the definition of ``family,'' which focuses on who is living together; it could be a single person or ``a group of persons residing together.'' Accordingly, for purposes of proposed Sec. 1.25F-3(c)(6), proposed Sec. 1.25F-1(a)(4)(iii) would define ``household'' as including the individual seeking to be an eligible student and the group of persons residing with that individual.

SRC: PROP L1238-1246 | [preamble/economic-analysis]

> For purposes of determining the number of members of the student's household in situations in which the student resides in more than one household during the year (for example, in cases of shared custody), proposed Sec. 1.25F-3(c)(6)(ii)(B) would identify the relevant household as the one in which the student resides for the longest period of time during the year. If the time spent by the student in each residence is equal, then the household of the taxpayer with the highest household income would be the relevant household for purposes of section 25F.

SRC: PROP L1247-1255 | [preamble/economic-analysis]

**F22. The economic analysis paraphrases the rule as "majority of the year", which is not the same as "longest period".**

(a) With three households, the longest stay can be less than a majority. Implement the regulation text ("longest period of time"), not the paraphrase.

> The proposed regulations define family size as the number of persons who reside in the same household as the eligible student, including the eligible student. If the eligible student is part of multiple households over the course of the year, the relevant household is the one in which the student resided for the majority of the year. If the student splits time equally among multiple households, the proposed regulation states that the relevant household is the one with the highest household income.

SRC: PROP L2783-2790 | [preamble/economic-analysis]

**F23. Treasury heard the objection that a residence-based household sweeps in grandparents and unrelated housemates, and kept the residence-based definition anyway.**

(a) Intake must ask about everyone living in the home, not only parents and children. Whether a roommate's or boarder's income counts is not settled; see Open Question 9.

> Other stakeholders expressed concern with using section 42, the statutory provision for determining the Federal low-income housing credit, for determining income and family size because the section 42 definition encompasses all individuals who might be living in the same residence, including multiple generations of a family or unrelated individuals living together in the same location.

SRC: PROP L1164-1170 | [preamble/economic-analysis]

**F24. The HUD definitions the preamble points to.**

> Household, for purposes of 24 CFR part 5, subpart I, and parts 960, 966, 882, and 982 of this title, means the family, foster children and adults, and PHA-approved live-in aide.

SRC: CFR100 L30 | [HUD regulation/methodology]

> (2) A group of persons residing together, and such group includes, but is not limited to:

SRC: CFR403 L11 | [HUD regulation/methodology]

### E. Household income

**F25. Definition of household income (regulation text, quoted in full).**

(a) Start from "annual income" as defined in 24 CFR 5.609. Disregard imputed return on net assets. Include child support and alimony received even when not in taxable income. Exclude non-cash receipts.

> (C) Household income. For purposes of determining the household income of a particular eligible student to be measured against the limit established in section 25F(c)(2)(A) and Sec. 1.25F-1(a)(4)(i)(A), the term household income means annual income, as defined in 24 CFR 5.609; however, for this purpose, household income must be determined by disregarding the imputed return on net assets (for example, unrealized appreciation in a home or stock). This definition includes receipts by a member of the household in the form of child support and alimony not included in taxable income but excludes non-cash receipts.

SRC: PROP L5511-5520 | [proposed-reg: not final]

**F26. Preamble explanation (quoted in full).**

(a) The stated reason for the cash-only modification is verifiability: non-cash items are "unlikely to be documented and verifiable". The preamble names three things that are disregarded: a Section 8 housing allowance, any imputed return on assets, and other items not received in cash.

> The regulations issued by the Department of Housing and Urban Development relating to Section 8 are found in 24 CFR part 5. The definition of ``household income'' used in 24 CFR 5.609 is broader than the Federal tax definition of ``income'' and includes items such as child support, alimony received, and the imputed returns on assets (based on the current passbook savings rate) if the value of a family's net assets exceeds $50,000 and the actual returns from a given asset cannot be calculated. Thus, the definition includes certain items not received in the form of cash, including unrealized appreciation in a home.

SRC: PROP L1203-1215 | [preamble/economic-analysis]

> Although this Section 8 definition forms the basis of the definition in the proposed regulations to determine the income limit specified in section 25F(c)(2)(A), in the interest of sound Federal tax administration, the proposed regulations would modify this definition for purposes of measuring a particular household's income against the 300 percent statutory limit. Specifically, in determining the household income of an eligible student, the proposed regulations would disregard items not received in cash by a member of the household because such items are unlikely to be documented and verifiable. The proposed regulations, therefore, would disregard the amount of a Section 8 housing allowance, any imputed return on assets, and other items not received in cash.

SRC: PROP L1216-1227 | [preamble/economic-analysis]

> The Treasury Department and the IRS have proposed this approach after consideration of the purpose of section 25F and the fact that approximately 95 percent of the children in the United States are in households with income below the 300 percent of area median gross income limit provided in section 25F(c)(2)(A).

SRC: PROP L1227-1231 | [preamble/economic-analysis]

> This proposed definition of a particular household's income would be expected to simplify the income verification process for families and SGOs by disregarding non-cash items (such as imputed returns on home equity) that generally would not be shown on any tax or financial documents and may be dependent on current valuations.

SRC: PROP L1231-1236 | [preamble/economic-analysis]

**F27. Economic-analysis restatement: cash sources only.**

> The proposed regulations would adopt this definition of income with one modification: household income includes only cash sources of income, and excludes non-cash sources of income, such as imputed income on net assets.

SRC: PROP L2805-2808 | [preamble/economic-analysis]

> These proposed regulations also benefit taxpayers and SGOs by reducing the burden placed on SGOs to verify eligible students' incomes: they are able to count only cash sources of income, without being required to augment this value with an imputation of the non-cash income received by a student's family or household.

SRC: PROP L2845-2849 | [preamble/economic-analysis]

Scale, from the same analysis: with cash-only income about 95% of school-age children are expected to pass the income test (64% under the unmodified HUD definition), and 96% in electing States once the safe harbors are counted. So for most families the engine's job is to document a pass, and the cases that need care are the few near or above the limit (that sentence is this file's conclusion, not Treasury's). The denominator behind the 95% and 96% figures in Treasury's Table 2 is "all children ages 5 to 17 who reside in States that have made advance elections to participate in the section 25F credit as of July 2026" (PROP L3104-3105), and Treasury computed them with HUD's MTSP income limits (F37), so they are estimates under one reading of the limit.

> The Treasury Department and the IRS estimate that, under the strict HUD definition, 64 percent of elementary and secondary school age children would be expected to be eligible to receive a scholarship, compared to the 95 percent of children expected to be eligible as a result of the exclusion of non-cash income provided in the proposed regulations.

SRC: PROP L2839-2844 | [preamble/economic-analysis]

> the Treasury Department and the IRS estimate that 96% of children located in States that have elected to designate SGOs under section 25F will be eligible to receive section 25F scholarship funds.

SRC: PROP L3078-3081 | [preamble/economic-analysis]

**F28. Household income is not AGI. Treasury considered AGI and rejected it.**

(a) A tax return or transcript is evidence of components of income. The AGI line is not the answer, because the household can be bigger than the tax unit and because non-taxable cash (child support, for example) counts.

> The Treasury Department and the IRS also considered defining household income as adjusted gross income (AGI) as calculated on Form 1040. This alternative was not chosen for several reasons. First, AGI must be calculated based on the income and marital status of a tax unit. The statute contains references to households and families, rather than tax units.

SRC: PROP L2850-2855 | [preamble/economic-analysis]

Added by the fact-check pass. The other stated reasons, and the stakeholder proposal that was not adopted:

> Second, between 3 and 12 percent of U.S. children are not claimed on Federal tax returns.

SRC: PROP L2856-2857 | [preamble/economic-analysis]

> The Treasury Department and the IRS estimate that using AGI as the definition of household income would have reduced the number of children eligible to receive scholarships by 17%.

SRC: PROP L2866-2868 | [preamble/economic-analysis]

> Some stakeholders suggested using information reported on Form 1040 and identifying members of the student's household based on who claims the eligible student as a dependent.

SRC: PROP L1162-1164 | [preamble/economic-analysis]

The proposed text did not take up that suggestion: household is defined by residence (F19), not by who claims the student as a dependent.

**F29. What 24 CFR 5.609 "annual income" covers, in outline.**

(a) All amounts received from all sources by each family member aged 18 or older (or the head of household or spouse), plus unearned income of dependents under 18, unless listed as excluded. Earned income of children under 18 is excluded. Self-employment counts at net, not gross. The full category-by-category table is in the companion file `hud-ami-and-annual-income.md` (Part C and the Income Category Table). The proposed regulation cites "24 CFR 5.609" with no edition date; a footnote in the economic analysis labels it "(2000)" while describing the current text.

> (1) All amounts, not specifically excluded in paragraph (b) of this section, received from all sources by each member of the family who is 18 years of age or older or is the head of household or spouse of the head of household, plus unearned income by or on behalf of each dependent who is under 18 years of age, and

SRC: CFR609 L3 | [HUD regulation/methodology]

> (3) Earned income of children under the 18 years of age.

SRC: CFR609 L12 | [HUD regulation/methodology]

> (i) Net income from the operation of a business or profession.

SRC: CFR609 L70 | [HUD regulation/methodology]

> \11\ 24 CFR 5.609 (2000), last accessed June 11, 2026.

SRC: PROP L2827 | [preamble/economic-analysis]

### F. Area median gross income and the 300% limit

**F30. Definition of AMGI (regulation text). The IRS says it will publish AMGI annually in the Internal Revenue Bulletin.**

> (ii) Area median gross income. The term area median gross income means area median gross income calculated in a manner consistent with determinations of area median gross income under section 8 of the United States Housing Act of 1937 (or, if such program is terminated, under such program as in effect immediately before such termination), including adjustments for family size, meaning the number of persons who are part of a household for purposes of section 25F. Area median gross income will be published in the Internal Revenue Bulletin annually by the Internal Revenue Service.

SRC: PROP L4871-4879 | [proposed-reg: not final]

**F31. Operative text for computing the limit, and the preamble's publication plan.**

(a) The operative paragraph says AMGI "means the income limit determined based on area median gross income and family size in accordance with section 8". The preamble says the IRS "anticipates publishing the applicable limitations by geographic area and family size annually". Neither says when the first table will appear, which HUD fiscal year it will use, or what SGOs should do before it exists.

> (ii) Household income requirement--(A) Area median gross income. For purposes of computing the household income limit under section 25F(c)(2)(A) of 300 percent of area median gross income, area median gross income means the income limit determined based on area median gross income and family size in accordance with section 8 of the United States Housing Act of 1937 (Section 8).

SRC: PROP L5494-5499 | [proposed-reg: not final]

> Accordingly, proposed Sec. 1.25F-3(c)(6) would require determining area median gross income and household income in a manner that generally is consistent with determinations under Section 8, including adjustments for family size. To assist SGOs in verification of household income, the IRS anticipates publishing the applicable limitations by geographic area and family size annually in guidance published in the Internal Revenue Bulletin.

SRC: PROP L1186-1192 | [preamble/economic-analysis]

**F32. As of this research, no section 25F income-limit table has been published in the Internal Revenue Bulletin.**

(a) I downloaded Internal Revenue Bulletins 2026-38 (September 2026) through 2026-47 (dated November 16, 2026) from irs.gov and searched each for "25F", "scholarship granting", "area median gross", "10057" and "117199". There were no hits in any of them. The only occurrences of the word "scholarship" are in an unrelated proposed rule about private-school nondiscrimination policies in Bulletin 2026-39. So the bulletins through November 16, 2026 contain neither a section 25F income-limit table nor a reprint of T.D. 10057 or REG-117199-25. The IRS FSTC pages in the sources also contain no income-limit content. What an SGO should use before the IRS publishes: NOT IN SOURCES.

(c) Files `sources/extra/sgo_verif/irb_2026-38.txt` through `irb_2026-47.txt`; IRSMAIN; IRSIND; IRSST.

(d) `[derived]` from `[IRS web page]` material. Re-check https://www.irs.gov/irb before launch.

**F33. Treasury's formula and the family-size multipliers.**

(a) `limit(area, n) = 3 x AMGI(area) x multiplier(n)`, with multipliers 0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32 for family sizes 1 to 8 and +0.08 for each person above 8. The table in the proposed rule is titled "Current HUD Family Size Multipliers" and cites HUD's FY 2026 methodology, so treat the multipliers as versioned data. This statement is in the economic analysis, not in the regulation text.

> To ensure consistency with the income limits used in section 42, the income limit must be calculated as the product of 300 percent of the area median gross income and the HUD family-size multiplier.

SRC: PROP L2755-2758 | [preamble/economic-analysis]

> For a household of four living in the same area, this income limit would be $300,000 (3 * $100,000 * 1.0).

SRC: PROP L2762-2763 | [preamble/economic-analysis]

> Notes: For each member of the family in excess of 8, the family size multiplier increases by 0.08.

SRC: PROP L2771 | [preamble/economic-analysis]

> 70% 80% 90% Base 108% 116% 124% 132%

SRC: HUDIL L245 | [HUD regulation/methodology]

Added by the fact-check pass. Treasury says it did not consider any other family-size adjustment:

> Other alternatives were not considered for purposes of section 25F, because the statute references the HUD definition of area median gross income, which uses the HUD family size multiplier.

SRC: PROP L2775-2778 | [preamble/economic-analysis]

**F34. The regulation text can be read two ways, and the two readings give different limits in most Texas counties.**

(a) Reading A (the economic-analysis example, F33): 3 x HUD area median family income x multiplier. Reading B: the regulation text says AMGI "means the income limit determined ... in accordance with section 8" (F31), and HUD says the tax-credit housing standard that section 25F borrows ("as such term is used in section 42") is built from HUD's very-low-income limit, which HUD floors, caps and adjusts. Under Reading B the 300% limit would be 6 x HUD's very-low-income (50%) limit for the family size.

Using the HUD FY 2026 Section 8 file for the 254 Texas county rows: the four-person figures differ (2 x `l50_4` is not equal to `median2026`) in 143 counties; Reading B is higher in 120 and lower in 23. Ninety-seven of the 168 nonmetropolitan Texas counties share the same four-person very-low-income limit of $41,850. That is half of $83,700, the Texas nonmetropolitan median in HUD's medians document (`hud/Medians-Methodology-FY26.txt` line 346), which fits HUD's rule that a limit is raised if it would be below 50% of the State nonmetropolitan median (HUDIL lines 91-92). Largest gap at four persons: Starr County, Reading A $116,100 versus Reading B $251,100. The big metros agree at four persons (Harris $312,000 under both; Dallas $363,300; Travis $403,200; Bexar $301,800) and differ by a few hundred dollars at other sizes because HUD rounds its limits up to the nearest $50.

Which reading the IRS table will follow: NOT IN SOURCES.

(c) Script `research/_scripts/sgo_tx_amgi_compare.py` run against XLSX. The companion file has the full table (its F38-F39).

(d) `[derived]`

> HUD also calculates median family incomes (MFIs) for every metropolitan area and nonmetropolitan county in the U.S. MFIs are an input into the income limit calculation and are based on a four-person household.

SRC: HUDIL L14-16 | [HUD regulation/methodology]

> HUD has used the very low-income limits as the basis for deriving other income limits

SRC: HUDIL L65-66 | [HUD regulation/methodology]

> Current standard is Section 8 very low-income standard [...] or 120 percent of that definition (i.e., the “60 percent” of [...] median standard)

SRC: HUDIL L379-381 | [HUD regulation/methodology]

**F35. Rounding and family sizes above eight in HUD's method.**

(a) HUD rounds its published income limits up to the nearest $50 and adds 8 percentage points per person above eight. Whether the IRS table will round, and how, is NOT IN SOURCES. Treasury's examples are unrounded.

> For each person over eight-persons, the four-person income limit should be multiplied by an additional 8 percent. (For example, the nine-person limit equals 140 percent [132 + 8] of the relevant four-person income limit.) HUD rounds income limits up to the nearest $50.

SRC: HUDIL L249-252 | [HUD regulation/methodology]

Added by the fact-check pass. HUD itself leaves rounding above eight persons to local agencies, so "HUD rounds up to $50" is not a uniform rule even inside HUD programs:

> Local agencies may round income limits for nine or more persons to the nearest $50, or they may use the un-rounded numbers.

SRC: HUDIL L252-253 | [HUD regulation/methodology]

**F36. The statutory chain behind "as such term is used in section 42".**

(a) Section 25F points to section 42; section 42(g)(4) applies section 142(d)(2); section 142(d)(2)(B)(i) says income and AMGI are determined consistently with Section 8 and "shall include adjustments for family size".

> ``The income of individuals and area median gross income shall be determined by the Secretary in a manner consistent with determinations of lower income families and area median gross income under section 8 of the United States Housing Act of 1937 (or, if such program is terminated, under such program as in effect immediately before such termination). Determinations under the preceding sentence shall include adjustments for family size.''

SRC: PROP L2741-2747 | [preamble/economic-analysis] (quoting section 142(d)(2)(B)(i))

**F37. Treasury's own eligibility estimates used HUD's Multifamily Tax Subsidy Project (MTSP) income limits, not the Section 8 file.**

(a) This hints that the IRS table may be built from the MTSP publication; that is speculation, and the sources do not say which HUD publication the IRS table will use. HUD's methodology confirms that the tax-credit program has its own income-limit publication, separate from the Section 8 file this build ingests. I could not download the MTSP page (huduser.gov returned an empty HTTP 202 response to a plain request; the fact-check pass got the same result on 2026-11-18), so the size of any difference between the MTSP and Section 8 figures for Texas is UNVERIFIED.

> Total household income was compared to 300% of area median gross income, as published by HUD.

SRC: PROP L2921-2922 | [preamble/economic-analysis]

> U.S. Department of Housing and Urban Development, Office of Policy Development and Research (PD&R). HUD Multifamily Tax Subsidy Project (MTSP) Income Limits.

SRC: PROP L2927-2929 | [preamble/economic-analysis] (footnote 16, the data source for the sentence above)

> A separate income limits publication is produced for this program.

SRC: HUDIL L385-386 | [HUD regulation/methodology] (Attachment 1, row for Multifamily Tax Subsidy Projects)

**F38. Which year's AMGI is compared with the prior-calendar-year income is not stated.**

(a) For an application in 2027 the income year is 2026. Whether the limit is the HUD FY 2026 figure, the figure in effect on the application date, or an IRS table labelled for a particular year: NOT IN SOURCES. The only timing statement is that AMGI "will be published ... annually" (F30).

### G. Permissible verification methods

**F39. Overview: two methods and two safe harbors, and why the lighter paths exist.**

(a) The categorical method and the safe harbors exist so SGOs do not have to collect "more sensitive household-income information than is necessary". This sentence is useful support for a data-minimising design.

> For purposes of verifying that a scholarship recipient satisfies the household income requirement, proposed Sec. 1.25F-3(c)(6) would require SGOs to use either the direct income verification method, the categorical eligibility verification method, or one of two safe harbors: the low-income-area tutoring and special-needs safe harbor, and the foster-child safe harbor. The categorical eligibility method, the low-income-area tutoring and special-needs safe harbor, and the foster-child safe harbor are intended to reduce burdens for families and SGOs by not requiring SGOs to collect more sensitive household-income information than is necessary if other reliable indicators of household income are present, while including administrable documentation and audit safeguards that will allow for the appropriate administration of section 25F.

SRC: PROP L1257-1269 | [preamble/economic-analysis]

Added by the fact-check pass. The economic analysis describes the safe harbors as alternatives to "a full, direct verification":

> The proposed regulations offer various methods SGOs may use to verify that a potential scholarship recipient meets the eligibility criteria set out in the statute, including safe harbors that do not require SGOs to conduct a full, direct verification of recipients' household income.

SRC: PROP L2506-2510 | [preamble/economic-analysis]

**F40. Direct income verification method (regulation text, quoted in full).**

(a) Parse of the sentence as written: income "may be verified through review of written documentation including" [pay stubs; prior-year Federal or State tax returns; IRS transcripts; Forms W-2; evidence of other income not reflected on such documents (such as evidence of child support and alimony not reported as income) or a certification that there is none], "or may be verified through other relevant data sources".

Three things follow from the text:
1. The document list is introduced by "including", so it is illustrative, not closed.
2. The "certification" in the regulation text is a certification that there is no other income beyond what the documents show. The text does not say who signs it; in context it is the applicant household.
3. "or may be verified through other relevant data sources" is a separate branch from "review of written documentation". The regulation text does not define "other relevant data sources", does not mention consent, and does not name any source.

> (iii) Permissible verification methods--(A) Direct income verification method. Under the direct income verification method, income may be verified through review of written documentation including pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not reflected on such documents (such as evidence of child support and alimony not reported as income) or a certification that there is none, or may be verified through other relevant data sources.

SRC: PROP L5521-5528 | [proposed-reg: not final]

**F41. Direct method as described in the preamble (quoted in full). It does not match the regulation text.**

(a) The preamble says the written documentation is "provided by scholarship applicants" and ends the list with "or a certification that would verify income through other relevant data sources". In the preamble version the data sources are reached through a certification and sit inside the list of applicant-provided documentation. In the regulation text (F40) the certification is about having no other income and data sources are a free-standing alternative. The spec for this build quotes the preamble version. Final regulations could resolve the mismatch either way.

> Under the direct income verification method, an SGO would verify income through review of written documentation provided by scholarship applicants, including pay stubs, prior year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not reflected on such documents (such as child support and alimony not reported as income), or a certification that would verify income through other relevant data sources.

SRC: PROP L1270-1276 | [preamble/economic-analysis]

**F42. Document types named for the direct method.**

| Document type (as named) | Notes from the sources |
|---|---|
| Pay stubs | No year qualifier in either passage. The income year is the prior calendar year (F13), so only pay stubs that show prior-year totals speak to the test. How to use partial-year stubs: NOT IN SOURCES |
| Prior-year Federal or State tax returns | Regulation text: "prior-year"; preamble: "prior year". Which forms or schedules: NOT IN SOURCES |
| IRS transcripts | Type of transcript (return, wage and income, account): NOT IN SOURCES |
| Forms W-2 | |
| Evidence of other income not reflected on such documents | Example given: child support and alimony not reported as income |
| A certification that there is none (regulation text) | Form, wording and signer: NOT IN SOURCES |
| Other relevant data sources | Undefined. See F40, F41, F43, F44 |

SRC: PROP L5521-5528 and L1270-1276 | [proposed-reg: not final] and [preamble/economic-analysis]

**F43. What stakeholders asked for, and what Treasury asked back. There is no specific request for comments on third-party or consent-based data sources.**

(a) I searched the proposed rule and the temporary regulations for "consent", "data source", "third party", "third-party", "vendor", "service provider", "contractor" and "agent". "Consent" appears only for electronic delivery of donor acknowledgements and for an SGO consenting to be listed. "Data source(s)" appears in the two direct-method passages of the proposed rule and in two unrelated footnotes. "Service provider", "contractor" and "agent" do not appear at all. "Vendor" appears only for digital wallets, for schools and vendors paid with scholarship money, and for service providers in the tutoring safe harbor. "Third party" and "third-party" appear for digital-wallet providers, for auditors, in the Paperwork Reduction Act phrase "third-party disclosure", and in one stakeholder suggestion about attesting to SGO compliance (F83). The specific requests for comment near the verification rules concern (i) other needs-based programs for the categorical method and (ii) the qualified digital wallet definition. The general requests are "all aspects of the proposed regulations" (F4) and less burdensome alternatives that still control fraud.

> Moreover, certain stakeholders suggested allowing SGOs to rely on eligibility determinations from other means-tested, public assistance programs. Other stakeholders suggested allowing SGOs to rely on a combination of tax returns, wage statements, and similar information in order to verify student eligibility.

SRC: PROP L1170-1174 | [preamble/economic-analysis]

> Comments are requested on the requirements in the proposed regulations, including specifically whether there are less burdensome alternatives that adequately mitigate the risk of fraud or improper payment of scholarships under section 25F.

SRC: PROP L4288-4291 | [preamble/economic-analysis] (Regulatory Flexibility Act section)

**F44. Treasury's own cost model for direct verification assumes a commercial employment-verification service.**

(a) The economic analysis prices direct verification at about $100 per application, using The Work Number (Equifax) at $46.95 per employer record. This is the only place the sources name a third-party income-data product. It is a cost assumption, not a statement that such a service satisfies the direct method, but it shows Treasury has that kind of verification in mind. My observation, not the source's: about $100 per application is the benchmark a verification product will be compared with.

> As of June 2026, The Work Number charges $46.95 to verify one employer record for the period of one calendar year. If each eligible student lives in a household where the adults collectively have two employer records per calendar year, verifying the sources of household income associated with the scholarship application will cost approximately $100.

SRC: PROP L2936-2941 | [preamble/economic-analysis] (footnote 17)

Added by the fact-check pass. The same footnote scales this up: about 6 million households with 10 million children aged 5 to 17 meet the categorical criteria in electing States, Treasury assumes 52% apply, and it values the avoided employment verifications at $520 million (the summary table puts all safe-harbor savings at $540 million a year; its cell reads "$540 million in saved eligibility verification costs, annually" across table lines PROP L3765-3768). The footnote cites the product page "Social Service Verification" of Equifax's The Work Number.

> If 52% of the children who are eligible to receive section 25F scholarships under this safe harbor apply to an SGO for a scholarship, the cost of conducting employment verifications for all of these applications will be $520 million.

SRC: PROP L2950-2953 | [preamble/economic-analysis] (footnote 17)

**F45. Categorical eligibility verification method (regulation text, quoted in full).**

(a) Elements: (1) written documentation, "such as an award letter"; (2) dated within the last 12 months; (3) confirming that an individual in the student's household; (4) "currently is approved for assistance from or participation in"; (5) one of five named programs: SNAP, TANF, WIC, Section 8 housing, SSI. The list of programs is closed in the proposed text ("or"). The unbalanced parenthesis after "(SSI)" is in the original.

> (B) Categorical eligibility verification method. Under the categorical eligibility verification method, income may be verified through written documentation, such as an award letter, dated within the last 12 months, confirming that an individual in the student's household currently is approved for assistance from or participation in Supplemental Nutrition Assistance Program (SNAP), Temporary Assistance for Needy Families (TANF), the Special Supplemental Nutrition Program for Women, Infants, and Children (WIC), Section 8 housing, or Supplemental Security Income (SSI)).

SRC: PROP L5529-5537 | [proposed-reg: not final]

**F46. Categorical method in the preamble (quoted in full), including the free and reduced-price lunch statement.**

(a) The preamble calls the categorical method a "safe harbor" that relies on "eligibility determinations that have already been made by government agencies". School-wide free or reduced-price lunch eligibility is "not considered adequate verification" because the determination must be on a household basis. The sentence addresses lunch programs "that apply to an entire school, rather than on an individual level". Whether an individually approved free or reduced-price meal application would be acceptable is not stated, and lunch programs are not among the five named programs.

> Under the categorical eligibility verification method, an SGO would verify that the household income did not exceed 300 percent of area median gross income through review of written documentation, such as an award letter, dated within the last 12 months, documenting that an individual in the student's household currently is approved for assistance from or participation in Supplemental Nutrition Assistance Program (SNAP), Temporary Assistance for Needy Families (TANF), the Special Supplemental Nutrition Program for Women, Infants, and Children (WIC), Section 8 housing, or Supplemental Security Income (SSI)). This safe harbor responds to comments requesting a streamlined eligibility method for eligible students who are highly unlikely to be members of a household with income above 300 percent of area median gross income, thus reducing administrative burden by relying upon eligibility determinations that have already been made by government agencies. Because the statute requires that this determination be made on a household basis, eligibility for participation in reduced-price or free lunch programs that apply to an entire school, rather than on an individual level, is not considered adequate verification for this purpose.

SRC: PROP L1277-1295 | [preamble/economic-analysis]

**F47. Treasury asks for comments on adding other needs-based programs. Medicaid, CHIP, EITC and school meals are not in the proposed list.**

> The Treasury Department and the IRS request comments on other needs-based programs, such as State or Tribal programs, that also should be included in this categorical eligibility verification method.

SRC: PROP L1296-1298 | [preamble/economic-analysis]

**F48. Things the categorical text leaves open.**

(a) All NOT IN SOURCES: the date from which "the last 12 months" is counted (application date, document-review date, award date or payment date); what "currently is approved" requires when the letter shows a certification period that has ended; what counts as "written documentation" other than an award letter (a benefits-portal printout, an EBT card, a notice of recertification); what the Section 8 equivalent of an "award letter" is; whether the SGO must independently confirm that the named person lives in the student's household; and whether family size must still be verified when the categorical method is used (the statute requires the SGO to verify "family size", F9, but the categorical paragraph speaks only of income).

**F49. Scale: Treasury estimates 36% of all students are covered by the categorical path.**

(a) The economic analysis describes the test as someone in the household who "currently benefits from" a listed program.

> First, the proposed regulations specify that, if an individual in a student's household currently benefits from specified needs-based benefit programs, then that student may be considered categorically eligible to receive a section 25F scholarship. The Treasury Department and the IRS estimate that 36% of all students are covered by this safe harbor rule.

SRC: PROP L2900-2905 | [preamble/economic-analysis]

**F50. Safe harbor for tutoring and special-needs services at schools in low-income areas (out of scope for v1; recorded so the engine can refuse it cleanly).**

(a) Applies only to scholarships for individual academic tutoring or special-needs services, where the school selects the students by need, and the school is in a HUD qualified census tract or certifies that at least 80% of its students live in one. Students are then treated as meeting the income requirement "whether or not the student's household income is verified". The SGO must obtain a third-party audit every year, with five listed certifications, and give it to the State.

> If an SGO provides scholarships to individual students at schools in a low-income area for individual academic tutoring, or for special needs services in the case of a special needs student, and the individual students receiving those services are selected by the school on the basis of the particular student's academic or other need, the recipient students will be treated as satisfying the requirements in section 25F(c)(2)(A) and Sec. 1.25F-1(a)(4), whether or not the student's household income is verified, if either:

SRC: PROP L5540-5548 | [proposed-reg: not final]

> (2) Requirements for safe harbor. An SGO using the safe harbor described in paragraph (c)(6)(iii)(C) of this section must annually obtain, and provide to the covered State, a third-party audit to certify that:

SRC: PROP L5555-5558 | [proposed-reg: not final]

**F51. Safe harbor for foster children (out of scope for v1).**

(a) A foster child is treated as meeting the income requirement without income verification. "Foster child" is defined by removal from a parent's or guardian's custody and placement under a child welfare agency. What document proves foster status: NOT IN SOURCES.

> (D) Safe harbor for foster children. An eligible student who is a foster child will be treated as satisfying the requirements in section 25F(c)(2)(A) and Sec. 1.25F-1(a)(4)(i)(A), whether or not the student's household income is verified.

SRC: PROP L5572-5575 | [proposed-reg: not final]

> (5) Foster child--(i) In general. The term foster child means a child who has been removed from the custody of a parent or legal guardian and placed under the care or placement authority of, or has become the legal responsibility of, a child welfare agency,

SRC: PROP L4884-4887 | [proposed-reg: not final]

### H. Recordkeeping, substantiation, audit, and what is reported to whom

**F52. There is no section 25F rule that lists which verification records to keep or for how long.**

(a) I searched the proposed rule and the temporary regulations for "retain", "retention" and "years" near recordkeeping language. The only retention statement is the generic Paperwork Reduction Act sentence below. The proposed rules treat SGO records as general tax records under section 6001 and say verification information is "maintained by SGOs in the normal course". A specific retention period: NOT IN SOURCES. A list of documents an SGO must retain per applicant: NOT IN SOURCES.

> Books or records relating to a collection of information must be retained if their contents may become material in the administration of any internal revenue law.

SRC: PROP L3835-3837 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> SGOs would need to keep records related to their scholarship granting activities to be able to provide the annual certification and information required by proposed Sec. 1.25F-4(d).

SRC: PROP L4011-4013 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> The general recordkeeping requirements for SGOs necessitated by these proposed regulations are considered general tax records under Sec. 1.6001-1(e).

SRC: PROP L4036-4038 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> Proposed Sec. 1.25F-4 would provide reporting and recordkeeping requirements for organizations for purposes of section 25F that supplement the general recordkeeping requirements under section 6001 imposed on all persons liable for a tax imposed under Title 26.

SRC: PROP L1586-1589 | [preamble/economic-analysis]

**F53. Students are expected to supply verification information and proof of State residency, and SGOs are expected to keep it.**

(a) Proof of State residency is a separate requirement from income verification, and the intake has to collect it. What counts as proof: NOT IN SOURCES (residency is "in accordance with State law", F70). Fact-check: the words "proof of their State residency" appear only in this Paperwork Reduction Act passage. The proposed regulation text of 1.25F-3(c)(7) does not use the word "proof"; it says the SGO "must ensure" awards go to students solely within the State and (c)(1)(v) says the SGO "Verifies" it. The same passage adds that Treasury expects students to supply this kind of information as a matter of course:

> The IRS anticipates that students customarily provide this or similar information when applying for scholarships.

SRC: PROP L4126-4132 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> Proposed Sec. 1.25F-3(c)(6) would require SGOs to verify students' annual household income and family size, which generally would necessitate students providing certain information for verification. Additionally, proposed Sec. 1.25F-3(c)(7) would require students to provide the SGO with proof of their State residency.

SRC: PROP L4122-4126 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> This information is disclosed by students and maintained by SGOs in the normal course of scholarship administration.

SRC: PROP L4132-4133 | [preamble/economic-analysis] (Paperwork Reduction Act section)

**F54. Annual certification to the IRS (proposed): the SGO certifies that it verified eligibility.**

(a) Each year the SGO must certify, among other things, that it "Verified that scholarships were awarded only to eligible students who were members of an eligible household". The person signing that certification needs something to rely on, and the evidence pack is meant to be that something (a product inference, not a statement in the sources). The full list of certifications is longer than the three quoted below: public-charity status, the segregated account and its books, the operational requirements of 1.25F-3(c), no awards to disqualified persons, location in each listing State, timely donor acknowledgements, and that the SGO commissioned the annual audit and gave the report to each listing State (Prop. Reg. 1.25F-4(d)(2)(i)(A) to (G), PROP L5900-5923), plus the eight operational items in (d)(2)(ii)(A)(1) to (8) (PROP L5927-5949). Who signs, and under what penalty, is NOT IN SOURCES.

> (4) Verified that scholarships were awarded only to eligible students who were members of an eligible household and who were eligible to enroll at a public elementary or secondary school;

SRC: PROP L5933-5935 | [proposed-reg: not final]

> (5) Verified that the recipient eligible students were solely within the State;

SRC: PROP L5936-5937 | [proposed-reg: not final]

> (6) Awarded scholarships with a priority (as provided in Sec. 1.25F-3(c)(8)) for eligible students awarded a scholarship for the previous school year and, thereafter, for any eligible students who have a sibling who was awarded a scholarship from such SGO;

SRC: PROP L5938-5941 | [proposed-reg: not final]

**F55. Annual information report to the IRS (proposed): counts and aggregates, no student-level data.**

(a) Items: number of students that applied; number selected under the tutoring safe harbor; number of scholarships awarded; highest, lowest and average award; number of schools at which recipients were enrolled; aggregate data by category of qualified expense; income; amounts spent and 90% percentages. All are aggregates, reported for the SGO's taxable year (or the part of it during which it was an SGO), not the calendar year. None of the named items (A) to (J) asks for applicant names, incomes or documents. Fact-check: the list is not closed. Item (K) is "Any other information required in accordance with guidance", so the IRS can add items later, and nothing in the sources rules out method-level or student-level data in a future form. A single-State SGO using the 85% safe harbor reports these items for its section 25F segregated account, and a multistate SGO reports them separately for each State account (Prop. Reg. 1.25F-4(d)(3)(ii) and (iii), PROP L6000-6009). Treasury says the information is meant to help States, the IRS and prospective donors (see the quote at the end of this fact), which suggests it will be visible beyond the IRS; whether the form will be public is NOT IN SOURCES.

> (A) The number of students that applied for a scholarship;

SRC: PROP L5976 | [proposed-reg: not final]

> (B) The number of students selected for a scholarship in accordance with the safe harbor in Sec. 1.25F-3(c)(6)(iii)(C);

SRC: PROP L5977-5978 | [proposed-reg: not final]

> (C) The number of scholarships awarded;

SRC: PROP L5979 | [proposed-reg: not final]

> (D) The highest, lowest, and average amount of the scholarships awarded;

SRC: PROP L5980-5981 | [proposed-reg: not final]

> (E) The number of schools at which the scholarship recipients were enrolled;

SRC: PROP L5982-5983 | [proposed-reg: not final]

> (F) Aggregate data on each category of qualified elementary and secondary education expenses for which scholarship funds were used;

SRC: PROP L5984-5985 | [proposed-reg: not final]

> (G) The amount of the organization's income;

SRC: PROP L5986 | [proposed-reg: not final]

> (K) Any other information required in accordance with guidance.

SRC: PROP L5999 | [proposed-reg: not final]

> The information described in proposed Sec. 1.25F-4(d)(3) would assist States, the IRS, and taxpayers considering making a qualified contribution in determining the organization's compliance with the requirements of section 25F, its size, and its mission.

SRC: PROP L1772-1775 | [preamble/economic-analysis]

> The proposed regulations would add a new form on which an SGO must report information on its activities including the number of scholarship applicants, the number of scholarship recipients, the number of schools at which the SGO's scholarship recipients were enrolled, the dollar amount of the scholarships, and the categories of qualified elementary and secondary expenses for which scholarship funds were used. These metrics, which are detailed in Sec. 1.25F-4(d)(3) of the proposed regulations, can be used by States to verify that a particular SGO meets the requirements of section 25F(c)(5) and (d)(1).

SRC: PROP L3305-3314 | [preamble/economic-analysis]

**F56. When and how the annual certification and information are filed (proposed).**

(a) On a form the IRS will prescribe (the form number is NOT IN SOURCES), attached to the annual information return for SGOs that file one (the preamble names Form 990). An SGO that does not file one sends the form separately by the 15th day of the 5th month after the period closes. A copy goes to each State that lists the SGO.

> For organizations required to file an annual information return under section 6033(a), the required form must be included as an attachment. An organization that is not required to file an annual information return under section 6033(a) must provide this form separately to the IRS on or before the 15th day of the 5th calendar month following the close of the period for which the form reports the required certifications and information. Organizations must concurrently provide a copy of the form to each State on whose State SGO list the organization appears in accordance with guidance.

SRC: PROP L6014-6022 | [proposed-reg: not final]

**F57. Annual audit (proposed): who must be audited and by whom.**

(a) Every organization that was an SGO during any part of the preceding taxable year must undergo an annual "financial and programmatic audit" and give the results to each State that listed it. If total receipts for the most recent taxable year were more than $500,000, the auditor must be "an external, independent professional or accredited body that regularly assesses an organization's compliance, financial records, or processes (including internal controls) against specific standards". At $500,000 or less, a committee of independent persons unrelated to management may do it, and the report is signed under penalties of perjury. The text does not use the words "CPA" or "certified public accountant" (confirmed by search of both rule documents). Fact-check notes: (1) the perjury-signature sentence sits inside the paragraph for organizations at or below $500,000; whether the external auditor's report must also be signed that way is not stated. (2) The two paragraphs measure receipts differently: "the most recent taxable year" for the over-$500,000 rule and "the taxable year" for the committee option. (3) The threshold counts all receipts of the organization, "whether or not required to be deposited into its section 25F segregated account". (4) The duty falls on each organization "that was an SGO during any part of the preceding taxable year". The text does not state in terms which period the audit must cover, and a due date for the audit or for delivering it to the State is NOT IN SOURCES.

> (e) Required audits--(1) In general. Each organization that was an SGO during any part of the preceding taxable year must undergo an annual financial and programmatic audit by a qualified independent third party and provide the audit results to each covered State on whose State SGO list the SGO appeared (or, if a multistate SGO, to each covered State on whose State SGO list the SGO appeared).

SRC: PROP L6023-6028 | [proposed-reg: not final]

> An organization whose total receipts (whether or not required to be deposited into its section 25F segregated account) for the most recent taxable year were more than $500,000 must hire an external, independent professional or accredited body that regularly assesses an organization's compliance, financial records, or processes (including internal controls) against specific standards to perform the audit required by this paragraph (e).

SRC: PROP L6030-6036 | [proposed-reg: not final]

> An organization whose total receipts for the taxable year did not exceed $500,000 may use a committee of independent persons unrelated to the organization's management to conduct the audit required by this paragraph (e). The report must be signed under penalties of perjury by the persons preparing such report.

SRC: PROP L6037-6042 | [proposed-reg: not final]

**F58. What the audit must cover (proposed). Eligibility verification is the first item.**

(a) Fact-check correction: the first pass said the audit "covers procedures, not a re-verification of every family". That is too narrow. Items (i) to (iv) are about procedures and methods, but items (v) to (vii) are worded as "Verification that" something was actually so, and item (vii) is "Verification that the organization met all of the operational requirements in Sec. 1.25F-3(c)", which includes the duty to verify that awards went only to eligible students. How an auditor is to do that (sampling, re-performance, review of each file) is NOT IN SOURCES. Build the evidence pack so that an auditor can test individual files, not only read a procedure document. The seven items: (i) procedures for soliciting applications, "for verifying each such student's eligibility", and for processing applications; (ii) selection procedures, including priority and disqualified-person screening; (iii) procedures for setting award amounts; (iv) methods for tracking how scholarship money is paid; (v) verification that expenses were qualified; (vi) that the SGO is located in the State; (vii) that all operational requirements were met. Items (i) to (vi) are audited at the section 25F segregated-account level.

> (i) The organization's procedures for soliciting scholarship applications or otherwise identifying possible scholarship recipients from eligible students in the State, for verifying each such student's eligibility, and for processing scholarship applications;

SRC: PROP L6045-6048 | [proposed-reg: not final]

> (ii) The organization's procedures for selecting scholarship recipients, including procedures to establish priority for students previously awarded a scholarship and then any eligible students who have a sibling who was awarded a scholarship from such organization, and procedures to prevent the award of a scholarship to a disqualified person as defined in Sec. 1.25F-3(d);

SRC: PROP L6049-6054 | [proposed-reg: not final]

> (vii) Verification that the organization met all of the operational requirements in Sec. 1.25F-3(c).

SRC: PROP L6065-6066 | [proposed-reg: not final]

> Thus, the audit regarding items described in paragraphs (e)(3)(i) through (vi) of this section should be done at the section 25F segregated account level, but the audit regarding the items described in paragraph (e)(3)(vii) of this section should be done consistent with the operational requirements set forth in Sec. 1.25F-3(c)(1), (2), or (3), as applicable to the SGO.

SRC: PROP L6070-6075 | [proposed-reg: not final]

**F59. Treasury's audit cost estimate.**

(a) $10,000 to $30,000 a year per SGO. Useful context for pricing and for the pitch that an audit-ready evidence file lowers audit effort (the pitch itself is not from the sources).

> The Treasury Department and the IRS estimate that audit costs faced by an SGO may range between $10,000 and $30,000 annually. Approximately 53% of SGOs are estimated to exceed the $500,000 receipts threshold; these organizations will consequently pay higher audit costs of approximately $30,000 per year.

SRC: PROP L3616-3620 | [preamble/economic-analysis]

**F60. What goes to the State.**

(a) From the SGO: the annual audit results (F57), a copy of the annual certification and information form (F56), the tutoring safe-harbor audit if used (F50), and whatever "application, documentation, and financial reporting" the State requires. The State's requirements must be "reasonably tailored" to support its certifications and to prevent fraud such as duplicate awards. During the transition period before an SGO has filed its first annual report, the State may rely on the SGO's governing documents and written policies, which must "expressly require" the SGO to satisfy the operational requirements. An SGO's written verification procedure is therefore a listing document in year one. Texas's own SGO application and documentation requirements are NOT IN SOURCES (see F85).

> (ii) Require SGOs to comply with application, documentation, and financial reporting requirements that are reasonably tailored to:

SRC: TEMP L2034-2035 | [temporary-reg: in force]

> (B) Facilitate the prevention and detection of fraud or abuse, including the misuse of scholarship funds, such as through the duplication of scholarship awards to the same student for the same qualified elementary or secondary education expense.

SRC: TEMP L2038-2041 | [temporary-reg: in force]

> (ii) Determine that the SGO's provisions, policies, and procedures expressly require (beyond a general requirement to comply with applicable law) the SGO to satisfy the operational requirements for an SGO in section 25F(d);

SRC: TEMP L1897-1900 | [temporary-reg: in force]

**F61. Consequence of failing: removal from the IRS SGO list.**

(a) The IRS may remove an SGO that fails a section 25F requirement (income verification is one) or the reporting, recordkeeping or audit requirements. The State may also remove it, through a due-process procedure, if it does not satisfy section 25F(c)(5) or (d). Fact-check: the first pass said removal "ends the SGO's ability to receive credit-eligible gifts" without support. The supported statement is narrower: contributions made after the removal date are not treated as qualified contributions; contributions made before it may still qualify. An IRS removal determination can be taken to the IRS Independent Office of Appeals. See F91 for the quotes.

> The IRS may remove an organization from the IRS SGO list following a determination that the organization has failed to comply with a requirement of section 25F (other than the tax-exempt status requirement in section 25F(c)(5)(A)) or has failed to comply with the applicable reporting, recordkeeping, or audit requirements, including a failure to report qualified contributions in accordance with Sec. 1.25F-4T(c).

SRC: TEMP L1989-1995 | [temporary-reg: in force]

**F62. The segregated account needs its own complete books and records.**

> (2) Prevents the co-mingling of qualified contributions with other amounts by maintaining a section 25F segregated account, which must contain only qualified contributions and the earnings therefrom, depositing all qualified contributions into its section 25F segregated account, and maintaining a complete set of books and records for its section 25F segregated account;

SRC: PROP L5308-5313 | [proposed-reg: not final]

### I. Other SGO requirements that affect product copy

**F63. What an SGO is.**

(a) A section 501(c)(3) public charity (not a private foundation) that keeps qualified contributions in a separate account, meets the operational requirements, awards nothing to disqualified persons, is on a covered State's list, and (proposed) meets the reporting and recordkeeping rules.

> is described in section 501(c)(3) and exempt from tax under section 501(a), and

SRC: STAT L177 | [statute]

> which prevents the co-mingling of qualified contributions with other amounts by maintaining one or more separate accounts exclusively for qualified contributions,

SRC: STAT L183 | [statute]

**F64. Scholarships to 10 or more students who do not all attend the same school.**

(a) "School" takes the section 530(b)(3)(B) meaning: a school providing K-12 education as determined under State law. Relevance for the camp handoff: an SGO whose recipients all come through one establishment still needs at least 10 recipients who do not all attend the same school. The statute and the proposed regulation text state no period for the count of 10. The economic analysis paraphrases it as "at least 10 students per year" (PROP L2476-2479), the annual certification is made "with respect to its taxable year", and a single-State SGO on the 85% safe harbor or a multistate SGO tests it per section 25F segregated account (F88).

> such organization provides scholarships to 10 or more students who do not all attend the same school,

SRC: STAT L194 | [statute]

> (17) School. The term school has the definition set forth in section 530(b)(3)(B) and any guidance issued thereunder.

SRC: PROP L4968-4969 | [proposed-reg: not final]

**F65. At least 90% of the organization's income must be spent on scholarships for eligible students.**

(a) "Income" is total gross receipts from all sources on the cash method, unreduced by expenses. A single-State SGO whose activities are at least 85% scholarship granting may test the 90% rule against the section 25F segregated account only. For a multistate SGO the 85% activity level is a requirement, not an option, and the 90% test runs separately on each State's account (F88). The test for a year's income is met by the last day of the following taxable year. A scholarship paid to a student who turns out not to be eligible would not be spending "on scholarships for eligible students", so verification errors also threaten the 90% test (that consequence is my inference from the wording, not a statement in the sources).

> such organization spends not less than 90 percent of the income of the organization on scholarships for eligible students,

SRC: STAT L197 | [statute]

> (ii) Income of the organization--(A) In general. Except as provided in paragraph (c)(4)(ii)(B) of this section, income of the organization means the total gross receipts of the organization from all sources computed using the cash receipts and disbursements method of accounting under section 446(c)(1) and Sec. 1.446-1(c)(1)(i) during its annual accounting period, unreduced by any expenses, regardless of the overall method used by the organization in its books and records.

SRC: PROP L5397-5403 | [proposed-reg: not final]

> If at least 85 percent of a single-State SGO's activities consist of scholarship granting activities (whether pursuant to section 25F, in accordance with State tax credit scholarship rules, or any other scholarship granting activities), then the SGO may apply the operational requirements of paragraph (c)(1) of this section to the organization's section 25F segregated account, rather than to the organization as a whole.

SRC: PROP L5349-5356 | [proposed-reg: not final]

> An organization must meet the 90 percent of income spending requirement as of the last day of the taxable year following the taxable year in which such income is received, including an organization's short period as set forth in section 443.

SRC: PROP L5417-5420 | [proposed-reg: not final]

**F66. Verification costs come out of a thin overhead budget.**

(a) Treasury's data: existing SGOs spent on average 78% of revenue on program expenses, and 72% of them spend less than 90%. Any verification fee an SGO pays out of income that is inside the 90% test counts against the 10% that is not scholarships (this file's inference from the definition of the test; the sources do not discuss verification fees). The 78% and 72% figures describe organizations that currently run State-level scholarship programs, not section 25F SGOs, which do not exist yet.

> program-related expenditures represented 78% of total revenues, on average, in fiscal year 2024. Analysis of Form 990-series data reveals that 72% of existing SGOs spend less than 90% of revenue on program-related expenditures.

SRC: PROP L3134-3137 | [preamble/economic-analysis]

> This proposed regulation would allow SGOs to spend more than 10% of their income on overhead or other expenses if such income is not part of the section 25F segregated account.

SRC: PROP L3128-3131 | [preamble/economic-analysis]

**F67. Designated gifts go into the segregated account and the designation cannot be revoked.**

> A contribution designated by a donor as a qualified contribution would need to be deposited in this section 25F segregated account regardless of whether the donor ultimately receives a tax credit for the qualified contribution. Once a qualified contribution is designated as such by a donor, neither the donor nor the recipient organization would be permitted to revoke such designation to reduce administrative burden and provide certainty.

SRC: PROP L858-864 | [preamble/economic-analysis]

**F68. No earmarking for a particular student.**

(a) The statute and the proposed regulation use the same words and add no examples. Whether a donor may express a preference for a school, a program or a camp, as opposed to a named student, is NOT IN SOURCES. Any flow in which a specific donor's gift is tied to a specific family's scholarship (for example a camp, relative or employer funding "this child") is, on this file's reading of the words "on behalf of any particular student", the pattern the rule forbids; the sources give no example. Related context on donors' relatives and on private benefit is in F89 and F97.

> such organization does not earmark or set aside contributions for scholarships on behalf of any particular student, and

SRC: STAT L210 | [statute]

> (vii) Does not earmark or set aside contributions for scholarships on behalf of any particular student.

SRC: PROP L5346-5347 | [proposed-reg: not final]

**F69. No scholarships to disqualified persons.**

(a) Disqualified persons are: substantial contributors (more than $5,000 in the taxable year and more than 2% of total contributions to the SGO, or to the section 25F segregated account, with spouses' gifts combined); officers, directors and trustees; anyone who takes part in selecting recipients or setting awards; and family members of any of these. Family means the individual's spouse; ancestors and descendants of the individual or of the individual's spouse (descendants include legally adopted children and step-children); siblings of the individual or of the individual's spouse; descendants of those siblings; and the spouse of any of those people. Working that backwards (my derivation), a student is a disqualified person if a parent, step-parent, grandparent, sibling, aunt, uncle or similar relative in those degrees is a substantial contributor, an officer, director or trustee, or takes part in selection. The SGO therefore needs the names of the student's close relatives to screen against its own donor and insider lists. The proposed rule does not say how an SGO must screen. Fact-check: three parts of the rule were missing here and change how screening has to work. Substantial-contributor status is fixed only at the close of the SGO's taxable year, it lasts through the following taxable year, and there is a narrow exception for awards made before the donor crossed the threshold. See F89.

> A scholarship granting organization may not award a scholarship to any disqualified person.

SRC: STAT L222 | [statute]

> (d) Disqualified person--(1) In general. The term disqualified person means, with respect to an SGO, a person who is: (i) A substantial contributor to the SGO or to the section 25F segregated account, as defined in paragraph (d)(2) of this section; (ii) An officer, director, or trustee of the SGO, as well as an individual having powers and responsibilities similar to those of such persons; (iii) Any individual participating in, including as a member of a committee, the selection of scholarship recipients or the determination of scholarship awards; and (iv) A member of the family, as defined in paragraph (d)(3) of this section, of any individual described in paragraph (d)(1)(i), (ii), or (iii) of this section.

SRC: PROP L5639-5651 | [proposed-reg: not final]

> (2) Substantial contributor--(i) In general. The term substantial contributor means any person who contributed an aggregate amount of more than $5,000 to the SGO during the taxable year, if such amount is more than 2 percent of the total contributions received by the SGO during the taxable year. For this purpose, an individual will be treated as making all contributions made by his or her spouse.

SRC: PROP L5652-5657 | [proposed-reg: not final]

> (3) Member of the family--(i) In general. The family of any individual includes only: (A) The individual's spouse; (B) The ancestors and descendants of the individual or the individual's spouse; (C) The siblings of the individual or the individual's spouse; (D) The descendants of siblings described in paragraph (d)(3)(i)(C) of this section; and (E) The spouse of any individual described in paragraph (d)(3)(i)(B), (C), or (D) of this section.

SRC: PROP L5676-5685 | [proposed-reg: not final]

**F70. "Students solely within the State" means the student resides in the listing State under State law.**

(a) A Texas-listed SGO can award from its Texas account only to students who reside in Texas under Texas law. Attending school in Texas, or buying services in Texas, is not enough. Two exceptions: a dependent of a member of the Armed Forces is treated as within both the student's State of domicile and the State where the service member resides; a dependent of an individual residing on Indian Lands is treated as within both the State of residence and the State of school attendance.

> Except as provided in paragraph (c)(7)(ii) of this section, an eligible student is considered solely within a State only if the eligible student resides in that State in accordance with State law. Attending school in a State or purchasing goods or services in a State is not sufficient to treat the student as being solely within a State.

SRC: PROP L5579-5584 | [proposed-reg: not final]

> (ii) Exceptions. A student who is a dependent (as defined in section 152) of a member of the Armed Forces of the United States will be treated as solely within both the State of the domicile of the student and the State in which that member of the Armed Forces is residing. In addition, a student who is a dependent (as defined in section 152) of an individual residing on Indian Lands (as defined in 25 U.S.C. 3501(2)) will be treated as solely within both the State of the student's residence and the State in which the student attends school.

SRC: PROP L5585-5596 | [proposed-reg: not final]

**F71. SGOs must run fraud controls, including duplicate-award detection.**

(a) The target is the same student receiving awards for the same expense that together exceed the cost. An SGO can only detect this across SGOs with some shared signal, which the rules do not provide.

> An SGO must implement reasonable procedures for the prevention and detection of fraud and abuse, including systems to prevent and detect the duplication of scholarship awards to the same student for the same qualified elementary or secondary education expense that collectively exceed the cost of the expense.

SRC: PROP L5442-5447 | [proposed-reg: not final]

**F72. Because an SGO is a public charity, it may fund only expenses reasonably necessary to its charitable purpose, even inside the qualified-expense definition.**

> however an SGO must award scholarships only for those expenses that are reasonably necessary to further the organization's charitable exempt purposes.

SRC: PROP L1109-1111 | [preamble/economic-analysis]

**F73. A State may not make SGOs operate more restrictively than section 25F does.**

(a) A State cannot limit the type of school or the types of qualified expenses. This rule is in the temporary regulation text (effective December 1, 2026), so it does not depend on the proposed regulations being finalized. The temporary text measures "more restrictive" against section 25F(c)(5); the proposed version adds "and Sec. 1.25F-3(b) and (c)" (PROP L6470-6476).

> A State may not require SGOs to operate in a manner that is more restrictive than the requirements set forth in section 25F(c)(5), such as by limiting the type of school that scholarship recipients may attend or the types of qualified elementary or secondary education expenses for which scholarship funds may be used.

SRC: TEMP L2046-2050 | [temporary-reg: in force]

### J. Qualified expenses, "school", payment methods, digital wallet

**F74. Qualified elementary or secondary education expense = an expense described in section 530(b)(3)(A).**

> The term “qualified elementary or secondary education expense” means any expense of an eligible student which is described in section 530(b)(3)(A).

SRC: STAT L172 | [statute]

> (14) Qualified elementary or secondary education expense. The term qualified elementary or secondary education expense means any expense of an eligible student that is described in section 530(b)(3)(A) and any guidance thereunder.

SRC: PROP L4957-4960 | [proposed-reg: not final]

**F75. Text of section 530(b)(3)(A) and (B) (from Cornell LII, fetched for this file).**

(a) Three categories. (i) Tuition, fees, academic tutoring, special needs services, books, supplies and other equipment "incurred in connection with the enrollment or attendance" of the student at a public, private or religious school. (ii) Room and board, uniforms, transportation, and "supplementary items and services (including extended day programs)" which are "required or provided by" a public, private or religious school in connection with enrollment or attendance. (iii) Computer technology, equipment and Internet access used by the student and family during the years the student is in school. "School" means a school providing K-12 education as determined under State law.

> expenses for tuition, fees, academic tutoring, special needs services in the case of a special needs beneficiary, books, supplies, and other equipment which are incurred in connection with the enrollment or attendance of the designated beneficiary of the trust as an elementary or secondary school student at a public, private, or religious school

SRC: USC530 L182 | [statute] (26 U.S.C. 530(b)(3)(A)(i), which section 25F(c)(4) incorporates by reference; Cornell LII text, re-fetched and found identical by the fact-check pass. The first pass tagged this `[secondary/web]`, which understated it: it is statutory text, though it is not section 25F guidance)

> expenses for room and board, uniforms, transportation, and supplementary items and services (including extended day programs) which are required or provided by a public, private, or religious school in connection with such enrollment or attendance, and

SRC: USC530 L185 | [statute] (26 U.S.C. 530(b)(3)(A)(ii))

> expenses for the purchase of any computer technology or equipment or Internet access and related services, if such technology, equipment, or services are to be used by the beneficiary and the beneficiary’s family during any of the years the beneficiary is in school.

SRC: USC530 L188 | [statute] (26 U.S.C. 530(b)(3)(A)(iii))

Added by the fact-check pass. The flush sentence after clause (iii), which limits the technology category:

> Clause (iii) shall not include expenses for computer software designed for sports, games, or hobbies unless the software is predominantly educational in nature.

SRC: USC530 L190 | [statute] (26 U.S.C. 530(b)(3)(A), flush language)

**F76. Every category depends on a connection to a K-12 school.**

> Each of the three categories of expenses described in section 530(b)(3)(A) depends on the student's enrollment or attendance at, or otherwise being in, a school.

SRC: PROP L474-477 | [preamble/economic-analysis]

**F77. Summer camps, after-school programs and microschools are not addressed. The only "summer" sentence is about timing of an award.**

(a) I searched the proposed rule and the temporary regulations for "camp", "after-school", "afterschool", "microschool", "extended day", "homeschool" and "summer". "Camp", "after-school", "microschool" and "extended day" do not appear. "Homeschool" appears once, in a footnote about parent preferences. "Summer" appears once, in the example below, which is about a student receiving a scholarship in the summer and incurring expenses "in connection with enrollment in a school later that year". Whether a summer camp is a qualified expense: NOT IN SOURCES. The statutory hooks that would have to carry it are "academic tutoring ... in connection with the enrollment or attendance" (section 530(b)(3)(A)(i)) and "supplementary items and services (including extended day programs) which are required or provided by a ... school" (section 530(b)(3)(A)(ii)). The second hook requires that a school require or provide the service.

> For example, a student who is eligible to enroll in a public school may receive a scholarship during the summer before the school year begins and incur qualified elementary or secondary education expenses in connection with enrollment in a school later that year.

SRC: PROP L499-503 | [preamble/economic-analysis]

**F78. Tutoring is an expressly contemplated scholarship type.**

> an SGO may choose to specialize in providing one type of qualified expense--e.g., academic tutoring for qualified students in public schools--but the State cannot condition inclusion on the SGO list on the State's approval of such a choice.

SRC: PROP L3370-3373 | [preamble/economic-analysis]

**F79. Guidance on which expenses qualify and what a "school" is will come separately, under section 530.**

(a) Until that guidance exists, product copy should not state that any vendor type other than a K-12 school's tuition and fees is a qualified expense.

> The Treasury Department and the IRS have received many comments requesting guidance under section 530(b)(3) that will clarify the meaning of qualified expenses and schools and intend to issue that guidance as soon as possible so that taxpayers may rely on it.

SRC: PROP L504-507 | [preamble/economic-analysis]

> Such guidance will be issued separately under section 530. As indicated previously, the Treasury Department and the IRS are working on the development of that guidance and are treating the issuance of that guidance as a high priority.

SRC: PROP L1145-1148 | [preamble/economic-analysis]

**F80. How scholarship money may be paid (proposed). Four allowed routes.**

(a) (1) No money to the family except a "qualified reimbursement" backed by a receipt and a duplicate-payment check. (2) Tuition, fees, room and board and similar charges by the school must be paid directly to the school, which must return overpayments. (3) Other vendors may be paid directly if the vendor has been verified as an appropriate provider, is not related directly or indirectly to the recipient, and must refund overpayments and erroneous payments. (4) A qualified digital wallet.

For a camp or tutoring vendor in the booking handoff this means: the SGO pays the vendor directly or through a qualified digital wallet, or the family pays and is reimbursed against a receipt; on the direct-pay route the vendor has to have been "verified as an appropriate provider", cannot be related "directly or indirectly" to the recipient, and must be "required to reimburse" excess or erroneous payments. Fact-check: the first pass said "contractually bound" and left out the reimbursement route. The text does not say how the reimbursement requirement is imposed (contract, policy or otherwise), who verifies a vendor as appropriate or by what standard, or what "related, directly or indirectly" covers. All three are NOT IN SOURCES. All of this assumes the expense is a qualified expense in the first place, which for camps is unsettled (F77).

> An SGO will not be treated as satisfying this paragraph (c)(5)(ii) if money is paid to the family of the eligible student, unless the payment is a qualified reimbursement, meaning a reimbursement of expenses for which the family of the eligible student provides a receipt that verifies both that the payment was made and that the expense is a qualified elementary or secondary education expense and, before making the reimbursement, the SGO satisfies its procedures to prevent a single expense from being reimbursed for more than the total cost by more than one source.

SRC: PROP L5453-5465 | [proposed-reg: not final]

> (iii) Direct payments to the school. Scholarship funds used for payments for tuition, fees, room and board, and other similar expenses described in section 530(b)(3)(A) that are charged by the school must be paid directly to the school. The school must return any payments from the SGO that are in excess of the student's costs or that are disbursed by the SGO in error.

SRC: PROP L5466-5471 | [proposed-reg: not final]

> (iv) Paying other vendors directly. An SGO will be considered to meet the requirements of this section if it pays a vendor directly for expenses described in section 530(b)(3)(A) and the vendor: (A) Has been verified as an appropriate provider of such services or items; (B) Is not related, directly or indirectly, to the scholarship recipient; and (C) Is required to reimburse the SGO for any payments from the SGO that are in excess of the student's costs or that were disbursed by the SGO in error.

SRC: PROP L5472-5481 | [proposed-reg: not final]

> (v) Qualified digital wallet. An SGO will be considered to meet the requirements of this section if it uses a qualified digital wallet to pay qualified elementary or secondary education expenses.

SRC: PROP L5482-5484 | [proposed-reg: not final]

**F81. Qualified digital wallet: definition, and how it interacts with the 90% rule.**

(a) An electronic payment platform run by a third-party provider that takes purchase requests from families, tracks approved expenses, and keeps controls by pre-approving vendors and either paying vendors directly or requiring timely receipts. It is a tool for verifying that money was spent on qualified expenses. It has nothing to do with income verification. Money moved to a wallet counts as spent on the transfer date only if the SGO does not keep ownership of it. Treasury asks for comments on the definition.

> (13) Qualified digital wallet. The term qualified digital wallet means an electronic payment platform in which a third-party provider provides a streamlined interface for managing the administration of section 25F scholarships by having eligible students and their families submit purchase requests, tracking approved expenses, and maintaining controls to ensure that all payments are made for qualified elementary or secondary education expenses by pre-approving vendors and paying vendors directly or requiring timely submission of receipts.

SRC: PROP L4949-4956 | [proposed-reg: not final]

> Further, provided an SGO does not retain ownership of funds transferred to a third party for disbursement through a qualified digital wallet, the SGO will be treated as having spent the transferred funds as of the date of transfer for purposes of the 90 percent of income spending requirement.

SRC: PROP L1035-1039 | [preamble/economic-analysis]

> The Treasury Department and the IRS request comments on this definition of qualified digital wallet and whether additional safe harbors for verification that scholarships are spent on qualified elementary or secondary education expenses should be included in the final regulations.

SRC: PROP L404-408 | [preamble/economic-analysis]

**F82. Scholarships from SGOs are excluded from the recipient's gross income (section 139K).**

(a) For family-facing copy: the sources say amounts received after December 31, 2026 under SGO scholarships for qualified expenses of eligible students are excluded from gross income. Do not go further than that sentence in copy.

> section 139K, as added by section 70411(b) of the OBBBA, excludes from the gross income of individuals or their dependents any amounts received after December 31, 2026, pursuant to SGO-provided scholarships for qualified elementary or secondary education expenses of eligible students.

SRC: PROP L187-191 | [preamble/economic-analysis]

### K. Third-party service providers and vendors used by SGOs

**F83. The sources say nothing about an SGO using a vendor to perform income verification.**

(a) Searched terms and results are in F43. The rules place every duty on the SGO: the SGO "must use one or more of the methods" (F10) and the SGO certifies that it "Verified" (F54). Nothing says the duty can or cannot be performed through a contractor, nothing sets conditions for a vendor (independence, licensing, data handling), and nothing says an SGO may rely on a vendor's determination. The third parties the rules do contemplate are: digital-wallet providers for expense verification (F81), auditors (F57), the school in the tutoring safe harbor (F50), and government agencies whose benefit determinations the categorical method relies on (F46). Treasury's cost estimate for direct verification assumes a paid commercial service (F44).

> In response to Notice 2025-70, stakeholders asked that SGOs be allowed to verify that scholarships are spent on qualified elementary or secondary education expenses by using a third-party vendor that verifies the expenses and prevents duplication, which stakeholders referred to as a digital wallet.

SRC: PROP L389-393 | [preamble/economic-analysis]

(a, continued) The closest the preamble comes to third-party verification of an SGO's compliance is a stakeholder suggestion that "an approved third party" could attest that the SGO complied. Treasury's answer was the SGO's own annual certification plus the independent audit (F54, F57). It did not create an approved-third-party role.

> Other stakeholders insisted that an SGO's self-attestation alone should not be sufficient, but suggested that an individual responsible for the operation of the SGO, or an approved third party, could attest that the SGO complied with all statutory requirements.

SRC: PROP L1693-1697 | [preamble/economic-analysis]

**F84. The IRS web page describes verification as an SGO qualification requirement and recordkeeping as an ongoing duty.**

> Meet specific requirements for awarding scholarships, managing contributions, and verifying student eligibility,

SRC: IRSMAIN L39 | [IRS web page]

> Once qualified, SGOs must meet ongoing financial, recordkeeping, donor acknowledgment, and IRS reporting requirements, including registering and reporting through the FSTC SGO Portal.

SRC: IRSMAIN L42 | [IRS web page]

**F85. Texas has not published an SGO application process (secondary source).**

(a) So any Texas-specific documentation or verification requirement for SGOs is unknown. The fact-check pass re-fetched the page on 2026-11-18 and it still carries this text ("Last checked Nov 16, 2026"). This is a statement by a private website about what it could find, not an official statement by Texas; treat "Texas has no published SGO process" as UNVERIFIED against Texas's own sources, which were not in the source set. That Texas has elected to participate for 2027 is confirmed by the IRS (F98).

> No official §25F list yet. Texas is participating but has not published an application process that we have found.

SRC: EFTC L8 | [secondary/web]

**F86. At least one SGO software vendor already markets application intake, AMI thresholds and document storage (secondary source, competitor context).**

> One household application with document upload. Area median income thresholds are calculated for the family’s location and size, and every determination is recorded.

SRC: SGODESK L66 | [secondary/web]

### L. Facts added by the fact-check pass (material the first pass missed)

**F87. Every proposed section would apply only to taxable years ending on or after the final regulations are published.**

(a) The verification rules in Prop. Reg. 1.25F-3 and the certification and audit rules in Prop. Reg. 1.25F-4(d) and (e) bind no one today. Each proposed section ends with an applicability paragraph that has a blank for the publication date of the final regulations. Until then an SGO's only source of legal comfort for following them is the preamble's reliance statement (F3). Do not describe any proposed rule as a current requirement.

> Each of proposed Sec. Sec. 1.25F-1 through 1.25F-5 is proposed to apply to taxable years ending on or after the date on which the Treasury decision adopting these regulations as final regulations is published in the Federal Register.

SRC: PROP L2403-2406 | [preamble/economic-analysis]

> (e) Applicability date. This section applies to taxable years ending on or after [date of publication of the final regulations in the Federal Register].

SRC: PROP L5783-5785 | [proposed-reg: not final] (the applicability paragraph of Prop. Reg. 1.25F-3; 1.25F-4(f) at PROP L6076-6078 has the same wording)

**F88. Which scholarships the verification duty covers: the whole organization by default, the section 25F segregated account for an SGO on the 85% safe harbor, and each State's account for a multistate SGO.**

(a) By default the operational requirements, including income verification in paragraph (c)(1)(iv), apply to the organization as a whole. A single-State SGO whose activities are at least 85% scholarship granting "may apply the operational requirements of paragraph (c)(1) of this section to the organization's section 25F segregated account" (quoted in F65). The preamble's example of what that means is about expense verification; by the same wording it also covers income verification, but the preamble does not say so in terms. A multistate SGO must be at least 85% scholarship granting (it is a requirement for them, not an option) and must meet every (c)(1) requirement separately for each State's account. Design consequence: each verification record needs the SGO, the State account it belongs to, and whether the award is funded from the section 25F segregated account.

> For example, for a single-State SGO using the operational requirement safe harbor, the requirement that an SGO verify that scholarships are used solely for qualified elementary and secondary education expenses would apply only to scholarships granted with funds disbursed from the SGO's section 25F segregated account.

SRC: PROP L893-898 | [preamble/economic-analysis]

> (3) Multistate SGOs. At least 85 percent of a multistate SGO's activities must consist of scholarship granting activities (whether pursuant to section 25F, in accordance with State tax credit scholarship rules, or any other scholarship granting activities).

SRC: PROP L5369-5372 | [proposed-reg: not final]

> The SGO must meet the requirements of paragraph (c)(1) of this section separately for its section 25F segregated account for each such covered State.

SRC: PROP L5382-5384 | [proposed-reg: not final]

**F89. Disqualified persons: status is fixed at year end, lasts into the next year, and has one narrow exception. Scholarships to relatives of ordinary donors are not banned.**

(a) These points complete F69 and matter for the screening hook.
1. Whether a donor is a substantial contributor is determined at the close of each taxable year of the SGO, so a donor can become one after an award was made.
2. A substantial contributor stays one for that taxable year and the next. An officer, director, trustee or selection participant stays a disqualified person through the end of the taxable year in which they leave the role and through the following taxable year. A family member is disqualified only while the related person is.
3. An award to a substantial contributor or their family member is not treated as an award to a disqualified person if, on the award date, the donor was under the thresholds measured on contributions received through that date, and the SGO "did not know and did not reasonably expect" the person would become disqualified. The preamble says this exists to reduce "the risk of an SGO losing its SGO status", which shows what is at stake in a wrong award.
4. A single-State SGO on the 85% safe harbor, and every multistate SGO, must test the disqualified-person rule both for the organization as a whole and for the section 25F segregated account.
5. Treasury declined to ban scholarships to family members of all donors. So the disqualified-person rule by itself does not bar a donor's child from receiving a scholarship from the same SGO unless the donor (with spouse) is over both thresholds or is an insider. The earmarking prohibition (F68) still applies: the gift cannot be set aside for that child.

> A person's status as a substantial contributor is determined as of the close of each taxable year of the SGO.

SRC: PROP L5662-5664 | [proposed-reg: not final]

> (4) Duration of disqualified person status--(i) Substantial contributor to the SGO. An individual described in paragraph (d)(1)(i) of this section will be treated as a substantial contributor for any taxable year of the SGO in which the individual is so described and for the immediately succeeding taxable year of the SGO.

SRC: PROP L5689-5693 | [proposed-reg: not final]

> An individual who ceases to be described in paragraph (d)(1)(ii) or (iii) of this section will continue to be treated as a disqualified person through the end of the taxable year of the SGO in which such cessation occurs and through the end of the immediately succeeding taxable year of the SGO.

SRC: PROP L5698-5702 | [proposed-reg: not final]

> (iii) Members of the family. An individual described in paragraph (d)(1)(iv) of this section is a disqualified person by virtue of that paragraph only while any family member is treated as a disqualified person under paragraph (d)(1)(i), (ii), or (iii) of this section.

SRC: PROP L5703-5706 | [proposed-reg: not final]

> (ii) Excepted scholarships. A scholarship awarded by an SGO to a substantial contributor or a substantial contributor's family member will not be treated as an award to a disqualified person if, at the time the scholarship was awarded: (A) The recipient would not have been a disqualified person had the substantial contributor determination been made as of the date of the award, based on contributions received by the SGO through that date; and (B) The SGO did not know and did not reasonably expect that the recipient would be a disqualified person based on the substantial contributor determination made as of the close of the taxable year.

SRC: PROP L5665-5675 | [proposed-reg: not final]

> To reduce the risk of an SGO losing its SGO status by inadvertently awarding a scholarship to a disqualified person, proposed Sec. 1.25F-3(d)(2)(ii) would indicate that a scholarship awarded to a disqualified person will not be treated as such if, at the time the scholarship was awarded, two requirements are met for that taxable year.

SRC: PROP L1543-1548 | [preamble/economic-analysis]

> In addition to satisfying the requirement in paragraph (b)(4) of this section at the level of the organization as a whole, such organization also must test and satisfy that requirement at the level of its section 25F segregated account.

SRC: PROP L5365-5368 | [proposed-reg: not final]

> A few stakeholders suggested a rule completely prohibiting SGOs from providing scholarships to the family members of any donors. The proposed regulations do not adopt the recommendation.

SRC: PROP L1522-1524 | [preamble/economic-analysis]

**F90. Under the temporary regulations the State must certify that it reviewed the SGO's annual audit report and annual certifications. The proposed version of the same paragraph adds compliance with Prop. Reg. 1.25F-3(c).**

(a) The SGO-side audit and certification rules are only proposed (F54 to F58), but the State-side certification that it reviewed "the annual financial and programmatic audit report the organization is required to provide to the State in accordance with guidance" is already in the temporary regulation text. Note the gap: the temporary text presupposes an audit report and annual certifications required "in accordance with guidance", and the only place those requirements are spelled out is the proposed 1.25F-4(d) and (e). Until an SGO has first had to report, the transition rule applies instead (F60). The practical expectation that States will ask SGOs for these documents is this file's inference. The temporary text measures the SGO against "section 25F(d)" only. The proposed text of the same certification, and of the transition rule, adds "and Sec. 1.25F-3(c)", which would make the specific verification methods part of what the State certifies and part of what the SGO's written policies must "expressly require". In the transition period the State must also find that the SGO's documentation "evidences the SGO's ability and intent" to meet the operational requirements.

> (B) Reviewed the annual financial and programmatic audit report the organization is required to provide to the State in accordance with guidance;

SRC: TEMP L1870-1872 | [temporary-reg: in force]

> (C) Reviewed the annual certifications and other information the organization is required to provide to the IRS; and

SRC: TEMP L1873-1874 | [temporary-reg: in force]

> (D) Investigated any failure by the SGO to provide the required certifications and other information, and, with respect to any such failure, has become reasonably satisfied that the SGO has corrected the failure, if possible, or has put in place procedures to prevent future failures in a manner that satisfies the State that the SGO will satisfy the requirements to be an SGO located in the State; and

SRC: TEMP L1875-1880 | [temporary-reg: in force]

> (iii) Determine that the documentation and information available to the State evidences the SGO's ability and intent to satisfy the operational requirements in section 25F(d); and

SRC: TEMP L1901-1903 | [temporary-reg: in force]

> (iii) The organization meets all the operational requirements described in section 25F(d) and Sec. 1.25F-3(c);

SRC: PROP L6284-6285 | [proposed-reg: not final]

> (ii) Determine that the SGO's provisions, policies, and procedures expressly require (beyond a general requirement to comply with applicable law) the SGO to satisfy the operational requirements for an SGO in section 25F(d) and Sec. 1.25F-3(c);

SRC: PROP L6318-6321 | [proposed-reg: not final]

**F91. Removal: who can remove an SGO, the effect on gifts, and the appeal.**

(a) A State may remove an SGO from its list, through a procedure that gives due process, if the SGO does not satisfy section 25F(c)(5) or (d) or the applicable State requirements. The IRS may remove an SGO after its own determination of non-compliance (quoted in F61), and that determination can be reviewed by the IRS Independent Office of Appeals. Contributions made after the removal date are not qualified contributions; the IRS page says contributions made before the removal date may still qualify. For income-verification failures the sources describe no cure period, no error tolerance and no consequence other than possible removal (a search of both rule documents for "penalt" finds only the perjury signature on the small-SGO audit report). The only "cure" language is in the State certification about failures to provide required certifications and information (F90, item (D)), and the only inadvertence exception is the one for substantial contributors (F89). The IRS may also require a State to change its procedures after "a pattern of irregularities or noncompliance".

> A State may remove an SGO from its State SGO list if the State determines, through a procedure providing due process to the organization, that the SGO is not located in the State, or that the SGO does not satisfy the requirements for an SGO in section 25F(c)(5) or (d) or the applicable State requirements described in paragraph (e)(1) of this section.

SRC: TEMP L1971-1976 | [temporary-reg: in force]

> Such an IRS determination is a Federal tax controversy under section 7803(e)(3), which gives the SGO an opportunity to seek review of the determination by the IRS Independent Office of Appeals in the time and manner prescribed in applicable forms, instructions, or other administrative guidance.

SRC: TEMP L1995-1999 | [temporary-reg: in force]

> The organization will be removed from the relevant part of the IRS SGO list for the current year to ensure that any contributions to the organization after the date of its removal from the State or IRS SGO list are not treated as qualified contributions.

SRC: TEMP L720-723 | [preamble/economic-analysis] (preamble to T.D. 10057)

> If an organization is removed from the list during the year, only contributions made before the removal date may qualify for the credit.

SRC: IRSIND L412 | [IRS web page]

> Upon discovering a pattern of irregularities or noncompliance, the IRS, in its discretion, may require a State to modify its procedures to ensure that its determinations regarding an organization's satisfaction of the requirements in section 25F(c)(5) and (d) are being administered in accordance with the applicable statutory, regulatory, and appropriate State requirements.

SRC: TEMP L2058-2064 | [temporary-reg: in force]

**F92. What the sources say about SGO records beyond F52 and F53, and what they do not say about applicant privacy.**

(a) The Paperwork Reduction Act section names two kinds of records an SGO needs: records showing the 90% spending test, and records for working out who is a substantial contributor. It then lists eligibility verification among the things that drive SGO recordkeeping. It treats the students' documents as information "maintained by SGOs in the normal course" and excludes that from its burden estimate, so Treasury has not sized or specified the verification file. Separately: the fact-check pass searched both rule documents for "privacy", "confidential", "FERPA", "FCRA" and "Fair Credit". The only hit is the standard sentence that tax returns and return information are confidential under section 6103, which is about the IRS. The sources contain no rule on how an SGO or its vendor must protect, limit, share or delete applicants' income documents. Privacy and consumer-reporting obligations for this build come from other law, which is outside these sources.

> This includes records to ensure that an SGO spends not less than 90 percent of the income of the organization on scholarships for eligible students solely within the State in accordance with proposed Sec. 1.25F-3(c)(4) and records to allow an SGO to verify whether the amount that any person, who contributed an aggregate amount of more than $5,000 to the organization during the taxable year, contributed more than 2 percent of the total contributions received by the organization through the end of the taxable year.

SRC: PROP L4013-4021 | [preamble/economic-analysis] (Paperwork Reduction Act section)

> SGO recordkeeping and reporting arise from the need to register on the IRS SGO portal, verify the eligibility of students applying for a scholarship, file a form with the IRS to report on the SGOs' compliance with the rules of section 25F, and provide the IRS with information on the contributions received.

SRC: PROP L4245-4249 | [preamble/economic-analysis] (Regulatory Flexibility Act section)

> Information collection and maintenance in the normal course of business is considered part of usual and customary business activity and is excluded from the definition of burden under 5 CFR 1320.3(b)(2).

SRC: PROP L4133-4136 | [preamble/economic-analysis] (Paperwork Reduction Act section)

**F93. Treasury rejected SGO self-attestation of compliance because it could lead to awards to non-eligible students.**

(a) This is about an SGO attesting to its own compliance, not about a family attesting to its income. It still shows the direction: Treasury wants certification plus supporting information plus an independent audit, and it names "providing scholarships for non-eligible students" as the first risk. It is the closest the sources come to explaining why an evidence file matters.

> While a self-attestation approach would have been less burdensome, it could lead to SGOs not meeting the requirements of the statute by (i) providing scholarships for non-eligible students or for non-eligible expenses or (ii) not satisfying the 90 percent of income requirement.

SRC: PROP L4271-4275 | [preamble/economic-analysis] (Regulatory Flexibility Act section)

**F94. Complete list of the specific requests for comment in the proposed rule, and the hearing date.**

(a) Found by searching the proposed rule for "request comments", "comments are requested" and "invite". None asks about "other relevant data sources", consent-based data, third-party verification services or the certification wording in the direct method. A comment on those points therefore rests on the general request (F4). The specific requests are:
1. The definition of qualified digital wallet, and whether more safe harbors for verifying that scholarships are spent on qualified expenses should be added (PROP L404-408, quoted in F81).
2. How an organization measures its scholarship-granting activities and whether 85 percent is a reasonable threshold (quoted below).
3. How section 501(c)(3) requirements interact with section 25F (quoted below).
4. Other needs-based programs, such as State or Tribal programs, for the categorical method (PROP L1296-1298, quoted in F47).
5. The State certifications in 1.25F-5(d)(3), including for multistate SGOs, and whether any is disproportionately burdensome (PROP L2160-2165).
6. The number of small entities affected and the economic impact on them (PROP L4155-4157).
7. Less burdensome alternatives that still mitigate the risk of fraud or improper payment (PROP L4288-4291, quoted in F43).
8. Overlapping, duplicative or conflicting Federal requirements (PROP L4297-4299).
9. All aspects of the proposed regulations (F4).

Comments are due December 1, 2026. Requests to speak at the hearing are due the same day, and the hearing is cancelled if no outlines are received.

> The Treasury Department and the IRS request comments as to whether further guidance is needed regarding how an organization measures its scholarship-granting activities, including whether the determination should be based on receipts, expenditures, staff time, program-service activity, or another administrable metric, as well as whether 85 percent is a reasonable threshold to ensure that the organization's overall mission and operations are aligned with the statutory scholarship purpose behind the section 25F credit.

SRC: PROP L952-959 | [preamble/economic-analysis]

> The Treasury Department and the IRS request comments on how section 501(c)(3) requirements interact with section 25F and whether any clarifications are needed in the final regulations.

SRC: PROP L1133-1135 | [preamble/economic-analysis]

> The public hearing is being held on Tuesday, December 15, 2026, at 10 a.m. Eastern Time (ET).

SRC: PROP L100-101 | [preamble/economic-analysis] (DATES caption)

**F95. "School" in section 530(b)(3)(B), as Treasury restates it.**

(a) F64 cites the proposed definition by cross-reference. This is the content of the cross-reference. What counts as a school "as determined under State law" in Texas (for example whether a microschool or a homeschool is a school) is NOT IN SOURCES.

> Section 530(b)(3)(B) provides that the term ``school'' means any school that provides elementary education or secondary education (kindergarten through grade 12), as determined under State law.

SRC: PROP L413-416 | [preamble/economic-analysis]

**F96. Residency controls, not school location: Treasury's interpretation and its first example.**

(a) A student who lives in Texas and attends school in another State can receive a scholarship from a Texas-listed SGO. A student who lives in another State and attends school in Texas cannot (unless one of the two exceptions in F70 applies). The intake must therefore key on the student's State of residence, not on the school's or vendor's address.

> The Treasury Department and the IRS interpret the statutory language ``eligible students solely within the State in which the organization is listed'' to refer to the residence of the student, rather than where a school is located.

SRC: PROP L1396-1399 | [preamble/economic-analysis]

> (A) Example 1. Organization EF is an SGO that operates only in State X and is on the IRS SGO list under State X for 2027. Student A resides in State X and attends school in State Y. Student B both resides and attends school in State Y. Neither student is in a military or Tribal family as described in paragraph (c)(7)(ii) of this section. Student A, but not Student B, is an eligible student solely within the State in which EF is listed as an SGO for purposes of section 25F. Thus, EF can award a scholarship from its section 25F segregated account to Student A, but not to Student B.

SRC: PROP L5599-5607 | [proposed-reg: not final]

**F97. Private-benefit context that bears on business-funded or business-originated scholarship flows.**

(a) In explaining why an SGO may fund only expenses reasonably necessary to its charitable purpose (F72), Treasury recites general section 501(c)(3) limits and two private-foundation authorities. They are cited as context, they are not stated as section 25F rules, and Treasury asks for comments on how section 501(c)(3) interacts with section 25F (F94, item 3). They are still the nearest thing in the sources to guidance on arrangements in which a business stands to gain from a scholarship being awarded, such as a camp that is paid from the award and pays a fee for the referral. Whether such an arrangement creates a private-benefit problem for the SGO is NOT IN SOURCES and needs counsel. Treasury also names a specific worry, small organizations "intended to benefit small groups of related people without explicitly violating the earmarking prohibition", and says the private benefit doctrine already deals with it by denying such an organization section 501(c)(3) status and therefore SGO status.

> In addition, an organization is not described in section 501(c)(3) if it provides goods or services that confer more than incidental private benefit or otherwise exceed what is reasonably necessary to accomplish those purposes.

SRC: PROP L1112-1115 | [preamble/economic-analysis]

> In the context of private foundation grants under an employer-related scholarship program, Rev. Proc. 76-47 provides that a scholarship must be motivated by a disinterested educational purpose, not by private or business interests.

SRC: PROP L1128-1132 | [preamble/economic-analysis]

> Notice 2025-70 requested comments on whether to exclude the $5,000 threshold and rely solely on the 2 percent threshold, the aim of which would be to prevent the development of small organizations intended to benefit small groups of related people without explicitly violating the earmarking prohibition.

SRC: PROP L1476-1481 | [preamble/economic-analysis]

> Upon further consideration, the Treasury Department and the IRS have concluded that the stated concern is addressed by the existing private benefit doctrine, which would prevent such an organization from properly being recognized as described in section 501(c)(3), thus causing it to be unable to qualify as an SGO.

SRC: PROP L1484-1488 | [preamble/economic-analysis]

**F98. Texas is on the IRS list of participating States for 2027, and the first IRS SGO list is due to be posted on December 31, 2026.**

(a) This is the official confirmation of Texas's participation that F85 lacked. The Governor's December 10, 2025 press release (`sources/extra/tx_gov_optin.txt`, lines 564-569) announced the intent to opt in; it says nothing about an SGO application process and describes eligibility loosely as "300% of local median income", wording that should not be copied into product copy. The IRS State-portal page (`sources/extra/irs_fstc_state_portal.txt`, lines 290-291, updated 13-Nov-2026) says States must submit their 2027 SGO lists by February 15, 2027.

> Participating states for 2027 (as of Nov. 13, 2026)

SRC: IRSST L425 | [IRS web page]

> The following states have elected to participate under Section 25F for 2027:

SRC: IRSST L426 | [IRS web page]

> Texas

SRC: IRSST L453 | [IRS web page] (entry in the list that follows the sentence above)

> The list of qualified SGOs will be posted on December 31, 2026.

SRC: IRSIND L411 | [IRS web page]

**F99. Treasury acknowledges that verifying income is hard when a child moves between households, but offers relief only for foster children.**

(a) The statement is made to justify the foster-child safe harbor. It describes the same practical problem that the shared-custody rule in F20 creates (getting cooperation and income information from more than one household). The sources give no method for solving it outside foster care.

> If a child is a transitory resident of several different households over the course of the year, most of which do not reflect the true set of resources available to that child,\24\ then an SGO may be uncertain how to verify this child's household income or receive cooperation from all available households.

SRC: PROP L3024-3028 | [preamble/economic-analysis]

**F100. The preamble puts the duty to recover overpayments from a school on the SGO.**

(a) The regulation text says "The school must return" excess or erroneous payments (F80). The preamble says the rule would "require the SGO to require the school" to do so. For the product this means refund terms belong in the SGO's arrangement with each school or vendor.

> Proposed Sec. 1.25F-3(c)(5)(iii) would further require the SGO to require the school to return any payments from the SGO that are in excess of the student's costs, or that are disbursed by the SGO in error.

SRC: PROP L1087-1090 | [preamble/economic-analysis]

---

## ENGINEERING IMPLICATIONS

These are requirements for code and copy that follow from the facts above. Where a requirement rests on my reading rather than on an explicit statement, it says so.

### 1. Rule-set versioning and reliance

1. Tag every decision with a rule-set id, for example `25F_STATUTE + REG-117199-25_PROPOSED_2026-10-02`. Keep each proposed provision behind its own config entry (method list, document list, program list, 12-month window, shared-custody rule, cash-only income, multipliers), so the final regulations are a config change plus a re-run of tests. (F2, F3)
2. Implement the proposed methods as written and nothing else. An SGO's reliance on the proposed regulations depends on following them "in their entirety and in a consistent manner" (F3). Do not add a "self-attested income" path or an "other benefit program" path that the proposed text does not contain.
3. In copy, call the verification rules "proposed regulations (REG-117199-25) that SGOs may rely on, for qualified contributions made on or after January 1, 2027, until final regulations are published". Do not call them final, do not call them requirements, and do not say they are "in force". The proposed sections would apply only after final regulations are published. (F3, F87)

### 2. Inputs the engine must require

4. `application_date` (the date of the scholarship application). Derive `income_year = application_date.year - 1`. If the intake date and the SGO's application date fall in different calendar years, stop and ask rather than guess. (F13)
5. Student: name, date of birth, and an attestation plus SGO-side check that the student is eligible to enroll in a public elementary or secondary school. Do not require current enrollment. (F6, F8)
6. Residence: an address in the listing State and proof of State residency, stored as its own evidence item. Capture the two exceptions as flags (dependent of an Armed Forces member; dependent of an individual residing on Indian Lands) and route them to review. (F53, F70)
7. Household roster: every person residing with the student, with age band (under 18 or 18 and over) and relationship. Family size is the count of that roster, including the student. Ask about grandparents, partners and unrelated housemates explicitly. (F19, F20, F23)
8. Multi-household questions: "Did the student live in more than one household during [income year]?" If yes: where did the student live for the longest period; was time equal; if equal, which household had the higher income. Any "yes" goes to `needs_review` with the facts recorded. Never resolve a tie silently. (F20, F22)
9. Method selection: `direct`, `categorical`, or an explicit `out_of_scope` result for the tutoring and foster-child safe harbors that tells the SGO to handle those cases itself. (F10, F50, F51)

### 3. Direct method

10. Accept the named documents: pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2. Store which document types were reviewed for each adult. (F40, F42)
11. Always ask for other income not on those documents (child support and alimony are the named examples) and collect either evidence of it or a signed, dated certification that there is none. Store the certification text version, signer and timestamp. The proposed regulation text names both items in its list of documentation. Fact-check: the list is introduced by "may be verified through review of written documentation including", so the text does not say in terms that every direct-method file must contain one of the two. Treating a file without either as incomplete is a conservative design choice that fits the reliance condition in F3, and it is the right default, but describe it to SGOs as the product's policy, not as a stated legal requirement. (F40)
12. Compute household income as cash income of the household for the income year under the 24 CFR 5.609 framework: include child support and alimony received, exclude non-cash receipts, never impute a return on assets, never use AGI as the answer. Use the category table in the companion file. (F25-F29)
13. Data-rail path (payroll, bank, IRS transcript request): label it in the decision as `direct / other relevant data sources` with the citation "Prop. Reg. 1.25F-3(c)(6)(iii)(A)". Keep it behind a feature flag. Keep a written record of what the source is, what it returned, the consumer's instruction to share it, and the retrieval timestamp, so that if the final rule requires "review of written documentation" the same data can be rendered as a document. The regulation text supports data sources as a stand-alone route; the preamble wording is narrower. (F40, F41, F43)
14. Because prior-calendar-year documents for 2026 (Forms W-2, filed returns, transcripts) will mostly not exist in January 2027, expect early applications to rest on year-end pay stubs or data rails. The sources give no rule for annualising or for partial-year evidence, so partial evidence should go to `needs_review`, not to an extrapolated yes. (F13, F42; the timing observation is mine)

### 4. Categorical method

15. Closed program list: `SNAP`, `TANF`, `WIC`, `SECTION_8`, `SSI`. Reject school-wide free or reduced-price lunch. Do not accept Medicaid, CHIP, EITC or other programs unless the final rule adds them; make the list configurable for that reason. (F45-F47)
16. Required extracted fields: issuing agency, program, document date, the named individual, whether the document shows current approval, and any certification or benefit period end date. Rules: document date within 12 months; named individual is on the household roster; approval is current. (F45)
17. The reference date for "last 12 months" is not defined. Evaluate the window against both the application date and the decision date, pass only if both pass, and otherwise return `needs_review`. Store both dates. (F48; the two-date approach is my conservative choice)
18. If the benefit period shown on the letter ended before the application date, return `needs_review` even if the letter is less than 12 months old, because the text says "currently is approved". (F45, F48)
19. Record family size on categorical decisions as well. The statute requires the SGO to verify family size and the categorical paragraph does not say that requirement is waived. (F9, F48)
20. Non-letter documentation (portal screenshots, EBT cards) is not addressed. Route to review and let the SGO decide. (F48)

### 5. Threshold

21. Until the IRS publishes its table, every threshold is provisional. Carry `threshold_source`, HUD fiscal year, formula id and a `provisional: true` flag on each decision. (F30-F32)
22. Compute both readings (3 x median x multiplier, and 6 x very-low-income limit) and return `needs_review` when household income falls between them. In Texas this matters in 143 of 254 counties, mostly rural and border counties. Details and test vectors are in the companion file. (F34)
23. Per-SGO stricter cap as a parameter, never above 300%. (F12)
24. Pass when income is less than or equal to the limit. (F11)
25. Add a job that checks https://www.irs.gov/irb for a section 25F income-limit publication, and a one-step swap to make it the source of truth. (F32)

### 6. Decision validity and reuse (design choices; the sources give no validity period)

26. A direct-method decision answers one question: was income for `income_year` within the limit. It can support any application dated in `income_year + 1`. It cannot support an application dated in a later calendar year, because the income year changes. Set `expires_at` no later than December 31 of the application year.
27. A categorical decision additionally depends on the letter's date and current approval. Set `expires_at` to the earlier of December 31 of the application year and the document date plus 12 months, and re-check current approval on reuse.
28. Passport reuse by a second SGO: reuse the stored facts, but re-evaluate against the second SGO's application date and its own cap, and take a fresh consent. Each SGO must itself be able to certify that it verified eligibility (F54), so give the second SGO the full evidence pack, not only a yes.
29. For multi-year awards, expose a re-verification reminder per school year. The preamble treats eligibility as an annual determination that holds when each payment is made (F14).

### 7. Evidence pack and audit support

30. The pack should let the SGO's certifying officer and auditor see, for each student: application date and income year; method and the regulation paragraph relied on; household roster, family size and any shared-custody determination; residence and the residency proof reference; documents or data sources reviewed, with dates and hashes; the other-income evidence or the no-other-income certification; categorical details (program, agency, named individual, document date, current-approval finding); area, threshold, source, formula and provisional flag; computed household income by category; decision, timestamp, reviewer and any manual overrides with reasons; consent record. (F10, F40, F45, F54, F58)
31. Produce an SGO-level "verification procedures" document that describes the procedure the engine applies. The audit covers procedures for verifying eligibility, and in the transition period the State relies on the SGO's written policies, which must expressly require compliance. (F58, F60) The audit also requires "Verification that the organization met all of the operational requirements", so the per-student packs must be complete enough for an auditor to test individual files; a procedure document alone is not enough. (F58 as corrected)
32. Provide per-SGO exports by the SGO's taxable year (not calendar year): number of students that applied, number verified by each method, number found ineligible, and number sent to review. The annual information report needs the applicant count. (F55) Also export the count of students selected under the tutoring safe harbor (item (B) of the report) if the SGO records it. The report's item list is open-ended ("Any other information required in accordance with guidance"), so keep the export schema easy to extend.
33. Support the award step without doing it: flags for "awarded a scholarship the previous school year" and "sibling of a recipient from this SGO", and a hook for the SGO's disqualified-person list (names of donors over $5,000, officers, directors, selection-committee members and their families) to be matched against the applicant's family names. (F15, F18, F69) Because substantial-contributor status is only fixed at the SGO's year end and then runs through the next taxable year, the screen cannot be a one-time gate: store the date of each screen and the contribution totals it used, let the SGO re-run it at award time and at year end, and keep former officers, directors and selection participants on the list through the end of the taxable year after they leave. For an SGO on the 85% safe harbor or a multistate SGO, the 2% test has to be run against the segregated account as well as the whole organization. (F89)
34. Retention: no period is prescribed. Make retention configurable per SGO and do not hard-code a number of years in copy. Because the annual audit happens after the taxable year ends and covers that year's eligibility procedures, do not delete raw documents before the SGO confirms its audit for the award year is complete. Keep the decision record, extracted fields and hashes for as long as the SGO instructs. Get counsel's view on the section 6001 period. (F52, F57; the audit-timing point is my inference)
35. Segregation by State and by SGO: the audit is performed at the section 25F segregated-account level, and multistate SGOs test each State separately, so every verification belongs to exactly one SGO and one State account. (F58, F62)

### 8. Family intake copy

36. Say "household income requirement" and "everyone who lives with the student". Do not say "family income" or "your tax return income". (F19, F28)
37. Say what counts: money the household received in the income year, including child support and alimony, and not including non-cash benefits or the value of a home. (F25, F26)
38. Do not tell a family they are "eligible for a scholarship". The engine verifies one requirement. The student must also be eligible to enroll in a public school and reside in the State, the SGO decides awards, and returning students and their siblings have priority. (F6, F15, F70)
39. Explain the two paths in plain terms: "a recent approval letter for SNAP, TANF, WIC, Section 8 housing or SSI for someone in your home" or "documents or a secure connection showing last year's income".
40. The no-other-income certification is a legal statement used by the SGO for a federal tax program. Present it on its own screen with the exact text, not as a pre-ticked box.
41. Tell families that, under the proposed rules, an SGO scholarship is not paid to the family except as reimbursement against a receipt. Word it as how the SGO is expected to pay, not as settled law. (F80)

### 9. Camp and vendor handoff

42. Do not state or imply that a summer camp, after-school program or microschool fee is a qualified expense. The sources do not address them and guidance is pending. Keep vendor type and "qualified-expense basis" as SGO-controlled configuration, with the SGO making the call. (F74-F79)
43. If an SGO does pay a vendor: the vendor must be verified as an appropriate provider, unrelated to the recipient, and bound to refund excess or erroneous payments. Capture a vendor-relationship attestation ("Is anyone in the student's household an owner or employee of this vendor?") and a refund undertaking from the vendor at onboarding. (F80)
44. Keep donor flows and family flows separate. A camp, relative or employer must not be able to fund a specific child's scholarship through the platform. Do not carry a donor identifier into a family's application or the reverse. (F68)
45. An SGO fed by one establishment still has to award to at least 10 students who do not all attend the same school, and its awards must follow the priority rule. Do not promise a camp that its customers will be funded. (F15, F64)

### 10. SGO-facing copy and pricing

46. Do not describe the product as making the SGO compliant or as shifting responsibility. The rules put the duty on the SGO and are silent on vendors. Describe it as performing the proposed-rule verification steps and producing the record the SGO needs for its certification and audit. (F54, F83)
47. Do not say "CPA audit". The proposed rule requires a "qualified independent third party" audit, with a lighter option at $500,000 or less in receipts. (F57)
48. Fees an SGO pays for verification reduce what it can count toward the 90% test unless it qualifies for the segregated-account safe harbor and pays from other funds. Price and invoice with that in mind. (F65, F66)

### 11. Added by the fact-check pass

49. Tag every verification with the SGO, the listing State, and whether the award is funded from the section 25F segregated account. For an SGO on the 85% safe harbor the operational requirements are tested on that account, and a multistate SGO is tested account by account. (F88)
50. Key State eligibility on the student's residence. Do not infer it from the school's, camp's or vendor's address. A Texas resident attending school in another State is within Texas for this purpose; a non-resident attending in Texas is not. (F70, F96)
51. Dates in copy: temporary regulations "published October 2, 2026, effective December 1, 2026"; comments on the proposed regulations due December 1, 2026; public hearing December 15, 2026; first IRS SGO list to be posted December 31, 2026; 2027 State SGO lists due February 15, 2027 (the last date is from the IRS State-portal page, not from the files this research was scoped to). Put all of them in config, not in hard-coded strings. (F2, F4, F94, F98)
52. Do not tell an SGO that an honest verification mistake is harmless or curable. The sources give a removal power, an appeal to the IRS Independent Office of Appeals, and an inadvertence exception only for substantial contributors. They give no cure period or error tolerance for income verification. (F61, F89, F91)
53. Do not present the section 25F rules as covering privacy. They say nothing about protecting, sharing or deleting applicants' documents. Consent, retention and consumer-reporting design must be driven by other law and by counsel. (F92)
54. Business-funded flows: before launch, get counsel's view on whether an establishment paying a per-booking fee, and being paid from the resulting scholarship, raises private-benefit or "related, directly or indirectly" issues for the partner SGO. The sources flag the doctrine and do not resolve it. Keep the fee, the SGO's award decision and the vendor payment visibly independent of each other in both data model and copy. (F68, F80, F97)
55. Refund terms: the SGO must be able to show that each school or vendor it pays is required to return excess or erroneous payments. Capture that undertaking per payee and store it with the evidence. (F80, F100)
56. For the December 1, 2026 comment: there is no specific request for comment on "other relevant data sources", so the comment should cite the general request and the request for less burdensome alternatives that still control fraud, and should point out the mismatch between the regulation text and the preamble. (F40, F41, F94)

---

## OPEN QUESTIONS / AMBIGUITIES

The sources do not settle the following. None of these should be guessed in code or copy.

1. **Regulation text versus preamble on "other relevant data sources".** Is verification through other data sources a stand-alone route (regulation text, F40) or only via "a certification that would verify income through other relevant data sources" inside applicant-provided documentation (preamble, F41)? What qualifies as a "relevant data source", whether consumer consent is required, and whether a payroll, bank or consumer-reporting source qualifies: NOT IN SOURCES. No specific comment request addresses this. This is the legal hook for auto-submit and the most important item for the December 1 comment.
2. **Who signs the "certification that there is none", and in what form?** NOT IN SOURCES.
3. **Raw median versus HUD-adjusted limits** for the 300% table, and Section 8 file versus MTSP file (F34, F37). NOT IN SOURCES.
4. **What to use before the IRS publishes its table**, and when the first table will appear. NOT IN SOURCES. No section 25F item appears in Internal Revenue Bulletins 2026-38 to 2026-47.
5. **Which year's AMGI** is compared with prior-calendar-year income, and **which location** (residence at application, during the income year, or the relevant household's location in a shared-custody case). NOT IN SOURCES.
6. **Rounding** of the 300% limit. NOT IN SOURCES.
7. **"Date of the application."** Submission, completion, or receipt by the SGO? One application per school year or per award? What about a rolling waitlist that crosses January 1? NOT IN SOURCES.
8. **Re-verification frequency and validity period** of a verification, and whether multi-year awards need re-verification before each payment. The only signal is the "as of the time when the scholarship is paid" sentence (F14).
9. **Household versus family.** Proposed family size counts everyone residing with the student, while 24 CFR 5.609 counts income of "family" members and excludes income of live-in aides and foster children. Does an unrelated roommate's income count? Are temporarily absent members counted? As of what date is the roster fixed (during the income year or at application)? NOT IN SOURCES.
10. **Shared custody mechanics.** How time is measured, which year, how an SGO gets the other household's income for the tie-break, and what "the household of the taxpayer" means when neither adult files a return. NOT IN SOURCES.
11. **Partial-year and current-year evidence.** Pay stubs are listed with no year qualifier, but the test is a completed prior calendar year. Whether current pay stubs can be used to estimate prior-year income, and how to annualise: NOT IN SOURCES. The calculation-timing rules in 24 CFR 5.609(c) (estimate the coming 12 months at admission) do not fit a prior-calendar-year test, and the proposed rule does not say whether they apply.
12. **Which edition of 24 CFR 5.609** is incorporated (the proposed text gives no date; a footnote says "(2000)"), and whether later HUD amendments flow through automatically. NOT IN SOURCES.
13. **Categorical details:** reference date for "last 12 months"; meaning of "currently is approved" after a certification period ends; acceptable documentation other than an award letter; the Section 8 equivalent of an award letter; whether household membership of the named individual must be independently verified; whether family size must still be verified; whether individually approved free or reduced-price meals could count. NOT IN SOURCES.
14. **Record retention period and required contents** of an SGO's verification file. NOT IN SOURCES beyond the generic section 6001 statements.
15. **Use of vendors for verification.** Whether an SGO may rely on a third party's determination, and on what conditions. NOT IN SOURCES.
16. **The annual certification and information form:** form number, due date for Form 990 filers beyond "attached", and whether it will ask for counts by verification method. NOT IN SOURCES.
17. **Auditor qualifications** beyond the quoted definition, audit standards, and the due date for delivering audit results to the State. NOT IN SOURCES.
18. **How to verify "eligible to enroll in a public elementary or secondary school"** (age, grade level, prior graduation, residency). NOT IN SOURCES.
19. **Proof of State residency:** what documents suffice under Texas law for this purpose. NOT IN SOURCES.
20. **Earmarking boundary.** Whether a donor may state a non-binding preference for a school, program or vendor. NOT IN SOURCES.
21. **Summer camps, after-school programs, microschools, homeschool expenses.** Not addressed; guidance under section 530 is pending (F77, F79).
22. **Rural-area rule in section 42.** Section 42(i)(8) says that, "For purposes of this section", for rental projects in rural areas an income limitation measured by AMGI is measured by "the greater of area median gross income or national non-metropolitan median income" (USC42 L1210). Section 25F borrows AMGI "as such term is used in section 42". Whether that rural rule carries into section 25F is not addressed in the proposed rule. NOT IN SOURCES. It would raise limits in rural Texas if it applied.
23. **Texas-specific SGO requirements.** Texas had not published an SGO application process as of the secondary source's last check (November 16, 2026). NOT IN SOURCES.
24. **Tolerance for error.** Whether a good-faith verification that later proves wrong costs the SGO its status, and whether there is any cure period. The proposed rules have an inadvertence exception for disqualified persons (Prop. Reg. 1.25F-3(d)(2)(ii)) but nothing comparable for income verification. NOT IN SOURCES. What the sources do give: the IRS "may" (not "must") remove for non-compliance, the determination can go to the IRS Independent Office of Appeals, and the State's certification speaks of an SGO having "corrected the failure, if possible" only for failures to provide certifications and information (F61, F90, F91).
25. **Sources I could not reach.** huduser.gov returned an empty HTTP 202 response for the MTSP income-limits page, so the MTSP FY 2026 data was not checked. I did not find an IRS page dedicated to SGO income limits or SGO portal instructions in the captured IRS pages.

Added by the fact-check pass:

26. **Does the verification duty reach scholarships paid outside the section 25F segregated account?** For an SGO on the 85% safe harbor the regulation text says the operational requirements may be applied to the account, and the preamble's only example is expense verification. Whether income verification is likewise limited to account-funded awards is implied by the text but not stated. For an SGO not on the safe harbor the requirements apply organization-wide, which would reach its non-25F scholarships. (F88)
27. **Audit depth.** Whether the auditor must test individual eligibility files, on what sample, and against what standard. NOT IN SOURCES. (F58)
28. **Who signs the SGO's annual certification, and under what penalty.** NOT IN SOURCES. The only perjury language is for the small-SGO audit committee's report. (F54, F57)
29. **Private benefit and business-originated scholarships.** Whether a vendor that is paid from a scholarship may also pay a referral or verification fee to the platform that connected the family, and whether that affects the SGO's section 501(c)(3) status or the "not related, directly or indirectly" vendor condition. NOT IN SOURCES. Treasury has asked for comments on how section 501(c)(3) interacts with section 25F. (F80, F97)
30. **Privacy and data handling for applicant documents.** NOT IN SOURCES; the section 25F materials do not address it. (F92)
31. **Period for the "10 or more students" count** and whether it resets each taxable year. The regulation text gives no period; the economic analysis says "per year". (F64)
32. **Whether the "certification that there is none" can cover all other income or only income "not reflected on such documents"**, and whether an applicant with no documents at all (no wages, no return) can be verified under the direct method by certification alone. The regulation text ties the certification to other income not reflected on the listed documents. Zero-income households are not addressed. NOT IN SOURCES. (F40)
33. **Texas's own SGO requirements from an official Texas source.** The only statement that Texas has published no process is from a private website (F85). No Texas Comptroller or other State page on SGO listing was in the source set, so this is UNVERIFIED against official Texas sources.

---

## VERIFICATION LOG

Adversarial fact-check pass, 2026-11-18. Method: default distrust. Nothing in the first pass was accepted because the author's own script had passed it.

### What was checked

1. **Every quote and line citation.** A separately written checker (`factcheck_sgo_scripts/fc_quotes.py`, under the scratchpad root; it does not reuse the author's loader) compared all 157 original quote and `SRC:` pairs with the source files: quote verbatim after collapsing line wraps and dropping `[[Page N]]` markers, and found at exactly the cited lines. Result: 157 of 157 verbatim and correctly located. Six quotes span a line that ends in a hyphen in the Federal Register text ("non-" / "cash" and similar); each was read by eye and the joined word is correct. After the edits the file has 217 quote pairs and all 217 pass under both checkers.
2. **Rule follows from quote.** For each of F1 to F86, the regulation paragraph or preamble passage around the quote was read in full (proposed regulation text of 1.25F-1, 1.25F-3, 1.25F-4(d) to (f) and the relevant parts of 1.25F-5; proposed-rule preamble parts I, III, IV, V.D, V.E and VI; the economic analysis, Paperwork Reduction Act and Regulatory Flexibility Act sections; all of the temporary regulation text and its preamble parts I and III.D; the statute).
3. **Tags.** Each tag was compared with where the quote actually sits (statute, temporary regulation text, proposed regulation text, preamble or analysis, IRS page, third-party page).
4. **Numbers and dates.** Recomputed from data or re-read in the source: all Texas figures in F34 (254 rows; 168 nonmetropolitan and 86 metropolitan; 143 counties where the two readings differ, 120 higher and 23 lower; 97 counties at $41,850; Starr $116,100 against $251,100; Harris, Dallas, Travis and Bexar figures) using an independent script on `hud/Section8-FY26.xlsx`; $83,700 Texas nonmetropolitan median; multipliers; $500,000 audit threshold; $5,000 and 2 percent; 85 and 90 percent; $46.95 and about $100; 36, 64, 95 and 96 percent; 78 and 72 percent; $10,000 to $30,000 and 53 percent; December 1 and December 15, 2026; September 1, 2026; October 1, 2029; 15th day of the 5th month.
5. **Search claims.** Re-ran the author's "this term does not appear" searches on both rule documents: consent, data source, service provider, contractor, agent, vendor, third party, camp, after-school, microschool, extended day, homeschool, summer, retain and retention, CPA, lunch, Medicaid, CHIP, EITC. All confirmed. Added searches: privacy, confidential, FERPA, FCRA, re-verify, recertify, renew, grandfather, continue, round, and every "request comments" phrase.
6. **Internal Revenue Bulletins (F32).** Confirmed the ten local files are Bulletins 2026-38 (September 14, 2026) to 2026-47 (November 16, 2026) and contain no hit for 25F, scholarship granting, area median gross, 10057 or 117199. Re-fetched https://www.irs.gov/irb on 2026-11-18: 2026-47 is the latest bulletin listed, and the 2026-48 address returns HTTP 404.
7. **Web sources re-fetched with plain requests on 2026-11-18.** Cornell LII section 530 (byte-identical to the earlier download); IRS FSTC landing page (still dated 23-Oct-2026, no income-limit content); eftccredit.com Texas SGO page (still says no official list and no published application process); huduser.gov MTSP page (HTTP 202 with an empty body, the same failure the author reported). Downloads are in `sources/extra/factcheck_sgo/`.
8. **HUD regulation text.** 24 CFR 5.609(a)(1), (b)(3), (b)(8), (b)(28)(i); 5.100; 5.403 read in the local eCFR copies.
9. **Spec cross-check.** Confirmed the product spec (`spec/frame_1.txt` line 233) quotes the preamble version of the direct method, as F41 says.

### What was changed

Corrections to existing content:

1. **Tags.** Three quotes from the preamble or DATES caption of T.D. 10057 were tagged `[temporary-reg: in force]` (in F2 twice and in F12). They are now `[preamble/economic-analysis]`. A preamble sentence is not regulation text.
2. **"In force" wording.** The temporary regulations are published but state an effective date of December 1, 2026, which is after this file's date. The status map, the tag note and F2 now say so and give the expiry (on or before October 1, 2029).
3. **F3 and summary item 2.** "May rely on the proposed regulations for 2027" tightened to the source's scope: qualified contributions made on or after January 1, 2027, in taxable years ending before final regulations are published. The "home-made shortcuts weaken reliance" point is now labelled as the file's reading.
4. **F5.** Added that the State certification is subject to the transition rule and that the temporary text refers to section 25F(d) only, while the proposed text adds 1.25F-3(c).
5. **F10.** "There is no any-reasonable-method option" softened: the list of methods is exclusive in form, but the direct method ends in the undefined "other relevant data sources".
6. **F15.** Title changed from "They do not get continued eligibility" to "No continued-eligibility rule for them appears in the sources", which is what the sources support.
7. **F18, F54, F66, F68.** Design inferences that were stated as fact are now labelled as inferences.
8. **F27.** Added the denominator of Treasury's 95 and 96 percent figures and that they rest on MTSP limits.
9. **F37.** The claim that Treasury used MTSP limits now has its own verbatim quote (footnote 16) and HUD's statement that MTSP is a separate publication. The MTSP-versus-Section 8 difference for Texas is marked UNVERIFIED.
10. **F53.** Noted that "proof of their State residency" is Paperwork Reduction Act wording, not regulation text.
11. **F55.** "Nothing in the list asks for applicant names, incomes or documents" qualified: item (K) lets the IRS add information by guidance. Items (G) and (K) and two supporting passages quoted.
12. **F57.** Added four precision notes (where the perjury sentence sits, the two different receipts periods, receipts counted organization-wide, no stated due date). Summary item 9 changed from "otherwise by a committee" to "may instead use a committee".
13. **F58 (substantive).** "The audit covers procedures, not a re-verification of every family" was too narrow. Item (vii) of the audit content is "Verification that the organization met all of the operational requirements". Corrected, and engineering implication 31 updated so the evidence pack supports file-level testing.
14. **F61 (substantive).** "Removal ends the SGO's ability to receive credit-eligible gifts" had no support in the file. Replaced with the supported statement (contributions after the removal date are not qualified; earlier ones may be) and the appeal right, with quotes in F91.
15. **F64, F65.** Added the period question for the 10-student count and that the 85 percent level is mandatory for multistate SGOs.
16. **F69.** Pointer added to the missing timing, duration and exception rules (F89).
17. **F75.** Tag changed from `[secondary/web]` to `[statute]` for the text of section 530(b)(3)(A), and the flush sentence on software added.
18. **F80.** "Contractually bound" was not in the source and the reimbursement route was omitted. Corrected to the regulation's words.
19. **F85.** Marked as a private website's statement, UNVERIFIED against official Texas sources; IRS confirmation of Texas's participation added in F98.
20. **Engineering implications 3, 11, 31, 32, 33, 41** reworded to match the corrections, and items 49 to 56 added. Implication 11 had said a direct-method file without other-income evidence or a no-other-income certification "is incomplete" because of the regulation text; the text lists those items after "including" and does not make them mandatory in terms, so this is now described as a conservative product policy.
21. **F73.** "This rule is in force" replaced with the accurate status and the difference between the temporary and proposed wording.
22. **Open question 24** extended; open questions 26 to 33 added.

Facts added (F87 to F100): proposed applicability dates; account-level scope of the operational requirements; disqualified-person timing, duration and exception, and the rejected ban on awards to donors' relatives; the State's in-force duty to review audit reports and certifications, and what the proposed version adds; State and IRS removal, effect on gifts and appeal; what the sources say about records and their silence on applicant privacy; Treasury's rejection of SGO self-attestation; the complete list of specific comment requests and the hearing date; the section 530 definition of school; the residency interpretation and example; private-benefit context for business-originated flows; IRS confirmation of Texas's participation and the December 31, 2026 SGO-list date; Treasury's acknowledgement of the multi-household verification problem; and the SGO's duty to require refunds from schools.

### What was not changed

No quote had to be removed or rewritten: none was fabricated or misquoted, and every line citation was exact. The derived analysis in F34 (two readings of the limit) reproduces from the HUD data and stays labelled `[derived]`; which reading the IRS will adopt remains NOT IN SOURCES. Every "NOT IN SOURCES" statement in the first pass was re-tested by search and by reading and stands.

### Still unverified after this pass

1. HUD MTSP FY 2026 income limits for Texas (site would not serve the page to a plain request).
2. Whether Texas has published any SGO application or documentation requirement (only a private website's statement was available).
3. Anything about the content of the IRS's future income-limit table, the SGO annual form, or the section 530 guidance, none of which exists in the sources.
4. The companion file `hud-ami-and-annual-income.md` was checked only to confirm that the cross-references to it (its F38, F39, Part C and the Income Category Table) exist. Its own facts were not re-verified in this pass.
