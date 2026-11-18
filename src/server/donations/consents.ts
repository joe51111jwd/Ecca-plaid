import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { forbidden } from "@/lib/errors";
import type { AuditRequestInfo } from "@/server/audit";
import { withdrawDeliveryConsent, type DeliveryConsentRow } from "./donors";

/**
 * Withdraws the signed-in donor's consent to receive an SGO's acknowledgment electronically. After this the
 * acknowledgment must be furnished on paper (Temp. Treas. Reg. 1.25F-4T(c)(1): electronic only if the donor "does
 * not withdraw the consent before the statement is furnished"). Not found when the consent is not the caller's.
 */
export async function withdrawEDeliveryConsent(input: { consentId: string; userId: string; request?: AuditRequestInfo | null }): Promise<DeliveryConsentRow> {
  const db = await getDb();
  const [user] = typeof input?.userId === "string" ? await db.select().from(schema.users).where(eq(schema.users.id, input.userId)) : [];
  if (!user) throw forbidden();
  return db.transaction((tx) => withdrawDeliveryConsent({ consentId: String(input.consentId ?? ""), userId: user.id, userEmail: user.email, request: input.request }, tx));
}
