import { refresh } from "next/cache";
import { actionError } from "@/lib/errors";
import type { AdminActionState, AdminOperation } from "../types";
import { requireAdminActor } from "./guard";

/**
 * The body of every admin server action: guard, run the operation, refresh the page's data on success. Errors come
 * back as an ActionResult (never thrown across the client boundary).
 */
export async function runAdminAction(operation: AdminOperation, formData: FormData): Promise<AdminActionState> {
  let result: AdminActionState;
  try {
    const actor = await requireAdminActor();
    result = await operation(actor, formData);
  } catch (e) {
    return actionError(e);
  }
  if (result.ok) refresh();
  return result;
}
