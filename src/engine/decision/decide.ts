/**
 * The eligibility decision for the household income requirement of section 25F.
 *
 * `decide(input)` is a pure function of its input: the same input always gives the same `Decision`. It
 * reads no clock (the caller passes `today`), no database and no environment. The only thing it looks up is
 * the income limit, through the pure AMI engine, and that too can be injected.
 *
 * WHAT IT DECIDES. One requirement: was the household's income for the calendar year before the application
 * not greater than the SGO's cap (at most 300 percent of area median gross income)? It does not decide
 * whether the student may enroll in a public school, whether the student resides in the State, or whether
 * the SGO awards a scholarship.
 *
 * FIVE RULES THAT HOLD FOR EVERY DECISION (docs/architecture.md, "Verification lifecycle"):
 *  1. A failed, low-confidence or model-read document never produces "eligible". It goes to a person.
 *  2. "ineligible" means the evidence affirmatively shows income over the limit under every reading, with
 *     every adult covered. Missing or doubtful evidence is "pending" or "needs_review".
 *  3. Every decision carries the limit used, its source, table version and effective date, and is marked
 *     provisional while the table is HUD-derived.
 *  4. Nothing here promises an award.
 *  5. Shared custody is never guessed.
 *
 * STATUS.
 *   pending       the household still owes information: `missing` is not empty
 *   needs_review  nothing is missing and a person must settle something: `reviewReasons` is not empty
 *   eligible      a listed method is satisfied and nothing is open
 *   ineligible    the direct method affirmatively shows income over the limit and nothing is open
 *
 * METHOD CHOICE. A valid award letter is sufficient and is the recorded method; income documents that are
 * also on file are noted, not needed. If those documents show income over the limit while the letter
 * passes, the two contradict each other and a person decides. A letter that only a person can confirm sends
 * the file to review unless the income documents already show income within the limit. A letter that cannot
 * be used is explained and the direct method takes over; it never makes a household ineligible.
 */
import { z } from "zod";
import { getActiveTable, getThreshold, type AmiTable, type ThresholdErrorReason } from "@/engine/ami";
import {
  householdMembersSchema,
  idSchema,
  incomeCertificationSchema,
  incomeDocumentSourceSchema,
  incomeItemsSchema,
  incomeReviewFlagSchema,
  incomeYearSchema,
  isoDateSchema,
  lastDayOfYear,
  MAX_HOUSEHOLD_MEMBERS,
  parseInput,
  yearOf,
  type IsoDate,
  type MissingItem,
} from "@/engine/income";
import { AppError, invalid, isAppError } from "@/lib/errors";
import { CATEGORICAL_PROGRAM_LABELS, categoricalValidUntil, evaluateCategorical } from "./categorical";
import { evaluateCustody } from "./custody";
import { evaluateDirect } from "./direct";
import { DECISION_ENGINE_VERSION, DECISION_RULE_SET, DEFAULT_DECISION_POLICY, MAX_REVIEW_BAND_BPS, METHOD_CITATIONS, STATUTORY_CAP_PCT, type DecisionPolicy } from "./policy";
import { toThresholdBounds } from "./threshold-bounds";
import type {
  Decision,
  DecisionInput,
  DecisionMethod,
  DecisionReason,
  DecisionThreshold,
  InjectedThreshold,
  LetterEvaluation,
  SgoPolicyInput,
  ThresholdTableInfo,
} from "./types";

/* --------------------------------------------------------------------------------------- schema */

const confidence = z.number().min(0).max(1);

