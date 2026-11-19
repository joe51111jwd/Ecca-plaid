/**
 * Seeds and reads the demo camp's data through the services' public APIs: a business ("Camp Cedar Creek (demo)")
 * whose allowed origin is this app's own origin (the demo site is served from it), a partner SGO that accepts
 * handoffs, and an active partnership between them. Idempotent, and only where demoEnabled() (never production).
 * Every organization and address here is synthetic.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Mode } from "@/db/schema";
import { AppError, notFound } from "@/lib/errors";
import { appUrl } from "@/lib/env";
import { businessSystemActor, createBusiness, getBusinessProfile, listPartnershipsForBusiness, publishableKeyMode, requestPartnership, respondToPartnership, updateBusinessProfile } from "@/server/businesses";
import { listEvents, type EventRecord } from "@/server/events";
import { getHandoff, recordToApi, type ApiHandoff } from "@/server/handoffs";
import { getOrgBySlug, slugify } from "@/server/orgs";
import { createSgo, systemActor, updateSgoProfile } from "@/server/sgos";
import { DEMO_CAMP, DEMO_SGO, isDemoBookingRef } from "../demo";
import { demoEnabled } from "../policy";

export interface DemoCamp {
  businessOrgId: string;
  publishableKey: string;
  sgoOrgId: string | null;
  ownerEmail: string;
  mode: Mode;
  /** The app origin the embed is allowed from. */
  origin: string;
}

function assertDemo(): void {
  if (!demoEnabled()) throw new AppError("not_available", "The demo is not available on this deployment.");
}

const REASON = "demo camp seed (synthetic data)";

async function findOrgId(name: string, type: "business" | "sgo"): Promise<string | null> {
  const org = await getOrgBySlug(slugify(name));
  return org && org.type === type ? org.id : null;
}

/** The app's own origin (scheme, host, port), where the demo site and the embed live. */
export function demoOrigin(): string {
  return new URL(appUrl("/")).origin;
}

/** The seeded demo camp, or null when it has not been set up. */
export async function getDemoCamp(): Promise<DemoCamp | null> {
  assertDemo();
  const businessOrgId = await findOrgId(DEMO_CAMP.name, "business");
  if (!businessOrgId) return null;
  const { profile } = await getBusinessProfile(businessOrgId);
  const active = (await listPartnershipsForBusiness(businessOrgId, { status: "active" }))[0];
  return { businessOrgId, publishableKey: profile.publishableKey, sgoOrgId: active?.sgo.orgId ?? null, ownerEmail: DEMO_CAMP.ownerEmail, mode: publishableKeyMode(), origin: demoOrigin() };
}

/**
 * Creates whatever part of the demo is missing and repairs what drifted (the allowed origin follows APP_URL, the
 * partnership is re-activated). Safe to call any number of times.
 */
export async function ensureDemoCamp(): Promise<DemoCamp> {
  assertDemo();
  const actor = businessSystemActor(REASON);
  const origin = demoOrigin();

  let businessOrgId = await findOrgId(DEMO_CAMP.name, "business");
  if (!businessOrgId) {
    const created = await createBusiness({ name: DEMO_CAMP.name, vendorType: "summer_camp", billingEmail: DEMO_CAMP.billingEmail, ownerEmail: DEMO_CAMP.ownerEmail }, actor);
    businessOrgId = created.org.id;
  }
  const { profile } = await getBusinessProfile(businessOrgId);
  const origins = profile.allowedOrigins.includes(origin) ? profile.allowedOrigins : [...profile.allowedOrigins, origin];
  await updateBusinessProfile(businessOrgId, { allowedOrigins: origins, brandColor: DEMO_CAMP.brandColor, holdWindowHours: DEMO_CAMP.holdWindowHours }, actor);

  let sgoOrgId = await findOrgId(DEMO_SGO.name, "sgo");
  if (!sgoOrgId) {
    const { org } = await createSgo({ name: DEMO_SGO.name, ownerEmail: DEMO_SGO.ownerEmail }, systemActor(REASON));
    sgoOrgId = org.id;
  }
  await updateSgoProfile(sgoOrgId, { acceptsHandoffs: true, displayName: DEMO_SGO.name }, systemActor(REASON));

  const existing = (await listPartnershipsForBusiness(businessOrgId)).find((p) => p.sgo.orgId === sgoOrgId);
  if (!existing || existing.partnership.status !== "active") {
    const p = existing && existing.partnership.status === "pending" ? existing.partnership : await requestPartnership({ businessOrgId, sgoOrgId }, actor);
    await respondToPartnership(sgoOrgId, p.id, "active", actor);
  }

  const camp = await getDemoCamp();
  if (!camp) throw new AppError("internal", "The demo camp could not be set up.");
  return camp;
}

export interface DemoBookingState {
  handoff: ApiHandoff;
  /** The events the camp's webhook endpoint receives for this handoff, oldest first (payloads as delivered). */
  events: Array<{ id: string; type: string; createdAt: Date; payload: Record<string, unknown> }>;
}

/**
 * What the demo camp's server knows about one of its bookings: the handoff as GET /api/v1/handoffs/{id} returns it,
 * and the handoff.* events emitted for it. Looked up by the camp's own booking reference (newest handoff wins).
 */
export async function getDemoBooking(camp: DemoCamp, bookingRef: string): Promise<DemoBookingState | null> {
  assertDemo();
  if (!isDemoBookingRef(bookingRef)) throw notFound("Booking");
  const db = await getDb();
  const h = schema.handoffs;
  const [row] = await db
    .select({ id: h.id })
    .from(h)
    .where(and(eq(h.businessOrgId, camp.businessOrgId), eq(h.mode, camp.mode), eq(h.bookingRef, bookingRef)))
    .orderBy(desc(h.createdAt), desc(h.id))
    .limit(1);
  if (!row) return null;
  const handoff = recordToApi(await getHandoff(camp.businessOrgId, row.id, { mode: camp.mode }));
  const all: EventRecord[] = await listEvents({ orgId: camp.businessOrgId, mode: camp.mode, limit: 200 });
  const events = all
    .filter((e) => e.type.startsWith("handoff.") && (e.payload as { id?: unknown }).id === row.id)
    .reverse()
    .map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt, payload: e.payload }));
  return { handoff, events };
}
