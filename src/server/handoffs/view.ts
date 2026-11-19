import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { HandoffStatus, Mode, VendorType } from "@/db/schema";
import { now } from "@/lib/clock";
import { decryptField } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { notFound } from "@/lib/errors";
import { getActivePartnerSgos, isAllowedReturnUrl, normalizeOrigin, vendorTypeLabel } from "@/server/businesses";
import { FAMILY_LINK_PATH } from "@/server/verifications";
import { familyNotices, formatDeadline, HANDOFF_COPY_VERSION, statusText, type StatusText } from "./copy";
import { findByToken } from "./create";
import { syncHandoffWithVerification } from "./lifecycle";
import { FAMILY_LINK_PURPOSE } from "./policy";
import { centsToUsdString } from "./serialize";
import { holdIsActive, publicVerificationStatus, type PublicVerificationStatus } from "./state";

/** Where the family is in the handoff, for the page to choose its layout. */
export type HandoffStep = "choose_sgo" | "verify" | "waiting" | "eligible" | "awarded" | "completed" | "declined" | "expired" | "canceled";

/**
 * Everything the family-facing handoff page (`/h/<token>`, also framed at `/embed/handoff/<token>`) shows. Plain,
 * serializable data. It carries the family's own link into the verification flow, so only a request that presented
 * the handoff token may receive it. No income, documents, fees or reasons.
 */
export interface HandoffView {
  copyVersion: string;
  id: string;
  mode: Mode;
  status: HandoffStatus;
  step: HandoffStep;
  business: { displayName: string; vendorType: VendorType; vendorTypeLabel: string; website: string | null; brandColor: string | null; logoUrl: string | null };
  booking: { ref: string; description: string | null; amountUsd: string | null };
  student: { firstName: string | null };
  hold: { expiresAt: string | null; active: boolean; deadline: { en: string; es: string } | null };
  sgo: { orgId: string; name: string } | null;
  /** The business's partner SGOs to choose from (only at the choose_sgo step). */
  partnerChoices: Array<{ sgoOrgId: string; displayName: string; website: string | null; logoUrl: string | null }>;
  verification: { status: PublicVerificationStatus; provisional: boolean } | null;
  award: { amountUsd: string } | null;
  /** The family's link into the verification flow, while there is something to do or see there. */
  verificationUrl: string | null;
  /** Back to the business's booking page (re-checked against the business's allowed origins on every read). */
  returnUrl: string | null;
  /** Origins allowed to frame the embed page (for its Content-Security-Policy frame-ancestors). */
  frameAncestors: string[];
  text: { en: StatusText; es: StatusText };
  notices: { en: string[]; es: string[] };
}

function stepOf(status: HandoffStatus, hasSgo: boolean): HandoffStep {
  switch (status) {
    case "started":
      return hasSgo ? "verify" : "choose_sgo";
    case "verifying":
      return "verify";
    case "held":
      return "waiting";
    default:
      return status;
  }
}

/**
 * The family's view of a handoff, by token. Brings the handoff up to date with its verification first (so a family
 * that just submitted sees "submitted"). `not_found` for a malformed or unknown token.
 */
