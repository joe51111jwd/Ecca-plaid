"use server";

import * as ops from "@/features/admin/server/operations";
import { runAdminAction } from "@/features/admin/server/run-action";
import type { AdminActionState } from "@/features/admin/types";

/**
 * Server actions of the platform admin console. Each one is the same three steps (runAdminAction): require a
 * platform admin, run the operation (validate → service → outcome), refresh the page. The work is in
 * src/features/admin/server/operations.
 */

type Action = (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;

export const saveFeeStructureAction: Action = async (_previous, formData) => runAdminAction(ops.saveFeeStructure, formData);
export const setLiveGiftsAction: Action = async (_previous, formData) => runAdminAction(ops.setLiveGifts, formData);
export const setCreditStartDateAction: Action = async (_previous, formData) => runAdminAction(ops.setCreditStartDate, formData);
export const setListSourceAction: Action = async (_previous, formData) => runAdminAction(ops.setListSource, formData);

export const importListAction: Action = async (_previous, formData) => runAdminAction(ops.importList, formData);
export const removeListEntryAction: Action = async (_previous, formData) => runAdminAction(ops.removeListEntry, formData);
export const linkListEntryAction: Action = async (_previous, formData) => runAdminAction(ops.linkListEntry, formData);

export const createSgoAction: Action = async (_previous, formData) => runAdminAction(ops.createSgoOp, formData);
export const createBusinessAction: Action = async (_previous, formData) => runAdminAction(ops.createBusinessOp, formData);
export const setOrgStatusAction: Action = async (_previous, formData) => runAdminAction(ops.setOrgStatusOp, formData);
export const addMemberAction: Action = async (_previous, formData) => runAdminAction(ops.addMemberOp, formData);
export const changeRoleAction: Action = async (_previous, formData) => runAdminAction(ops.changeRoleOp, formData);
export const removeMemberAction: Action = async (_previous, formData) => runAdminAction(ops.removeMemberOp, formData);
export const setSuccessFeeAction: Action = async (_previous, formData) => runAdminAction(ops.setSuccessFeeOp, formData);

export const retryJobAction: Action = async (_previous, formData) => runAdminAction(ops.retryJobOp, formData);
export const processDeletionAction: Action = async (_previous, formData) => runAdminAction(ops.processDeletionOp, formData);
export const refundAction: Action = async (_previous, formData) => runAdminAction(ops.refundOp, formData);
