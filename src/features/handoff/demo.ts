/**
 * The demo camp: a small, obviously fictional summer-camp booking site that installs the real embed script against a
 * seeded demo business. Every name, address, session, date and price here is SYNTHETIC and labeled "(demo)".
 */
import { newToken } from "@/lib/ids";

export const DEMO_CAMP = Object.freeze({
  name: "Camp Cedar Creek (demo)",
  tagline: "A fictional summer day camp used to demonstrate the scholarship handoff.",
  ownerEmail: "director@camp-cedar-creek.example",
  billingEmail: "billing@camp-cedar-creek.example",
  /** Dark enough for white text (the businesses service checks contrast). */
  brandColor: "#1f5c3f",
  holdWindowHours: 72,
});

export const DEMO_SGO = Object.freeze({
  name: "Bluebonnet Example Scholarship Fund (demo)",
  ownerEmail: "staff@bluebonnet-fund.example",
});

export interface DemoSession {
  id: string;
  name: string;
  dates: string;
  ages: string;
  priceCents: number;
  spotsLeft: number;
}

/** Fictional sessions and prices for the demo only. */
export const DEMO_SESSIONS: readonly DemoSession[] = Object.freeze([
  { id: "s1", name: "Session 1: Trailblazers", dates: "June 7–11, 2027", ages: "Ages 8–10", priceCents: 42_500, spotsLeft: 6 },
  { id: "s2", name: "Session 2: Creek Explorers", dates: "June 14–18, 2027", ages: "Ages 9–12", priceCents: 45_000, spotsLeft: 3 },
  { id: "s3", name: "Session 3: Night Sky Week", dates: "June 21–25, 2027", ages: "Ages 10–13", priceCents: 47_500, spotsLeft: 9 },
  { id: "s4", name: "Session 4: Makers & Builders", dates: "July 5–9, 2027", ages: "Ages 8–12", priceCents: 45_000, spotsLeft: 0 },
]);

export function findDemoSession(id: string | string[] | undefined): DemoSession | null {
  const v = Array.isArray(id) ? id[0] : id;
  return DEMO_SESSIONS.find((s) => s.id === v) ?? null;
}

/** Booking references look like "CCC-2027-7K3QX9": unique per checkout, safe in a URL path. */
export const DEMO_BOOKING_REF_PATTERN = /^CCC-2027-[A-Z0-9]{6}$/;

export function newDemoBookingRef(): string {
  const raw = newToken(12).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `CCC-2027-${(raw + "XXXXXX").slice(0, 6)}`;
}

export function isDemoBookingRef(v: unknown): v is string {
  return typeof v === "string" && DEMO_BOOKING_REF_PATTERN.test(v);
}

/** "Session 2: Creek Explorers, June 14–18, 2027" — the booking description the camp sends. */
export function demoBookingDescription(s: DemoSession): string {
  return `${s.name}, ${s.dates} (demo)`;
}
