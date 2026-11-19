import { refresh } from "next/cache";
import { actionError } from "@/lib/errors";
import type { SgoActionState, SgoOperation } from "../types";
import { requireSgoActor } from "./context";
import { assertSameOrg } from "./operations";

/**
 * The body of every dashboard server action: resolve the acting staff member from the session (any member; the
 * operation itself re-checks the role it needs), refuse a form posted for another organization, run the operation,
 * refresh the page's data on success. Errors come back as an ActionResult, never thrown across the client boundary.
 */
export async function runSgoAction(op: SgoOperation, formData: FormData): Promise<SgoActionState> {
  let result: SgoActionState;
  try {
    const ctx = await requireSgoActor();
    assertSameOrg(ctx.actor, formData);
    result = await op(ctx.actor, formData);
  } catch (e) {
    return actionError(e);
  }
  if (result?.ok) refresh();
  return result;
}
