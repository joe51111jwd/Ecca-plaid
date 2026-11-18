/**
 * How settled a section 25F rule or sentence is.
 *
 * Every number in `./constants` and every sentence in `./copy` carries one of these tags plus a citation, so
 * that when final regulations arrive the proposed-only pieces can be found and changed in one place, and so
 * that copy never presents a proposed rule as settled law.
 *
 * Preamble statements are tagged with the document they were published with (`temporary_reg` for the
 * preamble of T.D. 10057, `proposed_reg` for the preamble and economic analysis of REG-117199-25); the
 * citation string says "preamble" when the support is not regulation text.
 */
export const AUTHORITIES = ["statute", "temporary_reg", "proposed_reg", "irs_web", "product_policy"] as const;

export type Authority = (typeof AUTHORITIES)[number];

export interface AuthorityInfo {
  /** Short name for internal screens and exports. */
  readonly label: string;
  /** The document(s) behind the tag. */
  readonly source: string;
  /** What the tag means for how much weight the rule can bear. */
  readonly standing: string;
}

export const STATUTE_CITATION = "26 U.S.C. 25F";
export const TEMPORARY_REG_CITATION = "T.D. 10057, 91 FR 62655 (Oct. 2, 2026)";
export const PROPOSED_REG_CITATION = "REG-117199-25, 91 FR 62818 (Oct. 2, 2026)";
export const PROPOSED_RULE_ID = "REG-117199-25";
export const IRS_INDIVIDUALS_PAGE_CITATION =
  "IRS, Federal Scholarship Tax Credit (FSTC) for individuals, https://www.irs.gov/credits-deductions/individuals/federal-scholarship-tax-credit-fstc-for-individuals";
/** The verified research notes every citation below points back to (fact ids F1 to F78). */
export const DONOR_RULES_REFERENCE = "docs/reference/donor-credit-rules.md";
export const ACKNOWLEDGMENT_REFERENCE = "docs/reference/acknowledgment-reporting.md";

export const AUTHORITY_INFO: Readonly<Record<Authority, AuthorityInfo>> = Object.freeze({
  statute: Object.freeze({
    label: "Statute",
    source: STATUTE_CITATION,
    standing: "Enacted law. Applies to taxable years ending after December 31, 2026.",
  }),
  temporary_reg: Object.freeze({
    label: "Temporary regulations",
    source: `${TEMPORARY_REG_CITATION}: Temp. Treas. Reg. 1.25F-1T, 1.25F-4T, 1.25F-5T`,
    standing: "Published October 2, 2026; effective December 1, 2026; applicability expires October 1, 2029.",
  }),
  proposed_reg: Object.freeze({
    label: "Proposed regulations (not final)",
    source: `${PROPOSED_REG_CITATION}: Prop. Treas. Reg. 1.25F-1 to 1.25F-5`,
    standing:
      "Not law. May be relied on for qualified contributions made on or after January 1, 2027 only if followed in their entirety and consistently. Final regulations may differ.",
  }),
  irs_web: Object.freeze({
    label: "IRS web page",
    source: "irs.gov Federal Scholarship Tax Credit pages",
    standing: "Informal IRS guidance. Not statute or regulation; can change without notice.",
  }),
  product_policy: Object.freeze({
    label: "Product policy",
    source: "This product's own conservative choice where the sources are silent",
    standing: "Not a legal rule. Never present it to a donor or an organization as one.",
  }),
});

/** A value together with where it comes from. Every section 25F constant in the app is one of these. */
export interface Rule<T> {
  readonly value: T;
  readonly authority: Authority;
  readonly citation: string;
}

export function rule<T>(value: T, authority: Authority, citation: string): Rule<T> {
  return Object.freeze({ value: deepFreeze(value), authority, citation });
}

export function isAuthority(value: unknown): value is Authority {
  return typeof value === "string" && (AUTHORITIES as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
