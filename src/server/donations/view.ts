import type { Mode } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { formatUsd } from "@/lib/money";
import type { FeeStructure as SettingsFeeStructure } from "@/taxmath";
import { stateName, type ListStatus, type UsStateCode } from "@/server/sgos";
import {
  assessCreditEligibility,
  computeGiftLines,
  copySha256,
  determineTaxYear,
  formatIsoDateLong,
  getCopy,
  previewCredit,
  renderCopyDynamic,
  renderCopyWithProof,
  renderCreditPanel,
  type CopyId,
  type CopyLocale,
  type CreditEligibilityResult,
  type CreditPanel,
  type CreditPreview,
  type GiftLines,
  type RenderedCopy,
  type SgoListSource,
  type StateParticipationStatus,
} from "@/taxmath";
import { CONTRIBUTOR_KEYS, nonIndividualNameWord, resolveOrder, type CheckoutForm, type ContributorKey, type ResolvedContributor, type ResolvedOrder } from "./form";
import { DEFAULT_DONOR_TIME_ZONE, MAX_GIFT_CENTS, MIN_GIFT_CENTS, NON_DESIGNATED_COLLECTION, PREVIEW_PAYMENT_METHOD, STATE_PARTICIPATION_INFERENCE } from "./policy";

/**
 * Everything the checkout page renders, computed from the saved form and the SGO's current standing. Pure:
 * the services load the context (`./checkout.ts`) and this decides. Every number, gate, fee line and sentence
 * of tax copy comes from src/taxmath; nothing here re-words or re-computes them.
 */

export type CheckoutStatus = "open" | "awaiting_payment" | "completed" | "expired" | "canceled";

export interface CheckoutListContext {
  status: ListStatus;
  source: SgoListSource;
  /** The list module's label (never a claim that a gift is credit-eligible). */
  label: string;
  entryId: string | null;
  listedFrom: string | null;
  removedOn: string | null;
  /** When the list file that confirmed the entry was retrieved (ISO 8601), if known. */
  retrievedAt: string | null;
  /** Set when the list module refuses a gift right now (removed, unlisted, not accepting gifts). */
  refusal: { reason: string; message: string } | null;
}

export interface FeesSettingSnapshot {
  active: SettingsFeeStructure;
  sgoFeeBps: number;
  donorServiceFeeBps: number;
  counselMemoRef: string | null;
}

export interface CheckoutContext {
  now: Date;
  session: {
    id: string;
    mode: Mode;
    status: CheckoutStatus;
    source: "hosted" | "widget";
    createdAt: Date;
    expiresAt: Date;
    placedAt: Date | null;
    paymentId: string | null;
    orderNumber: number;
  };
  sgo: {
    orgId: string;
    slug: string;
    displayName: string;
    legalName: string | null;
    ein: string | null;
    state: UsStateCode;
    portalRegistered: boolean;
  };
  list: CheckoutListContext;
  settings: { creditStartDate: string; liveEnabled: boolean; fees: FeesSettingSnapshot };
}

export type CopyPlacement = "list" | "panel" | "designation" | "attestation" | "consent" | "notice" | "joint" | "fee" | "eligibility";

export interface ViewCopy {
  id: CopyId;
  placement: CopyPlacement;
  text: string;
}

export interface ViewAttestation {
  key: "individual" | "usCitizenOrResident" | "noEarmark" | "notInExchangeForScholarship" | "jointOnBehalfOfBoth";
  copyId: CopyId;
  text: string;
  confirmed: boolean;
}

export interface ViewConsent {
  key: ContributorKey;
  role: ResolvedContributor["role"];
  email: string | null;
  /** The consent words for this contributor, or null until an email address is known. */
  copy: RenderedCopy | null;
  /** True only when the donor agreed to exactly these words. */
  given: boolean;
}

export interface CheckoutTotals {
  giftCents: number;
  designatedCents: number;
  nonDesignatedCents: number;
  donorServiceFeeCents: number;
  /** What the donor is charged: the gift plus any service fee on top. */
  chargedCents: number;
  /** Fee the SGO is invoiced separately ("sgo_invoiced"); never part of the charge or the designated amount. */
  sgoInvoicedFeeCents: number;
  depositedTo25fAccountCents: number;
}

