/**
 * Household income for the section 25F income test.
 *
 * WHAT IS COMPUTED. Under the proposed rule (Reg. 1.25F-3(c)(6)(ii)(C), REG-117199-25, not final) household
 * income is "annual income" under 24 CFR 5.609, without the imputed return on assets, with child support
 * and alimony received, and without non-cash receipts. Section 25F(c)(2)(A) fixes the period: the calendar
 * year before the application. The engine therefore sums the cash each item records for that one year. It
 * never projects, never annualizes and never subtracts a deduction.
 *
 * THREE FIGURES. The sources leave several treatments open (which Form W-2 box is "wages", whether a
 * one-time retirement withdrawal counts, the current dependent deduction amount, ...). Rather than pick a
 * side silently the engine returns:
 *  - `totalCountedCents`: the recorded figure of every line that counts,
 *  - `lowerBoundCents`:   the least the household's income can be under any reading the sources allow,
 *  - `upperBoundCents`:   the most it can be.
 * The decision service says "within the limit" only when the UPPER bound is within it and "over the limit"
 * only when the LOWER bound is over it (docs/reference/hud-ami-and-annual-income.md, engineering
 * implication 9). An open treatment that cannot change the outcome therefore never needs a person.
 *
 * WHOSE INCOME (24 CFR 5.609(a)(1), (b)(3), (b)(8), (b)(14)).
 *  - Members aged 18 or older, and the head of household or the head's spouse at any age: everything.
 *  - A child under 18 who is not head or spouse: unearned income counts, earned income is excluded.
 *  - A dependent full-time student aged 18 or older who is not head or spouse: earned income counts only up
 *    to the HUD dependent deduction amount.
 *  - A foster child, foster adult or live-in aide: nothing counts.
 *  - Earned income attributed to no member: in the recorded figure and the upper bound, not the lower bound.
 * These rules are applied from the member's facts whatever category the item was filed under.
 */
import { invalid } from "@/lib/errors";
import { z } from "zod";
import { dependentDeductionCents, getIncomeCategory, INCOME_RULE_SET, INCOME_TAXONOMY_VERSION, type IncomeAppliesTo, type IncomeCategory } from "./categories";
import {
  householdMembersSchema,
  incomeItemsSchema,
  incomeYearSchema,
  parseInput,
  type HouseholdMemberInput,
  type IncomeFlagCode,
  type IncomeFlagSeverity,
  type IncomeItemInput,
  type IncomeItemSource,
  type IncomeReviewFlag,
} from "./types";

export interface ComputeHouseholdIncomeInput {
  /** The calendar year before the application date. Items for any other year are kept but not counted. */
  incomeYear: number;
  members: HouseholdMemberInput[];
  items: IncomeItemInput[];
}

export type IncomeLineTreatment = "counted" | "excluded" | "review";

export const INCOME_LINE_REASONS = [
  "counted",
  "counted_up_to_dependent_deduction",
  "excluded_category",
  "excluded_above_dependent_deduction",
  "excluded_minor_earned_income",
  "excluded_foster_or_live_in_aide",
  "excluded_different_year",
  "excluded_net_loss_not_offset",
  "review_category",
  "review_unknown_category",
  "review_unknown_member",
  "review_category_member_mismatch",
  "review_member_age_unknown",
  "review_dependent_deduction_unconfirmed",
] as const;
export type IncomeLineReason = (typeof INCOME_LINE_REASONS)[number];

/**
 * How one item, or one part of an item, was treated. An item whose amount is only partly counted produces
 * two lines (the counted part and the excluded part), so the counted lines always add up to
 * `totalCountedCents`.
 */
export interface IncomeLine {
  itemId: string;
  memberId: string | null;
  alsoCoversMemberIds: string[];
  category: string;
  incomeYear: number;
  description: string | null;
  source: IncomeItemSource;
  documentId: string | null;
  railConnectionId: string | null;
  /** The part of the item this line accounts for, in cents. */
  amountCents: number;
  /** What this line adds to the lower and upper bounds of household income. */
  lowCents: number;
  highCents: number;
  treatment: IncomeLineTreatment;
  reason: IncomeLineReason;
  /** Citation or short reason, ready to store in `income_items.basis`. */
  basis: string;
}

export interface MemberIncomeSummary {
  /** Null collects items that are not attributed to one member. */
  memberId: string | null;
  countedCents: number;
  lowerBoundCents: number;
  upperBoundCents: number;
  itemIds: string[];
}

