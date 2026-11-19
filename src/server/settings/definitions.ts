import { z } from "zod";
import { FIRST_ELIGIBLE_DATE } from "@/taxmath/constants";

/**
 * Registry of platform settings.
 *
 * To add a setting, add one entry below: a zod schema, a default and a description. Nothing else changes —
 * the key, its value type, validation, the admin listing and the audit trail all derive from the entry.
 *
 * Rules for defaults: a default is what applies when no row exists AND when a stored row cannot be read
 * (see resolve() in ./index), so it must always be the most conservative state: no fee, live gifts off, the
 * statutory date, the provisional label.
 */

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  schema: S;
  default: z.output<S>;
  description: string;
  /**
   * The value is pinned to its default in production: the setter refuses anything else and the getter
   * ignores a stored override. For switches that exist only so tests and demos can move a legal gate.
   */
  productionLocked?: boolean;
}

function defineSetting<S extends z.ZodType>(def: SettingDefinition<S>): SettingDefinition<S> {
  return def;
}

const bps = (max: number) => z.number().int().min(0).max(max);

/** How the platform is paid on donor gifts. The three options are the structures the spec leaves to counsel. */
export const FEE_STRUCTURES = ["none", "sgo_invoiced", "donor_service_fee"] as const;
export type FeeStructure = (typeof FEE_STRUCTURES)[number];

export const COUNSEL_MEMO_REQUIRED_MESSAGE =
  "A fee structure can only be activated once counsel's written memo is on file: record its reference (counselMemoRef) first.";

const feesStructureSchema = z
  .strictObject({
    /**
     * none              — no platform fee on section 25F gifts.
     * sgo_invoiced      — the full designated amount goes to the SGO's 25F account; the SGO is invoiced
     *                     separately and pays from operating funds.
     * donor_service_fee — the donor pays a separate, non-designated service fee on top of the gift.
     */
    active: z.enum(FEE_STRUCTURES),
    sgoFeeBps: bps(1000),
    donorServiceFeeBps: bps(1000),
    /** Where the signed counsel memo approving the active structure is filed (document id, URL, matter number). */
    counselMemoRef: z.string().max(500).nullable(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((value, ctx) => {
    // The spec: "Do not ship a live cut of a 25F gift before the memo."
    if (value.active !== "none" && (value.counselMemoRef === null || value.counselMemoRef.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["counselMemoRef"], message: COUNSEL_MEMO_REQUIRED_MESSAGE });
    }
  });

/**
 * First day a gift can earn the section 25F credit (spec: "Gifts before that date do not earn the credit").
 * The date and its legal source are kept in one place, with the other tax rules.
 */
export const STATUTORY_CREDIT_START_DATE: string = FIRST_ELIGIBLE_DATE.value;

export const SETTING_DEFINITIONS = {
  "fees.structure": defineSetting({
    schema: feesStructureSchema,
    default: { active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null, approvedAt: null },
    description: "Platform fee on donor gifts. Stays \"none\" until counsel's memo on the fee structure is on file.",
  }),
  "credit.startDate": defineSetting({
    schema: z.iso.date(),
    default: STATUTORY_CREDIT_START_DATE,
    description: "First date (YYYY-MM-DD) on which a gift is credit-eligible. Movable only outside production, for tests and demos.",
    productionLocked: true,
  }),
  "gifts.liveEnabled": defineSetting({
    schema: z.boolean(),
    default: false,
    description: "Whether live (real-money) section 25F gifts are accepted. Off until a platform admin turns it on.",
  }),
  "sgoList.source": defineSetting({
    schema: z.enum(["provisional_curated", "irs_published"]),
    default: "provisional_curated",
    description: "Which SGO list donors search: the provisional curated list, or the IRS-published list once it exists.",
  }),
  "business.defaultSuccessFee": defineSetting({
    schema: z.strictObject({ flatCents: z.number().int().min(0), bps: bps(2000) }),
    default: { flatCents: 0, bps: 0 },
    description: "Default success fee billed to a business (never the family) for a completed handoff. The spec sets no amounts.",
  }),
  "retention.defaults": defineSetting({
    schema: z.strictObject({ rawUploadDays: z.number().int().min(1).max(365) }),
    default: { rawUploadDays: 30 },
    description: "Default number of days raw uploads are kept after a decision before their bytes are purged.",
  }),
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTING_DEFINITIONS)[K]["schema"]>;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}