export interface CheckoutView {
  session: CheckoutContext["session"];
  mode: Mode;
  sgo: CheckoutContext["sgo"];
  list: CheckoutListContext;
  order: ResolvedOrder;
  preview: CreditPreview | null;
  panel: CreditPanel | null;
  eligibility: CreditEligibilityResult;
  fees: GiftLines | null;
  feeStructure: SettingsFeeStructure;
  totals: CheckoutTotals;
  designation: {
    /** The statement with the amounts and names filled in; null until it can be rendered. */
    statement: RenderedCopy | null;
    confirmed: boolean;
    irrevocable: string;
  };
  consents: ViewConsent[];
  attestations: ViewAttestation[];
  /** The four labels the checkout must show when they apply (null when they do not). */
  labels: { provisionalList: string | null; irsList: string | null; beforeCreditStart: string | null; proposedRules: string | null; previewNotTaxAdvice: string };
  /** Every sentence of tax copy to show, by placement, in display order. */
  copy: ViewCopy[];
  /** Problems that block placing the order, by field path. */
  errors: Record<string, string>;
  canPlaceOrder: boolean;
  capabilities: { nonDesignatedCollectible: boolean; editable: boolean };
  donorTimeZone: string;
  locale: CopyLocale;
  copyRegistrySha256: string;
}

/* ------------------------------------------------------------------ copy helpers */

const ATTESTATIONS: ReadonlyArray<{ key: ViewAttestation["key"]; copyId: CopyId; jointOnly: boolean }> = [
  { key: "individual", copyId: "attest.individual", jointOnly: false },
  { key: "usCitizenOrResident", copyId: "attest.us_citizen_or_resident", jointOnly: false },
  { key: "noEarmark", copyId: "attest.no_earmark", jointOnly: false },
  { key: "notInExchangeForScholarship", copyId: "attest.not_in_exchange", jointOnly: false },
  { key: "jointOnBehalfOfBoth", copyId: "attest.joint_on_behalf_of_both", jointOnly: true },
];

/** The attestations that apply to an order (the joint one only when both spouses give). */
export function applicableAttestations(order: ResolvedOrder): ReadonlyArray<{ key: ViewAttestation["key"]; copyId: CopyId }> {
  const bothSpouses = order.joint && order.contributors.length === 2;
  return ATTESTATIONS.filter((a) => !a.jointOnly || bothSpouses);
}

/**
 * The designation statement exactly as the donor must confirm it: the joint form when both spouses give, the
 * single form otherwise. Null until every amount is positive and every contributor's name is known.
 */
export function renderDesignationStatement(order: ResolvedOrder, sgoName: string, locale: CopyLocale): RenderedCopy | null {
  if (order.contributors.length === 0 || order.contributors.some((c) => c.designatedCents <= 0 || !c.fullName)) return null;
  if (order.contributors.length === 2) {
    const [first, second] = order.contributors;
    return renderCopyWithProof(
      "designation.statement_joint",
      {
        spouse1Name: first.fullName as string,
        spouse1Amount: formatUsd(first.designatedCents),
        spouse2Name: second.fullName as string,
        spouse2Amount: formatUsd(second.designatedCents),
        sgoName,
      },
      { locale },
    );
  }
  return renderCopyWithProof("designation.statement", { designatedAmount: formatUsd(order.contributors[0].designatedCents), sgoName }, { locale });
}

/** The e-delivery consent words for one contributor, or null without an email address. */
export function renderDeliveryConsent(contributor: Pick<ResolvedContributor, "email">, sgoName: string, locale: CopyLocale): RenderedCopy | null {
  if (!contributor.email) return null;
  return renderCopyWithProof("attest.e_delivery_consent", { sgoName, email: contributor.email }, { locale });
}

/** The words of one attestation with their proof hashes. */
export function renderAttestation(copyId: CopyId, locale: CopyLocale): RenderedCopy {
  return renderCopyWithProof(copyId, {}, { locale });
}

/* ------------------------------------------------------------------ the gates input */

/** The SGO part of taxmath's eligibility input, from the list module's view of the SGO. */
export function eligibilitySgoInput(list: CheckoutListContext, portalRegistered: boolean) {
  const listed = list.status === "irs_listed" || list.status === "provisional";
  // An entry that exists but whose listing starts later is "listed from" that date: taxmath reports it as not yet listed.
  const notYet = list.status === "unlisted" && list.entryId !== null && list.listedFrom !== null;
  const listStatus = listed || notYet ? ("listed" as const) : list.status === "removed" ? ("removed" as const) : ("not_listed" as const);
  const stateParticipation: StateParticipationStatus | null = listed ? STATE_PARTICIPATION_INFERENCE[list.source] : null;
  return {
    listSource: list.source,
    listStatus,
    removedOn: list.removedOn,
    listedFrom: list.listedFrom,
    portalRegistered,
    // The IRS shows only organizations that authorized publication, so an IRS-listed SGO has; unknown otherwise.
    publicListingAuthorized: list.status === "irs_listed" ? true : null,
    stateParticipation,
  };
}

