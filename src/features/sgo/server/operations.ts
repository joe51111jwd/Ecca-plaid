import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { actionError, conflict, forbidden, invalid, notFound, type ActionResult } from "@/lib/errors";
import { BRAND } from "@/lib/brand";
import { formatUsd } from "@/lib/money";
import { generateSandboxDonorNumber, generateSandboxDonorNumbers, generateIrsReport, importDonorNumbers, issueAcknowledgment, markAcknowledgmentMailed, recordIrsReportSubmission, setDonorNumber } from "@/server/acknowledgments";
import { createApiKey, revokeApiKey } from "@/server/api";
import { audit } from "@/server/audit";
import { enforceRateLimit } from "@/server/ratelimit";
import { assertOrgMember, requireOrgType, roleAtLeast, type User } from "@/server/auth";
import { offerAward, updateAwardStatus, type AwardPaymentMethod } from "@/server/awards";
import { endPartnership, respondToPartnership } from "@/server/businesses";
import { getEvent } from "@/server/events";
import { addMember, removeMember, updateMemberRole } from "@/server/orgs";
import { createSgo, setDashboardOnly, setIrsPortalRegistered, updateSgoPolicy, updateSgoProfile, type SgoRecord } from "@/server/sgos";
import {
  addReviewerIncomeItem,
  assignReview,
  cancelVerification,
  createVerification,
  FAMILY_LINK_TTL_DAYS,
  removeReviewerIncomeItem,
  requestMoreInfo,
  rerunDecision,
  resolveReview,
  saveReviewerExtraction,
  setSgoNotificationSettings,
  type OrgActor,
} from "@/server/verifications";
import { createEndpoint, deleteEndpoint, disableEndpoint, enableEndpoint, getDelivery, resendDelivery, rotateSecret, updateEndpoint, type WebhookFormat } from "@/server/webhooks";
import { readFile, readFlag, readOptional, readText } from "../form-data";
import {
  donorScopeFromForm,
  incomeLineFromForm,
  keyedFieldsFromForm,
  newVerificationFromForm,
  offerAwardFromForm,
  policyFromForm,
  profileFromForm,
  requestInfoFromForm,
  resolveFromForm,
  roleFromForm,
  signupFromForm,
  taxYearFromForm,
  verificationIdFromForm,
  webhookEventsFromForm,
  webhookFromForm,
} from "../forms";
import { SGO_PATHS } from "../nav";
import { DONOR_NUMBER_UPLOAD_MAX_BYTES, INVITE_EMAIL_RATE_LIMIT, MANAGE_ROLE, REVIEW_ROLE, SANDBOX_NUMBER_LABEL, SIGNUP_RATE_LIMIT, VIEW_ROLE } from "../policy";
import type { SgoActor, SgoNotice, SgoOperation } from "../types";

/**
 * Every dashboard form's work: validate the submission, call the owning service with the actor's organization and
 * mode, word the outcome. Each operation takes the already-resolved SgoActor (./context) and returns an
 * ActionResult, so the same function is what the server action runs and what the tests call.
 *
 * `operation(minRole, body)` re-checks, against the database, that the actor is still a member of an SGO with at
 * least `minRole` before anything runs: some services (webhooks, verification creation) leave authorization to
 * their caller, and a form can be posted long after the page was rendered.
 */

const ok = (notice: SgoNotice): ActionResult<SgoNotice> => ({ ok: true, data: notice });

async function loadUser(userId: string): Promise<User> {
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) throw forbidden();
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw forbidden();
  return user;
}

/** Re-checks membership and role, and that the organization is an SGO. Throws forbidden. */
export async function assertActor(actor: SgoActor, minRole: MemberRole): Promise<void> {
  if (!actor || typeof actor !== "object" || (actor.mode !== "test" && actor.mode !== "live")) throw forbidden();
  const user = await loadUser(actor.userId);
  try {
    await requireOrgType(actor.orgId, "sgo");
  } catch {
    throw forbidden();
  }
  const access = await assertOrgMember(user, actor.orgId, minRole);
  if (!roleAtLeast(access.membership.role, minRole)) throw forbidden("Your role in this organization does not allow this");
}

