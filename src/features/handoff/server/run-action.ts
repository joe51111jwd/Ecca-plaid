import { refresh } from "next/cache";
import { actionError } from "@/lib/errors";
import { getRequestInfo, requireUserOrThrow } from "@/server/auth";
import type { PortalActionState, PortalOperation } from "../types";

/**
 * The body of every business-portal server action: require a signed-in person, run the operation with them as the
 * actor (services check their membership and role), refresh the page's data on success. Errors come back as an
 * ActionResult, never thrown across the client boundary.
 */
export async function runPortalAction(operation: PortalOperation, formData: FormData): Promise<PortalActionState> {
  let result: PortalActionState;
  try {
    const user = await requireUserOrThrow();
    const info = await getRequestInfo();
    result = await operation({ userId: user.id, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } }, formData);
  } catch (e) {
    return actionError(e);
  }
  if (result.ok) refresh();
  return result;
}
