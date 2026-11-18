# Runbook: swapping in the IRS limitation table

**What this is for.** Today every income decision uses a provisional table derived from HUD data
(`hud-fy2026-tx`). The proposed regulations (REG-117199-25) say the IRS "anticipates publishing the
applicable limitations by geographic area and family size annually in guidance published in the Internal
Revenue Bulletin." When that table is published it becomes the source of truth. This runbook is the
procedure for replacing the provisional table with it.

**Time.** One working day once the table exists. **People.** Two: one transcribes, a second transcribes
independently. The founder (James) owns the Texas test suite and approves the change. **Risk.** A wrong
limit is a wrong scholarship decision. Nothing in this procedure may be skipped to save time.

Nothing below changes what the application uses until step 7. Ingesting never activates.

| Step | What | Command |
| --- | --- | --- |
| 1 | Get the published table and read its text | (manual) |
| 2 | Create an empty transcription sheet | `npm run ami:ingest -- --irs-template <file.csv>` |
| 3 | Transcribe the table into the CSV contract | (manual) |
| 4 | Ingest | `npm run ami:ingest -- --source irs --file <file.csv> --version irs-<year> --effective-date YYYY-MM-DD --citation "<citation>"` |
| 5 | Second, independent transcription | `npm run ami:ingest -- --verify-transcription <second.csv> --against irs-<year>` |
| 6 | Review the comparison with the active table | `npm run ami:ingest -- --diff irs-<year> --report <diff.csv>` |
| 7 | Activate | `npm run ami:ingest -- --activate irs-<year>` |
| 8 | Re-run the full Texas suite on the new numbers | `npx vitest run src/engine/ami` then `npm test` |
| 9 | Commit, review, deploy | (pull request) |

The examples use `irs-2027` as the version id; use the year the publication itself gives. `work/` in the
examples stands for any scratch folder for the transcription sheets and reports. Do not commit it: the
ingest archives the one file that belongs in the repository.

---

## 1. Get the table and read it

1. Download the document from irs.gov (the Internal Revenue Bulletin issue, not a news summary). Note the
   citation exactly as printed (document number and Bulletin issue) and the URL.
2. Save the PDF in the repository as `data/ami/sources/irs-2027.pdf`. It is the evidence for every number
   that follows.
3. Read the text around the table, not only the table, and write down the answers. They go in the pull
   request description.

   | Question | Why it matters |
   | --- | --- |
   | Which geographic areas does it use? HUD income-limit areas, counties, something else? | Decides the transcription layout (section "If the IRS uses different geographic areas"). |
   | Which family sizes does it print? What does it say about households above eight? | Decides the `additional_person_increment` column. |
   | Does it print limits per family size, or only an area median? | If only a median, stop: see "If the IRS publishes only area medians". |
   | From what date, or for which applications or calendar year, do the limits apply? | Becomes `--effective-date`. |
   | Are the figures rounded? Do they carry cents? | Transcribe exactly as printed. |
   | Is this final guidance, or proposed or interim? | If it is not final, stop and ask the founder before activating. |

## 2. Create the transcription sheet

```bash
# either: one row per area (215 rows)
npm run ami:ingest -- --irs-template work/irs-2027-a.csv
# or: one row per county (254 rows)
npm run ami:ingest -- --irs-template work/irs-2027-a.csv --layout county
```

The sheet has the Texas geography filled in from the installed HUD table (area codes and names, county FIPS
codes and names) and **every limit empty**. Limits are never pre-filled: a provisional number must not be
able to pass for a transcribed one. The command refuses to overwrite an existing file.

Use the per-area layout when the IRS areas are the HUD areas. Use the per-county layout in every other case.

## 3. Transcribe

Fill the sheet from the PDF. The CSV contract (`irs-limitation-csv-v1`, defined and enforced in
`src/engine/ami/ingest/irs.ts`):

| Column | Required | Content |
| --- | --- | --- |
| `area_code` | yes | Identifier of the IRS geographic area: letters, digits, `.`, `_`, `:`, `-`, at most 64 characters. Keep the HUD code when the IRS area is the HUD area. |
| `area_name` | yes | The area name exactly as the IRS prints it. This is what evidence packs show. |
| `county_fips` | yes | 5-digit FIPS code of every Texas county the row covers, separated by `;`. |
| `county_name` | yes | The county names for those codes, same order, separated by `;`. Checked against the county list so a mistyped or swapped code fails. |
| `limit_1` ... `limit_8` | yes | The published limit for family sizes 1 to 8 in dollars. Digits only, optional two-digit cents: `312000` or `312000.00`. No `$`, no commas, no spaces, no formulas. |
| `additional_person_increment` | no | Dollars added per household member above eight, same format. Empty if the IRS prints no such figure. |
| `area_median_gross_income` | no | The area median gross income in whole dollars, if the IRS prints it beside the limits. Reference only. |