const custodySchema = z.strictObject({
  livesInMultipleHouseholds: z.boolean(),
  monthsInThisHousehold: z.number().min(0).max(12).nullable().optional(),
  equalTime: z.boolean().nullable().optional(),
  thisHouseholdHasHigherIncome: z.enum(["yes", "no", "unknown"]).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const letterSchema = z.strictObject({
  documentId: idSchema,
  program: z.string().max(200),
  letterDate: isoDateSchema.nullable(),
  approvalStatus: z.enum(["approved", "denied", "terminated", "pending", "unclear"]),
  recipientName: z.string().max(200).nullable(),
  matchedMemberId: idSchema.nullable(),
  nameMatchConfidence: confidence,
  extractionConfidence: confidence,
  extractedBy: z.enum(["parser", "model", "reviewer"]),
  benefitPeriodEnd: isoDateSchema.nullable().optional(),
});

const directSchema = z.strictObject({
  incomeYear: incomeYearSchema,
  items: incomeItemsSchema,
  certifications: z.array(incomeCertificationSchema).max(500).optional(),
  sources: z.array(incomeDocumentSourceSchema).max(500).optional(),
  evidenceFlags: z.array(incomeReviewFlagSchema).max(500).optional(),
});

const railReportSchema = z.strictObject({
  railConnectionId: idSchema,
  provider: z.string().min(1).max(100),
  kind: z.enum(["payroll", "bank", "transcript"]),
  dataBasis: z.enum(["payroll_gross", "bank_net_deposits", "irs_records"]),
  retrievedOn: isoDateSchema,
});

const policySchema = z.strictObject({
  version: z.string().min(1).max(100),
  awardLetterWindowMonths: z.number().int().min(1).max(24),
  minExtractionConfidence: confidence,
  minNameMatchConfidence: confidence,
  modelReadDocumentsMayAutoDecide: z.boolean(),
  certificationsAloneNeedReview: z.boolean(),
});

const decisionInputSchema = z
  .strictObject({
    today: isoDateSchema,
    applicationDate: isoDateSchema.optional(),
    sgoPolicy: z.strictObject({
      capPct: z.number().int().min(1).max(STATUTORY_CAP_PCT),
      reviewBandBps: z.number().int().min(0).max(MAX_REVIEW_BAND_BPS),
    }),
    household: z.strictObject({
      size: z.number().int().min(1).max(MAX_HOUSEHOLD_MEMBERS).nullable(),
      countyFips: z.string().max(20).nullable(),
      members: householdMembersSchema,
      custody: custodySchema.nullable(),
    }),
    categorical: z.strictObject({ letters: z.array(letterSchema).max(50) }).nullable().optional(),
    direct: directSchema.nullable().optional(),
    railReports: z.array(railReportSchema).max(50).optional(),
    amiTable: z.custom<AmiTable>().optional(),
    threshold: z.custom<InjectedThreshold>().optional(),
    policy: policySchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.applicationDate !== undefined && input.applicationDate > input.today) {
      ctx.addIssue({ code: "custom", path: ["applicationDate"], message: "must not be later than today" });
    }
    const seen = new Set<string>();
    input.categorical?.letters.forEach((letter, index) => {
      if (seen.has(letter.documentId)) ctx.addIssue({ code: "custom", path: ["categorical", "letters", index, "documentId"], message: `duplicate document id ${letter.documentId}` });
      seen.add(letter.documentId);
    });
  });

/* ------------------------------------------------------------------------------------ threshold */

function tableInfo(source: { source: ThresholdTableInfo["source"]; tableVersion: string; effectiveDate: string; provisional: boolean }): ThresholdTableInfo {
  // "Provisional" is a fact about the source, not a separate switch: the two can never disagree on a decision.
  if (source.provisional !== (source.source === "hud_provisional")) {
    throw invalid(`Threshold table ${source.tableVersion} is inconsistent: provisional must be true exactly when the source is hud_provisional`);
  }
  return { source: source.source, tableVersion: source.tableVersion, effectiveDate: source.effectiveDate, provisional: source.provisional };
}

function buildThreshold(result: InjectedThreshold, sgoPolicy: SgoPolicyInput): DecisionThreshold {
  const bounds = toThresholdBounds(result);
  const applied = result.provisional && sgoPolicy.reviewBandBps > 0;
  // Rounded up to the cent, so the band is never narrower than the SGO asked for.
  const band = (limitCents: number): number => (applied ? Number((BigInt(limitCents) * BigInt(sgoPolicy.reviewBandBps) + 9_999n) / 10_000n) : 0);
  const belowLowerCents = band(bounds.lowerBoundCents);
  const aboveUpperCents = band(bounds.upperBoundCents);
  return {
    ...result,
    ...bounds,
    reviewBand: { bps: sgoPolicy.reviewBandBps, applied, belowLowerCents, aboveUpperCents },
    // "Within the band" includes its edge, so the automatic cut-off sits one cent below it. With no band the
    // statutory test applies as written: income equal to the limit is not greater than it.
    autoEligibleMaxCents: applied ? bounds.lowerBoundCents - belowLowerCents - 1 : bounds.lowerBoundCents,
    autoIneligibleAboveCents: bounds.upperBoundCents + aboveUpperCents,
    reliedOn: "none",
    reliedOnLimitCents: null,
  };
}

const THRESHOLD_REVIEW: Partial<Record<ThresholdErrorReason, { code: "county_not_in_threshold_table" | "household_size_not_in_published_table"; message: (detail: string) => string }>> = {
  county_outside_state: { code: "county_not_in_threshold_table", message: (detail) => `No income limit is available for the household's county. ${detail}` },
  unknown_county: { code: "county_not_in_threshold_table", message: (detail) => `No income limit is available for the household's county. ${detail}` },
  household_size_not_published: { code: "household_size_not_in_published_table", message: (detail) => detail },
};

/* --------------------------------------------------------------------------------------- decide */

/**
 * Decides the household income requirement from the evidence on file.
 *
 * Throws a `validation_failed` AppError for malformed input (including an SGO cap above 300 percent, an
 * application date after `today`, and an injected threshold that is not for this household). It never
 * throws for what the evidence says: every such outcome is a status with reasons.
 */
export function decide(rawInput: DecisionInput): Decision {
  const input = parseInput(decisionInputSchema, rawInput, "decision input") as DecisionInput;
  const policy: DecisionPolicy = input.policy ?? DEFAULT_DECISION_POLICY;
  const { today, sgoPolicy, household } = input;
  const applicationDate: IsoDate = input.applicationDate ?? today;
  const incomeYear = yearOf(applicationDate) - 1;
  const railReports = input.railReports ?? [];

  const missing: MissingItem[] = [];
  const reasons: DecisionReason[] = [];
  const reviewReasons: DecisionReason[] = [];
  const householdMissing = (code: MissingItem["code"], message: MissingItem["message"]): void => {
    missing.push({ code, memberId: null, itemId: null, incomeYear: null, accepts: ["household_details"], message });
  };

  /* Household facts. */
  if (household.size === null) {
    householdMissing("household_size", { en: "How many people live in the home, including the student.", es: "Cuántas personas viven en el hogar, incluido el estudiante." });
  } else if (household.size !== household.members.length) {
    const listed = household.members.length;
    householdMissing("household_roster", {
      en: `Each person who lives in the home. The household size you gave is ${household.size}, and ${listed} ${listed === 1 ? "person is" : "people are"} listed.`,
      es: `Cada persona que vive en el hogar. El tamaño del hogar que indicó es ${household.size} y hay ${listed} ${listed === 1 ? "persona" : "personas"} en la lista.`,
    });
  }
  const countyMissing = (): void =>
    householdMissing("county", { en: "The county where the household lives. Check the home address.", es: "El condado donde vive el hogar. Revise la dirección de la vivienda." });
  if (household.countyFips === null) countyMissing();

  /* The limit. */
  let threshold: DecisionThreshold | null = null;
  let thresholdTable: ThresholdTableInfo;
  if (input.threshold) {
    thresholdTable = tableInfo(input.threshold);
    if (household.size !== null && household.countyFips !== null) {
      const injected = input.threshold;
      if (injected.capPct !== sgoPolicy.capPct || injected.householdSize !== household.size || injected.county.fips !== household.countyFips) {
        throw invalid("Invalid decision input: the injected threshold is not for this household's county, household size and SGO cap", {
          fields: { threshold: "must match household.countyFips, household.size and sgoPolicy.capPct" },
        });
      }
      threshold = buildThreshold(injected, sgoPolicy);
    }
  } else {
    const table = input.amiTable ?? getActiveTable();
    thresholdTable = tableInfo({ source: table.source, tableVersion: table.version, effectiveDate: table.effectiveDate, provisional: table.provisional });
    if (household.size !== null && household.countyFips !== null) {
      try {
        threshold = buildThreshold(getThreshold({ countyFips: household.countyFips, householdSize: household.size, capPct: sgoPolicy.capPct, table }), sgoPolicy);
      } catch (error) {
        const reason = isAppError(error) ? (error.details as { reason?: ThresholdErrorReason } | undefined)?.reason : undefined;
        const review = reason ? THRESHOLD_REVIEW[reason] : undefined;
        if (reason === "malformed_county_fips") countyMissing();
        else if (review) reviewReasons.push({ code: review.code, message: review.message((error as AppError).message), memberIds: [], sourceIds: [] });
        else throw error;
      }
    }
  }

  /* Shared custody. */
  const custody = evaluateCustody(household.custody);
  if (custody.determination.outcome === "not_answered") {
    householdMissing("shared_custody_answers", {
      en: `Whether the student lived in more than one household during ${incomeYear}.`,
      es: `Si el estudiante vivió en más de un hogar durante ${incomeYear}.`,
    });
  }
  if (custody.reviewReason) reviewReasons.push(custody.reviewReason);
  if (custody.reason) reasons.push(custody.reason);

  /* The application date fixes the income year; a decision made in a later calendar year is not guessed at. */
  const incomeYearUnconfirmed = yearOf(applicationDate) !== yearOf(today);
  if (incomeYearUnconfirmed) {
    reviewReasons.push({
      code: "application_date_in_earlier_year",
      message:
        `The application is dated ${applicationDate} and the decision is being made in ${yearOf(today)}. The income year follows the application date (${incomeYear}). ` +
        "The proposed rules do not define the date of the application, so a reviewer must confirm which calendar year's income applies.",
      memberIds: [],
      sourceIds: [],
    });
  }

  /* The two methods. */
  const categorical = evaluateCategorical(input.categorical?.letters ?? [], { applicationDate, today, members: household.members, policy });
  const direct = evaluateDirect(input.direct, { incomeYear, members: household.members, threshold, railReports, policy });
  const letterReasons = (letters: LetterEvaluation[], kinds: Array<"disqualifying" | "ambiguous">): DecisionReason[] =>
    letters.flatMap((letter) =>
      letter.defects
        .filter((defect) => kinds.includes(defect.kind))
        .map((defect) => ({ code: defect.code, message: defect.message, memberIds: letter.matchedMemberId === null ? [] : [letter.matchedMemberId], sourceIds: [letter.documentId] })),
    );
  const unusableLetters = categorical.letters.filter((letter) => letter.outcome === "fail");
  const reviewableLetters = categorical.letters.filter((letter) => letter.outcome === "review");
  // The recorded income documents put household income above the limit under at least one reading.
  const directShowsOver = direct.income !== null && threshold !== null && direct.income.upperBoundCents > threshold.lowerBoundCents;
  const conflict = (message: string): DecisionReason => ({
    code: "categorical_direct_conflict",
    message,
    memberIds: [],
    sourceIds: categorical.letters.filter((letter) => letter.outcome !== "fail").map((letter) => letter.documentId),
  });

  let candidate: { status: "eligible" | "ineligible"; method: DecisionMethod } | null = null;
  const best = categorical.best;
  if (best) {
    if (directShowsOver) {
      reviewReasons.push(
        conflict(
          "A valid award letter is on file, and the income documents on file show household income above the limit. The two do not fit together, so a reviewer must look at both before anything is decided.",
        ),
      );
      reasons.push(...direct.reasons);
    } else {
      candidate = { status: "eligible", method: "categorical" };
      reasons.push({
        code: "categorical_award_letter_valid",
        message:
          `An award letter dated ${best.letterDate} shows that a member of the household is currently approved for ${CATEGORICAL_PROGRAM_LABELS[best.program!].en}. ` +
          "It is dated within the last 12 months, so the household income requirement is met through the categorical method under the proposed rules.",
        memberIds: best.matchedMemberId === null ? [] : [best.matchedMemberId],
        sourceIds: [best.documentId],
      });
      if (direct.outcome !== "none") {
        reasons.push({ code: "direct_evidence_also_provided", message: "Income documents were also provided. The award letter is sufficient, so they were recorded and not relied on.", memberIds: [], sourceIds: [] });
      }
    }
  } else {
    reasons.push(...letterReasons(unusableLetters, ["disqualifying", "ambiguous"]));
    reasons.push(...direct.reasons);
    if (direct.outcome === "within_limit") {
      candidate = { status: "eligible", method: "direct" };
      // A letter that would need a person is not needed: the income documents settle it.
      reasons.push(...letterReasons(reviewableLetters, ["disqualifying", "ambiguous"]));
    } else if (reviewableLetters.length > 0) {
      reviewReasons.push(...letterReasons(reviewableLetters, ["disqualifying", "ambiguous"]), ...direct.reviewReasons);
      if (directShowsOver) {
        reviewReasons.push(conflict("An award letter that needs a reviewer is on file, and the income documents on file show household income above the limit. A reviewer must look at both."));
      }
    } else if (direct.outcome === "over_limit") {
      candidate = { status: "ineligible", method: "direct" };
    } else if (incomeYearUnconfirmed) {
      // Which year's documents to ask for is the very thing a reviewer has to confirm first.
      reviewReasons.push(...direct.reviewReasons);
    } else if (direct.outcome === "incomplete") {
      missing.push(...direct.coverage!.missing);
      reviewReasons.push(...direct.reviewReasons);
    } else if (direct.outcome === "none") {
      missing.push({
        code: "evidence_for_any_method",
        memberId: null,
        itemId: null,
        incomeYear,
        accepts: ["award_letter", "income_document"],
        message: {
          en: `Either an approval letter dated within the last 12 months showing that someone in your household is approved for SNAP, TANF, WIC, Section 8 housing or SSI, or proof of ${incomeYear} income for each adult in your household.`,
          es: `Una carta de aprobación con fecha de los últimos 12 meses que muestre que alguien de su hogar está aprobado para SNAP, TANF, WIC, vivienda de la Sección 8 o SSI, o un comprobante de los ingresos de ${incomeYear} de cada adulto de su hogar.`,
        },
      });
    } else {
      reviewReasons.push(...direct.reviewReasons);
    }
  }

  if (sgoPolicy.capPct < STATUTORY_CAP_PCT) {
    reasons.push({
      code: "sgo_stricter_cap_applied",
      message: `The scholarship granting organization applies an income cap of ${sgoPolicy.capPct}% of area median gross income, which is stricter than the statutory ${STATUTORY_CAP_PCT}%.`,
      memberIds: [],
      sourceIds: [],
    });
  }

  /* Status. */
  let status: Decision["status"];
  if (missing.length > 0) {
    status = "pending";
    reasons.push({
      code: "information_missing",
      message: `The household still has to provide ${missing.length === 1 ? "one item" : `${missing.length} items`} before the income requirement can be decided.`,
      memberIds: [],
      sourceIds: [],
    });
  } else if (reviewReasons.length > 0) {
    status = "needs_review";
  } else if (candidate) {
    status = candidate.status;
  } else {
    throw new AppError("internal", "Decision engine reached no outcome");
  }
  const decided = status === "eligible" || status === "ineligible" ? candidate : null;

  if (decided?.method === "direct" && threshold && direct.reliedOn) {
    threshold = {
      ...threshold,
      reliedOn: threshold.readingsAgree ? "single_limit" : direct.reliedOn,
      reliedOnLimitCents: direct.reliedOn === "lower_bound" ? threshold.lowerBoundCents : threshold.upperBoundCents,
    };
  }
  const categoricalDecision = decided?.method === "categorical" && best ? best : null;
  const validUntil = !decided ? null : categoricalDecision ? categoricalValidUntil(categoricalDecision, applicationDate) : lastDayOfYear(yearOf(applicationDate));

  return {
    status,
    method: decided?.method ?? null,
    methodBasis: !decided ? null : decided.method === "categorical" ? "categorical_documentation" : direct.methodBasis,
    methodCitation: decided ? METHOD_CITATIONS[decided.method] : null,
    applicationDate,
    incomeYear,
    householdSize: household.size,
    countyFips: household.countyFips,
    thresholdTable,
    threshold,
    householdIncomeCents: direct.income?.totalCountedCents ?? null,
    income: direct.income,
    coverage: direct.coverage,
    directOutcome: direct.outcome,
    awardProgram: categoricalDecision?.program ?? null,
    awardLetterDate: categoricalDecision?.letterDate ?? null,
    awardLetterDocumentId: categoricalDecision?.documentId ?? null,
    letters: categorical.letters,
    custody: custody.determination,
    reasons,
    reviewReasons,
    missing,
    provisional: thresholdTable.provisional,
    validUntil,
    sgoPolicy: { capPct: sgoPolicy.capPct, reviewBandBps: sgoPolicy.reviewBandBps },
    engineVersion: DECISION_ENGINE_VERSION,
    ruleSet: { ...DECISION_RULE_SET },
    policy: { ...policy },
    decidedOn: today,
    decidedBy: { type: "engine" },
    engineOutcome: null,
  };
}
