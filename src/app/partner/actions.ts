"use server";

import * as ops from "@/features/handoff/server/operations";
import { runPortalAction } from "@/features/handoff/server/run-action";
import type { PortalActionState } from "@/features/handoff/types";

/**
 * Server actions of the business portal. Each is the same three steps (runPortalAction): require a signed-in person,
 * run the operation with them as the actor (the services check their membership and role in the business), refresh.
 * The work is in src/features/handoff/server/operations.
 */

type Action = (previous: PortalActionState, formData: FormData) => Promise<PortalActionState>;

export const extendHoldAction: Action = async (_p, fd) => runPortalAction(ops.extendHoldOp, fd);
export const completeHandoffAction: Action = async (_p, fd) => runPortalAction(ops.completeHandoffOp, fd);
export const cancelHandoffAction: Action = async (_p, fd) => runPortalAction(ops.cancelHandoffOp, fd);

export const saveProfileAction: Action = async (_p, fd) => runPortalAction(ops.saveProfileOp, fd);
export const saveOriginsAction: Action = async (_p, fd) => runPortalAction(ops.saveOriginsOp, fd);
export const rotatePublishableKeyAction: Action = async (_p, fd) => runPortalAction(ops.rotatePublishableKeyOp, fd);
export const requestPartnershipAction: Action = async (_p, fd) => runPortalAction(ops.requestPartnershipOp, fd);
export const endPartnershipAction: Action = async (_p, fd) => runPortalAction(ops.endPartnershipOp, fd);

export const inviteMemberAction: Action = async (_p, fd) => runPortalAction(ops.inviteMemberOp, fd);
export const changeRoleAction: Action = async (_p, fd) => runPortalAction(ops.changeRoleOp, fd);
export const removeMemberAction: Action = async (_p, fd) => runPortalAction(ops.removeMemberOp, fd);

export const createApiKeyAction: Action = async (_p, fd) => runPortalAction(ops.createApiKeyOp, fd);
export const revokeApiKeyAction: Action = async (_p, fd) => runPortalAction(ops.revokeApiKeyOp, fd);
export const createWebhookAction: Action = async (_p, fd) => runPortalAction(ops.createWebhookOp, fd);
export const rotateWebhookSecretAction: Action = async (_p, fd) => runPortalAction(ops.rotateWebhookSecretOp, fd);
export const toggleWebhookAction: Action = async (_p, fd) => runPortalAction(ops.toggleWebhookOp, fd);
export const deleteWebhookAction: Action = async (_p, fd) => runPortalAction(ops.deleteWebhookOp, fd);

export const signupAction: Action = async (_p, fd) => runPortalAction(ops.signupOp, fd);
