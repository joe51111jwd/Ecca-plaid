/**
 * The three ways the platform could be paid on a donor gift, as line-item arithmetic.
 *
 * The build spec leaves the choice to counsel ("Open question: does a platform cut reduce the qualified
 * contribution?"), so all three exist here and none is the product's opinion about the law:
 *
 *   none               no platform fee on the gift (the default until a counsel memo is recorded)
 *   sgo_invoiced       the SGO is invoiced separately and pays from operating funds outside its 25F account
 *   donor_service_fee  the donor pays a clearly separate, non-designated service fee on top of the gift
 *
 * What never varies, and what `fees.test.ts` proves for every structure over generated amounts: the
 * designated amount is not reduced by any fee, every designated cent is deposited to the section 25F
 * account, and a donor-paid fee is its own line that is never labeled part of the contribution.
 *
 * Processor costs are outside this module; the payments service must not net them from the designated
 * amount either.
 */
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { invalid } from "@/lib/errors";
import { mulDivRound } from "@/lib/money";
import { DEFAULT_FEE_STRUCTURE, FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO, TAXMATH_VERSION } from "./constants";
import { COPY_LOCALES, COPY_VERSION, renderCopyDynamic, type CopyId, type CopyLocale } from "./copy";
import { bpsSchema, centsSchema, parseInput, sumCents } from "./validation";

export const FEE_STRUCTURES = ["none", "sgo_invoiced", "donor_service_fee"] as const;
export type FeeStructure = (typeof FEE_STRUCTURES)[number];

export const BASIS_POINTS_PER_WHOLE = 10_000;

export type GiftLineKind = "designated_contribution" | "non_designated_gift" | "donor_service_fee";

export interface GiftLine {
  kind: GiftLineKind;
  /** Donor-facing caption from the copy registry. */
  label: string;
  copyId: CopyId;
  amountCents: number;
}

export interface GiftLinesInput {
  structure: FeeStructure;
  /** The amount the donor designates as a section 25F qualified contribution, in cents. */
  designatedCents: number;
  /** Any further gift to the same SGO that is not designated, in cents. */
  nonDesignatedCents: number;
  /** Platform fee rate invoiced to the SGO, in basis points of the gift. Used only by "sgo_invoiced". */
  sgoFeeBps: number;
  /** Service fee rate paid by the donor on top, in basis points of the gift. Used only by "donor_service_fee". */
  donorServiceFeeBps: number;
  /** Platform name for the explanation sentence. Defaults to the product name. */
  platformName?: string;
  locale?: CopyLocale;
}

export interface GiftLines {
  structure: FeeStructure;
  /** What the donor sees and pays, line by line. `chargedToDonorCents` is their sum. */
  lines: GiftLine[];
  chargedToDonorCents: number;
  /** Always exactly the designated amount. */
  depositedTo25fAccountCents: number;
  /** The non-designated gift, which goes to the SGO's other funds and never into the 25F account. */
  sgoGeneralFundsCents: number;
  /** Fee the SGO owes on a separate invoice, payable from operating funds ("sgo_invoiced"). */
  sgoInvoicedFeeCents: number;
  /** Fee the donor pays on top ("donor_service_fee"). */
  donorServiceFeeCents: number;
  platformRevenueCents: number;
  /** The gift the percentage is applied to: designated plus non-designated. */
  feeBaseCents: number;
  /** The rate actually applied (0 for "none"). */
  appliedFeeBps: number;
  /** The donor-facing sentence that explains this structure. */
  explanation: { copyId: CopyId; text: string };
  taxmathVersion: string;
  copyVersion: string;
}

const giftLinesSchema = z.strictObject({
  structure: z.enum(FEE_STRUCTURES, "Must be none, sgo_invoiced or donor_service_fee"),
  designatedCents: centsSchema,
  nonDesignatedCents: centsSchema,
  sgoFeeBps: bpsSchema,
  donorServiceFeeBps: bpsSchema,
  platformName: z.string("Must be text").trim().min(1, "Must not be empty").optional(),
  locale: z.enum(COPY_LOCALES, "Must be a supported locale").optional(),
}) satisfies z.ZodType<GiftLinesInput>;

const EXPLANATION_COPY: Readonly<Record<FeeStructure, CopyId>> = {
  none: "fee.none.donor",
  sgo_invoiced: "fee.sgo_invoiced.donor",
  donor_service_fee: "fee.donor_service_fee.donor",
};