export interface HouseholdIncomeResult {
  incomeYear: number;
  taxonomyVersion: string;
  ruleSet: string;
  /** Sum of the counted lines: the recorded household income. */
  totalCountedCents: number;
  lowerBoundCents: number;
  upperBoundCents: number;
  /** One entry per member that has at least one item, in roster order, then unattributed items. */
  perMember: MemberIncomeSummary[];
  counted: IncomeLine[];
  /** Kept for the audit trail with the reason; never part of the total. */
  excluded: IncomeLine[];
  /** Lines whose treatment the sources leave open. They are part of the upper bound only. */
  needsReview: IncomeLine[];
  reviewFlags: IncomeReviewFlag[];
}

const computeInputSchema = z.strictObject({ incomeYear: incomeYearSchema, members: householdMembersSchema, items: incomeItemsSchema });

const BASIS = {
  differentYear: (itemYear: number, incomeYear: number) =>
    `26 U.S.C. 25F(c)(2)(A): only income for calendar year ${incomeYear} is measured; this item is for ${itemYear}`,
  minorEarned: "24 CFR 5.609(b)(3): earned income of a child under 18 is not counted",
  fosterOrAide: "24 CFR 5.609(b)(8): income of a live-in aide, foster child or foster adult is not counted",
  dependentDeduction: "24 CFR 5.609(b)(14), (b)(15); 5.611(a)(1): counted only up to the HUD dependent deduction amount",
  dependentDeductionUnconfirmed: (incomeYear: number) =>
    `24 CFR 5.609(b)(14), (b)(15): counted only up to the HUD dependent deduction amount, which is not confirmed for ${incomeYear}`,
  netLoss: "A net loss is not subtracted from other income: 24 CFR 5.609 does not say that it may be",
  unknownCategory: "The category is not in the income taxonomy; a reviewer must classify it",
  unknownMember: "The item names a person who is not on the household roster",
  ageUnknown: "24 CFR 5.609(a)(1), (b)(3): whether earned income counts depends on whether the member is 18 or older, which is not recorded",
} as const;

function matchesAppliesTo(appliesTo: IncomeAppliesTo, member: HouseholdMemberInput | null): boolean {
  if (appliesTo === "household") return true;
  if (!member) return false;
  switch (appliesTo) {
    case "minor_not_head_or_spouse":
      return member.ageBand === "minor" && !member.headOrSpouse;
    case "minor_head_or_spouse":
      return member.ageBand === "minor" && member.headOrSpouse === true;
    case "dependent_full_time_student":
      return member.ageBand === "adult" && member.fullTimeStudent === true && !member.headOrSpouse;
    case "live_in_aide":
      return member.role === "live_in_aide";
    case "foster_member":
      return member.role === "foster";
  }
}

const AGE_BASED: ReadonlySet<IncomeAppliesTo> = new Set(["minor_not_head_or_spouse", "minor_head_or_spouse", "dependent_full_time_student"]);

/**
 * Household income for one calendar year from the recorded items.
 *
 * Throws a `validation_failed` AppError for malformed input, including a negative amount in a category
 * where a loss has no meaning.
 */
