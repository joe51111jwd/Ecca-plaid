/**
 * The business portal's form operations: validate the form (../forms), call the service with the signed-in person as
 * the actor, and say what happened. Services check the person's authority themselves (membership and role in the
 * business); operations that call a service without an actor parameter (webhook endpoints) check it here first and
 * write the audit entry. Every operation also refuses an organization that is not a business.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { forbidden, type ActionResult } from "@/lib/errors";
import { formatUsd } from "@/lib/money";
import { audit } from "@/server/audit";
import { assertOrgMember, requireOrgType, type User } from "@/server/auth";
import { API_KEY_MANAGER_ROLE, createApiKey, revokeApiKey } from "@/server/api";
import { createBusiness, endPartnership, requestPartnership, rotatePublishableKey, updateBusinessProfile, type BusinessUserActor } from "@/server/businesses";
import { cancelHandoff, completeHandoff, extendHold, formatDeadline, type HandoffActor } from "@/server/handoffs";
import { enforceRateLimit } from "@/server/ratelimit";
import { addMember, removeMember, updateMemberRole, type OrgActor } from "@/server/orgs";
import { createEndpoint, deleteEndpoint, disableEndpoint, enableEndpoint, rotateSecret } from "@/server/webhooks";
import {
  parseApiKeyCreate,
  parseApiKeyRevoke,
  parseCancel,
  parseComplete,
  parseExtendHold,
  parseInvite,
  parseMemberRemoval,
  parseOrigins,
  parsePartnershipEnd,
  parsePartnershipRequest,
  parseProfile,
  parseRoleChange,
  parseSignup,
  parseWebhookCreate,
  parseWebhookTarget,
} from "../forms";
import { PORTAL_HOME, SIGNUP_RATE_LIMIT } from "../policy";
import type { PortalActor, PortalNotice } from "../types";

type Result = ActionResult<PortalNotice>;

function ok(message: string, extra: Omit<PortalNotice, "message"> = {}): Result {
  return { ok: true, data: { message, ...extra } };
}

const handoffActor = (a: PortalActor): HandoffActor => ({ type: "user", userId: a.userId, request: a.request });
const businessActor = (a: PortalActor): BusinessUserActor => ({ userId: a.userId, request: a.request });
const orgActor = (a: PortalActor): OrgActor => ({ userId: a.userId, request: a.request });

/** `not_found` unless the organization is a business. */
async function business(orgId: string): Promise<void> {
  await requireOrgType(orgId, "business");
}

async function loadUser(userId: string): Promise<User> {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw forbidden();
  return user;
}

/* ------------------------------------------------------------------------------------------ handoffs */

export async function extendHoldOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseExtendHold(formData);
  await business(f.orgId);
  const h = await extendHold(f.orgId, f.handoffId, f.hours, handoffActor(actor));
  return ok(h.holdExpiresAt ? `Hold extended by ${f.hours} hours, to ${formatDeadline("en", h.holdExpiresAt)}.` : `Hold extended by ${f.hours} hours.`);
}

export async function completeHandoffOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseComplete(formData);
  await business(f.orgId);
  const { fee } = await completeHandoff(f.orgId, f.handoffId, handoffActor(actor), f.bookingAmountCents !== undefined ? { bookingAmountCents: f.bookingAmountCents } : {});
  return ok(fee ? `Booking marked completed. A success fee of ${formatUsd(fee.amountCents)} was added to your next invoice.` : "Booking marked completed.");
}

export async function cancelHandoffOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseCancel(formData);
  await business(f.orgId);
  await cancelHandoff(f.orgId, f.handoffId, handoffActor(actor), f.reason ? { reason: f.reason } : {});
  return ok("Handoff canceled. The family's page now says the scholarship check was canceled.");
}

/* ------------------------------------------------------------------------------------------ settings */

export async function saveProfileOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseProfile(formData);
  await business(f.orgId);
  await updateBusinessProfile(f.orgId, f.patch, businessActor(actor));
  return ok("Saved.");
}

export async function saveOriginsOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseOrigins(formData);
  await business(f.orgId);
  const profile = await updateBusinessProfile(f.orgId, { allowedOrigins: f.allowedOrigins }, businessActor(actor));
  return ok(profile.allowedOrigins.length === 0 ? "Saved. With no allowed origins, the button cannot start a handoff from any page." : `Saved ${profile.allowedOrigins.length} allowed origin${profile.allowedOrigins.length === 1 ? "" : "s"}.`);
}

export async function rotatePublishableKeyOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const orgId = String(formData.get("orgId") ?? "");
  await business(orgId);
  await rotatePublishableKey(orgId, businessActor(actor));
  return ok("New publishable key created. The old key stopped working: update the snippet on your site.");
}

export async function requestPartnershipOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parsePartnershipRequest(formData);
  await business(f.orgId);
  await requestPartnership({ businessOrgId: f.orgId, sgoOrgId: f.sgoOrgId }, businessActor(actor));
  return ok("Request sent. Families can be handed to this organization once it accepts.");
}

