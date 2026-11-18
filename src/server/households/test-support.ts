import { vi } from "vitest";
import { getDb, schema } from "@/db/client";
import type { VerificationStatus } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { newId, newToken } from "@/lib/ids";
import { ensurePlatformOrg, type User } from "@/server/auth";

/**
 * Test-only fixtures for the households and consents modules. Every name, email, address and organization
 * here is SYNTHETIC.
 */

export async function makeUser(email: string, opts: { locale?: "en" | "es"; phone?: string } = {}): Promise<User> {
  const db = await getDb();
  const [u] = await db
    .insert(schema.users)
    .values({ id: newId("user"), email, locale: opts.locale ?? "en", phone: opts.phone ?? null })
    .returning();
  return u;
}

export async function makeSgo(name = "Synthetic Scholarship Fund"): Promise<typeof schema.organizations.$inferSelect> {
  const db = await getDb();
  const [org] = await db
    .insert(schema.organizations)
    .values({ id: newId("org"), type: "sgo", name, slug: `sgo-${newToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}` })
    .returning();
  return org;
}

export async function makePlatformAdmin(email = "admin@example.com"): Promise<User> {
  const db = await getDb();
  const platform = await ensurePlatformOrg(db);
  const user = await makeUser(email);
  await db.insert(schema.memberships).values({ id: newId("membership"), orgId: platform.id, userId: user.id, role: "admin" });
  return user;
}

export async function makeVerification(
  orgId: string,
  householdId: string | null,
  opts: { status?: VerificationStatus; passportSourceId?: string; decidedAt?: Date; expiresAt?: Date } = {},
): Promise<typeof schema.verifications.$inferSelect> {
  const db = await getDb();
  const [v] = await db
    .insert(schema.verifications)
    .values({
      id: newId("verification"),
      orgId,
      householdId,
      status: opts.status ?? "pending",
      familyTokenHash: hashToken(newToken()),
      familyTokenExpiresAt: new Date("2030-01-01T00:00:00Z"),
      passportSourceId: opts.passportSourceId ?? null,
      decidedAt: opts.decidedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();
  return v;
}

/** A stand-in for the Census Geocoder: returns a match in `countyGeoid`, or no match when null. */
export function fakeGeocoder(countyGeoid: string | null, state = "TX"): typeof fetch {
  const body =
    countyGeoid === null
      ? { result: { input: {}, addressMatches: [] } }
      : {
          result: {
            addressMatches: [
              {
                matchedAddress: "1 SYNTHETIC WAY, SOMEWHERE, TX, 00000",
                coordinates: { x: -97.7, y: 30.2 },
                tigerLine: { tigerLineId: "1", side: "L" },
                addressComponents: { state, zip: "00000" },
                geographies: { Counties: [{ GEOID: countyGeoid, STATE: countyGeoid.slice(0, 2), NAME: "Synthetic County" }] },
              },
            ],
          },
        };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

export async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
    return "ok";
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    throw e;
  }
}