export function computeHouseholdIncome(input: ComputeHouseholdIncomeInput): HouseholdIncomeResult {
  const { incomeYear, members, items } = parseInput(computeInputSchema, input, "household income input");
  const memberById = new Map(members.map((member) => [member.id, member]));
  const deduction = dependentDeductionCents(incomeYear);

  const lines: IncomeLine[] = [];
  const flags: IncomeReviewFlag[] = [];

  for (const item of items) {
    const amount = item.annualAmountCents;
    const low = item.lowCents ?? amount;
    const high = item.highCents ?? amount;

    const line = (treatment: IncomeLineTreatment, reason: IncomeLineReason, basis: string, part: { amountCents: number; lowCents: number; highCents: number }): void => {
      lines.push({
        itemId: item.id,
        memberId: item.memberId,
        alsoCoversMemberIds: [...(item.alsoCoversMemberIds ?? [])],
        category: item.category,
        incomeYear: item.incomeYear,
        description: item.description ?? null,
        source: item.source,
        documentId: item.documentId ?? null,
        railConnectionId: item.railConnectionId ?? null,
        ...part,
        treatment,
        reason,
        basis,
      });
    };
    const flag = (code: IncomeFlagCode, severity: IncomeFlagSeverity, message: string): void => {
      flags.push({
        code,
        severity,
        message,
        itemId: item.id,
        memberIds: [...(item.memberId === null ? [] : [item.memberId]), ...(item.alsoCoversMemberIds ?? [])],
        sourceIds: [item.documentId, item.railConnectionId].filter((sourceId): sourceId is string => typeof sourceId === "string"),
      });
    };
    /** The whole item is in doubt: nothing in the lower bound, everything that could count in the upper bound. */
    const underReview = (reason: IncomeLineReason, basis: string): void =>
      line("review", reason, basis, { amountCents: amount, lowCents: Math.min(0, low), highCents: Math.max(0, high) });

    const category: IncomeCategory | null = getIncomeCategory(item.category);
    if (low < 0 && !category?.allowsNegative) {
      throw invalid(`Invalid household income input: income item ${item.id} has a negative amount, which category ${item.category} does not allow`, {
        fields: { [`items.${items.indexOf(item)}.annualAmountCents`]: "must not be negative for this category" },
      });
    }

    if (item.incomeYear !== incomeYear) {
      line("excluded", "excluded_different_year", BASIS.differentYear(item.incomeYear, incomeYear), { amountCents: amount, lowCents: 0, highCents: 0 });
      continue;
    }

    if (!category) {
      underReview("review_unknown_category", BASIS.unknownCategory);
      flag("unknown_income_category", "bounded", `Income category "${item.category}" is not in the income taxonomy. The amount is in the upper bound of household income until a reviewer classifies it.`);
      continue;
    }

    const namedIds = [...(item.memberId === null ? [] : [item.memberId]), ...(item.alsoCoversMemberIds ?? [])];
    if (namedIds.some((memberId) => !memberById.has(memberId))) {
      underReview("review_unknown_member", BASIS.unknownMember);
      flag("income_item_unknown_member", "blocking", "An income item names a person who is not on the household roster. The roster or the item must be corrected before income can be decided.");
      continue;
    }
    const member = item.memberId === null ? null : (memberById.get(item.memberId) ?? null);

    if (member && (member.role === "foster" || member.role === "live_in_aide")) {
      line("excluded", "excluded_foster_or_live_in_aide", BASIS.fosterOrAide, { amountCents: amount, lowCents: 0, highCents: 0 });
      continue;
    }

    if (category.appliesTo !== "household" && !matchesAppliesTo(category.appliesTo, member)) {
      if (member && member.ageBand === "unknown" && AGE_BASED.has(category.appliesTo)) {
        underReview("review_member_age_unknown", BASIS.ageUnknown);
        flag("member_age_unknown", "bounded", "It is not recorded whether the member this income belongs to is 18 or older, so it is not known whether the income counts.");
      } else {
        underReview("review_category_member_mismatch", `Category "${category.label.en}" does not fit the member the item is recorded for`);
        flag(
          "category_member_mismatch",
          "blocking",
          `An income item is filed as "${category.label.en}", but the household roster does not show a member that category applies to. A reviewer must correct the category or the member.`,
        );
      }
      continue;
    }

    if (category.treatment === "excluded") {
      line("excluded", "excluded_category", category.basis, { amountCents: amount, lowCents: 0, highCents: 0 });
      continue;
    }

    const earnedByNonHead = category.earned && category.appliesTo === "household" && member !== null && !member.headOrSpouse;
    if (earnedByNonHead && member.ageBand === "minor") {
      line("excluded", "excluded_minor_earned_income", BASIS.minorEarned, { amountCents: amount, lowCents: 0, highCents: 0 });
      continue;
    }
    if (earnedByNonHead && member.ageBand === "unknown") {
      underReview("review_member_age_unknown", BASIS.ageUnknown);
      flag("member_age_unknown", "bounded", "It is not recorded whether the member this income belongs to is 18 or older, so it is not known whether the income counts.");
      continue;
    }

    if (category.selfEmployment) {
      flag(
        "self_employment_income",
        "blocking",
        "Self-employment or business income is on file. Only net income under the HUD rules counts (24 CFR 5.609(b)(28)), and a tax or payment record does not establish that figure, so a reviewer must confirm the amount.",
      );
    }

    if (category.treatment === "review") {
      underReview("review_category", category.basis);
      flag("income_category_needs_review", "bounded", `"${category.label.en}": the sources do not settle whether this income counts. The amount is in the upper bound of household income only.`);
      continue;
    }

    if (amount < 0) {
      line("excluded", "excluded_net_loss_not_offset", BASIS.netLoss, { amountCents: amount, lowCents: low, highCents: Math.max(0, high) });
      flag("net_loss_not_offset", "bounded", "A net loss is on file. It is not subtracted from other income; the lower bound of household income shows the figure if it were.");
      continue;
    }

    const studentCap = earnedByNonHead && member.ageBand === "adult" && member.fullTimeStudent === true;
    if (category.cappedAtDependentDeduction || studentCap) {
      if (deduction === null) {
        underReview("review_dependent_deduction_unconfirmed", BASIS.dependentDeductionUnconfirmed(incomeYear));
        flag(
          "dependent_deduction_amount_unconfirmed",
          "bounded",
          `Only the part of this income up to the HUD dependent deduction amount counts, and that amount is not confirmed for ${incomeYear}. The full amount is in the upper bound of household income only.`,
        );
        continue;
      }
      const countedPart = Math.min(amount, deduction);
      line("counted", "counted_up_to_dependent_deduction", BASIS.dependentDeduction, {
        amountCents: countedPart,
        lowCents: Math.max(0, Math.min(low, deduction)),
        highCents: Math.min(high, deduction),
      });
      if (amount > countedPart) {
        line("excluded", "excluded_above_dependent_deduction", BASIS.dependentDeduction, { amountCents: amount - countedPart, lowCents: 0, highCents: 0 });
      }
      continue;
    }

    let lowCents = low;
    if (member && member.ageBand === "minor" && member.headOrSpouse && category.earned) {
      lowCents = Math.min(lowCents, 0);
      flag(
        "minor_head_or_spouse_income",
        "bounded",
        "Earned income is counted for a member under 18 because the member is recorded as head of household or the head's spouse. If that is wrong the income does not count, so the lower bound of household income leaves it out.",
      );
    }
    if (member === null && category.earned) {
      // Whose earnings these are decides whether they count at all (a child's earnings do not), so an
      // unattributed amount cannot help show that income is over the limit.
      lowCents = Math.min(lowCents, 0);
      flag(
        "earned_income_unattributed",
        "bounded",
        "Earned income is recorded without saying which household member earned it. Earned income of a child under 18 does not count, so the lower bound of household income leaves it out until the item is attributed.",
      );
    }
    if (member && member.role === "unrelated") {
      lowCents = Math.min(lowCents, 0);
      flag(
        "unrelated_member_income",
        "bounded",
        "Income of a person who resides with the student but is not part of the student's family is counted. The sources do not settle whether it counts, so the lower bound of household income leaves it out.",
      );
    }
    if (low !== high) {
      flag("amount_basis_unsettled", "bounded", `"${category.label.en}": the evidence supports more than one figure for this income. The lower and upper bounds of household income carry both.`);
    }
    line("counted", "counted", category.basis, { amountCents: amount, lowCents, highCents: high });
  }

  const sum = (selected: IncomeLine[], field: "amountCents" | "lowCents" | "highCents"): number => selected.reduce((total, l) => total + l[field], 0);
  const counted = lines.filter((l) => l.treatment === "counted");

  const summaries = new Map<string | null, MemberIncomeSummary>();
  for (const l of lines) {
    let summary = summaries.get(l.memberId);
    if (!summary) {
      summary = { memberId: l.memberId, countedCents: 0, lowerBoundCents: 0, upperBoundCents: 0, itemIds: [] };
      summaries.set(l.memberId, summary);
    }
    if (l.treatment === "counted") summary.countedCents += l.amountCents;
    summary.lowerBoundCents += l.lowCents;
    summary.upperBoundCents += l.highCents;
    if (!summary.itemIds.includes(l.itemId)) summary.itemIds.push(l.itemId);
  }
  const rosterOrder = new Map<string | null, number>(members.map((member, index) => [member.id, index]));
  const perMember = [...summaries.values()].sort(
    (a, b) => (rosterOrder.get(a.memberId) ?? Number.MAX_SAFE_INTEGER) - (rosterOrder.get(b.memberId) ?? Number.MAX_SAFE_INTEGER),
  );

  return {
    incomeYear,
    taxonomyVersion: INCOME_TAXONOMY_VERSION,
    ruleSet: INCOME_RULE_SET,
    totalCountedCents: sum(counted, "amountCents"),
    lowerBoundCents: sum(lines, "lowCents"),
    upperBoundCents: sum(lines, "highCents"),
    perMember,
    counted,
    excluded: lines.filter((l) => l.treatment === "excluded"),
    needsReview: lines.filter((l) => l.treatment === "review"),
    reviewFlags: flags,
  };
}
