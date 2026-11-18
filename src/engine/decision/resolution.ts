/**
 * A reviewer's resolution of a verification that needs review.
 *
 * The reviewer decides; the engine keeps the decision inside the rules it enforces everywhere:
 *  - Only a verification in `needs_review` can be resolved. One that is `pending` is missing information
 *    (ask the household, or key the document and run the engine again); one that is decided stays decided.
 *  - A resolution needs written notes. The evidence pack must say who reviewed an exception and why.
 *  - A resolution names the listed method it rests on. "Eligible" on the categorical method names the
 *    award letter, which must be for one of the five programs, carry a date and have no disqualifying
 *    defect: a reviewer cannot widen the proposed rule's closed program list.
 *  - "Eligible" is refused when the recorded household income is above the statutory 300 percent limit
 *    under every reading. The statute sets that limit and no reviewer can waive it; if the recorded income
 *    is wrong, the income record is corrected and the engine run again.
 *  - "Ineligible" means the evidence shows income over the limit. It is refused when no income is recorded
 *    or the recorded income is within the SGO's limit under every reading.
 *
 * The engine's own outcome (status, reasons, review reasons) is preserved in `engineOutcome` for the
 * evidence pack.
 */
import { z } from "zod";
import { formatUsd } from "@/lib/money";
import { conflict, invalid } from "@/lib/errors";
import { idSchema, isoDateSchema, lastDayOfYear, parseInput, yearOf, type HouseholdIncomeResult, type IsoDate } from "@/engine/income";
import { categoricalValidUntil } from "./categorical";
import { METHOD_CITATIONS } from "./policy";
import type { Decision, MethodBasis, ReviewerBasis } from "./types";

export interface ReviewerResolutionInput {
  resolution: "eligible" | "ineligible";
  /** The reviewer's user id. */
  reviewerId: string;
  /** Why the reviewer decided as they did. Required. */
  notes: string;
  basis: ReviewerBasis;
  /** The date of the resolution, YYYY-MM-DD (the caller reads the clock). */
  resolvedOn: IsoDate;
}

/** `details.reason` of the `conflict` AppError thrown when a resolution is refused. */
export type ResolutionRefusal =
  | "not_in_review"
  | "income_above_statutory_limit"
  | "no_income_limit_on_record"
  | "no_income_on_record"
  | "income_not_over_limit"
  | "letter_not_on_record"
  | "letter_cannot_support_categorical";

const resolutionSchema = z.strictObject({
  resolution: z.enum(["eligible", "ineligible"]),
  reviewerId: idSchema,
  notes: z
    .string()
    .max(4000)
    .refine((notes) => notes.trim().length > 0, "notes are required: say what was checked and why the verification is resolved this way"),
  basis: z.discriminatedUnion("method", [z.strictObject({ method: z.literal("direct") }), z.strictObject({ method: z.literal("categorical"), documentId: idSchema })]),
  resolvedOn: isoDateSchema,
});

function refuse(reason: ResolutionRefusal, message: string): never {
  throw conflict(message, { reason });
}

function directBasis(income: HouseholdIncomeResult | null): MethodBasis {
  const lines = income ? [...income.counted, ...income.needsReview] : [];
  const written = lines.some((line) => line.source === "document" || line.source === "reviewer");
  const data = lines.some((line) => line.source === "rail");
  if (written && data) return "written_documentation_and_other_relevant_data_sources";
  return data ? "other_relevant_data_sources" : "written_documentation";
}

/**
 * Returns the final decision, marked as decided by the reviewer. Does not modify `decision`.
 *
 * Throws `validation_failed` for malformed input (including missing notes and an "ineligible" resolution on
 * the categorical method) and `conflict`, with `details.reason`, when the rules above refuse the resolution.
 */
