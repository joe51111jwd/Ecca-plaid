/**
 * The reason messages the public API and `verification.*` webhooks carry.
 *
 * The engine's own reason messages are written for SGO staff and the evidence pack: several state the household's
 * income ("Household income for 2025 of $41,250.00 is not greater than ..."), the figures on its tax records or
 * the dollar range an ambiguity spans. The API payload is data-minimized (no household income figure, no names),
 * so it carries the code with the fixed, figure-free sentence below. The full engine wording stays in the stored
 * decision, the dashboard detail page and the evidence files the SGO downloads.
 */
import type { ReasonCode } from "@/engine/decision";

export const PUBLIC_REASON_MESSAGES: Readonly<Record<ReasonCode, string>> = Object.freeze({
  /* informational */
  categorical_award_letter_valid: "A current award letter from a listed program supports the categorical method.",
  direct_income_within_limit: "Household income for the income year is not greater than the income limit.",
  direct_income_over_limit: "Household income for the income year is greater than the income limit.",
  direct_evidence_also_provided: "Income documents were also provided; the decision rests on the categorical method.",
  direct_evidence_wrong_year: "Some income evidence is for a different year than the income year and was not used.",
  income_ambiguity_does_not_change_result: "Some income is treated differently under different readings of the rules; the result is the same under every reading.",
  sgo_stricter_cap_applied: "The scholarship granting organization applies an income cap stricter than the statutory one.",
  custody_this_household_longest: "The student lived in more than one household and spent more than half of the income year in this one.",
  custody_equal_time_higher_income: "The student spent equal time in more than one household and this household reported the higher income.",
  information_missing: "The household still has to provide information before the income requirement can be decided.",
  reviewer_resolved: "A reviewer at the scholarship granting organization resolved this verification.",
  /* sent to a person */
  categorical_direct_conflict: "The award letter and the income documents point to different outcomes.",
  between_provisional_readings: "Household income falls between the two readings of the provisional income limit.",
  near_provisional_threshold: "Household income is too close to the income limit to decide automatically.",
  income_range_spans_limit: "Depending on points the sources leave open, household income could be on either side of the limit.",
  no_documentary_evidence: "There is no documentary evidence of household income on file.",
  county_not_in_threshold_table: "No income limit is available for the household's county.",
  household_size_not_in_published_table: "The income limit table has no figure for this household size.",
  application_date_in_earlier_year: "The application is dated in an earlier year than the year the decision is being made.",
  /* award letters that cannot support the categorical method */
  program_medicaid_not_listed: "Medicaid is not one of the programs the categorical method lists.",
  program_chip_not_listed: "CHIP is not one of the programs the categorical method lists.",
  program_ssdi_rsdi_not_listed: "Social Security disability or retirement benefits are not one of the programs the categorical method lists.",
  program_school_meals_not_accepted: "School meal approval is not accepted for the categorical method.",
  program_not_listed: "The letter is for a program the categorical method does not list.",
  letter_shows_denial: "The letter shows a denial.",
  letter_shows_termination: "The letter shows that benefits ended.",
  letter_shows_pending_application: "The letter shows an application that has not been decided.",
  letter_older_than_12_months: "The letter is more than 12 months old.",
  /* award letters that need a person */
  program_not_recognized: "The program on the letter was not recognized.",
  approval_status_unclear: "The letter does not clearly show an approval.",
  letter_date_unreadable: "The date of the letter could not be read.",
  letter_dated_in_future: "The letter is dated in the future.",
  letter_window_depends_on_reference_date: "Whether the letter is recent enough depends on which date it is measured from.",
  benefit_period_ended: "The benefit period on the letter has ended.",
  documentation_not_award_letter: "The document is not an award or approval letter.",
  recipient_not_matched: "The person named on the letter could not be matched to the household.",
  recipient_match_low_confidence: "The person named on the letter matches the household only with low confidence.",
  letter_low_extraction_confidence: "The letter was read with low confidence.",
  letter_read_by_model: "The letter was read by the model reader and needs a person to confirm it.",
  /* shared custody */
  custody_time_unclear: "The answers about where the student lives do not settle which household counts.",
  custody_equal_time_income_unknown: "The student spent equal time in more than one household and it is not known which household has the higher income.",
  custody_equal_time_other_household_higher: "The student spent equal time in more than one household and the other household has the higher income.",
  custody_answers_inconsistent: "The answers about where the student lives are inconsistent.",
  /* income evidence */
  self_employment_income: "The household has self-employment income, which needs a person.",
  income_item_unknown_member: "Some income is attributed to someone who is not on the household roster.",
  category_member_mismatch: "Some income is of a kind that does not fit any household member on the roster.",
  unknown_income_category: "Some income is of an unknown kind.",
  income_category_needs_review: "Some income is of a kind whose treatment needs a person.",
  amount_basis_unsettled: "Which amount counts for some income is not settled.",
  net_loss_not_offset: "A net loss is on file; it is not subtracted from other income.",
  dependent_deduction_amount_unconfirmed: "Some income counts only up to a deduction amount that is not confirmed for the income year.",
  minor_head_or_spouse_income: "Earned income of a member under 18 is counted because the member is recorded as head of household or the head's spouse.",
  member_age_unknown: "The age of a household member with income is not known.",
  unrelated_member_income: "A household member who is not part of the family has income.",
  earned_income_unattributed: "Some earned income could not be attributed to a household member.",
  income_figures_conflict: "Income figures on different documents do not agree.",
  pay_stub_projection_only: "Only a pay stub projection is available for some income.",
  wages_from_pay_stub_only: "Some wages are documented only by a pay stub.",
  tax_record_incompletely_read: "Not every income line of a tax record was read.",
  schedule_e_income_needs_review: "Rental, royalty or partnership income needs a person.",
  tax_records_overlap: "Tax records cover overlapping but different household members and cannot be reconciled automatically.",
  zero_income_certification_contradicted: "A signed statement of no income is contradicted by other evidence.",
  document_not_read: "A document could not be read.",
  document_read_by_model: "A document was read by the model reader and needs a person to confirm it.",
  document_low_confidence: "A document was read with low confidence.",
  evidence_source_unknown: "The source of some income evidence is not known.",
  rail_bank_net_deposits: "Income from a bank connection is based on net deposits and needs a person.",
});

/** Sentence for a code this version does not know (a decision stored by an older or newer engine). */
export const PUBLIC_REASON_FALLBACK = "See the evidence pack for details.";

/** The figure-free public sentence for a reason code. */
export function publicReasonMessage(code: string): string {
  return Object.prototype.hasOwnProperty.call(PUBLIC_REASON_MESSAGES, code) ? PUBLIC_REASON_MESSAGES[code as ReasonCode] : PUBLIC_REASON_FALLBACK;
}
