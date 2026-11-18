# Documents and parsers: what the intake must accept, how to recognise it, and the synthetic fixture set

Drives: Piece 3 (document extraction, decision service, needs-review states) and the upload path of Piece 2.
Research date: 2026-11-18. Author: research agent (documents-and-parsers topic).
Fact-checked 2026-11-18 by an independent adversarial reviewer. Every quote was re-located in its source, every cited PDF was re-downloaded and hash-compared (all identical), every cited web page was re-fetched, and the page images were re-read. Text that the fact-checker added or changed is marked `[FC]`. The full list is in the VERIFICATION LOG at the end of the file.

## How to read this file

- **Scope.** The real-world documents a Texas family can upload for the two verification methods in the proposed section 25F regulations: the five categorical programs (SNAP, TANF, WIC, Section 8, SSI) and the direct-method documents (W-2, Form 1040, IRS transcripts, pay stubs). For each: layout, identifying phrases, fields, validity checks, negative wording, pitfalls, and what must go to a human. Then the content specification for the synthetic fixtures.
- **Nothing here is real family data.** Every sample consulted is an agency-published sample, a blank official form, or a sample that an institution published with fictitious or redacted data. No user-uploaded copies of real notices (Scribd, Course Hero and similar) were downloaded or read.
- **Confidence tags** (one per fact):
  - `[statute]` — 26 U.S.C. 25F as saved in `usc_25F.txt`.
  - `[proposed-reg: not final]` — proposed regulation text in REG-117199-25. Comments are due December 1, 2026; the text can change.
  - `[preamble/economic-analysis]` — explanation in REG-117199-25, not regulation text.
  - `[temporary-reg: in force]` — T.D. 10057. A keyword search of the temporary regulations found nothing on income-verification documents (its "verify" passages concern State lists of organizations), so no fact below carries this tag.
  - `[official form/agency]` — a current official form, handbook, regulation or agency web page (HHSC, HUD, SSA POMS, IRS, eCFR, U.S. Department of Education). This tag is added to the task's list because most layout facts come from such sources. These are facts about the documents, not about section 25F.
  - `[IRS web page]` — an IRS.gov page.
  - `[secondary/web]` — a non-agency source (a sample hosted by a university or non-profit, a search-result snippet). Lower confidence; say so in code comments.
- **Quotes.** Each quote is verbatim. Line breaks and runs of spaces inside a quote are collapsed (the saved texts are layout-preserved PDF conversions). `[...]` marks an elision. The line after each quote gives the source key and line numbers, for example `SRC TF L16-18`. Keys are resolved in the "Source index" at the end. `IMG` means the quote was transcribed from a page image because the PDF has no text layer.
- **"NOT IN SOURCES"** means none of the sources consulted settles the point. It is never a guess.
- **Two dates matter for every example below.** Today is 2026-11-18. The proposed rules may be relied on for qualified contributions made on or after January 1, 2027, but only by a party that follows the portions that apply to it "in their entirety and in a consistent" manner (`SRC PROP L2406-2412`, quoted in A10). Fixture expectations use a frozen clock, stated in the fixture section.
- **Contents.** FACTS (A legal frame; B Texas HHSC; C Texas WIC; D Section 8; E SSA; F Form W-2; G Form 1040; H IRS transcripts; I pay stubs), 67 facts by the author plus 9 added by the fact-checker (A12, B14, B15, B16, C7, D9, H8, H9, I4). PARSER SPECIFICATION (P0 to P11). ENGINEERING IMPLICATIONS. SYNTHETIC FIXTURE SET (22 core and 23 extended fixtures, five of them added by the fact-checker). OPEN QUESTIONS / AMBIGUITIES. SOURCE INDEX. VERIFICATION LOG.

---

# FACTS

## A. The legal frame: what a document has to prove

### A1. The categorical method has six separate elements; a parser must establish each one
Rule for engineers: a categorical "yes" needs (1) written documentation, (2) dated within the last 12 months, (3) about an individual in the student's household, (4) who "currently is approved for assistance from or participation in", (5) one of exactly five named programs, (6) and the document "confirm[s]" that. "Such as an award letter" makes the award letter an example, not the only acceptable document.

> (B) Categorical eligibility verification method. Under the categorical eligibility verification method, income may be verified through written documentation, such as an award letter, dated within the last 12 months, confirming that an individual in the student's household currently is approved for assistance from or participation in Supplemental Nutrition Assistance Program (SNAP), Temporary Assistance for Needy Families (TANF), the Special Supplemental Nutrition Program for Women, Infants, and Children (WIC), Section 8 housing, or Supplemental Security Income (SSI)).
> — SRC PROP L5529-5537

`[proposed-reg: not final]`

`[FC]` Verified verbatim, including the unbalanced closing parenthesis after "(SSI)", which is in the Federal Register text. The preamble's parallel sentence says "documenting" where the regulation text says "confirming" (`SRC PROP L1277-1285`); build to the regulation text. The six-element breakdown is the author's reading of one sentence, not a list in the source.

### A2. Why Treasury allows it: it relies on a determination a government agency already made, on a household basis
Rule: the document has to show an agency's own determination for this household. A school-wide free-lunch designation is expressly not enough.

> This safe harbor responds to comments requesting a streamlined eligibility method for eligible students who are highly unlikely to be members of a household with income above 300 percent of area median gross income, thus reducing administrative burden by relying upon eligibility determinations that have already been made by government agencies.
> — SRC PROP L1285-1290

> Because the statute requires that this determination be made on a household basis, eligibility for participation in reduced-price or free lunch programs that apply to an entire school, rather than on an individual level, is not considered adequate verification for this purpose.
> — SRC PROP L1291-1295

`[preamble/economic-analysis]`

### A3. The list is five programs. Medicaid, CHIP, SSDI and State programs are not on it
Rule: the program enum is closed: `SNAP | TANF | WIC | SECTION_8 | SSI`. Treasury asked for comments on adding others, which confirms that nothing else counts today. Medicaid, CHIP, Healthy Texas Women, Social Security disability or retirement, unemployment, and school-meal letters must never produce a categorical "yes".

> The Treasury Department and the IRS request comments on other needs-based programs, such as State or Tribal programs, that also should be included in this categorical eligibility verification method.
> — SRC PROP L1296-1298

`[preamble/economic-analysis]` for the quote. `[FC]` The five-program list itself is `[proposed-reg: not final]` (the regulation text in A1). Two cautions. First, the list is proposed: the request for comments means the final rule could add programs, so keep the enum in versioned configuration and do not describe it to families as settled law. Second, the sources never mention Medicaid, CHIP, SSDI, Healthy Texas Women or unemployment by name; that they do not qualify follows only from their absence from the list.

### A4. The economic analysis describes the test as "currently benefits"
Rule: Treasury's own gloss on "currently is approved for ... or participation in" is that the person currently benefits. This supports checking that the benefit has not ended, not only that the letter is recent.

> First, the proposed regulations specify that, if an individual in a student's household currently benefits from specified needs-based benefit programs, then that student may be considered categorically eligible to receive a section 25F scholarship.
> — SRC PROP L2900-2903

`[preamble/economic-analysis]`

### A5. Direct method: the document list, and a wording difference between preamble and regulation text
Rule: the direct method accepts pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not on those documents (child support and alimony are the named examples) "or a certification that there is none", or "other relevant data sources". The preamble words the last clause differently ("a certification that would verify income through other relevant data sources"). Build to the regulation text and keep the wording in one constant.

> (iii) Permissible verification methods--(A) Direct income verification method. Under the direct income verification method, income may be verified through review of written documentation including pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not reflected on such documents (such as evidence of child support and alimony not reported as income) or a certification that there is none, or may be verified through other relevant data sources.
> — SRC PROP L5521-5528

> evidence of other income not reflected on such documents (such as child support and alimony not reported as income), or a certification that would verify income through other relevant data sources.
> — SRC PROP L1273-1276

`[proposed-reg: not final]` (first quote), `[preamble/economic-analysis]` (second quote)

### A6. The income year is the calendar year before the application date
Rule: `income_year = year(application_date) - 1`. A W-2, Form 1040 or transcript for any other year is the wrong document for the direct method.

> is a member of a household with an income which, for the calendar year prior to the date of the application for a scholarship, is not greater than 300 percent of the area median gross income (as such term is used in section 42), and
> — SRC STAT L161

`[statute]`

`[FC]` The proposed regulation repeats the statutory wording without adding a rule for early-year applications or for renewals:

> (A) Is a member of a household with an income that, for the calendar year prior to the date of the application for a scholarship, is not greater than 300
> — SRC PROP L4862-4864

`[proposed-reg: not final]`. "Wrong document" above means wrong for establishing the income year; whether an SGO may use a different year's document as supporting evidence is NOT IN SOURCES.

### A7. "Household" is the student plus everyone residing with the student
Rule: the person named on a benefit letter must be someone who resides with the student. The intake's household list is the list to match names against.

> (iii) Household. The term household includes the individual whose status as an eligible student is being determined, and the group of persons residing with that individual.
> — SRC PROP L4880-4882

`[proposed-reg: not final]`

`[FC]` Added: the proposed regulation has a tie-break for a student who lives in more than one household. It is written for counting household members; the preamble calls the result "the relevant household for purposes of section 25F" (`SRC PROP L1247-1255`). A benefit letter naming a person in the other parent's household is therefore not a letter about "an individual in the student's household" unless that household is the relevant one. Which household is "relevant" for categorical documents is not stated separately: route shared-custody cases to review (spec line 179).

> For purposes of determining the number of members of the student's household in situations in which the student resides in more than one household during the calendar year (for example, in cases of shared custody), the relevant household is the one in which the student resides for the longest period of time during the year or, if the time spent by the student in each household is equal, then the household of the taxpayer with the highest household income.
> — SRC PROP L5503-5510

`[proposed-reg: not final]`

### A8. Household income is HUD "annual income" (24 CFR 5.609) minus imputed asset returns; child support and alimony count; non-cash does not
Rule for the document layer: W-2s, Forms 1040 and transcripts do not show child support. The upload flow needs either evidence of other cash income or a signed "none" certification. A minor's own wages are excluded by the HUD definition, so a W-2 has to be tied to a household member and that member's age.

> the term household income means annual income, as defined in 24 CFR 5.609; however, for this purpose, household income must be determined by disregarding the imputed return on net assets (for example, unrealized appreciation in a home or stock). This definition includes receipts by a member of the household in the form of child support and alimony not included in taxable income but excludes non-cash receipts.
> — SRC PROP L5514-5520

> (3) Earned income of children under the 18 years of age.
> — SRC CFR5609 L12

`[proposed-reg: not final]` (first quote), `[official form/agency]` (second quote; it is in the list of items annual income "does not include")

`[FC]` Two limits on the "minor's wages" statement, both from the same HUD section. Paragraph (a)(1) counts all amounts received by a member who "is 18 years of age or older or is the head of household or spouse of the head of household" (`SRC CFR5609 L3`), so the inclusion rule treats a head of household or spouse differently from other members under 18; whether the exclusion for "children under the 18 years of age" reaches a head of household or spouse who is under 18 is not settled by the text consulted. Paragraph (b)(14) also excludes "Earned income of dependent full-time students in excess of the amount of the deduction for a dependent in § 5.611" (`SRC CFR5609 L48`), which can reach an adult student's W-2. The document layer should record the earner's date of birth and student status and leave the inclusion decision to the income engine (see the HUD annual-income research file).

### A9. The statute puts the verification duty on the SGO
Rule: the SGO, not the platform, is the party that "verifies". The evidence pack has to let the SGO show it reviewed written documentation.

> verifies the annual household income and family size of eligible students who apply for scholarships to ensure such students meet the requirement of subsection (c)(2)(A), and
> — SRC STAT L214

`[statute]`

### A10. None of this is final
Rule: label every decision with the rule version it was made under.

> Each of proposed Sec. Sec. 1.25F-1 through 1.25F-5 is proposed to apply to taxable years ending on or after the date on which the Treasury decision adopting these regulations as final regulations is published in the Federal Register.
> — SRC PROP L2403-2406

`[preamble/economic-analysis]`

`[FC]` Added: the reliance sentence that follows, with its condition. Reliance is all-or-nothing for each party.

> Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent
> — SRC PROP L2406-2412

(the sentence ends "manner." on the next line) `[preamble/economic-analysis]`

### A11. What the sources do not say about categorical documents
- The date the 12 months is counted back from (application date, upload date, SGO decision date, award date): NOT IN SOURCES.
- Whether "12 months" is inclusive of the boundary day: NOT IN SOURCES.
- Whether a letter dated within 12 months whose own benefit period has already ended still shows that the person "currently is approved": NOT IN SOURCES.
- Whether a housing voucher that has been issued but not yet leased up counts as "approved for assistance from" Section 8: NOT IN SOURCES.
- Whether "Section 8 housing" covers only Housing Choice Vouchers or also project-based Section 8 and other programs: NOT IN SOURCES.
- Whether a One-Time TANF payment counts as TANF: NOT IN SOURCES.
- Any list of acceptable document types other than "such as an award letter": NOT IN SOURCES.
- Any form name, portal or upload channel: NOT IN SOURCES.
- `[FC]` Whether a document that proves approval at its date still counts when a later adverse notice exists that the family did not upload: NOT IN SOURCES. HHSC sends termination notices in advance (B1: "13 days advance notice"), so an approval letter alone can never prove the status on the reference date.
- `[FC]` Who must be named on the document. The rule says "an individual in the student's household"; it does not require the student to be the recipient, and it does not say how the SGO confirms that the named person resides with the student: NOT IN SOURCES.

`[FC]` All eight original items were re-checked by keyword search of the proposed rule ("12 months" appears only at `SRC PROP L1280` and `L5532`; "award letter" only at `L1280` and `L5531`), the temporary regulations, the statute and the two IRS pages. None of them settles any item.

### A12. `[FC]` An SGO "must use one or more" of the listed methods; two safe harbors need no income documents
Rule: the direct and categorical methods can be combined or used in the alternative for one student, so a failed categorical upload should fall through to the direct method without restarting. The proposed rule also has a tutoring and special-needs safe harbor and a foster-child safe harbor, under which the income test is treated as met "whether or not the student's household income is verified". Both are out of scope for v1 (spec line 233). What document proves foster status is NOT IN SOURCES, so an uploaded foster placement letter must go to review, not to a rejection.

> An SGO must use one or more of the methods described in paragraph (c)(6)(iii) of this section to verify that a scholarship recipient is an eligible student who satisfies this household income requirement.
> — SRC PROP L5490-5493

> (D) Safe harbor for foster children. An eligible student who is a foster child will be treated as satisfying the requirements in section 25F(c)(2)(A) and Sec. 1.25F-1(a)(4)(i)(A), whether or not the student's household income is verified.
> — SRC PROP L5572-5575

`[proposed-reg: not final]`

---

## B. Texas HHSC: SNAP and TANF (and the look-alike Medicaid and CHIP notices)

### B1. The Texas approval or denial letter for SNAP, TANF and Medicaid is one form: Form TF0001, "Notice of Case Action"
Rule: classify on `Form TF0001`. It is generated by the eligibility system (TIERS) when a case is decided. The same form number is used for approvals, denials, terminations and reductions, and for Medicaid as well as SNAP and TANF. The form number alone proves nothing.

> The Eligibility Determination Group (EDG) disposition produces the person's notice of eligibility status.
> — SRC TWH L9

> Form TF0001, Notice of Case Action
> — SRC TWH L16

> TIERS provides 13 days advance notice to the household after informing them of a denial or termination of ongoing benefits using Form TF0001, Notice of Case Action.
> — SRC TWH L329

`[official form/agency]` Texas Works Handbook A-2310 (Revision 26-1, effective Jan. 1, 2026) and A-2343.1.

### B2. HHSC itself calls the TF0001 the "award letter"
Rule: this is the document the proposed rule's "award letter" maps to in Texas. Use "award letter (Form TF0001, Notice of Case Action)" in the upload copy.

> SNAP benefits will be put into your account once a month. The day you get benefits is printed on your award letter (TF0001).
> — SRC LSC L104

> You can find your EDG number on the TF0001 form we sent you saying that you can get TANF benefits.
> — SRC LSC L107

`[official form/agency]` HHSC Lone Star Card FAQ. The same sentence is printed on the card mailer, Form H1184 (`SRC H1184 L17`).

### B3. What an approval TF0001 tells the person, and what a denial TF0001 tells the person
Rule: an approval carries a start date, a benefit amount, and for SNAP the length of certification. A denial, termination or reduction carries a reason and an effective date. These are the fields to extract.

> If benefits were approved, the notice informs the person of:
> — SRC TWH L17

> the date benefits begin or Medicaid effective date;
> — SRC TWH L18

> the length of certification for Supplemental Nutrition Assistance Program (SNAP) EDGs; and
> — SRC TWH L20

> If benefits were denied, terminated or reduced, the notice informs the person:
> — SRC TWH L22

> the reason for the denied application, denied EDG or reduced benefits;
> — SRC TWH L23

`[official form/agency]`

`[FC]` The handbook lines between those quoted complete the approval list: "the amount of benefits;" and "the remaining federal and state time limit months for Temporary Assistance for Needy Families (TANF), if applicable;" (`SRC TWH L19-21`). So a TANF approval can print time-limit months; do not read that number as a certification period. The handbook describes what the notice "informs the person of"; it does not show where on the page each item is printed.

### B4. Verified layout of a current TF0001 (HHSC's own redacted sample, form version 06/2026, notice dated 09/08/2026)
Rule: this is the only layout verified from an official source. It is a Medicaid notice, which is exactly the look-alike the parser must not accept, and it shows both an approval table and a denial table on one page.

Page 1, top to bottom:

| Element | Verbatim text in the sample | Notes |
|---|---|---|
| Return address, top left | `TEXAS HEALTH AND HUMAN SERVICES COMMISSION` / `P O BOX 149029` / `AUSTIN, TEXAS 78714-9029` | HHSC logo top right |
| Notice date | `Date:` then `09/08/2026` | `MM/DD/YYYY`, left column, bold label |
| Case number | `Case Number:` then a redacted value | Left column, under the date |
| Help box, right | `Need help?` / `Call 2-1-1 or 1-877-541-7905` | The same two numbers appear on the other HHSC samples consulted (H1020, H1211, H1830-R) |
| Addressee block | redacted, right-centre | Window-envelope position |
| Main heading | `Notice about your case:` | Large bold |
| Program section heading | `Health Care Benefits` | One section per program area |
| Approval table title | `Who gets health care benefits` | Full-width table |
| Approval table columns | `Name` / `EDG number` / `Program` / `Date` | One row per person. Program cell reads `Medicaid`. Date cell is a range: `08/05/2026 -` over `09/30/2026` |
| Denial table title | `Who can’t get health care benefits` | Curly apostrophe in the source |
| Denial table columns | `Name` / `EDG Number` / `Program` / `Date` | Date cell is a single date: `10/01/2026` |
| Reason block | `Reason:` then `You are not eligible for benefits. - (TWH A-2340, 1 TAC 366.215; [...]` | Legal citations follow the plain sentence |
| Notes block | `Notes:` then `[name] has not shown that they are either a citizen or a non-citizen who is qualified to receive benefits.` | Free text |
| Footer, each numbered page | `Form TF0001` / `06/2026` left, `Page 1 of 3` right | Version changes over time; do not hard-code it |

> Date: 09/08/2026
> — SRC TF L7

> Case Number:
> — SRC TF L8

> Notice about your case:
> — SRC TF L16

> Who gets health care benefits
> — SRC TF L18

> Who can’t get health care benefits
> — SRC TF L28

