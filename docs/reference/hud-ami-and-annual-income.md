# HUD income-limit data + methodology, and the 24 CFR 5.609 "annual income" definition

Research date: 2026-11-18. Scope: drives the AMI engine (Piece 3) and the income calculator (Pieces 2/3).
Everything about IRC section 25F below comes ONLY from the local source files (statute text, REG-117199-25, T.D. 10057). Nothing here is from memory. The proposed regulations are NOT final.

FACT-CHECK STATUS (2026-11-18): this file was adversarially re-verified against the sources by a second agent. Every quote, line number, XLSX-derived number and confidence tag was re-checked; corrections are marked inline with "[FC]" and listed in the VERIFICATION LOG at the end. Facts F65-F73 (Part D) were added by the fact-checker to cover omissions. Read these three cautions before coding:
1. The "300% x AMGI x multiplier" formula and the multiplier table (F29, F30) appear ONLY in the economic analysis of the proposed rule, not in the proposed regulation text and not in the statute. The proposed regulation text says only that AMGI "means the income limit determined based on area median gross income and family size in accordance with section 8" (F28).
2. No IRS-published 25F limit table exists in any source checked (F32). Every number derived from the HUD workbook is PROVISIONAL, under either candidate formula (F38).
3. The 24 CFR 5.609 material is HUD housing law that the PROPOSED 25F regulation borrows by cross-reference. It is in force for HUD programs; its application to section 25F rests entirely on proposed regulation text.

## Source legend (aliases used in citations)

All local paths are under `/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/`.

