import { and, asc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { MemberRole, OrgType } from "@/db/schema";
import { now } from "@/lib/clock";
import { appUrl } from "@/lib/env";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit, SYSTEM_ACTOR, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { invitationEmailCopy, isMemberRole, isPlatformAdmin, normalizeEmail, PLATFORM_ORG_SLUG, ROLE_RANK, type Membership, type Organization, type User } from "@/server/auth";
import { renderEmail, sendEmail } from "@/server/email";
import { isReservedSlug, isValidSlug, slugify, SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, withSuffix } from "./slug";

/**
 * Organizations (SGOs, businesses, the platform) and who belongs to them.
 *
 * Tenant rule: every member operation checks inside the service that the actor may act on that organization
 * (owner or admin of it, or a platform admin). Admins manage reviewers, viewers and other admins; only owners
 * and platform admins grant, change or remove the owner role. An organization always keeps at least one owner.
 */

export interface OrgActor {
  userId: string;
  request?: AuditRequestInfo | null;
}

export interface MemberSummary {
  membership: Membership;
  user: Pick<User, "id" | "email" | "name" | "lastLoginAt">;
}

const ORG_TYPES: readonly OrgType[] = ["sgo", "business", "platform"];
const MAX_SLUG_ATTEMPTS = 5;

const createOrgSchema = z.object({
  type: z.enum(ORG_TYPES as [OrgType, ...OrgType[]]),
  name: z.string().trim().min(1, "Enter the organization's name.").max(200, "Use at most 200 characters."),
  slug: z.string().trim().toLowerCase().optional().nullable(),
  ownerUserId: z.string().min(1).optional().nullable(),
});

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    if (typeof cur === "object" && (cur as { code?: unknown }).code === "23505") return true;
    cur = typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function landingPathFor(type: OrgType): string {
  return type === "platform" ? "/admin" : type === "sgo" ? "/sgo" : "/partner";
}

async function pickFreeSlug(db: DbOrTx, base: string): Promise<string> {
  const o = schema.organizations;
  const rows = await db
    .select({ slug: o.slug })
    .from(o)
    .where(or(eq(o.slug, base), like(o.slug, `${base.replace(/[%_\\]/g, "\\$&")}-%`)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = withSuffix(base, String(n));
    if (!taken.has(candidate)) return candidate;
  }
  return withSuffix(base, newToken(4).toLowerCase().replace(/[^a-z0-9]/g, "x"));
}

function baseSlugFromName(name: string): string {
  let base = slugify(name);
  if (base.length < SLUG_MIN_LENGTH) base = base ? `${base}-org` : "org";
  if (isReservedSlug(base)) base = withSuffix(base, "org");
  return base;
}

/**
 * Creates an organization with a unique slug (generated from the name unless given) and, with `ownerUserId`,
 * its first owner. There is exactly one `platform` organization. Audited as "org.create".
 */
export async function createOrganization(
  input: { type: OrgType; name: string; slug?: string | null; ownerUserId?: string | null },
  actor?: OrgActor | null,
  dbOrTx?: DbOrTx,
): Promise<Organization> {
  const parsed = createOrgSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "name"] ??= issue.message;
    throw invalid("Check the organization details.", { fields });
  }
  const { type, name, ownerUserId } = parsed.data;
  const db = dbOrTx ?? (await getDb());

  let explicitSlug: string | null = null;
  if (type === "platform") {
    explicitSlug = PLATFORM_ORG_SLUG;
    const [existing] = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.type, "platform")).limit(1);
    if (existing) throw conflict("The platform organization already exists");
  } else if (parsed.data.slug) {
    explicitSlug = parsed.data.slug;
    if (!isValidSlug(explicitSlug)) {
      const message = `Use ${SLUG_MIN_LENGTH}–${SLUG_MAX_LENGTH} lower-case letters, numbers and single hyphens.`;
      throw invalid(message, { fields: { slug: message } });
    }
    if (isReservedSlug(explicitSlug)) throw invalid("That web address is reserved. Choose another.", { fields: { slug: "That web address is reserved. Choose another." } });
  }

  const actorRef: AuditActor = actor ? { type: "user", id: actor.userId } : SYSTEM_ACTOR;
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = explicitSlug ?? (await pickFreeSlug(db, baseSlugFromName(name)));
    try {
      return await db.transaction(async (tx) => {
        const at = now();
        const [org] = await tx.insert(schema.organizations).values({ id: newId("org"), type, name, slug, status: "active", createdAt: at }).returning();
        if (ownerUserId) {
          await tx.insert(schema.memberships).values({ id: newId("membership"), orgId: org.id, userId: ownerUserId, role: "owner", createdAt: at });
        }
        await audit({ actor: actorRef, orgId: org.id, action: "org.create", target: { type: "organization", id: org.id }, metadata: { type, slug, ownerUserId: ownerUserId ?? null }, request: actor?.request }, tx);
        return org;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (explicitSlug) throw conflict(type === "platform" ? "The platform organization already exists" : "That web address is taken. Choose another.", { fields: { slug: "That web address is taken. Choose another." } });
      // A concurrent creation took the generated slug: pick again.
    }
  }
  throw conflict("Could not choose a unique web address. Try again.");
}