> You are not eligible for benefits. - (TWH A-2340, 1 TAC 366.215;
> — SRC TF L36

> has not shown that they are either a citizen or a non-citizen who is qualified to
> — SRC TF L40

> Form TF0001 Page 1 of 3
> — SRC TF L45

Later pages: "Other help you can get and your rights:" (page 3), a blank page, then an appeal page headed "Your right to appeal:" with footer `Form TF0001 Appeal` / `07/2026`. The appeal page prints a legal-aid office name and address; that block is not the family's address.

> If you want a hearing, you must ask for it within 90 days of the date of this letter or the start date of the
> — SRC TF L119

> Form TF0001 Appeal
> — SRC TF L154

`[official form/agency]` HHSC Ambassador Toolkit, "Sample Notice – Form TF0001, Notice of Case Action" (`SRC KIT L112`). The page image was also inspected: `img/tf0001-1.png`.

`[FC]` Re-verified: the PDF was downloaded again from hhs.texas.gov on 2026-11-18 and is byte-identical to the saved copy; the page image matches every row of the table above. Two additions from the same sample. (1) The appeal page states two periods counted from "the date of this letter": 90 days to ask for a hearing and 13 days to keep benefits during appeal (`SRC TF L119`, `L125-126`). Neither is a benefit period. (2) The toolkit lists this sample as "PDF In English" only, while the other sample notices have Spanish versions (`SRC KIT L110-114`). This is one redacted sample of one case; other TF0001s may carry sections, columns or rows this sample does not show.

### B5. The SNAP and TANF sections of a TF0001: exact headings are NOT IN SOURCES
Rule: HHSC's published sample shows only the "Health Care Benefits" section. The exact section heading, table titles and "Program" cell text for SNAP and TANF are NOT IN SOURCES (official). Do not key the parser on one exact SNAP heading string. Key it on the structure verified in B4 (a `Who gets ...` table versus a `Who can’t get ...` table) plus a program keyword family (B13).

One unverified pointer, for reviewers only: a web search result for a user-uploaded 2021 TF0001 is titled "Notice About Your Case:: SNAP Food Benefits", and the search summary describes a "Who gets SNAP Food Benefits" table listing household members with dates and monthly amounts. That document was not opened (it is a real person's notice). `[secondary/web]`, search-result snippet only, UNVERIFIED.

What official sources do confirm about program names HHSC uses with clients: "SNAP food benefits", "TANF cash help for families" and "Health care" (renewal form, B10), and the page titles "SNAP Food Benefits" and "TANF Cash Help" on hhs.texas.gov.

### B6. SNAP has a certification period; TANF does not
Rule: expect an end date on a SNAP approval and none on a TANF approval. A SNAP certification can be as short as one month or as long as 36 months, so "notice within 12 months" and "certification still running" are two different checks.

> TANF does not have a certification period. The EDG remains open until denied.
> — SRC TWH L150

> Exception: Texas Simplified Application Project (TSAP) and SNAP-Combined Application Project (SNAP-CAP) participants receive a 36-month certification period.
> — SRC TWH L172

The same table gives "six months", "six to 12 months", "three to six months" and "one or two months" for other household types (`SRC TWH L164-175`).

`[official form/agency]` Texas Works Handbook A-2324 (Revision 25-1).

Consequence: a TSAP or SNAP-CAP household can be validly on SNAP today with an approval TF0001 that is more than 12 months old. That family fails the "dated within the last 12 months" element with the approval letter and needs a newer HHSC document. Which newer document HHSC issues mid-certification: NOT IN SOURCES.

`[FC]` Two corrections of scope. (1) "TANF does not have a certification period" does not mean TANF is never reviewed: the same section sets a periodic review "from the date staff dispose the EDG", at 11 or five months for applications and 12 or six months for reviews (`SRC TWH L151-157`). A TANF approval letter can therefore be recent and the case still be closed later; there is simply no end date printed to check. (2) The consequence above is an inference from the certification table, not an HHSC statement. B16 shows that some changes during a certification produce no TF0001 at all, which makes "ask for a newer notice" unreliable; B14 gives the official way to get a copy of the existing one.

### B7. "Denial" and "termination" are defined terms, and the handbook gives sample reason sentences
Rule: use these as negative phrases.

> A denial refers to a determination of ineligibility for a person not currently receiving benefits.
> — SRC TWH L41

> A termination refers to a determination of ineligibility for ongoing benefits.
> — SRC TWH L42

> The income a person gets is more than allowed for this program. Applicant did not provide proof showing that they live in Texas.
> — SRC TWH L48

> Applicant has not verified they are either a citizen or non-citizen who qualifies to receive benefits.
> — SRC TWH L49

`[official form/agency]` Texas Works Handbook A-2311.

### B8. One notice can decide several programs with different outcomes
Rule: evaluate each program section and each table on its own. A TF0001 can approve SNAP and deny Medicaid, or the reverse.

> Eligibility for multiple programs is determined independently.
> — SRC TWH L31

`[official form/agency]`

### B9. Case number and EDG number
Rule: the case number is one per case; each program group has its own EDG number, shown per row in the TF0001 tables. HHSC's published samples print the case number as ten digits (`1234567890`, `9999999999`). The length and format of an EDG number are NOT IN SOURCES (redacted in the sample). The last digit of a TANF EDG number sets the deposit day, so it is a digit.

> Your Texas Benefits: Renewal Form Case number: 1234567890
> — SRC H1010R L1

> Case number: 9999999999
> — SRC H1809 L8

> The last number in your TANF Eligibility Determination Group (EDG) number tells which day you get your benefits.
> — SRC LSC L106

`[official form/agency]` for the second and third quotes. `[FC]` The first quote is retagged `[secondary/web]`: the file is a copy of HHSC's Form H-1010R (footer "Form H-1010R/ Dec 2018", the word SAMPLE across it) hosted by a Medicaid health plan, not by HHSC.

`[FC]` Added: HHSC's own H1809 sample prints a nine-digit placeholder under the label `Medicaid EDGs:`. Like the ten-digit case numbers, this is a placeholder in a sample, not a format specification. It is the only evidence in the sources for EDG length, so the fixtures' nine-digit EDG numbers are consistent with it, and the parser must not reject other lengths. The H1830-R sample labels the same two header fields differently from the TF0001: `DATE:` and `CASE NO:` in capitals (`SRC H1830R L10-11`).

> Medicaid EDGs: 999999999
> — SRC H1809 L28-29

`[official form/agency]`

### B10. Other HHSC paper that looks like a TF0001 and is not an approval

| Form | Title and identifying text | What it is | Categorical value |
|---|---|---|---|
| H1020 | `To find out if you can get or keep getting benefits, we need more facts from you:`; footer `Form 1020` / `12/2022`; table `Program` / `EDG number` / `Due date` | Request for information while a case is pending | None. Not a decision |
| H1830-R | `Form H1830-R`; `It is time to renew your benefits.`; `The benefits you need to renew have a check-mark next to them:` with `SNAP` / `TANF` / `Health Care` | Renewal notice | Not an approval. Shows a case exists. Human review at most |
| H-1010R | `Your Texas Benefits: Renewal Form`; `The people on your case get the benefits marked below.` with `SNAP food benefits` / `TANF cash help for families` / `Health care for:` | Pre-filled renewal form | Same as above |
| H1211 | `It is time to renew your Health Care Benefits`; `ACTION REQUIRED: Send items back to us.`; `If you don't respond by these benefits might end.` | Medicaid renewal cover letter | None (Medicaid) |
| H1809 | `Deadline Extended to Return Renewal Packet or Request for Information` | Medicaid deadline extension | None |
| H1017 | `Notice of Benefit Denial or Reduction`; check-box lines such as `Your SNAP benefits will be lowered`, `has been denied.`, `You will not be eligible for` | Manual denial or reduction notice | Negative, except a "lowered" box, which means the benefit continues: human review |
| H1009 | `TANF/SNAP Benefits Notice of Eligibility`; `Only the checked boxes apply to you.`; `Your family will receive` ... `each month, beginning`; `Your household is eligible for` ... `per month in SNAP benefits from` ... `through` | Manual approval notice an advisor fills in | Positive in substance, but check-box driven: always human review |
| H1184 | `Here is your Lone Star Card` | Card mailer | None. No decision, no date of approval |
| H1718 `[FC]` | `Notice of Benefit Denial` (title from the handbook only; layout NOT IN SOURCES) | Sent by state office instead of a TF0001 when child support collected exceeds the TANF grant (`SRC TWH L395`) | Negative for TANF |

`[FC]` Verified against the saved forms: every identifying string in this table appears in the cited file. Notes: the H1020 sample's footer reads `Form 1020` (no "H"); the H1211 footer reads `H1211 MR Cover Letter/12/2022` and its return address uses P O BOX 149027, not 149029; the H1809 return address reads `HEALTH AND HUMAN SERVICES COMMISSION` without "TEXAS" and `AUSTIN TX`, so a classifier keyed on the TF0001 address block will miss it. The H1009 and H1017 texts come from the XFA layer of fillable PDFs (static labels only), so the table describes blank forms, not completed notices. The "Categorical value" column is the author's assessment, not a sourced rule.

> To find out if you can get or keep getting benefits, we need more facts from you:
> — SRC H1020 L6

> It is time to renew your benefits.
> — SRC H1830R L25

> The people on your case get the benefits marked below.
> — SRC H1010R L72

> If you don't respond by these benefits might end.
> — SRC H1211 L30

> Notice of Benefit Denial or Reduction
> — SRC H1017 L14

> TANF/SNAP Benefits Notice of Eligibility
> — SRC H1009 L3

> Only the checked boxes apply to you.
> — SRC H1009 L9

> Advisors complete this form for clients certified for TANF (and prior Medicaid, if appropriate) and SNAP.
> — SRC H1009P L45

`[official form/agency]`

### B11. Notices are also issued in Spanish
Rule: detect Spanish and send to human review in v1. The Spanish TF0001 text is NOT IN SOURCES. The Spanish H1009 title is the only verified Spanish heading.

> All notices must be in plain language and follow agency accessibility policy. Translate the notice into the person’s preferred language when required.
> — SRC R1300 L7

> Notificación sobre el derecho a recibir beneficios de TANF y SNAP
> — SRC H1009S L3

`[official form/agency]` (the first quote is from the Medicaid for the Elderly and People with Disabilities Handbook, R-1300; HHSC publishes Spanish versions of most client forms, marked "ES" in the forms list).

`[FC]` The R-1300 quote governs Medicaid notices for elderly and disabled people, not SNAP or TANF, so on its own it does not prove the heading of this fact. The Texas Works Handbook, which does cover SNAP and TANF, supports a narrower statement: free-text comments are written in Spanish for Spanish-only speakers. Whether the whole TF0001 is issued in Spanish is NOT IN SOURCES (HHSC's toolkit publishes the TF0001 sample in English only, B4). The engineering rule (detect Spanish, send to review) stands.

> Note: For those who are Spanish speaking only, make sure all comments provided on the H1020 are in Spanish. Refer to Form H1020 instructions for translation of common pending phrases.
> — SRC TWH L15

`[official form/agency]` Texas Works Handbook A-2310.

### B12. YourTexasBenefits: letters are posted to the account; a distinct "benefit verification letter" is NOT IN SOURCES
Rule: a family can download the same TF0001 as a PDF from the portal ("Message Center", then "My Letters and Forms"), which is better parser input than a phone photo. Tell parents where to find it. No official source describes a separate SNAP or TANF "benefit verification letter" or "case summary" printout, or its layout. Treat any portal screenshot or printout that is not a TF0001 as human review. Do not scrape the portal (spec constraint).

> Print a form from the website: Go to YourTexasBenefits.com and log in. Click 'Message Center', then
> — SRC H1211 L51

> Go to this website to view your case, report changes
> — SRC TF L58

> Sign up to get text or email alerts when a new letter or form is posted to your
> — SRC YTBF L27

> Need a SNAP award letter or proof of benefits? Ask HHSC for the notice documenting your SNAP decision.
> — SRC FTX L42

`[official form/agency]` (first three quotes; the third is HHSC's "Create a Your Texas Benefits Account" handout); `[secondary/web]` (fourth quote).

`[FC]` Corrections. (1) The fourth quote is not from Feeding Texas. The page at feedingtx.org titles itself "Feeding America Texas" and says it "is an affiliate of Feed America (EIN 92-1761881)"; no link to the Feeding Texas food-bank network or to Feeding America is shown in the saved page. Treat it as an unvetted third-party site and do not cite it in product copy. Its own footer says its notice sources were "reviewed September 29, 2026". (2) The menu path "Message Center", then "My Letters and Forms" is verified only as the place to print a renewal form (the H1211 quote). That the TF0001 itself is posted there is an inference from the handout's "a new letter or form is posted to your online account". The official statement that a household can get a copy of its TF0001 "by calling 2-1-1 or accessing their Your Texas Benefits online account" is in B14, and it names no menu path. Family-facing copy should say "in your Your Texas Benefits account, or call 2-1-1" and should not promise a menu location.

### B13. TANF variants that need a policy decision
Rule: HHSC runs monthly "TANF Cash Help", "One-Time TANF" and "One-Time TANF for Relatives". A child can get TANF when the caretaker's own income is higher than the chart (a relative caring for a child). The rule only asks that "an individual in the student's household" is approved, so a child-only TANF grant qualifies on its face. Whether a one-time payment is "currently ... approved for assistance" is NOT IN SOURCES: human review.

> The child you care for might be able to get TANF even if your income is higher than what is listed in this chart.
> — SRC TANF L108

`[official form/agency]` hhs.texas.gov "TANF Cash Help" page (headings "One-Time TANF" at `SRC TANF L126` and "One-Time TANF for Relatives" at `SRC TANF L146`).

`[FC]` Verified. "Qualifies on its face" is the author's reading of the proposed rule, not a statement in any source. Added detail for the review screen: the page says One-Time TANF "can be given to a family only once a year" (`SRC TANF L140`) and One-Time TANF for Relatives is "A once-in-a-lifetime payment of $1,000" (`SRC TANF L148`); the handbook abbreviates the first as "OTTANF" and says such cases "are not subject to periodic reviews" (`SRC TWH L159`); the H1009 instructions also name a "One-Time Grandparent Payment" (`SRC H1009P L74`). Add `One-Time`, `OTTANF` and `Grandparent Payment` to the review triggers.

### B14. `[FC]` HHSC's own statement of what a TF0001 shows and how a household gets a copy
Rule: an HHSC program (Texas WIC) that itself accepts SNAP, TANF and Medicaid as proof of income eligibility tells its staff that the TF0001 "indicates each person certified" and that any responsible adult in the household can get a copy by phone or from the online account. Use this in the upload help text. It also confirms that a notice is normally addressed to the head of household, so the addressee is often not the student.

> a. Form TF0001, Notice of Case Action indicates each person certified for Medicaid, SNAP, and TANF. The HOH or any
> — SRC CS08 L164-165

> responsible adult household member can obtain a copy of their Form TF0001 by calling 2-1-1 or accessing their Your Texas Benefits online account.
> — SRC CS08 L174-176

> requirements. HHSC mails most SNAP forms to the person indicated as the head of the household (HOH) in the SNAP case record.
> — SRC CS08 L90-91

`[official form/agency]` Texas WIC Policy CS:08.0, Adjunctive Income Eligibility, effective November 1, 2025 (re-downloaded from hhs.texas.gov on 2026-11-18; identical to the saved copy). The two halves of the first sentence are split by a page break in the PDF. This is WIC policy about WIC certification, not a section 25F rule.

### B15. `[FC]` HHSC does not accept a Lone Star Card or a Medicaid card as proof of current participation
Rule: this is official support for rejecting card photos and balance receipts (P3, P11 item 12). HHSC's reasoning is the same as the proposed rule's: a card does not show that the person is "actively receiving" benefits or for what period. The same policy names a phone line on which a household can have current receipt verified; that is a spoken verification, not written documentation, so it does not satisfy the proposed rule by itself.

> A Lone Star Card – is issued to a TANF or SNAP recipient for electronic benefits transfer (EBT). The Lone Star Card is not acceptable proof of participation in TANF or SNAP as possessing a card or showing the monetary balance on the card does not indicate the person or their household member is actively receiving SNAP or TANF benefits.
> — SRC CS08 L54-58

> Your Texas Benefits Medicaid Card – is issued to each person who participates in the Medicaid program. This is not acceptable proof of current participation in Medicaid because the card does not reflect eligibility periods.
> — SRC CS08 L111-113

> A WIC applicant may contact 2-1-1 or 877-541-7905 for verification that they actively receive Medicaid, SNAP, or TANF benefits.
> — SRC CS08 L48-50

`[official form/agency]` Texas WIC Policy CS:08.0. Side effect for the WIC path: in Texas a person can be income-eligible for WIC because of Medicaid, SNAP or TANF (`SRC CS08 L16-28`). That does not matter for section 25F, where WIC participation counts in its own right, but it explains why WIC paperwork may mention Medicaid.

### B16. `[FC]` Not every change produces a TF0001, and one TANF denial uses a different form
Rule: do not assume a family holds a TF0001 for every change in its benefits. The handbook lists situations with no TF0001, including mass changes such as a cost-of-living adjustment. A family whose only approval notice is older than 12 months may have nothing newer to upload.

> Form TF0001, Notice of Case Action, is not required in the following situations: the state or federal government initiates mass changes that affect the entire caseload or significant portions of the caseload, such as the annual Social Security cost-of-living adjustment.
> — SRC TWH L390-391

> Form TF0001 is not required when child support collected by the Office of the Attorney General exceeded the amount of the grant plus the $75 disregard. In these cases, state office sends Form H1718, Notice of Benefit Denial, to the individual.
> — SRC TWH L395

`[official form/agency]` Texas Works Handbook A-2344.2 (Revision 15-4, effective October 1, 2015).

---
## C. Texas WIC

### C1. The formal proof of WIC participation is the Verification of Certification (VOC); federal rules fix its contents
Rule: a VOC is the one WIC document whose contents are prescribed. It carries the participant's name, the certification date, the date income eligibility was last determined, the certification expiry date, the local agency's name and address, an official's name and signature, and an ID number. It also carries the participant's nutritional risk condition, which is health information the product does not need.

> (4) The Verification of Certification card shall include the name of the participant, the date the certification was performed, the date income eligibility was last determined, the nutritional risk condition of the participant, the date the certification period expires, the signature and printed or typed name of the certifying local agency official, the name and address of the certifying local agency and an identification number or some other means of accountability.
> — SRC WICCFR L194

> (3) The Verification of Certification card is valid until the certification period expires, and shall be accepted as proof of eligibility for Program benefits.
> — SRC WICCFR L193

`[official form/agency]` 7 CFR 246.7(k), eCFR as of 2026-11-01.

### C2. Texas defines the VOC as "proof of participation", and issues it when a family is moving
Rule: a Texas family will usually not hold a VOC unless it asked for one or transferred. On an out-of-State move, Texas staff are told to "Provide the participant a copy of their VOC to take with them to the gaining state" (`SRC CS27 L221-222`). Whether a clinic will print a VOC on request for another purpose: NOT IN SOURCES. The printed layout of a Texas VOC: NOT IN SOURCES (it is produced by the clinic system, called "the MIS" in policy).

> Verification of Certification (VOC) – Proof of participation in the WIC program that can be used to transfer participant(s) to and from another state.
> — SRC CS27 L62-63

> The VOC is valid until the end of the certification period shown on the VOC and must be accepted as proof of eligibility for program benefits.
> — SRC CS27 L163-165

Texas policy lists the data a VOC conveys when it has to be taken by phone: "Name and date of birth of participant", "Certification Start Date", "Certification End Date", "Last month benefits were received", "Risk Codes" (`SRC CS27 L145-149`).

`[official form/agency]` Texas WIC Policy CS:27.0 (eWIC), effective April 1, 2026.

### C3. What a Texas WIC family actually holds day to day: a card, an app, a printed benefit or shopping list, and store receipts
Rule: these are the documents parents will photograph. None of them is described in the sources as stating a certification period or an approval. Their printed layouts are NOT IN SOURCES.

> The local agency (LA) must assign one Texas WIC Card to each economic unit
> — SRC CS25 L22

> E. Offer a hard copy of the shopping list and/or assist the participant
> — SRC CS25 L101

> To view your benefits, you can go to myWIC, get a printed benefit list at your WIC office, or ask a store cashier to print a receipt with your current balance.
> — SRC WSHOP L76

> Scan your WIC Card or enter your 19-digit WIC Card number
> — SRC WMY L87

`[official form/agency]` Texas WIC Policy CS:25.0 (eWIC); texaswic.org.

Facts that follow for the parser: benefits are monthly and "do not roll over to the next month" (`SRC WSHOP L81`), so a benefit list or balance receipt is evidence of benefits for one named month only; benefits for all family members are added together on one card; the card number is 19 digits and is not a participant ID.

### C4. Holding a Texas WIC card proves nothing: an ineligible person keeps the card
Rule: never accept a photo of a WIC card.

> A participant found ineligible must keep their
> — SRC CS23 L28

(the sentence continues "Texas WIC Card." on the next line of the policy)

`[official form/agency]` Texas WIC Policy CS:23.0, effective April 1, 2026.

### C5. Certification periods: the end date is "the last day the participant will receive benefits"
Rule: extract the certification end date and compare it with the reference date. Children are certified for 12 months in Texas; a pregnant woman until the end of the month her infant turns six weeks; a non-breastfeeding postpartum woman until the last day of the month her infant turns six months `[FC: corrected from "the end of the sixth month"]`. A child's WIC eligibility expires at the end of the month of the fifth birthday `[FC: corrected from "at a child's fifth birthday"]`, so many scholarship-age students are not themselves on WIC. The rule only needs someone in the household to be.

`[FC]` The policy's other categories, which the author left out: a breastfeeding woman "is certified up to the last day of the month the infant turns 1-year or until the woman discontinues breastfeeding, whichever comes first" (`SRC CS24 L61-63`); an infant enrolled younger than six months "is certified up to their first birthday" with an end date "the day prior to the infant's first birthday" (`SRC CS24 L129-131`); an infant enrolled at six months or older "is certified for a six-month period" (`SRC CS24 L137-139`). Certification end dates can be extended or shortened by one month (`SRC CS24 L25-29`). So WIC certification periods run from a few months to about 12 months, and a WIC document dated within 12 months can show a certification that has already ended.

> III. A postpartum woman who is not breastfeeding is certified until the last day of the month that her infant turns six months or the pregnancy ends.
> — SRC CS24 L53-55

> Eligibility for a child turning five years of age will expire at the end of the month in which the child reaches their fifth birthday.
> — SRC CS24 L103-104

> Certification end date is the last day of the certification period and the last
> — SRC CS24 L22

> V. A child, up to age 5, is certified for a 12-month period ending on the
> — SRC CS24 L96

`[official form/agency]` Texas WIC Policy CS:24.0, effective November 1, 2025.

### C6. The WIC negative document has a fixed name
Rule: `WIC Notification of Ineligibility/Termination` is the title of the adverse notice. Reject it.

> A person found ineligible for the program must be notified in writing of the
> — SRC CS23 L24

Policy text continues: "Local agencies (LAs) must use the MIS WIC Notification of Ineligibility/ Termination to document an applicant’s or participant’s ineligibility or termination from the program." (`SRC CS23 L25-28`).

`[official form/agency]`

`[FC]` Verified, with three limits on "Reject it". (1) The notice names one applicant or participant, and what it implies for the rest of the household depends on the reason. For income or residency ineligibility the policy says the other active participants in the household get "one final set of benefits" and are then terminated (`SRC CS23 L67-77`); for a reason personal to one member, such as "the child is five years or older" (`SRC CS23 L51`), nothing follows for the others. The parser cannot tell these apart reliably: reject this document as proof, record the stated reason for the reviewer, and do not infer the status of other members either way. (2) The policy shows the title as a form name; the printed layout is NOT IN SOURCES. The notice can be read and signed "in the MIS or the myWIC account" or sent by email, SMS or mail (`SRC CS23 L64-66`, `L97-104`), so screenshots of it are likely. (3) A separate "Notification of Certification Expiration" exists and can be verbal or written. It is a reminder that a certification is ending, not an adverse decision and not an approval: route it to review.

> III. Notification of Certification Expiration - Notification of Certification Expiration must be given verbally during the last contact in person or in written form.
> — SRC CS23 L156-158

### C7. `[FC]` Federal rule: who is issued a VOC, and one layout per State
Rule: the federal regulation requires a VOC only for migrant-farmworker families and participants "likely to be relocating", which is why most Texas WIC families will not hold one (supports C2). It also requires the card to be "uniform throughout the jurisdiction of the State agency", so there is a single Texas layout to learn once a specimen is obtained. That layout is NOT IN SOURCES.

> (k) Transfer of certification. (1) Each State agency shall ensure issuance of a Verification of Certification card to every participant who is a member of a family in which there is a migrant farmworker or any other participant who is likely to be relocating during the certification period.
> — SRC WICCFR L191

> The Verification of Certification card shall be uniform throughout the jurisdiction of the State agency.
> — SRC WICCFR L194

`[official form/agency]` 7 CFR 246.7(k)(1) and (k)(4).

---

## D. Section 8 (Housing Choice Voucher) documents from a Texas PHA

### D1. There is no Texas or federal "Section 8 award letter"
Rule: the sources show three HUD forms and a set of PHA-specific letters. Layouts of PHA letters differ by agency and are NOT IN SOURCES for Houston Housing Authority and DHA (Houston's site could not be fetched; DHA's public pages carry no sample). Every Section 8 upload goes to human review in v1, with extraction as an aid.

### D2. The Voucher, form HUD-52646: it says the family is eligible, and also that it is not yet a participant
Rule: a voucher shows that the PHA "has determined that the above named family ... is eligible to participate". The same form says the voucher "does not give the family any right to participate" and that participation starts when a HAP contract takes effect. Whether that satisfies "approved for assistance from" is a policy call (A11). Extract the dates and route to review.

Identifying text: `Voucher` / `Housing Choice Voucher Program` / `U.S. Department of Housing and Urban Development` / `Office of Public and Indian Housing` / `OMB No. 2577-0169` / footer `form HUD-52646 (10/2026)` / `Page 1 of 3`.

Fields (box labels verbatim): `Voucher Number`; `1. Unit Size`; `2. Issue Date (mm/dd/yyyy)`; `3. Expiration Date (mm/dd/yyyy)`; `4. Date Extension Expires (mm/dd/yyyy)`; `5. Name of Family Representative`; `6. Signature of Family Representative` and `Date Signed`; `7. Name of Public Housing Agency (PHA)`; `8. Name and Title of PHA Official`; `9. Signature of PHA Official` and `Date Signed`.

> A. The public housing agency (PHA) has determined that the above named family (item 5) is eligible to
> — SRC V52646 L54

> B. The voucher does not give the family any right to participate in the PHA’s housing choice voucher program. The
> — SRC V52646 L72

> family becomes participant in the PHA’s housing choice voucher program when the HAP contract between the
> — SRC V52646 L73

> 3. Date Voucher Expires (mm/dd/yyyy) must be at least sixty days after date Voucher is issued.
> — SRC V52646 L29

`[official form/agency]` HUD form HUD-52646 (10/2026), OMB expiry 10/31/2029. Only the family representative is named; other household members are not listed on the voucher.

`[FC]` Verified against the form re-downloaded from hud.gov on 2026-11-18 (identical file). One correction to the reading: a voucher is not only issued to families that are not yet participants. HUD's regulation says a voucher is also issued "when a participant family wants to move to another unit" (D9). A HUD-52646 by itself therefore cannot tell a new applicant from a family already on the program that is moving. The edition date matters too: the edition date is 10/2026, about a month before this research; vouchers already in families' hands were issued on earlier editions whose wording and footer are NOT IN SOURCES. Do not require the `(10/2026)` footer.

### D3. The HAP contract, form HUD-52641: proof of active participation, but it is a PHA-owner contract and is usually old
Rule: Part A (page 2 of 13) names the tenant and every approved household member, the lease dates and the monthly housing assistance payment. It is the strongest proof that a family is in the program. It is dated at lease-up, so for a family that has stayed in the same unit for more than a year it is older than 12 months. Use it when executed within 12 months; otherwise ask for the latest rent notice (D5).

Identifying text: `Housing Assistance Payments (HAP) Contract` / `Section 8 Tenant-Based Assistance` / `Housing Choice Voucher Program` / `Part A of the HAP Contract: Contract Information` / footer `form HUD-52641 (4/2023)`.

Fields in Part A: `2. Tenant`; `3. Contract Unit`; `4. Household`; `5. Initial Lease Term` (begins on, ends on); `6. Initial Rent to Owner`; `7. Initial Housing Assistance Payment`; then a `Signatures` block with `Print or Type Name of PHA`, `Print or Type Name of Owner`, a signature and a `Date (mm/dd/yyyy)` for each (`SRC V52641 L143-159`).

> Part A of the HAP Contract: Contract Information
> — SRC V52641 L72

> The following persons may reside in the unit. Other persons may not be added to the household without prior written approval of
> — SRC V52641 L92

> The initial lease term begins on (mm/dd/yyyy):
> — SRC V52641 L99

> At the beginning of the HAP contract term, the amount
> — SRC V52641 L110

`[official form/agency]` HUD form HUD-52641 (4/2023). The copy on hud.gov still shows "exp. 4/30/2026"; a newer edition may exist: NOT IN SOURCES.

### D4. The PHA must re-examine the family at least once a year and give written notice of rent changes
Rule: this is why a current participant should have a PHA letter dated within the last 12 months. The regulation's vocabulary for the amounts is "family share", "family rent to owner" and "housing assistance payment".

> (a) PHA responsibility for reexamination and verification. (1) The PHA must conduct a reexamination of family income and composition at least annually.
> — SRC C982 L2

> the PHA must provide the family with 30 days advance notice of any family share and family rent to owner increases
> — SRC C982 L25

`[official form/agency]` 24 CFR 982.516, eCFR as of 2026-11-01.

`[FC]` The rule is narrower than the sentence "a current participant should have a PHA letter dated within the last 12 months". The first quote, paragraph (a)(1), requires an annual reexamination. The second quote is from paragraph (c)(4), which is about interim reexaminations and requires advance notice of increases in family share and family rent to owner. Neither quoted passage says that a written notice is issued after every annual reexamination, or what it is called. That a participant family holds a dated PHA letter from the last 12 months is a reasonable expectation, not a sourced guarantee; when a family has none, ask the PHA for a verification letter (D7) instead of rejecting.

### D5. The annual or interim rent notice is the best "award letter" equivalent; its name and layout vary by PHA
Rule: accept, for human review, a PHA letter that (a) names the PHA, (b) names the head of household, (c) is dated, (d) states an effective date, and (e) states the tenant's portion and the PHA's payment. Names seen in sources: the Texas Department of Housing and Community Affairs (which runs its own voucher program) tells tenants they "will receive a written notice informing me of my new portion of rent and effective date"; Harris County Housing Authority's landlord packet calls the amount "The Family’s rent portion" (`hcha_landlord_packet.txt` line 30). Houston Housing Authority's landlord FAQ is reported by a search summary to call it a "Rent Change Notice" sent to landlord and tenant; that file could not be fetched, so the name is `[secondary/web]`, UNVERIFIED.

> information has been verified. I understand that I will receive a written notice informing me of my
> — SRC TDI L77

`[official form/agency]` TDHCA Section 8 "Income Change Request" form.

### D6. The data behind every PHA action is form HUD-50058; its codes tell approval from exit
Rule: some PHAs hand tenants a 50058 printout. Program code and action code are decisive. `P` is public housing, which is not Section 8. Action `6` is an exit. Action `11` is an expired voucher. Action `10` is issuance of a voucher (not yet leased).

> 1c. Program P=Public Housing, CE= Sec. 8 Certificates, VO= Sec. 8 Vouchers, MR= Sec. 8 Mod Rehab
> — SRC V50058 L107

> 1 = New Admission 6 = End Participation 11 = Expiration of Voucher (VO only)
> — SRC V50058 L132

> 2 = Annual Reexamination 7 = Other Change of Unit 12 = Flat Rent Annual Update (PH only)
> — SRC V50058 L133

> 2i. Projected effective date (mm/dd/yyyy) of next reexamination
> — SRC V50058 L120

Other labels to key on: `2a. Type of action`; `2b. Effective date (mm/dd/yyyy) of action`; `12k. Rent to owner`; `12t. Total family share`; `12u. HAP to owner`; `12v. Tenant rent to owner` (`SRC V50058 L114-115`, `L813`, `L821-823`).

`[official form/agency]` form HUD-50058 (11/2013) as posted on hud.gov (its OMB line reads "expires 12/31/2023"; whether a newer edition is in use: NOT IN SOURCES).

`[FC]` Verified, with additions from the same form. (1) The full action-code list has 15 codes; the rule above names three of them (6, 10 and 11), and the quotes show 1, 2, 7 and 12. The rest: "3 = Interim Reexamination", "4 = Portability Move-in (VO only)", "5 = Portability Move-out (VO only)", "8 = FSS/WtW Addendum Only", "9 = Annual Reexamination Searching (VO only)", "13 = Annual HQS Inspection Only (S8 only)", "14 = Historical Adjustment", "15 = Void" (`SRC V50058 L132-136`). Codes 5, 8, 9, 12, 13, 14 and 15 are not, on their face, evidence of current Section 8 assistance at this PHA: send them to review (code 12 is public housing only; the label of code 15 is "Void"). What each code means in practice is in HUD's instruction booklet, which was not consulted. (2) The `12k` to `12v` labels are in section "12. Housing Choice Vouchers: Tenant Based Vouchers" (`SRC V50058 L801`). Project-based assistance is section 11 and Moderate Rehabilitation section 13, with different line numbers (for example `11k. Contract rent to owner`). Key rent fields on the section number that matches the program code. (3) Household members are listed in section 3 with `3b. Last name & Sr., Jr. etc.` and `3c. First name` for each member (`SRC V50058 L192-197`), so a 50058 can support `NAME_IN_HOUSEHOLD` for any member, not only the head. It also prints full Social Security numbers (`3n`): mask them. (4) No source says that PHAs give tenants a 50058 printout; "some PHAs hand tenants a 50058 printout" is the author's expectation and is UNVERIFIED.

### D7. A PHA-completed verification form also exists
Rule: Texas affordable-housing properties ask PHAs to complete TDHCA's "Income Verification for Households with Section 8 Certificates". A family may hold a copy. It states the effective date of the last certification, the household size and gross annual income, signed by the PHA. Treat it as supporting evidence for review.

> INCOME VERIFICATION FOR HOUSEHOLDS WITH SECTION 8 CERTIFICATES
> — SRC TDV L2

> Based on the last income certification/recertification effective on
> — SRC TDV L34

`[official form/agency]` TDHCA form, revised January 24, 2022.

### D8. Which of these plausibly serves as the "award letter"
In order of strength, for the reviewer's guidance:
1. Annual or interim reexamination rent notice dated within 12 months (D5). Best fit: recent, addressed to the family, issued by the agency, shows continuing assistance.
2. HAP contract Part A executed within 12 months (D3). Proves participation; names the household.
3. HUD-50058 printout with program `VO`, `CE` or `MR`, action 1, 2, 3, 4 or 7, effective within 12 months (D6).
4. PHA-signed verification letter or TDHCA form (D7).
5. Voucher HUD-52646, unexpired (D2). Shows an eligibility determination only. Policy decision needed.
Not acceptable: waiting-list letters, briefing appointment letters, a lease alone, a landlord's ledger, public-housing documents, low-income housing tax credit income certifications.

The proposed rules separately disregard the value of the Section 8 allowance when measuring income (`SRC PROP L1224-1227`), so a HAP amount is never added to direct-method income.

`[FC]` The ranking and the "Not acceptable" list are the author's design guidance. No source ranks Section 8 documents or lists unacceptable ones; the proposed rule says only "written documentation, such as an award letter". The Section 8 allowance statement is from the preamble (`[preamble/economic-analysis]`); the regulation text reaches the same result through "excludes non-cash receipts" (A8). Treating public housing as outside "Section 8 housing" rests on HUD's own form listing "P=Public Housing" separately from the "Sec. 8" codes (D6); the proposed rule does not address public housing by name, so confirm with counsel before auto-rejecting.

### D9. `[FC]` HUD's definitions: applicant, participant, voucher
Rule: HUD's regulation draws the line the product needs. A family is a "participant" only from the effective date of its first HAP contract; before that it is an "applicant" even when it holds a voucher. A participant is "currently assisted", which is the closest HUD term to the proposed rule's "currently is approved for assistance from". A voucher is also issued to an existing participant who wants to move, so a voucher plus evidence of an earlier HAP contract or rent notice indicates a current participant.

> Participant (participant family). A family that has been admitted to the PHA program and is currently assisted in the program. The family becomes a participant on the effective date of the first HAP contract executed by the PHA for the family (first day of initial lease term).
> — SRC C9824 L64

> Applicant (applicant family). A family that has applied for admission to the HCV program but is not yet a program participant.
> — SRC C9824 L12

> Voucher (rental voucher). A document issued by a PHA to a family selected for admission to the voucher program. This document describes the program and the procedures for PHA approval of a unit selected by the family. The voucher also states obligations of the family under the program.
> — SRC C9824 L112

> (a) When a family is selected, or when a participant family wants to move to another unit, the PHA issues a voucher to the family. The family may search for a unit.
> — SRC C982302 L2

`[official form/agency]` 24 CFR 982.4 and 982.302(a), eCFR as of 2026-11-01. These are HUD program definitions. Whether Treasury will read "approved for assistance from ... Section 8 housing" to include a voucher holder who is not yet a participant is NOT IN SOURCES (A11).

---

## E. Social Security Administration: SSI versus everything else SSA pays

### E1. Every SSA notice has a three-line heading; the second line names the program
Rule: this is the most reliable SSI versus SSDI discriminator. Line 1 is always "Social Security Administration". Line 2 is the program title: "Supplemental Security Income" qualifies; "Retirement, Survivors, and Disability Insurance" does not. Line 3 is the subject.

> The first-line heading is always “Social Security Administration.”
> — SRC P610 L77

> The second-line heading is the program title. Use the second-line headings shown below.
> — SRC P610 L79

> Retirement, Survivors, and Disability Insurance
> — SRC P610 L83

> Supplemental Security Income
> — SRC P610 L85

> IMPORTANT: When the notice content crosses program lines, omit the second-line heading (program
> — SRC P610 L90

Third-line headings listed by SSA: "Notice of Award", "Notice of Disapproved Claim", "Claim Information", "Notice of Reconsideration", "Notice of Disability Cessation", "Important Information", "Notice of Change in Benefits", "Notice of Change in Payment", "Notice of Planned Action", "Notice of Overpayment" (`SRC P610 L100-118`).

`[official form/agency]` SSA POMS NL 00610.050.

`[FC]` Verified against the POMS page re-fetched on 2026-11-18 (TN 21, effective 07/01/2024). Three corrections of scope. (1) "Every SSA notice" overstates the source: NL 00610.050 is SSA's drafting standard for notices ("There are four levels of headings used in notices"), it is not a guarantee about every letter SSA mails, and the Benefit Verification Letter (E6) does not follow it (no program line). (2) The source lists four second-line headings, not two. The other two are "Extra Help With Medicare Prescription Drug Plan Costs" and "Special Veterans Benefits" (`SRC P610 L87-89`). Neither is SSI: both map to `SSA_NOT_SSI`. (3) The third-line list is introduced as "Examples of third-line headings" and continues past "Notice of Overpayment" with "Overpayment Information", "Notice of Continuing Disability Review", "Notice of Denial of Reinstatement Request", "Notice of Award of Reinstated Benefits", "Notice of Decision – Fully Favorable", "Pre-Decisional Notice" and "Request for Information" (`SRC P610 L120-132`). The list is not closed, and it is shared by all programs: a third-line heading never identifies the program. Any third-line heading not in the P6 table goes to review.

### E2. The SSI notice family and their form numbers

| Third-line heading | Form | Meaning | Categorical value |
|---|---|---|---|
| Notice of Award | SSA-L8025 | Initial SSI award | Positive only when an ongoing monthly amount is shown; otherwise review (`[FC]`, see the correction below the table) |
| Notice of Change in Payment | SSA-L8151, SSA-L8100 | Ongoing SSI, amount changed | Positive if an amount is due for the current period |
| Notice of Planned Action | SSA-L8155 | Advance notice of a planned change; POMS uses it for suspended payments among other cases | Human review |
| Important Information | SSA-L8165, SSA-L8166 | Various | Human review |
| Notice of Disapproved Claim | SSA-L8030 | SSI denial | Negative |

> The SSA-L8025 is the only notice for initial claims awards and is usually system-generated.
> — SRC P802 L14

> Notice of Award, SSA-L8025;
> — SRC PSI L30

> Notice of Disapproved Claim, SSA-L8030;
> — SRC PSI L32

> Notice of Change in Payment, SSA-L8151 and SSA-L8100;
> — SRC PSI L34

> Notice of Planned Action, SSA-L8155;
> — SRC PSI L36

`[official form/agency]` SSA POMS NL 00802.010 and SI 02005.100.

`[FC]` CORRECTION: "Notice of Award = Positive" is broader than the source. POMS says the SSA-L8025 is also sent when only a past-due payment exists, and E4 quotes SSA's standard paragraph for an award with no payment due. A Notice of Award therefore proves that SSA found the person eligible for at least one month; it does not by itself prove that the person "currently is approved". Treat it as positive only when an ongoing monthly amount greater than zero is shown, and as `needs_review` otherwise. The "Categorical value" column in the table is the author's assessment, not SSA's.

> The SSA-L8025 is sent either by the system or manually when the claimant: • Is eligible for SSI (including cases in E01) for one or more months; • Is due a retroactive but not an ongoing payment; or • Is eligible for SSI at the time of adjudication, even if there were preceding months of ineligibility.
> — SRC P802 L28-35

`[FC]` Further additions. The SSA-L8100 has its own name in POMS, "Notice of Revised Determination," (`SRC P801 L153-154`); SI 02005.100 groups it under "Notice of Change in Payment". Route a notice with that heading to review. SSI notices of these types carry computation worksheets "after the signature page of the notice", and the worksheets list other income such as "Social Security benefits (type A)", "Child support payment (type N)" and "Wages (type W)" (`SRC PSI L41-47`, `L65`, `L80`). Two consequences: the words "Social Security benefits" inside an SSI notice do not make it a Title II notice (classify on the heading block only), and the worksheet pages hold income details the product should not store.

### E3. Verified layout of an SSI notice (SSA's own sample SSA-L8151)
Rule: the sample in POMS is an image-only PDF; the text below was transcribed from the page image.

- Heading block, top left: `Social Security Administration` / `Supplemental Security Income` / `Notice of Change in Payment`.
- Right, below the heading: `Date: February 10, 2003` then `Claim Number: 999-99-9992 DI`.
- Addressee block, left.
- Right: `Type of Payment` then `Individual--Disabled`.
- Body: `We are writing to tell you about changes in your Supplemental Security Income payments.`
- Bold caption: `Your Payments Will Be Changed As Follows:` with a three-column table `From` / `Through` / `Amount Due Each Month`; the row reads `March 01, 2003` / `Continuing` / `$387.50`.
- Bold caption: `Information About Your Payments`.
- Footer, left: `SSA-L8151`.

> Social Security Administration / Supplemental Security Income / Notice of Change in Payment
> — IMG L8151 page 1

> Date: February 10, 2003 / Claim Number: 999-99-9992 DI
> — IMG L8151 page 1

`[FC]` The page image was re-read by the fact-checker and every string above matches it. The PDF was re-downloaded from secure.ssa.gov and is identical to the saved copy. Two details the list omits: under the amount the sample prints "This includes $23.00 from the State of New York." (a State supplement line, which POMS shows as an optional fill-in), and the addressee block of the example shows a personal name with a Rochester, New York address (the claim number begins 999, so the example is presumably not a real person; do not reuse the name in fixtures). POMS gives the caption as a template, "(1) Will Be (2) As Follows:", where (1) is "Your Payments" or "The Payments of (Recipient's Name)" and (2) is "Changed" or empty, and the "Through" cell is a month and year or "Continuing" (`SRC P805 L199-202`, `L210-217`, `L227-228`). The parser must accept all four caption variants, not only `Your Payments Will Be Changed As Follows:`.

`[official form/agency]` SSA POMS SI 02005.100, example 1 (`poms_G-SSA-L8151-1.pdf`, image `img/l8151-1.png`). The date format is `Month D, YYYY`. The claim number is a Social Security number plus a suffix: it must be masked before storage. The sample is from 2003; SSA's current notices may print a different reference in place of the full number (the 2020 letter in E6 uses `BNC#`): NOT IN SOURCES for SSI notices.

### E4. Standard opening sentences: award, denial, and "eligible but no payment"
Rule: these are SSA's standard paragraphs. Use them as positive and negative phrase patterns. `(1)` and `(2)` are fill-ins such as "you are" or a name plus "is".

> This is to notify you that (1) eligible to receive Supplemental Security Income payments under the provisions of
> — SRC P804 L279

> After a careful review of (1) case, we have determined that (2) not eligible to receive Supplemental Security Income payments under the provisions
> — SRC P804 L254

> (You) cannot get Supplemental Security Income for the reason given below.
> — SRC P804 L275

> This is to notify you that (1) eligible under the Supplemental Security Income program. Even though (you) are eligible, no payments can be made at this time because of income (2)
> — SRC P804 L397

`[official form/agency]` SSA POMS NL 00804.115, paragraphs 1034 (all SSA-L8025s), 1031 (all SSA-L8030s), 1033 and 1600.

`[FC]` Verified; paragraph numbers and "Situation Where Used" notes match. Scope notes. These are paragraph texts in a POMS section whose header reads "Effective Dates: 07/24/2002 - Present"; SSA's systems may print reworded versions, and no 2026 notice was available to compare, so use the sentences as patterns that raise or lower confidence, never as the only test. Paragraph 1031 is standard on SSA-L8030s "except when claim is denied under the abbreviated application process", where paragraph 1033 is used instead. Further negative or cautionary strings from the same POMS chapter that the author did not list: the denial caption "Why We Can't Pay (1)" with (1) = "You" or the recipient's name (`SRC P805 L147-153`); the post-eligibility caption "Why (Your) Payments Are Stopping" (`SRC P805 L279`); and the Notice of Planned Action paragraph 2019, "We will (1) shown above beginning (2)", whose first choice is "stop (your) payment as" (`SRC P804 L680-686`). The standard lead-in on change notices is "We are writing to tell (1) about changes in (your) Supplemental Security Income (2)" (`SRC P804 L435`), which matches the first body sentence of the sample in E3.

`[FC]` One positive pattern the author missed is the best available signal of an ongoing payment. Paragraph 1486 is used on initial and post-eligibility notices when there is "Only ongoing check due", and the 2003 sample in E3 prints it ("Your regular monthly check of $387.50 will be sent to your bank or other financial institution about the first day of the month."). The third choice for the recipient is "(your) representative payee" (`SRC P804 L393`).

> (Your) regular monthly check of (1) will be sent to (2) about the first day of the month.
> — SRC P804 L379

`[official form/agency]` SSA POMS NL 00804.115, paragraph 1486 (`SRC P804 L376-377` for the situation note).

### E5. Award notices carry a "Type of Payment" heading; denials carry "Type of Claim"
Rule: a second discriminator inside SSI notices. Values include "Individual—disabled", "Individual—blind", "Individual—age 65 or older", "Child—disabled", "Child—blind", "Member of couple—disabled".

> *Type of Payment*
> — SRC P804 L199

> *Type of Claim*
> — SRC P804 L226

> Standard on all SSA-L8025's. Under this heading the appropriate type of payment is
> — SRC P804 L197

`[official form/agency]` SSA POMS NL 00804.115, paragraphs 1027 and 1028.

### E6. The Benefit Verification Letter: one letter can list Social Security benefits, SSI, or both, each under its own heading
Rule: this is the letter most families will fetch from "my Social Security". It is titled "Benefit Verification Letter". SSI appears only under the heading "Information About Supplemental Security Income Payments". Social Security disability or retirement appears under "Information About Current Social Security Benefits". A person can have both sections (the sample does). Decide on the SSI section, never on the word "disability".

Layout of SSA's demonstration letter (text-layer PDF):

| Element | Verbatim text |
|---|---|
| Heading | `Social Security Administration` / `Benefit Verification Letter` |
| Top right | `Date: Month D, Year` / `BNC#: XXXXXXXXXXXXX` / `REF: A, DI` |
| Opening | `You asked us for information from your record. The information that you requested is shown below.` |
| Section (not SSI) | `Information About Current Social Security Benefits` |
| Section (not SSI) | `Information About Past Social Security Benefits` |
| Section (not SSI) | `Type of Social Security Benefit Information` then `You are entitled to monthly disability benefits.` |
| Section (SSI) | `Information About Supplemental Security Income Payments` then `Beginning July 2020, the current Supplemental Security Income payment is $314.50.` |
| Section (SSI) | `Type of Supplemental Security Income Payment Information` then `You are entitled to monthly payments as a disabled individual.` |
| Other sections | `Date of Birth Information`, `Medicare Information`, `Other Important Information`, `If You Have Questions` |

> Information About Current Social Security Benefits
> — SRC BEVE L22

> You are entitled to monthly disability benefits.
> — SRC BEVE L49

> Information About Supplemental Security Income Payments
> — SRC BEVE L58

> Beginning July 2020, the current Supplemental Security Income payment
> — SRC BEVE L60

> Type of Supplemental Security Income Payment Information
> — SRC BEVE L72

> You are entitled to monthly payments as a disabled individual.
> — SRC BEVE L74

`[secondary/web]` The file is SSA's own demonstration letter ("JOHN Q PUBLIC", SSA headquarters address, "SAMPLE BENEFIT VERIFICATION LETTER. FOR DEMONSTRATION PURPOSES ONLY." at `SRC BEVE L85`), dated 2020 and hosted by a New York State programme site. ssa.gov itself refused automated requests, so the current letter could not be compared: wording may have changed since 2020.

`[FC]` Verified against the file re-downloaded on 2026-11-18 (identical). Qualifications. (1) That SSA authored the letter is UNVERIFIED: it is an inference from its content (the Baltimore headquarters address, "PREVIEW" and "THIS IS A DRAFT" marks); the hosting site is a third party and the file name carries the date 07_20_2020. The `[secondary/web]` tag is right. (2) The date line in the sample is the placeholder `Date: Month D, Year`, so the real date format is not shown by this file; `Month D, YYYY` is supported by the 2003 SSI notice in E3 only. (3) The sample is an adult's letter. The wording SSA uses for a child's SSI ("disabled child" or otherwise) is NOT IN SOURCES; the fixture text "as a disabled child" in T2 and FX-13 is an invention. (4) ssa.gov still returned HTTP 403 to a plain request on 2026-11-18.

### E7. The same letter exists in a "no benefits" version
Rule: a Benefit Verification Letter can verify that the person gets nothing. The title is identical. Read the body.

> You do not receive benefits now and have not received benefits in the past.
> — SRC BEVE L137

> You do not have a pending claim for benefits.
> — SRC BEVE L139

`[secondary/web]` Same file as E6, second sample letter.

`[FC]` Verified. The body of this version opens differently from the positive letter, which gives the parser a second signal besides the bullet text:

> You asked us to verify whether you have received benefits from us. This letter verifies that:
> — SRC BEVE L134-135

The sample shows only the "never received" case. How the letter reads for a person whose benefits have stopped (past benefits but none now) is NOT IN SOURCES; the positive sample's heading "Information About Past Social Security Benefits" shows that a past-benefits section exists, so a letter with only past-tense sections must go to review.

### E8. Other names for the letter, and who can get it
Rule: parents will call it a budget letter, benefits letter, proof of income letter or proof of award letter. A parent cannot download a child's letter online unless the parent is the child's representative payee, so expect phone photos of mailed letters for children on SSI. The options a requester can include are amount, type of benefit, Medicare entitlement and date of birth, so a letter can omit the amount.

> called a "budget letter," a "benefits letter," a "proof of income letter," or a "proof of award letter." You can also
> — SRC BEVEHI L72

> You cannot get a benefit verification letter online for another person, such as a spouse or child, unless the
> — SRC BEVEHI L84

> Type of benefit(s) (disability, SSI, retirment, survivors, etc.);
> — SRC OMB1 L130

`[secondary/web]` (first two quotes: SSA FAQ text reproduced in a State of Hawaii benefits-office PDF); `[official form/agency]` (third quote: SSA's submission to OMB for the benefit verification internet service, OMB No. 0960-0595; the misspelling is in the original).

`[FC]` Verified, with two cautions. (1) The third quote is from a filing in a 2011 information-collection request (the URL path is `icr/201106-0960-001`), read on omb.report, a third-party mirror of OMB records. It describes the selection screen SSA proposed then. The options offered by "my Social Security" in 2026 are NOT IN SOURCES, so "a letter can omit the amount" is a possibility to handle (P6 rule 4), not a verified current behaviour. (2) "Expect phone photos of mailed letters for children on SSI" is the author's inference. What the Hawaii PDF's SSA text does say is that a letter can be viewed, printed or saved at once, or mailed, and that a letter for another person can be requested by phone:

> You will be able to view, print, and save the letter immediately. If you receive benefits or have a pending application, you will have the option to request to have a copy mailed to you within 10 business days.
> — SRC BEVEHI L77-78

> If you can’t or don’t want to use your my Social Security account, or you need a letter for someone other than yourself, you can call us at 1-800-772-1213 (TTY 1-800-325-0778), Monday through Friday from 8:00 am to 7:00 pm.
> — SRC BEVEHI L87-89

`[secondary/web]` (SSA text as reproduced by a State of Hawaii office; the phone hours may be out of date, so do not print them in product copy).

### E9. What the sources do not say about SSA documents
- The current (2026) wording and reference-number format of the Benefit Verification Letter: NOT IN SOURCES (ssa.gov blocked).
- The layout of the SSA-L8025 Notice of Award beyond its heading rules, standard paragraphs and captions ("How Much We'll Pay", "Information About Your Payments", "Your Payment Is Based On These Facts", "Information About Medicaid"): NOT IN SOURCES as a full sample.
- How a representative payee is shown in the address block: NOT IN SOURCES.
- Annual cost-of-living notices for SSI: `[FC]` corrected. The sources do say which forms are used: the POMS chapter contents list "Cost of Living Adjustment (COLA) Notices - Use of the SSA-L8151, SSA-L8155 and SSA-L8166" (`SRC P803 L46`). So a yearly COLA notice arrives under the headings "Notice of Change in Payment", "Notice of Planned Action" or "Important Information". Its wording and layout are NOT IN SOURCES. A COLA notice on an SSA-L8151 is likely to be the most recent SSI letter many families hold.
- Whether Form SSA-1099 ever reports SSI: NOT IN SOURCES. Do not accept an SSA-1099 as SSI proof.
- `[FC]` Whether a Benefit Verification Letter names the child or the representative payee as addressee, and whether it states for whom the payee receives payment: NOT IN SOURCES. The 2002 POMS payment paragraph lists "(your) representative payee" as one of the places a check is sent (`SRC P804 L393`), which confirms payee wording exists on SSI notices without showing it.

---
## F. IRS Form W-2

### F1. Box letters, numbers and labels (official 2026 form, Copy B)
Rule: these are the labels to anchor on. Employers print substitute W-2s in many layouts (two-up, four-up, with instructions on the back), but the box numbers and label words are constant.

| Box | Label on the form |
|---|---|
| a | `Employee’s social security number` |
| b | `Employer identification number (EIN)` |
| c | `Employer’s name, address, and ZIP code` |
| d | `Control number` |
| e | `Employee’s first name and initial` / `Last name` / `Suff.` |
| f | `Employee’s address and ZIP code` |
| 1 | `Wages, tips, other compensation` |
| 2 | `Federal income tax withheld` |
| 3 | `Social security wages` |
| 4 | `Social security tax withheld` |
| 5 | `Medicare wages and tips` |
| 6 | `Medicare tax withheld` |
| 7 | `Social security tips` |
| 8 | `Allocated tips` |
| 9 | (blank, unlabelled) |
| 10 | `Dependent care benefits` |
| 11 | `Nonqualified plans` |
| 12a-12d | `See instructions for box 12` (a code and an amount each) |
| 13 | `Statutory employee` / `Retirement plan` / `Third-party sick pay` (check boxes) |
| 14 (2025) | `Other` |
| 14a (2026) | `Other` |
| 14b (2026) | `Treasury Tipped Occupation Code(s)` |
| 15 | `State` / `Employer’s state ID number` |
| 16 | `State wages, tips, etc.` |
| 17 | `State income tax` |
| 18 | `Local wages, tips, etc.` |
| 19 | `Local income tax` |
| 20 | `Locality name` |

> b Employer identification number (EIN) 1 Wages, tips, other compensation 2 Federal income tax withheld
> — SRC W226 L259

> c Employer’s name, address, and ZIP code 3 Social security wages 4 Social security tax withheld
> — SRC W226 L262

> 5 Medicare wages and tips 6 Medicare tax withheld
> — SRC W226 L265

> d Control number 9 10 Dependent care benefits
> — SRC W226 L271

> 15 State Employer’s state ID number 16 State wages, tips, etc. 17 State income tax 18 Local wages, tips, etc. 19 Local income tax 20 Locality name
> — SRC W226 L299

`[official form/agency]` IRS Form W-2 (2026), irs.gov/pub/irs-pdf/fw2.pdf.

### F2. The form changed between tax year 2025 and tax year 2026
Rule: the parser needs a per-year box map. The 2025 form has a single box 14 `Other`. The 2026 form splits it into `14a Other` and `14b Treasury Tipped Occupation Code(s)` and adds box 12 codes for tips and overtime.

> 14 Other
> — SRC W225 L53

> 14a Other
> — SRC W226 L283

> 14b Treasury Tipped Occupation Code(s)
> — SRC W226 L295

> TP—Total amount of cash tips reported to the employer. “Cash tips”
> — SRC W226 L793

> TT—Total amount of qualified overtime compensation. Use this amount
> — SRC W226 L799

`[official form/agency]` IRS Form W-2 for 2025 (irs.gov/pub/irs-prior/fw2--2025.pdf) and for 2026.

`[FC]` Verified by comparing the two saved forms (PDF titles "2025 Form W-2" and "2026 Form W-2"; the 2026 file is identical to the live irs.gov copy on 2026-11-18). The 2026 form adds three box 12 codes, not two: besides `TP` and `TT` there is `TA`, "Employer contributions under a section 128 Trump account contribution program paid to a Trump account of an employee or a dependent of an employee." (`SRC W226 L787-791`; the saved text is two-column, so this description is interleaved with the left column and was read across lines 787, 789 and 791). None of the three appears on the 2025 form. Whether any of these amounts is income for section 25F is a question for the income engine; the parser should capture every box 12 code and amount without interpreting them. Other layout differences between the two years (box 11, 13 and 14 positions shift) are visible in the saved text and reinforce the rule to anchor on labels, not coordinates.

### F3. Title, year, copy designation, OMB number
Rule: title `W-2 Wage and Tax Statement` with a four-digit year beside it; `OMB No. 1545-0029` on both the 2025 and 2026 forms. The employee holds `Copy B—To Be Filed With Employee’s FEDERAL Tax Return.`, `Copy C—For EMPLOYEE’S RECORDS` and `Copy 2—To Be Filed With Employee’s State, City, or Local Income Tax Return`. A family that uploads Copy B and Copy C of one W-2 has uploaded the same wages twice. `22222` appears on Copy A and Copy 1; `VOID` appears on Copy A and on Copy D (the employer's copy) `[FC: corrected, the author wrote "on Copy A" only]`; the employee does not normally hold those copies.

> W-2 Wage and Tax Statement 2026
> — SRC W226 L304

> Copy B—To Be Filed With Employee’s FEDERAL Tax Return.
> — SRC W226 L307

> Copy C—For EMPLOYEE’S RECORDS
> — SRC W226 L505

`[official form/agency]`

### F4. When a 2026 W-2 exists
Rule: employers must furnish 2026 W-2s by February 1, 2027. An application in January 2027 may come before the family has a W-2 for the income year.

> Due dates. By February 1, 2027, furnish Copies B, C, and 2 to
> — SRC W226 L1000

`[official form/agency]`

### F5. Box 1 is the amount that goes on the tax return; boxes 3 and 5 are separate wage figures
Rule: box 1 is the figure the employee enters on the wages line of the return. Box 3 (social security wages) and box 5 (Medicare wages and tips) are separate figures and need not equal box 1; the form text consulted does not explain when they differ (that they often differ because of retirement-plan deferrals is general tax knowledge, not from the source files). Which box is "income" under 24 CFR 5.609 for section 25F: NOT IN SOURCES. Extract boxes 1, 3, 5 and every box 12 code so the income engine can decide.

> Box 1. Enter this amount on the wages line of your tax return unless those
> — SRC W226 L567

`[official form/agency]`

---

## G. Form 1040

### G1. Tax year 2025 Form 1040 (final): the lines that matter
Rule: line labels as printed. Total income is line 9. Adjusted gross income is line 11a on page 1 and repeated as line 11b at the top of page 2. Wages from W-2s are line 1a; all wage-type income is line 1z.

| Line | Label (2025) |
|---|---|
| 1a | `Total amount from Form(s) W-2, box 1 (see instructions)` |
| 1z | `Add lines 1a through 1h` |
| 2a / 2b | `Tax-exempt interest` / `Taxable interest` |
| 3a / 3b | `Qualified dividends` / `Ordinary dividends` |
| 4a / 4b | `IRA distributions` / `Taxable amount` |
| 5a / 5b | `Pensions and annuities` / `Taxable amount` |
| 6a / 6b | `Social security benefits` / `Taxable amount` |
| 7a | `Capital gain or (loss). Attach Schedule D if required` |
| 8 | `Additional income from Schedule 1, line 10` |
| 9 | `Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7a, and 8. This is your total income` |
| 10 | `Adjustments to income from Schedule 1, line 26` |
| 11a | `Subtract line 10 from line 9. This is your adjusted gross income` |
| 11b | `Amount from line 11a (adjusted gross income)` (page 2) |
| 15 | `Subtract line 14 from line 11b. If zero or less, enter -0-. This is your taxable income` |

> 9 Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7a, and 8. This is your total income
> — SRC F40 L80

> 11a Subtract line 10 from line 9. This is your adjusted gross income
> — SRC F40 L82

> 11b Amount from line 11a (adjusted gross income)
> — SRC F40 L86

> 1a Total amount from Form(s) W-2, box 1 (see instructions)
> — SRC F40 L53

`[official form/agency]` IRS Form 1040 (2025), "Created 9/5/25". The irs-pdf copy and the irs-prior 2025 copy are byte-identical.

### G2. Identifying text, filing status and dependents (2025)
Rule: identify with `1040 U.S. Individual Income Tax Return 2025` and the footer `Form 1040 (2025)`; `OMB No. 1545-0074`. Filing status is a set of check boxes: `Single`, `Married filing jointly (even if only one had income)`, `Married filing separately (MFS)`, `Head of household (HOH)`, `Qualifying surviving spouse (QSS)`. The dependents grid has four columns, `Dependent 1` to `Dependent 4`, with rows `(1) First name`, `(2) Last name`, `(3) SSN`, `(4) Relationship`, `(5) Check if lived with you more than half of 2025`, `(6) Check if` full-time student or permanently and totally disabled, `(7) Credits`; a check box covers "more than four dependents". Check boxes need visual detection; text extraction does not show which box is ticked.

> 1040 U.S. Individual Income Tax Return 2025
> — SRC F40 L1

> Married filing jointly (even if only one had income)
> — SRC F40 L25

> Dependents Dependent 1 Dependent 2 Dependent 3 Dependent 4
> — SRC F40 L34

`[official form/agency]`

### G3. Line numbers are year-specific: 2024 used line 11 for AGI
Rule: the U.S. Department of Education's 2026-27 matrix maps 2024 returns and gives AGI as "Line 11". The 2025 form uses 11a and 11b. Key the line map on the tax year printed on the form.

> R3: Adjusted Gross Income | 20/28/38/45 | Manually entered: 95, 155, 205, 245 / FTI: 864, 884, 904, 924 | Adjusted Gross Income | IRS Form 1040 (or 1040-NR)—Line 11 |
> — SRC EDM L4

`[official form/agency]` Federal Student Aid electronic announcement GENERAL-26-46 (July 8, 2026), attachment.

### G4. Tax year 2026 Form 1040: only an early-release draft exists
Rule: the draft dated 2026 keeps line 1a, line 1z, line 9 (total income), line 11a and line 11b with the same wording. It is marked "DRAFT—NOT FOR FILING". The final 2026 form is NOT IN SOURCES. Ship the 2026 line map behind a flag and re-check it when the final form is released.

> Caution: DRAFT—NOT FOR FILING
> — SRC F40D L4

> 1040 U.S. Individual Income Tax Return 2026
> — SRC F40D L39

> 11a Subtract line 10 from line 9. This is your adjusted gross income
> — SRC F40D L130

`[official form/agency]` IRS draft Form 1040 (2026), irs.gov/pub/irs-dft/f1040--dft.pdf, PDF modified 2026-09-17.

`[FC]` Verified: both PDFs are identical to the live irs.gov copies on 2026-11-18, and irs.gov/pub/irs-pdf/f1040.pdf is still the 2025 form, so no final 2026 form exists yet. "Same wording" is true for lines 1a, 1z, 9, 10, 11a, 11b and 15, but the draft is not the 2025 layout with a new year. Differences seen in the saved text: the PDF has three pages because of a cover sheet; sub-lines are printed with full identifiers (`1b`, `1z`, `2b` where the 2025 form prints `b`, `z`, `b`); the filing-status boxes are arranged in a different order on the page; a new question about citizenship or work authorization appears above the dependents grid; and there is a new line `12f Charitable contribution deduction for non-itemizers (see instructions)`, with line 14 changed to "Add lines 12e, 12f, 13a, and 13b" (`SRC F40D L142`, `L147`). A 2025 template will not fit a 2026 return. Every page of the draft carries "DRAFT" marks: a family's filed 2026 return will not, and a document that does carry them is not a filed return.

### G5. What a Form 1040 cannot show
Rule: a return covers the filer and spouse, not every person residing with the student. It shows no child support received. Social security benefits appear as a total on line 6a; whether line 6a includes SSI: NOT IN SOURCES. Variants 1040-SR, 1040-NR and 1040-X: layouts NOT IN SOURCES; send to human review.

---

## H. IRS transcripts

### H1. The transcript types and what each shows
Rule: the Tax Return Transcript is the one that carries income lines. The Record of Account contains it. The Tax Account Transcript alone is too thin. The Wage and Income Transcript is the W-2 substitute. The Verification of Non-filing Letter is not income evidence.

> Tax return transcript - shows most line items from your original Form 1040-series tax return as filed, along with any forms and schedules. It doesn't show changes made after you filed your original return.
> — SRC ITT L274

> Tax account transcript - shows basic data such as filing status, taxable income, and payment types.
> — SRC ITT L275

> Record of account transcript - combines the tax return and tax account transcripts above into one complete transcript.
> — SRC ITT L276

> Wage and income transcript - shows data from information returns we receive such as Forms W-2, 1098, 1099, and 5498.
> — SRC ITT L277

> Verification of non-filing letter - states that the IRS has no record of a processed Form 1040-series tax return as of the date of the request.
> — SRC ITT L278

`[IRS web page]` irs.gov "Transcript types for individuals and ways to order them".

### H2. Masking: what is visible on a transcript
Rule: a transcript cannot be matched to a household by full name, full SSN or full address. Match on last four SSN digits (if the intake collected them), the first four letters of first and last name, and the first six characters of the street address. City, State and ZIP are removed, so a transcript cannot establish the county.

> Last four digits of any SSN: XXX-XX-1234
> — SRC IAB L261

> Last four digits of any EIN: XX-XXX4321
> — SRC IAB L262

> First four characters of the first and last name for any individual (first three characters if the name has only four letters)
> — SRC IAB L264

> First six characters of the street address, including spaces
> — SRC IAB L266

> All money amounts, including wage and income, balance due, interest and penalties
> — SRC IAB L267

> On the masked transcript, some PII is entirely removed, such as the taxpayer’s city, state, and zip code, while other PII is shortened, such as displaying only the last four digits of the taxpayer’s SSN or EIN.
> — SRC IRM L552

`[IRS web page]` irs.gov "About tax transcripts" (first five quotes); `[official form/agency]` Internal Revenue Manual 21.2.3 (last quote).

`[FC]` CORRECTION: the rule above is true of masked transcripts only, and not every transcript is masked. The same IRS page says unmasked Wage and Income transcripts exist, with the full name, address and Social Security number. The manual says every transcript from the Individual Online Account is masked, as are those from Get Transcript by Mail and the automated phone line (`SRC IRM L607`, `L634`, `L640`). So: (a) expect masked transcripts from the self-service channels families will normally use; (b) do not treat an unmasked Wage and Income transcript as a forgery; (c) apply Social Security number masking at extraction to transcripts too, because a full number can be present. The page also lists a visible item the author omitted: "Last four digits of any account or telephone number" (`SRC IAB L263`).

> The IRS will provide unmasked Wage and Income transcripts when needed for preparing and filing tax returns. Unmasked Wage and Income transcripts fully display personally identifiable information such as the taxpayer's name, address, and Social Security number along with the employer's name, address, and Employer Identification number.
> — SRC IAB L268

`[IRS web page]` (page last reviewed 06-Sep-2026).

### H3. The Customer File Number: a ten-digit field the requester chooses, printed on the transcript
Rule: this is a ready-made binding token. Give each verification a random number of up to ten digits, ask the parent to type it in when requesting the transcript, and check that the uploaded transcript shows it. It must not be an SSN.

> This is an optional field allowing up to 10 numeric characters to populate on the transcript.
> — SRC IRM L556

`[official form/agency]` Internal Revenue Manual 21.2.3. The IRS web page says the same ("can be up to 10 digits but cannot be a taxpayer identification number", `SRC IAB L270`).

### H4. Tax Return Transcript: header and line labels
Rule: the header and label strings below were read from a published sample with fictitious data (tax year 2019, © NASFAA, hosted by a City University of New York college). They are `[secondary/web]`; the sample PDF is image-only, so the strings were transcribed from the page image. Labels are upper case, each followed by a colon, dot leaders and a dollar amount.

Header, in order: `Internal Revenue Service` / `United States Department of the Treasury` / `This Product Contains Sensitive Taxpayer Data` / `Request Date: 08-30-2020` / `Response Date: 08-30-2020` / `Tracking Number: XXXXXXXXXXXX` / `Tax Return Transcript` / `SSN Provided: XXX-XX-4872` / `Tax Period Ending: Dec. 31, 2019`.

Then: `The following items reflect the amount as shown on the return (PR), and the amount as adjusted (PC), if applicable. They do not show subsequent activity on the account.` / `SSN: XXX-XX-4872` / `SPOUSE SSN: XXX-XX-2230` / `NAME(S) SHOWN ON RETURN:` (masked) / `ADDRESS:` (first characters only) / `FILING STATUS: Married Filed Joint` / `FORM NUMBER: 1040` / `CYCLE POSTED:` / `RECEIVED DATE:` / `REMITTANCE:` / `EXEMPTION NUMBER:` / `DEPENDENT 1 NAME CTRL:` / `DEPENDENT 1 SSN:` (through dependent 4) / `PTIN:` / `PREPARER EIN:`.

Section `Income`: `WAGES, SALARIES, TIPS, ETC:` / `TAXABLE INTEREST INCOME: SCH B:` / `TAX-EXEMPT INTEREST:` / `ORDINARY DIVIDEND INCOME: SCH B:` / `QUALIFIED DIVIDENDS:` / `REFUNDS OF STATE/LOCAL TAXES:` / `ALIMONY RECEIVED:` / `BUSINESS INCOME OR LOSS (Schedule C):` / `BUSINESS INCOME OR LOSS: SCH C PER COMPUTER:` / `TOTAL IRA DISTRIBUTIONS:` / `TAXABLE IRA DISTRIBUTIONS:` / `TOTAL PENSIONS AND ANNUITIES:` / `TAXABLE PENSION/ANNUITY AMOUNT:` / `UNEMPLOYMENT COMPENSATION:` / `TOTAL SOCIAL SECURITY BENEFITS:` / `TAXABLE SOCIAL SECURITY BENEFITS:` / `TOTAL INCOME:` / `TOTAL INCOME PER COMPUTER:`.

Section `Adjustments to Income`, ending with `ADJUSTED GROSS INCOME:` / `ADJUSTED GROSS INCOME PER COMPUTER:`. Section `Tax and Credits`: `TAXABLE INCOME:` / `TAXABLE INCOME PER COMPUTER:`. Page footer: `This Product Contains Sensitive Taxpayer Data`.

> Tax Return Transcript / SSN Provided: XXX-XX-4872 / Tax Period Ending: Dec. 31, 2019
> — IMG NASFAA sample, citytech_2019_example.pdf page 4

> ADJUSTED GROSS INCOME: / ADJUSTED GROSS INCOME PER COMPUTER:
> — IMG NASFAA sample, citytech_2019_example.pdf page 4

`[secondary/web]`. The 2024-return item names are confirmed by the U.S. Department of Education matrix (H5). The exact header of a transcript issued in 2026 or 2027: NOT IN SOURCES. The sample's date format is `MM-DD-YYYY` for request and response dates and `Mon. DD, YYYY` for the tax period.

`[FC]` The embedded page images were extracted again from the PDF (identical to the live file) and re-read. The header strings, the section names and the listed labels match. Corrections and limits. (1) "Page footer" is not what the sample shows. The sentence `This Product Contains Sensitive Taxpayer Data` appears once under the header and once at the very end of the transcript; the sample does not show it at the foot of each page. Use it as a start and end marker, not as a per-page footer. (2) The images are low resolution (about 413 by 511 pixels for a full page). The filing-status value is read as `Married Filed Joint`, but the spelling is UNVERIFIED: "Filed" versus "Filing" cannot be told apart with confidence at this resolution, so match `Married Fil(ed|ing) Joint`. Do not rely on the exact dot-leader count or on the masked name string. (3) A second date format appears: `RECEIVED DATE: Apr.15, 2020`, with no space after the period. (4) The sample is a mock-up prepared for financial-aid training ("Sample Tax Return Transcript: Marcos and Carolina Tamez", "© 2020 NASFAA") for tax year 2019. Only the item names in H5 are confirmed by an official 2026 source; every other label is from this one secondary sample and must be confirmed on a real 2025 transcript before any automatic acceptance. (5) The IRS manual says official examples exist "on the Transcript Delivery System (TDS) web page under TDS Transcript Examples" (`SRC IRM L416`); the manual places that page "on SERP" (`SRC IRM L552`), and it was not obtained.

### H5. Official item names on the 2024 Tax Return Transcript, and the "Per Computer" rule
Rule: the transcript has no line numbers. The U.S. Department of Education names the items: "Adjusted Gross Income"; "Wages, Salaries, Tips, etc."; "Business Income or Loss (Schedule C)"; "Farm Income or Loss (Schedule F)"; "Total Tax Liability TP Figures"; "Tax-Exempt Interest"; "Total IRA Distributions"; "Taxable IRA Distributions"; "Total Pensions and Annuities"; "Taxable Pension/Annuity Amount". Where a transcript shows more than one value for an item, federal student aid uses the "Per Computer" value and ignores "VERIFIED AMOUNT". Whether section 25F verification should do the same: NOT IN SOURCES; it is the sensible default because it is the IRS-corrected figure.

> Since the IRS Tax Return Transcript does not have line or item numbers and uses wording that may be different from what is used on the FAFSA form
> — SRC EDA L23

> R16: PER COMPUTER—The Per Computer amount must be used for verification even if it is different than what was reported by the tax filer to the IRS.
> — SRC EDM L17

> R17: "VERIFIED AMOUNT" - This amount should be ignored for purposes of verification.
> — SRC EDM L18

> The taxpayer’s original figures, labeled "per return," and,
> — SRC IRM L453

> The figures as corrected by the IRS, labeled "per computer."
> — SRC IRM L454

`[official form/agency]` Federal Student Aid GENERAL-26-46 attachment; Internal Revenue Manual 21.2.3.2.1.

### H6. Limits of a Tax Return Transcript
Rule: it shows at most four dependents, so never derive household size from it. It does not reflect an amended return. One transcript per spouse is needed when spouses file separately.

> TDS is programmed to display only four dependents.
> — SRC IRM L450

> Tax return transcripts will not show amendments or adjustments made to the account after the original return has posted.
> — SRC IRM L451

`[official form/agency]`

`[FC]` The two quotes support the first two sentences of the rule. The third sentence ("One transcript per spouse is needed when spouses file separately") has no quote: it restates the U.S. Department of Education's FAFSA instruction in the matrix ("must provide separate IRS Tax Return Transcripts for each person", `SRC EDM L19`) and follows from the fact that each separate filer has a separate return. It is not a section 25F rule. The same manual passage adds that transcripts "only display up to three Schedule Cs" (`SRC IRM L415`).

### H7. Wage and Income Transcript: availability and limits; exact layout NOT IN SOURCES
Rule: it lists what payers reported (W-2, 1099, 1098, 5498). It can be incomplete, shows no State or local withholding, is capped at about 85 documents online, and for the newest year is not available until February. Before that it reads "No record of return filed". The section titles and field labels of the Wage and Income Transcript, the Record of Account Transcript and the Tax Account Transcript are NOT IN SOURCES (no official or sample copy was obtained). Send these three to human review until a real sample has been reviewed by the team.

> The transcript will only display information return documents that have been filed with the IRS which may not reflect all the information return documents issued to you.
> — SRC ITT L277

> Wage and income transcripts do not show state or local income tax withholding.
> — SRC IRM L518

> A wage and income transcript is not available until February 17, 2026, for the current processing year. The transcript will display a message of “No record of return filed” instead of displaying actual wage and income information.
> — SRC IRM L624

`[IRS web page]` (first quote); `[official form/agency]` (IRM). The February 17 date is the 2026 processing-year date; the 2027 date is NOT IN SOURCES (the web page says "the first week in February").

`[FC]` Verified. Details checked: "approximately 85 income documents" is the web page's and the manual's wording (`SRC ITT L277`, `SRC IRM L630`); the two sources capitalise the message differently ("No Record of return filed" on the web page, "No record of return filed" in the manual), so match case-insensitively. One nuance on H1: the Tax Account Transcript is not empty of income data. The manual lists "Adjusted gross income." and "Taxable income." among what it shows (`SRC IRM L486-487`), but not wages or total income. "Too thin" is the author's judgment; an Account Transcript can corroborate AGI for the reviewer.

### H8. `[FC]` Verification of Non-filing Letter: wording, timing, and what it does not say
Rule: the letter has two versions, and only one of them says no return was processed. It says nothing about whether the person had to file, and for the most recent tax year it is not available until mid-June. For an income year of 2026 that means no non-filing letter before June 15, 2027.

> The letter has two versions based on if a return has not or has posted. TDS will generate the applicable version: If a return has not posted, the letter includes the language "we have no record of a processed tax return." If a return has posted, the letter includes the language "we’re sorry, but we couldn’t honor the request."
> — SRC IRM L528-530

> The verification of non-filing (VNF) letter is issued to verify the IRS does not have a record of an IMF return processed at that time for the requested period. This letter does not provide any status of the taxpayer’s filing requirement.
> — SRC IRM L522

> This letter is available after June 15 for the current tax year or anytime for the prior three tax years.
> — SRC ITT L278

`[official form/agency]` Internal Revenue Manual 21.2.3.2.5 (first two quotes); `[IRS web page]` (third quote). Parser consequence: classify `IRS_VNF` on `Verification of Non-?filing` and then require `no record of a processed tax return`; the phrase `couldn't honor the request` means a return was filed, so the letter does not support a non-filer statement. The full layout of the letter is NOT IN SOURCES.

### H9. `[FC]` When and how a family can get a transcript for the income year
Rule: a Tax Return Transcript for the income year cannot exist before the return is filed and processed. The IRS gives general waiting times after filing. All self-service channels deliver masked transcripts; mail and phone orders go only to the address of record and take 5 to 10 calendar days. This bounds what a January-to-April 2027 applicant can upload for income year 2026 (Open Question 19).

> Use the table below to determine the general timeframe when you can request a transcript for a current year Form 1040 return filed on or before the April due date. Availability varies based on the method you used to file your return and whether you have a refund or balance due.
> — SRC ITA L258

> | refund amount or no balance due, | allow 2-3 weeks after return submission before you request a transcript. | allow 6-8 weeks after you mailed your return before you request a transcript.
> — SRC ITA L263-265

(the first cell is the row label; the second applies to returns filed electronically, the third to returns filed on paper)

> The Get Transcript by Mail application on IRS.gov is available anytime for IMF taxpayers to request a tax return or tax account transcript. The transcript is mailed to the address of record. The user cannot enter a different mailing address. The transcript is received in 5-10 calendar days. All transcripts are masked. These transcripts are available for the current and three prior tax years. Currently, the transcripts are only available in English.
> — SRC IRM L633-634

`[IRS web page]` irs.gov "Transcript availability", page last reviewed 02-Sep-2026, downloaded by the fact-checker on 2026-11-18 (first two quotes); `[official form/agency]` Internal Revenue Manual 21.2.3.3.3 (third quote). The same page gives longer waits when tax is owed (for example, "we process your return in mid-May and you can request a transcript by late May" when a balance was not paid in full, `SRC ITA L273-274`). The manual adds that the online "Get Transcript Online" tool "was retired on July 26, 2024" and that transcripts are now reached through the Individual Online Account (`SRC IRM L609`); do not name the retired tool in family-facing copy.

---

## I. Pay stubs

### I1. There is no standard pay stub; federal law lists what payroll records must contain
Rule: no source prescribes a pay stub layout. The federal wage-and-hour recordkeeping rule lists the data an employer must keep, which is the vocabulary pay stubs draw on: employee name, hours, wages for the pay period, additions and deductions, date of payment and the pay period covered. A Texas statute requiring a particular earnings statement was not retrievable: NOT IN SOURCES.

> (11) Total wages paid each pay period,
> — SRC FLSA L13

> (12) Date of payment and the pay period covered by payment.
> — SRC FLSA L14

> (10) Total additions to or deductions from wages paid each pay period including employee purchase orders or wage assignments.
> — SRC FLSA L12

`[official form/agency]` 29 CFR 516.2(a), eCFR as of 2026-11-01.

`[FC]` Verified. Read the rule for what it is: it obliges employers to "maintain and preserve payroll or other records" (`SRC FLSA L2`). It does not require an employer to give an employee a pay stub, and it says nothing about year-to-date totals. Whether any federal or Texas law requires a pay stub to be issued, or fixes its contents, is NOT IN SOURCES. So a family may legitimately have no pay stubs, and a stub without a year-to-date figure is not suspicious for that reason.

### I2. How Texas HHSC asks an employer for the same facts
Rule: HHSC's Form H1028, Employment Verification, is an employer-completed alternative a family may already hold. Its field names: "Company or Employer", "Employee Name (as shown on your records)", "Rate of Pay" (per hour, day, week, month or job), "How Often Paid?", "Average Hours Per Pay Period", "Commissions Tips Bonuses", "Overtime Pay", "FICA or FIT Withheld". Treat an H1028 as a human-review document.

> Rate of Pay
> — SRC H1028 L47

> How Often Paid?
> — SRC H1028 L58

> Average Hours Per Pay Period
> — SRC H1028 L59

`[official form/agency]` HHSC Form H1028 (07-2022).

### I3. What the sources do not say about pay stubs
- How many pay stubs, or which ones, establish prior-calendar-year income: NOT IN SOURCES.
- Whether year-to-date gross on the last stub of the year can stand in for annual wages: NOT IN SOURCES.
- Any label wording. The label synonyms in the parser specification below are engineering heuristics, not sourced facts.

### I4. `[FC]` For comparison only: what HHSC itself asks for as proof of income
Rule: this is HHSC's convention for its own programs, shown because Texas families will already be used to it. It is not a section 25F rule and must not be presented as one. HHSC asks for the last four pay stubs or an employer statement, and for benefit income it asks for an "Award letter or pay stubs".

> • Proof of income: Last 4 pay stubs or a statement from your employer, or self-employment records. • Social Security, Supplemental Security Income (SSI), pension benefits, Veteran benefits, Workers compensation, and unemployment: Award letter or pay stubs.
> — SRC H1830R L57-59

`[official form/agency]` HHSC Form H1830-R (December 2018), page 2. Four recent pay stubs show recent pay; section 25F asks for income "for the calendar year prior to the date of the application" (A6), which four recent stubs do not establish.

---
# PARSER SPECIFICATION BY DOCUMENT TYPE

Everything in this part is a design derived from the facts above. Where a regular expression rests on a verified string, the fact is cited. Where it rests on an unverified string, it is marked UNVERIFIED and the document type is forced to human review.

Conventions for all patterns: case-insensitive; normalise curly quotes and apostrophes to straight ones and all dash characters to `-` before matching; treat any run of whitespace (including line breaks) as `\s+`; keep page boundaries.

## P0. Common pipeline (applies to every upload)

1. **Hash first.** SHA-256 of the original bytes before any processing. The hash, not the file, goes in the evidence pack (spec `frame_1.txt` lines 49 and 237).
2. **Text.** Use the PDF text layer when present; otherwise OCR. Record `text_source` (`pdf_text` or `ocr`) and an OCR confidence. Phone photos are the normal case for mailed letters (E8, C3).
3. **Synthetic guard.** If the text contains `SYNTHETIC SAMPLE\s*-\s*NOT A REAL DOCUMENT`, then in production return `not_acceptable / SYNTHETIC_FIXTURE`; outside production, continue and tag the record `synthetic=true`.
4. **Classify** into one `doc_type` (table P1). Unknown stays `UNKNOWN` and goes to review.
5. **Extract** fields with page number, bounding box when available, raw string and confidence.
6. **Validate** with named rules. Each rule returns `pass`, `fail` or `unknown`.
7. **Decide** per document: `accepted`, `needs_review`, `not_acceptable` (with a reason code) or `unreadable`. `accepted` requires every hard rule to `pass`. Any `unknown` is `needs_review`. A failed or partial parse can never produce `accepted` (spec line 265: "failed parses must go to review, not to a silent yes").
8. **Minimise.** Persist only the fields listed for the type. Mask Social Security numbers to the last four digits at extraction time. Never persist WIC nutritional risk data (C1).

Reason codes: `PROGRAM_NOT_LISTED`, `DENIAL_OR_TERMINATION`, `NOT_A_DECISION`, `STALE_DOCUMENT`, `FUTURE_DATED`, `BOUNDARY_DATE`, `DATE_MISSING`, `BENEFIT_PERIOD_ENDED`, `NAME_NOT_IN_HOUSEHOLD`, `MULTIPLE_OUTCOMES`, `LANGUAGE_UNSUPPORTED`, `CHECKBOX_FORM`, `LAYOUT_UNVERIFIED`, `LOW_OCR_CONFIDENCE`, `SSA_NOT_SSI`, `SECTION8_NOT_YET_PARTICIPATING`, `PUBLIC_HOUSING_NOT_SECTION8`, `WRONG_TAX_YEAR`, `DUPLICATE_DOCUMENT`, `TAMPER_SUSPECTED`, `SYNTHETIC_FIXTURE`, `UNKNOWN_DOCUMENT`. `[FC]` Added: `RETURN_ON_FILE` (a non-filing letter that says a return exists, H8) and `NO_ONGOING_PAYMENT` (an SSI award or letter with no current monthly amount, E2 `[FC]`).

`[FC]` Two cautions on this pipeline. (1) The whole specification is a design. The reason codes, statuses, thresholds (for example "within 3 days of the lower boundary", "edit distance of 1"), and the split between `not_acceptable` and `needs_review` are the author's choices; none comes from section 25F, the proposed rule or an agency. Counsel and the SGO should approve the list of outcomes that reject a document without a human looking at it. (2) Only the SGO "verifies" (A9). A parser result of `accepted` is a recommendation to the SGO's decision record, and the evidence pack should say who or what made the determination (spec line 237).

### Date rules shared by all categorical documents

- `reference_date`: a single configurable value per verification. What the 12 months is counted from is NOT IN SOURCES (A11). Default proposal: the date the decision is made. Store both the document date and the reference date in the evidence record so the choice can be re-run.
- Window rule `DOC_WITHIN_12_MONTHS`: `reference_date - 12 calendar months <= doc_date <= reference_date`. A document dated within 3 days of the lower boundary returns `needs_review / BOUNDARY_DATE`, because inclusivity is NOT IN SOURCES. A document dated after `reference_date` returns `needs_review / FUTURE_DATED`.
- Currency rule `BENEFIT_NOT_ENDED`: if the document itself states an end date (SNAP certification end, WIC certification end, voucher expiry) and that date is before `reference_date`, return `needs_review / BENEFIT_PERIOD_ENDED`. Do not auto-reject: whether the 12-month window alone satisfies "currently" is NOT IN SOURCES (A11).
- Date formats to parse: `MM/DD/YYYY` (HHSC, HUD); `Month D, YYYY` (SSA); `MM-DD-YYYY` and `Mon. DD, YYYY` (IRS transcripts, H4).
- `[FC]` Because the reference date is not settled, a single default can reject a document that would pass under another reading. Evaluate `DOC_WITHIN_12_MONTHS` against both the upload (or application) date and the decision date. Reject as `STALE_DOCUMENT` only when the document fails under both; when the two disagree, return `needs_review / BOUNDARY_DATE`. The "3 days" margin and "12 calendar months" (rather than 365 days) are the author's choices, not sourced.
- `[FC]` "Document date" is itself a choice. A TF0001 has a notice date and a benefit start date; a voucher has an issue date and signature dates; a WIC VOC has a certification date and an income-determination date; an SSA letter has a letter date and a "Beginning" month. The proposed rule says "dated within the last 12 months", which points to the date the document bears, so use the notice or letter date and store the others. This reading is not confirmed by any source.
- Never take a date from a form-version footer. Exclude matches of `Form\s+\w+\s*\n?\s*\d{2}/\d{4}`, `\(\d{1,2}/\d{4}\)` and `\d{2}-\d{4}-E` (for example `06/2026` under `Form TF0001`, `form HUD-52646 (10/2026)`, `07-2022-E`).

### Name rule shared by all documents

`NAME_IN_HOUSEHOLD`: at least one person named as a recipient on the document matches a member of the intake household (A7). Compare case-insensitively after removing punctuation and suffixes; accept first-name plus last-name agreement with edit distance of 1 or less per token; anything weaker is `needs_review / NAME_NOT_IN_HOUSEHOLD`. For IRS transcripts only the first four letters of each name exist (H2).

## P1. Classification table

| `doc_type` | Must match | And any of | Verified by |
|---|---|---|---|
| `TX_TF0001` | `Form\s+TF0001` | `Notice about your case:` ; `TEXAS HEALTH AND HUMAN SERVICES COMMISSION` | B4 |
| `TX_H1009` | `Form\s+H1009` or `TANF/SNAP Benefits Notice of Eligibility` | | B10 |
| `TX_H1017` | `Notice of Benefit Denial or Reduction` | `Form\s+H1017` | B10 |
| `TX_H1020` | `we need more facts from you` | `Form\s+H?1020` | B10 |
| `TX_RENEWAL` | `It is time to renew your (Health Care )?benefits` or `Your Texas Benefits:\s*Renewal Form` | `H1830-R`, `H-?1010R`, `H1211` | B10 |
| `TX_OTHER_HHSC` | `HEALTH AND HUMAN SERVICES COMMISSION` with none of the above | | B10 |
| `WIC_VOC` | `Verification of Certification` | `WIC`, `Certification End Date` | C1, C2 (layout UNVERIFIED) |
| `WIC_INELIGIBLE` | `WIC Notification of Ineligibility\s*/\s*Termination` | | C6 |
| `WIC_BENEFIT_LIST` | `WIC` and (`shopping list` or `benefit list` or `benefit balance`) | | C3 (layout UNVERIFIED) |
| `HUD_52646` | `form HUD-52646` | `Voucher`, `Housing Choice Voucher Program` | D2 |
| `HUD_52641` | `form HUD-52641` or `Housing Assistance Payments \(HAP\) Contract` | `Part A of the HAP Contract` | D3 |
| `HUD_50058` | `form HUD-50058` or `Family Report` with `Type of action` | | D6 |
| `PHA_NOTICE` | (`Housing Authority` or `Housing Choice Voucher` or `Section 8`) and (`tenant rent` or `rent portion` or `family share` or `HAP` or `housing assistance payment`) | not a HUD form number | D4, D5 (layout UNVERIFIED) |
| `SSA_BEVE` | `Benefit Verification Letter` | `Social Security Administration` | E6 |
| `SSA_SSI_NOTICE` | `Social Security Administration` followed within 3 lines by `Supplemental Security Income` followed within 3 lines by a third-line heading from E1 | `SSA-L8\d{3}` | E1, E3 |
| `SSA_T2_NOTICE` | `Social Security Administration` followed within 3 lines by `Retirement, Survivors,? and Disability Insurance` | | E1 |
| `SSA_OTHER` | `Social Security Administration` with none of the above | | E1 |
| `IRS_W2` | `Wage and Tax Statement` | `Form\s+W-2`, `OMB No\. 1545-0029`, `Wages, tips, other compensation` | F1, F3 |
| `IRS_1040` | `1040\s+U\.S\. Individual Income Tax Return` | `Form 1040 \(20\d\d\)`, `OMB No\. 1545-0074` | G1, G2 |
| `IRS_TRT` | `Tax Return Transcript` | `This Product Contains Sensitive Taxpayer Data`, `Tax Period Ending` | H4 (secondary) |
| `IRS_WAI` | `Wage and Income Transcript` | `This Product Contains Sensitive Taxpayer Data` | H1, H7 (layout NOT IN SOURCES) |
| `IRS_ROA` | `Record of Account` | same banner | H1 (layout NOT IN SOURCES) |
| `IRS_ACCOUNT` | `Account Transcript` | same banner | H1 (layout NOT IN SOURCES) |
| `IRS_VNF` | `Verification of Non-?filing` | | H1 |
| `PAYSTUB` | two or more of: `Pay Period`, `Pay Date`, `Gross Pay`, `Net Pay`, `YTD`, `Year to Date`, `Earnings`, `Deductions` | an employer name | heuristic, I3 |
| `UNKNOWN` | none | | |

Order matters: test `TX_H1017`, `TX_H1020`, `TX_RENEWAL` before `TX_OTHER_HHSC`; test `SSA_BEVE` before `SSA_SSI_NOTICE`, because a Benefit Verification Letter that lists SSI contains the words "Supplemental Security Income" but has no second-line program heading.

`[FC]` Corrections to this table from the fact-check:
- **Which strings are verified.** The "Verified by" column points to facts, and those facts differ in strength. Verified on the official form or agency sample as posted on 2026-11-18 (editions range from 11/2013 for the HUD-50058 to 10/2026 for the HUD-52646; the H1009 and H1017 are blank forms): `TX_TF0001`, `TX_H1009`, `TX_H1017`, `TX_H1020`, `TX_RENEWAL`, `HUD_52646`, `HUD_52641`, `HUD_50058`, `IRS_W2`, `IRS_1040`. Verified on official but old or secondary samples: `SSA_SSI_NOTICE` (2003 POMS example plus the 2024 heading standard), `SSA_BEVE` (2020 sample on a third-party site), `IRS_TRT` (2019 mock-up). Titles only, no layout: `WIC_VOC`, `WIC_INELIGIBLE`, `IRS_WAI`, `IRS_ROA`, `IRS_ACCOUNT`, `IRS_VNF`. No source at all for the strings: `WIC_BENEFIT_LIST`, `PHA_NOTICE`, `PAYSTUB`.
- **`TX_OTHER_HHSC`.** The H1809 sample's return address reads `HEALTH AND HUMAN SERVICES COMMISSION` / `PO BOX 149029` / `AUSTIN TX 78714-9029` and the H1211's uses box 149027 (B10). The pattern in the table already omits "TEXAS" and so matches both. Add `TX_H1718` on `Notice of Benefit Denial` with `H1718` (B16), outcome `not_acceptable / DENIAL_OR_TERMINATION` for TANF, layout NOT IN SOURCES.
- **`SSA_T2_NOTICE` and `SSA_OTHER`.** Add the two other second-line headings from E1, `Extra Help With Medicare Prescription Drug Plan Costs` and `Special Veterans Benefits`, as non-SSI programs (`SSA_NOT_SSI`). The "third-line heading from E1" in the `SSA_SSI_NOTICE` row must not be a closed list (E1 `[FC]`): classify on lines 1 and 2, then look up line 3.
- **`SSA_SSI_NOTICE` scope.** Match the three heading lines at the top of page 1 only. Computation-worksheet pages at the end of an SSI notice mention "Social Security benefits" (E2 `[FC]`).
- **`IRS_VNF`.** After the title match, require `no record of a processed tax return`; `couldn't honor the request` means a return exists (H8).
- **`IRS_TRT`.** `This Product Contains Sensitive Taxpayer Data` is shown at the top and at the end of the sample, not on every page (H4 `[FC]`). Do not fail classification of a middle page because the sentence is absent.
- **`HUD_52646`.** Match `form HUD-52646` without the edition date (D2 `[FC]`).

## P2. Texas HHSC Form TF0001 (`TX_TF0001`)

**Identifying phrases (verified, B4):** `Form\s+TF0001`; `Notice about your case:`; `TEXAS HEALTH AND HUMAN SERVICES COMMISSION\s+P\.?\s?O\.?\s?BOX\s+1490\d\d\s+AUSTIN,?\s+TEXAS\s+78714`; `Case Number:`; `Page\s+\d+\s+of\s+\d+`.

**Decision region.** Only the text between `Notice about your case:` and the first of `Other help you can get and your rights:` or `Your right to appeal:` is evidence. This matters: the boilerplate pages of the verified Medicaid-only sample contain the strings "SNAP", "Lone Star Card", "can't get Medicaid or CHIP" and "pay stubs" (`SRC TF L63-76`, `L99`). A whole-document keyword search would mislabel a Medicaid notice as SNAP and an approval as a denial.

**Fields to extract.**

| Field | Where | Pattern | Stored |
|---|---|---|---|
| `notice_date` | header, after `Date:` | `Date:\s*(\d{2}/\d{2}/\d{4})` | yes |
| `case_number` | header, after `Case Number:` | `Case Number:\s*(\d{6,12})` (ten digits in samples, B9) | last 4 plus salted hash |
| `form_version` | footer | `Form\s+TF0001\s+(?:Page\s+\d+\s+of\s+\d+\s+)?(\d{2}/\d{4})` | yes |
| `page_count` | footer | `Page\s+(\d+)\s+of\s+(\d+)` | yes; require page 1 present |
| `sections[]` | decision region | heading line above each table | heading text |
| `tables[].status` | table title | `Who gets\s+(.+)` gives `gets`; `Who can't get\s+(.+)` gives `cant_get` | yes |
| `rows[].name` | column `Name` | text | matched member id only |
| `rows[].edg_number` | column `EDG number` | digits (length NOT IN SOURCES) | last 4 plus hash |
| `rows[].program_text` | column `Program` | text | yes |
| `rows[].date_start`, `date_end` | column `Date` | `(\d{2}/\d{2}/\d{4})(?:\s*-\s*(\d{2}/\d{2}/\d{4}))?` | yes |
| `rows[].amount` | SNAP and TANF rows | location UNVERIFIED (B5) | optional |
| `reason_text`, `notes_text` | after `Reason:` and `Notes:` | free text | reason code only |

**Program mapping.** Apply to the section heading, the table title and the `Program` cell, in that order:
- `SNAP`: `\bSNAP\b|Supplemental Nutrition Assistance|food benefits`
- `TANF`: `\bTANF\b|Temporary Assistance for Needy Families|cash help`
- not listed: `Health Care Benefits|\bMedicaid\b|\bCHIP\b|Children's Medicaid|Healthy Texas Women|Medicare Savings`
- nothing matches: `needs_review / LAYOUT_UNVERIFIED`.

**Table reconstruction.** In the text layer of the sample, the two halves of a date range sit on the lines above and below the `Program` cell (`SRC TF L21-23`). Rebuild rows from word coordinates, not from line order. If coordinates are not available (plain OCR text), do not guess: `needs_review`.

**Validity rules.**
1. `HAS_QUALIFYING_APPROVAL`: at least one row with `status = gets` and program `SNAP` or `TANF`.
2. `NAME_IN_HOUSEHOLD` on that row.
3. `DOC_WITHIN_12_MONTHS` on `notice_date`.
4. `BENEFIT_NOT_ENDED` on that row's `date_end` when present. SNAP rows are expected to have an end (B6); TANF rows are not.
5. `NO_LATER_ADVERSE_ROW`: no `cant_get` row for the same person and program with a date on or before `reference_date`. The verified sample shows exactly this pattern for Medicaid: approved `08/05/2026 - 09/30/2026`, then "can’t get" from `10/01/2026`.
6. `PAGE_ONE_PRESENT`: the page carrying `Notice about your case:` is in the upload. If it is not, return `not_acceptable / NOT_A_DECISION` and ask the parent for the first page; this does not need a reviewer.

**Outcomes.**
- All six pass: `accepted`, program recorded as the matched family, `award_letter_date = notice_date`.
- Only non-listed programs approved: `not_acceptable / PROGRAM_NOT_LISTED`. Offer the direct method or another document.
- Only `cant_get` tables for SNAP and TANF: `not_acceptable / DENIAL_OR_TERMINATION`.
- A `gets` and a `cant_get` for the same person and program: `needs_review / MULTIPLE_OUTCOMES`.

**Negative wording to detect inside the decision region (all verified in B4, B7, B10):** `Who can't get`; `You are not eligible for benefits`; `has not shown that they are either a citizen or a non-citizen who is qualified to receive benefits`; `The income a person gets is more than allowed for this program`; `did not provide proof showing that they live in Texas`; `denied`; `terminated`; `lowered` (review, not reject); `will not be eligible for`; `has been denied`; `did not give us the information we needed or did not keep your appointment`.

**Pitfalls.**
- Medicaid and CHIP notices are the same form with the same header (B4). This is the most likely false positive.
- A Medicaid notice mentions SNAP in boilerplate (see "Decision region").
- One notice, several programs, different outcomes (B8).
- SNAP certification may already have ended, or may run 36 months with an old letter (B6).
- The appeal page prints a legal-aid address. Do not read it as the family's address or as the issuing office.
- The form version changes (`06/2026` in the sample). Do not match on a version.
- Spanish notices (B11).
- The household may upload only page 3 or the appeal page. Those pages carry `Form TF0001` and nothing else of value.
- `[FC]` The appeal page counts "90 days" and "13 days" from "the date of this letter" (B4). Exclude that page from date and period extraction.
- `[FC]` A TANF approval can print "time limit months" (B3). That number is not a certification length.
- `[FC]` An approval proves the status on the notice date only. HHSC sends terminations on a separate, later TF0001 with 13 days' notice (B1), which the family may not upload. Say so in the evidence pack: "approved as of the notice date".

`[FC]` **Status of this section.** The structure (header fields, `Who gets` and `Who can’t get` tables, column names, footer) is verified on one official Medicaid-only sample. Everything specific to SNAP and TANF is unverified: the section headings, the table titles, the text of the `Program` cell, whether a SNAP row prints a date range or a separate certification line, and where the amount is printed (B5). The six validity rules and the "accepted" outcome are therefore a design that has not been tested against any real SNAP or TANF notice. Ship automatic acceptance behind a flag that is off in production until a reviewer has confirmed the patterns on real notices; until then the outcome for a SNAP or TANF TF0001 that passes all six rules should be `needs_review / LAYOUT_UNVERIFIED` with every field pre-filled. Fixtures FX-01 to FX-03 test the code path with invented headings and say nothing about real-world accuracy.

**Always human review:** Spanish or any non-English notice; any TF0001 whose SNAP or TANF section layout differs from the structure in B4 (the SNAP and TANF headings are UNVERIFIED, so the first real examples should be reviewed and used to confirm the patterns); OCR-only inputs without table coordinates; `MULTIPLE_OUTCOMES`; One-Time TANF wording (B13).

## P3. Other HHSC forms

| `doc_type` | Outcome | Reason |
|---|---|---|
| `TX_H1009` | `needs_review / CHECKBOX_FORM` | Approval text is pre-printed; only ticked boxes apply (B10). Extract `Date`, `TANF EDG No.`, `SNAP EDG No.`, amounts and the `from` ... `through` dates to help the reviewer |
| `TX_H1017` | `not_acceptable / DENIAL_OR_TERMINATION`, except `needs_review` when the text near a ticked box reads `will be lowered` | Reduction means the benefit continues |
| `TX_H1020` | `not_acceptable / NOT_A_DECISION` | Request for information |
| `TX_RENEWAL` | `needs_review / NOT_A_DECISION` | States that people on the case "get the benefits marked below" but is not a determination; check boxes again. Ask for the TF0001 |
| `TX_OTHER_HHSC` (H1184 card mailer, H1211, H1809, anything else) | `not_acceptable / NOT_A_DECISION` | No approval content |
| `TX_H1718` `[FC]` (`Notice of Benefit Denial`) | `not_acceptable / DENIAL_OR_TERMINATION` for TANF | B16. Layout NOT IN SOURCES, so confirm the classification by eye in review until a specimen is seen |
| Photo of a Lone Star Card or a card balance receipt | `not_acceptable / NOT_A_DECISION` | No name-plus-approval-plus-date. Layout NOT IN SOURCES. `[FC]` HHSC's own WIC policy calls the card "not acceptable proof of participation in TANF or SNAP" (B15) |
| YourTexasBenefits screenshot or printout that is not a TF0001 | `needs_review / LAYOUT_UNVERIFIED` | B12 |

## P4. WIC (`WIC_VOC`, `WIC_BENEFIT_LIST`, `WIC_INELIGIBLE`)

**Identifying phrases.** `Verification of Certification` or `\bVOC\b` with `WIC` (C1, C2). `WIC Notification of Ineligibility\s*/\s*Termination` (C6). `Texas WIC` with `shopping list`, `benefit list` or a month of benefits (C3).

**Fields (VOC, from 7 CFR 246.7(k)(4)).** `participant_name`; `certification_date` ("the date the certification was performed"); `income_determination_date`; `certification_end_date` ("the date the certification period expires"); `local_agency_name`, `local_agency_address`; `official_name`; `voc_id`. Do not extract or store the nutritional risk condition or risk codes.

**Fields (benefit or shopping list).** `benefit_month` or benefit start and end dates; any participant or family name printed; clinic name. Which of these a Texas list prints is NOT IN SOURCES.

**Validity rules.** `NAME_IN_HOUSEHOLD`; `DOC_WITHIN_12_MONTHS` on `certification_date` (VOC) or on the print or benefit date (list); `BENEFIT_NOT_ENDED` on `certification_end_date`, or for a list, `benefit_month` is the month of `reference_date` or the month before.

**Negative wording.** `Ineligibility`, `Termination`, `Disqualification`, `Expiration of Eligibility` (the title of Texas policy CS:23.0), `certification ... terminated`, `no longer categorically eligible`.

**Pitfalls.** A WIC card photo proves nothing (C4). WIC stops at age five, so the WIC participant is usually a younger sibling or a mother, not the student. Benefit lists and receipts are monthly and may carry no name. A VOC from another State is valid in Texas until its end date (C2), so out-of-State agency names can be legitimate. Health data on the VOC.

**Always human review:** every WIC document in v1. No Texas layout is verified (C2, C3). Auto-reject only `WIC_INELIGIBLE` and card photos.

`[FC]` Notes. The VOC field list is from the federal regulation and is reliable as a list of contents; every label string in this section and in the WIC fixture template is invented. `WIC_INELIGIBLE` is keyed on a title known only from policy text, so "auto-reject" should mean "not usable as proof, ask for another document", with the reviewer able to override; do not infer anything about other household members from it (C6 `[FC]`). A written "Notification of Certification Expiration" (C6) is neither approval nor denial: `needs_review`. The `BENEFIT_NOT_ENDED` test matters more for WIC than elsewhere because certification periods can be much shorter than 12 months (C5 `[FC]`). The rule "benefit_month is the month of reference_date or the month before" is an engineering choice with no source.

## P5. Section 8 (`HUD_52646`, `HUD_52641`, `HUD_50058`, `PHA_NOTICE`)

**Fields.**

| Type | Fields | Patterns |
|---|---|---|
| `HUD_52646` | `voucher_number`; `issue_date`; `expiration_date`; `extension_expires`; `family_representative`; `pha_name`; `pha_signed_date` | `2\.\s*Issue Date`; `3\.\s*Expiration Date`; `4\.\s*Date Extension Expires`; `5\.\s*Name of Family Representative`; `7\.\s*Name of Public Housing Agency` |
| `HUD_52641` | `tenant`; `household_members[]`; `unit_address`; `lease_begin`; `lease_end`; `hap_amount`; signature dates | `2\.\s*Tenant`; `4\.\s*Household`; `The initial lease term begins on`; `The initial lease term ends on`; `housing assistance payment by the PHA to the owner is \$` |
| `HUD_50058` | `agency_name` (1a); `program_code` (1c); `action_code` (2a); `effective_date` (2b); `next_reexam_date` (2i); `head_of_household`; `tenant_rent` (12v); `hap_to_owner` (12u) | `1c\.\s*Program`; `2a\.\s*Type of action`; `2b\.\s*Effective date`; `2i\.\s*Projected effective date` |
| `PHA_NOTICE` | `pha_name`; `letter_date`; `head_of_household`; `effective_date`; `tenant_portion`; `hap_amount`; `next_reexam_date` when shown | label synonyms: `Tenant Rent`, `Tenant Portion`, `Rent Portion`, `Family Share`, `Family Rent to Owner`, `HAP`, `Housing Assistance Payment`, `Contract Rent`, `Rent to Owner`, `Effective Date` (heuristic; D4, D5, D6 give the vocabulary) |

**Validity rules.** `NAME_IN_HOUSEHOLD` (voucher: the family representative; HAP: tenant or any listed member). `DOC_WITHIN_12_MONTHS` on issue date (voucher), on the later signature date or lease begin (HAP), on the effective date (50058), on the letter date (PHA notice). `BENEFIT_NOT_ENDED`: voucher expiry or extension is on or after `reference_date`; HAP lease end is not a benefit end (leases renew), so do not apply it. `PROGRAM_IS_SECTION_8` on a 50058: `VO`, `CE` or `MR`; `P` is `not_acceptable / PUBLIC_HOUSING_NOT_SECTION8`. `ACTION_NOT_EXIT` on a 50058: codes `6` and `11` are `not_acceptable / DENIAL_OR_TERMINATION`; code `10` is `needs_review / SECTION8_NOT_YET_PARTICIPATING`.

**Negative wording.** `End Participation`; `Expiration of Voucher`; `voucher (has )?expired`; `termination of (assistance|HAP|participation)`; `HAP contract terminates`; `waiting list`; `not eligible`; `denied`; `withdrawn`; `Public Housing` when no `Section 8`, `Voucher` or `HAP` wording is present.

**Pitfalls.** A voucher is an eligibility finding without participation (D2). HAP contracts are mostly old (D3). Public housing is program `P`, not Section 8 (D6). Waiting-list and briefing letters. Landlord-side payment statements that omit the tenant. Low-income housing tax credit income certifications from an apartment manager. Port-in families whose paperwork carries an out-of-State PHA name. Project-based Section 8, Moderate Rehabilitation, HUD-VASH and Emergency Housing Vouchers: whether each is "Section 8 housing" for this rule is NOT IN SOURCES.

**Always human review:** every Section 8 document in v1 (D1). The parser's job is to pre-fill the reviewer's screen and to auto-reject only HUD-50058 exits (codes 6 and 11), public housing (code `P`) and waiting-list letters. An expired voucher is `needs_review / BENEFIT_PERIOD_ENDED`, not a rejection: the family may have leased a unit, in which case a HAP contract or rent notice exists and should be requested.

`[FC]` Corrections to this section.
- **A voucher does not always mean "not yet participating".** HUD also issues a voucher to a participant family that wants to move (D9). Keep the reason code `SECTION8_NOT_YET_PARTICIPATING` as "participation not shown by this document" and ask for a HAP contract or rent notice; do not tell the family it is not on the program.
- **HUD-50058 codes.** Only codes 1, 2, 3, 4 and 7 are treated as evidence of assistance, 6 and 11 as exits and 10 as issuance. The form has seven more codes (D6 `[FC]`): send 5, 8, 9, 12, 13, 14 and 15 to review. Code 12 is marked "PH only" on the form.
- **HUD-50058 rent lines.** `12u` and `12v` exist only in section 12 (tenant-based vouchers). For program code `CE` or `MR` or a project-based voucher the amounts are in section 11 or 13 under other line numbers (D6 `[FC]`).
- **HUD-50058 names.** Match any member in section 3 (`3b`, `3c`), not only the head of household. Mask `3n` Social Security numbers.
- **HAP contract.** The signatories are the PHA and the owner; the tenant is named in item 2 but does not sign Part A. "Signature dates" are the PHA's and the owner's.
- **Auto-rejections.** Rejecting public housing and waiting-list letters automatically is a design choice. The proposed rule does not mention either; "waiting list" wording is not taken from any source document. Give the reviewer an override.
- **"Negative wording" list.** None of these phrases except `End Participation` and `Expiration of Voucher` (HUD-50058 code labels) is quoted from a source. They are heuristics.

## P6. SSA (`SSA_BEVE`, `SSA_SSI_NOTICE`, `SSA_T2_NOTICE`)

**`SSA_BEVE` fields.** `letter_date` from `Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})`; `addressee_name` (first line of the address block); `has_ssi_section` = `Information About Supplemental Security Income Payments`; `ssi_amount` and `ssi_effective` from `Beginning ([A-Z][a-z]+ \d{4}), the current Supplemental Security Income payment\s+is \$([\d,]+\.\d{2})`; `ssi_type` from `You are entitled to monthly payments as (an? .+?)\.`; `has_title2_section` = `Information About Current Social Security Benefits`; `title2_type` from `You are entitled to monthly (\w+) benefits\.`; `no_benefits` = `You do not receive benefits now`.

**`SSA_BEVE` rules.**
1. `no_benefits` is true: `not_acceptable / DENIAL_OR_TERMINATION`.
2. `has_ssi_section` is false: `not_acceptable / SSA_NOT_SSI`, whatever `title2_type` says. "Disability" under the Social Security heading is SSDI.
3. `has_ssi_section` is true and `ssi_amount` is greater than zero: SSI is established. Record program `SSI` even when a Social Security section is also present.
4. `has_ssi_section` is true but no amount is printed (the requester can leave the amount out, E8) or the amount is zero: `needs_review`.
5. `DOC_WITHIN_12_MONTHS` on `letter_date`; `NAME_IN_HOUSEHOLD` on the addressee.

**`SSA_SSI_NOTICE` fields.** `heading_3` (third line); `notice_date` from `Date:\s*([A-Z][a-z]+ \d{1,2}, \d{4})`; `claim_number` from `Claim Number:\s*(\d{3}-\d{2}-\d{4})\s*([A-Z]{1,2})?` (store last four digits only); `type_of_payment` (text under `Type of Payment`); payment rows under `Your Payments Will Be Changed As Follows` (`From`, `Through`, `Amount Due Each Month`); `form_number` from `SSA-L(\d{4})`.

**`SSA_SSI_NOTICE` rules.**

| `heading_3` | Outcome |
|---|---|
| `Notice of Award` | `[FC: corrected]` positive only when all three hold: the body matches `eligible to receive Supplemental Security Income payments` and does not match `not eligible`; the body does not match `no payments can be made at this time`; and an ongoing monthly amount greater than zero is established (for example `regular monthly check of \$[\d,]+\.\d{2} will be sent to`, E4 `[FC]`). Otherwise `needs_review`. Reason: SSA also sends this notice when the person "Is due a retroactive but not an ongoing payment" (E2 `[FC]`). The layout of the payment section of an SSA-L8025 is NOT IN SOURCES, so the first real award notices go to review regardless |
| `Notice of Change in Payment` | positive when a row has `Through` = `Continuing` or a date on or after `reference_date`, and the amount is greater than zero. `[FC]` POMS prints the `Through` value as a month and year or `Continuing` (E3 `[FC]`), so compare by month |
| `Notice of Revised Determination` `[FC]` | `needs_review` (SSA-L8100, E2 `[FC]`) |
| `Notice of Planned Action`, `Important Information`, `Notice of Overpayment`, `Notice of Reconsideration` | `needs_review` |
| `Notice of Disapproved Claim`, `Notice of Disability Cessation` | `not_acceptable / DENIAL_OR_TERMINATION` |

Also require `Type of Payment` and not `Type of Claim` for a positive (E5). Then `DOC_WITHIN_12_MONTHS` and `NAME_IN_HOUSEHOLD`.

`[FC]` Caption patterns. The payment-table caption is a template: match `(Your Payments|The Payments of .+?) Will Be (Changed )?As Follows:?` (E3 `[FC]`), not the single string in the fields list above. That caption is listed by POMS for post-eligibility notices ("some of the captions are also used on IC notices", `SRC P805 L191-192`); on a Notice of Award the listed captions are "How Much We'll Pay", "Information About (Your) Payments" and "(Your) Payment Is Based On These Facts" (`SRC P805 L18-50`), and what is printed under "How Much We'll Pay" is NOT IN SOURCES. Add to the negative list: `Why We Can't Pay`, `Why .{0,40}Payments Are Stopping`, `We will stop .{0,40}payment` (E4 `[FC]`). A cost-of-living notice arrives as a Notice of Change in Payment, a Notice of Planned Action or Important Information (E9 `[FC]`); only the first has a verified layout.

**`SSA_T2_NOTICE`:** `not_acceptable / SSA_NOT_SSI` for the categorical method. It remains usable as income evidence in the direct method. `[FC]` The same outcome applies to the second-line headings `Extra Help With Medicare Prescription Drug Plan Costs` and `Special Veterans Benefits` (E1 `[FC]`). "Usable as income evidence in the direct method" is the author's suggestion: the proposed rule's direct-method list (A5) does not name benefit letters, though "evidence of other income not reflected on such documents" may cover them. Counsel should confirm.

**Negative wording (verified, E4, E7).** `not eligible to receive Supplemental Security Income`; `cannot get Supplemental Security Income`; `no payments can be made at this time` (review); `You do not receive benefits now`; `You do not have a pending claim for benefits`; `Notice of Disapproved Claim`; `Type of Claim`.

**Pitfalls.** SSDI versus SSI is the central trap: both say "disability" and "disabled". The same letter can hold both (E6). A cross-program notice drops the program line and is headed "Important Information" (E1). The addressee can be a representative payee rather than the child. The claim number is a Social Security number. A "no benefits" letter has the same title as a positive letter (E7). Letters without an amount (E8). The 2020 sample may not match today's wording (E9).

**Always human review:** `SSA_OTHER`; any SSA notice without a recognised second-line heading; notices of planned action; any letter where the addressee is not a household member (possible payee case); an SSI section with no amount or a zero amount; OCR confidence below threshold on the heading lines.

## P7. Form W-2 (`IRS_W2`)

**Identifying phrases (verified, F1, F3).** `Wage and Tax Statement`; `Form\s+W-2`; `OMB No\. 1545-0029`; `Wages, tips, other compensation`; `Employer identification number \(EIN\)`.

**Fields.** `tax_year` (four digits next to the title); `copy` (`B`, `C`, `2`, other); `employee_name` (box e); `employee_ssn_last4` (box a); `employer_name` (box c, first line); `employer_ein` (box b; store masked); `control_number` (box d); `box_1`; `box_3`; `box_5`; `box_7`; `box_10`; `box_12[]` (code, amount); `box_13` flags; `box_16`. Use the per-year box map (F2): `14` for 2025, `14a` and `14b` for 2026.

**Validity rules.** `TAX_YEAR_IS_INCOME_YEAR`: `tax_year == year(application_date) - 1` (A6); otherwise `not_acceptable / WRONG_TAX_YEAR`. `NAME_IN_HOUSEHOLD` on the employee. `NOT_DUPLICATE`: same `employer_ein`, `employee_ssn_last4`, `tax_year` and `box_1` as another upload in the verification is one W-2 (Copy B and Copy C, F3). `AMOUNTS_PARSE`: box 1 is numeric; boxes 3 and 5 are numeric or blank. `MINOR_EARNER`: when the employee is a household member under 18, flag for exclusion (A8).

**Pitfalls.** Substitute and multi-copy layouts. `W-2c` corrected statements (`Corrected Wage and Tax Statement`): review. Box 1 and box 5 are separate figures and can differ (F5). Several employers per person. A W-2 covers wages only: no self-employment, benefits or child support. Handwritten W-2s. A 2026 W-2 will not exist before late January 2027 (F4).

**Always human review:** W-2c; handwritten; `tax_year` unreadable; box 1 unreadable; employee not in household; more than one state or locality block that changes box positions.

`[FC]` Notes. The identifying phrases and the 2025 and 2026 box labels are verified on the official forms. UNVERIFIED (no source consulted supports them): the title `Corrected Wage and Tax Statement` for a W-2c (no W-2c was consulted; treat the string as a heuristic); the statement that a 2026 W-2 "will not exist before late January 2027" (the form says only that employers must furnish it "By February 1, 2027", F4; an employer may issue it earlier). The 2026 box 12 codes are `TA`, `TP` and `TT` (F2 `[FC]`). The `DUPLICATE_DOCUMENT` key should not rely on `employee_ssn_last4` alone when a W-2 prints a truncated number; include `control_number` when present. "A W-2 covers wages only" is the author's summary, not a quote.

## P8. Form 1040 (`IRS_1040`)

**Identifying phrases (verified, G1, G2).** `1040\s+U\.S\. Individual Income Tax Return\s+(20\d\d)`; `Form 1040 \((20\d\d)\)`; `OMB No\. 1545-0074`.

**Fields.** `tax_year`; `filer_name`, `spouse_name`; `filing_status` (check box); `dependents[]` (first name, last name, relationship; do not store SSNs); `line_1a`; `line_1z`; `line_2a`; `line_2b`; `line_3b`; `line_4a`; `line_4b`; `line_5a`; `line_5b`; `line_6a`; `line_6b`; `line_7a`; `line_8`; `line_9` (total income); `line_10`; AGI (`line_11a`, cross-checked with `line_11b`, for 2025 and the 2026 draft; `line_11` for 2024, G3); `signature_present`.

**Validity rules.** `TAX_YEAR_IS_INCOME_YEAR`. `ARITHMETIC_9`: `1z + 2b + 3b + 4b + 5b + 6b + 7a + 8 == line_9` within one dollar. `ARITHMETIC_11`: `line_9 - line_10 == line_11a`, and `line_11a == line_11b`. `NAME_IN_HOUSEHOLD` on the filer. `BOTH_PAGES_PRESENT`.

**Pitfalls.** Line numbers move between years (G3). The 2026 form is a draft (G4). Check boxes need image analysis. AGI is not HUD annual income (A8); pass the component lines to the income engine. A return covers only its filers. Prepared but unfiled returns look identical to filed ones. Texas imposes no personal income tax return (general knowledge, not from the source files), so "State tax return" uploads will be rare and should go to review.

**Always human review:** 1040-X, 1040-NR, 1040-SR; a failed arithmetic rule; missing page; unreadable filing status when the engine needs it; any 2026 return until the final form has been checked against the line map.

## P9. IRS transcripts

**`IRS_TRT` identifying phrases (H4, secondary).** `Tax Return Transcript`; `This Product Contains Sensitive Taxpayer Data`; `Request Date:`; `Response Date:`; `Tracking Number:`; `SSN Provided:\s*XXX-XX-\d{4}`; `Tax Period Ending:`.

**Fields.** `request_date`; `response_date`; `tracking_number`; `customer_file_number` when present (H3); `tax_period_ending` (year); `ssn_last4`; `spouse_ssn_last4`; `name_prefixes`; `filing_status`; `form_number`; `wages` (`WAGES, SALARIES, TIPS, ETC`); `total_income` and `total_income_per_computer`; `agi` and `agi_per_computer`; `business_income`; `unemployment`; `total_social_security`; `taxable_social_security`; `total_ira`, `taxable_ira`; `total_pensions`, `taxable_pensions`; `tax_exempt_interest`.

Label pattern: `^\s*([A-Z0-9 ,/&:().'-]+?):\.*\s*(-?\$[\d,]+(?:\.\d{2})?)\s*$` per line, case-insensitive, then map the label by normalised text. Prefer the `PER COMPUTER` variant when both exist (H5).

**Validity rules.** `TAX_PERIOD_IS_INCOME_YEAR`. `HAS_RETURN`: the text does not contain `No record of return filed`. `MASK_MATCH`: last four SSN digits or four-letter name prefixes agree with a household adult (H2). `CFN_MATCH` when the product issued a customer file number (H3). `FRESHNESS`: `response_date` is on or before the upload date; staleness limits for transcripts are NOT IN SOURCES.

**Pitfalls.** Masked identity (H2). Only four dependents (H6). No amended-return data (H6). `PER COMPUTER` versus per return (H5). Tax return, account and record of account transcripts are also available in Spanish through the individual online account (`SRC IRM L418`): Spanish labels are NOT IN SOURCES. Wage and Income Transcripts read "No record of return filed" early in the year (H7).

**Always human review:** `IRS_WAI`, `IRS_ROA`, `IRS_ACCOUNT` (layouts NOT IN SOURCES); `IRS_VNF` (it supports a non-filer statement, not an income figure); any transcript that fails `MASK_MATCH`; any Spanish transcript.

`[FC]` Corrections to this section.
- **Every `IRS_TRT` string except the H5 item names comes from one 2019 mock-up** (H4 `[FC]`). Until a real tax-year-2025 transcript has been checked by a person, an `IRS_TRT` that passes all rules should be `needs_review / LAYOUT_UNVERIFIED` with fields pre-filled, behind the same kind of flag as the TF0001 (P2 `[FC]`). FX-29's `accepted` tests the code path only.
- **Masked is the default, not the only form** (H2 `[FC]`). Mask any full Social Security number found on a transcript at extraction. An unmasked Wage and Income transcript is legitimate.
- **Filing status.** Match `Married Fil(ed|ing) Joint` and treat the value as free text; the sample is too low in resolution to fix the spelling.
- **Dates.** Besides `MM-DD-YYYY` and `Mon. DD, YYYY`, the sample prints `Apr.15, 2020` with no space after the period.
- **`HAS_RETURN`.** Confirmed for both transcript types. Besides the Wage and Income case in H7, the manual says: "TDS cannot be used to provide a tax return transcript until the return is available on Master File. The transcript will display a message of No record of return filed." (`SRC IRM L882`). Match the message case-insensitively. A transcript with this message is `not_acceptable` as income evidence and is not proof of non-filing (H8).
- **`IRS_VNF`.** Use the two wordings in H8. The letter is unavailable for the latest tax year until after June 15.
- **`FRESHNESS`.** No source limits the age of a transcript. Because a Tax Return Transcript does not show later amendments (H6), record `response_date` in the evidence pack.
- **Availability.** A transcript for the income year exists only some weeks after the return is filed (H9).

## P10. Pay stubs (`PAYSTUB`)

**Fields.** `employer_name`; `employee_name`; `period_start`; `period_end`; `pay_date`; `gross_current`; `gross_ytd`; `net_current`; `hours`; `rate`; `pay_frequency` when printed.

**Label synonyms (heuristic, I3).** Period: `Pay Period`, `Period Beginning`, `Period Ending`, `Period Start`, `Period End`, `Pay Begin Date`, `Pay End Date`. Pay date: `Pay Date`, `Check Date`, `Advice Date`, `Payment Date`. Gross: `Gross Pay`, `Gross Earnings`, `Total Gross`, `Total Earnings`. Net: `Net Pay`, `Net Check`, `Take Home`. Year to date: `YTD`, `Year to Date`, `Year-To-Date`.

**Validity rules.** `NAME_IN_HOUSEHOLD` on the employee. `DATES_ORDERED`: `period_start <= period_end <= pay_date + 7 days`. `YTD_GE_CURRENT`: `gross_ytd >= gross_current`. `NET_LE_GROSS`. `COVERS_INCOME_YEAR`: at least one stub has a `pay_date` in the income year. `YEAR_END_YTD`: a stub whose `pay_date` is the last pay date of the income year gives `gross_ytd` as that employer's wages for the year; how to treat anything less is NOT IN SOURCES (I3), so every other case is `needs_review`.

**Pitfalls.** No standard layout (I1). Current-period and year-to-date columns side by side; OCR swaps them. A year-to-date figure resets in January, so a January 2027 stub says nothing about 2026. Several jobs. Tips and cash pay off the stub. Employer letters and Form H1028 instead of stubs (I2). Stub generators make forgery easy.

**Always human review:** every pay-stub-only verification in v1 unless a year-end stub passes all rules; handwritten stubs; missing employer name; failed arithmetic; mixed years.

`[FC]` CORRECTION: the `YEAR_END_YTD` rule contradicts fact I3 and must not auto-accept. I3 records that "Whether year-to-date gross on the last stub of the year can stand in for annual wages" is NOT IN SOURCES, yet the rule above accepts exactly that. Three further problems: a parser cannot know that a given pay date is "the last pay date of the income year" (pay schedules are not on the stub); a year-to-date "gross" figure need not equal W-2 box 1 or any HUD income figure; and no label in this section is sourced (I3). Revised rule: a pay stub is never `accepted` on its own in v1. A stub with a December pay date in the income year returns `needs_review` with `gross_ytd` pre-filled and a note for the reviewer; the exception "unless a year-end stub passes all rules" is withdrawn until the SGO or counsel adopts a written pay-stub policy, which then becomes configuration. The pattern checks (`DATES_ORDERED`, `YTD_GE_CURRENT`, `NET_LE_GROSS`) stay as tamper and OCR-quality signals. `DATES_ORDERED` as written (`period_end <= pay_date + 7 days`) is an invention; some employers pay in advance, so a failure is a review signal, not proof of tampering.

## P11. Triggers that always send a document to a human, whatever its type

1. Any hard rule returns `unknown`, or any required field has confidence below the configured threshold.
2. The document date is missing, ambiguous, in the future, or within 3 days of the 12-month boundary.
3. The named recipient does not match a household member.
4. The document is not in English.
5. The document is a check-box form (H1009, H1017, H1830-R, H-1010R, Form 1040 filing status).
6. The layout for the type is UNVERIFIED or NOT IN SOURCES: all WIC, all Section 8, SNAP and TANF sections of the first TF0001s seen in production, Wage and Income, Record of Account and Account transcripts, portal screenshots.
7. A document shows both an approval and an adverse action for the same person and program.
8. A benefit end date on the document is before the reference date.
9. Tamper signals: a text-layer PDF whose producer is a consumer editor; fonts that change inside one field; amounts that fail arithmetic; a file hash already seen under a different household.
10. The household flagged shared custody (spec line 179) and the recipient lives in the other household.
11. More than one qualifying program appears with conflicting dates.
12. The upload is a photo of a card (Lone Star Card, Texas WIC card, Medicaid card) or of a screen.

---
# ENGINEERING IMPLICATIONS

Concrete requirements for code and copy. Each cites the fact it rests on.

## Decision logic

1. **Program enum is closed at five.** `SNAP`, `TANF`, `WIC`, `SECTION_8`, `SSI`. Add no "other" value. Medicaid, CHIP and SSDI get an explicit `PROGRAM_NOT_LISTED` or `SSA_NOT_SSI` result with copy that offers the direct method. (A1, A3) `[FC]` The list is proposed regulation text and Treasury has asked whether to add programs: keep it in versioned configuration and label every decision with the rule version (A10).
2. **Six elements, six stored facts.** For every categorical "yes", store: document type, document date, program, matched household member, the phrase or table row that showed approval, and the reference date used for the 12-month test. (A1)
3. **Scope keyword searches.** On a TF0001, search only the decision region. A Medicaid-only notice contains "SNAP" and "can't get" in its boilerplate. (P2, B4)
4. **Structure over strings for TF0001.** Use `Who gets` and `Who can't get` tables plus program keyword families. The exact SNAP and TANF headings are unverified, so log the raw headings seen in production and review the first real notices by hand. (B5)
5. **Two date checks, not one.** `DOC_WITHIN_12_MONTHS` on the letter date and `BENEFIT_NOT_ENDED` on any end date printed on the document. The second produces `needs_review`, not a rejection. (A4, A11, B6)
6. **Make the reference date and the boundary rule configuration, not code.** Neither is settled by the sources. (A11)
7. **SSI is decided by section or heading, never by the word "disability".** Benefit Verification Letter: the "Information About Supplemental Security Income Payments" section. Notices: the second heading line. (E1, E6)
8. **WIC and Section 8 are review-first in v1.** No Texas WIC layout and no Texas PHA letter layout is verified. Build the extraction as reviewer assistance. (C2, C3, D1)
9. **Per-year maps for IRS forms.** W-2 box 14 (2025) versus 14a and 14b (2026). Form 1040 AGI on line 11 (2024) versus 11a and 11b (2025 and the 2026 draft). (F2, G1, G3, G4)
10. **Income year is derived, not chosen.** `year(application_date) - 1`. Reject other years with `WRONG_TAX_YEAR`. (A6)
11. **Deduplicate W-2 copies.** Copy B, Copy C and Copy 2 are one statement. (F3)
12. **Never use a transcript or a return for household size.** Transcripts show at most four dependents and returns cover only filers. Household size comes from the intake form. (H6, G5, A7)
13. **Use the "Per Computer" value on a Tax Return Transcript when both values appear**, and say so in the evidence pack. This follows federal student aid practice, not a section 25F rule. (H5)
14. **Offer a Customer File Number.** Generate up to ten digits per verification and tell the parent to enter it when requesting the transcript. Check it on upload. (H3)
15. **A parse failure is `needs_review` or `unreadable`.** No code path may map a missing field to a pass. Test this with the degraded-image fixtures. (spec line 265)

## Upload copy (family-facing)

16. Name the Texas document in HHSC's own words: "your award letter (Form TF0001, Notice of Case Action)". Tell parents where it is: mailed, or in their Your Texas Benefits online account, or by calling 2-1-1 for a copy. (B2, B12, B14) `[FC: corrected]` Do not print the menu path "Message Center", then "My Letters and Forms" as the place to find the TF0001: that path is verified only for printing a renewal form (B12 `[FC]`).
17. Ask for page 1 of the notice, the page that says "Notice about your case:". (B4)
18. Say what does not work, before upload: a Lone Star Card or WIC card photo; a Medicaid or CHIP letter; a renewal reminder; a request-for-information letter; a Social Security disability (SSDI) or retirement letter; a waiting-list letter. (B10, C4, E6, D8)
19. For SSI, ask for a "Benefit Verification Letter" that includes the amount, or the latest SSI notice headed "Supplemental Security Income". Explain that a parent who cannot download a child's letter online can ask SSA for it by phone. (E6, E8)
20. For Section 8, ask for "the most recent letter from your housing authority showing your rent portion", and say that a voucher that has not been used for a lease may need a staff check. (D5, D8, D2)
21. For WIC, ask for a "Verification of Certification" or a printed benefit list from the clinic, and say that a staff member will check it. (C2, C3) `[FC]` Word this as a request, not a promise: whether a Texas clinic will print a VOC for this purpose, and whether a benefit list shows a name or a certification period, are NOT IN SOURCES (C2, C3, C7).
22. Do not promise an outcome at upload. Results are "received", "being checked" or "we need a different document".

## Privacy and storage

23. Mask Social Security numbers at extraction: SSA claim numbers, W-2 box a, Form 1040 SSN fields, dependents' SSNs. Store the last four digits at most. (E3, F1, G2) `[FC]` Also: unmasked IRS Wage and Income transcripts (H2 `[FC]`), HUD-50058 item `3n` (D6 `[FC]`), the TDHCA income-change form's `SS#` fields, and Form H1028's `Social Security No.`
24. Do not extract or store WIC nutritional risk conditions or risk codes, Medicaid details, or disability onset dates ("We found that you became disabled under our rules on ..." appears in the Benefit Verification Letter). (C1, E6)
25. Store HHSC case and EDG numbers as last four digits plus a salted hash; they identify a family to the State. (B9)
26. The evidence pack shows extracted fields and the file hash, not the image, unless the SGO's retention policy says otherwise. (spec line 237)

## Tests

27. Every fixture carries the banner in its text layer; production rejects any upload containing the banner. (P0 step 3)
28. Each fixture has one expected `doc_type`, one expected status, one expected reason code, and a list of expected field values. Tests run with a frozen clock.
29. Degraded-image tests assert a set of allowed outcomes that never includes a wrong "accepted".
30. Add a regression test that feeds the HHSC Medicaid-only layout (fixture FX-04) and asserts `PROGRAM_NOT_LISTED`.

## Added by the fact-check `[FC]`

31. **Gate automatic acceptance on layout confidence.** Three families rest on layouts no one has verified on a real current document: SNAP and TANF sections of a TF0001, the SSI Notice of Award, and the Tax Return Transcript. Put automatic acceptance for each behind a flag that is off in production; with the flag off the result is `needs_review / LAYOUT_UNVERIFIED` with fields pre-filled. Turn a flag on only after a reviewer has confirmed the patterns on real documents. (P2, P6, P9 `[FC]` notes)
32. **A Notice of Award is not proof of a current SSI payment.** Require an ongoing monthly amount; otherwise review with `NO_ONGOING_PAYMENT`. (E2 `[FC]`)
33. **A pay stub is never accepted on its own in v1.** Extract and pre-fill; a person decides. (P10 `[FC]`, I3)
34. **Reject card photos with HHSC's own reasoning.** Lone Star Card, Medicaid card and WIC card photos show no period and no active status. (B15, C4)
35. **A voucher can belong to a current participant who is moving.** Never tell a family it is "not on the program" because it uploaded a HUD-52646; ask for the HAP contract or rent notice. (D9)
36. **Accept masked and unmasked transcripts.** Mask any full Social Security number at extraction. (H2 `[FC]`)
37. **Non-filing letters.** Recognise both wordings; only "no record of a processed tax return" supports a non-filer statement. The letter for the latest tax year does not exist before June 15. (H8)
38. **Early-year applications.** For an application dated January to April 2027 the income year is 2026, and the family may have no W-2 (due February 1, 2027), no Wage and Income Transcript (February), no filed return, and no Tax Return Transcript until two to three weeks after e-filing or six to eight weeks after mailing. The intake needs a "documents not available yet" state that saves progress and explains what to bring back; the sources give no substitute document. (F4, H7, H9, Open Question 19)
39. **An approval letter proves approval on its date.** State "approved as of [notice date]" in the evidence pack, and store the benefit end date when the document prints one. (A11 `[FC]`, B1, B6)
40. **Fall through between methods.** The proposed rule lets an SGO use "one or more" methods, so a categorical upload that fails should lead to the direct method in the same session. (A12)
41. **Keep a list of the strings that are inventions.** The WIC labels, the PHA rent-notice labels, every pay-stub label, the SNAP and TANF headings, the "disabled child" wording, the non-filing letter title and the W-2c title are not from any source. Tag them in code so they can be replaced when real specimens are reviewed.

---

# SYNTHETIC FIXTURE SET

## Rules for every fixture

- **Banner.** The exact string `SYNTHETIC SAMPLE — NOT A REAL DOCUMENT` at the top and the bottom of every page, in the text layer, in red, plus a diagonal watermark with the same words. File names start with `SYNTHETIC_`. PDF title metadata starts with `SYNTHETIC`.
- **No seals or logos.** Draw a grey box labelled `LOGO OMITTED` where an agency logo would be. Do not reproduce signatures; print `[signature omitted]`.
- **Fictional people.** Household under test: `DANA SAMPLE` (parent, adult), `RILEY SAMPLE` (student, age 10), `AVERY SAMPLE` (sibling, age 3), `JORDAN EXAMPLE` (second adult). A different household for mismatch tests: `CASEY PLACEHOLDER`, `MORGAN PLACEHOLDER`.
- **Fictional identifiers.** Case numbers `9990000001` to `9990000009`. EDG numbers `990000011` upward (real length NOT IN SOURCES). Social Security numbers only in the never-issued form `000-00-0001`, or masked `XXX-XX-0001`. Employer identification number `00-0000001`. Phone numbers in the `555-01xx` range. Voucher number `SYN-0001`. WIC card number `0000000000000000000`.
- **Addresses.** Fictional street, real Texas city and ZIP so county mapping can be tested: `100 Fixture Lane, Houston, TX 77002`.
- **Fictional local agencies.** `Example City Housing Authority (fictional)`, `Sample County WIC Clinic 000 (fictional)`, employer `FIXTURE FOODS LLC`. Federal and State agency names appear only where the classifier needs them.
- **Frozen clocks.** Clock A: application and reference date `2026-12-01`, so income year 2025 and the 12-month window is `2025-12-01` to `2026-12-01`. Clock B: `2027-02-15`, income year 2026. Expected results are for Clock A unless stated.
- **Unverified wording is marked.** SNAP and TANF section headings, the PHA letter, the WIC documents, the pay stub, and any Spanish text are fixture inventions modelled on the verified structure. Each such fixture carries a second line under the banner: `Layout is a test invention, not a copy of an agency form`.

## Templates

### T1. TF0001 page 1 (structure verified in B4; SNAP and TANF wording invented)

```
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
TEXAS HEALTH AND HUMAN SERVICES COMMISSION                         [LOGO OMITTED]
P O BOX 149029
AUSTIN, TEXAS 78714-9029

Date:          {notice_date MM/DD/YYYY}          Need help?
Case Number:   {case_number}                     Call 2-1-1 or 1-877-541-7905

                                                 {addressee name}
                                                 100 FIXTURE LANE
                                                 HOUSTON TX 77002

Notice about your case:
{section_heading}
        {table_title}
  Name            EDG number     Program      Date
  {name}          {edg}          {program}    {date or date range}
  ...
Reason:
{reason text, only for "can't get" tables}
Notes:
{notes text}

Form TF0001                                                    Page 1 of 3
06/2026
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
```

Pages 2 and 3 repeat the banner and footer and carry the boilerplate paragraphs that begin `Other help you can get and your rights:`, `For help or questions about your Lone Star Card`, `Women who can't get Medicaid or CHIP:` and `If you are applying for SNAP or get SNAP and you have been treated unfairly`. These exist to test decision-region scoping.

### T2. SSA Benefit Verification Letter (structure verified in E6, 2020 sample)

```
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
Social Security Administration
Benefit Verification Letter
                                             Date: {Month D, YYYY}
                                             BNC#: 00SYN0000000

{ADDRESSEE NAME}
100 FIXTURE LANE
HOUSTON TX 77002

You asked us for information from your record. The information that you
requested is shown below.

{optional} Information About Current Social Security Benefits
{optional} Beginning {Month YYYY}, the full monthly Social Security benefit
           before any deductions is ${amount}.
{optional} Type of Social Security Benefit Information
{optional} You are entitled to monthly {disability|retirement} benefits.

{optional} Information About Supplemental Security Income Payments
{optional} Beginning {Month YYYY}, the current Supplemental Security Income
           payment is ${amount}.
{optional} Type of Supplemental Security Income Payment Information
{optional} You are entitled to monthly payments as a disabled {individual|child}.

Date of Birth Information
The date of birth shown on our records is {Month D, YYYY}.
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
```

### T3. SSI notice (heading rules verified in E1, layout in E3)

```
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
Social Security Administration
{Supplemental Security Income | Retirement, Survivors, and Disability Insurance}
{Notice of Award | Notice of Change in Payment | Notice of Disapproved Claim}
                                             Date: {Month D, YYYY}
                                             Claim Number: 000-00-0001 DI
{ADDRESSEE NAME}
100 FIXTURE LANE
HOUSTON TX 77002
                                             {Type of Payment | Type of Claim}
                                             {Child--disabled}
{body paragraph: E4 award or denial sentence with fill-ins completed}
{change notice only} Your Payments Will Be Changed As Follows:
{change notice only}   From              Through        Amount Due Each Month
{change notice only}   {Month DD, YYYY}  Continuing     ${amount}
{award notice only}  How Much We'll Pay
{award notice only}  Information About Your Payments
{award or change}    Your regular monthly check of ${amount} will be sent to you
                     about the first day of the month.
SSA-L{8025|8151|8030}
SYNTHETIC SAMPLE — NOT A REAL DOCUMENT
```

`[FC]` Template corrected. The author's version put the caption "Your Payments Will Be Changed As Follows:" on a Notice of Award. POMS lists that caption for post-eligibility notices and lists "How Much We'll Pay" and "Information About (Your) Payments" for the SSA-L8025 (P6 `[FC]`). The "regular monthly check" sentence is POMS paragraph 1486 (E4 `[FC]`) and appears in the verified 2003 change notice; its placement on an award notice, and anything printed directly under "How Much We'll Pay", are test inventions. Mark award-notice fixtures with the second banner line `Layout is a test invention, not a copy of an agency form`. In T2, the choice "disabled child" is also an invention (E6 `[FC]`); only "as a disabled individual" is from the sample.

### T4. Other templates

- **W-2** (F1): one Copy B panel with every box label from the F1 table, the title `W-2 Wage and Tax Statement`, the year, `OMB No. 1545-0029`, and the copy line. 2025 panel uses box `14 Other`; 2026 panel uses `14a Other` and `14b Treasury Tipped Occupation Code(s)`.
- **Form 1040** (G1, G2): two pages with the title line, filing status boxes, the dependents grid, lines 1a to 11a on page 1 and 11b to 15 on page 2, footer `Form 1040 (2025)`.
- **Tax Return Transcript** (H4): monospace; header strings from H4 in the same order; one `LABEL:.....$amount` per line; banner sentence `This Product Contains Sensitive Taxpayer Data` once under the header and once at the very end of the transcript (`[FC]` corrected from "at the foot of each page", which the sample does not show); names masked to four letters; `SSN Provided: XXX-XX-0001`.
- **HUD-52646 voucher** (D2): title block, boxes 1 to 9 with their labels, footer `form HUD-52646 (10/2026)`.
- **HUD-50058 extract** (D6): lines `1a. Agency name`, `1c. Program`, `2a. Type of action`, `2b. Effective date (mm/dd/yyyy) of action`, `2i. Projected effective date (mm/dd/yyyy) of next reexamination`, head of household, `12u. HAP to owner`, `12v. Tenant rent to owner`, footer `form HUD-50058 (11/2013)`.
- **PHA rent notice** (invented): letterhead `Example City Housing Authority (fictional)`, `Housing Choice Voucher Program`, date, head of household, unit address, `Reexamination Type: Annual`, `Effective Date:`, `Contract Rent:`, `HAP to Owner:`, `Tenant Rent:`, `Next Reexamination:`.
- **WIC VOC** (fields from C1; layout invented): heading `Texas WIC` / `Verification of Certification (VOC)`, `Participant Name:`, `Date of Birth:`, `Certification Start Date:`, `Certification End Date:`, `Date Income Eligibility Determined:`, `Risk Codes:`, `Local Agency:`, `Certifying Official:`, `VOC ID:`.
- **Pay stub** (invented): employer block, employee name, `Pay Period: MM/DD/YYYY - MM/DD/YYYY`, `Pay Date:`, an earnings table with `Current` and `YTD` columns, `Gross Pay`, deductions, `Net Pay`.

## Fixture list

Core set (22 documents). Expected results are the proposed defaults in the parser specification.

`[FC]` Read the expected results with the fact-check in mind. An `accepted` result in this table proves that the code path works on a synthetic file; it does not show that the parser reads real documents. Three document families rest on unverified layouts and should have automatic acceptance behind a configuration flag that is off in production: SNAP and TANF sections of a TF0001 (FX-01, FX-02, FX-03; P2 `[FC]`), the SSI Notice of Award (FX-17; P6), and the Tax Return Transcript (FX-29; P9 `[FC]`). With the flag off, each of those fixtures must return `needs_review / LAYOUT_UNVERIFIED` with the same extracted field values. Run every such fixture both ways. Fixtures FX-41 to FX-45 were added by the fact-checker.

| ID | File | Template and key content | Expected `doc_type` | Expected status / reason | What it proves |
|---|---|---|---|---|---|
| FX-01 | `SYNTHETIC_tf0001_snap_approved.pdf` | T1. Date `09/15/2026`. Case `9990000001`. Section `SNAP Food Benefits`. Table `Who gets SNAP food benefits`. Rows DANA, RILEY, AVERY SAMPLE; Program `SNAP`; Date `09/01/2026 - 02/28/2027`. Notes: `Monthly amount: $600.00` | `TX_TF0001` | `accepted`; program `SNAP`; `award_letter_date = 2026-09-15` | Happy path; date range split across lines; boilerplate does not disturb |
| FX-02 | `SYNTHETIC_tf0001_tanf_approved.pdf` | T1. Date `06/10/2026`. Section `TANF Cash Help`. Table `Who gets TANF cash help`. Rows DANA, RILEY SAMPLE; Program `TANF`; Date `06/01/2026` (no end) | `TX_TF0001` | `accepted`; program `TANF` | TANF has no end date (B6) |
| FX-03 | `SYNTHETIC_tf0001_snap_yes_medicaid_no.pdf` | T1 with two sections: SNAP `Who gets` as FX-01, then `Health Care Benefits` with `Who can't get health care benefits`, Program `Medicaid`, Date `10/01/2026`, Reason `You are not eligible for benefits.` | `TX_TF0001` | `accepted`; program `SNAP` | Independent outcomes per program (B8) |
| FX-04 | `SYNTHETIC_tf0001_medicaid_only.pdf` | T1 mirroring the HHSC sample: `Health Care Benefits`, `Who gets health care benefits`, RILEY and AVERY SAMPLE, Program `Medicaid`, Date `08/05/2026 - 07/31/2027` | `TX_TF0001` | `not_acceptable / PROGRAM_NOT_LISTED` | The main look-alike; "SNAP" in boilerplate must not count |
| FX-05 | `SYNTHETIC_tf0001_snap_denied.pdf` | T1. Date `10/20/2026`. `Who can't get SNAP food benefits`; Date `10/20/2026`; Reason `The income a person gets is more than allowed for this program.` | `TX_TF0001` | `not_acceptable / DENIAL_OR_TERMINATION` | Denial wording (B7) |
| FX-06 | `SYNTHETIC_tf0001_snap_stale.pdf` | As FX-01 with Date `10/30/2025`, range `11/01/2025 - 04/30/2026` | `TX_TF0001` | `not_acceptable / STALE_DOCUMENT` | Outside the 12-month window |
| FX-07 | `SYNTHETIC_tf0001_snap_boundary.pdf` | As FX-01 with Date `12/01/2025`, range `12/01/2025 - 11/30/2028` | `TX_TF0001` | `needs_review / BOUNDARY_DATE` | Boundary is undefined in the sources (A11); 36-month certification (B6) |
| FX-08 | `SYNTHETIC_tf0001_snap_then_terminated.pdf` | T1. Date `11/10/2026`. `Who gets SNAP food benefits` with range `06/01/2026 - 11/30/2026`, then `Who can't get SNAP food benefits` for the same people with Date `12/01/2026` | `TX_TF0001` | `needs_review / MULTIPLE_OUTCOMES` | The approve-then-end pattern in the HHSC sample |
| FX-09 | `SYNTHETIC_tf0001_snap_other_family.pdf` | As FX-01 with rows CASEY and MORGAN PLACEHOLDER | `TX_TF0001` | `needs_review / NAME_NOT_IN_HOUSEHOLD` | Household matching (A7) |
| FX-10 | `SYNTHETIC_tf0001_snap_photo.jpg` | Page 1 of FX-01 rasterised at 100 dpi, rotated 6 degrees, perspective skew, JPEG quality 40, a shadow across the date | `TX_TF0001` or `UNKNOWN` | allowed: `accepted` with the same field values as FX-01, or `needs_review / LOW_OCR_CONFIDENCE`, or `unreadable`. Never `accepted` with a missing or different date | No silent yes |
| FX-11 | `SYNTHETIC_h1020_request.pdf` | `To find out if you can get or keep getting benefits, we need more facts from you:`; table `Program / EDG number / Due date` with `SNAP`; footer `Form 1020` `12/2022` | `TX_H1020` | `not_acceptable / NOT_A_DECISION` | Pending is not approved (B10) |
| FX-12 | `SYNTHETIC_h1830r_renewal.pdf` | `Form H1830-R`; `It is time to renew your benefits.`; ticked box beside `SNAP` | `TX_RENEWAL` | `needs_review / NOT_A_DECISION` | Renewal reminder (B10) |
| FX-13 | `SYNTHETIC_ssa_beve_ssi_only.pdf` | T2. Date `October 2, 2026`. Addressee RILEY SAMPLE. SSI section only: `Beginning January 2026, the current Supplemental Security Income payment is $500.00.` `You are entitled to monthly payments as a disabled child.` | `SSA_BEVE` | `accepted`; program `SSI` | SSI happy path. `[FC]` "disabled child" is invented wording (E6); how SSA addresses a child's letter is NOT IN SOURCES |
| FX-14 | `SYNTHETIC_ssa_beve_ssdi_and_ssi.pdf` | T2. Date `August 14, 2026`. Addressee JORDAN EXAMPLE. Social Security section (`$566.00`, `You are entitled to monthly disability benefits.`) and SSI section (`$314.50`) | `SSA_BEVE` | `accepted`; program `SSI`; `has_title2_section = true` | Concurrent case (E6) |
| FX-15 | `SYNTHETIC_ssa_beve_ssdi_only.pdf` | T2. Date `August 14, 2026`. Social Security section only, `You are entitled to monthly disability benefits.` | `SSA_BEVE` | `not_acceptable / SSA_NOT_SSI` | SSDI is not SSI (A3) |
| FX-16 | `SYNTHETIC_ssa_beve_no_benefits.pdf` | T2 heading, then `You do not receive benefits now and have not received benefits in the past.` and `You do not have a pending claim for benefits.` | `SSA_BEVE` | `not_acceptable / DENIAL_OR_TERMINATION` | Same title, negative body (E7) |
| FX-17 | `SYNTHETIC_ssi_notice_of_award.pdf` | T3. Second line `Supplemental Security Income`; third `Notice of Award`; Date `March 4, 2026`; `Type of Payment` / `Child--disabled`; `This is to notify you that RILEY SAMPLE is eligible to receive Supplemental Security Income payments under the provisions of title XVI of the Social Security Act.`; captions `How Much We'll Pay` and `Information About Your Payments`; `Your regular monthly check of $500.00 will be sent to you about the first day of the month.`; `SSA-L8025` `[FC: content corrected, see T3]` | `SSA_SSI_NOTICE` | `accepted` with the award-notice flag on (test only); `needs_review / LAYOUT_UNVERIFIED` with the flag off, which is the production default until a real SSA-L8025 has been reviewed. Program `SSI`; stored claim number is `0001` only | Heading rule; SSN masking; ongoing amount required (E2 `[FC]`) |
| FX-18 | `SYNTHETIC_ssi_notice_disapproved.pdf` | T3. Third line `Notice of Disapproved Claim`; `Type of Claim`; `After a careful review of your case, we have determined that you are not eligible to receive Supplemental Security Income payments`; `SSA-L8030` | `SSA_SSI_NOTICE` | `not_acceptable / DENIAL_OR_TERMINATION` | Denial wording (E4, E5) |
| FX-19 | `SYNTHETIC_ssa_title2_award.pdf` | T3. Second line `Retirement, Survivors, and Disability Insurance`; third `Notice of Award`; body mentions `disability benefits` | `SSA_T2_NOTICE` | `not_acceptable / SSA_NOT_SSI` | Second-line heading decides (E1) |
| FX-20 | `SYNTHETIC_pha_rent_notice.pdf` | PHA template. Date `08/20/2026`. Head of household DANA SAMPLE. `Reexamination Type: Annual`. `Effective Date: 10/01/2026`. `Contract Rent: $1,300.00`. `HAP to Owner: $1,088.00`. `Tenant Rent: $212.00` | `PHA_NOTICE` | `needs_review / LAYOUT_UNVERIFIED` with all six fields pre-filled | Review-first Section 8 path (D5) |
| FX-21 | `SYNTHETIC_hud52646_voucher_unleased.pdf` | Voucher template. `Voucher Number SYN-0001`. `Issue Date 10/05/2026`. `Expiration Date 12/04/2026`. Family representative DANA SAMPLE | `HUD_52646` | `needs_review / SECTION8_NOT_YET_PARTICIPATING` | Voucher is eligibility without participation (D2) |
| FX-22 | `SYNTHETIC_wic_voc.pdf` | WIC VOC template. Participant AVERY SAMPLE. `Certification Start Date: 10/05/2026`. `Certification End Date: 09/30/2027`. `Risk Codes: 000` | `WIC_VOC` | `needs_review / LAYOUT_UNVERIFIED`; stored record contains no risk-code field | Review-first WIC path; health data not persisted (C1) |

Extended set (direct method and more negatives).

| ID | File | Key content | Expected `doc_type` | Expected status / reason | What it proves |
|---|---|---|---|---|---|
| FX-23 | `SYNTHETIC_w2_2025_copyB.pdf` | 2025 panel. Employee DANA SAMPLE. Employer FIXTURE FOODS LLC, EIN `00-0000001`. Box 1 `41250.00`; box 3 `43000.00`; box 5 `43000.00`; box 12a `D 1750.00`; `Copy B` | `IRS_W2` | `accepted`; fields as listed | Box map 2025; box 1 differs from box 5 (F5) |
| FX-24 | `SYNTHETIC_w2_2025_copyC.pdf` | Same values, `Copy C—For EMPLOYEE’S RECORDS` | `IRS_W2` | `accepted` then `DUPLICATE_DOCUMENT` when uploaded with FX-23 | Copy deduplication (F3) |
| FX-25 | `SYNTHETIC_w2_2024.pdf` | 2024 year label, otherwise as FX-23 | `IRS_W2` | `not_acceptable / WRONG_TAX_YEAR` | Income-year rule (A6) |
| FX-26 | `SYNTHETIC_w2_2026_new_boxes.pdf` | 2026 panel with `14a Other`, `14b Treasury Tipped Occupation Code(s)`, box 12a `TT 2100.00` | `IRS_W2` | Clock A: `not_acceptable / WRONG_TAX_YEAR`. Clock B: `accepted` | 2026 layout (F2); clock dependence |
| FX-27 | `SYNTHETIC_f1040_2025.pdf` | Married filing jointly box ticked. Dependents RILEY and AVERY SAMPLE. 1a `41250`; 1z `41250`; 2b `12`; 9 `41262`; 10 `0`; 11a `41262`; 11b `41262` | `IRS_1040` | `accepted`; arithmetic rules pass | 2025 line map (G1) |
| FX-28 | `SYNTHETIC_f1040_2025_bad_sum.pdf` | As FX-27 with line 9 `31262` | `IRS_1040` | `needs_review / TAMPER_SUSPECTED` | Arithmetic check |
| FX-29 | `SYNTHETIC_irs_trt_2025.pdf` | Transcript template. `Tax Period Ending: Dec. 31, 2025`. `NAME(S) SHOWN ON RETURN: DANA SAMP`. `WAGES, SALARIES, TIPS, ETC: $41,250.00`. `TOTAL INCOME: $41,262.00`. `ADJUSTED GROSS INCOME: $41,262.00`. `ADJUSTED GROSS INCOME PER COMPUTER: $41,512.00` | `IRS_TRT` | `accepted` with the transcript flag on (test only); `needs_review / LAYOUT_UNVERIFIED` with the flag off (P9 `[FC]`). In both cases `agi = 41512.00` (per computer) | Masked matching (H2); per-computer rule (H5) |
| FX-30 | `SYNTHETIC_irs_wai_no_record.pdf` | Heading `Wage and Income Transcript`; body `No record of return filed` | `IRS_WAI` | `needs_review / LAYOUT_UNVERIFIED` | Early-year transcript (H7) |
| FX-31 | `SYNTHETIC_paystub_2025_year_end.pdf` | `Pay Period: 12/08/2025 - 12/21/2025`; `Pay Date: 12/26/2025`; Gross current `1650.00`; Gross YTD `43000.00`; Net `1298.40` | `PAYSTUB` | `[FC: corrected]` `needs_review` with `gross_ytd = 43000.00` pre-filled and the note "December stub, year-to-date gross shown". Never `accepted` on its own (P10 `[FC]`, I3) | Year-end year-to-date is extracted but not auto-accepted |
| FX-32 | `SYNTHETIC_paystub_2025_midyear.pdf` | `Pay Date: 06/13/2025`; YTD `19800.00` | `PAYSTUB` | `needs_review` | Annualisation is not defined (I3) |
| FX-33 | `SYNTHETIC_paystub_bad_ytd.pdf` | Gross current `1650.00`; Gross YTD `900.00` | `PAYSTUB` | `needs_review / TAMPER_SUSPECTED` | Arithmetic check |
| FX-34 | `SYNTHETIC_hud50058_end_participation.pdf` | `1c. Program VO`; `2a. Type of action 6`; `2b. Effective date 07/31/2026` | `HUD_50058` | `not_acceptable / DENIAL_OR_TERMINATION` | Exit code (D6) |
| FX-35 | `SYNTHETIC_hud50058_public_housing.pdf` | `1c. Program P`; `2a. Type of action 2`; `2b. Effective date 09/01/2026` | `HUD_50058` | `not_acceptable / PUBLIC_HOUSING_NOT_SECTION8` | Public housing is not Section 8 (D6) |
| FX-36 | `SYNTHETIC_wic_ineligible.pdf` | Title `WIC Notification of Ineligibility/Termination`; participant AVERY SAMPLE; date `09/02/2026` | `WIC_INELIGIBLE` | `not_acceptable / DENIAL_OR_TERMINATION` | WIC negative (C6) |
| FX-37 | `SYNTHETIC_tf0001_snap_spanish.pdf` | T1 structure with invented Spanish text (`Aviso sobre su caso:` and so on). Second banner line: `Layout is a test invention, not a copy of an agency form` | `TX_TF0001` or `UNKNOWN` | `needs_review / LANGUAGE_UNSUPPORTED` | Language routing (B11) |
| FX-38 | `SYNTHETIC_h1009_manual.pdf` | `TANF/SNAP Benefits Notice of Eligibility`; `Only the checked boxes apply to you.`; SNAP box ticked; `per month in SNAP benefits from 09/01/2026 through 02/28/2027` | `TX_H1009` | `needs_review / CHECKBOX_FORM` | Manual notice (B10) |
| FX-39 | `SYNTHETIC_tf0001_page3_only.pdf` | Only the boilerplate page and the appeal page of FX-01 | `TX_TF0001` | `not_acceptable / NOT_A_DECISION`, with the "upload page 1" prompt | Missing decision page |
| FX-40 | `SYNTHETIC_unrelated_flyer.pdf` | A one-page flyer with no agency text | `UNKNOWN` | `needs_review / UNKNOWN_DOCUMENT` | Unknown input |
| FX-41 `[FC]` | `SYNTHETIC_ssi_award_no_payment.pdf` | T3. Second line `Supplemental Security Income`; third `Notice of Award`; `Type of Payment` / `Individual--disabled`; body `This is to notify you that you are eligible under the Supplemental Security Income program. Even though you are eligible, no payments can be made at this time because of income` (POMS paragraph 1600, E4); no monthly amount | `SSA_SSI_NOTICE` | `needs_review` | A Notice of Award is not always a current payment (E2 `[FC]`) |
| FX-42 `[FC]` | `SYNTHETIC_irs_vnf_two_versions.pdf` (two files: `_no_record` and `_not_honored`) | Title `Verification of Non-filing Letter`; body A contains `we have no record of a processed tax return`; body B contains `we're sorry, but we couldn't honor the request` (H8). Rest of the layout invented | `IRS_VNF` | A: `needs_review` (supports a non-filer statement, no income figure). B: `not_acceptable` with a new reason code `RETURN_ON_FILE`, and a prompt for the Tax Return Transcript | The two official wordings (H8). The letter's printed title is NOT IN SOURCES; the title here is invented |
| FX-43 `[FC]` | `SYNTHETIC_irs_wai_unmasked.pdf` | Heading `Wage and Income Transcript`; full name, full address and SSN `000-00-0001` printed unmasked; one `Form W-2` block. Layout invented | `IRS_WAI` | `needs_review / LAYOUT_UNVERIFIED`; stored SSN is `0001` only; no `TAMPER_SUSPECTED` flag | Unmasked Wage and Income transcripts are legitimate (H2 `[FC]`); masking at extraction |
| FX-44 `[FC]` | `SYNTHETIC_lone_star_card_photo.jpg` | Photo of a card-shaped mock-up reading `Lone Star Card (SYNTHETIC)` with a card number made of zeros (the real number length is NOT IN SOURCES) | `UNKNOWN` or `TX_OTHER_HHSC` | `not_acceptable / NOT_A_DECISION` | HHSC itself does not accept the card as proof (B15) |
| FX-45 `[FC]` | `SYNTHETIC_hud52646_voucher_expired.pdf` | Voucher template. `Issue Date 06/01/2026`. `Expiration Date 07/31/2026`. No extension | `HUD_52646` | `needs_review / BENEFIT_PERIOD_ENDED` | Expired voucher is review, not rejection (P5); the family may be leased up or moving (D9) |

One non-file test: run FX-01 with the environment set to production and expect `not_acceptable / SYNTHETIC_FIXTURE`.

---

# OPEN QUESTIONS / AMBIGUITIES

The sources do not settle any of the following. Each needs a decision from counsel or the SGO, or a real sample reviewed by a person.

1. **Reference date for "within the last 12 months".** Application date, upload date, decision date or award date. NOT IN SOURCES. Affects every categorical decision near the boundary.
2. **Inclusive or exclusive boundary**, and whether "12 months" means calendar months or 365 days. NOT IN SOURCES.
3. **"Currently is approved" when the letter is recent but its benefit period has ended**, for example a six-month SNAP certification that ran out before the application. NOT IN SOURCES. Proposed handling: human review.
4. **Old approval letters with long certifications** (36-month TSAP or SNAP-CAP). The letter fails the 12-month test although the person is on SNAP. Which newer HHSC document proves current SNAP mid-certification is NOT IN SOURCES. Ask HHSC or a Texas legal-aid office.
5. **Exact TF0001 headings and columns for SNAP and TANF.** Only the Medicaid section is officially published. Confirm on the first real notices, with the family's consent, in the review queue.
6. **Whether renewal forms, card mailers or portal screenshots can ever serve as "written documentation ... confirming" approval.** The rule says "such as an award letter". NOT IN SOURCES. Proposed handling: not accepted automatically.
7. **One-Time TANF** and **One-Time TANF for Relatives**: assistance from TANF, but not ongoing. NOT IN SOURCES.
8. **Housing voucher issued but not leased.** HUD's form says the family is eligible but not yet a participant. Whether that is "approved for assistance from ... Section 8 housing" is NOT IN SOURCES.
9. **Scope of "Section 8 housing".** Tenant-based vouchers only, or also project-based Section 8, Moderate Rehabilitation, HUD-VASH and Emergency Housing Vouchers. NOT IN SOURCES. Public housing is a different program code on HUD's form, but the proposed rule does not address it by name.
10. **Texas PHA letter layouts.** No Houston Housing Authority or DHA sample was obtainable. Collect one blank or redacted specimen from each large Texas PHA.
11. **Texas WIC printed documents.** The layout of a Texas VOC and of the printed shopping or benefit list, and whether a clinic will print a VOC on request, are NOT IN SOURCES. Ask Texas WIC or a local agency.
12. **Whether a WIC benefit list or receipt, which shows a month of benefits but no certification statement, "confirms" participation.** NOT IN SOURCES.
13. **Current SSA letter wording.** ssa.gov refused automated requests. The Benefit Verification Letter text is from a 2020 SSA demonstration letter and the SSI notice layout from a 2003 POMS example. Check a 2026 letter by hand.
14. **Representative payees.** How SSA addresses a child's SSI letter to a payee, and how to match it to the household, is NOT IN SOURCES.
15. **SSI section with no amount, or "eligible but no payment".** SSA has a standard paragraph for eligibility with no payment due. Whether that is "approved for assistance" is NOT IN SOURCES.
16. **Which W-2 box is "income"** under 24 CFR 5.609 as modified by the proposed rule: box 1, box 5, or something else. NOT IN SOURCES. This belongs to the income-engine owner.
17. **How to get from a Form 1040 or transcript to HUD annual income.** AGI and "total income" are tax concepts. The mapping, including non-taxable Social Security and whether SSI shows anywhere on a return, is NOT IN SOURCES.
18. **Pay stubs.** How many, which ones, and whether year-end year-to-date gross is acceptable for the prior calendar year. NOT IN SOURCES.
19. **Timing in early 2027.** The income year for a January 2027 application is 2026, but 2026 W-2s are due to employees by February 1, 2027, the Wage and Income Transcript arrives in February, and a 2026 return may not be filed until April. The sources give no fallback (for example, using 2025 documents). NOT IN SOURCES.
20. **Final 2026 Form 1040.** Only the draft is available. Line numbers must be re-checked on release.
21. **Wage and Income, Record of Account and Tax Account transcript layouts.** No official or sample copy was obtained. NOT IN SOURCES.
22. **"Per return" versus "per computer"** for section 25F purposes. The federal student aid rule is cited as a model only.
23. **State tax returns.** The rule lists them. No Texas personal income tax return is described in the sources; out-of-State returns from families who moved are possible. Layouts NOT IN SOURCES.
24. **Final regulations.** The categorical list, the 12-month window and the direct-method document list are proposed text and can change after the December 1, 2026 comment deadline.

Added by the fact-check `[FC]`:

25. **Retroactive-only or zero-payment SSI.** A Notice of Award can be issued when only a past-due payment exists, or when the person is eligible but no payment is due. Whether either is "currently ... approved for assistance from ... SSI" is NOT IN SOURCES. (Extends item 15.)
26. **A voucher held by a participant who is moving.** HUD issues the same form to new and to moving families. How to tell them apart from the voucher alone is NOT IN SOURCES; a second document is needed.
27. **Later adverse action the family does not upload.** Every approval document is a snapshot. Whether the SGO must ask the family to certify that the benefit has not ended since the letter date is NOT IN SOURCES. A signed statement to that effect would be cheap to collect; counsel should say whether it is advisable.
28. **Which household's benefit letter counts under shared custody.** The tie-break in the proposed rule is written for counting household members; its use for the categorical method is implied by the preamble, not stated.
29. **Benefit letters as direct-method income evidence.** The proposed direct-method list names pay stubs, returns, transcripts, W-2s and "evidence of other income not reflected on such documents". Whether an SSDI or other benefit letter that fails the categorical test may be used as income evidence is not addressed by name.
30. **Texas pay-stub law.** Whether Texas or federal law requires employers to issue an earnings statement, and with what contents, is NOT IN SOURCES (the Texas statutes site did not return statute text). The federal rule cited in I1 is a record-keeping rule.
31. **Real specimens.** For every document family marked unverified, obtain one specimen with consent, or a blank from the agency, before turning on automatic acceptance: a SNAP TF0001, a TANF TF0001, a Spanish TF0001, a Texas WIC VOC and printed benefit list, a rent notice from each large Texas PHA, a 2026 SSI award notice and COLA notice, a 2026 Benefit Verification Letter for a child with a payee, a tax-year-2025 Tax Return Transcript, a Wage and Income Transcript, a Record of Account, and a non-filing letter.
32. **Auto-rejection list.** Which outcomes may reject a document without human review (stale date, wrong tax year, denial wording, public housing, card photos) is a policy choice with consequences for families; it is not determined by the sources.

---

# SOURCE INDEX

All files are under `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/`. Keys `PROP`, `STAT` and `CFR5609` are in `sources/` and `sources/extra/ecfr/`. Every other key is in `sources/extra/docparse/`. All were retrieved on 2026-11-18. Text files are conversions of the named PDF or HTML, saved beside the original.

| Key | File | Origin |
|---|---|---|
| PROP | `sources/proposed_rule_REG-117199-25.txt` | Proposed regulations, REG-117199-25 |
| STAT | `sources/usc_25F.txt` | 26 U.S.C. 25F |
| CFR5609 | `sources/extra/ecfr/title24_sec_5.609_2026-11-01.txt` | 24 CFR 5.609 (eCFR) |
| TWH | `fhb_twh_a2300.txt` | Texas Works Handbook A-2300, https://fhb.hhs.texas.gov/book/export/html/4666 |
| R1300 | `fhb_twh_r1300.txt` | MEPD Handbook R-1300, https://fhb.hhs.texas.gov/book/export/html/308551 |
| TF | `hhs_sample_tf0001.txt` (from `hhs_sample_tf0001.pdf`; page image `img/tf0001-1.png`) | https://www.hhs.texas.gov/sites/default/files/documents/form-tf0001.pdf |
| KIT | `hhs_ambassador_toolkit.txt` | https://www.hhs.texas.gov/about/community-engagement/hhsc-ambassador-toolkit |
| LSC | `hhs_lonestar_faq.txt` | https://www.hhs.texas.gov/services/financial/lone-star-card/lone-star-card-faq |
| YTBF | `hhs_ytb_account_flyer.txt` | https://www.hhs.texas.gov/sites/default/files/documents/hhsc-aes-end-of-phe-ytb-account-flyer.pdf |
| H1009, H1009S | `form_h1009.xfa.txt`, `form_h1009_s.xfa.txt` | https://fhb.hhs.texas.gov/sites/default/files/documents/laws-regulations/forms/H1009/h1009.pdf and `h1009-s.pdf` |
| H1009P | `fhb_h1009.txt` | https://fhb.hhs.texas.gov/forms/1000-1999/form-h1009-tanf-or-snap-benefits-notice-eligibility |
| H1017 | `form_h1017.xfa.txt` | https://fhb.hhs.texas.gov/sites/default/files/documents/laws-regulations/forms/H1017/H1017.pdf |
| H1020 | `hhs_sample_h1020.txt` | https://www.hhs.texas.gov/sites/default/files/documents/sample-form-h1020.pdf |
| H1211 | `hhs_sample_h1211.txt` | https://www.hhs.texas.gov/sites/default/files/documents/sample-form-h1211.pdf |
| H1830R | `form_h1830r.txt` | https://fhb.hhs.texas.gov/sites/default/files/documents/laws-regulations/forms/H1830-R/H1830-R.pdf |
| H1010R | `cfhp_ytb_renewal_sample.txt` | HHSC Form H-1010R sample hosted by a Medicaid health plan, https://medicaid.communityfirsthealthplans.com/wp-content/uploads/sites/2/2022/05/Your-Texas-Benefits-Renewal-Form-Sample.pdf |
| H1184 | `form_h1184.txt` | https://fhb.hhs.texas.gov/sites/default/files/documents/h1184.pdf |
| H1809 | `hhs_sample_h1809.txt` | https://www.hhs.texas.gov/sites/default/files/documents/h1809-deadline-extension.pdf |
| TANF | `hhs_tanf_page.txt` | https://www.hhs.texas.gov/services/financial/cash/tanf-cash-help |
| FTX | `feedingtx_snap_guide.txt` | https://feedingtx.org/guides/snap/ `[FC]` The site calls itself "Feeding America Texas", an affiliate of "Feed America"; it is not shown to be Feeding Texas or Feeding America. Unvetted third party |
| WICCFR | `ecfr_7cfr246_7.txt` | 7 CFR 246.7 (eCFR, 2026-11-01) |
| CS08 `[FC]` | `wic_cs-08-0.txt` | Texas WIC Policy CS:08.0, Adjunctive Income Eligibility, https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/wic/policy/cs-08-0.pdf; saved by the author, first cited by the fact-checker |
| CS05, CS23, CS24, CS25, CS27 | `wic_cs-05-0.txt`, `wic_cs-23-0.txt`, `wic_cs-24-0.txt`, `wic_cs-25-0ewic.txt`, `wic_cs-27-0ewic.txt` | Texas WIC Policy and Procedures Manual, https://www.hhs.texas.gov/providers/wic-providers/wic-policy-procedures-manual |
| WSHOP, WMY | `texaswic_shopping.txt`, `texaswic_mywic.txt` | https://texaswic.org/wic-foods-and-recipes/wic-shopping and https://texaswic.org/about-wic/mywic |
| V52646 | `hud_52646.txt` | https://www.hud.gov/sites/dfiles/OCHCO/documents/52646.pdf |
| V52641 | `hud_52641.txt` | https://www.hud.gov/sites/dfiles/OCHCO/documents/52641.pdf |
| V50058 | `hud_50058.txt` | https://www.hud.gov/sites/dfiles/OCHCO/documents/50058.PDF |
| C982 | `ecfr_24cfr982_516.txt` | 24 CFR 982.516 (eCFR, 2026-11-01) |
| C9824, C982302 `[FC]` | `ecfr_24cfr982_4.txt`, `ecfr_24cfr982_302.txt` | 24 CFR 982.4 and 982.302 (eCFR, 2026-11-01); saved by the author, first cited by the fact-checker |
| TDV | `tdhca_sec8ver.txt` | https://www.tdhca.texas.gov/sites/default/files/pmcdocs/Sec8Ver.pdf |
| TDI | `tdhca_income_change.txt` | https://www.tdhca.texas.gov/sites/default/files/section-8/docs/IncomeChangeRequest.pdf |
| (no key) | `hcha_landlord_packet.txt` | Harris County Housing Authority landlord packet, https://hchatexas.org/wp-content/uploads/Landlord-Packet.pdf |
| BEVE | `ilny_beve_sample.txt` | SSA demonstration letter hosted at https://mfp.ilny.org/images/docs/67_Sample_Benefit_Verification_Letter_07_20_2020.pdf |
| BEVEHI | `hi_eutf_ssa_sample.txt` | https://eutf.hawaii.gov/wp-content/uploads/2021/01/Sample-SSA-Verification-Letter-secured.pdf |
| OMB1, OMB2 | `omb_beve_1.txt`, `omb_beve_2.txt` | SSA filings for OMB No. 0960-0595, https://omb.report/icr/201106-0960-001/doc/25175001.pdf and https://omb.report/icr/201201-0960-012/doc/30080001.pdf |
| P610 | `poms_nl00610050.txt` | SSA POMS NL 00610.050, https://secure.ssa.gov/apps10/poms.nsf/lnx/0900610050 |
| P802 | `poms_nl00802010.txt` | SSA POMS NL 00802.010, https://secure.ssa.gov/poms.nsf/lnx/0900802010 |
| P804 | `poms_nl00804115.txt` | SSA POMS NL 00804.115, https://secure.ssa.gov/poms.nsf/lnx/0900804115 |
| P805 | `poms_nl00804105.txt` | SSA POMS NL 00804.105 (captions), https://secure.ssa.gov/poms.nsf/lnx/0900804105 |
| P801, P803 `[FC]` | `poms_nl00801010.txt`, `poms_nl00803000.txt` | SSA POMS NL 00801.010 (Manually Prepared Notices) and NL 00803.000 (SSI Posteligibility Notices, table of contents); saved by the author, first cited by the fact-checker |
| PSI | `poms_si02005100.txt` | SSA POMS SI 02005.100, https://secure.ssa.gov/poms.nsf/lnx/0502005100 |
| L8151 (image) | `poms_G-SSA-L8151-1.pdf`, `img/l8151-1.png` | Sample notice linked from SI 02005.100 |
| W226, W225 | `irs_fw2.txt`, `irs_fw2_2025.txt` | https://www.irs.gov/pub/irs-pdf/fw2.pdf and https://www.irs.gov/pub/irs-prior/fw2--2025.pdf |
| F40, F40D | `irs_f1040.txt`, `irs_f1040_draft.txt` | https://www.irs.gov/pub/irs-pdf/f1040.pdf and https://www.irs.gov/pub/irs-dft/f1040--dft.pdf |
| ITT | `irs_transcript_types.txt` | https://www.irs.gov/individuals/transcript-types-for-individuals-and-ways-to-order-them |
| ITA `[FC]` | `sources/extra/factcheck_docparse/irs_transcript_availability.txt` (not under `docparse/`) | https://www.irs.gov/individuals/transcript-availability, downloaded by the fact-checker on 2026-11-18 |
| IAB | `irs_about_transcripts.txt` | https://www.irs.gov/individuals/about-tax-transcripts |
| IRM | `irs_irm_21-2-3.txt` | Internal Revenue Manual 21.2.3, https://www.irs.gov/irm/part21/irm_21-002-003r |
| EDM, EDA | `fsa_trt_matrix_2627.txt`, `fsa_general-26-46.txt` | Federal Student Aid GENERAL-26-46, https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-07-08/2026-27-fafsa-verification-internal-revenue-service-irs-tax-return-transcript-matrix |
| NASFAA sample (image) | `citytech_2019_example.pdf`, `img/ct/p4-003.png`, `img/ct/p4-006.png` | https://www.citytech.cuny.edu/financial-aid/docs/info_guides_2021-22/2019_tax_returns_example.pdf |
| FLSA | `ecfr_29cfr516_2.txt` | 29 CFR 516.2 (eCFR, 2026-11-01) |
| H1028 | `form_h1028.xfa.txt` | https://fhb.hhs.texas.gov/sites/default/files/documents/h1028.pdf |

Sources that could not be retrieved (plain requests only; no workaround attempted): `www.ssa.gov` and `blog.ssa.gov` (HTTP 403); `housingforhouston.com` (certificate error); `www.nyc.gov` sample-letter guide (403); `www.usda.gov` WIC policy memorandum 2016-4 (403); `www.nasfaa.org` decoder PDF (410); `statutes.capitol.texas.gov` (script-rendered page, no statute text); HUD form 50059 (404). User-uploaded copies of real notices on document-sharing sites were deliberately not opened.

Helper scripts used to convert and check sources are in `research/_scripts_docparse/` (`h2t.py`, `xfa.py`, `check_quotes.py`). `check_quotes.py` confirms that every `SRC` quote in this file appears verbatim at the cited lines. `[FC]` The fact-checker's independent checker is `research/_scripts_fc_docparse/verify.py` (stricter: whitespace collapse only, no link stripping or de-hyphenation); both were run on the final file, see the VERIFICATION LOG.

---

# VERIFICATION LOG

Independent adversarial fact-check, 2026-11-18. Everything the fact-checker wrote in the body is marked `[FC]`.

## What was checked, and how

1. **Every quote.** The 169 `SRC` quotes in the author's file were re-located with a separate, stricter script (`research/_scripts_fc_docparse/verify.py`: whitespace collapse only, no link stripping, no de-hyphenation). Result: 169 of 169 found verbatim at exactly the cited lines. After the fact-check additions the file holds 206 `SRC` quotes; both this script and the author's `check_quotes.py` report 206 found, 0 missing.
2. **The four image quotes.** The page images were opened and read: HHSC TF0001 page 1, SSA-L8151 page 1, and the NASFAA sample transcript pages (re-extracted from the PDF). The transcriptions match, with the limits now recorded in H4.
3. **Provenance.** Every cited file was fetched again on 2026-11-18 with plain requests. Thirty-three PDF and spreadsheet files were compared by SHA-256 with the saved copies and all are identical: the HHSC samples and forms (TF0001, H1020, H1211, H1809, H1830-R, H1009 in English and Spanish, H1017, H1184, H1028, the account handout), the third-party copy of H-1010R, Texas WIC policies CS:08.0, CS:23.0, CS:24.0, CS:25.0 and CS:27.0, HUD-52646, HUD-52641 and HUD-50058, both TDHCA forms, the Harris County landlord packet, the SSA Benefit Verification Letter sample, the Hawaii PDF, the OMB filing, the SSA-L8151 example, IRS Form W-2 for 2025 and 2026, Form 1040 for 2025 and the 2026 draft, the NASFAA sample, and the Federal Student Aid matrix. Six eCFR sections (24 CFR 5.609, 982.4, 982.302, 982.516; 7 CFR 246.7; 29 CFR 516.2) are identical at version date 2026-11-01. Twenty-two web pages were re-fetched and a quoted sentence from each was found in the live page: the Texas Works Handbook A-2300 export, MEPD R-1300, the H1009 instructions page, the HHSC Lone Star Card, TANF, SNAP and ambassador-toolkit pages, two texaswic.org pages, POMS NL 00610.050, NL 00801.010, NL 00802.010, NL 00803.000, NL 00804.105, NL 00804.115 and SI 02005.100, the three IRS pages and IRM 21.2.3, the Federal Student Aid announcement, and the feedingtx.org guide. Still unreachable by plain request: `www.ssa.gov` (HTTP 403) and `housingforhouston.com` (no connection). The fetched copies are in `sources/extra/factcheck_docparse/`.
4. **Claims without quotes.** Form numbers, edition dates, OMB numbers, revision and effective dates, box and line labels, table rows and every inline line reference were compared with the saved source text: the F1 box table against the 2026 W-2, the G1 and G2 tables against the 2025 Form 1040, the B4 table against the TF0001 text and image, the B10 table against each HHSC form, the D2, D3 and D6 field lists against the HUD forms, the E6 table against the sample letter.
5. **Rule against quote.** For each fact, whether the plain-English rule says more than the quote supports. Overstatements are listed below.
6. **Tags.** No proposed-regulation or preamble text is presented as settled law. The author's added tag `[official form/agency]` is used for agency documents about the documents themselves, never for a section 25F rule. One quote was retagged (B9).
7. **"NOT IN SOURCES" claims.** The items in A11 were re-tested by keyword search across the proposed rule, the temporary regulations, the statute and the two IRS pages. One "NOT IN SOURCES" statement was wrong because the answer was in a file the author had saved (E9, on cost-of-living notices). The rest stand.
8. **Omissions.** The saved sources were re-scanned for the topic's key terms. Material the author had downloaded but not used is now cited (Texas WIC CS:08.0, 24 CFR 982.4 and 982.302, POMS NL 00801.010, NL 00803.000 and more of NL 00804.105, more of IRM 21.2.3). One new page was downloaded (irs.gov "Transcript availability").

## Corrections (what was wrong, and what the file now says)

| # | Where | Was | Now |
|---|---|---|---|
| 1 | E2, P6, FX-17 | An SSI "Notice of Award" is a positive | SSA also sends it for a retroactive-only payment and for "eligible, no payment due"; positive only with an ongoing monthly amount, otherwise review |
| 2 | P10, FX-31 | A year-end pay stub is `accepted` on its year-to-date gross | Contradicted the author's own I3 (NOT IN SOURCES); a pay stub is never accepted on its own in v1 |
| 3 | H2, P9, EI 23 | A transcript can never show a full name, SSN or address | True of masked transcripts only; the IRS issues unmasked Wage and Income transcripts; mask at extraction |
| 4 | H4, T4 | "This Product Contains Sensitive Taxpayer Data" is a page footer | Shown once at the top and once at the end of the sample |
| 5 | B12, EI 16, Source index | Quote attributed to "Feeding Texas"; menu path given as where the TF0001 is | The site calls itself "Feeding America Texas", an affiliate of "Feed America" (unvetted); the menu path is verified only for printing a renewal form |
| 6 | C5 | Postpartum certification "until the end of the sixth month"; WIC ends "at a child's fifth birthday" | "until the last day of the month that her infant turns six months"; eligibility expires "at the end of the month" of the fifth birthday; breastfeeding and infant periods added |
| 7 | F3 | `VOID` appears on Copy A | On Copy A and Copy D |
| 8 | F2 | 2026 W-2 adds box 12 codes for tips and overtime | Three new codes: `TA`, `TP`, `TT` |
| 9 | E9 | Cost-of-living notices for SSI: NOT IN SOURCES | POMS lists the forms used (SSA-L8151, SSA-L8155, SSA-L8166); layout still NOT IN SOURCES |
| 10 | E1 | "Every SSA notice" has the three-line heading; two program headings | It is SSA's drafting standard, not a guarantee; four second-line headings; the third-line list is examples, not closed |
| 11 | T3 | Caption "Your Payments Will Be Changed As Follows:" on a Notice of Award | POMS lists that caption for post-eligibility notices; award captions are "How Much We'll Pay" and "Information About (Your) Payments" |
| 12 | D2, P5 | A voucher means the family is not yet a participant | HUD also issues a voucher to a participant family that wants to move (24 CFR 982.302(a)) |
| 13 | D4 | A participant "should have" a PHA letter within 12 months because of the notice rule | The quoted notice rule is about interim reexamination increases; the expectation is reasonable but not sourced |
| 14 | B11 | SNAP and TANF notices "are also issued in Spanish", supported by the MEPD handbook | The Texas Works Handbook supports only Spanish free-text comments; whether the whole TF0001 is issued in Spanish is NOT IN SOURCES |
| 15 | B9 | H-1010R sample tagged as official | Retagged `[secondary/web]` (third-party host); nine-digit EDG placeholder from an HHSC sample added |
| 16 | D6 | "Some PHAs hand tenants a 50058 printout" stated as fact | Marked UNVERIFIED; full code list, section-specific rent lines and member-name fields added |
| 17 | E8 | A requester "can" omit the amount | Source is a 2011 OMB filing read on a third-party mirror; current options NOT IN SOURCES |
| 18 | G4 | The 2026 draft keeps the lines "with the same wording" | True for the named lines, but the layout differs (sub-line identifiers, new line 12f, changed line 14, reordered boxes, new question) |
| 19 | C6 | "Reject it" (WIC ineligibility notice) | Reject the document as proof; do not infer the status of other household members |
| 20 | A3 | Tagged preamble only | The closed list is proposed-regulation text; the exclusion of Medicaid, CHIP and SSDI follows from absence, not from a statement |
| 21 | P9 `HAS_RETURN` | The rule applied the message "No record of return filed" to Tax Return Transcripts, but the only support cited was for Wage and Income transcripts | Support added: the manual documents the same message for Tax Return Transcripts (IRM line 882) |
| 22 | How to read, A10 | Reliance on the proposed rules from January 1, 2027 | Added the condition: follow the applicable portions "in their entirety and in a consistent" manner |
| 23 | EI 21 | Copy asks for a VOC or benefit list | Whether a clinic prints a VOC for this purpose is NOT IN SOURCES; word it as a request |
| 24 | P0 date rules | One default reference date | Evaluate against both candidate dates; reject only when both fail |

## Facts added

A12 (methods may be combined; safe harbors), B14 (HHSC on what a TF0001 shows and how to get a copy), B15 (HHSC does not accept a Lone Star Card or Medicaid card as proof), B16 (changes with no TF0001; Form H1718), C7 (who gets a VOC; one layout per State), D9 (HUD definitions of applicant, participant, voucher), H8 (non-filing letter wording and timing), H9 (when a transcript exists), I4 (HHSC's "Last 4 pay stubs" convention, for comparison only). Shorter additions sit inside A1, A6, A7, A8, A10, A11, B3, B4, B6, B10, B13, E3, E4, E6, E7, H6 and H7. Also added: `[FC]` blocks in P0 to P10, fixtures FX-41 to FX-45, Engineering Implications 31 to 41, Open Questions 25 to 32, and six source-index rows.

## Still unverified after the fact-check

These remain in the file with their limits stated. None should drive an automatic "accepted" in production.

- The headings, table titles and amount position of the SNAP and TANF sections of a TF0001 (B5). Only a Medicaid sample is published.
- The search-result pointer to a 2021 SNAP notice (B5) and the Houston Housing Authority term "Rent Change Notice" (D5): not opened, not fetchable.
- Every Texas WIC printed layout and every Texas PHA letter layout (C2, C3, D1, D5).
- Whether the Benefit Verification Letter sample was authored by SSA (inferred from content), and whether its 2020 wording is still current (E6). The current SSA-L8025 award notice layout (E9).
- Every Tax Return Transcript label except the item names in H5; the exact filing-status spelling (H4). The Wage and Income, Record of Account and Account transcript layouts and the printed title of the non-filing letter (H7, H8).
- That PHAs give tenants a HUD-50058 printout (D6). The title of a Form W-2c (P7).
- Every pay-stub label and every "negative wording" phrase not quoted from a source (P5, P10).
- The 2011 description of the options in SSA's letter request screen (E8).
- eCFR texts were confirmed against the 2026-11-01 version; amendments after that date were not checked.

## Not checked

The fact-check did not test any regular expression against a document, did not run a parser, and did not review the legal judgment calls (for example, which outcomes may reject a document without human review). Those are listed in Open Questions 25 to 32.
