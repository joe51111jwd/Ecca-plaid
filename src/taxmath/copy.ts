/**
 * The versioned registry of every sentence a donor (or an SGO) is shown about the section 25F credit.
 *
 * Rules for this file:
 *  - One entry per sentence or label, with the authority it rests on and a citation. An entry is tagged
 *    `proposed_reg` if ANY part of it is derived from the proposed regulations, and a `proposed_reg`
 *    statement must say so in its own words ("under the proposed rules"), so it stays accurate when it is
 *    copied out of the panel into an email or a receipt.
 *  - No number is typed into a sentence. Amounts and periods that come from `./constants` are written as
 *    constant placeholders ({cap}, {jointCap}, {carryforwardYears}, ...) and filled in from the rule values.
 *  - The words "free", "costs you nothing", "guaranteed" and "no cost" may appear only in a sentence that
 *    also carries the nonrefundable, tax-liability, cap and fee qualifiers. The over-cap amount is never
 *    "deductible", only "may be deductible ... if it meets the requirements of section 170".
 *  - Nothing here says or implies that the IRS SGO list is published. The two entries that describe an
 *    organization as being on the IRS list are gated (`onlyWhen: "irs_list_is_source"`) and refuse to render
 *    unless the caller states that the IRS-published list is the list in use.
 *  - Changing any word requires bumping COPY_VERSION (a test pins the registry hash to the version).
 *
 * `banned-claims.test.ts` enforces these rules over the whole registry.
 */
import { AppError } from "@/lib/errors";
import { formatUsd } from "@/lib/money";
import {
  ACKNOWLEDGMENT_REFERENCE as ACK,
  DONOR_RULES_REFERENCE as REF,
  IRS_INDIVIDUALS_PAGE_CITATION as IRS_PAGE,
  PROPOSED_REG_CITATION as NPRM,
  PROPOSED_RULE_ID,
  STATUTE_CITATION as STATUTE,
  TEMPORARY_REG_CITATION as TD,
  type Authority,
} from "./authority";
import {
  ACKNOWLEDGMENT_DEADLINE,
  CARRYFORWARD_YEARS,
  CLAIM_FORM,
  CLAIM_FORM_FIRST_FILING_SEASON,
  CREDIT_CAP_PER_TAXPAYER_CENTS,
  FIRST_ELIGIBLE_DATE,
  JOINT_RETURN_MAX_CREDIT_CENTS,
  LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS,
  STATE_SGO_LIST_DEADLINE_2027,
  SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS,
  SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD,
} from "./constants";
import { formatIsoDateLong, formatMonthDayLong } from "./dates";
import { sha256Hex, stableStringify } from "./hash";

/** Version of the words below. Stored with every designation, consent, receipt and preview snapshot. */
export const COPY_VERSION = "25f-copy.2026-11-18.v1";

export const COPY_LOCALES = ["en", "es"] as const;
export type CopyLocale = (typeof COPY_LOCALES)[number];

/**
 * label       a short caption for a line, field or heading
 * statement   a full sentence that states a rule, a fact or a product behaviour
 * attestation first-person words the donor confirms
 */
export type CopyKind = "label" | "statement" | "attestation";

/** Who reads the entry: the donor at checkout, or SGO staff in the dashboard. */
export type CopyAudience = "donor" | "sgo";

/** A fact about the world that must be true before an entry may be shown. */
export type CopyCondition = "irs_list_is_source";

interface CopyDefinition {
  readonly kind: CopyKind;
  readonly audience: CopyAudience;
  /** English text. Placeholders are written {likeThis}. */
  readonly text: string;
  /** Spanish text with exactly the same placeholders. Add it per entry when a reviewed translation exists. */
  readonly es?: string;
  readonly authority: Authority;
  readonly citation: string;
  readonly onlyWhen?: CopyCondition;
}

const BUILD_SPEC = "Build spec (Three Pieces to Build), Piece 1";

/* ------------------------------------------------------------------ the words */

