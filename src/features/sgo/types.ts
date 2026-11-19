import type { MemberRole, Mode } from "@/db/schema";
import type { ActionResult } from "@/lib/errors";

/**
 * The signed-in staff member a dashboard operation runs for, with the organization and mode the dashboard is
 * showing. Built only by the guard in ./server/context from the session and a checked membership; operations pass
 * `orgId` (never an id from the form) to every service, and the services check membership again.
 */
export interface SgoActor {
  userId: string;
  orgId: string;
  role: MemberRole;
  mode: Mode;
  request: { ip: string | null; userAgent: string | null } | null;
}

/** A value shown exactly once after an action (an API key, a webhook secret, a family link). */
export interface ShownOnce {
  label: string;
  value: string;
  hint?: string;
  /** Mask the value until the person reveals it. */
  secret?: boolean;
}

/** What a successful dashboard action reports back to the form that ran it. */
export interface SgoNotice {
  message: string;
  details?: Array<{ label: string; value: string }>;
  link?: { href: string; label: string };
  shownOnce?: ShownOnce;
  /** Plain-language warnings or reminders the person should read now (compliance reminders, import errors). */
  notes?: string[];
}

export type SgoActionState = ActionResult<SgoNotice> | null;

export type SgoOperation = (actor: SgoActor, formData: FormData) => Promise<ActionResult<SgoNotice>>;

/** A dashboard server action as SgoActionForm takes it. Pages import the actions and pass them down as props. */
export type SgoFormAction = (previous: SgoActionState, formData: FormData) => Promise<SgoActionState>;
