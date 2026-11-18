import type { DbOrTx } from "@/db/client";
import { queueEmail, type SendEmailInput } from "@/server/email";
import { enqueue } from "@/server/jobs";

/**
 * Records a message in the caller's transaction and enqueues its delivery in the same transaction, so the email
 * exists exactly when the state change that caused it commits, and the provider is never called inside it.
 */
export async function queueAndSend(input: SendEmailInput, dbOrTx: DbOrTx): Promise<string> {
  const email = await queueEmail(input, dbOrTx);
  await enqueue("email.send", { emailId: email.id, ...(input.sensitive ? { redactAfterSend: true } : {}) }, { dedupeKey: `email:${email.id}` }, dbOrTx);
  return email.id;
}
