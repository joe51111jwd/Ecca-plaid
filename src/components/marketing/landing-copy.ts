import { BRAND } from "@/lib/brand";

/**
 * Every sentence on the public landing page, in one reviewable place.
 *
 * COPY RULES (docs/architecture.md → "Copy rules"). Each legal or tax statement below is limited to what
 * the build spec's "Context and constraints" and "Piece 1" sections say, and is tagged with where it
 * comes from. Do not strengthen these sentences:
 *   - proposed-regulation content says "under the proposed rules";
 *   - a gift is never called "free";
 *   - nothing implies the IRS income-limit table or the IRS SGO list has been published;
 *   - no statistics, testimonials, logos or partner names.
 *
 * The section 25F figures repeated here (cap, joint-return amount, start date, carryforward years) are
 * owned by src/taxmath. When that module's constants change, this file must change with them; bump
 * LANDING_COPY_VERSION on every edit so a review can be tied to a version.
 */
export const LANDING_COPY_VERSION = "2026-11-18.1";

export const LANDING = {
  hero: {
    eyebrow: "Federal scholarship tax credit · Texas first",
    title: "Verify a family’s income once. Give with the tax math in plain view.",
    lead: `${BRAND.name} is built for the federal scholarship tax credit — section 25F of the tax code — starting in Texas: income verification for scholarship organizations, a giving checkout that shows how the credit works, and a scholarship handoff for camps and schools.`,
    chooserTitle: "Where would you like to start?",
  },

  entries: [
    {
      key: "donor",
      href: "/give",
      title: "I want to give",
      body: "Give to a scholarship organization and see how the federal credit would apply before you pay.",
      // Spec, Context: "Gifts before that date do not earn the credit."
      note: "Gifts made before January 1, 2027 do not earn the credit.",
    },
    {
      key: "family",
      href: "/family",
      title: "I’m a family applying for a scholarship",
      body: "Confirm your household income once, by uploading a document or connecting an account.",
      // Spec, Business model: "Families do not pay to verify or to be connected to an SGO."
      note: "Families never pay.",
    },
    {
      key: "sgo",
      href: "/sgo",
      title: "I run a scholarship organization",
      body: "Get a clear result for each applicant — eligible, not eligible or needs review — with an evidence pack for your records.",
      note: "Use the dashboard, or connect by API.",
    },
    {
      key: "partner",
      href: "/partner",
      title: "I run a camp or school",
      body: "Let a family apply to a partner scholarship organization while they book, and hold their spot while income is checked.",
      // Spec, Piece 2 risks: "An award from an SGO is not automatic once income is verified."
      note: "An award is always the scholarship organization’s decision.",
    },
  ],

  example: {
    label: "Example — not a real household",
    title: "Income verification result",
    household: "Household of 4",
    county: "Harris County, Texas",
    // Spec, Piece 3 (illustration): Houston-area FY 2026 median family income $104,000; 300% = $312,000.
    // At family size 4 the HUD multiplier is 1.00, so the illustrative limit equals 300% of the median.
    limitLabel: "Income limit used",
    limitCents: 31_200_000,
    limitHint: "300% of the area median for a household of 4, from HUD FY 2026 income limits.",
    methodLabel: "Method",
    method: "Benefit award letter",
    evidenceLabel: "Evidence pack",
    evidence: "PDF and signed data file",
    footnote: "A result is not an award. Awards are decided by the scholarship organization.",
  },

  facts: {
    title: "The rules this is built on",
    items: [
      {
        // Spec, Context: "$1,700 Federal credit cap per taxpayer. Up to $3,400 on a joint return if each spouse contributes."
        // Spec, Piece 1: joint-return treatment is "under the proposed regulations".
        figure: "$1,700",
        label: "Federal credit cap per taxpayer",
        hint: "Under the proposed rules, up to $3,400 on a joint return if each spouse contributes.",
      },
      {
        // Spec, Context: "300% Household income cap. Of area median gross income, prior calendar year."
        figure: "300%",
        label: "Household income cap",
        hint: "Of area median gross income, measured for the calendar year before the application.",
      },
      {
        // Spec, Context: "Jan 1, 2027 Credit and verification go live. Gifts before that date do not earn the credit."
        figure: "Jan 1, 2027",
        label: "The credit begins",
        hint: "Gifts made before that date do not earn the credit.",
      },
    ],
  },

  verification: {
    eyebrow: "For families and scholarship organizations",
    title: "How verification works",
    lead: "Three steps. Most of it happens on a phone, in English or Spanish.",
    steps: [
      {
        title: "The family agrees to share",
        body: "A parent signs in with a link sent by email — no password to remember. They read, in plain language, who will receive what, for what purpose and for how long, and agree.",
      },
      {
        title: "They show their income",
        // Spec, Piece 2: upload list and the auto-submit path; "fall back to upload without starting over".
        body: "Upload a benefits award letter (SNAP, TANF, WIC, Section 8 or SSI) dated within the last 12 months, or last year’s tax return, IRS transcript, W-2s or pay stubs. Where it is available, a parent can connect a payroll or bank account instead. If connecting does not work, uploading still does — without starting over.",
      },
      {
        title: "The scholarship organization gets an answer",
        // Architecture, "Rules that must hold everywhere" 1–4.
        body: "Eligible, not eligible, or needs review — with the income limit that was used, where it came from, and an evidence pack: a readable PDF and a signed data file. A document that cannot be read with confidence goes to a person for review. It is never a silent yes.",
      },
    ],
    footnote: "Verification is not an award. Whether to award a scholarship, and how much, is decided separately by the scholarship organization.",
    familyCta: "Start or continue an application",
    sgoCta: "See the organization dashboard",
  },

  donor: {
    eyebrow: "For donors",
    title: "The credit, explained before you pay",
    lead: "The checkout shows how the federal credit would apply to your gift. It is a preview, not tax advice, and it never guesses what you owe in tax.",
    // Spec, Piece 1, "The math that has to be on the page".
    points: [
      "It is a nonrefundable federal income tax credit for cash gifts to scholarship granting organizations, for gifts made on or after January 1, 2027.",
      "It generally equals what you give, up to $1,700 per taxpayer, reduced by any state tax credit you are allowed for the same gift.",
      "Under the proposed rules, spouses filing jointly are treated as separate taxpayers, so a couple can reach $3,400 if each spouse contributes.",
      "It cannot be more than your federal income tax for the year. Unused credit may be carried forward for up to five years.",
      "The part of a gift you take as a credit cannot also be deducted as a charitable contribution.",
      "A gift cannot be earmarked for a named student, and checkout is for individuals only.",
    ],
    // Architecture, "Money rules": the designated amount and any platform fee are always separate lines.
    feeNote: "If a platform fee ever applies, it is shown as its own line and is never described as part of your contribution.",
    cta: "Go to the giving page",
    legalTitle: "Preview, not tax advice",
    legal: "What the credit is worth to you depends on your own tax situation. Talk to a tax professional about yours.",
  },

  partner: {
    eyebrow: "For camps, schools and other programs",
    title: "A scholarship option at the moment of booking",
    lead: "Add a button or a link to your booking page. A family who needs help can apply to a partner scholarship organization and verify their income without losing their place.",
    points: [
      {
        title: "The spot is held, not dropped",
        body: "While income is being checked, the reservation is held for a stated window instead of the sale silently falling through.",
      },
      {
        title: "You hear what happened",
        body: "Your booking system can be notified when a booking is held, found eligible, awarded or declined.",
      },
      {
        title: "Families never pay a fee",
        // Spec, Business model §2.
        body: "The business is billed on its own account. The fee is never taken from the family and never deducted from scholarship funds.",
      },
    ],
    // Spec, Piece 2 risks: "Qualified expenses and what counts as a school are still being defined ... A summer camp may or may not be a qualifying use in the final rules."
    caveat: "What counts as a qualifying expense is still being defined in the rules. A given program may or may not qualify once they are final.",
    cta: "See how the handoff works",
    illustration: {
      label: "Example — not a real booking",
      business: "Camp Cedar Creek",
      booking: "Session 2 · June 8–12",
      held: "Your spot is held while your scholarship application is reviewed.",
      stagesLabel: "What the business sees as it moves along",
    },
  },

  honesty: {
    title: "What is settled, and what is not",
    lead: "We would rather tell you plainly than have you find out later.",
    items: [
      {
        title: "The regulations are not final",
        // Spec, Context: proposed + temporary regulations Oct 2, 2026; comments due Dec 1, 2026; final rules may change methods.
        body: "Treasury and the IRS published proposed and temporary regulations on October 2, 2026. Comments are due December 1, 2026, and the final rules may change details, including which ways of verifying income are allowed.",
      },
      {
        title: "Income limits are provisional",
        // Spec, Piece 3: IRS anticipates publishing limitations by area and family size; until then HUD-derived, labeled provisional.
        body: "The proposed rules say the IRS expects to publish income limits by area and family size each year. Until it does, the limits used here are calculated from HUD income-limit data, and every result that relies on them is labeled provisional.",
      },
      {
        title: "The list of scholarship organizations is provisional",
        // Spec, Context: "Feb 15, 2027 State SGO lists due to the IRS (2027 transition deadline under the temporary regulations)".
        body: "For 2027, states’ lists of scholarship organizations are due to the IRS by February 15, 2027. Until the IRS list is public, the organizations shown here are a curated list, labeled provisional.",
      },
      {
        title: "Credit-eligible giving has not started",
        // Architecture, "Money rules": checkout held behind the credit start date; sandbox gifts are marked not credit-eligible.
        body: "The credit applies to gifts made on or after January 1, 2027. Before then, the checkout can be tried in a sandbox where no money moves, and gifts are plainly marked as not eligible for the credit.",
      },
    ],
  },

  care: {
    title: "Family information, handled with care",
    items: [
      {
        title: "Shared only with consent",
        body: "A result goes only to the organization the parent approved, for the purpose and the period stated on the consent screen.",
      },
      {
        title: "Encrypted, then deleted",
        // Architecture: object storage is encrypted; raw uploads are purged after the SGO's retention window; hashes and extracted fields are kept.
        body: "Uploaded documents are stored encrypted. The raw files are deleted after a retention period set with the scholarship organization; the decision, the fields read from the documents and each file’s fingerprint are kept as the record.",
      },
      {
        title: "Some things are never stored",
        // Architecture, "Never stored".
        body: "Full Social Security numbers, card numbers and bank passwords are never stored.",
      },
    ],
  },

  developers: {
    eyebrow: "For developers",
    title: "Plug verification into your own system",
    lead: "A small HTTP API with keys and signed webhooks. Create a verification, send the family their link, and get an event when the result is ready. Test mode needs no real data.",
    cta: "Read the API reference",
    sampleTitle: "What a decision tells you",
    sampleNote: "Illustrative. Exact field names are in the API reference.",
    // Values only (all from the data model): event name, status / method / threshold-source values, key prefix.
    sample: [
      "Authorization: Bearer ecca_test_…",
      "",
      "event             verification.decided",
      "status            eligible | ineligible | needs_review",
      "method            direct | categorical",
      "threshold_source  hud_provisional | irs_published",
      "evidence          PDF + signed JSON",
    ].join("\n"),
  },
} as const;
