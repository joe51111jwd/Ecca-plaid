import { notFound } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { assertPlatformAdmin, getRequestInfo, requirePlatformAdmin, requireUser, type OrgAccess } from "@/server/auth";
import type { AdminActor } from "../types";

/**
 * Access to the admin console. Every page under /admin calls `requireAdminPage` first and every admin server action
 * goes through `runAdminAction` (./run-action), which calls `requireAdminActor`.
 */

/**
 * For pages: signed-out visitors are sent to sign in (and come back to `returnTo`); a signed-in person who is not a
 * platform admin gets the ordinary 404, so the console's existence is not advertised.
 */
export async function requireAdminPage(returnTo: string): Promise<OrgAccess> {
  const user = await requireUser({ returnTo });
  try {
    return await assertPlatformAdmin(user);
  } catch (e) {
    if (isAppError(e) && e.code === "forbidden") notFound();
    throw e;
  }
}

/** For server actions: the platform admin and the request's client info. Throws AppError unauthenticated / forbidden. */
export async function requireAdminActor(): Promise<AdminActor> {
  const access = await requirePlatformAdmin();
  const info = await getRequestInfo();
  return { userId: access.user.id, request: { ip: info.ip ?? null, userAgent: info.userAgent ?? null } };
}
