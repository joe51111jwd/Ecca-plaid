import { MS } from "@/lib/clock";
import type { CheckoutView, CopyPlacement, ViewCopy } from "@/server/donations";
import type { ClientPayment } from "@/server/payments";
import { FILING_STATUSES, renderCopy, renderCopyDynamic, type CopyId, type EligibilityBlockerCode, type FilingStatus } from "@/taxmath";

/**
 * Turns the donations service's `CheckoutView` into exactly what the checkout screens render. Pure and
 * server-side: every sentence comes from the view (which got it from the taxmath copy registry) or is rendered
 * here from the registry by id, so no component ever words a tax statement itself. The result is plain,
 * serializable data that can cross to client components.
 */

export interface CopyText {
  id: CopyId;
  text: string;
}

/** The credit-eligibility banner. `state` drives the styling; the words are the registry's. */
export interface CreditBanner {
  state: "eligible" | "sandbox_only" | "not_eligible" | "pending_confirmations";
  tone: "success" | "sandbox" | "warning" | "info";
  title: string;
  /** Further reasons not already stated by the title. */
  details: string[];
  /** Cautions that apply even on the eligible path (removal after the gift, a year-boundary gift). */
  warnings: string[];
  /** The structural reasons, for tests and analytics; form confirmations are excluded. */
  reasonCodes: EligibilityBlockerCode[];
}

export interface ClientContributor {
  key: "primary" | "spouse";
  role: "individual" | "spouse_1" | "spouse_2";
  heading: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  fullName: string | null;
  /** The address the acknowledgment would go to (the second spouse falls back to the checkout email). */
  email: string | null;
  giftCents: number;
  designatedCents: number;
  nonDesignatedCents: number;
  giftDefaulted: boolean;
  designatedDefaulted: boolean;
  expectedStateCreditCents: number;
  otherQualifiedContributionsCents: number;
}

export interface ClientPanel {
  title: string;
  /** "illustration_before_credit_start" while a gift made now would not earn the credit. */
  status: "empty" | "preview" | "illustration_before_credit_start";
  sections: Array<{ key: string; heading: string; lines: Array<{ id: string; label: string; amountCents: number; role: string }> }>;
  /** Every caveat, in display order, deduplicated: the preview's own notes plus the standing notes the panel must always carry. */
  notes: CopyText[];
}

export interface ReviewLine {
  kind: "designated_contribution" | "non_designated_gift" | "donor_service_fee";
  label: string;
  amountCents: number;
  /** Why the line is separate (the fee-structure explanation on a service-fee line). */
  hint: string | null;
}

export interface ClientReview {
  lines: ReviewLine[];
  totalCents: number;
  feeStructure: CheckoutView["feeStructure"];
  /** The fee-structure explanation, shown under the lines whatever the structure. */
  feeExplanation: CopyText | null;
}

export interface CheckoutLabels {
  filingStatus: string;
  filingStatusOptions: Array<{ value: FilingStatus; label: string }>;
  designated: string;
  stateCredit: string;
  stateCreditHelp: string;
  otherContributions: string;
  otherContributionsHelp: string;
  liability: string;
  liabilityHelp: string;
  otherCredits: string;
  donorNameHelp: string;
  spouse1: string;
  spouse2: string;
}

