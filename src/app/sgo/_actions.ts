"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError } from "@/lib/errors";
import { parseMode, requireSgoActor, requireSignupUser } from "@/features/sgo/server/context";
import * as ops from "@/features/sgo/server/operations";
import { runSgoAction } from "@/features/sgo/server/run-action";
import { SGO_MODE_COOKIE, SGO_ORG_COOKIE, SGO_PREFERENCE_COOKIE_MAX_AGE_S } from "@/features/sgo/policy";
import type { SgoActionState } from "@/features/sgo/types";
import { env, isProd } from "@/lib/env";

/**
 * Server actions of the SGO dashboard. Each one is the same steps (runSgoAction): resolve the signed-in staff member
 * and their organization from the session, re-check the role the operation needs, run it, refresh the page. The work
 * is in src/features/sgo/server/operations.
 */

type Action = (previous: SgoActionState, formData: FormData) => Promise<SgoActionState>;

function preferenceCookie() {
  return { httpOnly: true, sameSite: "lax" as const, secure: isProd() || env().APP_URL.startsWith("https://"), path: "/sgo", maxAge: SGO_PREFERENCE_COOKIE_MAX_AGE_S };
}

/** The test/live switch. Live is honoured only where it is available (the guard falls back to test otherwise). */
export async function setModeAction(formData: FormData): Promise<void> {
  const ctx = await requireSgoActor();
  const mode = parseMode(typeof formData.get("mode") === "string" ? (formData.get("mode") as string) : null);
  if (!mode || (mode === "live" && !ctx.liveAvailable)) return;
  (await cookies()).set(SGO_MODE_COOKIE, mode, preferenceCookie());
  refresh();
}

export const createVerificationAction: Action = async (_p, fd) => runSgoAction(ops.createVerificationOp, fd);
export const cancelVerificationAction: Action = async (_p, fd) => runSgoAction(ops.cancelVerificationOp, fd);
export const assignReviewAction: Action = async (_p, fd) => runSgoAction(ops.assignReviewOp, fd);
export const resolveReviewAction: Action = async (_p, fd) => runSgoAction(ops.resolveReviewOp, fd);
export const requestMoreInfoAction: Action = async (_p, fd) => runSgoAction(ops.requestMoreInfoOp, fd);
export const addIncomeLineAction: Action = async (_p, fd) => runSgoAction(ops.addIncomeLineOp, fd);
export const removeIncomeLineAction: Action = async (_p, fd) => runSgoAction(ops.removeIncomeLineOp, fd);
export const keyFieldsAction: Action = async (_p, fd) => runSgoAction(ops.keyFieldsOp, fd);
export const rerunAction: Action = async (_p, fd) => runSgoAction(ops.rerunOp, fd);
export const offerAwardAction: Action = async (_p, fd) => runSgoAction(ops.offerAwardOp, fd);
export const updateAwardStatusAction: Action = async (_p, fd) => runSgoAction(ops.updateAwardStatusOp, fd);

export const setDonorNumberAction: Action = async (_p, fd) => runSgoAction(ops.setDonorNumberOp, fd);
export const importDonorNumbersAction: Action = async (_p, fd) => runSgoAction(ops.importDonorNumbersOp, fd);
export const generateSandboxNumberAction: Action = async (_p, fd) => runSgoAction(ops.generateSandboxNumberOp, fd);
export const generateSandboxNumbersAction: Action = async (_p, fd) => runSgoAction(ops.generateSandboxNumbersOp, fd);
export const issueAcknowledgmentAction: Action = async (_p, fd) => runSgoAction(ops.issueAcknowledgmentOp, fd);
export const markMailedAction: Action = async (_p, fd) => runSgoAction(ops.markMailedOp, fd);

export const generateIrsReportAction: Action = async (_p, fd) => runSgoAction(ops.generateIrsReportOp, fd);
export const recordReportSubmissionAction: Action = async (_p, fd) => runSgoAction(ops.recordReportSubmissionOp, fd);

export const createApiKeyAction: Action = async (_p, fd) => runSgoAction(ops.createApiKeyOp, fd);
export const revokeApiKeyAction: Action = async (_p, fd) => runSgoAction(ops.revokeApiKeyOp, fd);
export const createWebhookAction: Action = async (_p, fd) => runSgoAction(ops.createWebhookOp, fd);
export const updateWebhookEventsAction: Action = async (_p, fd) => runSgoAction(ops.updateWebhookEventsOp, fd);
export const rotateWebhookSecretAction: Action = async (_p, fd) => runSgoAction(ops.rotateWebhookSecretOp, fd);
export const setWebhookStatusAction: Action = async (_p, fd) => runSgoAction(ops.setWebhookStatusOp, fd);
export const deleteWebhookAction: Action = async (_p, fd) => runSgoAction(ops.deleteWebhookOp, fd);
export const resendDeliveryAction: Action = async (_p, fd) => runSgoAction(ops.resendDeliveryOp, fd);

export const updateProfileAction: Action = async (_p, fd) => runSgoAction(ops.updateProfileOp, fd);
export const updatePolicyAction: Action = async (_p, fd) => runSgoAction(ops.updatePolicyOp, fd);
export const setPortalRegisteredAction: Action = async (_p, fd) => runSgoAction(ops.setPortalRegisteredOp, fd);
export const setDashboardOnlyAction: Action = async (_p, fd) => runSgoAction(ops.setDashboardOnlyOp, fd);
export const updateNotificationsAction: Action = async (_p, fd) => runSgoAction(ops.updateNotificationsOp, fd);
export const addMemberAction: Action = async (_p, fd) => runSgoAction(ops.addMemberOp, fd);
export const changeRoleAction: Action = async (_p, fd) => runSgoAction(ops.changeRoleOp, fd);
export const removeMemberAction: Action = async (_p, fd) => runSgoAction(ops.removeMemberOp, fd);
export const respondPartnershipAction: Action = async (_p, fd) => runSgoAction(ops.respondPartnershipOp, fd);
export const endPartnershipAction: Action = async (_p, fd) => runSgoAction(ops.endPartnershipOp, fd);

/**
 * Self-serve signup: creates the SGO with the signed-in person as owner, switches the dashboard to it in test mode
 * and goes to its home page.
 */
export async function signupAction(_previous: SgoActionState, formData: FormData): Promise<SgoActionState> {
  let orgId: string;
  try {
    const { user, request } = await requireSignupUser();
    const result = await ops.signupOp(user, request, formData);
    if (!result.ok) return result;
    orgId = result.data.record.org.id;
  } catch (e) {
    return actionError(e);
  }
  const jar = await cookies();
  jar.set(SGO_ORG_COOKIE, orgId, preferenceCookie());
  jar.set(SGO_MODE_COOKIE, "test", preferenceCookie());
  redirect("/sgo");
}