export async function endPartnershipOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parsePartnershipEnd(formData);
  await business(f.orgId);
  await endPartnership(f.orgId, f.partnershipId, businessActor(actor));
  return ok("Partnership ended. New families will not be handed to this organization.");
}

/* ---------------------------------------------------------------------------------------------- team */

export async function inviteMemberOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseInvite(formData);
  await business(f.orgId);
  await addMember({ orgId: f.orgId, email: f.email, role: f.role }, orgActor(actor));
  return ok(`${f.email} was added. They sign in with their email address.`);
}

export async function changeRoleOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseRoleChange(formData);
  await business(f.orgId);
  await updateMemberRole({ orgId: f.orgId, userId: f.userId, role: f.role }, orgActor(actor));
  return ok("Role updated.");
}

export async function removeMemberOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseMemberRemoval(formData);
  await business(f.orgId);
  await removeMember({ orgId: f.orgId, userId: f.userId }, orgActor(actor));
  return ok("Member removed.");
}

/* --------------------------------------------------------------------------------------- developers */

export async function createApiKeyOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseApiKeyCreate(formData);
  await business(f.orgId);
  const { apiKey, secret } = await createApiKey(f.orgId, { name: f.name, mode: f.mode }, { type: "user", userId: actor.userId, request: actor.request });
  return ok(`Created ${apiKey.mode} key "${apiKey.name}".`, { secret: { label: "Secret key", value: secret, hint: "Shown once. Store it on your server now; it cannot be shown again." } });
}

export async function revokeApiKeyOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseApiKeyRevoke(formData);
  await business(f.orgId);
  await revokeApiKey(f.orgId, f.keyId, { type: "user", userId: actor.userId, request: actor.request });
  return ok("Key revoked. Requests with it now fail.");
}

/** Webhook endpoints have no actor parameter: owners and admins only, checked here, and audited here. */
async function authorizeWebhooks(actor: PortalActor, orgId: string): Promise<void> {
  await business(orgId);
  await assertOrgMember(await loadUser(actor.userId), orgId, API_KEY_MANAGER_ROLE);
}

async function auditWebhook(actor: PortalActor, orgId: string, action: string, endpointId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await audit({ actor: { type: "user", id: actor.userId }, orgId, action, target: { type: "webhook_endpoint", id: endpointId }, metadata, request: actor.request });
}

export async function createWebhookOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseWebhookCreate(formData);
  await authorizeWebhooks(actor, f.orgId);
  const { endpoint, secret } = await createEndpoint({ orgId: f.orgId, url: f.url, description: f.description, eventTypes: f.eventTypes });
  await auditWebhook(actor, f.orgId, "webhook_endpoint.create", endpoint.id, { eventTypes: endpoint.eventTypes });
  return ok("Endpoint added.", { secret: { label: "Signing secret", value: secret, hint: "Shown once. Use it to verify the webhook-signature header on every delivery." } });
}

export async function rotateWebhookSecretOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseWebhookTarget(formData);
  await authorizeWebhooks(actor, f.orgId);
  const { secret } = await rotateSecret(f.orgId, f.endpointId);
  await auditWebhook(actor, f.orgId, "webhook_endpoint.rotate_secret", f.endpointId);
  return ok("New signing secret created. Deliveries are signed with both secrets for 24 hours.", { secret: { label: "Signing secret", value: secret, hint: "Shown once. Replace the old secret on your server." } });
}

export async function toggleWebhookOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseWebhookTarget(formData);
  await authorizeWebhooks(actor, f.orgId);
  const enable = formData.get("enable") === "true";
  await (enable ? enableEndpoint(f.orgId, f.endpointId) : disableEndpoint(f.orgId, f.endpointId));
  await auditWebhook(actor, f.orgId, enable ? "webhook_endpoint.enable" : "webhook_endpoint.disable", f.endpointId);
  return ok(enable ? "Endpoint enabled." : "Endpoint disabled. Events are not sent to it until you enable it again.");
}

export async function deleteWebhookOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseWebhookTarget(formData);
  await authorizeWebhooks(actor, f.orgId);
  await deleteEndpoint(f.orgId, f.endpointId);
  await auditWebhook(actor, f.orgId, "webhook_endpoint.delete", f.endpointId);
  return ok("Endpoint deleted.");
}

/* -------------------------------------------------------------------------------------------- signup */

/** A signed-in person signs up their own business; they become its owner. */
export async function signupOp(actor: PortalActor, formData: FormData): Promise<Result> {
  const f = parseSignup(formData);
  const user = await loadUser(actor.userId);
  await enforceRateLimit(`partner:signup:user:${user.id}`, { ...SIGNUP_RATE_LIMIT, message: "Too many businesses were set up from this account." });
  const { org } = await createBusiness({ name: f.name, vendorType: f.vendorType, website: f.website, billingEmail: f.billingEmail, ownerEmail: user.email }, businessActor(actor));
  return ok(`${org.name} is set up.`, { link: { href: `${PORTAL_HOME}/install?org=${encodeURIComponent(org.id)}`, label: "Install the scholarship button" } });
}