function operation(minRole: MemberRole, body: (actor: SgoActor, formData: FormData) => Promise<SgoNotice>): SgoOperation {
  return async (actor, formData) => {
    try {
      await assertActor(actor, minRole);
      return ok(await body(actor, formData));
    } catch (e) {
      return actionError(e);
    }
  };
}

const orgActor = (a: SgoActor): OrgActor => ({ type: "user", id: a.userId, mode: a.mode, request: a.request });
const userActor = (a: SgoActor) => ({ userId: a.userId, request: a.request });
const auditActor = (a: SgoActor) => ({ type: "user" as const, id: a.userId });

/* ------------------------------------------------------------------------------------- verifications */

export const createVerificationOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const input = newVerificationFromForm(formData);
  if (input.sendInvite) {
    await enforceRateLimit(`sgo:dashboard:invite-email:${actor.orgId}:${actor.mode}`, { ...INVITE_EMAIL_RATE_LIMIT[actor.mode], message: "Your organization has emailed many family links in the last hour. Create the verification without the email and copy the link instead." });
  }
  const created = await createVerification({
    orgId: actor.orgId,
    mode: actor.mode,
    applicantName: input.applicantName,
    applicantEmail: input.applicantEmail,
    studentFirstName: input.studentFirstName,
    studentLastName: input.studentLastName,
    externalRef: input.externalRef,
    sendInvite: input.sendInvite,
    locale: input.locale,
    createdBy: { type: "user", id: actor.userId },
  });
  return {
    message: input.sendInvite ? `Verification created and the link was emailed to ${input.applicantEmail}.` : "Verification created. Copy the family link and send it to the family.",
    shownOnce: {
      label: "Family link",
      value: created.familyUrl,
      hint: `This link is shown only now. It lets the family start; anyone with it can open the start page, so send it only to the family. It expires in ${FAMILY_LINK_TTL_DAYS} days.`,
    },
    link: { href: SGO_PATHS.verification(created.verification.id), label: "Open the verification" },
  };
});

export const cancelVerificationOp = operation(REVIEW_ROLE, async (actor, formData) => {
  await cancelVerification(actor.orgId, verificationIdFromForm(formData), orgActor(actor));
  return { message: "Verification canceled. The family link no longer works." };
});

export const assignReviewOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const verificationId = verificationIdFromForm(formData);
  const choice = readText(formData, "assignee");
  const assignee = choice === "" || choice === "none" ? null : choice === "me" ? actor.userId : choice;
  await assignReview(actor.orgId, verificationId, assignee, orgActor(actor));
  return { message: assignee === null ? "Review unassigned." : assignee === actor.userId ? "Assigned to you." : "Review assigned." };
});

export const resolveReviewOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const input = resolveFromForm(formData);
  const row = await resolveReview(actor.orgId, input.verificationId, { resolution: input.resolution, notes: input.notes, basis: input.basis }, orgActor(actor));
  return { message: row.status === "eligible" ? "Resolved as eligible. The evidence pack is being generated." : "Resolved as not eligible. The evidence pack is being generated." };
});

export const requestMoreInfoOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const input = requestInfoFromForm(formData);
  await requestMoreInfo(actor.orgId, input.verificationId, { message: input.message, items: input.items }, orgActor(actor));
  return { message: "Request sent. The family sees it on their screen and by email; the review stays open until they answer." };
});

export const addIncomeLineOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const input = incomeLineFromForm(formData);
  const item = await addReviewerIncomeItem(
    actor.orgId,
    input.verificationId,
    { memberId: input.memberId, category: input.category, annualAmountCents: input.annualAmountCents, incomeYear: input.incomeYear, description: input.description, basis: input.basis, documentId: input.documentId },
    orgActor(actor),
  );
  return { message: `Income line added (${item.categoryLabel}, ${formatUsd(item.annualAmountCents, { cents: true })} for ${item.incomeYear}). Re-run the check to use it.` };
});

export const removeIncomeLineOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const itemId = readText(formData, "itemId");
  if (!itemId) throw invalid("Choose an income line.");
  await removeReviewerIncomeItem(actor.orgId, itemId, orgActor(actor));
  return { message: "Income line removed. Re-run the check to update the result." };
});

