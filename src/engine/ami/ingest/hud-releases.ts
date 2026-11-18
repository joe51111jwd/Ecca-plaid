/**
 * HUD Section 8 income-limit releases this project has pinned. A file whose SHA-256 is listed here is
 * ingested with the release facts below; any other file must be given its facts on the command line and is
 * reported as not pinned.
 *
 * The effective date is not in the data file or in HUD's methodology PDFs. For FY 2026 it is stated on the
 * HUD User Income Limits dataset page, directly above the link to the Section 8 Excel file.
 */
export interface HudRelease {
  fiscalYear: number;
  fileName: string;
  /** SHA-256 of the official file, lower-case hex. */
  sha256: string;
  url: string;
  /** YYYY-MM-DD */
  effectiveDate: string;
  effectiveDateCitation: string;
}

export const KNOWN_HUD_RELEASES: readonly HudRelease[] = Object.freeze([
  Object.freeze({
    fiscalYear: 2026,
    fileName: "Section8-FY26.xlsx",
    sha256: "bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0",
    url: "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx",
    effectiveDate: "2026-05-01",
    effectiveDateCitation:
      'HUD User, Income Limits dataset page (https://www.huduser.gov/portal/datasets/il.html), "2026 Data: Effective May 01, 2026", retrieved 2026-11-18. The FY 2026 methodology documents do not state the effective date.',
  }),
]);

export function findHudReleaseBySha256(sha256: string): HudRelease | null {
  return KNOWN_HUD_RELEASES.find((release) => release.sha256 === sha256) ?? null;
}