export function applyReviewerResolution(decision: Decision, rawInput: ReviewerResolutionInput): Decision {
  const input = parseInput(resolutionSchema, rawInput, "reviewer resolution");
  if (decision.status !== "needs_review" || decision.decidedBy.type !== "engine") {
    refuse("not_in_review", `Only a verification that needs review can be resolved. This one is ${decision.status}.`);
  }
  if (input.resolvedOn < decision.decidedOn) {
    throw invalid("Invalid reviewer resolution: resolvedOn is before the date the engine sent the verification to review", { fields: { resolvedOn: "must not be before decision.decidedOn" } });
  }
  if (input.resolution === "ineligible" && input.basis.method !== "direct") {
    throw invalid("Invalid reviewer resolution: ineligible means the income evidence shows income over the limit, so it can only rest on the direct method", {
      fields: { basis: "must be the direct method for an ineligible resolution" },
    });
  }

  const { threshold, householdIncomeCents: recorded } = decision;

  if (input.resolution === "eligible") {
    if (recorded !== null && threshold === null) {
      refuse("no_income_limit_on_record", "Household income is recorded, but no income limit is on record to compare it with. Resolve the county or household size first and run the decision again.");
    }
    if (recorded !== null && threshold !== null && recorded > threshold.statutoryUpperBoundCents) {
      refuse(
        "income_above_statutory_limit",
        `The recorded household income of ${formatUsd(recorded)} is above the statutory limit of 300% of area median gross income (${formatUsd(threshold.statutoryUpperBoundCents)}) under every reading. ` +
          "A reviewer cannot resolve this verification as eligible. If the recorded income is wrong, correct it and run the decision again.",
      );
    }
    if (input.basis.method === "direct" && recorded === null) {
      refuse("no_income_on_record", "No household income is recorded, so the verification cannot be resolved as eligible on the direct method.");
    }
  } else {
    if (decision.income === null || threshold === null) {
      refuse("no_income_on_record", "Ineligible means the evidence shows income over the limit. No household income and limit are on record to show that.");
    }
    if (decision.income.upperBoundCents <= threshold.lowerBoundCents) {
      refuse(
        "income_not_over_limit",
        "Ineligible means the evidence shows income over the limit. The recorded household income is within the limit under every reading. Correct the income record, or cancel the verification if it should not proceed.",
      );
    }
  }

  let award: Pick<Decision, "awardProgram" | "awardLetterDate" | "awardLetterDocumentId"> = { awardProgram: null, awardLetterDate: null, awardLetterDocumentId: null };
  let validUntil = lastDayOfYear(yearOf(decision.applicationDate));
  if (input.basis.method === "categorical") {
    const documentId = input.basis.documentId;
    const letter = decision.letters.find((candidate) => candidate.documentId === documentId);
    if (!letter) refuse("letter_not_on_record", "The award letter named in the resolution is not on record for this verification.");
    if (letter.program === null || letter.letterDate === null || letter.defects.some((defect) => defect.kind === "disqualifying")) {
      refuse(
        "letter_cannot_support_categorical",
        "The award letter on record cannot support the categorical method: it must be for SNAP, TANF, WIC, Section 8 housing or SSI, carry a date, and show a current approval dated within the last 12 months. " +
          "If the document was read wrongly, key the correct fields and run the decision again.",
      );
    }
    award = { awardProgram: letter.program, awardLetterDate: letter.letterDate, awardLetterDocumentId: letter.documentId };
    validUntil = categoricalValidUntil(letter, decision.applicationDate);
  }

  const method = input.basis.method;
  const notes = input.notes.trim();
  return {
    ...decision,
    status: input.resolution,
    method,
    methodBasis: method === "categorical" ? "categorical_documentation" : directBasis(decision.income),
    methodCitation: METHOD_CITATIONS[method],
    ...award,
    reasons: [
      ...decision.reasons,
      {
        code: "reviewer_resolved",
        message: `A reviewer resolved this verification as ${input.resolution} on ${input.resolvedOn}, relying on the ${method} method. The points the engine raised for review are kept with the engine's own outcome.`,
        memberIds: [],
        sourceIds: method === "categorical" && award.awardLetterDocumentId ? [award.awardLetterDocumentId] : [],
      },
    ],
    reviewReasons: [],
    validUntil,
    decidedBy: { type: "reviewer", reviewerId: input.reviewerId, resolvedOn: input.resolvedOn, notes, basis: input.basis },
    engineOutcome: {
      status: decision.status,
      method: decision.method,
      reasons: decision.reasons,
      reviewReasons: decision.reviewReasons,
      missing: decision.missing,
      validUntil: decision.validUntil,
      decidedOn: decision.decidedOn,
    },
  };
}
