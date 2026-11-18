import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { AcknowledgmentSnapshot, Mode } from "@/db/schema";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { invalid, notFound } from "@/lib/errors";
import { getSgoProfile } from "@/server/sgos";
import { COPY_VERSION, determineTaxYear } from "@/taxmath";
import { requireOrgId } from "./access";
import { LETTER_COPY_VERSION } from "./letter-copy";
import { SANDBOX_DONOR_NUMBER_PREFIX } from "./policy";

/**
 * Assembles what one official acknowledgment would say: one donor, one SGO, one calendar year, one mode
 * (Temp. Treas. Reg. 1.25F-4T(c)(1); acknowledgment-reporting.md E1). Element (B) is the total of that donor's
 * succeeded designated contributions in the calendar year (a refunded gift is out: totals reflect only money
 * actually received). Reads only; never writes. When something required is missing the result is "blocked" with
 * a precise reason per missing item.
 */

const { donations, donors, donorNumbers } = schema;

export type AcknowledgmentBlockerCode =
  | "sgo_ein_missing"
  | "donor_number_pending_sgo_registration"
  | "donor_number_missing"
  | "sandbox_donor_number_in_live"
  | "goods_or_services_description_missing"
  | "donor_name_or_address_incomplete"
  | "all_contributions_refunded";

export interface AcknowledgmentBlocker {
  code: AcknowledgmentBlockerCode;
  message: string;
}

export interface AcknowledgmentGift {
  donationId: string;
  contributedAt: Date;
  /** The gift's date in the donor's time zone (the date that decided its tax year). */
  localDate: string;
  designatedCents: number;
  nonDesignatedCents: number;
}

export interface AcknowledgmentBuild {
  orgId: string;
  donorId: string;
  taxYear: number;
  mode: Mode;
  /** ready: can be issued; blocked: see blockers; not_required: no designated contribution was ever received. */
  status: "ready" | "blocked" | "not_required";
  blockers: AcknowledgmentBlocker[];
  sgo: { name: string; legalName: string | null; ein: string | null; city: string | null; state: string | null; portalRegistered: boolean };
  donor: { id: string; firstName: string; lastName: string; fullName: string; email: string; addressLines: string[]; address: { line1: string; line2: string | null; city: string; state: string; zip: string } };
  donorNumber: { number: string; source: "irs_portal_entered" | "irs_portal_import" | "sandbox_generated" } | null;
  totalDesignatedCents: number;
  totalNonDesignatedCents: number;
  goodsOrServices: { provided: boolean; description: string | null; valueCents: number };
  gifts: AcknowledgmentGift[];
  /** Succeeded donations included in the total. */
  donationIds: string[];
  /** Gifts of the year that were received and later refunded (not in the total). */
  refundedCount: number;
  /** SHA-256 of everything the document prints except the issue date and version; null unless ready. */
  contentSha256: string | null;
  snapshot: AcknowledgmentSnapshot | null;
}

export const BLOCKER_MESSAGES: Record<AcknowledgmentBlockerCode, string> = {
  sgo_ein_missing: "The organization's EIN is not on file. Add it to the organization profile: it is a required item of the acknowledgment.",
  donor_number_pending_sgo_registration: "The organization has not registered in the IRS SGO portal, so it cannot create this donor's unique donor number yet.",
  donor_number_missing: "No unique donor number is recorded for this donor for the year. Create it in the IRS SGO portal and enter it here.",
  sandbox_donor_number_in_live: "The recorded donor number is a sandbox number, which is never valid on a live acknowledgment.",
  goods_or_services_description_missing: "Goods or services were recorded for a gift without a description; the acknowledgment must describe them and estimate their value.",
  donor_name_or_address_incomplete: "The donor's name or mailing address is incomplete.",
  all_contributions_refunded: "Every contribution acknowledged for this year has since been refunded. Review the correction with counsel before anything is sent.",
};

const block = (code: AcknowledgmentBlockerCode): AcknowledgmentBlocker => ({ code, message: BLOCKER_MESSAGES[code] });

export function donorFullName(d: { firstName: string; middleName: string | null; lastName: string; suffix: string | null }): string {
  return [d.firstName, d.middleName, d.lastName, d.suffix].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
}

export function donorAddressLines(d: { addressLine1: string; addressLine2: string | null; city: string; state: string; zip: string }): string[] {
  return [d.addressLine1, d.addressLine2 ?? "", `${d.city}, ${d.state} ${d.zip}`].map((l) => l.trim()).filter((l) => l.length > 0 && l !== ",");
}

const scopeSchema = z.strictObject({ donorId: z.string().min(1).max(100), taxYear: z.number().int().min(2000).max(2200), mode: z.enum(["test", "live"]) });

export interface BuildOptions {
  mode: Mode;
  /** An issued version already exists for this donor/SGO/year/mode. */
  previouslyIssued?: boolean;
}