export async function getOrg(orgId: string, dbOrTx?: DbOrTx): Promise<Organization | null> {
  const db = dbOrTx ?? (await getDb());
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  return org ?? null;
}

export async function getOrgBySlug(slug: string, dbOrTx?: DbOrTx): Promise<Organization | null> {
  const db = dbOrTx ?? (await getDb());
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug.trim().toLowerCase())).limit(1);
  return org ?? null;
}

/** Organizations the user belongs to, oldest membership first. */
export async function listOrgsForUser(userId: string, dbOrTx?: DbOrTx): Promise<Array<{ org: Organization; role: MemberRole; membershipId: string }>> {
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ org: schema.organizations, role: schema.memberships.role, membershipId: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));
  return rows;
}

interface ActorAuthority {
  platformAdmin: boolean;
  role: MemberRole | null;
}

async function actorAuthority(db: DbOrTx, orgId: string, actorUserId: string): Promise<ActorAuthority> {
  const [m] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, actorUserId)))
    .limit(1);
  return { platformAdmin: await isPlatformAdmin(actorUserId, db), role: m?.role ?? null };
}

/** May this actor manage members of the org at all (owner/admin there, or platform admin)? */
function canManage(a: ActorAuthority): boolean {
  return a.platformAdmin || a.role === "owner" || a.role === "admin";
}

/** May this actor grant, change or remove the given role? Only owners and platform admins touch the owner role. */
function canTouchRole(a: ActorAuthority, role: MemberRole): boolean {
  if (a.platformAdmin || a.role === "owner") return true;
  return a.role === "admin" && ROLE_RANK[role] < ROLE_RANK.owner;
}

async function loadOrgForManagement(db: DbOrTx, orgId: string, actor: OrgActor): Promise<{ org: Organization; authority: ActorAuthority }> {
  const authority = await actorAuthority(db, orgId, actor.userId);
  // Check authority before existence so a stranger cannot tell missing organizations from foreign ones.
  if (!canManage(authority)) throw forbidden();
  const org = await getOrg(orgId, db);
  if (!org) throw notFound("Organization");
  return { org, authority };
}

async function lockedOwnerCount(tx: DbOrTx, orgId: string): Promise<number> {
  // Row locks on the owners serialize concurrent demotions/removals, so two owners cannot remove each other at once.
  const owners = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner")))
    .for("update");
  return owners.length;
}

/**
 * Adds a person (by email) to an organization, creating their account row if needed, and emails them an
 * invitation pointing at the sign-in page. The email carries no credential: they sign in the normal way.
 */
export async function addMember(
  input: { orgId: string; email: string; role: MemberRole },
  actor: OrgActor,
  dbOrTx?: DbOrTx,
): Promise<{ membership: Membership; user: User; isNewUser: boolean }> {
  const email = normalizeEmail(input.email);
  if (!isMemberRole(input.role)) throw invalid("Choose a role.", { fields: { role: "Choose a role." } });
  const role = input.role;
  const db = dbOrTx ?? (await getDb());

  const result = await db.transaction(async (tx) => {
    const { org, authority } = await loadOrgForManagement(tx, input.orgId, actor);
    if (!canTouchRole(authority, role)) throw forbidden("Only an owner can add another owner");

    const at = now();
    let isNewUser = false;
    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) {
      const inserted = await tx.insert(schema.users).values({ id: newId("user"), email, createdAt: at }).onConflictDoNothing({ target: schema.users.email }).returning();
      if (inserted[0]) {
        user = inserted[0];
        isNewUser = true;
      } else {
        [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      }
    }

    const [membership] = await tx
      .insert(schema.memberships)
      .values({ id: newId("membership"), orgId: org.id, userId: user.id, role, createdAt: at })
      .onConflictDoNothing({ target: [schema.memberships.orgId, schema.memberships.userId] })
      .returning();
    if (!membership) throw conflict("That person is already a member of this organization.", { fields: { email: "Already a member." } });

    await audit(
      { actor: { type: "user", id: actor.userId }, orgId: org.id, action: "org.member_add", target: { type: "membership", id: membership.id }, metadata: { userId: user.id, role, newUser: isNewUser }, request: actor.request },
      tx,
    );
    const [inviter] = await tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
    return { org, membership, user, isNewUser, inviterEmail: inviter?.email ?? null };
  });

  const locale = result.user.locale === "es" ? "es" : "en";
  const copy = invitationEmailCopy(locale, result.org.name, role, result.inviterEmail);
  const signInUrl = appUrl(`/sign-in?email=${encodeURIComponent(email)}&next=${encodeURIComponent(landingPathFor(result.org.type))}${locale === "es" ? "&lang=es" : ""}`);
  const rendered = renderEmail({ locale, heading: copy.heading, paragraphs: copy.paragraphs, cta: { label: copy.cta, url: signInUrl }, footerNote: copy.footerNote });
  await sendEmail({ to: email, subject: copy.subject, template: "org_invitation", html: rendered.html, text: rendered.text, related: { type: "membership", id: result.membership.id } }, db);

  return { membership: result.membership, user: result.user, isNewUser: result.isNewUser };
}

