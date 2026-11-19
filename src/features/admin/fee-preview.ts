import { computeGiftLines, describeFeeStructure, FEE_STRUCTURES, type FeeStructure, type GiftLines } from "@/taxmath";

/**
 * What each fee structure does to the money lines of one gift, for the "Gates & fees" screen. The arithmetic and
 * every sentence come from src/taxmath; this only runs it for an illustrative gift at the rates on file.
 */

/** POLICY (display only): the gift used to illustrate the structures. Not a statistic and not a typical gift. */
export const ILLUSTRATIVE_GIFT_CENTS = 100_000;

export interface FeeStructurePreview {
  structure: FeeStructure;
  title: string;
  /** What the donor is told at checkout. */
  donorExplanation: string;
  /** What SGO and platform staff are told. */
  sgoExplanation: string;
  counselMemoRequirement: string | null;
  isActive: boolean;
  /** The structure would take a platform fee but its rate is 0, so the illustration shows no fee. */
  rateMissing: boolean;
  appliedRateBps: number;
  lines: GiftLines;
}

export interface FeePreviewInput {
  active: FeeStructure;
  sgoFeeBps: number;
  donorServiceFeeBps: number;
  giftCents?: number;
}

export function buildFeePreviews(input: FeePreviewInput): FeeStructurePreview[] {
  const giftCents = input.giftCents ?? ILLUSTRATIVE_GIFT_CENTS;
  return FEE_STRUCTURES.map((structure) => {
    const description = describeFeeStructure(structure);
    const lines = computeGiftLines({
      structure,
      designatedCents: giftCents,
      nonDesignatedCents: 0,
      sgoFeeBps: input.sgoFeeBps,
      donorServiceFeeBps: input.donorServiceFeeBps,
    });
    const rate = structure === "sgo_invoiced" ? input.sgoFeeBps : structure === "donor_service_fee" ? input.donorServiceFeeBps : 0;
    return {
      structure,
      title: description.title,
      donorExplanation: description.donorExplanation,
      sgoExplanation: description.sgoExplanation,
      counselMemoRequirement: description.counselMemoRequirement,
      isActive: structure === input.active,
      rateMissing: structure !== "none" && rate === 0,
      appliedRateBps: rate,
      lines,
    };
  });
}