const DEFINITIONS = {
  /* ---------- panel headings ---------- */
  "panel.title": {
    kind: "label",
    audience: "donor",
    text: "Federal tax credit preview",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Label the panel as a preview, not tax advice."`,
  },
  "panel.heading.individual": {
    kind: "label",
    audience: "donor",
    text: "Your contribution",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel.`,
  },
  "panel.heading.spouse_1": {
    kind: "label",
    audience: "donor",
    text: "First spouse",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: joint-return split.`,
  },
  "panel.heading.spouse_2": {
    kind: "label",
    audience: "donor",
    text: "Second spouse",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: joint-return split.`,
  },
  "panel.heading.joint_total": {
    kind: "label",
    audience: "donor",
    text: "Joint return",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: joint-return split.`,
  },
  "panel.heading.liability": {
    kind: "label",
    audience: "donor",
    text: "With the tax estimate you entered",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Do not invent the donor's tax liability." [${REF} F30a]`,
  },

  /* ---------- panel lines ---------- */
  "line.designated": {
    kind: "label",
    audience: "donor",
    text: "Designated as a section 25F qualified contribution",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41]`,
  },
  "line.goods_or_services": {
    kind: "label",
    audience: "donor",
    text: "Less: value of goods or services the organization provides in return",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F45]`,
  },
  "line.other_qualified_contributions": {
    kind: "label",
    audience: "donor",
    text: "Plus: your other qualified contributions this tax year",
    authority: "statute",
    citation: `${STATUTE}(a): the aggregate of qualified contributions made during the taxable year. [${REF} F10]`,
  },
  "line.qualified_contribution": {
    kind: "label",
    audience: "donor",
    text: "Qualified contributions for the year",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}); ${STATUTE}(a). [${REF} F10, F41, F45]`,
  },
  "line.state_credit_reduction": {
    kind: "label",
    audience: "donor",
    text: "Less: State tax credit applied against your qualified contribution",
    authority: "proposed_reg",
    citation: `${STATUTE}(b)(2); amount computed under Prop. Treas. Reg. 1.25F-2(c)(1) and (c)(2) (${NPRM}). [${REF} F12, F22, F23]`,
  },
  "line.over_cap": {
    kind: "label",
    audience: "donor",
    text: "Less: amount above the {cap} limit (no federal credit)",
    authority: "statute",
    citation: `${STATUTE}(b)(1). [${REF} F11]`,
  },
  "line.estimated_credit": {
    kind: "label",
    audience: "donor",
    text: "Estimated federal credit, before the tax-liability limit",
    authority: "statute",
    citation: `${STATUTE}(a), (b). [${REF} F10, F11, F12]`,
  },
  "line.credit_added_by_this_gift": {
    kind: "label",
    audience: "donor",
    text: "Part of that credit added by this gift",
    authority: "statute",
    citation: `${STATUTE}(a), (b)(1): one limit for the year's total. [${REF} F10, F11]`,
  },
  "line.non_designated": {
    kind: "label",
    audience: "donor",
    text: "Not designated (an ordinary gift, not a qualified contribution)",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): qualified only "to the extent" designated. [${REF} F41; ${ACK} F12a]`,
  },
  "line.state_credit_absorbed": {
    kind: "label",
    audience: "donor",
    text: "State tax credit applied first to the part you did not designate",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(c)(2) (${NPRM}). [${REF} F23]`,
  },
  "line.joint_total_credit": {
    kind: "label",
    audience: "donor",
    text: "Combined estimated credit on a joint return, before the tax-liability limit",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(a) and Example 2 (${NPRM}). [${REF} F15, F19]`,
  },
  "line.liability_limit": {
    kind: "label",
    audience: "donor",
    text: "Tax-liability limit, from the figures you entered",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(d) (${NPRM}); the limit itself is the donor's own estimate. [${REF} F30, F30a]`,
  },
  "line.carryforward_available": {
    kind: "label",
    audience: "donor",
    text: "Unused credit carried forward from earlier years",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F31]`,
  },
  "line.carryforward_expired": {
    kind: "label",
    audience: "donor",
    text: "Carried-forward credit that has expired",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F32]`,
  },
  "line.carryforward_used": {
    kind: "label",
    audience: "donor",
    text: "Carried-forward credit used this year, oldest first",
    authority: "proposed_reg",
    citation: `${STATUTE}(f) (first-in first-out); used before the current year's credit under Prop. Treas. Reg. 1.25F-2(e)(3) (${NPRM}). [${REF} F32, F33]`,
  },
  "line.current_year_credit_used": {
    kind: "label",
    audience: "donor",
    text: "This year's credit used this year",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(d), (e)(3) (${NPRM}). [${REF} F30, F33]`,
  },
  "line.total_credit_used": {
    kind: "label",
    audience: "donor",
    text: "Estimated credit used on this year's return",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(d), (e) (${NPRM}). [${REF} F30, F33, F34]`,
  },
  "line.new_carryforward": {
    kind: "label",
    audience: "donor",
    text: "This year's credit carried forward to later years",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F31, F34]`,
  },
  "line.expiring_unused": {
    kind: "label",
    audience: "donor",
    text: "Carried-forward credit that expires unused after this year",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F32]`,
  },
  "line.carried_to_next_year": {
    kind: "label",
    audience: "donor",
    text: "Total unused credit carried to next year",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F31, F32]`,
  },

  /* ---------- panel fields ---------- */
  "field.designated.label": {
    kind: "label",
    audience: "donor",
    text: "Amount to designate as a section 25F qualified contribution",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41]`,
  },
  "field.state_credit.label": {
    kind: "label",
    audience: "donor",
    text: "State tax credit you expect for this gift, if any",
    authority: "statute",
    citation: `${STATUTE}(b)(2). [${REF} F22]`,
  },
  "field.state_credit.help": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, count the full State tax credit you expect to be allowed for this gift on any State tax return, including any part your State would carry to another year. A State tax deduction, as opposed to a credit, generally does not reduce the federal credit.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-1 (definition of State credit) and preamble (${NPRM}). [${REF} F22, F24]`,
  },
  "field.other_contributions.label": {
    kind: "label",
    audience: "donor",
    text: "Other qualified contributions you make this tax year, to any organization (optional)",
    authority: "statute",
    citation: `${STATUTE}(a). [${REF} F10]`,
  },
  "field.other_contributions.help": {
    kind: "statement",
    audience: "donor",
    text: "Include designated gifts to other organizations and any other designated gifts to this one in the same tax year. They share the same {cap} limit.",
    authority: "statute",
    citation: `${STATUTE}(a), (b)(1). [${REF} F10, F11]`,
  },
  "field.liability.label": {
    kind: "label",
    audience: "donor",
    text: "Your own estimate of your federal income tax for the year, before your other nonrefundable credits (optional)",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Do not invent the donor's tax liability." [${REF} F30a]`,
  },
  "field.liability.help": {
    kind: "statement",
    audience: "donor",
    text: "Optional. Enter your own estimate if you want to see how the limit could apply. We never estimate your tax for you.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Do not invent the donor's tax liability." [${REF} F30a; Engineering Implications 1]`,
  },
  "field.other_credits.label": {
    kind: "label",
    audience: "donor",
    text: "Other nonrefundable credits you expect under sections {otherCreditSections} (optional)",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(d) (${NPRM}). [${REF} F30]`,
  },
  "field.filing_status.label": {
    kind: "label",
    audience: "donor",
    text: "Federal filing status for the year of this gift",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: "Filing status, and for a married couple filing jointly a split". [${REF} F15, F21]`,
  },
  "filing_status.single": {
    kind: "label",
    audience: "donor",
    text: "Single",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: filing status. [${REF} F21]`,
  },
  "filing_status.married_joint": {
    kind: "label",
    audience: "donor",
    text: "Married filing jointly",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: filing status. [${REF} F15]`,
  },
  "filing_status.married_separate": {
    kind: "label",
    audience: "donor",
    text: "Married filing separately",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: filing status. [${REF} F21]`,
  },
  "filing_status.head_of_household": {
    kind: "label",
    audience: "donor",
    text: "Head of household",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: filing status. [${REF} F21]`,
  },
  "filing_status.qualifying_surviving_spouse": {
    kind: "label",
    audience: "donor",
    text: "Qualifying surviving spouse",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: filing status. [${REF} F21]`,
  },
  "field.donor_name.help": {
    kind: "statement",
    audience: "donor",
    text: "Enter your name as it appears on your federal income tax return, so the organization's report to the IRS can be matched to your return.",
    authority: "product_policy",
    citation: `A recommendation; the purpose of the report is matching against filed returns. [${REF} F70; Engineering Implications 7]`,
  },
  "field.carryforward.label": {
    kind: "label",
    audience: "donor",
    text: "Unused section 25F credit from earlier years (optional)",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F31]`,
  },

  /* ---------- panel notes ---------- */
  "note.preview_not_tax_advice": {
    kind: "statement",
    audience: "donor",
    text: "This is a preview based only on what you entered. It is not tax advice, and it does not decide whether you can claim the credit; ask a tax professional about your own return.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Label the panel as a preview, not tax advice." [${REF} Engineering Implications 5]`,
  },
  "note.proposed_rules_not_final": {
    kind: "statement",
    audience: "donor",
    text: "Parts of this preview are based on proposed regulations ({proposedRuleId}) that are not final. The final rules may be different.",
    authority: "proposed_reg",
    citation: `${NPRM}; comments due December 1, 2026. [${REF} F64; Engineering Implications 5]`,
  },
  "note.before_credit_start": {
    kind: "statement",
    audience: "donor",
    text: "The federal credit applies only to gifts made on or after {creditStartDate}. A gift made before then does not earn the credit, so the figures here only illustrate how the credit would work for a later gift.",
    authority: "temporary_reg",
    citation: `${TD}, preamble: "Taxpayers may begin making qualified contributions on January 1, 2027"; ${STATUTE} (taxable years ending after December 31, 2026). [${REF} F60, F61]`,
  },
  "note.cap_per_taxpayer": {
    kind: "statement",
    audience: "donor",
    text: "The federal credit is dollar for dollar on your qualified contributions for the year, up to {cap} per taxpayer per tax year, after any State tax credit reduction and subject to the tax-liability limit.",
    authority: "statute",
    citation: `${STATUTE}(a), (b)(1), (b)(2), (f). [${REF} F10, F11, F12; Engineering Implications 10]`,
  },
  "note.cap_is_annual_total": {
    kind: "statement",
    audience: "donor",
    text: "The {cap} limit applies to the total of your qualified contributions for the tax year, to all organizations combined. This preview counts only the amounts entered here.",
    authority: "statute",
    citation: `${STATUTE}(a), (b)(1). [${REF} F10, F11]`,
  },
  "note.other_contributions_assumed_no_state_credit": {
    kind: "statement",
    audience: "donor",
    text: "This preview assumes no State tax credit is allowed for the other qualified contributions you entered.",
    authority: "product_policy",
    citation: `A simplification of the panel; a State credit for any qualified contribution reduces the federal credit. [${REF} F12, F22]`,
  },
  "note.nonrefundable": {
    kind: "statement",
    audience: "donor",
    text: "The credit is nonrefundable: it can only reduce federal income tax you actually owe for the year.",
    authority: "statute",
    citation: `${STATUTE}(a), (f). [${REF} F29, F31]`,
  },
  "note.liability_not_estimated": {
    kind: "statement",
    audience: "donor",
    text: "This preview does not know your federal income tax and never estimates it. If you owe less tax than the credit shown, you can use only part of the credit this year.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, tax-math panel: "Do not invent the donor's tax liability." [${REF} F30a]`,
  },
  "note.liability_limit": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, the credit you can use in a year cannot exceed your tax liability, as defined in section 26(a) of the Internal Revenue Code, after the nonrefundable personal credits allowed under sections {otherCreditSections}.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(d) (${NPRM}). [${REF} F30]`,
  },
  "note.carryforward": {
    kind: "statement",
    audience: "donor",
    text: "Credit you cannot use in a year because of the tax-liability limit carries forward for up to {carryforwardYears} tax years and is used oldest first; after that it expires.",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F31, F32]`,
  },
  "note.carryforward_before_current": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, credit carried forward from earlier years is used before the credit from this year's contributions.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(e)(3) (${NPRM}). [${REF} F33]`,
  },
  "note.carryforward_expired": {
    kind: "statement",
    audience: "donor",
    text: "Credit carried forward from more than {carryforwardYears} tax years ago has expired and is not counted.",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F32]`,
  },
  "note.carryforward_expiring": {
    kind: "statement",
    audience: "donor",
    text: "Some of your carried-forward credit is in its last usable year: whatever is not used this year expires.",
    authority: "statute",
    citation: `${STATUTE}(f). [${REF} F32]`,
  },
  "note.liability_estimate_basis": {
    kind: "statement",
    audience: "donor",
    text: "The figures in this section use the tax estimate you entered. We did not calculate or check it.",
    authority: "product_policy",
    citation: `The sources never reproduce section 26(a), so the limit is taken as the donor's estimate. [${REF} F30a; Engineering Implications 1]`,
  },
  "note.section_170_no_double_benefit": {
    kind: "statement",
    audience: "donor",
    text: "A qualified contribution for which the credit is allowed cannot also be taken as a charitable contribution deduction under section 170.",
    authority: "statute",
    citation: `${STATUTE}(e). [${REF} F35]`,
  },
  "note.carried_forward_not_deductible": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, credit that is carried forward still counts as allowed, so the contribution behind it is not deductible either.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(f) (${NPRM}). [${REF} F36]`,
  },
  "note.excess_may_be_deductible": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, any part of a qualified contribution for which no credit is allowed, such as the part above the {cap} limit, may be deductible as a charitable contribution if it meets the requirements of section 170.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(f) and Examples 1 and 2 (${NPRM}). [${REF} F37, F37a, F73, F74]`,
  },
  "note.over_cap_designation": {
    kind: "statement",
    audience: "donor",
    text: "The qualified contributions entered for one taxpayer come to more than {cap} for the year. For a given total gift, designating more than {cap} does not increase that taxpayer's federal credit for any year: under the proposed rules, the amount above the limit is not carried forward. Everything you designate stays designated and is deposited in the organization's section 25F account.",
    authority: "proposed_reg",
    citation: `${STATUTE}(b)(1); preamble and Example 5 of ${NPRM}; derived for a fixed total gift from Prop. Treas. Reg. 1.25F-2(c). [${REF} F34, F43; Engineering Implications 3]`,
  },
  "note.state_credit_reduction": {
    kind: "statement",
    audience: "donor",
    text: "The federal credit is reduced by any State tax credit allowed on a State tax return for the same qualified contributions.",
    authority: "statute",
    citation: `${STATUTE}(b)(2). [${REF} F22]`,
  },
  "note.state_credit_ordering": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, a State tax credit is treated as applying first to the part of your gift that you did not designate; only what is left over reduces your qualified contributions, and that reduction is made before the {cap} limit is applied.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(c)(1), (c)(2) (${NPRM}). [${REF} F13, F23]`,
  },
  "note.state_credit_assumed_whole_gift": {
    kind: "statement",
    audience: "donor",
    text: "This preview assumes the State tax credit you entered is allowed for your whole gift to this organization, including any part you did not designate.",
    authority: "product_policy",
    citation: `Whether a State credit also covers the non-designated part depends on State law, which the checkout does not evaluate. [${REF} F23, F76; Engineering Implications 1]`,
  },
  "note.state_credit_spillover_estimate": {
    kind: "statement",
    audience: "donor",
    text: "Your State tax credit is larger than the part of your gift you did not designate, so this preview subtracts the difference from your qualified contribution. The proposed regulations describe this ordering but give no worked example of this case, so treat the result as an estimate.",
    authority: "product_policy",
    citation: `Extrapolation of Prop. Treas. Reg. 1.25F-2(c)(2). [${REF} Engineering Implications 1, fact-check note (i); Open Questions 25]`,
  },
  "note.state_credit_offset_not_deductible_here": {
    kind: "statement",
    audience: "donor",
    text: "This preview does not treat the part of your qualified contribution that is offset by a State tax credit as deductible; the section 25F rules do not settle that question.",
    authority: "product_policy",
    citation: `The sources give no example and no assurance for this amount. [${REF} F38; Engineering Implications 1, fact-check note (iii)]`,
  },
  "note.goods_or_services": {
    kind: "statement",
    audience: "donor",
    text: "The value of any goods or services the organization gives you in return for your gift is subtracted to arrive at your qualified contribution.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F45]`,
  },
  "note.joint_each_spouse": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, the limit is {cap} for each spouse who makes a qualified contribution, so a joint return can show up to {jointCap} only if both spouses make qualified contributions. This joint-return treatment is in proposed regulations and IRS guidance and is not yet final.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(a) and Example 2 (${NPRM}); ${IRS_PAGE}. [${REF} F15, F16; Engineering Implications 4]`,
  },
  "note.one_spouse_only": {
    kind: "statement",
    audience: "donor",
    text: "Only one spouse is making a qualified contribution here, so this preview applies one {cap} limit. Under the proposed rules the limit belongs to each spouse who makes a qualified contribution: one spouse's gift cannot use the other spouse's limit, so {jointCap} is not available when only one spouse gives.",
    authority: "proposed_reg",
    citation: `Inference from Prop. Treas. Reg. 1.25F-2(a) ("separate taxpayers") and the preamble ("provided that each spouse has made qualified contributions") of ${NPRM}; the sources give no example. [${REF} F16; Open Questions 3]`,
  },
  "note.joint_combined_limit": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, both spouses' credits on a joint return are added together and tested against one combined tax-liability limit.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2, Example 2 (${NPRM}). [${REF} F19]`,
  },
  "note.joint_carryforward_pool": {
    kind: "statement",
    audience: "donor",
    text: "The rules do not say how carried-forward credit is divided between spouses, so this preview treats it as one pool for the joint return.",
    authority: "product_policy",
    citation: `Not in the sources. [${REF} Engineering Implications 1; Open Questions 17]`,
  },
  "note.fee_not_part_of_contribution": {
    kind: "statement",
    audience: "donor",
    text: "The service fee is a separate charge. It is not part of your contribution, it is not designated as a qualified contribution, and the federal credit does not cover it.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, fee and settlement: "show any platform fee as its own line and do not describe the fee as part of the qualified contribution." [${REF} Engineering Implications 8]`,
  },
  "note.what_to_keep": {
    kind: "statement",
    audience: "donor",
    text: "Keep the official written acknowledgment the organization sends you. It is due by {acknowledgmentDeadline} of the year after your gift and includes your unique donor number.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1) (${TD}). [${REF} F67, F68]`,
  },
  "note.claim_form": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, you claim the credit on {claimForm}, {claimFormTitle}, reporting the unique donor number from each organization's acknowledgment; if a number is missing, the IRS would presume you made no qualified contribution to that organization unless you show otherwise.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2 (substantiation and presumption) (${NPRM}). [${REF} F65, F66]`,
  },
  "note.claim_form_availability": {
    kind: "statement",
    audience: "donor",
    text: "According to the IRS, {claimForm} will be available for the {claimFormFilingSeason} filing season, for contributions made during calendar year {firstCreditYear}.",
    authority: "irs_web",
    citation: `${IRS_PAGE}. [${REF} F65]`,
  },
  "note.recordkeeping": {
    kind: "statement",
    audience: "donor",
    text: "Treasury's explanation of the proposed rules says to keep records of your qualified contributions, any State tax credit you take for them, and any unused credit you carry forward.",
    authority: "proposed_reg",
    citation: `Paperwork Reduction Act discussion in the preamble of ${NPRM}. [${REF} F71]`,
  },
  "note.year_end_timing": {
    kind: "statement",
    audience: "donor",
    text: "The tax year of a gift depends on when the gift is made. The section 25F rules do not yet spell out the exact moment, or the time zone, for a payment made close to midnight on December 31.",
    authority: "product_policy",
    citation: `Not in the section 25F sources. [${REF} F62; Engineering Implications 9; Open Questions 1]`,
  },

  /* ---------- designation ---------- */
  "designation.required": {
    kind: "statement",
    audience: "donor",
    text: "A gift counts toward the credit only to the extent you designate it to the organization as a section 25F qualified contribution at the time you make it. You may designate all or only part of your payment.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41]`,
  },
  "designation.statement": {
    kind: "attestation",
    audience: "donor",
    text: "I designate {designatedAmount} of this payment to {sgoName} as a qualified contribution under Internal Revenue Code section 25F.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). The sources prescribe no wording for the designation; these words are the product's. [${REF} F41, F42; Engineering Implications 3]`,
  },
  "designation.statement_joint": {
    kind: "attestation",
    audience: "donor",
    text: "This payment is made on behalf of both spouses. {spouse1Name} designates {spouse1Amount} and {spouse2Name} designates {spouse2Amount} of this payment to {sgoName} as qualified contributions under Internal Revenue Code section 25F.",
    authority: "irs_web",
    citation: `${IRS_PAGE}: spouses making simultaneous qualified contributions "should provide both names to the SGO and indicate to the SGO the donation is on behalf of both spouses"; designation under Temp. Treas. Reg. 1.25F-1T(a)(12). The combined-payment route appears only on the IRS page. [${REF} F17, F17a, F41]`,
  },
  "designation.non_designated_remainder": {
    kind: "statement",
    audience: "donor",
    text: "The remaining {nonDesignatedAmount} of this payment is an ordinary gift to {sgoName}. It is not a qualified contribution and does not count toward the federal credit.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): qualified only "to the extent" designated. [${REF} F41; ${ACK} F12a]`,
  },
  "designation.irrevocable": {
    kind: "statement",
    audience: "donor",
    text: "This designation is irrevocable. Once you pay, it cannot be undone or changed.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): "Such designation, once made, is irrevocable." [${REF} F42]`,
  },
  "designation.deposit_regardless": {
    kind: "statement",
    audience: "donor",
    text: "Treasury's explanation of the proposed rules says a designated contribution is deposited in the organization's separate section 25F account whether or not you end up receiving a credit.",
    authority: "proposed_reg",
    citation: `Preamble of ${NPRM}. [${REF} F43]`,
  },
  "designation.default_explained": {
    kind: "statement",
    audience: "donor",
    text: "We filled in the lesser of your gift and {cap} per taxpayer as a starting point. You can change it.",
    authority: "product_policy",
    citation: `Pre-fill only; a higher designation is allowed. [${REF} Engineering Implications 3]`,
  },

  /* ---------- attestations ---------- */
  "attest.individual": {
    kind: "attestation",
    audience: "donor",
    text: "I am making this gift personally, as an individual. It is not from a business, partnership, S corporation, trust, estate, donor-advised fund or foundation.",
    authority: "proposed_reg",
    citation: `${STATUTE}(a) ("individual"); Temp. Treas. Reg. 1.25F-1T(a)(12) ("made by an individual"); Prop. Treas. Reg. 1.25F-2(a)(3) (partnerships and S corporations) (${NPRM}). Other entity types are excluded as a cautious product choice. [${REF} F1, F4, F5, F6]`,
  },
  "attest.us_citizen_or_resident": {
    kind: "attestation",
    audience: "donor",
    text: "I am a U.S. citizen or a U.S. resident for federal income tax purposes.",
    authority: "statute",
    citation: `${STATUTE}(a): "an individual who is a citizen or resident of the United States". The checkout takes an attestation and does not decide residency. [${REF} F1, F2]`,
  },
  "attest.no_earmark": {
    kind: "attestation",
    audience: "donor",
    text: "I understand that my gift cannot be earmarked or set aside for any particular student, and I am not asking for that.",
    authority: "statute",
    citation: `${STATUTE}(c)(5): an SGO "does not earmark or set aside contributions for scholarships on behalf of any particular student". [${REF} F48]`,
  },
  "attest.not_in_exchange": {
    kind: "attestation",
    audience: "donor",
    text: "I am not making this gift in exchange for, or on the condition of, a scholarship for any particular student.",
    authority: "product_policy",
    citation: `A prudent addition derived from the charitable-contribution requirement, the earmarking ban and the loss of list reliance for an involved donor. [${REF} F40, F48, F55; Engineering Implications 6]`,
  },
  "attest.joint_on_behalf_of_both": {
    kind: "attestation",
    audience: "donor",
    text: "This payment is made on behalf of both spouses, and we expect to file a joint federal income tax return for the year of this gift.",
    authority: "irs_web",
    citation: `${IRS_PAGE}. [${REF} F17]`,
  },
  "attest.e_delivery_consent": {
    kind: "attestation",
    audience: "donor",
    text: "I agree to receive my official written acknowledgment from {sgoName} electronically at {email}. I can withdraw this consent before the acknowledgment is sent; if I do, it will be mailed to me on paper.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1) (${TD}): electronic delivery "if the donor consents to receive the statement electronically and does not withdraw the consent before the statement is furnished". The sources prescribe no consent wording or withdrawal mechanism. [${REF} F68; ${ACK} F10, E1 item 5]`,
  },

  /* ---------- notices ---------- */
  "notice.no_earmark": {
    kind: "statement",
    audience: "donor",
    text: "Your gift cannot be earmarked for a named student. A scholarship granting organization may not earmark or set aside contributions for scholarships on behalf of any particular student.",
    authority: "statute",
    citation: `${STATUTE}(c)(5). [${REF} F48]`,
  },
  "notice.individuals_only": {
    kind: "statement",
    audience: "donor",
    text: "This checkout is for individuals only. Under the proposed rules, a gift made through a partnership or S corporation does not count toward the credit.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(a)(3) (${NPRM}). [${REF} F5]`,
  },
  "notice.irs_reporting": {
    kind: "statement",
    audience: "donor",
    text: "The organization must report your name, your address and the total of your qualified contributions for the year to the IRS.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(2) (${TD}). [${REF} F70; ${ACK} F33]`,
  },
  "notice.no_ssn": {
    kind: "statement",
    audience: "donor",
    text: "Treasury's explanation of the proposed rules says the unique donor number avoids the need for organizations to collect a donor's Social Security number, so this checkout does not ask for it.",
    authority: "proposed_reg",
    citation: `Preamble and economic analysis of ${NPRM}. [${REF} F9; ${ACK} F25]`,
  },
  "notice.cash_only": {
    kind: "statement",
    audience: "donor",
    text: "Only cash contributions in U.S. dollars count, such as a card payment, bank transfer, check or money order. Digital assets do not count.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}); cards are named in the preamble as an example of electronic transfer. [${REF} F44]`,
  },
  "notice.donor_state": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, you may give to an organization on any participating State's list, whatever State you live in.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(a) (${NPRM}). [${REF} F7]`,
  },
  "notice.sgo_list_provisional": {
    kind: "statement",
    audience: "donor",
    text: "Provisional list. This list was compiled by {platformName} and is not the IRS list of scholarship granting organizations. Appearing here does not make an organization eligible, and a gift to an organization shown only on this provisional list is not labeled credit-eligible.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, screens: "a provisional curated list until the IRS list is public, clearly labeled as provisional". [${REF} F54a; Engineering Implications 2, gate 7]`,
  },
  "notice.sgo_list_irs": {
    kind: "statement",
    audience: "donor",
    text: "On the IRS list of scholarship granting organizations for {listState}, and not shown as removed, when {platformName} last checked on {listCheckedDate}.",
    authority: "temporary_reg",
    citation: `IRS SGO list: Temp. Treas. Reg. 1.25F-1T and 1.25F-5T(d)(9) (${TD}). [${REF} F58; ${ACK} F63, E5 item 4]`,
    onlyWhen: "irs_list_is_source",
  },
  "notice.list_reliance": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules, a donor may rely on an organization being on the IRS list, and not shown as removed, at the time of the gift, unless the donor knew the organization did not qualify or was responsible for or aware of what later led to its removal. Being listed is not a promise of the credit.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(b) (${NPRM}). [${REF} F54, F55; ${ACK} F67]`,
    onlyWhen: "irs_list_is_source",
  },
  "notice.list_reliance_unavailable": {
    kind: "statement",
    audience: "donor",
    text: "This organization has not authorized the IRS to show it on the public list. Treasury's explanation of the proposed rules says a donor to such an organization cannot rely on that list and would need other evidence that it is a scholarship granting organization.",
    authority: "proposed_reg",
    citation: `Preamble of ${NPRM}; Temp. Treas. Reg. 1.25F-5T(d)(9) (${TD}). [${REF} F57]`,
    onlyWhen: "irs_list_is_source",
  },
  "notice.state_advance_election": {
    kind: "statement",
    audience: "donor",
    text: "{stateName} has made an advance election to participate for {firstCreditYear} and must still submit its list of scholarship granting organizations to the IRS by {stateListDeadline2027}. According to the IRS, taxpayers can't claim the credit for donations in a State until that State has elected to participate and submitted its approved organizations.",
    authority: "irs_web",
    citation: `IRS FSTC participating-states and landing pages ("Advance elections to participate under Section 25F for 2027"); deadline in Temp. Treas. Reg. 1.25F-5T(c)(3)(ii) (${TD}). Use only for a State shown on the IRS advance-election list. [${REF} F8, F8a, F58]`,
  },

  /* ---------- eligibility findings (why a gift is or is not labeled credit-eligible) ---------- */
  "eligibility.credit_eligible": {
    kind: "statement",
    audience: "donor",
    text: "This gift meets this checkout's conditions for the credit-eligible path. Whether you can claim the credit, and how much, depends on your own tax return.",
    authority: "product_policy",
    citation: `The gates are in ${REF}, Engineering Implications 2; passing them is not a determination that the credit is allowed. [${ACK} E1 item 11]`,
  },
  "eligibility.sandbox_mode": {
    kind: "statement",
    audience: "donor",
    text: "Sandbox gift: no money moves, so this is not a real contribution and it is not credit-eligible.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}: sandbox payments before the credit start; a qualified contribution is a contribution of cash (${STATUTE}). [${REF} F40]`,
  },
  "eligibility.before_credit_start": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible yet: the federal credit applies only to gifts made on or after {creditStartDate}. Because the rules do not say which time zone decides, this checkout opens the credit-eligible path only once that date has begun in every U.S. State.",
    authority: "product_policy",
    citation: `Start date: ${TD}, preamble, and ${STATUTE}. The start instant (midnight Hawaii time) is a conservative product default. [${REF} F60, F61, F62; Engineering Implications 2, gate 1]`,
  },
  "eligibility.before_credit_start_sandbox": {
    kind: "statement",
    audience: "donor",
    text: "Sandbox gift, not credit-eligible. No money moves in the sandbox, and the federal credit applies only to gifts made on or after {creditStartDate}.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}: "Sandbox gifts are fine in December. Do not collect a designated section 25F contribution before the credit exists." [${REF} F61]`,
  },
  "eligibility.initiated_before_credit_start": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: this payment was started before the credit-eligible path opened. This checkout requires a payment to be both started and charged on or after {creditStartDate}.",
    authority: "product_policy",
    citation: `A product choice: a 2026 authorization or scheduled payment is not treated as a 2027 qualified contribution. [${REF} F62; Engineering Implications 2, gate 1]`,
  },
  "eligibility.sgo_not_listed": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: we cannot verify that this organization is on a State's list of scholarship granting organizations. A gift to an organization that is not on a valid list does not earn the credit.",
    authority: "statute",
    citation: `${STATUTE}(c)(5), (g): an SGO must be included on the list submitted by a covered State for the applicable year. [${REF} F8, F27, F54a]`,
  },
  "eligibility.sgo_list_provisional": {
    kind: "statement",
    audience: "donor",
    text: "Not labeled credit-eligible: this organization appears only on our provisional list, which is not the IRS list of scholarship granting organizations.",
    authority: "product_policy",
    citation: `No source says a gift made before an organization is listed is cured by a later listing. [${REF} F54a; Engineering Implications 2, gates 7 and 8; Open Questions 6]`,
  },
  "eligibility.sgo_removed": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: this organization is shown as removed from the list of scholarship granting organizations. Contributions made after an organization's removal are not treated as qualified contributions.",
    authority: "temporary_reg",
    citation: `${TD}, preamble, and Temp. Treas. Reg. 1.25F-5T(d)(8). [${REF} F56, F56a]`,
  },
  "eligibility.sgo_removed_on": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: this organization is shown as removed from the list of scholarship granting organizations as of {removedOn}. Contributions made after an organization's removal are not treated as qualified contributions, and this checkout treats the removal date itself as too late.",
    authority: "product_policy",
    citation: `Removal cut-off: ${TD}, preamble. Whether a gift on the removal date counts, and in which time zone, is not in the sources; blocking that day is a product default. [${REF} F56, F56a; ${ACK} E5 item 5, Q9]`,
  },
  "eligibility.sgo_not_yet_listed": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: this organization's listing starts on {listedFrom}, after this gift. According to the IRS, an organization must appear on a State's list at the time of the contribution.",
    authority: "irs_web",
    citation: `IRS FSTC participating-states page: "at the time of the contribution, appears on a State's list of approved SGOs". [${REF} F54a]`,
  },
  "eligibility.state_list_not_submitted": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible yet: this organization's State has made an advance election but has not yet submitted its list of scholarship granting organizations. According to the IRS, taxpayers can't claim the credit for donations in a State until that State has elected to participate and submitted its approved organizations.",
    authority: "irs_web",
    citation: `IRS FSTC landing page; Temp. Treas. Reg. 1.25F-5T(c)(3) (${TD}). [${REF} F8, F8a, F54a; Engineering Implications 2, gate 8]`,
  },
  "eligibility.state_not_participating": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: this organization's State is not participating for the calendar year of this gift, so no organization in that State is a scholarship granting organization for that year.",
    authority: "statute",
    citation: `${STATUTE} (definition of "covered State"; State lists under subsection (g)); Temp. Treas. Reg. 1.25F-5T(c)(3) (${TD}). [${REF} F8, F58]`,
  },
  "eligibility.sgo_not_portal_registered": {
    kind: "statement",
    audience: "donor",
    text: "Not labeled credit-eligible: this organization has not confirmed that it has registered in the IRS SGO portal. Until it registers, it cannot create the unique donor number you would need to claim the credit.",
    authority: "product_policy",
    citation: `Temp. Treas. Reg. 1.25F-4T(b) (${TD}); closing the credit-eligible path until registration is a product choice. [${REF} F69; Engineering Implications 2, gate 4]`,
  },
  "eligibility.attestation_individual_missing": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: you have not confirmed that you are giving personally, as an individual. Only an individual's own contribution can count toward the credit.",
    authority: "temporary_reg",
    citation: `${STATUTE}(a); Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): "made by an individual". [${REF} F1, F4]`,
  },
  "eligibility.attestation_us_missing": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: you have not confirmed that you are a U.S. citizen or a U.S. resident for federal income tax purposes. The credit is only for those individuals.",
    authority: "statute",
    citation: `${STATUTE}(a). [${REF} F1, F2]`,
  },
  "eligibility.attestation_no_earmark_missing": {
    kind: "statement",
    audience: "donor",
    text: "Not labeled credit-eligible: you have not confirmed that this gift is not earmarked for a particular student.",
    authority: "product_policy",
    citation: `Earmarking ban in ${STATUTE}(c)(5); requiring the donor's confirmation is a product choice. [${REF} F48; Engineering Implications 6]`,
  },
  "eligibility.attestation_not_in_exchange_missing": {
    kind: "statement",
    audience: "donor",
    text: "Not labeled credit-eligible: you have not confirmed that this gift is not made in exchange for a scholarship for a particular student.",
    authority: "product_policy",
    citation: `A prudent product requirement. [${REF} F40, F48, F55; Engineering Implications 6]`,
  },
  "eligibility.payment_method_digital_asset": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: a qualified contribution must be cash, and digital assets are not cash for the section 25F credit.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): cash "Does not mean any digital asset." [${REF} F44]`,
  },
  "eligibility.payment_method_not_cash": {
    kind: "statement",
    audience: "donor",
    text: "Not labeled credit-eligible: this payment method is not one of the U.S.-dollar cash methods this checkout accepts for a credit-eligible gift (card, bank transfer, check, money order, currency or after-tax payroll deduction).",
    authority: "product_policy",
    citation: `Cash methods: Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}); treating an unrecognized method as not cash is a product default. [${REF} F44; Engineering Implications 2, gate 6]`,
  },
  "eligibility.currency_not_usd": {
    kind: "statement",
    audience: "donor",
    text: "Not credit-eligible: a qualified contribution must be made in U.S. dollars.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}): "in each case all in U.S. dollars". [${REF} F44]`,
  },
  "eligibility.warning.removed_after_gift": {
    kind: "statement",
    audience: "donor",
    text: "This organization is shown as removed from the list of scholarship granting organizations as of {removedOn}, which is after this gift. Under the proposed rules, a gift made before removal can still count if the donor could rely on the list at the time of the gift.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(b) (${NPRM}); ${TD}, preamble. [${REF} F54, F55, F56, F56a]`,
  },
  "eligibility.warning.year_boundary": {
    kind: "statement",
    audience: "donor",
    text: "This gift is close to the end of the year: its calendar year in your local time differs from its calendar year in Coordinated Universal Time. The section 25F rules do not yet say exactly when a payment counts as made, so confirm the tax year with a tax professional.",
    authority: "product_policy",
    citation: `Not in the section 25F sources. [${REF} F62; Engineering Implications 9]`,
  },

  /* ---------- joint returns ---------- */
  "joint.split_instruction": {
    kind: "statement",
    audience: "donor",
    text: "Enter how much of this payment is each spouse's own contribution. Under the proposed rules each spouse is a separate taxpayer, so each spouse's contribution and designation are recorded separately.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2(a) and Example 2 (${NPRM}). [${REF} F15, F16, F17a; Engineering Implications 4]`,
  },
  "joint.both_names": {
    kind: "statement",
    audience: "donor",
    text: "According to the IRS, spouses who make a combined payment should give both names and tell the organization that the donation is on behalf of both spouses.",
    authority: "irs_web",
    citation: `${IRS_PAGE}. [${REF} F17, F17a]`,
  },
  "joint.separate_acknowledgments": {
    kind: "statement",
    audience: "donor",
    text: "According to the IRS, each spouse should receive a separate written acknowledgment with their own unique donor number.",
    authority: "irs_web",
    citation: `${IRS_PAGE}; the regulation text says "each donor". [${REF} F18]`,
  },
  "joint.even_split_default": {
    kind: "statement",
    audience: "donor",
    text: "We split the amount evenly as a starting point; the rules do not prescribe a split. Change the amounts so they match what each spouse is actually contributing.",
    authority: "product_policy",
    citation: `The split of a combined payment is not in the sources. [${REF} F17; Engineering Implications 4; Open Questions 2]`,
  },

  /* ---------- fees ---------- */
  "fee.line.designated_contribution": {
    kind: "label",
    audience: "donor",
    text: "Section 25F qualified contribution (designated)",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41]`,
  },
  "fee.line.non_designated_gift": {
    kind: "label",
    audience: "donor",
    text: "Additional gift (not designated, not a qualified contribution)",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41; ${ACK} F12a]`,
  },
  "fee.line.donor_service_fee": {
    kind: "label",
    audience: "donor",
    text: "Service fee (separate charge, not part of your contribution)",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, fee and settlement: "show any platform fee as its own line and do not describe the fee as part of the qualified contribution."`,
  },
  "fee.none.title": {
    kind: "label",
    audience: "sgo",
    text: "No platform fee on gifts",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (c).`,
  },
  "fee.none.donor": {
    kind: "statement",
    audience: "donor",
    text: "{platformName} does not take a fee out of this gift or add one to it. The full amount you designate is for the organization's section 25F account.",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (c); designated amounts belong in the segregated account. [${REF} F43; Engineering Implications 8]`,
  },
  "fee.none.sgo": {
    kind: "statement",
    audience: "sgo",
    text: "No platform fee is taken on section 25F gifts. This is the default until counsel's written memo on the fee structure is on file.",
    authority: "product_policy",
    citation: `Build spec, Business model: "do not take a percentage of 25F gifts in production until the memo is in hand."`,
  },
  "fee.sgo_invoiced.title": {
    kind: "label",
    audience: "sgo",
    text: "Organization is invoiced separately",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (a).`,
  },
  "fee.sgo_invoiced.donor": {
    kind: "statement",
    audience: "donor",
    text: "The full amount you designate is for the organization's section 25F account. {platformName} bills the organization separately for its platform fee, which the organization pays from other funds, not from your contribution.",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (a). [${REF} Engineering Implications 8]`,
  },
  "fee.sgo_invoiced.sgo": {
    kind: "statement",
    audience: "sgo",
    text: "Every designated dollar is deposited in your section 25F segregated account. {platformName} invoices your organization separately for its platform fee, payable from operating funds outside that account.",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (a): "the SGO pays a separately invoiced platform fee from operating funds outside that account".`,
  },
  "fee.donor_service_fee.title": {
    kind: "label",
    audience: "sgo",
    text: "Separate donor service fee",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (b).`,
  },
  "fee.donor_service_fee.donor": {
    kind: "statement",
    audience: "donor",
    text: "{platformName} charges a separate service fee on top of your gift, shown as its own line. The fee is not part of your contribution, is not designated as a section 25F qualified contribution, will not be included in the organization's acknowledgment, and is not covered by the federal credit, so you pay it yourself.",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (b): "a clearly separate, non-designated service fee on top ... this leaves the donor slightly out of pocket". [${REF} Engineering Implications 8]`,
  },
  "fee.donor_service_fee.sgo": {
    kind: "statement",
    audience: "sgo",
    text: "Donors pay {platformName} a separate, non-designated service fee on top of the gift. Only the designated amount is deposited in your section 25F segregated account and acknowledged as a qualified contribution.",
    authority: "product_policy",
    citation: `Build spec, Business model, structure (b).`,
  },
  "fee.counsel_memo_required": {
    kind: "statement",
    audience: "sgo",
    text: "A fee structure other than no fee can be turned on only after counsel's written memo approving it is on file and its reference is recorded.",
    authority: "product_policy",
    citation: `Build spec, Business model: "This needs a written counsel memo before any live 25F gift is accepted."`,
  },

  /* ---------- receipt (immediate, not the official acknowledgment) ---------- */
  "receipt.not_official_acknowledgment": {
    kind: "statement",
    audience: "donor",
    text: "This is a payment receipt, not the official written acknowledgment for the section 25F credit. {sgoName} will send your official acknowledgment, with your unique donor number, by {acknowledgmentDeadline} of the year after your gift.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1) (${TD}). An immediate receipt does not carry the five required items. [${REF} F67, F68; Engineering Implications 7; ${ACK} E1 item 7]`,
  },
  "receipt.designated": {
    kind: "statement",
    audience: "donor",
    text: "You designated {designatedAmount} of this payment to {sgoName} as a section 25F qualified contribution on {paidDate}. This designation is irrevocable.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41, F42]`,
  },
  "receipt.non_designated": {
    kind: "statement",
    audience: "donor",
    text: "{nonDesignatedAmount} of this payment is an ordinary gift that you did not designate. It is not a qualified contribution.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-1T(a)(12) (${TD}). [${REF} F41; ${ACK} F12a]`,
  },
  "receipt.service_fee": {
    kind: "statement",
    audience: "donor",
    text: "Service fee paid to {platformName}: {feeAmount}. The fee is not part of your contribution and is not covered by the federal credit.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}, fee and settlement.`,
  },
  "receipt.goods_or_services_none": {
    kind: "statement",
    audience: "donor",
    text: "{sgoName} provided no goods or services in return for this gift.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(D) (${TD}). [${REF} F45, F67]`,
  },
  "receipt.credit_eligible_path": {
    kind: "statement",
    audience: "donor",
    text: "This gift was made on the credit-eligible path. Whether you can claim the credit, and how much, depends on your own tax return; this receipt does not promise a credit.",
    authority: "product_policy",
    citation: `Receipt and acknowledgment copy should not promise the credit. [${ACK} E1 item 11]`,
  },
  "receipt.not_credit_eligible": {
    kind: "statement",
    audience: "donor",
    text: "This gift is not labeled credit-eligible. The reasons are listed below.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}: gifts before the credit start or to an organization not on a valid list are plainly marked.`,
  },
  "receipt.sandbox": {
    kind: "statement",
    audience: "donor",
    text: "Sandbox receipt. No money moved, and this is not a real contribution.",
    authority: "product_policy",
    citation: `${BUILD_SPEC}: sandbox payments.`,
  },

  /* ---------- official acknowledgment ---------- */
  "ack.title": {
    kind: "label",
    audience: "donor",
    text: "Written acknowledgment of section 25F qualified contributions",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1) (${TD}). [${ACK} F5, F6, E8]`,
  },
  "ack.ein": {
    kind: "label",
    audience: "donor",
    text: "Organization EIN: {ein}",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(A) (${TD}). [${ACK} F6]`,
  },
  "ack.total_designated": {
    kind: "statement",
    audience: "donor",
    text: "Total contributions you made to {sgoName} during calendar year {calendarYear} that you designated as qualified contributions: {totalDesignated}",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(B) (${TD}). [${ACK} F6, F11]`,
  },
  "ack.donor_number": {
    kind: "label",
    audience: "donor",
    text: "Your unique donor number: {donorNumber}",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(C) (${TD}). [${ACK} F6, F20]`,
  },
  "ack.goods_or_services_none": {
    kind: "statement",
    audience: "donor",
    text: "{sgoName} did not provide any goods or services in consideration, in whole or in part, for these contributions.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(D) (${TD}). [${ACK} F6, E1 item 8]`,
  },
  "ack.goods_or_services_provided": {
    kind: "statement",
    audience: "donor",
    text: "{sgoName} provided goods or services in consideration, in whole or in part, for these contributions. Description: {description}. Good faith estimate of value: {estimatedValue}.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(c)(1)(i)(D), (E) (${TD}). [${ACK} F6, F13]`,
  },
  "ack.how_to_claim": {
    kind: "statement",
    audience: "donor",
    text: "Under the proposed rules and IRS guidance, you claim the credit on {claimForm}, {claimFormTitle}, reporting this unique donor number, and file it with your federal income tax return.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-2 (substantiation) (${NPRM}); ${IRS_PAGE}. [${REF} F65, F72; ${ACK} F73, F74]`,
  },
  "ack.credit_not_promised": {
    kind: "statement",
    audience: "donor",
    text: "This acknowledgment records what you contributed and designated. It does not determine whether, or in what amount, you can claim the credit.",
    authority: "product_policy",
    citation: `The credit depends on tax liability, State credits and SGO status, none of which the acknowledgment certifies. [${ACK} E1 item 11]`,
  },
  "ack.pending_donor_number": {
    kind: "statement",
    audience: "donor",
    text: "Your official acknowledgment cannot be issued yet: {sgoName} has not yet been able to create your unique donor number.",
    authority: "temporary_reg",
    citation: `Temp. Treas. Reg. 1.25F-4T(b) (${TD}): no donor number until the organization registers in the IRS SGO portal. [${REF} F69; ${ACK} F22, E1 item 3]`,
  },
  "ack.sandbox_donor_number": {
    kind: "statement",
    audience: "donor",
    text: "Test donor number: it was not created under the IRS SGO portal instructions and is not valid for filing.",
    authority: "product_policy",
    citation: `Sandbox numbers must be visibly non-production. [${ACK} E2 item 2]`,
  },

  /* ---------- advisories for SGO staff ---------- */
  "sgo.substantial_contributor.over_amount": {
    kind: "statement",
    audience: "sgo",
    text: "Large-donor advisory. This donor's contributions to your organization in this taxable year, combined with any spouse's, total {aggregateAmount}, which is more than {substantialAmount}. Under the proposed rules, such a donor is a substantial contributor if that total is also more than {substantialPercent} of all contributions your organization receives in the taxable year, which would be the case if your total for the year ends below {shareTestTotal}. An organization may not award a scholarship to a substantial contributor or a member of that person's family, for that taxable year and the next.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-3(d) (${NPRM}); ${STATUTE}: "A scholarship granting organization may not award a scholarship to any disqualified person." [${REF} F49, F50, F51; Engineering Implications 6]`,
  },
  "sgo.substantial_contributor.is": {
    kind: "statement",
    audience: "sgo",
    text: "Large-donor advisory. This donor's contributions, combined with any spouse's, total {aggregateAmount}: more than {substantialAmount} and more than {substantialPercent} of the {totalContributions} recorded as total contributions for the taxable year ({sharePercent}). Under the proposed rules that makes the donor a substantial contributor, and the organization may not award a scholarship to the donor or a member of the donor's family for that taxable year and the next.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-3(d) and Examples 2 and 3 (${NPRM}). [${REF} F49, F50, F53]`,
  },
  "sgo.substantial_contributor.not": {
    kind: "statement",
    audience: "sgo",
    text: "This donor's contributions, combined with any spouse's, total {aggregateAmount}: more than {substantialAmount}, but not more than {substantialPercent} of the {totalContributions} recorded as total contributions for the taxable year ({sharePercent}). Under the proposed rules the donor is not a substantial contributor on these figures; status is determined at the close of the organization's taxable year.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-3(d) and Example 1 (${NPRM}). [${REF} F50, F53]`,
  },
  "sgo.substantial_contributor.projected": {
    kind: "statement",
    audience: "sgo",
    text: "This donor has scheduled or pledged further gifts that would bring this taxable year's total to {projectedAmount}, more than {substantialAmount}. Under the proposed rules, a scholarship awarded before a donor crosses the thresholds is protected only if the organization did not know and did not reasonably expect that the donor would become a substantial contributor.",
    authority: "proposed_reg",
    citation: `Prop. Treas. Reg. 1.25F-3(d)(2)(ii) (excepted scholarships) (${NPRM}). [${REF} F50a, F53]`,
  },
  "sgo.substantial_contributor.advisory_only": {
    kind: "statement",
    audience: "sgo",
    text: "This is an advisory for the organization. It does not block or change the donor's gift.",
    authority: "product_policy",
    citation: `The checkout gives the organization the running total; the organization has the denominator and makes the determination. [${REF} Engineering Implications 6]`,
  },

  /* ---------- the qualified "effectively free" statement ---------- */
  "pitch.effectively_free_qualified": {
    kind: "statement",
    audience: "donor",
    text: "A qualified contribution is effectively free to you only to the extent the nonrefundable federal credit, up to {cap} per taxpayer, is actually used against federal income tax you owe, which depends on your own tax liability, and the credit never covers a service fee paid on top of the gift.",
    authority: "statute",
    citation: `${STATUTE}(a), (b)(1), (f); build spec, Business model and Piece 1 risks: calling a gift free is wrong for a donor without enough tax liability and for any fee paid on top. [${REF} F10, F11, F29]`,
  },
} as const satisfies Record<string, CopyDefinition>;