const LINE_COPY: Readonly<Record<GiftLineKind, CopyId>> = {
  designated_contribution: "fee.line.designated_contribution",
  non_designated_gift: "fee.line.non_designated_gift",
  donor_service_fee: "fee.line.donor_service_fee",
};

/** A percentage fee on the whole gift, rounded half up to the cent (FEE_BASE and FEE_ROUNDING in ./constants). */
function percentageFeeCents(baseCents: number, bps: number): number {
  return mulDivRound(baseCents, bps, BASIS_POINTS_PER_WHOLE);
}

/** The lines of one gift under a fee structure, and where every cent goes. */
export function computeGiftLines(input: GiftLinesInput): GiftLines {
  const parsed = parseInput(giftLinesSchema, input, "gift lines input");
  const { structure, designatedCents, nonDesignatedCents } = parsed;
  const locale = parsed.locale ?? "en";
  const feeBaseCents = sumCents("designatedCents", designatedCents, nonDesignatedCents);
  if (feeBaseCents === 0) {
    throw invalid("A gift must be more than zero", { fields: { designatedCents: "Enter an amount greater than zero" } });
  }

  const sgoInvoicedFeeCents = structure === "sgo_invoiced" ? percentageFeeCents(feeBaseCents, parsed.sgoFeeBps) : 0;
  const donorServiceFeeCents = structure === "donor_service_fee" ? percentageFeeCents(feeBaseCents, parsed.donorServiceFeeBps) : 0;

  const line = (kind: GiftLineKind, amountCents: number): GiftLine => ({
    kind,
    label: renderCopyDynamic(LINE_COPY[kind], {}, { locale }),
    copyId: LINE_COPY[kind],
    amountCents,
  });
  const lines: GiftLine[] = [];
  if (designatedCents > 0) lines.push(line("designated_contribution", designatedCents));
  if (nonDesignatedCents > 0) lines.push(line("non_designated_gift", nonDesignatedCents));
  if (donorServiceFeeCents > 0) lines.push(line("donor_service_fee", donorServiceFeeCents));

  const explanationCopyId = EXPLANATION_COPY[structure];
  return {
    structure,
    lines,
    chargedToDonorCents: sumCents("designatedCents", feeBaseCents, donorServiceFeeCents),
    depositedTo25fAccountCents: designatedCents,
    sgoGeneralFundsCents: nonDesignatedCents,
    sgoInvoicedFeeCents,
    donorServiceFeeCents,
    platformRevenueCents: sgoInvoicedFeeCents + donorServiceFeeCents,
    feeBaseCents,
    appliedFeeBps: structure === "sgo_invoiced" ? parsed.sgoFeeBps : structure === "donor_service_fee" ? parsed.donorServiceFeeBps : 0,
    explanation: {
      copyId: explanationCopyId,
      text: renderCopyDynamic(explanationCopyId, { platformName: parsed.platformName ?? BRAND.name }, { locale }),
    },
    taxmathVersion: TAXMATH_VERSION,
    copyVersion: COPY_VERSION,
  };
}

/* ------------------------------------------------------------------ describing and gating a structure */

export interface FeeStructureFacts {
  /** Who pays the platform fee. */
  feePaidBy: "no_one" | "sgo" | "donor";
  /** Where the fee money comes from. Never the designated amount and never the section 25F account. */
  feePaidFrom: "not_applicable" | "sgo_operating_funds_outside_25f_account" | "separate_donor_charge_on_top_of_gift";
  /** The donor is charged more than the gift itself. */
  donorPaysMoreThanGift: boolean;
  /** Always false: no structure takes anything out of the designated amount. */
  designatedAmountReduced: false;
  /** The structure may be activated only with a recorded counsel memo reference. */
  requiresCounselMemo: boolean;
}

function requiresMemo(structure: FeeStructure): boolean {
  return (FEE_STRUCTURES_REQUIRING_COUNSEL_MEMO.value as readonly FeeStructure[]).includes(structure);
}

