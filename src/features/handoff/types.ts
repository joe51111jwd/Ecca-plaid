import type { ActionResult } from "@/lib/errors";

/** What a successful portal action reports back to the form that ran it. */
export interface PortalNotice {
  /** One sentence saying what happened. */
  message: string;
  /** A value shown once (a new API key or webhook signing secret). Never logged, never stored client-side. */
  secret?: { label: string; value: string; hint: string };
  /** Where to go next. */
  link?: { href: string; label: string };
}

/** State every portal form action returns. `null` before the first submission. */
export type PortalActionState = ActionResult<PortalNotice> | null;

/** The signed-in person a portal operation runs for. Built only by runPortalAction from the session. */
export interface PortalActor {
  userId: string;
  request: { ip: string | null; userAgent: string | null };
}

export type PortalOperation = (actor: PortalActor, formData: FormData) => Promise<ActionResult<PortalNotice>>;

/** Family-page actions (token holder, no account). */
export type FamilyActionState = ActionResult<{ message: string }> | null;