export async function updateMemberRole(input: { orgId: string; userId: string; role: MemberRole }, actor: OrgActor, dbOrTx?: DbOrTx): Promise<Membership> {
  if (!isMemberRole(input.role)) throw invalid("Choose a role.", { fields: { role: "Choose a role." } });
  const role = input.role;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const { org, authority } = await loadOrgForManagement(tx, input.orgId, actor);
    const ownerCount = await lockedOwnerCount(tx, org.id);
    const [target] = await tx
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, org.id), eq(schema.memberships.userId, input.userId)))
      .limit(1);
    if (!target) throw notFound("Member");
    if (!canTouchRole(authority, target.role) || !canTouchRole(authority, role)) throw forbidden("Only an owner can change the owner role");
    if (target.role === role) return target;
    if (target.role === "owner" && ownerCount <= 1) throw conflict("An organization needs at least one owner. Make someone else an owner first.");

    const [updated] = await tx.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, target.id)).returning();
    await audit(
      { actor: { type: "user", id: actor.userId }, orgId: org.id, action: "org.member_role_update", target: { type: "membership", id: target.id }, metadata: { userId: target.userId, from: target.role, to: role }, request: actor.request },
      tx,
    );
    return updated;
  });
}

/** Removes a member. Anyone may remove themselves; the last owner can never be removed. */
export async function removeMember(input: { orgId: string; userId: string }, actor: OrgActor, dbOrTx?: DbOrTx): Promise<void> {
  const db = dbOrTx ?? (await getDb());
  await db.transaction(async (tx) => {
    const self = input.userId === actor.userId;
    let authority: ActorAuthority;
    if (self) {
      authority = await actorAuthority(tx, input.orgId, actor.userId);
      if (!authority.role && !authority.platformAdmin) throw forbidden();
    } else {
      authority = (await loadOrgForManagement(tx, input.orgId, actor)).authority;
    }
    const ownerCount = await lockedOwnerCount(tx, input.orgId);
    const [target] = await tx
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, input.orgId), eq(schema.memberships.userId, input.userId)))
      .limit(1);
    if (!target) throw notFound("Member");
    if (!self && !canTouchRole(authority, target.role)) throw forbidden("Only an owner can remove an owner");
    if (target.role === "owner" && ownerCount <= 1) throw conflict("An organization needs at least one owner. Make someone else an owner first.");

    await tx.delete(schema.memberships).where(eq(schema.memberships.id, target.id));
    await audit(
      { actor: { type: "user", id: actor.userId }, orgId: input.orgId, action: "org.member_remove", target: { type: "membership", id: target.id }, metadata: { userId: target.userId, role: target.role, self }, request: actor.request },
      tx,
    );
  });
}

/** Members of an organization. Any member of it (or a platform admin) may list them. */
export async function listMembers(orgId: string, actor: OrgActor, dbOrTx?: DbOrTx): Promise<MemberSummary[]> {
  const db = dbOrTx ?? (await getDb());
  const authority = await actorAuthority(db, orgId, actor.userId);
  if (!authority.role && !authority.platformAdmin) throw forbidden();
  return db
    .select({
      membership: schema.memberships,
      user: { id: schema.users.id, email: schema.users.email, name: schema.users.name, lastLoginAt: schema.users.lastLoginAt },
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));
}
