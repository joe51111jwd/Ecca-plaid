import type { ActionResult } from "@/lib/errors";

/** What a successful admin action reports back to the form that ran it. */
export interface AdminNotice {
  /** One sentence saying what happened. */
  message: string;
  /** Optional facts about the result (counts, ids), shown as a short list under the message. */
  details?: Array<{ label: string; value: string }>;
  /** Where to go next (e.g. the record just created). */
  link?: { href: string; label: string };
}

/** The state every admin form action returns. `null` before the first submission. */
export type AdminActionState = ActionResult<AdminNotice> | null;

/** The signed-in platform admin an operation runs for. */
export interface AdminActor {
  userId: string;
  request: { ip: string | null; userAgent: string | null } | null;
}

/** Signature of every admin form operation (see ./server/operations). */
export type AdminOperation = (actor: AdminActor, formData: FormData) => Promise<ActionResult<AdminNotice>>;