/* ------------------------------------------------------------------ constant placeholders */

const NUMBER_WORDS: Readonly<Record<CopyLocale, readonly string[]>> = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
  es: ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"],
};

function numberWord(n: number, locale: CopyLocale): string {
  return NUMBER_WORDS[locale][n] ?? String(n);
}

function joinList(items: readonly string[], locale: CopyLocale): string {
  const and = locale === "es" ? "y" : "and";
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function percentText(share: { numerator: number; denominator: number }, locale: CopyLocale): string {
  const percent = (share.numerator * 100) / share.denominator;
  return `${percent} ${locale === "es" ? "por ciento" : "percent"}`;
}

function constantsFor(locale: CopyLocale) {
  return Object.freeze({
    cap: formatUsd(CREDIT_CAP_PER_TAXPAYER_CENTS.value),
    jointCap: formatUsd(JOINT_RETURN_MAX_CREDIT_CENTS.value),
    carryforwardYears: numberWord(CARRYFORWARD_YEARS.value, locale),
    otherCreditSections: joinList(LIABILITY_LIMIT_OTHER_CREDIT_SECTIONS.value, locale),
    proposedRuleId: PROPOSED_RULE_ID,
    claimForm: CLAIM_FORM.value.name,
    claimFormTitle: CLAIM_FORM.value.title,
    claimFormFilingSeason: String(CLAIM_FORM_FIRST_FILING_SEASON.value),
    firstCreditYear: FIRST_ELIGIBLE_DATE.value.slice(0, 4),
    acknowledgmentDeadline: formatMonthDayLong(ACKNOWLEDGMENT_DEADLINE.value.month, ACKNOWLEDGMENT_DEADLINE.value.day, locale),
    stateListDeadline2027: formatIsoDateLong(STATE_SGO_LIST_DEADLINE_2027.value, locale),
    substantialAmount: formatUsd(SUBSTANTIAL_CONTRIBUTOR_AMOUNT_THRESHOLD_CENTS.value),
    substantialPercent: percentText(SUBSTANTIAL_CONTRIBUTOR_SHARE_THRESHOLD.value, locale),
  });
}

/**
 * Placeholders that are filled from `./constants`, never by the caller. They exist so that a change to a
 * rule value changes every sentence that states it.
 */
export const COPY_CONSTANTS: Readonly<Record<CopyLocale, Readonly<Record<CopyConstantName, string>>>> = Object.freeze({
  en: constantsFor("en"),
  es: constantsFor("es"),
});

export type CopyConstantName = keyof ReturnType<typeof constantsFor>;

/* ------------------------------------------------------------------ types */

export type CopyId = keyof typeof DEFINITIONS;

type PlaceholderNames<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}` ? Name | PlaceholderNames<Rest> : never;

/** The placeholders of an entry that the caller must supply (everything that is not a constant). */
export type CopyVariable<Id extends CopyId> = Exclude<PlaceholderNames<(typeof DEFINITIONS)[Id]["text"]>, CopyConstantName>;

export type CopyVars<Id extends CopyId> = { readonly [Name in CopyVariable<Id>]: string };

export interface CopyEntry {
  readonly id: CopyId;
  readonly kind: CopyKind;
  readonly audience: CopyAudience;
  /** English text with {placeholders}. */
  readonly text: string;
  readonly translations: Readonly<Partial<Record<Exclude<CopyLocale, "en">, string>>>;
  readonly authority: Authority;
  readonly citation: string;
  readonly onlyWhen: CopyCondition | null;
  /** Placeholders the caller must supply to `renderCopy`. */
  readonly variables: readonly string[];
  /** Placeholders filled from `COPY_CONSTANTS`. */
  readonly constants: readonly CopyConstantName[];
}

export interface RenderCopyOptions {
  /** Defaults to English. A locale without a reviewed translation for the entry falls back to English. */
  readonly locale?: CopyLocale;
  /** Which SGO list is in use. Entries gated on the IRS-published list refuse to render without "irs_published". */
  readonly sgoListSource?: "provisional_curated" | "irs_published";
}

export interface RenderedCopy {
  readonly id: CopyId;
  readonly copyVersion: string;
  /** The locale of the words actually returned (English when no translation exists). */
  readonly locale: CopyLocale;
  readonly text: string;
  /** Hash of the entry's words before the caller's variables are filled in (`copySha256(id, locale)`). */
  readonly templateSha256: string;
  /** Hash of exactly the text returned. */
  readonly textSha256: string;
}

/* ------------------------------------------------------------------ registry */

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function placeholdersIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]))];
}

function isConstantName(name: string): name is CopyConstantName {
  return Object.prototype.hasOwnProperty.call(COPY_CONSTANTS.en, name);
}

/**
 * Builds a registry entry from its definition. Exported (but not re-exported from the module index) so
 * tests and translation tooling can exercise an entry, for example one with a Spanish text, before it is
 * added to the registry.
 */
export function defineCopyEntry(id: string, definition: CopyDefinition): CopyEntry {
  const names = placeholdersIn(definition.text);
  return Object.freeze({
    id: id as CopyId,
    kind: definition.kind,
    audience: definition.audience,
    text: definition.text,
    translations: Object.freeze(definition.es === undefined ? {} : { es: definition.es }),
    authority: definition.authority,
    citation: definition.citation,
    onlyWhen: definition.onlyWhen ?? null,
    variables: Object.freeze(names.filter((name) => !isConstantName(name))),
    constants: Object.freeze(names.filter(isConstantName)),
  });
}

export type { CopyDefinition };

export const COPY_IDS = Object.freeze(Object.keys(DEFINITIONS)) as readonly CopyId[];

export const COPY: Readonly<Record<CopyId, CopyEntry>> = Object.freeze(
  Object.fromEntries(COPY_IDS.map((id) => [id, defineCopyEntry(id, DEFINITIONS[id])])) as Record<CopyId, CopyEntry>,
);

export function isCopyId(value: unknown): value is CopyId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEFINITIONS, value);
}

export function getCopy(id: CopyId): CopyEntry {
  if (!isCopyId(id)) throw new AppError("internal", `Unknown tax copy id: ${String(id)}`);
  return COPY[id];
}

export function listCopy(): readonly CopyEntry[] {
  return COPY_IDS.map((id) => COPY[id]);
}

export function hasTranslation(id: CopyId, locale: CopyLocale): boolean {
  return locale === "en" || getCopy(id).translations[locale] !== undefined;
}

function resolveLocale(entry: CopyEntry, requested: CopyLocale): { locale: CopyLocale; template: string } {
  if (requested !== "en") {
    const translated = entry.translations[requested];
    if (translated !== undefined) return { locale: requested, template: translated };
  }
  return { locale: "en", template: entry.text };
}

function fillConstants(template: string, locale: CopyLocale): string {
  const constants = COPY_CONSTANTS[locale];
  return template.replace(PLACEHOLDER, (whole, name: string) => (isConstantName(name) ? constants[name] : whole));
}

function entrySha256(entry: CopyEntry, locale: CopyLocale): string {
  const resolved = resolveLocale(entry, locale);
  return sha256Hex(stableStringify([entry.id, resolved.locale, fillConstants(resolved.template, resolved.locale)]));
}

/**
 * The entry's words with constant placeholders filled in and the caller's variables still written {likeThis}.
 * This is the text that `copySha256(id)` hashes.
 */
export function copyTemplate(id: CopyId, locale: CopyLocale = "en"): string {
  const resolved = resolveLocale(getCopy(id), locale);
  return fillConstants(resolved.template, resolved.locale);
}

/**
 * SHA-256 of the words of one entry (`id` given) or of the whole registry in every locale (`id` omitted).
 * Store it next to COPY_VERSION so a donation records exactly which words were shown.
 */
export function copySha256(id?: CopyId, locale: CopyLocale = "en"): string {
  if (id !== undefined) return entrySha256(getCopy(id), locale);
  const translatedLocales = COPY_LOCALES.filter((l): l is Exclude<CopyLocale, "en"> => l !== "en");
  const all = [...COPY_IDS].sort().map((entryId) => {
    const entry = COPY[entryId];
    const translations = translatedLocales.map((l) => {
      const text = entry.translations[l];
      return [l, text === undefined ? null : fillConstants(text, l)];
    });
    return [entryId, fillConstants(entry.text, "en"), translations];
  });
  return sha256Hex(stableStringify(all));
}

/** Renders any entry object. `renderCopy` and its siblings call this with entries from the registry. */
export function renderCopyEntry(entry: CopyEntry, vars: Readonly<Record<string, string>> = {}, options: RenderCopyOptions = {}): RenderedCopy {
  if (entry.onlyWhen === "irs_list_is_source" && options.sgoListSource !== "irs_published") {
    throw new AppError(
      "internal",
      `Tax copy "${entry.id}" describes the IRS-published SGO list and may only be shown when that list is the list in use`,
    );
  }
  const supplied = Object.keys(vars);
  const missing = entry.variables.filter((name) => !supplied.includes(name));
  const unknown = supplied.filter((name) => !entry.variables.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    const problems = [missing.length > 0 ? `missing ${missing.join(", ")}` : "", unknown.length > 0 ? `not used by this entry: ${unknown.join(", ")}` : ""];
    throw new AppError("internal", `Tax copy "${entry.id}" was rendered with the wrong variables (${problems.filter(Boolean).join("; ")})`);
  }
  for (const name of entry.variables) {
    const value = vars[name];
    if (typeof value !== "string" || value.trim() === "") {
      throw new AppError("internal", `Tax copy "${entry.id}" needs a non-empty text value for {${name}}`);
    }
  }
  const resolved = resolveLocale(entry, options.locale ?? "en");
  const constants = COPY_CONSTANTS[resolved.locale];
  const text = resolved.template.replace(PLACEHOLDER, (_whole, name: string) => (isConstantName(name) ? constants[name] : vars[name]));
  return Object.freeze({
    id: entry.id,
    copyVersion: COPY_VERSION,
    locale: resolved.locale,
    text,
    templateSha256: entrySha256(entry, resolved.locale),
    textSha256: sha256Hex(text),
  });
}

type RenderArguments<Id extends CopyId> = [CopyVariable<Id>] extends [never]
  ? [vars?: Readonly<Record<string, never>>, options?: RenderCopyOptions]
  : [vars: CopyVars<Id>, options?: RenderCopyOptions];

/**
 * The text of a copy entry with its variables filled in. The variables an entry needs are part of its type:
 * `renderCopy("designation.statement", { designatedAmount: "$1,700", sgoName: "Example SGO" })`.
 * Throws (code `internal`) when a variable is missing, empty or not one the entry uses.
 */
export function renderCopy<Id extends CopyId>(id: Id, ...args: RenderArguments<Id>): string {
  const [vars, options] = args as [Readonly<Record<string, string>> | undefined, RenderCopyOptions | undefined];
  return renderCopyEntry(getCopy(id), vars ?? {}, options ?? {}).text;
}

/** `renderCopy` for an id that is only known at run time (for example a note id from a stored preview). */
export function renderCopyDynamic(id: CopyId, vars: Readonly<Record<string, string>> = {}, options: RenderCopyOptions = {}): string {
  return renderCopyEntry(getCopy(id), vars, options).text;
}

/** The rendered text together with the version and hashes to store with a designation, consent or receipt. */
export function renderCopyWithProof(id: CopyId, vars: Readonly<Record<string, string>> = {}, options: RenderCopyOptions = {}): RenderedCopy {
  return renderCopyEntry(getCopy(id), vars, options);
}
