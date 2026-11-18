import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { MemberRole } from "@/db/schema";
import { platformAdminEmails } from "@/lib/env";
import { newId } from "@/lib/ids";
import { BRAND } from "@/lib/brand";

export type Organization = typeof schema.organizations.$inferSelect;
export type Membership = typeof schema.memberships.$inferSelect;

export const PLATFORM_ORG_SLUG = "platform";
/** Role granted to addresses listed in PLATFORM_ADMIN_EMAILS when they sign in. */
export const PLATFORM_BOOTSTRAP_ROLE: MemberRole = "owner";

/** The single `platform` organization, created on first need. Safe under concurrent callers (slug is unique). */
export async function ensurePlatformOrg(dbOrTx?: DbOrTx): Promise<Organization> {
  const db = dbOrTx ?? (await getDb());
  const [existing] = await db.select().from(schema.organizations).where(eq(schema.organizations.type, "platform")).limit(1);
  if (existing) return existing;
  await db
    .insert(schema.organizations)
    .values({ id: newId("org"), type: "platform", name: BRAND.name, slug: PLATFORM_ORG_SLUG, status: "active" })
    .onConflictDoNothing({ target: schema.organizations.slug });
  const [created] = await db.select().from(schema.organizations).where(eq(schema.organizations.type, "platform")).limit(1);
  if (!created) throw new Error(`An organization already uses the reserved slug "${PLATFORM_ORG_SLUG}" but is not the platform organization`);
  return created;
}

export function isBootstrapPlatformAdmin(email: string): boolean {
  return platformAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Grants platform-admin membership to a user whose address is in PLATFORM_ADMIN_EMAILS. An existing platform
 * membership is left as it is (a demoted admin is not silently re-promoted). Returns true when a row was added.
 */
export async function grantBootstrapPlatformAdmin(user: { id: string; email: string }, dbOrTx?: DbOrTx): Promise<boolean> {
  if (!isBootstrapPlatformAdmin(user.email)) return false;
  const db = dbOrTx ?? (await getDb());
  const org = await ensurePlatformOrg(db);
  const inserted = await db
    .insert(schema.memberships)
    .values({ id: newId("membership"), orgId: org.id, userId: user.id, role: PLATFORM_BOOTSTRAP_ROLE })
    .onConflictDoNothing({ target: [schema.memberships.orgId, schema.memberships.userId] })
    .returning({ id: schema.memberships.id });
  return inserted.length > 0;
}

export async function isPlatformAdmin(userId: string, dbOrTx?: DbOrTx): Promise<boolean> {
  const db = dbOrTx ?? (await getDb());
  const [row] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.organizations.type, "platform")))
    .limit(1);
  return Boolean(row);
}

/** Where a signed-in person lands when no explicit destination was requested. */
export async function defaultLandingPath(userId: string, dbOrTx?: DbOrTx): Promise<"/admin" | "/sgo" | "/partner" | "/family"> {
  const db = dbOrTx ?? (await getDb());
  const rows = await db
    .select({ type: schema.organizations.type })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, userId));
  const types = new Set(rows.map((r) => r.type));
  if (types.has("platform")) return "/admin";
  if (types.has("sgo")) return "/sgo";
  if (types.has("business")) return "/partner";
  return "/family";
}
