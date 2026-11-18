import type { ActionResult } from "@/lib/errors";

/** The shape server actions return (ActionResult from @/lib/errors), loosened so `null` initial state fits. */
export type FormState = ActionResult<unknown> | null | undefined;

/** The validation message for one field of a failed action, or undefined. Feed it to `<Field error=…>`. */
export function fieldError(state: FormState, name: string): string | undefined {
  if (!state || state.ok) return undefined;
  return state.error.fields?.[name];
}

/** The form-level message of a failed action, or undefined. */
export function formMessage(state: FormState): string | undefined {
  if (!state || state.ok) return undefined;
  return state.error.message;
}

/** True when the action failed (useful for aria-invalid on a whole group). */
export function hasFormError(state: FormState): boolean {
  return Boolean(state && !state.ok);
}