export const keyFieldsOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const { documentId, input } = keyedFieldsFromForm(formData);
  const saved = await saveReviewerExtraction(actor.orgId, documentId, input, orgActor(actor));
  return { message: `Saved ${saved.fieldCount} keyed field${saved.fieldCount === 1 ? "" : "s"}. Re-run the check to use them.` };
});

export const rerunOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const row = await rerunDecision(actor.orgId, verificationIdFromForm(formData), orgActor(actor));
  const words: Record<string, string> = { eligible: "eligible", ineligible: "not eligible", needs_review: "still needs review", pending: "waiting for information" };
  return { message: `Check re-run. The verification is now ${words[row.status] ?? row.status}.` };
});

/* -------------------------------------------------------------------------------------------- awards */

export const offerAwardOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const input = offerAwardFromForm(formData);
  const { award } = await offerAward(
    actor.orgId,
    { verificationId: input.verificationId, amountCents: input.amountCents, paymentMethod: input.paymentMethod as AwardPaymentMethod, studentMemberId: input.studentMemberId, notes: input.notes },
    { type: "user", userId: actor.userId, mode: actor.mode, request: actor.request },
  );
  return { message: `Award of ${formatUsd(award.amountCents, { cents: true })} offered. This is your organization's decision; no money moves through ${BRAND.name}.` };
});

export const updateAwardStatusOp = operation(REVIEW_ROLE, async (actor, formData) => {
  const awardId = readText(formData, "awardId");
  const status = readText(formData, "status");
  if (!awardId) throw invalid("Choose an award.");
  if (status !== "accepted" && status !== "paid" && status !== "revoked") throw invalid("Choose accepted, paid or revoked.", { fields: { status: "Choose a status." } });
  const note = readOptional(formData, "note");
  await updateAwardStatus(actor.orgId, awardId, { status, ...(note !== null ? { note } : {}) }, { type: "user", userId: actor.userId, mode: actor.mode, request: actor.request });
  return { message: status === "revoked" ? "Award revoked." : status === "paid" ? "Award recorded as paid." : "Award recorded as accepted." };
});

/* ---------------------------------------------------------------------------------- acknowledgments */

export const setDonorNumberOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const scope = donorScopeFromForm(formData);
  const number = readText(formData, "number");
  const row = await setDonorNumber(actor.orgId, { ...scope, mode: actor.mode, number, replace: readFlag(formData, "replace") }, userActor(actor));
  return { message: `Unique donor number ${row.number} saved.` };
});

export const importDonorNumbersOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const file = readFile(formData, "file");
  if (!file) throw invalid("Choose a CSV file.", { fields: { file: "Choose a file." } });
  if (file.size > DONOR_NUMBER_UPLOAD_MAX_BYTES) throw invalid("The file is larger than 5 MB.", { fields: { file: "Too large." } });
  const csv = await file.text();
  const report = await importDonorNumbers(actor.orgId, { csv, mode: actor.mode, replace: readFlag(formData, "replace") }, userActor(actor));
  if (!report.applied) {
    throw invalid(`Nothing was imported: ${report.errors.length} problem${report.errors.length === 1 ? "" : "s"} in the file. Fix them and import again.`, {
      fields: { file: report.errors.slice(0, 10).map((e) => `Line ${e.line} (${e.field}): ${e.message}`).join(" ") },
    });
  }
  return { message: `Imported ${report.rows} row${report.rows === 1 ? "" : "s"}.`, details: [{ label: "New", value: String(report.created) }, { label: "Replaced", value: String(report.replaced) }, { label: "Unchanged", value: String(report.unchanged) }] };
});

export const generateSandboxNumberOp = operation(MANAGE_ROLE, async (actor, formData) => {
  if (actor.mode !== "test") throw invalid("Sandbox numbers exist only in test mode.");
  const scope = donorScopeFromForm(formData);
  const row = await generateSandboxDonorNumber(actor.orgId, { ...scope, mode: "test" }, userActor(actor));
  return { message: `Sandbox number ${row.number} generated. ${SANDBOX_NUMBER_LABEL}.` };
});

export const generateSandboxNumbersOp = operation(MANAGE_ROLE, async (actor, formData) => {
  if (actor.mode !== "test") throw invalid("Sandbox numbers exist only in test mode.");
  const { created } = await generateSandboxDonorNumbers(actor.orgId, { taxYear: taxYearFromForm(formData), mode: "test" }, userActor(actor));
  return { message: created === 0 ? "Every donor already has a number." : `Generated ${created} sandbox number${created === 1 ? "" : "s"}. ${SANDBOX_NUMBER_LABEL}.` };
});

