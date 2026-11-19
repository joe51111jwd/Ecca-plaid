import { isAppError } from "@/lib/errors";
import { getHandoffView, isWellFormedHandoffToken, type HandoffView } from "@/server/handoffs";

/**
 * The family's view of a handoff for the hosted and embedded pages, or null for a malformed or unknown token (the
 * pages show a "link not valid" message rather than a 404, so a family that mistyped a link gets a way forward).
 */
export async function loadFamilyView(token: string): Promise<HandoffView | null> {
  if (!isWellFormedHandoffToken(token)) return null;
  try {
    return await getHandoffView(token);
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") return null;
    throw e;
  }
}
