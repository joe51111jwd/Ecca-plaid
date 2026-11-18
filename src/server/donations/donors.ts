import { and, eq, isNull } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit, normalizeIp, type AuditRequestInfo } from "@/server/audit";
import type { RenderedCopy } from "@/taxmath";

/**
 * Donor identity and the per-donor e-delivery consent.
 *
 * One donor row per person: two checkouts by the same person must land on the same row, or the SGO's
 * acknowledgment total and IRS report row would be split (acknowledgment-reporting.md E2 item 5). A person is
 * matched on email address plus the normalized name and mailing address exactly as entered for the tax return;
 * a change of any of those makes a new row, because the acknowledgment must carry the name and address as reported.
 */

export type DonorRow = typeof schema.donors.$inferSelect;

export interface DonorIdentity {
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
}

const norm = (value: string | null | undefined) => (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

function identityKey(d: Omit<DonorIdentity, "email"> | DonorRow): string {
  return [d.firstName, d.middleName, d.lastName, d.suffix, d.addressLine1, d.addressLine2, d.city, d.state, d.zip].map(norm).join("|");
}

/** The signed-in person placing the order: their id and their verified sign-in email address. */
export interface SignedInDonor {
  userId: string;
  email: string;
}

/**
 * The donor row for this person, created when none matches. A new row is linked to the signed-in user who created
 * it. An EXISTING row is linked only when the user's verified sign-in email is the row's email: a linked row's
 * gifts, donor numbers and acknowledgments appear on that user's page, so typing someone else's email, name and
 * address must never attach their records to your account.
 */
export async function findOrCreateDonor(identity: DonorIdentity, signedIn: SignedInDonor | null, tx: DbOrTx): Promise<DonorRow> {
  const email = identity.email.trim().toLowerCase();
  const key = identityKey(identity);
  const candidates = await tx.select().from(schema.donors).where(eq(schema.donors.email, email));
  const match = candidates.find((row) => identityKey(row) === key);
  const at = now();
  const userId = signedIn?.userId ?? null;
  if (match) {
    if (signedIn && !match.userId && signedIn.email.trim().toLowerCase() === email) {
      const [updated] = await tx.update(schema.donors).set({ userId: signedIn.userId, updatedAt: at }).where(and(eq(schema.donors.id, match.id), isNull(schema.donors.userId))).returning();
      return updated ?? match;
    }
    return match;
  }
  const [row] = await tx
    .insert(schema.donors)
    .values({
      id: newId("donor"),
      userId,
      email,
      firstName: identity.firstName,
      middleName: identity.middleName,
      lastName: identity.lastName,
      suffix: identity.suffix,
      addressLine1: identity.addressLine1,
      addressLine2: identity.addressLine2,
      city: identity.city,
      state: identity.state,
      zip: identity.zip,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  return row;
}

/** Records that two donor rows are spouses on a joint gift (the substantial-contributor test combines them). */
export async function linkSpouses(a: string, b: string, tx: DbOrTx): Promise<void> {
  const at = now();
  await tx.update(schema.donors).set({ spouseDonorId: b, updatedAt: at }).where(eq(schema.donors.id, a));
  await tx.update(schema.donors).set({ spouseDonorId: a, updatedAt: at }).where(eq(schema.donors.id, b));
}

export type DeliveryConsentRow = typeof schema.donorDeliveryConsents.$inferSelect;

export interface RecordDeliveryConsentInput {
  donorId: string;
  orgId: string;
  mode: Mode;
  checkoutSessionId: string;
  email: string;
  rendered: RenderedCopy;
  request?: AuditRequestInfo | null;
}

/** Stores the donor's e-delivery consent with the exact words, their version and hashes, and the time. */
export async function recordDeliveryConsent(input: RecordDeliveryConsentInput, tx: DbOrTx): Promise<DeliveryConsentRow> {
  const userAgent = input.request?.userAgent?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 512) || null;
  const [row] = await tx
    .insert(schema.donorDeliveryConsents)
    .values({
      id: newId("consent"),
      donorId: input.donorId,
      orgId: input.orgId,
      mode: input.mode,
      checkoutSessionId: input.checkoutSessionId,
      email: input.email.toLowerCase(),
      copyId: input.rendered.id,
      copyVersion: input.rendered.copyVersion,
      templateSha256: input.rendered.templateSha256,
      textSha256: input.rendered.textSha256,
      text: input.rendered.text,
      grantedAt: now(),
      ip: normalizeIp(input.request?.ip),
      userAgent,
    })
    .returning();
  return row;
}

/**
 * Withdraws an e-delivery consent. Only the donor may do this: the signed-in user must be the donor row's user or
 * own its email address. From then on the acknowledgment must be furnished on paper.
 */
export async function withdrawDeliveryConsent(input: { consentId: string; userId: string; userEmail: string; request?: AuditRequestInfo | null }, tx: DbOrTx): Promise<DeliveryConsentRow> {
  if (typeof input.userId !== "string" || input.userId.length === 0) throw forbidden();
  const [consent] = await tx.select().from(schema.donorDeliveryConsents).where(eq(schema.donorDeliveryConsents.id, input.consentId)).for("update");
  if (!consent) throw notFound("Consent");
  const [donor] = await tx.select().from(schema.donors).where(eq(schema.donors.id, consent.donorId));
  const owns = donor && (donor.userId === input.userId || donor.email === input.userEmail.trim().toLowerCase());
  // A consent that is not the caller's is reported exactly like a missing one.
  if (!owns) throw notFound("Consent");
  if (consent.withdrawnAt) throw conflict("This consent has already been withdrawn.");
  const [updated] = await tx
    .update(schema.donorDeliveryConsents)
    .set({ withdrawnAt: now(), withdrawnByUserId: input.userId })
    .where(eq(schema.donorDeliveryConsents.id, consent.id))
    .returning();
  await audit(
    {
      actor: { type: "user", id: input.userId },
      orgId: consent.orgId,
      action: "donor_delivery_consent.withdraw",
      target: { type: "donor_delivery_consent", id: consent.id },
      metadata: { donorId: consent.donorId, mode: consent.mode },
      request: input.request,
    },
    tx,
  );
  return updated;
}