export interface CheckoutClientView {
  sessionId: string;
  status: CheckoutView["session"]["status"];
  mode: CheckoutView["mode"];
  editable: boolean;
  canPlaceOrder: boolean;
  placedAt: string | null;
  sgo: { name: string; slug: string; ein: string | null; legalName: string | null };
  list: { status: string; source: string; label: string; notices: CopyText[]; refusal: string | null };
  banner: CreditBanner;
  order: {
    filingStatus: FilingStatus | null;
    joint: boolean;
    bothSpouses: boolean;
    giftCents: number | null;
    designatedCents: number;
    nonDesignatedCents: number;
    contributors: ClientContributor[];
    /** The donor's own tax estimate, echoed from the preview (absent until there is a gift to preview). */
    liability: { estimatedTaxCents: number; otherCreditsCents: number } | null;
  };
  panel: ClientPanel;
  copy: {
    noEarmark: CopyText | null;
    donorNameHelp: CopyText | null;
    /** Standing notices (individuals only, cash only, IRS reporting, no SSN, donor's State, ...). */
    notices: CopyText[];
    designationIntro: CopyText[];
    /** Under the designated-amount field: the default and the ordinary-gift remainder. */
    designationAmount: CopyText[];
    /** After the statement: irrevocability and deposit. */
    designationClosing: CopyText[];
    joint: CopyText[];
  };
  designation: { statement: { text: string; textSha256: string } | null; confirmed: boolean; irrevocable: string };
  attestations: Array<{ key: string; text: string; confirmed: boolean }>;
  consents: Array<{ key: "primary" | "spouse"; email: string | null; text: string | null; given: boolean }>;
  review: ClientReview;
  labels: CheckoutLabels;
  errors: Record<string, string>;
}

/* ------------------------------------------------------------------ the banner */

/** Blockers that the donor clears by ticking a confirmation on this form; they are field-level, not structural. */
export const FORM_BLOCKER_CODES: ReadonlySet<EligibilityBlockerCode> = new Set<EligibilityBlockerCode>([
  "attestation_individual_missing",
  "attestation_us_citizen_or_resident_missing",
  "attestation_no_earmark_missing",
  "attestation_not_in_exchange_missing",
]);

/** The blockers that one headline copy id already states, so they are not listed twice. */
const HEADLINE_COVERS: Partial<Record<CopyId, readonly EligibilityBlockerCode[]>> = {
  "eligibility.before_credit_start_sandbox": ["sandbox_mode", "before_credit_start"],
};

export function creditBanner(eligibility: CheckoutView["eligibility"]): CreditBanner {
  const warnings = eligibility.warnings.map((w) => w.message);
  const structural = eligibility.blockers.filter((b) => !FORM_BLOCKER_CODES.has(b.code));
  const reasonCodes = structural.map((b) => b.code);
  if (eligibility.creditEligible) {
    return { state: "eligible", tone: "success", title: eligibility.headline.message, details: [], warnings, reasonCodes };
  }
  if (structural.length === 0) {
    const pending = eligibility.blockers.map((b) => b.message);
    return { state: "pending_confirmations", tone: "info", title: pending[0] ?? eligibility.headline.message, details: pending.slice(1), warnings, reasonCodes };
  }
  if (structural.length === 1 && structural[0].code === "sandbox_mode") {
    return { state: "sandbox_only", tone: "sandbox", title: structural[0].message, details: [], warnings, reasonCodes };
  }
  const headlineIsStructural = structural.some((b) => b.copyId === eligibility.headline.copyId) || HEADLINE_COVERS[eligibility.headline.copyId] !== undefined;
  const title = headlineIsStructural ? eligibility.headline.message : structural[0].message;
  const covered = new Set<EligibilityBlockerCode>(HEADLINE_COVERS[eligibility.headline.copyId] ?? []);
  const details = structural.filter((b) => !covered.has(b.code) && b.message !== title).map((b) => b.message);
  return { state: "not_eligible", tone: "warning", title, details, warnings, reasonCodes };
}

/* ------------------------------------------------------------------ the panel */

/**
 * The caveats the tax-math panel must always carry (build spec, "the tax-math panel"; architecture "Copy rules"):
 * the cap per taxpayer, the proposed joint-return treatment with its each-spouse condition, the State-credit
 * reduction, nonrefundability and the liability caveat, the carryforward, no double deduction, the preview label and
 * the proposed-rules label. The preview adds the ones that depend on the figures.
 */
export const STANDING_PANEL_NOTES: readonly CopyId[] = [
  "note.cap_per_taxpayer",
  "note.joint_each_spouse",
  "note.state_credit_reduction",
  "note.nonrefundable",
  "note.liability_not_estimated",
  "note.carryforward",
  "note.section_170_no_double_benefit",
  "note.preview_not_tax_advice",
  "note.proposed_rules_not_final",
];