export const issueAcknowledgmentOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const scope = donorScopeFromForm(formData);
  const result = await issueAcknowledgment(actor.orgId, { ...scope, mode: actor.mode }, userActor(actor));
  switch (result.outcome) {
    case "issued":
      return { message: `Acknowledgment version ${result.acknowledgment?.version ?? 1} issued${result.acknowledgment?.delivery === "paper_required" ? ". This donor has no electronic-delivery consent: print and mail it, then record the mailing" : ""}.` };
    case "unchanged":
      return { message: "Nothing changed: the acknowledgment already issued says exactly this." };
    case "not_required":
      return { message: "No acknowledgment is needed: no designated gift was received from this donor for that year." };
    case "blocked":
      return { message: "The acknowledgment could not be issued yet.", notes: result.build.blockers.map((b) => b.message) };
  }
});

export const markMailedOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const acknowledgmentId = readText(formData, "acknowledgmentId");
  if (!acknowledgmentId) throw invalid("Choose an acknowledgment.");
  const note = readOptional(formData, "note");
  await markAcknowledgmentMailed(actor.orgId, acknowledgmentId, note ? { note } : {}, userActor(actor));
  return { message: "Mailing recorded." };
});

/* ---------------------------------------------------------------------------------------- IRS report */

export const generateIrsReportOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const result = await generateIrsReport(actor.orgId, { taxYear: taxYearFromForm(formData), mode: actor.mode }, userActor(actor));
  const errors = result.issues.filter((i) => i.severity === "error").length;
  return {
    message: `Report version ${result.report.version} generated with ${result.report.rowCount} row${result.report.rowCount === 1 ? "" : "s"}.`,
    details: [
      { label: "Total", value: formatUsd(result.report.totalDesignatedCents, { cents: true }) },
      { label: "Issues to fix", value: String(errors) },
      { label: "Matches acknowledgments", value: result.consistency.matches ? "Yes" : "No" },
    ],
  };
});

export const recordReportSubmissionOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const reportId = readText(formData, "reportId");
  if (!reportId) throw invalid("Choose a report version.");
  const reference = readOptional(formData, "reference");
  const row = await recordIrsReportSubmission(actor.orgId, reportId, { submittedOn: readText(formData, "submittedOn"), ...(reference ? { reference } : {}) }, userActor(actor));
  return { message: `Recorded as entered in the IRS SGO portal on ${row.submittedOn}.` };
});

/* ---------------------------------------------------------------------------------------- developers */

export const createApiKeyOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const { apiKey, secret } = await createApiKey(actor.orgId, { name: readText(formData, "name"), mode: actor.mode }, { type: "user", userId: actor.userId, request: actor.request });
  return {
    message: `${actor.mode === "live" ? "Live" : "Test"} key "${apiKey.name}" created.`,
    shownOnce: { label: "Secret key", value: secret, secret: true, hint: "Copy it now and store it in your secrets manager. It is shown only once; we keep only a hash." },
  };
});

export const revokeApiKeyOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const key = await revokeApiKey(actor.orgId, readText(formData, "keyId"), { type: "user", userId: actor.userId, request: actor.request });
  return { message: `Key "${key.name}" revoked. Requests with it now fail.` };
});

export const createWebhookOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const input = webhookFromForm(formData);
  const { endpoint, secret } = await createEndpoint({ orgId: actor.orgId, url: input.url, description: input.description, eventTypes: input.eventTypes, format: input.format as WebhookFormat });
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: "webhook_endpoint.create", target: { type: "webhook_endpoint", id: endpoint.id }, metadata: { host: new URL(endpoint.url).host, eventTypes: endpoint.eventTypes, format: endpoint.format, via: "dashboard" }, request: actor.request });
  return {
    message: "Endpoint added. It receives events from test and live mode; each delivery says which.",
    shownOnce: { label: "Signing secret", value: secret, secret: true, hint: "Use it to verify each delivery's signature. It is shown only once; rotate it if it is lost." },
  };
});