/* ------------------------------------------------------------------ the view */

const EMAIL_REQUIRED = "Enter your email address.";

function requireText(errors: Record<string, string>, field: string, value: string | null | undefined, message: string): void {
  if (!value) errors[field] ??= message;
}

/** Splits a total into parts proportional to `weights` (largest remainder, ties to the earlier part). Sums exactly. */
export function allocateCents(totalCents: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0) return [];
  if (weightSum === 0) return weights.map((_, index) => (index === 0 ? totalCents : 0));
  const exact = weights.map((w) => (BigInt(totalCents) * BigInt(w)) / BigInt(weightSum));
  const remainders = weights.map((w, index) => ({ index, rem: (BigInt(totalCents) * BigInt(w)) % BigInt(weightSum) }));
  const parts = exact.map(Number);
  let left = totalCents - parts.reduce((sum, p) => sum + p, 0);
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

export function buildCheckoutView(form: CheckoutForm, ctx: CheckoutContext): CheckoutView {
  const locale: CopyLocale = form.locale ?? "en";
  const sgoName = ctx.sgo.displayName;
  const order = resolveOrder(form);
  const errors: Record<string, string> = { ...order.errors };
  const copy: ViewCopy[] = [];
  const say = (id: CopyId, placement: CopyPlacement, vars: Record<string, string> = {}, sgoListSource?: SgoListSource) =>
    copy.push({ id, placement, text: renderCopyDynamic(id, vars, { locale, sgoListSource }) });
  const donorTimeZone = form.donorTimeZone ?? DEFAULT_DONOR_TIME_ZONE;
  const live = ctx.session.mode === "live";
  const editable = ctx.session.status === "open" || ctx.session.status === "awaiting_payment";

  /* list labels */
  const provisionalList = ctx.list.source === "provisional_curated" ? renderCopyDynamic("notice.sgo_list_provisional", { platformName: BRAND.name }, { locale }) : null;
  let irsList: string | null = null;
  if (ctx.list.source === "irs_published" && ctx.list.status === "irs_listed" && ctx.list.retrievedAt) {
    irsList = renderCopyDynamic(
      "notice.sgo_list_irs",
      { listState: stateName(ctx.sgo.state), platformName: BRAND.name, listCheckedDate: formatIsoDateLong(ctx.list.retrievedAt.slice(0, 10), locale) },
      { locale, sgoListSource: "irs_published" },
    );
  }
  if (provisionalList) copy.push({ id: "notice.sgo_list_provisional", placement: "list", text: provisionalList });
  if (irsList) {
    copy.push({ id: "notice.sgo_list_irs", placement: "list", text: irsList });
    say("notice.list_reliance", "list", {}, "irs_published");
  }
  if (ctx.list.refusal) errors.sgo = ctx.list.refusal.message;
  if (live && !ctx.settings.liveEnabled) errors.mode = "Live gifts are not being accepted right now.";

  /* amounts */
  const giftCents = order.giftCents;
  if (giftCents === null) errors.giftCents ??= "Enter the amount of your gift.";
  else if (giftCents < MIN_GIFT_CENTS) errors.giftCents ??= `The smallest gift is ${formatUsd(MIN_GIFT_CENTS, { cents: true })}.`;
  if (!order.filingStatus) errors.filingStatus = "Choose your federal filing status.";

  order.contributors.forEach((c) => {
    if (giftCents !== null && giftCents > 0) {
      if (c.giftCents <= 0) errors[`contributors.${c.key}.giftCents`] ??= "Enter this spouse's amount, or say that only one spouse is giving.";
      else if (c.designatedCents <= 0) errors[`contributors.${c.key}.designatedCents`] ??= "Designate at least part of this gift as a section 25F qualified contribution.";
    }
    if (c.nonDesignatedCents > 0 && NON_DESIGNATED_COLLECTION === "refuse") {
      errors[`contributors.${c.key}.designatedCents`] ??=
        `${formatUsd(c.nonDesignatedCents)} of this gift is not designated. This checkout can only collect designated contributions: designate the whole amount, or lower the gift to the designated amount.`;
    }
    requireText(errors, `contributors.${c.key}.firstName`, c.firstName, "Enter the first name as it appears on the federal tax return.");
    requireText(errors, `contributors.${c.key}.lastName`, c.lastName, "Enter the last name as it appears on the federal tax return.");
    if (c.fullName) {
      const word = nonIndividualNameWord(c.fullName);
      if (word) errors[`contributors.${c.key}.lastName`] ??= `"${word}" looks like an organization's name. This checkout is for gifts made personally by individuals.`;
    }
  });

  /* identity and address */
  requireText(errors, "email", form.email, EMAIL_REQUIRED);
  requireText(errors, "address.line1", form.address?.line1, "Enter the street address on your federal tax return.");
  requireText(errors, "address.city", form.address?.city, "Enter the city.");
  requireText(errors, "address.state", form.address?.state, "Choose the State.");
  requireText(errors, "address.zip", form.address?.zip, "Enter the ZIP code.");

  /* attestations */
  const attestations: ViewAttestation[] = applicableAttestations(order).map((a) => {
    const confirmed = form.attestations?.[a.key] === true;
    if (!confirmed) errors[`attestations.${a.key}`] = "Confirm this statement to continue.";
    return { key: a.key, copyId: a.copyId, text: renderCopyDynamic(a.copyId, {}, { locale }), confirmed };
  });

  /* designation */
  const statement = renderDesignationStatement(order, sgoName, locale);
  const confirmed = statement !== null && form.designationConfirmedTextSha256 === statement.textSha256;
  if (!confirmed) errors.designationConfirmed = statement ? "Confirm the designation statement." : "The designation statement appears once the amount and names are entered.";
  say("designation.required", "designation");
  if (statement) copy.push({ id: statement.id, placement: "designation", text: statement.text });
  if (order.nonDesignatedCents > 0) say("designation.non_designated_remainder", "designation", { nonDesignatedAmount: formatUsd(order.nonDesignatedCents), sgoName });
  if (order.contributors.some((c) => c.designatedDefaulted && c.giftCents > 0)) say("designation.default_explained", "designation");
  const irrevocable = renderCopyDynamic("designation.irrevocable", {}, { locale });
  copy.push({ id: "designation.irrevocable", placement: "designation", text: irrevocable });
  say("designation.deposit_regardless", "designation");

  /* joint */
  if (order.joint) {
    say("joint.split_instruction", "joint");
    say("joint.both_names", "joint");
    say("joint.separate_acknowledgments", "joint");
    if (order.contributors.length === 2 && order.contributors.every((c) => c.giftDefaulted)) say("joint.even_split_default", "joint");
  }

  /* consents (optional: without one the acknowledgment is mailed) */
  const consents: ViewConsent[] = order.contributors.map((c) => {
    const rendered = renderDeliveryConsent(c, sgoName, locale);
    return { key: c.key, role: c.role, email: c.email, copy: rendered, given: rendered !== null && c.eDeliveryConsentTextSha256 === rendered.textSha256 };
  });

  /* fees */
  const fees =
    giftCents !== null && giftCents > 0
      ? computeGiftLines({
          structure: ctx.settings.fees.active,
          designatedCents: order.designatedCents,
          nonDesignatedCents: order.nonDesignatedCents,
          sgoFeeBps: ctx.settings.fees.sgoFeeBps,
          donorServiceFeeBps: ctx.settings.fees.donorServiceFeeBps,
          platformName: BRAND.name,
          locale,
        })
      : null;
  if (fees) copy.push({ id: fees.explanation.copyId, placement: "fee", text: fees.explanation.text });
  const totals: CheckoutTotals = {
    giftCents: giftCents ?? 0,
    designatedCents: order.designatedCents,
    nonDesignatedCents: order.nonDesignatedCents,
    donorServiceFeeCents: fees?.donorServiceFeeCents ?? 0,
    chargedCents: fees?.chargedToDonorCents ?? giftCents ?? 0,
    sgoInvoicedFeeCents: fees?.sgoInvoicedFeeCents ?? 0,
    depositedTo25fAccountCents: fees?.depositedTo25fAccountCents ?? order.designatedCents,
  };
  if (totals.chargedCents > MAX_GIFT_CENTS) errors.giftCents ??= "The total is more than one payment can carry. Lower the gift.";

  /* the tax-math preview */
  const taxYear = determineTaxYear(ctx.now, donorTimeZone).taxYear;
  let preview: CreditPreview | null = null;
  if (giftCents !== null && giftCents > 0) {
    preview = previewCredit({
      filingStatus: order.filingStatus ?? "single",
      taxpayers: order.contributors.map((c) => ({
        role: c.role,
        label: c.firstName,
        designatedCents: c.designatedCents,
        nonDesignatedCents: c.nonDesignatedCents,
        otherQualifiedContributionsCents: c.otherQualifiedContributionsCents,
        expectedStateCreditCents: c.expectedStateCreditCents,
      })),
      asOf: ctx.now,
      creditStartDate: ctx.settings.creditStartDate,
      liability: form.liability ? { estimatedTaxCents: form.liability.estimatedTaxCents, otherCreditsCents: form.liability.otherCreditsCents ?? 0 } : null,
      taxYear: form.liability ? taxYear : null,
      donorServiceFeeCents: totals.donorServiceFeeCents,
    });
  }
  const panel = preview ? renderCreditPanel(preview, { locale }) : null;
  if (panel) for (const note of panel.notes) copy.push({ id: note.id, placement: "panel", text: note.text });

  /* gates, as of now, for a payment made now */
  const eligibility = assessCreditEligibility({
    paidAt: ctx.now,
    initiatedAt: ctx.now,
    creditStartDate: ctx.settings.creditStartDate,
    sgo: eligibilitySgoInput(ctx.list, ctx.sgo.portalRegistered),
    attestations: {
      individual: form.attestations?.individual === true,
      usCitizenOrResident: form.attestations?.usCitizenOrResident === true,
      noEarmark: form.attestations?.noEarmark === true,
      notInExchangeForScholarship: form.attestations?.notInExchangeForScholarship === true,
    },
    paymentMethod: PREVIEW_PAYMENT_METHOD,
    currency: "usd",
    liveMode: live,
    donorTimeZone,
  });
  copy.push({ id: eligibility.headline.copyId, placement: "eligibility", text: eligibility.headline.message });

  /* standing notices */
  for (const id of ["notice.no_earmark", "notice.individuals_only", "notice.cash_only", "notice.donor_state", "notice.irs_reporting", "notice.no_ssn", "field.donor_name.help"] as const) {
    say(id, "notice");
  }

  const beforeCreditStart = eligibility.beforeCreditStart ? renderCopyDynamic("note.before_credit_start", { creditStartDate: formatIsoDateLong(ctx.settings.creditStartDate, locale) }, { locale }) : null;
  const proposedRules = renderCopyDynamic("note.proposed_rules_not_final", {}, { locale });
  if (!copy.some((c) => c.id === "note.proposed_rules_not_final") && copy.some((c) => getCopy(c.id).authority === "proposed_reg")) {
    copy.push({ id: "note.proposed_rules_not_final", placement: "notice", text: proposedRules });
  }
  if (beforeCreditStart && !copy.some((c) => c.id === "note.before_credit_start")) copy.push({ id: "note.before_credit_start", placement: "notice", text: beforeCreditStart });
  const previewNotTaxAdvice = renderCopyDynamic("note.preview_not_tax_advice", {}, { locale });
  if (!copy.some((c) => c.id === "note.preview_not_tax_advice")) copy.push({ id: "note.preview_not_tax_advice", placement: "panel", text: previewNotTaxAdvice });

  if (!editable) errors.session = ctx.session.status === "completed" ? "This checkout has been paid." : `This checkout is ${ctx.session.status}.`;

  return {
    session: ctx.session,
    mode: ctx.session.mode,
    sgo: ctx.sgo,
    list: ctx.list,
    order,
    preview,
    panel,
    eligibility,
    fees,
    feeStructure: ctx.settings.fees.active,
    totals,
    designation: { statement, confirmed, irrevocable },
    consents,
    attestations,
    labels: {
      provisionalList,
      irsList,
      beforeCreditStart,
      proposedRules: copy.some((c) => c.id === "note.proposed_rules_not_final") ? proposedRules : null,
      previewNotTaxAdvice,
    },
    copy,
    errors,
    canPlaceOrder: Object.keys(errors).length === 0,
    capabilities: { nonDesignatedCollectible: NON_DESIGNATED_COLLECTION !== "refuse", editable },
    donorTimeZone,
    locale,
    copyRegistrySha256: copySha256(),
  };
}

/** Contributor keys in the order the view lists them. */
export { CONTRIBUTOR_KEYS };
