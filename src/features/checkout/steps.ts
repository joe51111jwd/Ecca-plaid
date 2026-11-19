/**
 * The donor checkout as four short steps. Pure: which step a field lives on, which problems belong to which
 * step, and how a step is written in the URL. No React and no server imports, so it is unit-tested directly and
 * safe in the client bundle.
 *
 * Steps only arrange the form. The donations service still validates the whole checkout and decides whether an
 * order can be placed; a step's problems are just the service's problems for the fields that step shows.
 */
import { orderedErrors } from "./form-state";

export const CHECKOUT_STEPS = ["gift", "about", "confirm", "review"] as const;
export type CheckoutStepId = (typeof CHECKOUT_STEPS)[number];

/** The query parameter that carries the step, so a step can be linked to and survives a reload. */
export const STEP_PARAM = "step";

/** Short names for the progress indicator and the headings. */
export const STEP_LABELS: Readonly<Record<CheckoutStepId, string>> = {
  gift: "Gift",
  about: "About you",
  confirm: "Confirm",
  review: "Review and pay",
};

export const STEP_TITLES: Readonly<Record<CheckoutStepId, string>> = {
  gift: "Your gift",
  about: "About you",
  confirm: "Confirm your gift",
  review: "Review and pay",
};

export function isCheckoutStep(value: unknown): value is CheckoutStepId {
  return typeof value === "string" && (CHECKOUT_STEPS as readonly string[]).includes(value);
}

/** The step named in the URL; anything missing or unknown starts at the first step. */
export function parseStep(raw: string | null | undefined): CheckoutStepId {
  return isCheckoutStep(raw) ? raw : "gift";
}

export function stepIndex(step: CheckoutStepId): number {
  return CHECKOUT_STEPS.indexOf(step);
}

export function nextStep(step: CheckoutStepId): CheckoutStepId | null {
  return CHECKOUT_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: CheckoutStepId): CheckoutStepId | null {
  const i = stepIndex(step);
  return i > 0 ? CHECKOUT_STEPS[i - 1] : null;
}

export interface StepLayout {
  /**
   * True when both spouses give on a joint return: each spouse's share and designated amount are then asked in
   * "About you" (they depend on the filing status), not in "Gift".
   */
  jointShares: boolean;
}

const ABOUT_CONTRIBUTOR_FIELDS = new Set(["firstName", "middleName", "lastName", "suffix", "email", "giftCents", "expectedStateCreditCents", "otherQualifiedContributionsCents"]);

/**
 * The step that shows a field. Paths the form does not show (the session, the organization, the mode, the time
 * zone) belong to "review", where the order is placed and every remaining problem is listed.
 */
export function stepOfPath(path: string, layout: StepLayout): CheckoutStepId {
  const [head, second, third] = path.split(".");
  if (head === "giftCents") return "gift";
  if (head === "filingStatus" || head === "bothSpousesContribute" || head === "email" || head === "address" || head === "liability") return "about";
  if (head === "attestations" || head === "designationConfirmed") return "confirm";
  if (head === "contributors" && (second === "primary" || second === "spouse") && third) {
    if (third === "designatedCents") return layout.jointShares ? "about" : "gift";
    if (third === "eDeliveryConsent") return "confirm";
    if (ABOUT_CONTRIBUTOR_FIELDS.has(third)) return "about";
  }
  return "review";
}

export type StepProblems = Record<CheckoutStepId, Array<{ path: string; message: string }>>;

/** Problems grouped by the step that shows the field, each group in the form's field order. */
export function problemsByStep(errors: Readonly<Record<string, string>>, layout: StepLayout): StepProblems {
  const out: StepProblems = { gift: [], about: [], confirm: [], review: [] };
  for (const problem of orderedErrors(errors)) out[stepOfPath(problem.path, layout)].push(problem);
  return out;
}

/**
 * The problems that stop "Continue" on a step. All of a step's problems do, with one exception: before a filing
 * status is chosen, the designated amount on "Gift" does not hold the donor back, because choosing "married filing
 * jointly" on the next step moves each spouse's share and designation there (a $3,400 joint gift would otherwise be
 * refused on step one for exceeding one taxpayer's default). Those problems still block placing the order.
 */
export function blockingProblems(step: CheckoutStepId, errors: Readonly<Record<string, string>>, layout: StepLayout & { filingStatusChosen: boolean }): Array<{ path: string; message: string }> {
  const problems = problemsByStep(errors, layout)[step];
  if (step !== "gift" || layout.filingStatusChosen) return problems;
  return problems.filter((p) => !/^contributors\.(primary|spouse)\.designatedCents$/.test(p.path));
}

/** The earliest step that has a problem, or null when there is none. */
export function firstStepWithProblems(errors: Readonly<Record<string, string>>, layout: StepLayout): CheckoutStepId | null {
  const grouped = problemsByStep(errors, layout);
  return CHECKOUT_STEPS.find((step) => grouped[step].length > 0) ?? null;
}

/** The query string for a step, keeping any other parameters ("?step=about&utm=x"). The first step is written too, so Back is explicit. */
export function stepSearch(currentSearch: string, step: CheckoutStepId): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  params.set(STEP_PARAM, step);
  return `?${params.toString()}`;
}