Rules the ingest enforces (it fails, listing every problem with its row number, if any is broken):

- The header is exactly these columns (any order), nothing extra.
- Every one of the 254 Texas counties appears exactly once across the file.
- Rows that repeat an `area_code` (per-county layout of a multi-county area) must be identical in name,
  limits, increment and median.
- A limit may not be lower than the limit for the next smaller family size.
- Each `county_name` must match its `county_fips`.

Practical rules:

- Type the numbers; do not paste from a PDF-to-text tool without reading every cell against the PDF.
- Do not edit the geography columns unless the IRS geography differs from HUD's.
- Save as "CSV UTF-8". Spreadsheet programs may reformat numbers; reopen the saved file in a text editor and
  check there are no `$`, commas or scientific notation.
- **Households above eight.** If the table prints an amount per additional person, enter it. If the
  publication states a rule instead (for example a percentage of the four-person limit per additional
  person), compute the amount from the rule as printed, enter it, and quote the rule in the pull request.
  If it says nothing, leave the column empty: the engine will then refuse households above eight in that
  area with reason `household_size_not_published`, and those applications go to manual review. Do not carry
  the HUD-derived +0.08 rule over to the IRS table on your own authority.

## 4. Ingest

```bash
npm run ami:ingest -- --source irs --file work/irs-2027-a.csv --version irs-2027 \
  --effective-date 2027-01-01 \
  --citation "<document number, Internal Revenue Bulletin issue>" \
  --source-url "https://www.irs.gov/..."
```

- `--effective-date` is the date the publication says the limits apply from. If it gives a period instead
  of a date, use the first day of the period and quote the publication's wording in the pull request.
- `--citation` appears in every evidence pack and API response that uses the table. Without it the ingest
  warns and the labels cite the Internal Revenue Bulletin generically; do not activate a table like that.

What it writes:

- `data/ami/irs-2027.json`: the table. Source `irs_published`, limits stored explicitly in cents. Nothing is
  computed from medians or multipliers.
- `data/ami/sources/irs-2027.csv`: a byte-for-byte copy of the transcription; its SHA-256 is recorded in the
  table.
- `src/engine/ami/tables.generated.ts`: the generated import list, now including the new table.

It prints "Ingest does not activate" and the active table is unchanged. If validation fails, fix the CSV and
run it again; nothing is written on failure. To re-ingest a corrected CSV under the same version before
activation, add `--replace`; the command prints which limits change. Once a table is active the command
refuses any ingest that would change its limits, with or without `--replace`.

## 5. Second, independent transcription

A second person repeats steps 2 and 3 on their own sheet without looking at the first, then:

```bash
npm run ami:ingest -- --verify-transcription work/irs-2027-b.csv --against irs-2027
```

It compares the two transcriptions for all 254 counties: limits for sizes 1 to 8, the per-person increment,
the median, area names and codes. Every difference is listed. For each one, look at the PDF, correct
whichever sheet is wrong, re-ingest the first sheet with `--replace` if it was the wrong one, and repeat
until the command prints "The two transcriptions agree". The command refuses a byte-identical copy of the
first file. The second sheet is not committed.

## 6. Review the comparison with the active table

```bash
npm run ami:ingest -- --diff irs-2027 --changed-only --report work/irs-2027-diff.csv
```

For every county and household size 1 to 8 it shows the active (provisional) limit, the IRS limit and the
difference, then a summary: how many cells changed, the largest increase and decrease, the smallest change,
the largest relative change, the counties whose geographic area changed (the area is now a different set of
counties) and, separately, the counties whose area was only renamed or recoded. `--report` writes all 2,032
rows as CSV for a spreadsheet.

Read it before going on. Things to look for:

- **Differences that are uniform and small** (for example every limit rounded to a multiple of $50) point to
  a rounding rule in the IRS table. Expected; note it.