export const updateWebhookEventsOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const endpointId = readText(formData, "endpointId");
  const eventTypes = webhookEventsFromForm(formData);
  const endpoint = await updateEndpoint(actor.orgId, endpointId, { eventTypes });
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: "webhook_endpoint.update", target: { type: "webhook_endpoint", id: endpoint.id }, metadata: { eventTypes: endpoint.eventTypes, via: "dashboard" }, request: actor.request });
  return { message: "Event selection saved." };
});

export const rotateWebhookSecretOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const endpointId = readText(formData, "endpointId");
  const immediate = readFlag(formData, "immediate");
  const { endpoint, secret } = await rotateSecret(actor.orgId, endpointId, immediate ? { overlapMs: 0 } : {});
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: "webhook_endpoint.rotate_secret", target: { type: "webhook_endpoint", id: endpoint.id }, metadata: { immediate, via: "dashboard" }, request: actor.request });
  return {
    message: immediate ? "Secret replaced. The old secret stopped working now." : "Secret replaced. For 24 hours deliveries are signed with both the old and the new secret.",
    shownOnce: { label: "New signing secret", value: secret, secret: true, hint: "Shown only once." },
  };
});

export const setWebhookStatusOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const endpointId = readText(formData, "endpointId");
  const target = readText(formData, "status");
  if (target !== "active" && target !== "disabled") throw invalid("Choose enable or disable.");
  const endpoint = target === "active" ? await enableEndpoint(actor.orgId, endpointId) : await disableEndpoint(actor.orgId, endpointId);
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: target === "active" ? "webhook_endpoint.enable" : "webhook_endpoint.disable", target: { type: "webhook_endpoint", id: endpoint.id }, metadata: { via: "dashboard" }, request: actor.request });
  return { message: target === "active" ? "Endpoint enabled. Events from while it was disabled are not replayed." : "Endpoint disabled." };
});

export const deleteWebhookOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const endpointId = readText(formData, "endpointId");
  await deleteEndpoint(actor.orgId, endpointId);
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: "webhook_endpoint.delete", target: { type: "webhook_endpoint", id: endpointId }, metadata: { via: "dashboard" }, request: actor.request });
  return { message: "Endpoint deleted with its delivery history." };
});

export const resendDeliveryOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const deliveryId = readText(formData, "deliveryId");
  if (!deliveryId) throw invalid("Choose a delivery.");
  const original = await getDelivery(actor.orgId, deliveryId);
  // Endpoints serve both modes; a person looking at test data must not replay a live event (and the reverse).
  const event = await getEvent(actor.orgId, original.eventId);
  if (event.mode !== actor.mode) throw notFound("Webhook delivery");
  const created = await resendDelivery(actor.orgId, deliveryId);
  await audit({ actor: auditActor(actor), orgId: actor.orgId, action: "webhook_delivery.resend", target: { type: "webhook_delivery", id: created.id }, metadata: { originalId: original.id, eventType: original.eventType, via: "dashboard" }, request: actor.request });
  return { message: "Resent. A new delivery was queued; the original stays in the log." };
});

/* ------------------------------------------------------------------------------------------ settings */

export const updateProfileOp = operation(MANAGE_ROLE, async (actor, formData) => {
  await updateSgoProfile(actor.orgId, profileFromForm(formData), userActor(actor));
  return { message: "Profile saved." };
});

export const updatePolicyOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const policy = await updateSgoPolicy(actor.orgId, policyFromForm(formData), userActor(actor));
  return { message: `Policy saved: income cap ${policy.incomeCapPct}%, review band ${policy.reviewBandBps} basis points, uploads kept ${policy.rawRetentionDays} days after a decision. New decisions use it.` };
});

export const setPortalRegisteredOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const registered = readFlag(formData, "registered");
  await setIrsPortalRegistered(actor.orgId, registered, userActor(actor));
  return { message: registered ? "Recorded that your organization is registered in the IRS SGO portal." : "Recorded that your organization is not registered in the IRS SGO portal." };
});

export const setDashboardOnlyOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const dashboardOnly = readFlag(formData, "dashboardOnly");
  await setDashboardOnly(actor.orgId, dashboardOnly, userActor(actor));
  return { message: dashboardOnly ? "Saved: you work in the dashboard only." : "Saved: you will integrate with webhooks or the API." };
});