/** Notice-placement copy that belongs in the panel (they describe the figures). */
const PANEL_NOTICE_IDS: ReadonlySet<CopyId> = new Set<CopyId>(["note.before_credit_start", "note.proposed_rules_not_final"]);

function byPlacement(copy: readonly ViewCopy[], placement: CopyPlacement): CopyText[] {
  return copy.filter((c) => c.placement === placement).map((c) => ({ id: c.id, text: c.text }));
}

function dedupe(items: readonly CopyText[]): CopyText[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

function buildPanel(view: CheckoutView): ClientPanel {
  const fromView = [...byPlacement(view.copy, "panel"), ...view.copy.filter((c) => c.placement === "notice" && PANEL_NOTICE_IDS.has(c.id)).map((c) => ({ id: c.id, text: c.text }))];
  const standing = STANDING_PANEL_NOTES.map((id) => ({ id, text: renderCopyDynamic(id, {}, { locale: view.locale }) }));
  const notes = dedupe([...fromView, ...standing]);
  if (!view.panel) {
    return { title: renderCopyDynamic("panel.title", {}, { locale: view.locale }), status: "empty", sections: [], notes };
  }
  return {
    title: view.panel.title,
    status: view.panel.status,
    sections: view.panel.sections.map((s) => ({ key: s.key, heading: s.heading, lines: s.lines.map((l) => ({ id: l.id, label: l.label, amountCents: l.amountCents, role: l.role })) })),
    notes,
  };
}

/* ------------------------------------------------------------------ review lines */

export function buildReview(view: CheckoutView): ClientReview {
  const lines: ReviewLine[] = [];
  const contributors = view.order.contributors;
  for (const line of view.fees?.lines ?? []) {
    if (line.kind === "designated_contribution" && contributors.length > 1) {
      // One designated line per spouse, as on the payment and the receipt.
      for (const c of contributors) {
        if (c.designatedCents <= 0) continue;
        const who = c.fullName ?? renderCopyDynamic(c.role === "spouse_2" ? "panel.heading.spouse_2" : "panel.heading.spouse_1", {}, { locale: view.locale });
        lines.push({ kind: line.kind, label: `${line.label} (${who})`, amountCents: c.designatedCents, hint: null });
      }
      continue;
    }
    lines.push({ kind: line.kind, label: line.label, amountCents: line.amountCents, hint: line.kind === "donor_service_fee" ? (view.fees?.explanation.text ?? null) : null });
  }
  return {
    lines,
    totalCents: view.totals.chargedCents,
    feeStructure: view.feeStructure,
    feeExplanation: view.fees ? { id: view.fees.explanation.copyId, text: view.fees.explanation.text } : null,
  };
}

/* ------------------------------------------------------------------ labels */

export function checkoutLabels(locale: CheckoutView["locale"]): CheckoutLabels {
  const t = (id: CopyId) => renderCopyDynamic(id, {}, { locale });
  return {
    filingStatus: t("field.filing_status.label"),
    filingStatusOptions: FILING_STATUSES.map((value) => ({ value, label: t(`filing_status.${value}` as CopyId) })),
    designated: t("field.designated.label"),
    stateCredit: t("field.state_credit.label"),
    stateCreditHelp: t("field.state_credit.help"),
    otherContributions: t("field.other_contributions.label"),
    otherContributionsHelp: t("field.other_contributions.help"),
    liability: t("field.liability.label"),
    liabilityHelp: t("field.liability.help"),
    otherCredits: t("field.other_credits.label"),
    donorNameHelp: t("field.donor_name.help"),
    spouse1: t("panel.heading.spouse_1"),
    spouse2: t("panel.heading.spouse_2"),
  };
}

/* ------------------------------------------------------------------ the whole view */

const DESIGNATION_AMOUNT_IDS: ReadonlySet<CopyId> = new Set<CopyId>(["designation.non_designated_remainder", "designation.default_explained"]);
const DESIGNATION_INTRO_IDS: ReadonlySet<CopyId> = new Set<CopyId>(["designation.required"]);
const LIFTED_NOTICE_IDS: ReadonlySet<CopyId> = new Set<CopyId>(["notice.no_earmark", "field.donor_name.help", ...PANEL_NOTICE_IDS]);

export function toClientView(view: CheckoutView): CheckoutClientView {
  const labels = checkoutLabels(view.locale);
  const statementId = view.designation.statement?.id ?? null;
  const designationCopy = byPlacement(view.copy, "designation");
  const notices = byPlacement(view.copy, "notice");
  const find = (id: CopyId) => notices.find((c) => c.id === id) ?? null;
  return {
    sessionId: view.session.id,
    status: view.session.status,
    mode: view.mode,
    editable: view.capabilities.editable,
    canPlaceOrder: view.canPlaceOrder,
    placedAt: view.session.placedAt ? view.session.placedAt.toISOString() : null,
    sgo: { name: view.sgo.displayName, slug: view.sgo.slug, ein: view.sgo.ein, legalName: view.sgo.legalName },
    list: { status: view.list.status, source: view.list.source, label: view.list.label, notices: byPlacement(view.copy, "list"), refusal: view.list.refusal?.message ?? null },
    banner: creditBanner(view.eligibility),
    order: {
      filingStatus: view.order.filingStatus,
      joint: view.order.joint,
      bothSpouses: view.order.joint && view.order.contributors.length === 2,
      giftCents: view.order.giftCents,
      designatedCents: view.order.designatedCents,
      nonDesignatedCents: view.order.nonDesignatedCents,
      contributors: view.order.contributors.map((c) => ({
        key: c.key,
        role: c.role,
        heading: c.role === "spouse_2" ? labels.spouse2 : c.role === "spouse_1" ? labels.spouse1 : (c.firstName ?? renderCopyDynamic("panel.heading.individual", {}, { locale: view.locale })),
        firstName: c.firstName,
        middleName: c.middleName,
        lastName: c.lastName,
        suffix: c.suffix,
        fullName: c.fullName,
        email: c.email,
        giftCents: c.giftCents,
        designatedCents: c.designatedCents,
        nonDesignatedCents: c.nonDesignatedCents,
        giftDefaulted: c.giftDefaulted,
        designatedDefaulted: c.designatedDefaulted,
        expectedStateCreditCents: c.expectedStateCreditCents,
        otherQualifiedContributionsCents: c.otherQualifiedContributionsCents,
      })),
      liability: view.preview?.liability ? { estimatedTaxCents: view.preview.liability.estimatedTaxCents, otherCreditsCents: view.preview.liability.otherCreditsCents } : null,
    },
    panel: buildPanel(view),
    copy: {
      noEarmark: find("notice.no_earmark"),
      donorNameHelp: find("field.donor_name.help"),
      notices: notices.filter((c) => !LIFTED_NOTICE_IDS.has(c.id)),
      designationIntro: designationCopy.filter((c) => DESIGNATION_INTRO_IDS.has(c.id)),
      designationAmount: designationCopy.filter((c) => DESIGNATION_AMOUNT_IDS.has(c.id)),
      designationClosing: designationCopy.filter((c) => !DESIGNATION_INTRO_IDS.has(c.id) && !DESIGNATION_AMOUNT_IDS.has(c.id) && c.id !== statementId),
      joint: byPlacement(view.copy, "joint"),
    },
    designation: {
      statement: view.designation.statement ? { text: view.designation.statement.text, textSha256: view.designation.statement.textSha256 } : null,
      confirmed: view.designation.confirmed,
      irrevocable: view.designation.irrevocable,
    },
    attestations: view.attestations.map((a) => ({ key: a.key, text: a.text, confirmed: a.confirmed })),
    consents: view.consents.map((c) => ({ key: c.key, email: c.email, text: c.copy?.text ?? null, given: c.given })),
    review: buildReview(view),
    labels,
    errors: { ...view.errors },
  };
}

/* ------------------------------------------------------------------ the receipt (confirmation page) */

/**
 * How long after the order was placed the confirmation page restates the credit-eligibility outcome. The
 * checkout view assesses eligibility as of "now", which equals the charge only moments after paying; on a later
 * visit (for example after the credit start date) it would describe a different moment, so the page then points
 * to the emailed receipt instead. A product policy: the sources say nothing about confirmation pages.
 */
export const RECEIPT_ELIGIBILITY_FRESH_MS = 30 * MS.minute;

export interface ReceiptSummary {
  sandbox: boolean;
  sgo: { name: string; ein: string | null };
  paymentId: string | null;
  paymentStatus: ClientPayment["status"] | null;
  lines: ReviewLine[];
  totalCents: number;
  designationText: string | null;
  /** Receipt words in order: sandbox watermark, not-the-acknowledgment, goods-or-services. */
  receiptNotes: CopyText[];
  /** The credit outcome at the charge, or null when it can no longer be restated reliably. */
  outcome: { creditEligible: boolean; headline: CopyText; reasons: string[] } | null;
  /** What to keep for Form 8525. */
  keep: CopyText[];
  contributors: Array<{ name: string | null; email: string | null; eDelivery: boolean }>;
}

function isBefore(instantIso: string, at: Date): boolean {
  return at.getTime() < new Date(instantIso).getTime();
}

export function toReceiptSummary(view: CheckoutView, payment: ClientPayment | null, now: Date): ReceiptSummary {
  const locale = view.locale;
  const sgoName = view.sgo.displayName;
  const review = buildReview(view);
  const receiptNotes: CopyText[] = [];
  if (view.mode === "test") receiptNotes.push({ id: "receipt.sandbox", text: renderCopy("receipt.sandbox", {}, { locale }) });
  receiptNotes.push({ id: "receipt.not_official_acknowledgment", text: renderCopy("receipt.not_official_acknowledgment", { sgoName }, { locale }) });
  receiptNotes.push({ id: "receipt.goods_or_services_none", text: renderCopy("receipt.goods_or_services_none", { sgoName }, { locale }) });

  const placedAt = view.session.placedAt;
  const fresh =
    placedAt !== null &&
    now.getTime() - placedAt.getTime() >= 0 &&
    now.getTime() - placedAt.getTime() <= RECEIPT_ELIGIBILITY_FRESH_MS &&
    isBefore(view.eligibility.creditStartInstant, placedAt) === isBefore(view.eligibility.creditStartInstant, now);
  let outcome: ReceiptSummary["outcome"] = null;
  if (fresh) {
    // An order cannot be placed without the confirmations, so every remaining blocker is a real reason.
    const reasons = view.eligibility.blockers.map((b) => b.message);
    outcome = view.eligibility.creditEligible
      ? { creditEligible: true, headline: { id: "receipt.credit_eligible_path", text: renderCopy("receipt.credit_eligible_path", {}, { locale }) }, reasons: [] }
      : { creditEligible: false, headline: { id: "receipt.not_credit_eligible", text: renderCopy("receipt.not_credit_eligible", {}, { locale }) }, reasons };
  }

  const keepIds: CopyId[] = ["note.what_to_keep", "note.claim_form", "note.claim_form_availability", "note.recordkeeping"];
  return {
    sandbox: view.mode === "test",
    sgo: { name: sgoName, ein: view.sgo.ein },
    paymentId: payment?.paymentId ?? view.session.paymentId,
    paymentStatus: payment?.status ?? null,
    lines: review.lines,
    totalCents: review.totalCents,
    designationText: view.designation.statement?.text ?? null,
    receiptNotes,
    outcome,
    keep: keepIds.map((id) => ({ id, text: renderCopyDynamic(id, {}, { locale }) })),
    contributors: view.order.contributors.map((c) => ({ name: c.fullName, email: c.email, eDelivery: view.consents.find((k) => k.key === c.key)?.given ?? false })),
  };
}