export async function getHandoffView(token: string): Promise<HandoffView> {
  const db = await getDb();
  const found = await findByToken(db, token);
  if (!found) throw notFound("Handoff");
  const handoff = (await syncHandoffWithVerification(found.id)) ?? found;

  const [business] = await db
    .select({
      displayName: schema.businessProfiles.displayName,
      vendorType: schema.businessProfiles.vendorType,
      website: schema.businessProfiles.website,
      brandColor: schema.businessProfiles.brandColor,
      logoUrl: schema.businessProfiles.logoUrl,
      allowedOrigins: schema.businessProfiles.allowedOrigins,
    })
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.orgId, handoff.businessOrgId))
    .limit(1);
  if (!business) throw notFound("Handoff");

  const [sgo] = handoff.sgoOrgId ? await db.select({ name: schema.sgoProfiles.displayName }).from(schema.sgoProfiles).where(eq(schema.sgoProfiles.orgId, handoff.sgoOrgId)).limit(1) : [];
  const [verification] = handoff.verificationId
    ? await db.select({ status: schema.verifications.status, provisional: schema.verifications.provisional }).from(schema.verifications).where(eq(schema.verifications.id, handoff.verificationId)).limit(1)
    : [];
  const [award] = handoff.awardId ? await db.select({ amountCents: schema.awards.amountCents, status: schema.awards.status }).from(schema.awards).where(eq(schema.awards.id, handoff.awardId)).limit(1) : [];
  const shownAward = award && (award.status === "offered" || award.status === "accepted" || award.status === "paid") && (handoff.status === "awarded" || handoff.status === "completed") ? award : null;

  const step = stepOf(handoff.status, handoff.sgoOrgId !== null);
  const partnerChoices = step === "choose_sgo" ? (await getActivePartnerSgos(handoff.businessOrgId, db)).map((p) => ({ sgoOrgId: p.sgoOrgId, displayName: p.displayName, website: p.website, logoUrl: p.logoUrl })) : [];

  const holdActive = holdIsActive(handoff, now());
  const deadline = holdActive && handoff.holdExpiresAt ? { en: formatDeadline("en", handoff.holdExpiresAt), es: formatDeadline("es", handoff.holdExpiresAt) } : null;

  // The verification flow stays reachable after the handoff ends so the family can see its result; not once canceled.
  const verificationUrl = handoff.familyLinkEnc && handoff.status !== "canceled" ? appUrl(`${FAMILY_LINK_PATH}/${decryptField(handoff.familyLinkEnc, FAMILY_LINK_PURPOSE)}`) : null;
  const returnUrl = handoff.returnUrl && isAllowedReturnUrl(business, handoff.returnUrl) ? handoff.returnUrl : null;
  const frameAncestors = (business.allowedOrigins ?? []).flatMap((o) => {
    const r = normalizeOrigin(o);
    return r.ok ? [r.origin] : [];
  });

  const copyKey = step === "choose_sgo" ? "choose_sgo" : handoff.status;
  const base = { businessName: business.displayName, sgoName: sgo?.name ?? null, awardAmountCents: shownAward?.amountCents ?? null };
  const provisional = verification?.status === "eligible" && verification.provisional === true;
  const sandbox = handoff.mode === "test";

  return {
    copyVersion: HANDOFF_COPY_VERSION,
    id: handoff.id,
    mode: handoff.mode,
    status: handoff.status,
    step,
    business: { displayName: business.displayName, vendorType: business.vendorType, vendorTypeLabel: vendorTypeLabel(business.vendorType), website: business.website, brandColor: business.brandColor, logoUrl: business.logoUrl },
    booking: { ref: handoff.bookingRef, description: handoff.bookingDescription, amountUsd: handoff.bookingAmountCents === null ? null : centsToUsdString(handoff.bookingAmountCents) },
    student: { firstName: handoff.studentFirstName },
    hold: { expiresAt: holdActive && handoff.holdExpiresAt ? handoff.holdExpiresAt.toISOString() : null, active: holdActive, deadline },
    sgo: handoff.sgoOrgId && sgo ? { orgId: handoff.sgoOrgId, name: sgo.name } : null,
    partnerChoices,
    verification: verification ? { status: publicVerificationStatus(verification.status), provisional: verification.provisional } : null,
    award: shownAward ? { amountUsd: centsToUsdString(shownAward.amountCents) } : null,
    verificationUrl,
    returnUrl,
    frameAncestors,
    text: { en: statusText("en", copyKey, { ...base, holdDeadline: deadline?.en ?? null }), es: statusText("es", copyKey, { ...base, holdDeadline: deadline?.es ?? null }) },
    notices: { en: familyNotices("en", { businessName: business.displayName, provisional, sandbox }), es: familyNotices("es", { businessName: business.displayName, provisional, sandbox }) },
  };
}