| Alias | File | What it is |
|---|---|---|
| PR | `sources/proposed_rule_REG-117199-25.txt` | Proposed rule REG-117199-25 (line numbers are identical in the NUL-stripped copy `tools/hudami/proposed_clean.txt`) |
| TR | `sources/temp_regs_TD10057.txt` | Temporary regulations T.D. 10057 |
| USC | `sources/usc_25F.txt` | 26 U.S.C. 25F (Cornell LII text) |
| ILM | `hud/IncomeLimitsMethodology-FY26.txt` | HUD "Methodology for Determining FY 2026 Section 8 Income Limits" |
| MED | `hud/Medians-Methodology-FY26.txt` | HUD "Methodology for Calculating FY 2026 Medians" |
| ADR | `hud/area-definitions-FY26.txt` | HUD FY 2026 area definition report (counties by FMR area) |
| ILH | `hud/il.html` | Saved copy of HUD User income-limits landing page (huduser.gov/portal/datasets/il.html) |
| XLSX | `hud/Section8-FY26.xlsx` | HUD FY 2026 Section 8 income limits data (sha256 `bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0`, 771,324 bytes) |
| CFR609 / CFR603 / CFR100 / CFR403 / CFR611 | `sources/extra/ecfr/title24_sec_5.609_2026-11-01.txt` (and `_5.603_`, `_5.100_`, `_5.403_`, `_5.611_`) | eCFR text of 24 CFR part 5 sections, point-in-time 2026-11-01, fetched 2026-11-18 from `https://www.ecfr.gov/api/versioner/v1/full/2026-11-01/title-24.xml?part=5&section=5.609` (etc.). One paragraph per line; line numbers refer to these .txt files. Raw XML saved alongside. |
| HN | `sources/extra/hud_notice/PIH-2023-27_H-2023-10.txt` | HUD Notice H 2023-10 / PIH 2023-27 (Revision 3, "Issued: April 16, 2026"), HOTMA sections 102/104 implementation guidance. Fetched from `https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-27pihn.pdf` (pdftotext -layout). |
| FRX | `sources/extra/fr/FR-2024-01-31_2024-01873.txt` | HUD notice "Federally Mandated Exclusions From Income--Updated Listing", 89 FR 6126 (Jan. 31, 2024), from `https://www.govinfo.gov/content/pkg/FR-2024-01-31/html/2024-01873.htm` |
| FRC [FC] | `sources/extra/fr/FR-2025-12-30_2025-23989.txt` | HUD final rule "Housing Opportunity Through Modernization Act: Implementation of Sections 102 and 104; Further Extension of Compliance Date", 90 FR 61062 (Dec. 30, 2025). Already in the folder; not cited by the original author. |
| USC142 / USC42 [FC] | `sources/extra/sgo_verif/usc_142.txt`, `sources/extra/sgo_verif/usc_42.txt` | 26 U.S.C. 142 and 42 (Cornell LII text, saved by another research agent). Used for the statutory definition of "area median gross income". |
| IRB [FC] | `sources/extra/sgo_verif/irb_2026-38.txt` ... `irb_2026-47.txt` | Internal Revenue Bulletins 2026-38 through 2026-47 as saved by another research agent (completeness of those captures not independently verified). |
| CFR615 [FC] | `sources/extra/factcheck_hudami/refetch_5.615.txt` | eCFR text of 24 CFR 5.615 (imputed welfare income), point-in-time 2026-11-01, fetched 2026-11-18 by the fact-checker. |
| FCDIR [FC] | `sources/extra/factcheck_hudami/` | Fact-checker re-fetches: eCFR 5.609/5.100/5.403/5.611 (byte-identical to the author's copies), govinfo CFR 2025 annual edition of 5.609 and 5.603, HUD notice PDF (byte-identical), 89 FR 6126 (identical), Federal Register API searches. |

Confidence tags used: `[statute]`, `[temporary-reg: in force]`, `[proposed-reg: not final]`, `[preamble/economic-analysis]`, `[IRS web page]`, `[secondary/web]`, plus five tags this topic needs that are not on the standard list: `[HUD official doc]` (HUD methodology PDFs / HUD User page), `[HUD data: xlsx]` (values read straight from XLSX), `[derived: computed from xlsx]` (my computation; script named), `[CFR in force: 24 CFR]` (HUD regulation text from eCFR), `[HUD guidance notice]` (sub-regulatory HUD guidance; persuasive, not binding on IRS).

Helper artifacts I created (not sources; reproducible):
- `tools/hudami/inspect1.py`, `tools/hudami/tx_analysis.py`, `tools/hudami/tx_checks.py` (run with `python3 -I <script> hud/Section8-FY26.xlsx ...`)
- `tools/hudami/tx_rows.json` (the 254 Texas rows, all 35 columns, verbatim from XLSX)
- `tools/hudami/tx_25f_provisional_limits_formulaA.csv` (254 Texas counties x household sizes 1-12 under "Formula A" below, plus `hud_l50_4` and `six_x_l50_4` for comparison). Use as golden test data only after the owner of the AMI tests has reviewed it.
- [FC] Independent re-computation by the fact-checker: `tools/fc_hudami/fc_xlsx.py` (output `tools/fc_hudami/fc_xlsx.out`), `tools/fc_hudami/fc_adr.py`, `tools/fc_hudami/fc_csv.py`. Result: `tools/hudami/tx_rows.json` equals a fresh extraction of the 254 Texas rows, and all 254 x 12 limits plus `hud_l50_4` / `six_x_l50_4` in the CSV match a fresh computation (0 mismatches).

---

## FACTS

### PART A. HUD FY 2026 Section 8 income-limit data and methodology

**F1. The workbook has two sheets; the data sheet has 4,764 data rows (one per county or New England town) and 35 columns.**
(a) Sheet `Section8-FY26` = data (header row + 4,764 rows; 56 state/territory codes; no fully blank rows; no null cells anywhere). Sheet `Field_Descriptions` = 35 field descriptions. The sheet's dimension metadata claims 1,048,576 rows, so do not trust `max_row`; iterate until data ends.
(b) Header row verbatim: `fips, stusps, state, state_name, hud_area_code, hud_area_name, county, County_Name, county_town_name, metro, median2026, l50_1 ... l50_8, ELI_1 ... ELI_8, l80_1 ... l80_8`
(c) XLSX, sheet `Section8-FY26` row 1; computed by `tools/hudami/tx_analysis.py`.
(d) `[HUD data: xlsx]`

**F2. Column dictionary (every column of `Section8-FY26`).** Descriptions are verbatim from the `Field_Descriptions` sheet (XLSX, sheet `Field_Descriptions`, rows 2-36). Types are as stored in the workbook. Example values = Harris County, TX (sheet row 3921).

| # | Column (exact header) | Stored type | HUD description (verbatim; for the three limit families "N" stands for 1 through 8, one description per column) | Harris County example |
|---|---|---|---|---|
| 1 | `fips` | text, 10 chars | "Concatenated 2 Digit State FIPS Code, 3 Digit County FIPS Code, and 5 Digit County Subdivision FIPS Code" | `4820199999` |
| 2 | `stusps` | text | "State Postal Code" | `TX` |
| 3 | `state` | text, 2 chars | "2 Digit State FIPS Code" | `48` |
| 4 | `state_name` | text | "State Name" | `Texas` |
| 5 | `hud_area_code` | text, 16 chars | "HUD Specific Area Code" | `METRO26420M26420` |
| 6 | `hud_area_name` | text | "HUD Area Name" (listed in Field_Descriptions as `HUD_Area_Name`) | `Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area` |
| 7 | `county` | text, 3 chars | "3 Digit County FIPS Code" | `201` |
| 8 | `County_Name` | text | "County Name" | `Harris County` |
| 9 | `county_town_name` | text | "Town Name for areas in New England (Connecticut, Maine, Massachusetts, New Hampshire, Rhode Island, Vermont)- Otherwise, County Name" | `Harris County` |
| 10 | `metro` | integer 0/1 | "1 if area is in a Metropolitan Statistical Area- 0 if not" | `1` |
| 11 | `median2026` | integer USD | "2026 HUD Area Median Family Income" | `104000` |
| 12-19 | `l50_1` ... `l50_8` | integer USD | "2026 N-Person Very Low (50%) Income Limit" | 36400, 41600, 46800, 52000, 56200, 60350, 64500, 68650 |
| 20-27 | `ELI_1` ... `ELI_8` | integer USD | "2026 N-Person Extremely Low (30%) Income Limit" | 21850, 25000, 28100, 33000, 38680, 44360, 50040, 55720 |
| 28-35 | `l80_1` ... `l80_8` | integer USD | "2026 N-Person  Low (80%) Income Limit" | 58250, 66600, 74900, 83200, 89900, 96550, 103200, 109850 |

(d) `[HUD data: xlsx]`

**F3. Field-name pitfalls in the workbook.**
(a) Header case is inconsistent (`County_Name` is capitalized, the rest lower-case; `ELI_n` upper-case). `Field_Descriptions` spells the area-name field `HUD_Area_Name` while the data header is `hud_area_name`, and lists fields in a different order than the data sheet. Match headers case-insensitively and by name, never by position. `fips`, `state`, `county` are stored as text with leading zeros (e.g. Alabama `0100199999`); never parse them as numbers.
(b) Field_Descriptions row 10: `('HUD_Area_Name', 'HUD Area Name')`; data header: `hud_area_name`.
(c) XLSX both sheets; `tools/hudami/inspect1.py` output.
(d) `[HUD data: xlsx]`

**F4. `median2026` is the HUD area Median Family Income (MFI) for FY 2026: one number per HUD area, on a four-person basis, also called AMI. It is NOT adjusted for family size and is NOT the same thing as a HUD "income limit".**
(a) Engineers: `median2026` is the unadjusted area median. Size-specific figures must be derived (see F12-F14, F29-F30).
(b) "HUD also calculates median family incomes (MFIs) for every metropolitan area and nonmetropolitan county in the U.S. MFIs are an input into the income limit calculation and are based on a four-person household. MFIs are also often referred to by users of these data and in other federal programs as area median incomes (AMIs)."
(c) ILM lines 14-18. Field description "2026 HUD Area Median Family Income": XLSX `Field_Descriptions` row 12.
(d) `[HUD official doc]`

**F5. How the FY 2026 medians are built (context for labelling the data).** 2024 ACS median *family* income (not household income; one-year or five-year ACS data, with fallbacks to averaged or larger-area estimates when a local estimate is unreliable, MED lines 27-54), inflated by a factor HUD states as 1.05 to FY 2026, and rounded to a multiple of $100. [FC] HUD's text says "rounded to 100" and does not say whether to the nearest, up or down; the original wording "nearest $100" was not supported.
(b) "In estimating FY 2026 median family incomes, HUD uses median family[footnote 3] income data (as opposed to median household income data) from the 2024 ACS" (footnote 3: the Census definition of family "excludes one-person households and multi-person households of unrelated individuals", MED lines 43-45); "For FY 2026, CBO has produced a wages and salaries forecast of $48,641, which divided by the annual 2024 value of $46,125 is 1.05 (an increase of 5 percent)."; "Median family incomes are rounded to 100".
(c) MED lines 25-27 and 61-63; ILM line 280. Verified in data: every one of the 4,764 `median2026` values is a multiple of 100 (`tools/hudami/tx_checks.py`).
(d) `[HUD official doc]` + `[derived: computed from xlsx]`

**F6. Geography: HUD publishes one median per "FMR area". In Texas the building block is always a whole county.** An area is either (i) a whole OMB metropolitan statistical area, (ii) a HUD-defined sub-area of an MSA ("HUD Metro FMR Area", HMFA), or (iii) a single nonmetropolitan county. FY 2026 uses OMB Bulletin 23-01 (July 21, 2023) delineations.
(b) "HUD uses the Section 8 program's Fair Market Rent (FMR) area definitions in developing median incomes, which means that income estimates are developed for each metropolitan area, parts of some metropolitan areas, and each nonmetropolitan county."; "In many cases, HUD has split metropolitan statistical areas into smaller subareas, which HUD designates as "HUD Metropolitan Fair Market Rent Areas (HMFAs).""
(c) ILM lines 25-31; MED lines 15-22.
(d) `[HUD official doc]`

**F7. Effective date of the FY 2026 income limits and medians: May 1, 2026.**
(a) Store `effective_from = 2026-05-01`, `fiscal_year = 2026`, on the provisional threshold table. No end date is stated in the sources; prior years on the same page were effective April 1, 2025 (FY 2025), April 1, 2024 (FY 2024) and May 15, 2023 (FY 2023), so the release date moves year to year. The date of the FY 2027 release is NOT IN SOURCES.
(b) "Effective May 01, 2026." (appears three times: under the FY 2026 query tool, under "2026 Documents", and under "2026 Data").
(c) ILH raw lines 610, 670, 742. The two methodology PDFs and the area-definition report do not state the effective date (searched; not present).
(d) `[HUD official doc]`

**F8. HUD says the downloadable files are the official numbers, and warns that Section 42 (LIHTC) projects use a different publication (MTSP limits).**
(a) Use the XLSX (official) rather than HUD's online "documentation system". Because section 25F borrows the term "as such term is used in section 42", note that HUD itself routes section 42 users to a separate dataset; that dataset (MTSP) was not retrievable (huduser.gov returned a WAF challenge to plain requests). See Open Question 2.
(b) "Official ILs, available in pdf and excel formats at this link, may differ slightly from those calculated in the documentation system, and should be used for ALL official purposes."; "NOTE: Due to the Housing and Economic Recovery Act of 2008 (Public Law 110-289) the data presented in this system may not be applicable to projects financed with Section 42 Low Income Housing Tax Credits (LIHTC) or section 142 tax exempt private equity bonds. These projects should use the Multifamily Tax Subsidy Project Income Limits".
(c) ILH raw lines 617 and 626.
(d) `[HUD official doc]`
[FC] Verified. In both quotes the words "this link" / the MTSP name are hyperlink text on the page. The same page also lists FY 2026 items that are NOT in the local sources and were not reviewed: "Notice on Median Family Incomes for FY 2026", "Notice of FY 2026 Income Limits for the Public Housing and Section 8 Programs", and State-level 30%/50%/80% limits "based on median family incomes without adjustments made to HUD Income Limits" (ILH raw lines 596-760, rendered text).

**F9. Texas row counts.**
(a) Texas has exactly 254 rows = 254 unique 3-digit county codes = 254 unique 10-digit `fips` values (no duplicates, nothing missing). They map to 215 unique `hud_area_code` values (215 unique `hud_area_name` values, 1:1 with codes). Therefore there are 215 distinct Texas thresholds per household size, not 254. Split: 47 metropolitan areas covering 86 counties (`metro` = 1) + 168 single-county nonmetropolitan areas (`metro` = 0). Of the 47 metro areas, 16 contain more than one county (55 counties) and 31 contain exactly one county. Texas rows are contiguous at sheet rows 3821-4074. There are 174 distinct `median2026` values in Texas, ranging from $38,700 (Starr County) to $144,200 (Glasscock County).
(b) Script output: `TX rows: 254`, `TX unique hud_area_code: 215`, `TX metro flag counts: Counter({0: 168, 1: 86})`, `TX areas with >1 county: 16`, `TX single-county metro areas: 31`.
(c) XLSX; `tools/hudami/tx_analysis.py`, `tools/hudami/tx_checks.py`.
(d) `[derived: computed from xlsx]`

**F10. The Texas county-to-area mapping in the XLSX is identical to HUD's area-definition report and to the Census county list.**
(a) Cross-checks passed: (i) the 47 metro area codes and their county sets parsed from the area-definition report equal those in the XLSX; (ii) the 168 nonmetro county codes are equal; (iii) the 254 county FIPS codes and names equal the Census file `sources/tx_counties_census.txt` exactly (no spelling differences, e.g. `DeWitt County`, `McLennan County`, `La Salle County`).
(b) Script output: `report metro areas: 47 xlsx metro areas: 47 identical mapping: True`; `report nonmetro counties: 168 xlsx nonmetro: 168 identical: True`; `fips sets equal: True`, `name diffs: []`.
(c) ADR lines 2319-2449 (Texas section); XLSX; `tools/hudami/tx_checks.py`.
(d) `[derived: computed from xlsx]` + `[HUD official doc]`

**F11. Structure of `hud_area_code` (always 16 characters). The first 5 digits are documented by the area-definition report; the rest is OBSERVED, not documented in the sources.**
(a) Treat the code as an opaque key. Observed Texas patterns:

| Pattern | Meaning (observed) | Texas count | Example |
|---|---|---|---|
| `METRO` + CBSA(5) + `M` + same CBSA(5) | The whole MSA, or the core HMFA that keeps the MSA's code | 26 areas | `METRO26420M26420` Houston-The Woodlands-Sugar Land HMFA; `METRO10180M10180` Abilene, TX MSA |
| `METRO` + CBSA(5) + `N` + state FIPS(2)+county FIPS(3) | A single county carved out of the MSA as its own HMFA | 18 areas | `METRO26420N48015` Austin County; `METRO19100N48497` Wise County |
| `METRO` + CBSA(5) + `MM` + 4 digits | HMFA sub-area with a 4-digit code | 2 areas | `METRO19100MM2800` Fort Worth-Arlington; `METRO26420MM1145` Brazoria County |
| `METRO` + CBSA(5) + `M` + state+county FIPS | Single-county HMFA coded with `M` | 1 area | `METRO30980M48203` Harrison County |
| `NCNTY` + state+county FIPS(5) + `N` + same(5) | Nonmetropolitan county (code repeats the county's own FIPS; verified for all 168) | 168 areas | `NCNTY48427N48427` Starr County; name is always `<County_Name>, TX` |

Nationally: prefix `METRO` on 1,976 rows and `NCNTY` on 2,788 rows; the prefix agrees with the `metro` flag on every row (0 inconsistencies). 2,635 unique codes nationally.
(b) Area-definition report line format showing the CBSA number: "Abilene, TX MSA - 10180" then "CBSA: Abilene, TX MSA - METRO10180M10180"; "SA: Fort Worth-Arlington, TX HMFA - METRO19100MM2800".
(c) ADR lines 2324-2325, 2343; XLSX; `tools/hudami/tx_analysis.py`. The only HUD description of the field is "HUD Specific Area Code" (XLSX `Field_Descriptions` row 5).
(d) `[HUD data: xlsx]` for the values; the decomposition is `[derived: computed from xlsx]` (inferred).

**F12. Naming differences between the XLSX and the area-definition report.**
(a) XLSX names end in `MSA` (14 Texas areas that are whole MSAs) or `HUD Metro FMR Area` (33 Texas areas); the report abbreviates the latter as `HMFA` and prefixes lines with `CBSA:` (whole MSA) or `SA:` (sub-area). The parent OMB MSA name can differ from the HMFA name: the report's parent is "Houston-Pasadena-The Woodlands, TX MSA - 26420" while the HMFA is "Houston-The Woodlands-Sugar Land, TX HMFA". Display `hud_area_name` from the XLSX verbatim in evidence packs.
(b) "Houston-Pasadena-The Woodlands, TX MSA - 26420" / "SA: Houston-The Woodlands-Sugar Land, TX HMFA - METRO26420M26420    071-Chambers, 157-Fort Bend, 167-Galveston, 201-Harris, 291-Liberty, 339-Montgomery, 473-Waller"
(c) ADR lines 2350, 2353-2354.
(d) `[HUD official doc]`

**F13. `metro` flag.** 1 = "area is in a Metropolitan Statistical Area", 0 = not. Texas: 86 rows = 1, 168 rows = 0. The flag has no role in the proposed 25F formula; keep it as metadata only.
(c) XLSX `Field_Descriptions` row 9; `tools/hudami/tx_analysis.py`.
(d) `[HUD data: xlsx]`

**F14. HUD family-size adjustments (percent of the four-person figure): 1 = 70%, 2 = 80%, 3 = 90%, 4 = base (100%), 5 = 108%, 6 = 116%, 7 = 124%, 8 = 132%.**
(b) "Number of Persons in Family and Percentage Adjustments / 1 2 3 4 5 6 7 8 / 70% 80% 90% Base 108% 116% 124% 132%"; "HUD uses the same family size adjustments for all income limits, except extremely low-income limits set at the poverty income threshold."
(c) ILM lines 236-245.
(d) `[HUD official doc]`

**F15. More than 8 persons: add 8 percentage points of the four-person figure per extra person (9 = 140%, 10 = 148%, ...).** HUD does not print 9+ limits.
(b) "For each person over eight-persons, the four-person income limit should be multiplied by an additional 8 percent. (For example, the nine-person limit equals 140 percent [132 + 8] of the relevant four-person income limit.)"
(c) ILM lines 248-251.
(d) `[HUD official doc]`

**F16. HUD rounding rules.**
(a) (i) Medians are rounded to $100. (ii) HUD income limits are rounded UP to the nearest $50. (iii) For 9+ persons, local agencies may round to the nearest $50 or use unrounded numbers. (iv) Cap values are rounded DOWN to $50, floor values UP to $50. Verified in data: every `l50_*` and `l80_*` value nationally is a multiple of $50; `ELI_*` values are not (e.g. Harris `ELI_5` = 38,680) because they can equal HHS poverty guidelines.
(b) "HUD rounds income limits up to the nearest $50. Local agencies may round income limits for nine or more persons to the nearest $50, or they may use the un-rounded numbers."; "This is rounded down to the nearest $50."; "multiplied by 0.95 and rounded up to the nearest $50".
(c) ILM lines 251-253, 280-281, 292, 296-297, 304-307; `tools/hudami/tx_checks.py`.
(d) `[HUD official doc]` + `[derived: computed from xlsx]`

**F17. HUD's four-person very-low-income limit (`l50_4`) starts at 50% of the median but is then adjusted. It is frequently NOT equal to `median2026 / 2`.**
(a) Adjustments, in HUD's order: (1) 50% of area MFI; (2) raised in high-housing-cost areas; (3) lowered in unusually high-income areas; (4) raised to 50% of the State nonmetropolitan median if lower; (5) limited to a 5% decrease floor and, for FY 2026, a 10% increase cap versus last year. In Texas, `l50_4` differs from `median2026/2` in 143 of 254 county rows (134 of 215 areas): 120 rows higher, 23 rows lower. 112 rows have `l50_4` = $41,850, which is 50% of the Texas nonmetropolitan median of $83,700. This matters only if the final IRS table is built from HUD income limits rather than from the raw median (see F36, Open Question 1).
(b) "The first step in calculating very low-income limits is to calculate a four-person income limit equal to 50 percent of the area median family income. HUD then adjusts this estimate if it is outside formula constraints."; "(4) HUD increases the four-person income limit if it is less than 50 percent of the relevant state nonmetropolitan median family income level"; "So, for FY 2026, the 10 percent cap is effective".
(c) ILM lines 72-74, 76-104; Texas nonmetro median MED line 346; `tools/hudami/tx_checks.py`.
(d) `[HUD official doc]` + `[derived: computed from xlsx]`

**F18. The published 1-8 person limits are not always exactly "percentage x four-person limit, rounded up to $50".**
(a) Since FY 2024 HUD re-tests each family-size cell against the cap/floor. In Texas 55 of 2,032 `l50_n` cells (21 counties, e.g. Brazos, Burleson, Gaines, Glasscock, Harrison, Loving, Winkler) deviate by $50 from `ceil50(l50_4 x pct)` (48 cells are $50 lower, 7 cells are $50 higher); nationally 829 of 38,112 cells deviate. [FC] Nationally the deviation is not always $50: 722 cells are $50 lower, 72 are $50 higher and 35 are $100 lower (`tools/fc_hudami/fc_xlsx.out`). So never re-derive HUD limits from `l50_4`; read the published cells if you ever need them. Harris County follows the formula exactly (52,000 x 1.08 = 56,160 -> 56,200; x 1.16 = 60,320 -> 60,350; x 1.24 = 64,480 -> 64,500; x 1.32 = 68,640 -> 68,650).
(b) "Starting in FY 2024, HUD began re-testing family size-adjusted income limits for compliance with the cap and floor rules".
(c) ILM lines 253-254, 304-307; `tools/hudami/tx_checks.py`.
(d) `[HUD official doc]` + `[derived: computed from xlsx]`

**F19. Other columns (`l80_*`, `ELI_*`) are not used by the proposed 25F formula.** Low-income (80%) limits are generally 1.6 x the very-low-income limit with their own caps; extremely-low-income limits are the greater of 30/50ths of the VLI or the HHS poverty guideline, capped at the VLI.
(b) "HUD generally sets the four-person low-income limit at 1.6 (i.e., 80 percent/50 percent) times the relevant four-person very low-income limit."; "HUD therefore first calculates extremely low-income limits as 30/50ths (60 percent) of the Section 8 very low-income limits. HUD then compares these to the appropriate poverty guideline and if the poverty guideline is higher, that value is chosen."
(c) ILM lines 151-153, 219-224.
(d) `[HUD official doc]`

**F20. HUD's own list of programs says the Treasury/section 42 standard is tied to the Section 8 very-low-income limit, with a separate publication.**
(a) This is HUD's description of how "area median gross income" works for LIHTC, the statutory cross-reference in section 25F(c)(2)(A). It is evidence that an IRS table might be derived from HUD income limits (which carry the F17 adjustments) rather than from the raw median. The proposed-rule economic analysis, however, states the raw-median product formula (F29). Unresolved; see Open Question 1.
(b) "Multifamily Tax Subsidy Projects (Low-Income Housing Tax Credit and Tax-exempt Mortgage Revenue Bonds for rental housing) ... Current standard is Section 8 very low-income standard or 120 percent of that definition (i.e., the "60 percent" of median standard) ... A separate income limits publication is produced for this program."
(c) ILM lines 377-386 (Attachment 1, Department of Treasury). The quote is reassembled from a two-column table (program name in the left column, standard in the right); wording within each column is verbatim.
(d) `[HUD official doc]`
[FC] Verified. The words elided by the two "..." are: "for projects determining income eligibility and rents who have not used income limits prior to FY 2012. Income limits for projects using income limits in FY 2010 or earlier will no longer use Section 8 income limits." See F65-F67 for the statutory chain and for HUD's count of how often the very-low-income limit departs from 50% of the median.

**F21. Harris County numbers CONFIRMED.**
(a) Harris County (county FIPS `201`, 5-digit `48201`, `fips` = `4820199999`) is in `METRO26420M26420`, "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area", `metro` = 1, `median2026` = $104,000. 300% of that median = $312,000 (four-person, raw-median basis). The area has 7 counties: Chambers (071), Fort Bend (157), Galveston (167), Harris (201), Liberty (291), Montgomery (339), Waller (473); all seven rows carry identical values. HUD limits for Harris: `l50` = 36,400 / 41,600 / 46,800 / 52,000 / 56,200 / 60,350 / 64,500 / 68,650; `l80` = 58,250 / 66,600 / 74,900 / 83,200 / 89,900 / 96,550 / 103,200 / 109,850; `ELI` = 21,850 / 25,000 / 28,100 / 33,000 / 38,680 / 44,360 / 50,040 / 55,720. For Harris `l50_4` = exactly `median2026/2`, so both candidate formulas give $312,000 at four persons.
Counties in the same OMB MSA (26420) that are NOT in the Houston HMFA and have their own medians: Brazoria ($126,000), Austin County ($104,000), San Jacinto ($80,500).
(b) Row values: `'4820199999', 'TX', '48', 'Texas', 'METRO26420M26420', 'Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area', '201', 'Harris County', 'Harris County', 1, 104000, 36400, 41600, 46800, 52000, ...`
(c) XLSX sheet `Section8-FY26` row 3921; ADR lines 2350-2355.
(d) `[HUD data: xlsx]`

**F22. Texas HUD areas containing more than one county (16 areas, 55 counties).** Source: XLSX; county sets match ADR lines 2324-2405. `l50_4` shown only to flag where HUD's limit departs from half the median.

| hud_area_code | hud_area_name (XLSX) | # | Counties (county FIPS) | median2026 | l50_4 |
|---|---|---|---|---|---|
| METRO10180M10180 | Abilene, TX MSA | 3 | Callahan (059), Jones (253), Taylor (441) | $92,100 | 46,050 |
| METRO11100M11100 | Amarillo, TX HUD Metro FMR Area | 4 | Armstrong (011), Carson (065), Potter (375), Randall (381) | $90,700 | 45,500 (not half) |
| METRO12420M12420 | Austin-Round Rock-San Marcos, TX MSA | 5 | Bastrop (021), Caldwell (055), Hays (209), Travis (453), Williamson (491) | $134,400 | 67,200 |
| METRO13140M13140 | Beaumont-Port Arthur, TX MSA | 3 | Hardin (199), Jefferson (245), Orange (361) | $87,700 | 43,850 |
| METRO17780M17780 | College Station-Bryan, TX MSA | 3 | Brazos (041), Burleson (051), Robertson (395) | $104,600 | 48,650 (not half) |
| METRO18580M18580 | Corpus Christi, TX HUD Metro FMR Area | 2 | Nueces (355), San Patricio (409) | $83,700 | 41,850 |
| METRO19100M19100 | Dallas, TX HUD Metro FMR Area | 7 | Collin (085), Dallas (113), Denton (121), Ellis (139), Hunt (231), Kaufman (257), Rockwall (397) | $121,100 | 60,550 |
| METRO19100MM2800 | Fort Worth-Arlington, TX HUD Metro FMR Area | 3 | Johnson (251), Parker (367), Tarrant (439) | $110,300 | 55,150 |
| METRO26420M26420 | Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area | 7 | Chambers (071), Fort Bend (157), Galveston (167), Harris (201), Liberty (291), Montgomery (339), Waller (473) | $104,000 | 52,000 |
| METRO28660M28660 | Killeen-Temple, TX HUD Metro FMR Area | 2 | Bell (027), Coryell (099) | $85,100 | 42,550 |
| METRO30980M30980 | Longview, TX HUD Metro FMR Area | 2 | Gregg (183), Upshur (459) | $80,600 | 41,850 (not half) |
| METRO31180M31180 | Lubbock, TX HUD Metro FMR Area | 2 | Crosby (107), Lubbock (303) | $90,900 | 44,800 (not half) |
| METRO41660M41660 | San Angelo, TX MSA | 2 | Irion (235), Tom Green (451) | $90,900 | 44,950 (not half) |
| METRO41700M41700 | San Antonio-New Braunfels, TX HUD Metro FMR Area | 5 | Bandera (019), Bexar (029), Comal (091), Guadalupe (187), Wilson (493) | $100,600 | 50,300 |
| METRO47020M47020 | Victoria, TX MSA | 2 | Goliad (175), Victoria (469) | $81,300 | 42,000 (not half) |
| METRO48660M48660 | Wichita Falls, TX MSA | 3 | Archer (009), Clay (077), Wichita (485) | $91,200 | 45,600 |

(d) `[HUD data: xlsx]`

**F23. The 31 single-county Texas metro areas (county is "metro" but has its own median; do NOT give these counties the big-city median).**

| County (FIPS) | hud_area_code | hud_area_name | median2026 |
|---|---|---|---|
| Aransas (007) | METRO18580N48007 | Aransas County, TX HUD Metro FMR Area | $86,800 |
| Atascosa (013) | METRO41700N48013 | Atascosa County, TX HUD Metro FMR Area | $86,100 |
| Austin (015) | METRO26420N48015 | Austin County, TX HUD Metro FMR Area | $104,000 |
| Bosque (035) | METRO47380N48035 | Bosque County, TX HUD Metro FMR Area | $85,100 |
| Bowie (037) | METRO45500M45500 | Texarkana, TX-Texarkana, AR HUD Metro FMR Area | $78,300 |
| Brazoria (039) | METRO26420MM1145 | Brazoria County, TX HUD Metro FMR Area | $126,000 |
| Cameron (061) | METRO15180M15180 | Brownsville-Harlingen, TX MSA | $64,600 |
| Cochran (079) | METRO31180N48079 | Cochran County, TX HUD Metro FMR Area | $57,000 |
| Ector (135) | METRO36220M36220 | Odessa, TX MSA | $91,100 |
| El Paso (141) | METRO21340M21340 | El Paso, TX HUD Metro FMR Area | $73,400 |
| Falls (145) | METRO47380N48145 | Falls County, TX HUD Metro FMR Area | $76,100 |
| Garza (169) | METRO31180N48169 | Garza County, TX HUD Metro FMR Area | $78,000 |
| Grayson (181) | METRO43300M43300 | Sherman-Denison, TX MSA | $95,300 |
| Harrison (203) | METRO30980M48203 | Harrison County, TX HUD Metro FMR Area | $77,100 |
| Hidalgo (215) | METRO32580M32580 | McAllen-Edinburg-Mission, TX MSA | $64,000 |
| Hockley (219) | METRO31180N48219 | Hockley County, TX HUD Metro FMR Area | $80,300 |
| Hudspeth (229) | METRO21340N48229 | Hudspeth County, TX HUD Metro FMR Area | $60,200 |
| Kendall (259) | METRO41700N48259 | Kendall County, TX HUD Metro FMR Area | $139,700 |
| Lampasas (281) | METRO28660N48281 | Lampasas County, TX HUD Metro FMR Area | $106,300 |
| Lynn (305) | METRO31180N48305 | Lynn County, TX HUD Metro FMR Area | $90,000 |
| Martin (317) | METRO33260N48317 | Martin County, TX HUD Metro FMR Area | $100,700 |
| Maverick (323) | METRO20580M20580 | Eagle Pass, TX MSA | $61,700 |
| McLennan (309) | METRO47380M47380 | Waco, TX HUD Metro FMR Area | $90,300 |
| Medina (325) | METRO41700N48325 | Medina County, TX HUD Metro FMR Area | $101,000 |
| Midland (329) | METRO33260M33260 | Midland, TX HUD Metro FMR Area | $108,900 |
| Oldham (359) | METRO11100N48359 | Oldham County, TX HUD Metro FMR Area | $87,300 |
| Rusk (401) | METRO30980N48401 | Rusk County, TX HUD Metro FMR Area | $87,900 |
| San Jacinto (407) | METRO26420N48407 | San Jacinto County, TX HUD Metro FMR Area | $80,500 |
| Smith (423) | METRO46340M46340 | Tyler, TX MSA | $97,300 |
| Webb (479) | METRO29700M29700 | Laredo, TX MSA | $74,000 |
| Wise (497) | METRO19100N48497 | Wise County, TX HUD Metro FMR Area | $112,300 |

(c) XLSX; `tools/hudami/tx_analysis.py`.
(d) `[HUD data: xlsx]`

**F24. Texas anomalies and traps found (none of them is a data defect).**
1. Missing medians: none. Null cells: none. Duplicate FIPS: none. County-equivalents: none (all 254 names end in " County"; `County_Name` = `county_town_name`; every Texas `fips` = `48` + county + `99999`, i.e. no sub-county rows). Texas has no New England-style town rows.
2. One Texas area crosses the state line: `METRO45500M45500` "Texarkana, TX-Texarkana, AR HUD Metro FMR Area" contains Bowie County, TX and Miller County, AR (same median $78,300). If you group by area code nationally you will pick up an Arkansas row; always filter by state + county.
3. Eight Texas rows have `median2026` exactly equal to the Texas nonmetropolitan median ($83,700): Crockett, Jeff Davis, Kenedy, King, Loving, Presidio (nonmetro) and Nueces + San Patricio (the Corpus Christi HMFA). HUD's stated fallback is that a county without a reliable estimate "will receive the estimate for the non-metropolitan portion of its state" (MED lines 51-54); that plausibly explains the six small nonmetro counties. Whether the Corpus Christi figure is a coincidence is NOT IN SOURCES.
4. Lowest medians: Starr $38,700, Zapata $43,800, Zavala $48,100, Dimmit $50,500, Jim Hogg $50,800, Brooks $51,700. 111 Texas rows have a median below the State nonmetro median; for those HUD's own limits are floored (F17) but `median2026` is not.
5. Highest: Glasscock County $144,200 (nonmetro; its HUD `l50_4` is only 60,800, far below half the median; the sources do not show which HUD adjustment applied, the 10% annual-increase cap being the plausible one), Kendall $139,700, the five Austin-area counties $134,400, Brazoria $126,000.
6. Name collisions between counties and cities: Austin County (015, Houston MSA, $104,000) is not the city of Austin (Travis County, $134,400); Houston County (225, nonmetro, $81,100) is not the city of Houston (Harris County); Tyler County (457, nonmetro, $74,400) is not the city of Tyler (Smith County, $97,300). Resolve an address to a county FIPS code, never to a name typed by the family.
7. Irregular codes: `METRO30980M48203` (Harrison County uses `M` + county FIPS), `MM` codes (F11).
8. Sheet dimension metadata claims 1,048,576 rows (F1); header case inconsistencies (F3).
(c) XLSX; `tools/hudami/tx_checks.py`, `tools/hudami/tx_analysis.py`; MED lines 46-54, 346.
(d) `[derived: computed from xlsx]`
[FC] All counts, names, codes and dollar figures in items 1-8 re-computed and confirmed (`tools/fc_hudami/fc_xlsx.out`). Three statements are explanations, not data, and are UNVERIFIED:
- Item 3: that the six nonmetro counties at $83,700 received the State nonmetro fallback is plausible under MED lines 50-54 but cannot be confirmed from the sources (HUD's per-area documentation system is behind the WAF). For the Corpus Christi HMFA the stated fallback would be the estimate "for its OMB-defined metropolitan area" (MED lines 53-54), not the State nonmetro figure, so the match is unexplained.
- Item 5: which HUD adjustment produced Glasscock's `l50_4` of 60,800 is UNVERIFIED. Checking the cap needs the FY 2025 limit, and the local `hud/Section8-FY25.xlsx` is a zero-byte file.
- Related observation (new): Austin County's own HMFA has the same median as the Houston HMFA ($104,000) while the two other carved-out Houston-MSA counties do not (Brazoria $126,000, San Jacinto $80,500). Whether that is a fallback to a larger-area estimate is NOT IN SOURCES. Do not "fix" it in tests.

**F25. Reference medians for States (HUD Attachment 2).** Texas: total $101,500; metropolitan $104,200; nonmetropolitan $83,700. US: total $106,800; metro $110,200; nonmetro $84,700. Note a discrepancy inside HUD's own documents: the income-limits methodology says "the U.S. median family income ($107,900 for FY 2026)" (ILM line 154) while Attachment 2 of the medians methodology lists US total $106,800 (MED line 354). Not used by the 25F formula; do not hard-code either.
(c) MED lines 346, 354; ILM line 154.
(d) `[HUD official doc]`

### PART B. Proposed-rule cross-check: the section 25F income limit

**F26. Statute: the income test.**
(a) Eligible student = member of a household whose income for the calendar year before the application date is "not greater than" 300% of area median gross income "as such term is used in section 42", and who is eligible to enroll in a public elementary or secondary school.
(b) "is a member of a household with an income which, for the calendar year prior to the date of the application for a scholarship, is not greater than 300 percent of the area median gross income (as such term is used in section 42), and"
(c) USC lines 159-164 (section 25F(c)(2)).
(d) `[statute]`

**F27. Statute: the SGO must verify both annual household income and family size, and may not award above the limit.**
(b) "verifies the annual household income and family size of eligible students who apply for scholarships to ensure such students meet the requirement of subsection (c)(2)(A), and" / "limits the awarding of scholarships to eligible students who are a member of a household for which the income does not exceed the amount established under subsection (c)(2)(A)."
(c) USC lines 214, 217 (section 25F(d)(1)(F)).
(d) `[statute]`

**F28. Proposed regulation text, definition of AMGI (Prop. Reg. 1.25F-1(a)(4)(ii)): Section 8-consistent, family-size adjusted, and to be published annually by the IRS.**
(b) "The term area median gross income means area median gross income calculated in a manner consistent with determinations of area median gross income under section 8 of the United States Housing Act of 1937 (or, if such program is terminated, under such program as in effect immediately before such termination), including adjustments for family size, meaning the number of persons who are part of a household for purposes of section 25F. Area median gross income will be published in the Internal Revenue Bulletin annually by the Internal Revenue Service."
(c) PR lines 4871-4879. Companion operative text, Prop. Reg. 1.25F-3(c)(6)(ii)(A), PR lines 5494-5499: "For purposes of computing the household income limit under section 25F(c)(2)(A) of 300 percent of area median gross income, area median gross income means the income limit determined based on area median gross income and family size in accordance with section 8 of the United States Housing Act of 1937 (Section 8)."
(d) `[proposed-reg: not final]`

**F29. THE FORMULA as stated by Treasury/IRS (economic analysis): limit = 300% x AMGI x HUD family-size multiplier.**
(a) `limit(area, n) = 3 x AMGI(area) x multiplier(n)`. Worked examples in the rule: household of 3 at AMGI $100,000 -> $270,000; household of 4 -> $300,000. No rounding step is stated.
(b) "To ensure consistency with the income limits used in section 42, the income limit must be calculated as the product of 300 percent of the area median gross income and the HUD family-size multiplier. For example, if a household of three lived in a location where the area median gross income was $100,000, a child in this household could be eligible to receive a scholarship funded by section 25F if the household's income was less than, or equal to, $270,000 (3 * $100,000 * 0.90). For a household of four living in the same area, this income limit would be $300,000 (3 * $100,000 * 1.0)."
(c) PR lines 2755-2763 (Special Analyses / economic analysis, "i. Defining a Family Size Adjustment", which begins at line 2748).
(d) `[preamble/economic-analysis]`
[FC] Verified verbatim. Scope warning: this sentence is Treasury's economic analysis describing the proposed rule. The product formula does NOT appear in the proposed regulation text (PR lines 4500-6500 contain no "multiplier", no "0.70 ... 1.32" table and no "product of 300 percent"; checked by grep) and not in the statute. The regulation text that would actually bind is F28. Treat F29 as the best available statement of intent, not as law, and never describe it to a donor, family or SGO as "the IRS formula" without the word "proposed".

**F30. Table 1 multipliers in the proposed rule (identical to HUD's percentages in F14) and the over-8 rule.**
(a) multiplier(1..8) = 0.70, 0.80, 0.90, 1.00, 1.08, 1.16, 1.24, 1.32; for n > 8: 1.32 + 0.08 x (n - 8). The table is titled "Current" HUD multipliers and cites the FY 2026 HUD methodology, so treat the multipliers as versioned data, not constants.
(b) "Table 1--Current HUD Family Size Multipliers / Family size 1 2 3 4 5 6 7 8 / Multiplier 0.70 0.80 0.90 1.00 1.08 1.16 1.24 1.32 / Notes: For each member of the family in excess of 8, the family size multiplier increases by 0.08. / Sources: Methodology for Determining FY 2026 Section 8 Income Limits, last accessed June 11, 2026. https://www.huduser.gov/portal/datasets/il/il26/IncomeLimitsMethodology-FY26.pdf."
(c) PR lines 2765-2772.
(d) `[preamble/economic-analysis]`
[FC] Verified verbatim. Two additions. (i) The multiplier table exists only in the economic analysis; the proposed regulation text says only "including adjustments for family size" (F28). (ii) Treasury states why it used HUD's multipliers and no others: "Other alternatives were not considered for purposes of section 25F, because the statute references the HUD definition of area median gross income, which uses the HUD family size multiplier." (PR lines 2775-2778). Note also that HUD applies these percentages to the four-person INCOME LIMIT, not to the median (F14, F15: "the four-person income limit should be multiplied by an additional 8 percent"); the economic analysis applies them to "area median gross income". Whether those are the same number is Open Question 1.

**F31. Comparison operator: eligible when household income is less than or equal to the limit.**
(b) Statute: "is not greater than 300 percent"; economic analysis: "if the household's income was less than, or equal to, $270,000".
(c) USC line 161; PR lines 2761-2762; Prop. Reg. 1.25F-1(a)(4)(i)(A) PR lines 4862-4868.
(d) `[statute]` + `[preamble/economic-analysis]`

**F32. The IRS "anticipates" publishing the limits by geographic area and family size annually in the Internal Revenue Bulletin. No such table is in the sources.**
(a) Any HUD-derived table is provisional. Whether a table has since been published: NOT IN SOURCES (the two IRS web-page captures contain no income-limit content; searched for "median", "household", "income limit", "HUD").
(b) "To assist SGOs in verification of household income, the IRS anticipates publishing the applicable limitations by geographic area and family size annually in guidance published in the Internal Revenue Bulletin."
(c) PR lines 1189-1192.
(d) `[preamble/economic-analysis]`
[FC] Verified. Two further checks made on 2026-11-18, both negative: (i) the saved Internal Revenue Bulletins 2026-38 through 2026-47 (IRB alias) contain zero occurrences of "25F", "area median gross income" or "scholarship granting" (grep; the completeness of those captures was not independently verified, so this is evidence, not proof); (ii) a Federal Register API search for documents containing both "section 25F" and "area median gross income" returned exactly two documents, both dated 2026-10-02: the proposed rule (FR Doc. 2026-20277) and the temporary/final rule (FR Doc. 2026-20264) (`sources/extra/factcheck_hudami/fr_search_25f.json`). The IRS web-page captures (`sources/irs_fstc_individuals.txt`, `sources/irs_fstc_states.txt`, and the `sources/extra/irs_fstc_*.txt` captures) contain no "median", "household income", "family size" or "300" hits. Conclusion: no IRS-published 25F limit table was found anywhere. `[secondary/web]` for the two negative searches.

**F33. Family size = number of persons in the household, including the student; multi-household tie-break rule.**
(a) Count every person residing with the student (no kinship test in the text). If the student lives in more than one household during the calendar year, use the household where the student resides the longest; if time is equal, the household "of the taxpayer with the highest household income".
(b) "Family size is equal to the number of persons who are part of a household. A student's household includes the individual whose status as an eligible student is being determined, as well as each other person residing with that individual. ... the relevant household is the one in which the student resides for the longest period of time during the year or, if the time spent by the student in each household is equal, then the household of the taxpayer with the highest household income."
(c) PR lines 5500-5510 (Prop. Reg. 1.25F-3(c)(6)(ii)(B)). Note the economic-analysis paraphrase at PR lines 2785-2790 says "resided for the majority of the year"; the regulation text says "longest period of time".
(d) `[proposed-reg: not final]`

**F34. Household definition (Prop. Reg. 1.25F-1(a)(4)(iii)).**
(b) "The term household includes the individual whose status as an eligible student is being determined, and the group of persons residing with that individual."
(c) PR lines 4880-4883. Preamble derivation from 24 CFR 5.100/5.403 at PR lines 1238-1246.
(d) `[proposed-reg: not final]`

**F35. Income year = the calendar year before the date of the scholarship application.**
(a) `income_year = year(application_date) - 1`. The engine needs the application date as an input. Which year's AMGI table is compared with that income is NOT IN SOURCES (Open Question 3).
(b) "for the calendar year prior to the date of the application for a scholarship"
(c) USC line 161; PR lines 4862-4864.
(d) `[statute]`

**F36. An SGO may set a stricter cap than 300%.**
(b) "For example, an SGO that limits scholarships to students that are members of households with an income not greater than 50% of area median gross income, and that otherwise meets all the requirements under section 25F to be an eligible SGO, would be an eligible SGO for purposes of section 25F." Also (T.D. 10057 preamble): "or to students whose household income is less than 80 percent of the area median gross income".
(c) PR lines 1197-1201; TR lines 226-230.
(d) `[preamble/economic-analysis]` (PR) and preamble to `[temporary-reg: in force]` (TR)

**F37. Treasury's own eligibility estimates compared ACS household income with "300% of area median gross income, as published by HUD", citing HUD's Multifamily Tax Subsidy Project (MTSP) income limits dataset, not the Section 8 file.**
(a) Signals that the eventual IRS table may be sourced from the MTSP publication. The MTSP FY 2026 file is not in the local sources and huduser.gov blocked plain requests. See Open Question 2.
(b) "Total household income was compared to 300% of area median gross income, as published by HUD." ... "U.S. Department of Housing and Urban Development, Office of Policy Development and Research (PD&R). HUD Multifamily Tax Subsidy Project (MTSP) Income Limits. https://www.huduser.gov/portal/datasets/mtsp.html#data_2026, last accessed June 12, 2026."
(c) PR lines 2919-2929 (footnote 16); same dataset cited in Table 2 sources, PR lines 3106-3107.
(d) `[preamble/economic-analysis]`

**F38. Two candidate ways to turn HUD FY 2026 data into a provisional 25F table, and how far apart they are in Texas.**
(a) Formula A (what the economic analysis literally says, F29): `limit = 3 x median2026 x multiplier(n)`. Formula B (if "AMGI ... in accordance with section 8" means HUD's published, adjusted limits, as in the section 42 standard of F20): `limit = 6 x l50_n`.
Texas, four-person: equal in 111 county rows, B higher in 120 rows, B lower in 23 rows. All 2,032 county-by-size cells: equal 181, B higher 1,664, B lower 187 (707 of the differences are under $300; [FC] all 707 are in the 111 counties where `l50_4` is exactly half the median, the largest is $288, and they come from HUD's $50 rounding of each family-size cell plus, in 3 cells, the cap/floor re-test, so B is not always the higher one even there). Differ at four persons in 31 of 86 metro county rows and 112 of 168 nonmetro rows.
Gaps at four persons (B minus A). Where B is higher, the six largest are: Starr County A = $116,100 vs B = $251,100 (+$135,000); Zapata +$119,700; Zavala +$106,800; Dimmit +$99,600; Jim Hogg +$98,700; Brooks +$96,000. Other populous examples: Hidalgo A = $192,000 vs B = $251,100 (+$59,100); Cameron A = $193,800 vs B = $251,100 (+$57,300); El Paso A = $220,200 vs B = $251,100 (+$30,900); Webb A = $222,000 vs B = $251,100 (+$29,100). 30 county rows have B more than $50,000 above A. Where B is lower, [FC] the five largest are (the original list omitted three of them): Glasscock A = $432,600 vs B = $364,800 (-$67,800); Sterling A = $327,000 vs B = $270,000 (-$57,000); Somervell A = $320,400 vs B = $286,200 (-$34,200); Winkler A = $321,300 vs B = $293,700 (-$27,600); Brazos A = $313,800 vs B = $291,900 (-$21,900).
For household sizes above 8, Formula B has no published cell; HUD's rule (F15) gives `l50_4 x (132 + 8 x (n - 8)) / 100`, optionally rounded to $50, so a Formula B limit for n > 8 would be 6 times that. [FC] added.
The big metros are identical under both at four persons: Harris $312,000; Dallas $363,300; Travis $403,200; Bexar $301,800; Tarrant $330,900.
(b) n/a (computation). Inputs: XLSX `median2026`, `l50_1..8`.
(c) `tools/hudami/tx_checks.py`; per-county values in `tools/hudami/tx_25f_provisional_limits_formulaA.csv` (columns `limit300_4p`, `six_x_l50_4`).
(d) `[derived: computed from xlsx]`. Which formula the IRS will use: NOT IN SOURCES beyond F28-F29.

**F39. Golden test vectors under Formula A (3 x `median2026` x multiplier), exact dollars, no rounding needed.** Because every median is a multiple of $100 and every multiplier has two decimals, the product is always a whole dollar: compute in integers as `median2026 * 3 * pct / 100` with pct in {70, 80, 90, 100, 108, 116, 124, 132, 140, ...}.

| County (FIPS5) | hud_area_code | median2026 | Limit for household size 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 | Size 9 |
|---|---|---|---|---|
| Harris (48201) | METRO26420M26420 | 104,000 | 218,400 / 249,600 / 280,800 / 312,000 / 336,960 / 361,920 / 386,880 / 411,840 | 436,800 |
| Travis (48453) | METRO12420M12420 | 134,400 | 282,240 / 322,560 / 362,880 / 403,200 / 435,456 / 467,712 / 499,968 / 532,224 | 564,480 |
| Dallas (48113) | METRO19100M19100 | 121,100 | 254,310 / 290,640 / 326,970 / 363,300 / 392,364 / 421,428 / 450,492 / 479,556 | 508,620 |
| Tarrant (48439) | METRO19100MM2800 | 110,300 | 231,630 / 264,720 / 297,810 / 330,900 / 357,372 / 383,844 / 410,316 / 436,788 | 463,260 |
| Bexar (48029) | METRO41700M41700 | 100,600 | 211,260 / 241,440 / 271,620 / 301,800 / 325,944 / 350,088 / 374,232 / 398,376 | 422,520 |
| El Paso (48141) | METRO21340M21340 | 73,400 | 154,140 / 176,160 / 198,180 / 220,200 / 237,816 / 255,432 / 273,048 / 290,664 | 308,280 |
| Hidalgo (48215) | METRO32580M32580 | 64,000 | 134,400 / 153,600 / 172,800 / 192,000 / 207,360 / 222,720 / 238,080 / 253,440 | 268,800 |
| Brazoria (48039) | METRO26420MM1145 | 126,000 | 264,600 / 302,400 / 340,200 / 378,000 / 408,240 / 438,480 / 468,720 / 498,960 | 529,200 |
| Kendall (48259) | METRO41700N48259 | 139,700 | 293,370 / 335,280 / 377,190 / 419,100 / 452,628 / 486,156 / 519,684 / 553,212 | 586,740 |
| Midland (48329) | METRO33260M33260 | 108,900 | 228,690 / 261,360 / 294,030 / 326,700 / 352,836 / 378,972 / 405,108 / 431,244 | 457,380 |
| Bowie (48037) | METRO45500M45500 | 78,300 | 164,430 / 187,920 / 211,410 / 234,900 / 253,692 / 272,484 / 291,276 / 310,068 | 328,860 |
| Starr (48427) | NCNTY48427N48427 | 38,700 | 81,270 / 92,880 / 104,490 / 116,100 / 125,388 / 134,676 / 143,964 / 153,252 | 162,540 |
| Glasscock (48173) | NCNTY48173N48173 | 144,200 | 302,820 / 346,080 / 389,340 / 432,600 / 467,208 / 501,816 / 536,424 / 571,032 | 605,640 |
| Loving (48301) | NCNTY48301N48301 | 83,700 | 175,770 / 200,880 / 225,990 / 251,100 / 271,188 / 291,276 / 311,364 / 331,452 | 351,540 |

(c) `tools/hudami/tx_25f_provisional_limits_formulaA.csv` (all 254 counties, sizes 1-12).
(d) `[derived: computed from xlsx]`. These are PROVISIONAL, HUD-derived numbers, not IRS-published limits.

### PART C. 24 CFR 5.609 "annual income" and related definitions (5.100, 5.403, 5.603, 5.611)

**F40. Version of the HUD regulation text used here.**
(a) eCFR point-in-time 2026-11-01; byte-identical to the 2026-11-12 point-in-time for 5.609, 5.603, 5.100, 5.403. eCFR reports Title 24 "up_to_date_as_of 2026-11-16" and 5.609's latest amendment date as 2025-06-12; the section's own source note reads "[88 FR 9657, Feb. 14, 2023]" (the HOTMA final rule). The proposed 25F regulation cites "24 CFR 5.609" with no date; a footnote in the economic analysis cites "24 CFR 5.609 (2000)" but links to the current eCFR page and describes the current ($50,000) rule. Treat the current text as the reference and record the eCFR date in every decision record.
(b) Footnote: "24 CFR 5.609 (2000), last accessed June 11, 2026. https://www.ecfr.gov/current/title-24/subtitle-A/part-5/subpart-F/subject-group-ECFR174c6349abd095d/section-5.609."
(c) CFR609 line 94; `sources/extra/ecfr/versions_5.609.json`, `sources/extra/ecfr/titles.json`; PR line 2827.
(d) `[CFR in force: 24 CFR]`
[FC] Verified three ways: (i) a fresh eCFR fetch on 2026-11-18 of 5.609, 5.100, 5.403 and 5.611 is byte-identical to the author's saved XML (the eCFR API now requires a compressed response, `curl --compressed`; it also intermittently returns "IP address has been blocked", which is why 5.603 could not be re-fetched from eCFR); (ii) the govinfo CFR annual edition revised as of April 1, 2025 (`https://www.govinfo.gov/content/pkg/CFR-2025-title24-vol1/xml/CFR-2025-title24-vol1-sec5-609.xml`) has the same words as the eCFR text of 5.609 apart from the formatting of three cross-references, and its 5.603 matches the author's 5.603; (iii) the eCFR version history lists amendments dated 2017-01-03, 2023-02-14, 2024-01-01 and 2025-06-12.
[FC] Added context: HUD itself says the HOTMA revisions to 5.609 became effective January 1, 2024, but HUD has repeatedly extended the date by which some of its own programs must comply; for Community Planning and Development programs the compliance date is now January 1, 2027, and until then those grantees may still use 5.603, 5.609, 5.611 and 5.617 "as they existed prior to January 1, 2024" (FRC lines 71-74, 134-140). So two different versions of "24 CFR 5.609 annual income" are in live use inside HUD programs. The proposed 25F regulation cites "24 CFR 5.609" with no date, and its description (the $50,000 imputed-return threshold) matches the current, post-2024 text. Use the current text. `[CFR in force: 24 CFR]` for the HUD rule.

**F41. Proposed 25F definition of household income (Prop. Reg. 1.25F-3(c)(6)(ii)(C)): 5.609 annual income, minus imputed returns on assets, cash receipts only.**
(a) Start from 24 CFR 5.609 annual income. Disregard imputed return on net assets. Include child support and alimony even if not in taxable income. Exclude non-cash receipts.
(b) "the term household income means annual income, as defined in 24 CFR 5.609; however, for this purpose, household income must be determined by disregarding the imputed return on net assets (for example, unrealized appreciation in a home or stock). This definition includes receipts by a member of the household in the form of child support and alimony not included in taxable income but excludes non-cash receipts."
(c) PR lines 5511-5520.
(d) `[proposed-reg: not final]`

**F42. Preamble: what is disregarded and why.**
(a) Disregard anything "not received in cash by a member of the household", expressly including the amount of a Section 8 housing allowance and any imputed return on assets.
(b) "the proposed regulations would disregard items not received in cash by a member of the household because such items are unlikely to be documented and verifiable. The proposed regulations, therefore, would disregard the amount of a Section 8 housing allowance, any imputed return on assets, and other items not received in cash."
(c) PR lines 1221-1227; also PR lines 2805-2808 ("household income includes only cash sources of income, and excludes non-cash sources of income, such as imputed income on net assets").
(d) `[preamble/economic-analysis]`

**F43. Treasury rejected AGI as the definition. A tax return alone does not establish 25F household income.**
(a) Household income is measured per household (everyone residing with the student), not per tax unit, and includes non-taxable cash such as child support. Do not use Form 1040 AGI as the income figure; use tax documents as evidence for individual components.
(b) "The Treasury Department and the IRS also considered defining household income as adjusted gross income (AGI) as calculated on Form 1040. This alternative was not chosen for several reasons. First, AGI must be calculated based on the income and marital status of a tax unit. The statute contains references to households and families, rather than tax units."
(c) PR lines 2850-2856. Also PR lines 1205-1207: 5.609 "is broader than the Federal tax definition of "income" and includes items such as child support, alimony received".
(d) `[preamble/economic-analysis]`

**F44. What annual income INCLUDES (24 CFR 5.609(a)).**
(a) (1) Everything received from any source, unless specifically excluded in 5.609(b), by each member who is 18 or older, or who is the head of household or the head's spouse (any age); plus unearned income by or on behalf of each dependent under 18. (2) Imputed returns on assets when net family assets exceed $50,000 (CPI-adjusted) and actual returns on an asset cannot be calculated; this second prong is what the proposed 25F rule switches off.
(b) "(1) All amounts, not specifically excluded in paragraph (b) of this section, received from all sources by each member of the family who is 18 years of age or older or is the head of household or spouse of the head of household, plus unearned income by or on behalf of each dependent who is under 18 years of age, and (2) When the value of net family assets exceeds $50,000 (which amount HUD will adjust annually in accordance with the Consumer Price Index for Urban Wage Earners and Clerical Workers) and the actual returns from a given asset cannot be calculated, imputed returns on the asset based on the current passbook savings rate, as determined by HUD."
(c) CFR609 lines 2-4.
(d) `[CFR in force: 24 CFR]`

**F45. Key definitions used by 5.609.**
- Earned income (5.100): "income or earnings from wages, tips, salaries, other employee compensation, and net income from self-employment. Earned income does not include any pension or annuity, transfer payments (meaning payments made or income received in which no goods or services are being paid for, such as welfare, social security, and governmental subsidies for certain benefits), or any cash or in-kind benefits." (CFR100 line 11)
- Unearned income (5.100): "any annual income, as calculated under § 5.609, that is not earned income." (CFR100 line 54)
- Dependent (5.603): "A member of the family (which excludes foster children and foster adults) other than the family head or spouse who is under 18 years of age, or is a person with a disability, or is a full-time student." (CFR603 line 10)
- Minor (5.603): "A member of the family, other than the head of family or spouse, who is under 18 years of age." (CFR603 line 24)
- Full-time student (5.603): "A person who is attending school or vocational training on a full-time basis." (CFR603 line 18)
- Household (5.100): "the family, foster children and adults, and PHA-approved live-in aide." (CFR100 line 30) [FC] The original quote dropped the scope words. The full sentence is: "Household, for purposes of 24 CFR part 5, subpart I, and parts 960, 966, 882, and 982 of this title, means the family, foster children and adults, and PHA-approved live-in aide." Subpart F (where 5.609 sits) is not in that list. 5.609(a) measures income "with respect to the family" and of "each member of the family"; the word "household" appears in 5.609 only in "head of household" and in the trust paragraph (b)(2) ("the family or household"). The proposed 25F rule builds its own "household" definition (F34) by pointing at this sentence in its preamble (PR lines 1238-1246).
- [FC] Very low income family (5.603): "A family whose annual income does not exceed 50 percent of the median family income for the area, as determined by HUD with adjustments for smaller and larger families, except that HUD may establish income ceilings higher or lower than 50 percent of the median income for the area if HUD finds that such variations are necessary because of unusually high or low family incomes." (CFR603 line 52). Relevant to Open Question 1; see F67.
- [FC] Welfare assistance (5.603): CFR603 line 53. Imputed welfare income: "See § 5.615" (CFR603 line 20); see F72.
- Family (5.403): includes "A single person" or "A group of persons residing together" (CFR403 lines 7-17).
- Day laborer, independent contractor, seasonal worker: CFR603 lines 9, 21, 47.
(d) `[CFR in force: 24 CFR]`

**F46. FULL list of exclusions, 24 CFR 5.609(b) ("Annual income does not include the following"). Paragraph numbers are the regulation's own. Line numbers refer to CFR609.**

| 5.609(b) | Excluded item (close paraphrase; quoted where short) | Line |
|---|---|---|
| (1) | "Any imputed return on an asset when net family assets total $50,000 or less (which amount HUD will adjust annually in accordance with the Consumer Price Index for Urban Wage Earners and Clerical Workers) and no actual income from the net family assets can be determined." | 6 |
| (2) | Trust distributions: (i) for an irrevocable trust or a revocable trust outside the family's control: distributions of principal/corpus, and distributions of income used to pay health and medical care costs for a minor; (ii) for a revocable trust under the family's control: any distributions, but "any actual income earned by the trust, regardless of whether it is distributed, shall be considered income to the family at the time it is received by the trust." | 7-11 |
| (3) | "Earned income of children under the 18 years of age." | 12 |
| (4) | "Payments received for the care of foster children or foster adults, or State or Tribal kinship or guardianship care payments." | 13 |
| (5) | "Insurance payments and settlements for personal or property losses, including but not limited to payments through health insurance, motor vehicle insurance, and workers' compensation." | 14 |
| (6) | Amounts "specifically for, or in reimbursement of, the cost of health and medical care expenses for any family member." | 15 |
| (7) | Amounts recovered in a civil action or settlement for malpractice, negligence or other breach of duty "that resulted in a member of the family becoming disabled." | 16 |
| (8) | "Income of a live-in aide, foster child, or foster adult as defined in §§ 5.403 and 5.603, respectively." | 17 |
| (9)(i) | Assistance that section 479B of the Higher Education Act (20 U.S.C. 1087uu) requires be excluded. | 18 |
| (9)(ii) | Other student financial assistance (grant or scholarship from government, 501(c)(3) private foundation, business entity, or institution of higher education) for tuition, books, supplies, room and board and required fees at an institution of higher education. NOT excluded: fee-for-service support such as work study or a teaching fellowship not covered by (9)(i); gifts from family or friends; any amount exceeding the student's actual covered costs. | 19-40 |
| (10) | Income and distributions from Coverdell (section 530) and 529 accounts; income from government contributions to, and distributions from, "baby bond" accounts. | 41 |
| (11) | "The special pay to a family member serving in the Armed Forces who is exposed to hostile fire." | 42 |
| (12)(i) | Amounts set aside under an SSI Plan to Attain Self-Sufficiency (PASS). | 43 |
| (12)(ii) | Amounts received by a participant in other publicly assisted programs "specifically for or in reimbursement of out-of-pocket expenses incurred (e.g., special equipment, clothing, transportation, child care, etc.)". | 44 |
| (12)(iii) | Resident service stipend "not to exceed $200 per month". | 45 |
| (12)(iv) | Incremental earnings and benefits from participation in HUD-funded or qualifying Federal, State, Tribal, or local employment training programs, only for the period of participation. | 46 |
| (13) | Reparation payments by a foreign government for Nazi-era persecution. | 47 |
| (14) | "Earned income of dependent full-time students in excess of the amount of the deduction for a dependent in § 5.611." | 48 |
| (15) | "Adoption assistance payments for a child in excess of the amount of the deduction for a dependent in § 5.611." | 49 |
| (16) | "Deferred periodic amounts from Supplemental Security Income and Social Security benefits that are received in a lump sum amount or in prospective monthly amounts, or any deferred Department of Veterans Affairs disability benefits that are received in a lump sum amount or in prospective monthly amounts." | 50 |
| (17) | Payments related to aid and attendance under 38 U.S.C. 1521 to veterans. | 51 |
| (18) | Refunds or rebates under State or local law for property taxes paid on the dwelling unit. | 52 |
| (19) | Payments by or authorized by a State Medicaid agency or other State/Federal agency to a family to enable a family member with a disability to reside in the family's assisted unit (including payments to a family member for caregiving). | 53 |
| (20) | "Loan proceeds (the net amount disbursed by a lender to or on behalf of a borrower, under the terms of a loan agreement)". | 54 |
| (21) | Payments to Tribal members from claims for mismanagement of trust assets, to the extent also excluded from gross income under the Code or other Federal law. | 55 |
| (22) | "Amounts that HUD is required by Federal statute to exclude from consideration as income"; HUD lists them in a Federal Register notice (see F47). | 56 |
| (23) | Replacement housing "gap" payments under 49 CFR part 24 (with a carve-back). | 57 |
| (24) | "Nonrecurring income, which is income that will not be repeated in the coming year based on information provided by the family. Income received as an independent contractor, day laborer, or seasonal worker is not excluded from income under this paragraph, even if the source, date, or amount of the income varies." Includes: (i) Census Bureau temporary employment of no more than 180 days; (ii) "Direct Federal or State payments intended for economic stimulus or recovery"; (iii) State refundable tax credits or State tax refunds; (iv) Federal refundable tax credits and Federal tax refunds; (v) "Gifts for holidays, birthdays, or other significant life events or milestones"; (vi) "Non-monetary, in-kind donations, such as food, clothing, or toiletries, received from a food bank or similar organization"; (vii) "Lump-sum additions to net family assets, including but not limited to lottery or other contest winnings." | 58-65 |
| (25) | "Civil rights settlements or judgments, including settlements or judgments for back pay." | 66 |
| (26) | "Income received from any account under a retirement plan recognized as such by the Internal Revenue Service, including individual retirement arrangements (IRAs), employer retirement plans, and retirement plans for self-employed individuals; except that any distribution of periodic payments from such accounts shall be income at the time they are received by the family." | 67 |
| (27) | Income earned on amounts in a Family Self Sufficiency account. | 68 |
| (28) | "Gross income a family member receives through self-employment or operation of a business; except that the following shall be considered income": (i) net income from the business or profession (no deduction for business expansion or amortization of capital indebtedness; straight-line depreciation allowed); (ii) withdrawals of cash or assets from the business, except reimbursement of cash or assets the family invested. | 69-71 |

(d) `[CFR in force: 24 CFR]`

**F47. Federally mandated exclusions under 5.609(b)(22): the latest HUD list found is 89 FR 6126 (Jan. 31, 2024), 29 items.** Items relevant to a Texas scholarship intake (item numbers are the notice's):
- (1) "The value of the allotment provided to an eligible household under the Food Stamp Act of 1977" (SNAP). FRX lines 161-163.
- (5) LIHEAP payments or allowances. FRX lines 183-185.
- (8) Title IV Higher Education Act student aid, "including awards under Federal work-study programs". FRX lines 197-200.
- (9) Older Americans Act Title V payments. FRX lines 213-214.
- (12) Value of child care provided or arranged, or payments/reimbursement for it, under the Child Care and Development Block Grant Act. FRX lines 223-226.
- (13)/(14) EITC refund payments; "any refund (or advance payment with respect to a refundable credit) issued under the Internal Revenue Code is excluded from income and assets for a period of 12 months from receipt". FRX lines 227-245.
- (16) AmeriCorps allowances, earnings and payments. FRX lines 250-252.
- (18) Crime victim compensation (with a full-compensation caveat). FRX lines 258-264.
- (19) WIOA allowances, earnings and payments. FRX lines 265-268.
- (20) "Any amount received under the Richard B. Russell School Lunch Act ... and the Child Nutrition Act of 1966 ..., including reduced-price lunches and food under the Special Supplemental Food Program for Women, Infants, and Children (WIC)." FRX lines 269-273.
- (22) Deferred VA disability benefits received as a lump sum or prospective monthly amounts. FRX lines 277-279.
- (27) Stafford Act disaster assistance and comparable State/local disaster assistance. FRX lines 314-319.
- (28) ABLE account amounts and distributions. FRX lines 320-324.
- (29) Emergency Rental Assistance Program payments. FRX lines 325-332.
- Tribal/Native items: (3), (4), (6), (7), (11), (15), (21), (23), (24), (26). Others: (2) Domestic Volunteer Service Act payments, (10) Agent Orange, (17) spina bifida allowances, (25) individual development accounts.
Whether a newer HUD listing exists: a Federal Register API search on 2026-11-18 for the notice title returned the 2024-01-31 notice as the most recent (`sources/extra/fr/search_mandated_exclusions.json`).
(d) `[HUD official doc]` (Federal Register notice implementing a `[CFR in force: 24 CFR]` provision)
[FC] All item numbers, quotes and FRX line numbers verified; the notice has 29 items. The "most recent" claim is corroborated twice: the fact-checker repeated the Federal Register API search on 2026-11-18 with the same result (`sources/extra/factcheck_hudami/fr_search_exclusions.json`), and HUD's own December 30, 2025 rule refers to "the most recent publication of the Federally Mandated Exclusions from Income (FR-6410-N-01), published on January 31, 2024" (FRC lines 124-128). Caveats the original omitted: the notice says "exclusions (13) and (23) have provisions that apply only to specific HUD programs" (FRX lines 159-160), so item (13) (EITC) is written for named HUD programs (the general 12-month refund exclusion is item (14)), and item (23) is NAHASDA-only; item (8) has a Section 8-only second sentence about students over 23 with dependent children; item (2) (Domestic Volunteer Service Act) stops applying when the payments reach minimum-wage equivalence (FRX lines 164-176). Whether statutory exclusions written for "HUD programs" carry into section 25F is itself only an inference from the proposed rule's cross-reference to 5.609; see Open Question 19.

**F48. Period and annualization: 5.609(c) is written for housing recertification (forward-looking estimate, or previous 12 months adjusted to current); section 25F fixes a different period by statute.**
(a) Under HUD rules, income at initial assistance is an estimate "for the upcoming 12-month period" and at annual reexamination is the "previous 12-month period" adjusted for changes. Section 25F instead looks at "the calendar year prior to the date of the application". Neither the statute nor the proposed regulation says how to annualize partial-year evidence (e.g. a few pay stubs) or whether any of 5.609(c) carries over. NOT IN SOURCES. Engineering consequence: sum actual cash received from January 1 to December 31 of the income year; do not project.
(b) "(1) ... The PHA or owner must estimate the income of the family for the upcoming 12-month period"; "(2) Annual Reexaminations. (i) The PHA or owner must determine the income of the family for the previous 12-month period"; "(iii) The PHA or owner must make adjustments to reflect current income if there was a change in income during the previous 12-month period that was not accounted for in a redetermination of income."
(c) CFR609 lines 72-78; USC line 161.
(d) `[CFR in force: 24 CFR]` + `[statute]`

**F49. 5.609(c)(3): HUD lets housing providers rely on other means-tested programs' income determinations made within the previous 12 months (TANF, Medicaid, SNAP, EITC, LIHTC, WIC, SSI, and others).** This is the HUD analogue of the proposed 25F categorical method, but the lists differ: the proposed 25F list is SNAP, TANF, WIC, Section 8 housing, SSI only (PR lines 5529-5537). Medicaid and EITC are NOT on the proposed 25F list. School-wide free or reduced-price lunch is expressly inadequate (PR lines 1291-1295).
(b) "determine the family's income prior to the application of any deductions applied in accordance with § 5.611 based on income determinations made within the previous 12-month period for purposes of the following means-tested forms of Federal public assistance"; 25F: "an award letter, dated within the last 12 months, confirming that an individual in the student's household currently is approved for assistance from or participation in Supplemental Nutrition Assistance Program (SNAP), Temporary Assistance for Needy Families (TANF), the Special Supplemental Nutrition Program for Women, Infants, and Children (WIC), Section 8 housing, or Supplemental Security Income (SSI))."
(c) CFR609 lines 79-90; PR lines 5529-5537.
(d) `[CFR in force: 24 CFR]` + `[proposed-reg: not final]`

**F50. 5.609(c)(4) de minimis error: $30 per month ($360 per year).** This is a HUD compliance tolerance for housing providers. Nothing in the 25F sources adopts a tolerance; do not build one in.
(b) "A de minimis error is an error where the PHA or owner determination of family income deviates from the correct income determination by no more than $30 per month in monthly adjusted income ($360 in annual adjusted income) per family."
(c) CFR609 line 91.
(d) `[CFR in force: 24 CFR]`

**F51. Net family assets and imputed returns (what the 25F rule disregards) versus actual asset income (still counted).**
(a) HUD: net family assets = net cash value of all assets after disposal costs, with exclusions (necessary personal property; non-necessary personal property up to $50,000 combined; retirement accounts; Coverdell/529/ABLE/baby-bond accounts; real property the family cannot legally sell; certain trusts; tax refunds for 12 months; etc.). Imputed income arises only if net family assets exceed $50,000 (CPI-adjusted) and actual income from a specific asset cannot be calculated; it equals asset value x the HUD passbook rate. The proposed 25F rule removes imputed returns entirely, so the intake form does not need asset VALUES. But actual returns paid in cash (interest, dividends, rents) remain "amounts ... received from all sources" under 5.609(a)(1) and are not disregarded by the proposed rule.
(b) Reg: "Net family assets is the net cash value of all assets owned by the family, after deducting reasonable costs that would be incurred in disposing real property, savings, stocks, bonds, and other forms of capital investment." HUD guidance: "Actual income from assets is always included in a family's annual income, regardless of the total value of net family assets"; "Income or returns from assets are generally considered to be interest, dividend payments, and other actual income earned on the asset, and not the increase in market value of the asset."
(c) CFR603 lines 27-41; CFR609 lines 4, 6; HN lines 3051-3058, 3105-3131; PR lines 5515-5517.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]` + `[proposed-reg: not final]`

**F52. Minors.**
(a) Earned income of children under 18 is excluded. Unearned income by or on behalf of a dependent under 18 is included (for example a child's Social Security survivor benefit or SSI, or child support received for the child). Exception: a person under 18 who is the head of household or the head's spouse has all income included.
(b) "(3) Earned income of children under the 18 years of age."; "plus unearned income by or on behalf of each dependent who is under 18 years of age"; HUD guidance: "All amounts received by the head of household, co-head, or spouse ... are included in annual income regardless of age, unless otherwise excluded".
(c) CFR609 lines 3, 12; HN lines 2395-2398 ([FC] corrected from 2393-2397).
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`
[FC] The examples in (a) (a child's Social Security or SSI, child support received for a child) are the author's illustrations of "unearned income", consistent with the 5.100 definitions in F45; they are not quoted from a source. "Co-head" appears only in the HUD guidance notice, not in 5.609.

**F53. Students.**
(a) Adult (18+) dependent full-time students who are not head/spouse/co-head: only the first $480 (CPI-adjusted annually; current-year figure NOT IN SOURCES, see F58) of each student's earned income is counted; the rest is excluded. Higher-education financial aid is excluded per 5.609(b)(9) up to actual covered costs; Title IV aid including Federal work-study is excluded by statute. Fee-for-service aid not covered by section 479B (e.g. non-Federal work study, teaching fellowship) and aid above covered costs are income.
(b) "(14) Earned income of dependent full-time students in excess of the amount of the deduction for a dependent in § 5.611."; HUD guidance: "This exclusion does not apply to the head of household, spouse, or co-head. This means that the first $480 of the income earned by dependent full-time students will be included in the family's calculation of annual income."
(c) CFR609 lines 18-40, 48; CFR611 line 3; HN lines 3552-3564; FRX lines 197-200.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`

**F54. Self-employment and business income.**
(a) Count NET income only: gross receipts minus business expenses. No deduction for business expansion or for amortization (principal repayment) of capital debt. Depreciation is deductible only on a straight-line basis. Withdrawals of cash or assets from the business are income unless they reimburse capital the family invested. Independent contractor, day laborer, gig and seasonal income can never be excluded as "nonrecurring". Treatment of a net LOSS (can it offset other income?) is NOT stated in 5.609.
(b) "(i) Net income from the operation of a business or profession. Expenditures for business expansion or amortization of capital indebtedness shall not be used as deductions in determining net income. An allowance for depreciation of assets used in a business or profession may be deducted, based on straight line depreciation, as provided in Internal Revenue Service regulations; and (ii) Any withdrawal of cash or assets from the operation of a business or profession will be included in income, except to the extent the withdrawal is reimbursement of cash or assets invested in the operation by the family."
(c) CFR609 lines 58, 69-71; HN lines 4125-4141 ("Net income is the "gross income amount minus business expenses" that allows the business to operate.").
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`

**F55. Child support and alimony.**
(a) Counted, including amounts that are not taxable (proposed 25F rule says so expressly). Count amounts actually received during the income year, not court-ordered amounts that were not paid. There is no deduction for child support or alimony PAID. If the payer's wages are garnished to pay support, the payer's income is counted gross.
(b) 25F: "This definition includes receipts by a member of the household in the form of child support and alimony not included in taxable income". HUD guidance: "Annual income includes "all amounts received," not the amount that a family may be legally entitled to receive but did not. For example, a family's child-support or alimony income must be based on payments received ... when a family member's wages or benefits are garnished, levied, or withheld[footnote F1] to pay restitution, child support, tax debt, student loan debt, or other applicable debts, PHAs/MFH Owners must use the gross amount of the income, prior to the reduction".
(c) PR lines 5518-5520; CFR609 line 3; HN lines 2399-2407.
(d) `[proposed-reg: not final]` + `[HUD guidance notice]`

**F56. Lump sums and nonrecurring income.**
(a) Excluded: lump-sum additions to assets (lottery and contest winnings and similar one-time receipts), insurance settlements, tax refunds and refundable credits, stimulus payments, occasion gifts, deferred SSI/Social Security/VA disability back pay, civil-rights settlements including back pay, disability-causing injury settlements, loan proceeds. HUD guidance treats a one-time crowdfunding receipt as a lump-sum addition to assets but a repeated pattern as income. The nonrecurring test in 5.609(b)(24) is worded prospectively ("will not be repeated in the coming year based on information provided by the family"); how to apply it to a completed prior calendar year under 25F is NOT IN SOURCES. HUD guidance says unemployment benefits and other periodic payments are not "nonrecurring".
(b) "(vii) Lump-sum additions to net family assets, including but not limited to lottery or other contest winnings."; HUD guidance: "This does not include unemployment income and other types of periodic payments that are received at regular intervals"; "PHAs/MFH Owners may accept a self-certification from the family stating that the income will not be repeated in the coming year."
(c) CFR609 lines 14, 16, 50, 54, 58-66; HN lines 3329-3339, 3370-3371, 3472-3491.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`
[FC] Verified. The unemployment quote was truncated; the full sentence is: "This does not include unemployment income and other types of periodic payments that are received at regular intervals (such as weekly, monthly, or yearly) for a period of greater than one year that can be extended." (HN lines 3337-3339). HUD's guidance also frames the test as income that "will not be repeated beyond the coming year (i.e., the 12 months following the effective date of the certification)" (HN lines 3329-3331) and gives further examples of excluded nonrecurring amounts: "nonrecurring payments made to the family or to a third party on behalf of the family to assist with utilities, eviction prevention, security deposits to secure housing, payments for participation in research studies depending on the duration, and general one-time payments received by or on behalf of the family" (HN lines 3350-3354). All of this is HUD sub-regulatory guidance written for a forward-looking housing certification; none of it is addressed to section 25F.

**F57. SNAP and other non-cash benefits.**
(a) SNAP, WIC, school-lunch benefits, LIHEAP, child-care subsidies and housing assistance are not counted: they are non-cash (proposed 25F rule excludes "non-cash receipts"; preamble names the Section 8 housing allowance) and SNAP/WIC/school lunch/LIHEAP/CCDBG are also excluded from HUD annual income by Federal statute. Health coverage and medical reimbursements are excluded by 5.609(b)(5)-(6). SNAP, TANF, WIC, Section 8 and SSI participation are simultaneously categorical-eligibility triggers (F49).
(b) See F41, F42, F47.
(c) PR lines 1225-1227, 5518-5520; FRX lines 161-163, 183-185, 223-226, 269-273; CFR609 lines 14-15.
(d) `[proposed-reg: not final]` + `[HUD official doc]`

**F58. Inflation-indexed amounts inside 5.609: base values are in the CFR; the adjusted values for 2025 and 2026 are NOT IN SOURCES.**
(a) Two amounts matter to the income calculator: (i) the dependent deduction amount used as the cap in 5.609(b)(14) and (b)(15): "$480 ... adjusted by HUD annually ... rounded to the next lowest multiple of $25"; HUD guidance says $480 was the amount effective 1/1/2024 and that adjusted values take effect each January 1 and are posted on HUD User (which blocked plain requests). (ii) the $50,000 asset threshold, irrelevant once imputed returns are disregarded. Make (i) a dated configuration value and route affected households to review until the current figure is confirmed.
(b) "(1) $480 for each dependent, which amount will be adjusted by HUD annually in accordance with the Consumer Price Index for Urban Wage Earners and Clerical Workers, rounded to the next lowest multiple of $25"; HUD: "HUD will annually publish the eight inflation-adjusted items in the table below no later than September 1 ... The revised amounts will be effective on January 1 of the following year. The first set of adjustments for inflation will be made effective January 1, 2025."
(c) CFR611 line 3; HN lines 4220-4225 and Table H1 (lines 4228-4372).
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`

**F59. No deductions. Section 25F uses "annual income" (5.609), not "adjusted income" (5.611).**
(a) The dependent, elderly/disabled, medical, disability-assistance and child-care deductions in 5.611 produce "adjusted income" used for rent; the proposed 25F rule points only to 5.609. Do not subtract any of them. (The $480 figure matters only as the cap in F53/F58.)
(b) "Adjusted income means annual income (as determined under § 5.609) ... after making the following deductions"; 25F: "the term household income means annual income, as defined in 24 CFR 5.609".
(c) CFR611 line 2; PR lines 5514-5515.
(d) `[CFR in force: 24 CFR]` + `[proposed-reg: not final]`

**F60. Workers' compensation is excluded; unemployment compensation is counted.**
(b) 5.609(b)(5) lists "workers' compensation" among excluded insurance payments; HUD guidance: "Any workers' compensation is always excluded from annual income, regardless of the frequency or length of the payments." Unemployment is not in the exclusion list and HUD guidance says it is not nonrecurring income.
(c) CFR609 line 14; HN lines 3515-3520, 3337-3339.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`
[FC] Verified. Precision on unemployment: it is counted because 5.609(a)(1) includes "All amounts, not specifically excluded in paragraph (b) of this section, received from all sources" and no paragraph (b) item names unemployment compensation. The HUD guidance sentence (quoted in full under F56) says only that unemployment income is not excluded as "nonrecurring"; it is support, not the legal basis.

**F61. Retirement accounts and pensions.**
(a) Earnings inside IRS-recognized retirement accounts are not income; periodic distributions are income when received. A non-periodic (one-off) withdrawal is not described as income by the regulation text; treat as needs-review. Pensions, annuities, Social Security, VA pension/disability and similar periodic benefits are not in the exclusion list and are counted.
(b) "except that any distribution of periodic payments from such accounts shall be income at the time they are received by the family"; HUD: "many types of VA income, including the Veterans Pension and the VA Survivors Pension, are included in annual income."
(c) CFR609 line 67; HN lines 2942-2960, 3585-3588.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]`

**F62. "Household" for 25F is wider than HUD's "family", and 5.609(b)(8) excludes the income of live-in aides and foster children/adults.**
(a) Proposed 25F family size counts every person residing with the student. 5.609 counts income of "each member of the family" and excludes income of a live-in aide, foster child or foster adult; HUD guidance says foster children/adults "are not considered family members and must not be included in calculations of income" but are household members for unit size. How these interact for 25F (does a live-in aide or foster child count toward family size while their income is excluded? is an unrelated roommate's income counted?) is not addressed by the proposed rule. See Open Question 9.
(b) "(8) Income of a live-in aide, foster child, or foster adult as defined in §§ 5.403 and 5.603, respectively."; HUD: "Foster adults/children are not considered family members and must not be included in calculations of income for eligibility and rent determination purposes. However, foster adults/children are considered household members".
(c) CFR609 line 17; HN lines 2305-2308; PR lines 5500-5503.
(d) `[CFR in force: 24 CFR]` + `[HUD guidance notice]` + `[proposed-reg: not final]`

**F63. Direct verification evidence must cover income that tax documents do not show, or include a certification that there is none.**
(a) The intake must capture non-taxable/unreported cash income (child support, alimony, and by extension other cash items in the table below) or a signed statement that there is none.
(b) "income may be verified through review of written documentation including pay stubs, prior-year Federal or State tax returns, IRS transcripts, Forms W-2, evidence of other income not reflected on such documents (such as evidence of child support and alimony not reported as income) or a certification that there is none, or may be verified through other relevant data sources."
(c) PR lines 5521-5528 (Prop. Reg. 1.25F-3(c)(6)(iii)(A)).
(d) `[proposed-reg: not final]`

**F64. SGO scholarships themselves are excluded from Federal gross income (section 139K), which is a tax rule, not a 5.609 rule.**
(a) Whether a K-12 scholarship received in the income year counts as 5.609 annual income is not addressed; 5.609(b)(9) covers only higher-education aid. If paid to a school or vendor it is not cash received by a household member. Mark needs-review.
(b) "section 139K ... excludes from the gross income of individuals or their dependents any amounts received after December 31, 2026, pursuant to SGO-provided scholarships for qualified elementary or secondary education expenses of eligible students."
(c) PR lines 186-191.
(d) `[preamble/economic-analysis]`

### PART D. Facts added by the fact-checker [FC] (material the original omitted)

**F65. The statutory chain behind "area median gross income (as such term is used in section 42)": section 42(g)(4) -> section 142(d)(2)(B)(i) -> Section 8.**
(a) Section 25F(c)(2)(A) borrows the section 42 term. Section 42(g)(4) applies section 142(d)(2) (other than its subparagraph (A)) to low-income housing credit projects. Section 142(d)(2)(B)(i) says income and AMGI are determined "in a manner consistent with" Section 8 determinations "of lower income families and area median gross income", and must include family-size adjustments. The Code therefore requires consistency with Section 8 and a family-size adjustment; it does not itself give a number, a multiplier table, or a product formula. Those come only from HUD practice and from Treasury's economic analysis (F29, F30).
(b) Section 142(d)(2)(B)(i): "The income of individuals and area median gross income shall be determined by the Secretary in a manner consistent with determinations of lower income families and area median gross income under section 8 of the United States Housing Act of 1937 (or, if such program is terminated, under such program as in effect immediately before such termination). Determinations under the preceding sentence shall include adjustments for family size." Section 42(g)(4): "Paragraphs (2) (other than subparagraph (A) thereof), (3), (4), (5), (6), and (7) of section 142(d), and section 6652(j), shall apply for purposes of determining whether any project is a qualified low-income housing project and whether any unit is a low-income unit". Preamble: "Proposed Sec. 1.25F-3(c)(6) would define area median gross income in a manner consistent with the rules applicable to section 42."
(c) USC142 line 269; USC42 line 694. Treasury quotes the same two provisions at PR lines 2731-2747; preamble walk-through at PR lines 1175-1189.
(d) `[statute]` for the two Code provisions; `[preamble/economic-analysis]` for the PR passages.

**F66. Section 142(d)(2)(E) adds a "hold harmless" rule for section 42/142 PROJECTS (AMGI for a project cannot go down year to year). This is the 2008 change that makes HUD publish separate MTSP limits (F8). Section 25F has no "project".**
(a) Under section 42, AMGI "with respect to any project" for a calendar year after 2008 cannot be less than the prior year's figure for that project. The rule is written per project. Whether anything like it applies to a household-level test under section 25F is NOT IN SOURCES. Practical consequence: MTSP figures can be equal to or higher than Section 8 figures for the same area, so a table built from the Section 8 workbook could be lower than a table built from MTSP data (which Treasury cites, F37). Not testable here: the MTSP file is not in the sources.
(b) "Any determination of area median gross income under subparagraph (B) with respect to any project for any calendar year after 2008 shall not be less than the area median gross income determined under such subparagraph with respect to such project for the calendar year preceding the calendar year for which such determination is made." Effective-date note: "The amendment made by this section [amending this section] shall apply to determinations of area median gross income for calendar years after 2008." (Pub. L. 110-289, section 3009(b)).
(c) USC142 lines 294-297 and 1092-1093. HUD's page attributes the separate MTSP publication to "the Housing and Economic Recovery Act of 2008 (Public Law 110-289)": ILH raw line 626.
(d) `[statute]` + `[HUD official doc]`

**F67. Section 8 "determinations of lower income families" (the phrase used in section 142(d)(2)(B)(i), F65) are HUD's adjusted income limits, not a bare percentage of the median. Nationally only 1,042 of 2,635 HUD areas have a FY 2026 very-low-income limit that is simply 50% of the local median.**
(a) This is the strongest source-based reason to keep Formula B (6 x `l50_n`, F38) alive as a candidate: the 1937 Act definition of "very low-income families" (the Section 8 determination that section 142(d)(2)(B) points to) lets HUD set ceilings "higher or lower than 50 per centum of the median", and HUD does so for most areas. HUD's own count for FY 2026: limits "based on 50% of local median family income" = 667 nonmetropolitan counties + 375 metropolitan areas = 1,042, out of 1,960 + 675 = 2,635 areas (2,635 equals the number of unique `hud_area_code` values in the workbook, F11). The remainder were set at the State nonmetropolitan level (1,114 + 120), raised for high housing cost (17 + 35), lowered (1 + 0), floored (50 + 35) or capped (111 + 110).
(b) 1937 Act section 3(b)(2)(B) as reproduced by HUD: "The term "very low-income families" means lower income families whose incomes do not exceed 50 per centum of the median family income for the area, as determined by the Secretary with adjustments for smaller and larger families, except that the Secretary may establish income ceilings higher or lower than 50 per centum of the median for the area on the basis of the Secretary's findings that such variations are necessary because of unusually high or low family incomes." HUD Table 1 rows: "Limits based on 50% of local median family income 667 375"; "TOTALS 1,960 675".
(c) ILM lines 501-505 (Attachment 2 statutory excerpt); ILM lines 108-135 (Table 1). Same definition in HUD's regulation: CFR603 line 52.
(d) `[HUD official doc]` (HUD's reproduction of the statute and HUD's own counts) + `[CFR in force: 24 CFR]`. What this implies for the IRS table is inference; NOT IN SOURCES which reading the IRS will adopt.

**F68. The proposed regulations are not in force, but Treasury says taxpayers, organizations (SGOs) and States "may rely" on them for contributions made on or after January 1, 2027, if they follow the applicable portions "in their entirety and in a consistent manner".**
(a) This is the legal basis for building to the proposed text now. It is conditional: an SGO relying on the proposed rules must follow all of the portions applicable to it, consistently; cherry-picking (for example using the cash-only income definition but ignoring another SGO requirement) is outside the reliance statement. The proposed regulations themselves would apply to taxable years ending on or after the date final regulations are published. Reliance is stated in the preamble, not in the regulation text.
(b) "Each of proposed Sec. Sec. 1.25F-1 through 1.25F-5 is proposed to apply to taxable years ending on or after the date on which the Treasury decision adopting these regulations as final regulations is published in the Federal Register. Taxpayers, organizations, and States may rely on these proposed regulations for qualified contributions made on or after January 1, 2027, in taxable years ending before the date the Treasury decision adopting these regulations as final regulations is published in the Federal Register, provided that taxpayers, organizations, and States follow the portions of the proposed regulations applicable to each in their entirety and in a consistent manner."
(c) PR lines 2401-2413 ("VI. Proposed Applicability Date"); regulation-text applicability paragraphs at PR lines 5011-5013 (1.25F-1(b)) and 5783-5785 (1.25F-3(e)).
(d) `[preamble/economic-analysis]` describing `[proposed-reg: not final]` text.

**F69. Treasury describes income and family size as an "annual" determination, and eligibility as tested "as of the time when the scholarship is paid".**
(a) A verification is not good forever. The preamble (in the discussion of multi-year awards) says the statute requires an annual determination of household income and family size and that the recipient be an eligible student "in each case as of the time when the scholarship is paid". Combined with the statutory income year (calendar year before the application date, F35), this means: store the application date, the income year, and the verification date on every decision; give decisions an expiry; do not reuse last year's decision for a new award year without a new determination. The exact re-verification rule (how often, and which date controls when the application and the payment fall in different years) is not spelled out in the regulation text for this topic: NOT IN SOURCES beyond this sentence. See Open Question 20.
(b) "This is consistent with the annual accounting and eligibility principles reflected in the statutory requirements of section 25F, including the requirement that the SGO determine the ``annual'' household income and family size of eligible students and that the scholarship recipient be an eligible student located in the State, in each case as of the time when the scholarship is paid."
(c) PR lines 1028-1034 (preamble, "3. Accounting for the 90 Percent of Income Spending Requirement").
(d) `[preamble/economic-analysis]`

**F70. Treasury's own modelling of the definitions (context for copy and for sizing the review queue).**
(a) Treasury estimates that with HUD multipliers, a household (not tax-unit) definition and cash-only income, 95% of children in electing States are income-eligible (96% with the safe harbors); under the unmodified HUD income definition (with imputed asset returns) it would be 64%. So the imputed-return carve-out is the single most consequential modelling choice, and a homeowner family must not be asked for asset values. Internal inconsistency to be aware of: the economic analysis says imputation applies when net assets are "$50,000 or more"; the regulation it describes says "exceeds $50,000" (F44). Irrelevant in practice once imputed returns are disregarded.
(b) "under the strict HUD definition, 64 percent of elementary and secondary school age children would be expected to be eligible to receive a scholarship, compared to the 95 percent of children expected to be eligible as a result of the exclusion of non-cash income provided in the proposed regulations."; "When a family holds net assets of $50,000 or more, and the actual returns of this asset cannot be calculated, the HUD definition of annual income imputes returns on this asset based on the current passbook savings rate."; Table 2 row: "HUD family size multipliers ... Household ... Cash only ... None ... 95".
(c) PR lines 2836-2844, 2808-2811, 3087-3105 (Table 2, whose note limits the denominator to States with advance elections "as of July 2026"). Also PR lines 1227-1231 ("approximately 95 percent of the children in the United States are in households with income below the 300 percent of area median gross income limit").
(d) `[preamble/economic-analysis]`

**F71. Three proposed paths never reach the AMI comparison at all: the categorical method and the two safe harbors.**
(a) The AMI engine is only needed for the direct income verification method. Under the proposed text an SGO "must use one or more of the methods" in paragraph (c)(6)(iii): direct verification (F63), categorical eligibility (F49), the low-income-area tutoring/special-needs safe harbor (school in a HUD qualified census tract, or school certifies at least 80 percent of its students reside in one; requires an annual third-party audit provided to the State), and the foster-child safe harbor. Under both safe harbors the student is treated as meeting the income requirement "whether or not the student's household income is verified". The product spec puts the two safe harbors out of scope for v1; the decision record should still be able to carry a `method` other than direct/categorical later.
(b) "An SGO must use one or more of the methods described in paragraph (c)(6)(iii) of this section to verify that a scholarship recipient is an eligible student who satisfies this household income requirement."; "(D) Safe harbor for foster children. An eligible student who is a foster child will be treated as satisfying the requirements in section 25F(c)(2)(A) and Sec. 1.25F-1(a)(4)(i)(A), whether or not the student's household income is verified."
(c) PR lines 5485-5493, 5538-5575; preamble PR lines 1257-1269, 1299-1318.
(d) `[proposed-reg: not final]`

**F72. 24 CFR 5.615 "imputed welfare income" (retrieved by the fact-checker; the original could not fetch it) is outside 5.609 and is by definition income "not actually received".**
(a) It applies only to "covered families who reside in public housing ... or receive Section 8 tenant-based assistance" whose welfare benefit was reduced for fraud or for non-compliance with a self-sufficiency requirement. It is added to annual income by 5.615 itself, not by 5.609, which is the only section the proposed 25F rule cites; and it is not cash received. Do not model it.
(b) "Imputed welfare income. The amount of annual income not actually received by a family, as a result of a specified welfare benefit reduction, that is nonetheless included in the family's annual income for purposes of determining rent."; "A family's annual income includes the amount of imputed welfare income ..., plus the total amount of other annual income as determined in accordance with § 5.609."
(c) CFR615 lines 2, 6, 13.
(d) `[CFR in force: 24 CFR]`; its irrelevance to 25F is inference from `[proposed-reg: not final]` text (F41).

**F73. The proposed rule's example of an "imputed return" (unrealized appreciation) is not what HUD's regulation imputes. Both are out; actual cash returns stay in.**
(a) HUD's 5.609(a)(2) imputation is the asset's value multiplied by the HUD passbook savings rate (paraphrase; exact words in (b)), for assets whose actual return cannot be calculated; HUD guidance says an increase in market value is not income at all. The proposed 25F text describes the disregarded item as "the imputed return on net assets (for example, unrealized appreciation in a home or stock)", and the preamble says the HUD definition "includes certain items not received in the form of cash, including unrealized appreciation in a home". For the calculator the result is the same under either description: never count passbook-rate imputation, never count unrealized appreciation, always count interest, dividends and other returns actually paid in cash (F51). Do not copy the proposed rule's example into user-facing copy as a description of HUD's rule.
(b) PR: "must be determined by disregarding the imputed return on net assets (for example, unrealized appreciation in a home or stock)"; "Thus, the definition includes certain items not received in the form of cash, including unrealized appreciation in a home." HUD: "imputed returns on the asset based on the current passbook savings rate"; "Income or returns from assets are generally considered to be interest, dividend payments, and other actual income earned on the asset, and not the increase in market value of the asset. The increase in market value is relevant to the cash value of the asset for the purpose of determining total net family assets and imputing income."
(c) PR lines 5515-5517, 1214-1215; CFR609 line 4; HN lines 3055-3059.
(d) `[proposed-reg: not final]` + `[preamble/economic-analysis]` + `[CFR in force: 24 CFR]` + `[HUD guidance notice]`

---

## INCOME CATEGORY TABLE (for the intake form and the income calculator)

How to read: `counted` is one of `yes` (add the cash amount received in the income year), `no` (never add), `partial` (deterministic split stated in Notes), `needs-review` (sources do not settle it, or facts are needed; route to a human and see the two-bound rule in Engineering Implication 9). "Basis" cites 24 CFR 5.609 paragraphs (in force, HUD) and the proposed 25F regulation (not final). Unless noted, "who" = every household member aged 18+ plus the head of household/spouse of any age.

[FC] Fact-check notes on this table (all rows were re-read against CFR609, FRX, HN and PR):
- Legal status of the whole table: 24 CFR 5.609 applies to section 25F ONLY because the PROPOSED regulation (Prop. Reg. 1.25F-3(c)(6)(ii)(C), F41) says so. Every row is therefore "proposed-rule treatment", even where the Basis column cites only an in-force HUD paragraph. Version the table and label it proposed.
- One row uses the extra value `yes (amount basis needs-review)` (`rental_income_net`): the item is counted, but the sources do not say whether gross or net.
- Rows whose `no` rests only on the proposed rule's phrase "excludes non-cash receipts" (`employer_noncash_benefits`, `housing_assistance`, the in-kind part of `military_pay_cash`, the non-cash part of `health_coverage`) are applications of that phrase by the author; the proposed rule and preamble name only "a Section 8 housing allowance", "any imputed return on assets" and "other items not received in cash" (PR lines 1224-1227).
- Rows citing "89 FR 6126 item (n)" rely on 5.609(b)(22), a HUD-program exclusion list; that it carries into section 25F is an inference from the cross-reference (Open Question 19). Most of those items are also non-cash, which gives an independent proposed-rule basis; the cash ones (for example LIHEAP paid in cash, AmeriCorps/WIOA allowances, crime-victim compensation, disaster assistance) rest on the inference alone.
- HUD guidance notice (HN) citations are sub-regulatory HUD guidance for housing providers. They are persuasive for reading 5.609 and are not IRS guidance.

### A. Earned income

| key | Category | counted | Basis | Notes |
|---|---|---|---|---|
| `wages_salary` | Wages and salaries | yes | 5.609(a)(1); 5.100 "earned income" | Gross before garnishments/levies (HN 2403-2407). Whether to add back pre-tax payroll deductions (401(k) deferrals, cafeteria-plan premiums) and which W-2 box to use: NOT IN SOURCES. Store the figure used and its document field. |
| `tips_commissions_bonuses_overtime` | Tips, commissions, bonuses, overtime, other employee compensation | yes | 5.609(a)(1); 5.100 | A family may assert a one-time payment is nonrecurring under (b)(24); that claim is needs-review. |
| `self_employment_net` | Net income from self-employment, business or profession (Schedule C style) | yes | 5.609(b)(28)(i) | Net = gross receipts minus operating expenses; straight-line depreciation only; no deduction for expansion or debt principal. Tax-return net profit may use accelerated depreciation, so flag if depreciation is material. Net loss: NOT IN SOURCES; do not offset other income without counsel sign-off (needs-review). |
| `gig_contractor_daylabor_seasonal` | Independent contractor, gig, day-labor, seasonal income | yes | 5.609(a)(1); (b)(24) second sentence; 5.603 definitions | Can never be excluded as nonrecurring. Net of business expenses if self-employed. |
| `business_withdrawals` | Owner draws / withdrawals of cash or assets from a business | needs-review | 5.609(b)(28)(ii) | Income unless reimbursing capital the family invested. Needs facts. |
| `minor_earned_income` | Earned income of a child under 18 (not head/spouse) | no | 5.609(b)(3) | |
| `minor_head_or_spouse_income` | Any income of a person under 18 who is head of household or the head's spouse | yes | 5.609(a)(1) | Rare; flag for review. |
| `dependent_ft_student_earned` | Earned income of a dependent full-time student aged 18+ (not head/spouse/co-head) | partial | 5.609(b)(14); 5.611(a)(1) | Count min(earnings, dependent-deduction amount) per student. Base amount $480 (effective 1/1/2024); current-year adjusted amount NOT IN SOURCES, keep as dated config. |
| `military_pay_cash` | Armed Forces pay and cash allowances | yes | 5.609(a)(1) (not excluded) | Housing or subsistence provided in kind is non-cash: no (25F proposed rule). |
| `military_hostile_fire_pay` | Special pay for exposure to hostile fire | no | 5.609(b)(11) | |
| `census_temp_employment` | Census Bureau temporary employment (180 days or less, not leading to permanent job) | no | 5.609(b)(24)(i) | |
| `training_program_earnings` | Incremental earnings/benefits from qualifying employment-training programs; AmeriCorps; WIOA; Older Americans Act Title V; Domestic Volunteer Service Act payments | no | 5.609(b)(12)(iv); (b)(22) with 89 FR 6126 items (2), (9), (16), (19) | Needs program identification; if unclear, needs-review. |
| `live_in_aide_income` | Income of a live-in aide | no | 5.609(b)(8) | Whether the aide counts toward 25F family size: unsettled (OQ 9). |
| `foster_member_income` | Income of a foster child or foster adult | no | 5.609(b)(8) | Foster-child students have a separate proposed safe harbor (PR 5572-5575). |
| `medicaid_caregiver_payments` | State Medicaid (or other agency) payments to a family member for caring for a household member with a disability at home | needs-review | 5.609(b)(19) | Excluded in HUD programs; text refers to the "assisted unit". Likely no; confirm. |

### B. Benefits and other periodic cash

| key | Category | counted | Basis | Notes |
|---|---|---|---|---|
| `social_security` | Social Security retirement, survivors, disability (including a child's benefit) | yes | 5.609(a)(1) | Use gross benefit (gross before garnishment per HN 2403-2407; treatment of Medicare premium deductions NOT IN SOURCES). |
| `ss_ssi_va_lump_sum_backpay` | Deferred SSI / Social Security / VA disability amounts paid as a lump sum or prospective monthly catch-up | no | 5.609(b)(16); 89 FR 6126 item (22) | |
| `ssi` | Supplemental Security Income (regular monthly) | yes | 5.609(a)(1) | PASS set-asides excluded, (b)(12)(i). SSI approval is also a categorical trigger. |
| `tanf_cash` | TANF / cash welfare assistance | yes | 5.609(a)(1); 5.603 "welfare assistance" | Cash paid, including via EBT cash. Also a categorical trigger. HUD "imputed welfare income" is not counted: it lives in 5.615, not 5.609, applies only to public-housing / Section 8 tenant-based families, and is by definition "not actually received" (F72) ([FC] 5.615 now retrieved). |
| `unemployment` | Unemployment compensation | yes | 5.609(a)(1); HN 3337-3339 | |
| `workers_comp` | Workers' compensation | no | 5.609(b)(5); HN 3518-3520 | Excluded regardless of frequency. |
| `disability_insurance_private` | Private short/long-term disability insurance benefits | needs-review | 5.609(b)(5) ("insurance payments ... for personal ... losses") vs (a)(1) | Not addressed specifically. |
| `pension_annuity` | Pensions and annuities | yes | 5.609(a)(1) | |
| `retirement_periodic_distributions` | Periodic distributions from IRA / 401(k) / other retirement plans | yes | 5.609(b)(26) proviso | |
| `retirement_lump_sum_withdrawal` | One-off (non-periodic) retirement account withdrawal | needs-review | 5.609(b)(26) | Text makes only "periodic payments" income. |
| `va_compensation_pension` | VA disability compensation, Veterans Pension, Survivors Pension (regular payments) | yes | 5.609(a)(1); HN 3585-3588 | [FC] The HUD guidance names "the Veterans Pension and the VA Survivors Pension" as included. Regular VA disability compensation is not named there; it is counted because no 5.609(b) item excludes it (only DEFERRED VA disability amounts paid as a lump sum or prospective monthly catch-up are excluded, (b)(16)). |
| `va_aid_and_attendance` | VA aid and attendance payments to a veteran (38 U.S.C. 1521) | no | 5.609(b)(17) | Applies to the veteran only, not survivors (HN 3579-3582). |
| `child_support_received` | Child support actually received | yes | 5.609(a)(1); Prop. Reg. 1.25F-3(c)(6)(ii)(C) | Amount received in the income year, not the ordered amount. Counted even though not taxable. |
| `alimony_received` | Alimony / spousal maintenance actually received | yes | same | Counted whether or not taxable. |
| `support_paid` | Child support or alimony PAID by a household member | no deduction | 5.609 has none; deductions exist only in 5.611 | Do not subtract. |
| `regular_contributions_from_outside` | Recurring cash support or gifts from persons outside the household | needs-review | 5.609(a)(1) ("all amounts ... from all sources") vs (b)(24)(v) | Occasion gifts are excluded; recurring support is not listed as excluded. [FC] Because 5.609(a)(1) includes "All amounts, not specifically excluded in paragraph (b) of this section", the default reading is INCLUDED; needs-review only because neither 5.609 nor the HUD notice names this item. Keep it in the upper bound. |
| `adoption_assistance` | Adoption assistance payments | partial | 5.609(b)(15); 5.611(a)(1) | Count min(payments, dependent-deduction amount) per adopted child; excess excluded. Same config value as above. |
| `foster_kinship_payments` | Foster care payments; State or Tribal kinship or guardianship care payments | no | 5.609(b)(4) | |
| `guaranteed_income_pilot` | Guaranteed-income pilot payments, research stipends | needs-review | 5.609(b)(24); HN 3340-3349 | HUD treats by program end date (prospective). |
| `severance_strike_other` | Severance pay, strike benefits, other cash not listed elsewhere | needs-review | 5.609(a)(1) default inclusion vs (b)(24) | Default rule is inclusion unless a (b) exclusion applies. |

### C. Assets and investment income

| key | Category | counted | Basis | Notes |
|---|---|---|---|---|
| `interest_dividends` | Interest and dividends actually paid (taxable or tax-exempt) | yes | 5.609(a)(1); HN 3051-3058 | Actual cash returns only. |
| `rental_income_net` | Rental income from real property | yes (amount basis needs-review) | 5.609(a)(1); (b)(28) if run as a business | [FC] Corrected: the current text of 5.609 never mentions rental income, and the HUD notice mentions it only inside a trust example (HN 2795). It is counted because it is an amount received that no (b) item excludes. "NET" is supported only where the rental is the "operation of a business" under (b)(28) (gross excluded, net counted, straight-line depreciation only). For a casual landlord, whether expenses may be subtracted is NOT IN SOURCES: use net in the lower bound and gross rents in the upper bound. Flag if a tax-return figure relies on accelerated depreciation. |
| `imputed_asset_return` | Imputed return on net family assets (passbook-rate imputation) | no | Prop. Reg. 1.25F-3(c)(6)(ii)(C); otherwise 5.609(a)(2) | Do not collect asset values for this purpose. |
| `unrealized_appreciation` | Unrealized appreciation in a home, stock, or other asset | no | Prop. Reg. 1.25F-3(c)(6)(ii)(C) | |
| `realized_capital_gains` | Realized gains on sale of stock, home, or other assets | needs-review | Not addressed in 5.609; HN 3055-3058; (b)(24)(vii) | HUD treats returns as interest/dividends "and not the increase in market value". Do not auto-add Schedule D amounts. |
| `retirement_account_internal_earnings` | Earnings accumulating inside IRA/401(k) | no | 5.609(b)(26) | |
| `education_savings_income` | Coverdell / 529 / baby-bond income and distributions; ABLE; FSS account income | no | 5.609(b)(10), (b)(27); 89 FR 6126 item (28) | |
| `trust_distributions` | Trust distributions | needs-review | 5.609(b)(2) | Principal: no. Irrevocable-trust income distributions: yes (except for a minor's medical costs). Revocable trust under family control: distributions no, but the trust's actual income is counted when earned. |

### D. One-time and lump-sum receipts

| key | Category | counted | Basis | Notes |
|---|---|---|---|---|
| `tax_refunds_credits` | Federal/State tax refunds and refundable credits (EITC, CTC, etc.) | no | 5.609(b)(24)(iii)-(iv); 89 FR 6126 items (13), (14) | |
| `stimulus_recovery` | Federal or State economic stimulus / recovery payments | no | 5.609(b)(24)(ii) | |
| `lottery_inheritance_lump_sum` | Lottery or contest winnings, inheritance, other one-time lump-sum additions to assets | no | 5.609(b)(24)(vii) | Lottery and contest winnings are named in the regulation. [FC] "Inheritance" is NOT named anywhere in 5.609 or in the HUD notice; treating it as excluded is an inference from "Lump-sum additions to net family assets, including but not limited to" and from HUD's guidance that "general one-time payments received by or on behalf of the family" are nonrecurring (HN 3350-3354). Record the inference in the decision note. Winnings or inheritances paid as a multi-year stream: needs-review. |
| `insurance_settlements` | Insurance payments and settlements (health, auto, property) | no | 5.609(b)(5) | |
| `injury_civil_settlements` | Civil recoveries for malpractice/negligence causing disability; civil-rights settlements or judgments including back pay | no | 5.609(b)(7), (b)(25) | |
| `occasion_gifts` | Gifts for holidays, birthdays, weddings, baby showers, etc. | no | 5.609(b)(24)(v) | |
| `crowdfunding` | Online fundraising receipts | needs-review | 5.609(b)(24)(vii); HN 3478-3490 | One-time: no. Repeated pattern: yes. |
| `loan_proceeds` | Loan proceeds (student, car, personal) | no | 5.609(b)(20) | |
| `disaster_emergency_aid` | Stafford Act and comparable disaster assistance; Emergency Rental Assistance | no | 5.609(b)(22); 89 FR 6126 items (27), (29) | |
| `crime_victim_comp` | Crime victim compensation | no | 5.609(b)(22); 89 FR 6126 item (18) | Subject to the notice's full-compensation caveat; rare. |
| `property_tax_rebates` | State/local property tax refunds or rebates on the home | no | 5.609(b)(18) | |
| `medical_reimbursements` | Amounts for, or reimbursing, health and medical care expenses | no | 5.609(b)(6) | |
| `program_expense_reimbursements` | Reimbursement of out-of-pocket costs for participating in a public program | no | 5.609(b)(12)(ii) | |
| `tribal_and_special_federal` | Tribal trust / per-capita / settlement payments; Nazi-era reparations; Agent Orange; spina bifida allowances; relocation "gap" payments | needs-review | 5.609(b)(13), (b)(21), (b)(23); 89 FR 6126 items (3), (4), (6), (7), (10), (11), (15), (17), (21), (24), (26) | Mostly excluded, with dollar caps and conditions; identify the program. |

### E. Non-cash benefits (proposed 25F rule: "excludes non-cash receipts")

| key | Category | counted | Basis | Notes |
|---|---|---|---|---|
| `snap` | SNAP benefits | no | Prop. Reg. 1.25F-3(c)(6)(ii)(C); 89 FR 6126 item (1) | Categorical trigger (award letter within 12 months). |
| `wic` | WIC | no | same; 89 FR 6126 item (20) | Categorical trigger. |
| `school_meals` | Free or reduced-price school meals | no | 89 FR 6126 item (20) | School-wide eligibility is NOT a categorical trigger (PR 1291-1295). |
| `housing_assistance` | Section 8 voucher / housing assistance payments, public housing subsidy, utility allowance | no | PR 1225-1227 (preamble) | Categorical trigger (Section 8 housing). |
| `health_coverage` | Medicaid, CHIP, Medicare, employer or marketplace health coverage and subsidies | no | 5.609(b)(5)-(6); non-cash | Not on the proposed categorical list. |
| `liheap_childcare_subsidy` | LIHEAP; subsidized child care (CCDBG) | no | 89 FR 6126 items (5), (12) | |
| `employer_noncash_benefits` | Employer-paid insurance premiums, retirement match, other in-kind benefits | no | Prop. Reg. 1.25F-3(c)(6)(ii)(C) | |
| `in_kind_donations` | Food bank and other in-kind donations | no | 5.609(b)(24)(vi) | |
| `higher_ed_student_aid` | College grants/scholarships; Title IV aid including Federal work-study | no (up to covered costs) | 5.609(b)(9); 89 FR 6126 item (8) | Aid above actual covered costs, and non-479B fee-for-service aid, is income: needs-review if large. |
| `k12_scholarships` | K-12 scholarships, including an SGO scholarship received in the income year | needs-review | Not addressed (5.609(b)(9) is higher-education only; section 139K is a tax exclusion) | Paid to a school/vendor = not cash to the household. |

### F. Structural rules

| key | Rule | Basis |
|---|---|---|
| `no_deductions` | No deductions for dependents, child care, medical, elderly/disabled, taxes, or support paid. | 5.611 not referenced by Prop. Reg. 1.25F-3(c)(6)(ii)(C) |
| `period` | Sum cash actually received January 1 to December 31 of `year(application_date) - 1`. No projection. | USC 25F(c)(2)(A) |
| `whose_income` | All members 18+; head/spouse of any age; unearned income of dependents under 18. Everyone residing with the student is in the household. [FC] 5.609(a)(1) is worded for "each member of the family"; the proposed 25F rule measures the "household" (everyone residing with the student). Applying the 5.609 age rules to every household member, related or not, is the natural reading of the proposed text but is not stated in it (Open Question 9). Flag households with unrelated adults for review rather than silently dropping or adding their income. | 5.609(a)(1); Prop. Reg. 1.25F-1(a)(4)(iii) |
| `comparison` | Eligible if total is less than or equal to the limit. | USC; PR 2761-2762 |

---

## ENGINEERING IMPLICATIONS

**AMI engine**

1. Key the table by 5-digit county FIPS (`"48" + county`), not by county name, ZIP, or MSA. 254 county keys map to 215 area codes. Store `hud_area_code`, `hud_area_name`, `median2026`, fiscal year (2026), effective date (2026-05-01), source file hash, and formula version on every threshold row. The XLSX has no ZIP codes; ZIP-to-county needs a separate crosswalk (not in these sources) and ZIPs can straddle counties, so ask for the county when ambiguous.
2. Provisional formula (label every decision "provisional, HUD-derived, not IRS-published"): `limit_usd = median2026 * 3 * pct(n) / 100`, with `pct = [70, 80, 90, 100, 108, 116, 124, 132]` for n = 1..8 and `pct = 132 + 8 * (n - 8)` for n > 8. Integer arithmetic is exact (F39). No rounding. Eligible iff `household_income_usd <= limit_usd`.
3. Multipliers and the over-8 increment are data with a source and version ("HUD FY 2026 methodology; PR Table 1"), not literals scattered in code.
4. Build the ingest so the threshold source is swappable in one job: (a) today `HUD_FY2026_SEC8_MEDIAN_X3` (Formula A); (b) optional comparison column `HUD_FY2026_SEC8_VLI_X6` (Formula B) so the dashboard can show when the two disagree; (c) later `IRS_IRB_<citation>` keyed by whatever geography the IRS uses. Do not assume the IRS table will be keyed by `hud_area_code`.
5. Add a "formula sensitivity" flag to the decision: when a household's income falls between the Formula A and Formula B limits for its county and size, return `needs_review` rather than a hard yes/no. In 143 of 254 Texas counties the two limits differ at four persons; the border counties (Hidalgo, Cameron, El Paso, Webb, Starr) are where Formula A is materially lower. [FC] Precision: counting every household size, the two formulas differ in 1,851 of 2,032 Texas county-by-size cells, because HUD rounds each published cell up to $50. In the 111 counties where `l50_4` is exactly half the median (all the big metros) the band is at most $288 wide; it is tens of thousands of dollars wide only in the other 143 counties (F38). The flag will therefore fire in every county, but almost never matter outside those 143. For n > 8 compute the Formula B bound as `6 x l50_4 x (132 + 8 x (n - 8)) / 100` (HUD allows rounded or unrounded, F15); store which you used.
6. Unit tests: assert 254 Texas rows, 215 areas, the 16 multi-county groupings in F22, the Harris row in F21, the vectors in F39, the Texarkana cross-state trap, the name-collision cases (Austin County vs Travis County, Houston County vs Harris County, Tyler County vs Smith County), sizes 1-8 and 9+, and the boundary case income == limit (eligible) and limit + 1 (not eligible). `tools/hudami/tx_25f_provisional_limits_formulaA.csv` can seed fixtures once reviewed.
7. SGO-specific stricter caps: implement as a percentage parameter on the same formula (`median2026 * cap_pct/100 * pct(n)/100`); the sources give 50% and 80% only as examples and say nothing about rounding. Never allow a cap above 300%.
8. Parser hygiene for the XLSX: read by header name (case-insensitive), keep FIPS fields as strings, stop at the last populated row (ignore the bogus 1,048,576-row dimension), filter `stusps == "TX"`.

**Income calculator**

9. Two-bound decision. Compute `lower_bound` = sum of all `yes` items plus the counted part of `partial` items; `upper_bound` = lower bound plus the full amount of every `needs-review` item and the uncounted part of `partial` items. If `upper_bound <= limit` return eligible (the ambiguity cannot change the answer); if `lower_bound > limit` return ineligible; otherwise `needs_review`. With limits near $312,000 for a Houston family of four, most households will clear on the upper bound without any human review.
10. Encode the category table as data (key, counted, basis citation, note), versioned, with the rule set labelled "24 CFR 5.609 as of eCFR 2026-11-01 + REG-117199-25 (proposed)". Final regulations can then be applied as a data change.
11. Do not collect asset values. Do collect cash interest, dividends, and rental income.
12. Collect income per person for every adult residing in the home (not just the parents), each person's age band (under 18 / 18+), relationship flags needed by the rules (head, spouse, full-time student, foster, live-in aide), and unearned income received for children.
13. Evidence mapping: tax returns, transcripts and W-2s evidence components; AGI is never the answer. Always ask the non-taxable cash questions (child support, alimony, SSI, TANF cash, VA benefits, Social Security, cash support from outside the household) and store a signed "no other income" certification when the answer is none (F63).
14. Period: require the application date; set `income_year = application year - 1`; sum actual receipts in that calendar year. If only partial-year pay stubs are supplied, do not extrapolate silently; prefer a document showing full-year totals (final pay stub year-to-date, W-2, transcript) or route to review. The annualization method is not specified in the sources.
15. Child support and alimony: ask for amounts actually received in the income year. Never subtract support paid.
16. Make the dependent-deduction amount ($480 base) a dated config; until the current HUD-adjusted figure is confirmed, treat `dependent_ft_student_earned` and `adoption_assistance` as needs-review in the upper bound.
17. Categorical path short-circuits the calculator: SNAP, TANF, WIC, Section 8 housing or SSI award letter dated within the last 12 months for anyone in the household. Medicaid, CHIP, EITC and school-wide free lunch do not qualify under the proposed text.
18. Household size: count every person residing with the student, including the student. Capture shared-custody facts (which household the student lived in longest during the year; if equal, which has higher income) and flag rather than guess.
19. Evidence pack fields this topic requires: county FIPS, `hud_area_code`, `hud_area_name`, `median2026`, household size, multiplier, formula id, limit, threshold source and effective date, "provisional" flag, income year, per-category amounts with the rule citation, and the eCFR/proposed-rule version labels.

**Copy**

20. Never call the HUD-derived number "the IRS limit". Suggested label: "Provisional limit computed from HUD FY 2026 median family income (effective May 1, 2026) using the family-size multipliers in the proposed regulations. The IRS has said it anticipates publishing official limits."
21. Say "household" (everyone living with the student), not "family" or "tax household", and say "cash income" where describing what counts.

**Added by the fact-checker [FC]**

22. Source-of-rule labels. Every decision record and evidence pack should carry three separate provenance labels, because they have three different legal weights: (a) statute (300% cap, prior calendar year, "not greater than"); (b) proposed regulation REG-117199-25, not final, relied on under the preamble's reliance statement (F68); (c) economic-analysis formula and HUD-derived numbers, provisional. Do not collapse them into one "rules version" string.
23. Never present the multiplier formula as regulation text. The product formula and Table 1 are in the Special Analyses only (F29, F30). Copy such as "under IRS rules the limit is 3 x AMI x family-size factor" is wrong; "computed using the method described in the Treasury/IRS proposed rule" is supportable.
24. Decisions expire. Store `application_date`, `income_year`, `verified_at` and an expiry, and require a new determination for each award year: Treasury describes the income/family-size determination as "annual" and eligibility as tested when the scholarship is paid (F69). The exact re-verification rule is an open question (OQ 20), so make the validity period configuration, not a constant.
25. Reliance is all-or-nothing per party (F68). If the product markets itself as implementing the proposed rule's direct-verification method, it must implement that method as written (documents listed in F63, including evidence of income not on tax documents or a certification that there is none). A partial implementation should not be described to an SGO as "compliant with the proposed regulations".
26. Threshold-source enum should have room for at least four values: `HUD_FY2026_SEC8_MEDIAN_X3` (Formula A), `HUD_FY2026_SEC8_VLI_X6` (Formula B), `HUD_FY2026_MTSP_*` (if the MTSP file is later obtained; Treasury's own analysis cites MTSP, F37, and MTSP figures can exceed Section 8 figures because of the per-project hold-harmless rule, F66), and `IRS_IRB_<citation>`.
27. When refreshing sources, the eCFR API needs `curl --compressed` and occasionally answers 403 "IP address has been blocked"; huduser.gov answers plain requests with an AWS WAF challenge (HTTP 202, empty body). Build the ingest to fail loudly on an empty or non-XLSX response rather than writing an empty table (the folder already contains a zero-byte `hud/Section8-FY25.xlsx` from exactly that failure).

---

## OPEN QUESTIONS / AMBIGUITIES (the sources do not settle these)

1. **Raw median vs HUD-adjusted limits.** The economic analysis says 300% x AMGI x multiplier with AMGI illustrated as a single area number (F29). The proposed regulation text says AMGI "means the income limit determined based on area median gross income and family size in accordance with section 8" (F28), and HUD describes the section 42 standard as tied to the Section 8 very-low-income limit (F20), which HUD floors, caps and adjusts (F17). The two readings give different limits in 143 of 254 Texas counties, by up to $135,000 at four persons (F38). NOT IN SOURCES which one the IRS table will follow. [FC] Additional source-based considerations, added after verification: the Code requires consistency with Section 8 "determinations of lower income families and area median gross income" (F65), and those determinations depart from 50% of the local median in 1,593 of 2,635 areas nationally by HUD's own count (F67), which supports the adjusted-limit reading; the economic analysis's literal words and worked example support the raw-median reading (F29) but are not regulation text. Neither reading should be presented to an SGO as settled.
2. **Section 8 file vs MTSP file.** Treasury's own analysis cites HUD's MTSP income limits (F37) and HUD tells section 42 users to use MTSP limits (F8). The MTSP FY 2026 data is not in the local sources (huduser.gov blocked plain requests), so I could not test whether its medians or limits differ from the Section 8 file for any Texas county. [FC] Still unavailable on re-check (2026-11-18). The statutory reason the two publications can differ is the per-project hold-harmless rule of section 142(d)(2)(E) (F66).
3. **Which year's AMGI is compared with prior-calendar-year income?** For an application in 2027 (income year 2026): the HUD FY 2026 figures (effective May 1, 2026), the figures in effect on the application date, or the IRS table for a stated year? NOT IN SOURCES. The FY 2027 HUD release date is also NOT IN SOURCES.
4. **Rounding.** The proposed rule shows unrounded examples; HUD rounds its own limits up to $50 and lets agencies choose for 9+ persons. Whether the IRS table will be rounded is NOT IN SOURCES.
5. **Which location and as of when?** The rule's example says "lived in a location where the area median gross income was $100,000". Whether the area is the household's residence on the application date, during the income year, or something else, and what happens when a family moved between counties, is NOT IN SOURCES.
6. **Gross wages detail.** 5.609 says "all amounts ... received"; HUD guidance requires gross before garnishments. Whether pre-tax retirement deferrals and cafeteria-plan premiums are added back (W-2 box 1 vs box 5 vs pay-stub gross), and whether Social Security is counted before Medicare premium deductions, is NOT IN SOURCES.
7. **Nonrecurring income on a look-back.** 5.609(b)(24) excludes income that "will not be repeated in the coming year". Section 25F measures a completed calendar year. Whether a job that ended, or a one-time bonus, in the income year is excluded is NOT IN SOURCES.
8. **Realized capital gains, one-off retirement withdrawals, annuitized winnings, self-employment losses.** Not addressed by 5.609's text; the proposed rule addresses only imputed returns and unrealized appreciation.
9. **Household vs family.** Proposed 25F family size counts everyone residing with the student; 5.609 measures "family" income and excludes income of live-in aides and foster children/adults. Do live-in aides, foster children, boarders or unrelated roommates count toward family size? Is an unrelated roommate's income counted? Are temporarily absent members (college, deployment) counted? As of what date is household composition fixed (income year vs application date)? NOT IN SOURCES.
10. **Current dependent-deduction amount.** CFR base $480 (effective 1/1/2024), adjusted every January 1; the 2025 and 2026 values are published on HUD User and were not retrievable. NOT IN SOURCES.
11. **Which edition of 24 CFR 5.609.** The proposed regulation cites the section without a date; a footnote says "(2000)" but describes and links to the current text. Low risk, but final regulations should be checked for a fixed-date reference.
12. **Regular cash support from relatives outside the household, private disability insurance, severance, guaranteed-income pilots, K-12 scholarships** (including a prior-year SGO scholarship): not specifically addressed; table marks them needs-review.
13. **Medicaid-funded caregiver payments** (5.609(b)(19)) are excluded for HUD "assisted units"; whether the exclusion carries into 25F for families not in assisted housing is not addressed.
14. **Corpus Christi HMFA median equals the Texas nonmetro median ($83,700).** Coincidence or a fallback value? NOT IN SOURCES. Does not change the engine; note it in test comments so nobody "fixes" it.
15. **HUD documents disagree on the FY 2026 U.S. median** ($107,900 in the income-limits methodology vs $106,800 in the medians attachment). Not used by the formula.
16. **Tolerance.** HUD's $360/year de minimis error rule is a housing compliance rule; whether the IRS will tolerate small income-calculation errors by SGOs is NOT IN SOURCES.
17. **Sources I could not retrieve:** 24 CFR 5.615 (imputed welfare income; eCFR began refusing requests), HUD User pages for MTSP limits and inflation-adjusted values (WAF challenge), Federal Register full text via federalregister.gov (redirected to an access page; the govinfo copy was used instead). [FC] Update: 5.615 has now been retrieved (F72). The HUD User pages are still unreachable by plain request (confirmed 2026-11-18: HTTP 202, `x-amzn-waf-action: challenge`, empty body, for both `mtsp.html` and `inflationary-adjustments-notifications.html`), so the MTSP FY 2026 data and the 2025/2026 dependent-deduction amounts remain NOT IN SOURCES.

**Added by the fact-checker [FC]**

18. **Hold harmless.** Section 142(d)(2)(E) keeps a section 42 project's AMGI from falling year to year (F66). Section 25F borrows the section 42 term but has no "project". Will the IRS 25F table ever decrease when HUD medians fall, or carry a non-decreasing rule? NOT IN SOURCES. Design the table as dated versions; do not assume limits only go up.
19. **Do the 5.609(b)(22) "federally mandated exclusions" carry into 25F?** They are amounts "HUD is required by Federal statute to exclude" for HUD programs, listed in a HUD notice (F47). The proposed 25F rule adopts "annual income, as defined in 24 CFR 5.609" wholesale, which on its face includes paragraph (b)(22); but neither the proposed rule nor its preamble mentions the HUD notice. Most listed items are non-cash and are excluded under the proposed rule anyway; the cash items are the exposed ones. NOT IN SOURCES.
20. **When is eligibility fixed, and how long is a verification good for?** Statute: income "for the calendar year prior to the date of the application". Preamble: the determination is "annual" and eligibility is tested "as of the time when the scholarship is paid" (F69). If an application is filed in December 2027 and the scholarship is paid in August 2028, is the income year 2026 (the year before the application) and is that determination still valid at payment? Must a multi-year award be re-verified each year, and against which year's income and AMGI table? NOT IN SOURCES beyond F35 and F69.
21. **Is the economic-analysis formula the rule?** The product formula and multiplier table are not in the proposed regulation text (F29, F30). If final regulations or the IRS table depart from them (for example by using HUD's published, rounded, adjusted limits), every Formula A number in this file changes. NOT IN SOURCES.

---

## VERIFICATION LOG (adversarial fact-check, 2026-11-18)

Checker: second agent, independent of the author. Method: every quote was located in the cited local file (`grep -a` / line read); every XLSX-derived number was re-computed from `hud/Section8-FY26.xlsx` with a script written from scratch (`tools/fc_hudami/fc_xlsx.py`; output saved at `tools/fc_hudami/fc_xlsx.out`), not with the author's scripts; web sources were re-fetched with plain `curl` where the site allowed it. Inline corrections are marked `[FC]`.

### What was checked

| Area | Items | Result |
|---|---|---|
| XLSX structure (F1-F3): sheets, 35 headers, 4,764 rows, 56 state codes, types, null cells, `Field_Descriptions` rows 2-36 | all | Confirmed. sha256 and byte size of the workbook match the legend. |
| Texas counts (F9, F13): 254 rows / 254 FIPS / 215 area codes / 215 names; 86 metro rows in 47 areas; 168 nonmetro; 16 multi-county areas with 55 counties; 31 single-county metro areas; rows 3821-4074; 174 distinct medians; min Starr $38,700, max Glasscock $144,200 | all | Confirmed. |
| F10: XLSX vs HUD area-definition report (ADR lines 2319-2449) vs Census county list | all | Confirmed with an independent parser (`tools/fc_hudami/fc_adr.py`): 47 metro areas identical, 168 nonmetro identical, 254 FIPS and names identical. |
| F11-F12: `hud_area_code` patterns (26 / 18 / 2 / 1 / 168), national prefix counts 1,976 / 2,788, 2,635 unique codes, 14 "MSA" and 33 "HUD Metro FMR Area" names | all | Confirmed. |
| F21 Harris County row (sheet row 3921), all 35 values; 7-county Houston HMFA; Brazoria / Austin County / San Jacinto medians | all | Confirmed. Matches the product spec's example ($104,000; 300% = $312,000). |
| F22 (16 rows) and F23 (31 rows) tables: codes, names, counties, medians, `l50_4`, "not half" flags | every cell | Confirmed, no differences. |
| F24 anomalies; Texarkana cross-state area; eight rows at $83,700; 111 rows below $83,700; six lowest and highest medians; name collisions | all | Numbers confirmed. Three explanatory statements marked UNVERIFIED (see below). |
| F14-F20, F25: HUD methodology quotes and line numbers (ILM, MED) | all | Confirmed verbatim at the cited lines. One wording fix (F5). |
| F7-F8: effective date "May 01, 2026" (ILH lines 610, 670, 742), prior-year dates, official-file and MTSP notes | all | Confirmed in `hud/il.html`. |
| F17-F18, F38: `l50_4` vs half-median (143 / 120 / 23; 134 areas; 112 rows at 41,850), family-size deviations (55 of 2,032; 21 counties; 829 of 38,112), Formula A vs B counts (111 / 120 / 23; 181 / 1,664 / 187; 707) and the named gaps | all | Counts confirmed. Two corrections (F18 magnitude nationally; F38 list of largest gaps). |
| F39 golden vectors (14 counties x 9 sizes) and the CSV (254 x 12) | every value | Confirmed; integer arithmetic is exact (remainder 0 in all cases). |
| F26-F27 statute (USC lines 159-164, 214, 217) | all | Confirmed verbatim. Tag `[statute]` correct. |
| F28-F37, F41-F43, F49, F63-F64: proposed rule and T.D. 10057 quotes and line numbers | all | Confirmed verbatim at the cited lines (PR line numbers are identical in the raw and NUL-stripped copies). Tags correct: regulation text is tagged `[proposed-reg: not final]`, preamble and Special Analyses text `[preamble/economic-analysis]`. Scope warnings added to F29 and F30. |
| F40, F44-F46, F48-F54, F58-F62: 24 CFR 5.609 / 5.603 / 5.100 / 5.403 / 5.611 quotes, paragraph numbers, line numbers | all 28 paragraphs of 5.609(b) and all definitions | Confirmed. eCFR re-fetch byte-identical for 5.609, 5.100, 5.403, 5.611; 5.603 and 5.609 cross-checked against the govinfo CFR 2025 annual edition (same words). One quote completed (F45 "Household" scope). |
| F47: 89 FR 6126, 29 items, FRX line numbers | all cited items | Confirmed; govinfo re-fetch identical. Program-specific caveats added. |
| HUD notice H 2023-10 / PIH 2023-27 (HN) quotes and line numbers; header "Revision 3 ... Issued: April 16, 2026" | all 17 cited passages | Confirmed; PDF re-fetched from hud.gov is byte-identical (992,344 bytes). One line reference corrected (F52), one quote completed (F56). |
| Income category table (71 rows) | every row's Basis citation | Confirmed against the cited paragraphs. Five rows annotated or corrected (see below). |
| Engineering implications (21) and open questions (17) | each traced to its facts | Consistent with the verified facts. Six implications and four open questions added. |

Approximate count: 64 original facts (several hundred individual quotes, line references and numbers), 71 table rows, 21 implications, 17 open questions.

### Corrections made (what was wrong -> what it says now)

1. F5: "rounded to the nearest $100" -> HUD says only "rounded to 100"; direction not stated. Also noted the 1-year/5-year ACS and fallback rules the one-line summary skipped.
2. F18: implied all deviations from the family-size formula are $50 -> true for Texas (48 cells -$50, 7 cells +$50); nationally 35 cells deviate by -$100.
3. F38: "Largest gaps" list omitted three of the five largest negative gaps -> added Sterling (-$57,000), Somervell (-$34,200), Winkler (-$27,600), and Dimmit / Jim Hogg / Brooks on the positive side; "come purely from HUD's round-up" -> 3 of the 707 small differences come from the cap/floor re-test and go the other way; added the over-8 rule for Formula B.
4. F29 / F30: presented as "THE FORMULA" -> added an explicit warning that the product formula and the multiplier table are in the economic analysis only, not in the proposed regulation text or the statute; added Treasury's stated reason for using HUD's multipliers (PR lines 2775-2778) and the base mismatch (HUD multiplies the four-person income limit, the analysis multiplies "area median gross income").
5. F45: the 5.100 "Household" quote dropped its scope ("for purposes of 24 CFR part 5, subpart I, and parts 960, 966, 882, and 982") -> full sentence restored; subpart F / 5.609 is not in that scope.
6. F52: HN line reference 2393-2397 -> 2395-2398; examples labelled as the author's illustrations.
7. F56 / F60: truncated HUD sentence about unemployment -> full sentence quoted; clarified that the legal basis for counting unemployment is 5.609(a)(1) default inclusion, not the guidance.
8. Table `rental_income_net`: "Net rental income ... yes" -> 5.609 does not mention rental income; counted by default inclusion; "net" supported only via (b)(28) business treatment; gross-vs-net otherwise NOT IN SOURCES.
9. Table `lottery_inheritance_lump_sum`: inheritance presented as excluded -> flagged as an inference (not named in 5.609 or the HUD notice), with the supporting guidance cited.
10. Table `tanf_cash` and Open Question 17: "5.615, not retrieved" -> retrieved and summarised (F72).
11. Table `va_compensation_pension` and `regular_contributions_from_outside`: basis clarified (default inclusion; what the HUD notice does and does not name).
12. Engineering implication 5: "the two limits differ in 143 of 254 counties" -> true at four persons only; across all sizes they differ in 1,851 of 2,032 cells, by at most $288 in the 111 half-median counties.
13. F40: added that HUD's compliance dates for the post-2024 5.609 are staggered (90 FR 61062), so two versions of 5.609 are in live use in HUD programs; the proposed 25F rule's description matches the current text.
14. F47: added the notice's own statement that items (13) and (23) are program-specific, and the conditions on items (2) and (8).

### Facts added (omissions)

F65 statutory chain 42(g)(4) -> 142(d)(2)(B)(i) -> Section 8. F66 section 142(d)(2)(E) hold-harmless and why MTSP exists. F67 Section 8 "determinations" are adjusted limits; HUD's count (1,042 of 2,635 areas at 50% of local median). F68 reliance statement and proposed applicability date. F69 "annual" determination, tested when the scholarship is paid. F70 Treasury's modelling (64% vs 95%, Table 2) and the "$50,000 or more" vs "exceeds $50,000" inconsistency. F71 methods that bypass the AMI comparison. F72 24 CFR 5.615. F73 the proposed rule's "imputed return" example vs HUD's actual imputation. Plus: negative searches for an IRS-published table (F32), engineering implications 22-27, open questions 18-21.

### Nothing was found to be fabricated

No invented number, date, form name or quote was found. All 64 original facts trace to a source at or within a few lines of the cited location.

### Still UNVERIFIED / not verifiable from the sources

1. F24 item 3: why six nonmetro counties and the Corpus Christi HMFA sit exactly at the State nonmetro median ($83,700). The data is confirmed; the explanation is not.
2. F24 item 5: which HUD adjustment produced Glasscock County's `l50_4` (FY 2025 file is zero bytes locally).
3. MTSP FY 2026 income limits (huduser.gov WAF challenge): cannot test whether they differ from the Section 8 file for any Texas area.
4. Current (2025 and 2026) HUD inflation-adjusted dependent-deduction amount; only the $480 base "effective 1/1/2024" is in the sources.
5. Completeness of the saved IRB captures used for the negative search in F32.
6. Provenance of `hud/il.html` and the XLSX: both were saved through a headless browser by an earlier step (`tools/hud.js`, `tools/hud_dl.js`) because huduser.gov blocks plain requests; they could not be re-downloaded by plain request for comparison. Internal and external consistency is strong: the workbook agrees with the HUD area-definition report and methodology PDFs (obtained by the same download path), with HUD's Table 1 area total of 2,635, with the Census county list (a different source), and with the multipliers printed in the Federal Register copy of the proposed rule (a different source).
7. Everything listed under OPEN QUESTIONS 1-21.