export const updateNotificationsOp = operation(MANAGE_ROLE, async (actor, formData) => {
  await setSgoNotificationSettings(actor.orgId, { needsReview: readFlag(formData, "needsReview"), decided: readFlag(formData, "decided") }, orgActor(actor));
  return { message: "Notification settings saved." };
});

export const addMemberOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const email = readText(formData, "email");
  if (!email) throw invalid("Enter an email address.", { fields: { email: "Required." } });
  const { user, isNewUser } = await addMember({ orgId: actor.orgId, email, role: roleFromForm(formData) }, userActor(actor));
  return { message: `${user.email} added.${isNewUser ? " They sign in with this email address; no password is needed." : ""}` };
});

export const changeRoleOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const userId = readText(formData, "userId");
  if (!userId) throw invalid("Choose a team member.");
  const membership = await updateMemberRole({ orgId: actor.orgId, userId, role: roleFromForm(formData) }, userActor(actor));
  return { message: `Role changed to ${membership.role}.` };
});

export const removeMemberOp = operation(VIEW_ROLE, async (actor, formData) => {
  const userId = readText(formData, "userId");
  if (!userId) throw invalid("Choose a team member.");
  // Anyone may leave; removing someone else needs MANAGE_ROLE (the orgs service enforces it as well).
  if (userId !== actor.userId && !roleAtLeast(actor.role, MANAGE_ROLE)) throw forbidden("Your role in this organization does not allow this");
  await removeMember({ orgId: actor.orgId, userId }, userActor(actor));
  return { message: userId === actor.userId ? "You left the organization." : "Team member removed." };
});

export const respondPartnershipOp = operation(MANAGE_ROLE, async (actor, formData) => {
  const partnershipId = readText(formData, "partnershipId");
  const decision = readText(formData, "decision");
  if (decision !== "active" && decision !== "ended") throw invalid("Choose accept or decline.");
  await respondToPartnership(actor.orgId, partnershipId, decision, userActor(actor));
  return { message: decision === "active" ? "Partnership accepted. Families booking with this business can now be handed to you." : "Request declined." };
});

export const endPartnershipOp = operation(MANAGE_ROLE, async (actor, formData) => {
  await endPartnership(actor.orgId, readText(formData, "partnershipId"), userActor(actor));
  return { message: "Partnership ended. New handoffs from this business stop." };
});

/* -------------------------------------------------------------------------------------------- signup */

/**
 * Self-serve creation of an SGO workspace by the signed-in person, who becomes its owner. The workspace starts in
 * test mode (see LIVE_MODE_REQUIRES_VERIFIED_LISTING): being created does not put it on any SGO list.
 */
export async function signupOp(user: Pick<User, "id" | "email">, request: SgoActor["request"], formData: FormData): Promise<ActionResult<{ record: SgoRecord }>> {
  try {
    const input = signupFromForm(formData);
    if (!user?.email) throw forbidden();
    await enforceRateLimit(`sgo:signup:user:${user.id}`, { ...SIGNUP_RATE_LIMIT, message: "You have created several workspaces today." });
    const record = await createSgo({ name: input.name, ein: input.ein, city: input.city, state: input.state, ownerEmail: user.email }, { userId: user.id, request });
    return { ok: true, data: { record } };
  } catch (e) {
    return actionError(e);
  }
}

/**
 * Refuses a submission rendered for another scope than the one the dashboard now resolves from its cookies: a stale
 * tab after an org switch (`orgId` hidden field) or after the test/live switch was flipped in another tab (`mode`
 * hidden field). Without the mode check, a form on a test-mode page (a new verification, an IRS report, an API key)
 * would silently act on live data. Each field is checked when present.
 */
export function assertSameOrg(actor: SgoActor, formData: FormData): void {
  const posted = readOptional(formData, "orgId");
  if (posted !== null && posted !== actor.orgId) throw conflict("This page was opened for another organization. Reload it and try again.");
  const mode = readOptional(formData, "mode");
  if (mode !== null && mode !== actor.mode) {
    const words = (m: string) => (m === "live" ? "live mode" : m === "test" ? "test mode" : "another mode");
    throw conflict(`This page was opened in ${words(mode)}, but the dashboard is now in ${words(actor.mode)}. Reload it and try again.`);
  }
}