- **Large differences concentrated in low-median and high-median counties** point to the IRS having built
  its limits from HUD's adjusted income limits rather than from the raw area median. In the HUD FY 2026
  data that reading differs from the provisional table in 143 of 254 Texas counties, by up to $135,000 for
  a family of four (Starr County). It would not be an error, but it changes many decisions: tell the founder
  before activating.
- **A handful of isolated differences** are more likely transcription errors. Go back to the PDF.
- **Any decrease.** A household that was eligible under the provisional table may not be under the
  published one. Note the counties and sizes for whoever handles decisions already made (section 10).

## 7. Activate

```bash
npm run ami:ingest -- --activate irs-2027 --dry-run     # prints the comparison, changes nothing
npm run ami:ingest -- --activate irs-2027
```

Activation first checks the table (every county gives a positive limit for sizes 1 to 8 that never falls as
the household grows, and the archived transcription is the file the table was built from), prints the
comparison again, then writes `data/ami/active.json` and refreshes the generated import list. It is the only
command that changes which table the application uses.

From here on, in this working tree, `getThreshold` returns the IRS limits with `source: "irs_published"`
and `provisional: false`, and `describeThresholdSource` returns the IRS wording with the citation. No other
code changes are needed for that.

## 8. Re-run the full Texas suite on the new numbers

1. Open `src/engine/ami/ami.test.ts` and change the two tripwire constants. This is the only edit to the
   suite, it is deliberate, and the founder reviews it:

   ```ts
   const EXPECTED_ACTIVE_VERSION = "irs-2027";
   const EXPECTED_ACTIVE_SOURCE = "irs_published" as ThresholdSource;
   ```

2. Run the suite:

   ```bash
   npx vitest run src/engine/ami
   ```

   For the IRS table it checks, with code that does not share the ingest's parser: every Texas county and
   household size 1 to 8 returns exactly the amount in the archived transcription; the archive's SHA-256 is
   the one recorded in the table; the per-person increment is applied above eight; all 254 counties are
   covered; limits never fall as the household grows; the labels no longer say "provisional". It also
   re-checks the HUD table against its golden file, which must still pass unchanged: the provisional table
   stays installed so old decisions can be re-derived.

3. Run everything: `npm test`, `npm run typecheck`, `npm run lint`. Tests in other modules that assert
   provisional labels or HUD-derived amounts for the *active* table will fail; each such failure is a place
   that shows thresholds to people. Update the expectation only after confirming the screen, API field or
   PDF now shows the IRS wording from `describeThresholdSource`.

Do not deploy with any test failing or skipped.

## 9. Commit, review, deploy

Commit together:

- `data/ami/irs-2027.json`, `data/ami/sources/irs-2027.csv`, `data/ami/sources/irs-2027.pdf`
- `data/ami/active.json`, `src/engine/ami/tables.generated.ts`
- `src/engine/ami/ami.test.ts` (the two constants) and any other test expectations from step 8.3

The pull request description carries: the citation and URL; the answers from step 1; who made each
transcription; the summary block of the comparison (step 6) and the CSV report as an attachment; anything
unusual. The founder approves it. Never merge an automated or agent-made change to the tables, the active
pointer or the suite without that review.

## 10. After deploying

The engine only answers "what is the limit". Decisions already recorded keep the threshold, source, table
version and effective date they were made with; nothing is recomputed automatically. Before deploying,
agree with the founder what happens to verifications decided or held under the provisional table (leave
them, re-run them, or re-run only those near the limit). That is a product and legal decision, not part of
this job.

Keep `hud-fy2026-tx` installed. Never delete a table that any decision has used: `getTable("<version>")`
must keep working for audits.

---

## If the IRS uses different geographic areas than HUD

The engine resolves a household to a **county** and looks up that county's area in the active table. The
table decides which counties form an area, so different areas are a transcription matter, not a code change,
as long as an area is made of whole counties.