export async function buildAcknowledgment(orgId: string, donorId: string, taxYear: number, options: BuildOptions, dbOrTx?: DbOrTx): Promise<AcknowledgmentBuild> {
  const org = requireOrgId(orgId);
  const parsed = scopeSchema.safeParse({ donorId, taxYear, mode: options?.mode });
  if (!parsed.success) throw invalid("Check the acknowledgment scope.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])) });
  const { mode } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  const { profile } = await getSgoProfile(org, db);
  const [donor] = await db.select().from(donors).where(eq(donors.id, donorId));
  if (!donor) throw notFound("Donor");
  const rows = await db
    .select()
    .from(donations)
    .where(and(eq(donations.orgId, org), eq(donations.donorId, donorId), eq(donations.taxYear, taxYear), eq(donations.mode, mode), inArray(donations.status, ["succeeded", "refunded"])))
    .orderBy(asc(donations.contributedAt), asc(donations.id));
  // Another SGO's donor, or no gift that year: nothing of theirs is revealed.
  if (rows.length === 0) throw notFound("Donor");
  const [numberRow] = await db.select().from(donorNumbers).where(and(eq(donorNumbers.orgId, org), eq(donorNumbers.donorId, donorId), eq(donorNumbers.taxYear, taxYear), eq(donorNumbers.mode, mode)));

  const received = rows.filter((r) => r.status === "succeeded");
  const gifts: AcknowledgmentGift[] = received.map((r) => {
    const contributedAt = r.contributedAt as Date;
    return { donationId: r.id, contributedAt, localDate: determineTaxYear(contributedAt, r.donorTimeZone).localDate, designatedCents: r.designatedAmountCents, nonDesignatedCents: r.nonDesignatedAmountCents };
  });
  const totalDesignatedCents = received.reduce((s, r) => s + r.designatedAmountCents, 0);
  const totalNonDesignatedCents = received.reduce((s, r) => s + r.nonDesignatedAmountCents, 0);
  const withGoods = received.filter((r) => r.goodsOrServicesProvided);
  const descriptions = [...new Set(withGoods.map((r) => (r.goodsOrServicesDescription ?? "").trim()).filter(Boolean))];
  const goodsOrServices = { provided: withGoods.length > 0, description: descriptions.length ? descriptions.join("; ") : null, valueCents: withGoods.reduce((s, r) => s + r.goodsOrServicesValueCents, 0) };

  const fullName = donorFullName(donor);
  const addressLines = donorAddressLines(donor);
  const base = {
    orgId: org,
    donorId,
    taxYear,
    mode,
    sgo: { name: profile.displayName, legalName: profile.legalName, ein: profile.ein, city: profile.city, state: profile.state, portalRegistered: profile.irsPortalRegistered },
    donor: {
      id: donor.id,
      firstName: donor.firstName,
      lastName: donor.lastName,
      fullName,
      email: donor.email,
      addressLines,
      address: { line1: donor.addressLine1, line2: donor.addressLine2, city: donor.city, state: donor.state, zip: donor.zip },
    },
    donorNumber: numberRow ? { number: numberRow.number, source: numberRow.source } : null,
    totalDesignatedCents,
    totalNonDesignatedCents,
    goodsOrServices,
    gifts,
    donationIds: received.map((r) => r.id),
    refundedCount: rows.length - received.length,
  };

  if (received.length === 0 || totalDesignatedCents === 0) {
    if (!options.previouslyIssued) return { ...base, status: "not_required", blockers: [], contentSha256: null, snapshot: null };
    return { ...base, status: "blocked", blockers: [block("all_contributions_refunded")], contentSha256: null, snapshot: null };
  }

  const blockers: AcknowledgmentBlocker[] = [];
  if (!profile.ein) blockers.push(block("sgo_ein_missing"));
  if (!numberRow) blockers.push(block(mode === "live" && !profile.irsPortalRegistered ? "donor_number_pending_sgo_registration" : "donor_number_missing"));
  else if (mode === "live" && (numberRow.source === "sandbox_generated" || numberRow.number.toUpperCase().startsWith(SANDBOX_DONOR_NUMBER_PREFIX))) blockers.push(block("sandbox_donor_number_in_live"));
  if (goodsOrServices.provided && !goodsOrServices.description) blockers.push(block("goods_or_services_description_missing"));
  if (!donor.firstName.trim() || !donor.lastName.trim() || !donor.addressLine1.trim() || !donor.city.trim() || !donor.state.trim() || !donor.zip.trim()) blockers.push(block("donor_name_or_address_incomplete"));
  if (blockers.length > 0 || !numberRow || !profile.ein) return { ...base, status: "blocked", blockers, contentSha256: null, snapshot: null };

  const snapshot: AcknowledgmentSnapshot = {
    sgo: { name: profile.displayName, legalName: profile.legalName, ein: profile.ein, city: profile.city, state: profile.state },
    donor: { fullName, addressLines },
    donorNumber: { number: numberRow.number, source: numberRow.source },
    gifts: gifts.map((g) => ({ donationId: g.donationId, localDate: g.localDate, designatedCents: g.designatedCents, nonDesignatedCents: g.nonDesignatedCents })),
    copyVersion: COPY_VERSION,
    letterCopyVersion: LETTER_COPY_VERSION,
  };
  const contentSha256 = sha256Hex(canonicalJson({ mode, taxYear, snapshot, totalDesignatedCents, totalNonDesignatedCents, goodsOrServices }));
  return { ...base, status: "ready", blockers: [], contentSha256, snapshot };
}
