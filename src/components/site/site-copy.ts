/**
 * Every word on the public home page, in one place so the word budget and the copy rules
 * (docs/architecture.md, "Copy rules") can be checked at a glance and in tests.
 *
 * Facts come only from the product spec: the credit starts January 1, 2027; comments on the proposed rules
 * are due December 1, 2026; state SGO lists are due February 15, 2027; the cap is $1,700 per taxpayer; the
 * income limit is 300% of area median gross income; Texas has 254 counties; families do not pay; full
 * Social Security numbers are never stored; income limits stay provisional until the IRS publishes its own.
 */

export interface SiteLink {
  href: string;
  label: string;
}

export const SITE_CTA: SiteLink = { href: "/sgo/signup", label: "Open a test workspace" };

export const HERO = {
  label: "IRC § 25F · Texas first",
  headline: ["Verify income", "once."],
  line: "Income verification and tax-credit giving for the federal scholarship tax credit. Starting in Texas.",
} as const;

/** Dated facts for the ticker: [label, value]. */
export const TICKER: ReadonlyArray<readonly [string, string]> = [
  ["Credit starts", "Jan 1, 2027"],
  ["Comments due", "Dec 1, 2026"],
  ["State SGO lists due", "Feb 15, 2027"],
  ["Cap", "$1,700 per taxpayer"],
  ["Limit", "300% of area median"],
  ["Texas", "254 counties"],
];

export const MELT = {
  label: "How it works",
  headline: ["Paperwork in.", "Answer out."],
  captions: ["Upload or connect", "Check the county limit", "Eligible, not eligible, or reviewed by a person"],
} as const satisfies { label: string; headline: readonly string[]; captions: readonly [string, string, string] };

export const PIECES = {
  label: "The product",
  headline: "Three pieces.",
  items: [
    { name: "Donor checkout", line: "Give, and see the credit math." },
    { name: "Family intake", line: "Verify once, reuse with consent." },
    { name: "Verification core", line: "County limits, evidence, an API." },
  ],
} as const;

export const HONEST = {
  label: "Ground rules",
  headline: "Honest by default.",
  chips: ["Proposed rules, not final", "Provisional limits until the IRS publishes", "Eligible is not an award", "Families never pay", "No full SSNs stored"],
} as const;

export const ENTRIES = {
  label: "Start here",
  headline: "Pick a door.",
  tiles: [
    { href: "/give", title: "Give", line: "Fund Texas scholarship organizations." },
    { href: "/family", title: "Apply", line: "Check your household once." },
    { href: "/sgo", title: "Verify applicants", line: "Decisions with evidence attached." },
    { href: "/partner", title: "Add the button", line: "A scholarship path at checkout." },
  ],
} as const;

export const CLOSING = {
  headline: ["Fewer forms.", "Clear answers."],
} as const;

/** All visible words of the page body (header and footer excluded), for the word-budget test. */
export function pageBodyText(): string {
  return [
    HERO.label,
    ...HERO.headline,
    HERO.line,
    ...TICKER.flat(),
    MELT.label,
    ...MELT.headline,
    ...MELT.captions,
    PIECES.label,
    PIECES.headline,
    ...PIECES.items.flatMap((i) => [i.name, i.line]),
    HONEST.label,
    HONEST.headline,
    ...HONEST.chips,
    ENTRIES.label,
    ENTRIES.headline,
    ...ENTRIES.tiles.flatMap((t) => [t.title, t.line]),
    ...CLOSING.headline,
    SITE_CTA.label,
  ].join(" ");
}

/** Words as a reader counts them: runs of letters or digits (so "$1,700" is one word and "·" is none). */
export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}$,.%'’-]*/gu) ?? []).length;
}

/** The page's word budget, from the brief ("about 180 words, excluding header and footer"). */
export const WORD_BUDGET = 180;