| The IRS table is keyed by | What to do |
| --- | --- |
| The same areas as HUD, same or slightly different names | Per-area layout. Keep `area_code`; set `area_name` to the IRS wording. |
| Individual counties | Per-county layout. One row per county. Keep the HUD `area_code` only where a row's limits really are shared by that HUD area; otherwise give each county its own code, for example `IRS-2027-48201`. |
| Larger areas (for example whole metropolitan statistical areas, where HUD splits them) | Per-county layout. Put the IRS area's code and name on every county the IRS assigns to it. All rows of one `area_code` must carry identical limits; the ingest checks it. Codes are yours to assign: `IRS-2027-<short name>`. Use the IRS's own identifier if it prints one. |
| Areas that mix "listed" places with a statewide or "balance of state" row | Per-county layout. Give every county not listed by name the balance row's limits under one shared `area_code`. Quote in the pull request the sentence of the publication that says the balance row applies to them. |
| Anything smaller than a county (towns, ZIP codes, tracts) or splitting a county between areas | **Stop.** The engine and every stored decision are keyed by county and cannot represent it. Do not approximate. The provisional table stays active; raise it with the founder as an engineering change (the household form would have to capture the finer geography). |
| Counties the table does not cover at all | **Stop.** The ingest requires all 254 Texas counties. Do not fill gaps with HUD-derived numbers. Ask the founder; the answer may need counsel. |

To find which counties make up an area the IRS names, use the IRS document's own definitions first. HUD's
area definitions are in the installed table (`npm run ami:ingest -- --irs-template x.csv` lists them), and
the comparison in step 6 prints "Counties whose geographic area changed" with the old and new area (and how
many counties each holds) for every county affected, so every reassignment is visible to the reviewer.

Downstream effects of new areas: `area.code` and `area.name` in results come from the IRS table from then
on; stored decisions keep the area they were made with; ZIP-to-county resolution is unaffected because it
ends at the county.

## If the IRS publishes only area medians, not limits per family size

Stop. That is not a transcription job, and the limits must not be computed by hand in a spreadsheet. The
proposed definition says area median gross income "will be published in the Internal Revenue Bulletin",
so this can happen. The engine already has a computed method (the provisional table uses it: cap percent x
median x family-size multiplier, multipliers stored in the dataset), but which multipliers apply, whether
the result is rounded, and how the result is labeled are decisions for the founder and counsel on the text
of the final rule. Treat it as a small engineering change to the ingest (a median-only layout for
`--source irs`), with its own golden file produced by an independent script the way
`scripts/ami-golden.py` does for HUD.

## If the ingest refuses the table

The validation is deliberately strict. If the published table really does break a rule (a limit that falls
as family size grows, an area the contract cannot express), do not loosen the check to get through. Stop,
keep the provisional table active, and bring the exact rows to the founder.

## Corrections and rollback

- **The IRS publishes a correction.** Ingest it as a new version (`irs-2027-rev1`) with its own citation and
  go through every step again. Never edit an activated table in place.
- **A transcription error is found after activation.** Same: a new version. Then find the decisions made
  with the wrong table by `threshold_table_version`.
- **Rollback.** `npm run ami:ingest -- --activate hud-fy2026-tx --allow-provisional-over-irs`, restore the
  two constants in the suite, commit. The command refuses to go from an IRS table back to a provisional one
  without that flag.
- **Removing a table that was ingested by mistake and never activated or used.** Delete
  `data/ami/<version>.json` and `data/ami/sources/<version>.*`, then run
  `npm run ami:ingest -- --activate <the currently active version>`; it changes nothing except refreshing
  the generated import list.

## Reference

- Table registry and active pointer: `src/engine/ami/registry.ts`, `data/ami/active.json`.
- Arithmetic and its documentation: `src/engine/ami/compute.ts`.
- CSV contract and validation: `src/engine/ami/ingest/irs.ts`. Command: `scripts/ami-ingest.ts`
  (`npm run ami:ingest -- --help`).
- Wording shown with thresholds: `src/engine/ami/labels.ts` (`describeThresholdSource`).
- The suite: `src/engine/ami/ami.test.ts`, `src/engine/ami/ingest/ingest.test.ts`. Owned by the founder.

### A new HUD fiscal year before the IRS table exists

HUD publishes new Section 8 income limits each spring. The same command ingests them
(`--source hud --file data/hud/Section8-FY27.xlsx --state TX`), and the same rule applies: ingest, review
the comparison, activate explicitly, re-run the suite. Before that: verify the file against huduser.gov and
pin its SHA-256, URL and effective date in `src/engine/ami/ingest/hud-releases.ts` (the effective date is
stated on the HUD User income-limits page, not in the file); point `scripts/ami-golden.py` at the new file
and produce a new golden CSV; add the new table's golden tests beside the FY 2026 ones. Which fiscal year's
median applies to an application is not settled by the proposed rules, so when to activate a new HUD year
is the founder's decision.