/** The constraints of each structure, as data. Enforcement of the memo rule lives in platform settings. */
export const FEE_STRUCTURE_FACTS: Readonly<Record<FeeStructure, FeeStructureFacts>> = Object.freeze({
  none: Object.freeze({
    feePaidBy: "no_one",
    feePaidFrom: "not_applicable",
    donorPaysMoreThanGift: false,
    designatedAmountReduced: false,
    requiresCounselMemo: requiresMemo("none"),
  }),
  sgo_invoiced: Object.freeze({
    feePaidBy: "sgo",
    feePaidFrom: "sgo_operating_funds_outside_25f_account",
    donorPaysMoreThanGift: false,
    designatedAmountReduced: false,
    requiresCounselMemo: requiresMemo("sgo_invoiced"),
  }),
  donor_service_fee: Object.freeze({
    feePaidBy: "donor",
    feePaidFrom: "separate_donor_charge_on_top_of_gift",
    donorPaysMoreThanGift: true,
    designatedAmountReduced: false,
    requiresCounselMemo: requiresMemo("donor_service_fee"),
  }),
});

export interface FeeStructureDescription extends FeeStructureFacts {
  structure: FeeStructure;
  isDefault: boolean;
  title: string;
  /** What a donor is told at checkout. */
  donorExplanation: string;
  /** What SGO and platform staff are told in settings. */
  sgoExplanation: string;
  /** The memo requirement in words; null for a structure that needs no memo. */
  counselMemoRequirement: string | null;
  copyIds: { title: CopyId; donor: CopyId; sgo: CopyId; counselMemo: CopyId | null };
  copyVersion: string;
}

const DESCRIPTION_COPY: Readonly<Record<FeeStructure, { title: CopyId; donor: CopyId; sgo: CopyId }>> = {
  none: { title: "fee.none.title", donor: "fee.none.donor", sgo: "fee.none.sgo" },
  sgo_invoiced: { title: "fee.sgo_invoiced.title", donor: "fee.sgo_invoiced.donor", sgo: "fee.sgo_invoiced.sgo" },
  donor_service_fee: { title: "fee.donor_service_fee.title", donor: "fee.donor_service_fee.donor", sgo: "fee.donor_service_fee.sgo" },
};

const structureSchema = z.enum(FEE_STRUCTURES, "Must be none, sgo_invoiced or donor_service_fee");

export function isFeeStructure(value: unknown): value is FeeStructure {
  return typeof value === "string" && (FEE_STRUCTURES as readonly string[]).includes(value);
}

/** Copy and constraints for one fee structure. */
export function describeFeeStructure(structure: FeeStructure, options: { platformName?: string; locale?: CopyLocale } = {}): FeeStructureDescription {
  const parsed = parseInput(structureSchema, structure, "fee structure");
  const locale = options.locale ?? "en";
  const platformName = options.platformName ?? BRAND.name;
  const ids = DESCRIPTION_COPY[parsed];
  const facts = FEE_STRUCTURE_FACTS[parsed];
  const withPlatform = (id: CopyId) => renderCopyDynamic(id, { platformName }, { locale });
  return {
    structure: parsed,
    isDefault: parsed === DEFAULT_FEE_STRUCTURE.value,
    ...facts,
    title: renderCopyDynamic(ids.title, {}, { locale }),
    donorExplanation: withPlatform(ids.donor),
    sgoExplanation: parsed === "none" ? renderCopyDynamic(ids.sgo, {}, { locale }) : withPlatform(ids.sgo),
    counselMemoRequirement: facts.requiresCounselMemo ? renderCopyDynamic("fee.counsel_memo_required", {}, { locale }) : null,
    copyIds: { ...ids, counselMemo: facts.requiresCounselMemo ? "fee.counsel_memo_required" : null },
    copyVersion: COPY_VERSION,
  };
}

/**
 * Throws `validation_failed` unless the structure may be used: "none" always may; anything else needs the
 * reference of counsel's written memo. Call it before computing or charging a fee on a live gift.
 */
export function assertFeeStructureAllowed(input: { structure: FeeStructure; counselMemoRef: string | null | undefined }): void {
  const structure = parseInput(structureSchema, input?.structure, "fee structure");
  if (!FEE_STRUCTURE_FACTS[structure].requiresCounselMemo) return;
  const reference = input.counselMemoRef;
  if (typeof reference !== "string" || reference.trim() === "") {
    const message = renderCopyDynamic("fee.counsel_memo_required");
    throw invalid(message, { fields: { counselMemoRef: message }, structure });
  }
}
