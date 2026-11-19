"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, invalid, type ActionResult } from "@/lib/errors";
import { getRequestInfo, requireUserOrThrow } from "@/server/auth";
import { withdrawEDeliveryConsent } from "@/server/donations";

const withdrawSchema = z.strictObject({ consentId: z.string().trim().min(1).max(100) });

/**
 * Withdraws the signed-in donor's consent to receive an organization's acknowledgment by email; the acknowledgment
 * is then mailed. The service refuses a consent that is not the caller's (not found).
 */
export async function withdrawEDeliveryAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUserOrThrow();
    const parsed = withdrawSchema.safeParse({ consentId: formData.get("consentId") });
    if (!parsed.success) throw invalid("Choose a delivery preference to change.");
    await withdrawEDeliveryConsent({ consentId: parsed.data.consentId, userId: user.id, request: await getRequestInfo() });
    revalidatePath("/donor");
    return { ok: true, data: undefined };
  } catch (e) {
    return actionError(e);
  }
}
