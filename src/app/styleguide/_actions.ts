"use server";

import { z } from "zod";
import { actionError, invalid, type ActionResult } from "@/lib/errors";

/**
 * Demo actions for the style guide. They touch no data: they only validate and wait, so the guide can show
 * real pending and error states. Real actions follow the same shape (validate with zod → call a service →
 * return ActionResult), after calling an auth guard first.
 */

const applySchema = z.object({
  email: z.email("Enter an email address, like name@example.com."),
  amountCents: z.coerce.number().int().min(100, "Enter an amount of at least $1."),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the full date of birth, with a four-digit year."),
  agree: z.literal("on", "Tick the box to continue."),
});

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function demoApplyAction(_previous: ActionResult<{ email: string }> | null, formData: FormData): Promise<ActionResult<{ email: string }>> {
  await pause(600);
  const parsed = applySchema.safeParse({
    email: formData.get("email"),
    amountCents: formData.get("amountCents"),
    dob: formData.get("dob"),
    agree: formData.get("agree"),
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]);
      if (!fields[name]) fields[name] = issue.message;
    }
    return actionError(invalid("Check the highlighted answers and try again.", { fields }));
  }
  return { ok: true, data: { email: parsed.data.email } };
}

export async function demoConfirmAction(): Promise<void> {
  await pause(700);
}
