"use server";

import { refresh } from "next/cache";
import { cancelByFamilyOp, chooseSgoOp } from "@/features/handoff/server/family-operations";
import type { FamilyActionState } from "@/features/handoff/types";
import { actionError } from "@/lib/errors";
import { getRequestInfo } from "@/server/auth";

/**
 * Server actions of the family handoff page (/h/{token} and /embed/handoff/{token}). The handoff token in the form is
 * the only credential: the handoffs service checks it, the partnership and the handoff's state. No account needed.
 */

async function run(op: typeof chooseSgoOp, formData: FormData): Promise<FamilyActionState> {
  let result: FamilyActionState;
  try {
    result = await op(formData, await getRequestInfo());
  } catch (e) {
    return actionError(e);
  }
  if (result.ok) refresh();
  return result;
}

export async function chooseSgoAction(_previous: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  return run(chooseSgoOp, formData);
}

export async function cancelHandoffByFamilyAction(_previous: FamilyActionState, formData: FormData): Promise<FamilyActionState> {
  return run(cancelByFamilyOp, formData);
}
