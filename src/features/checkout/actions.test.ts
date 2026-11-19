import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "../../../tests/helpers/db";
import { setTestNow } from "@/lib/clock";
import { createListedSgo, singleFilerPatch } from "@/server/donations/test-support";

/* All organizations and people are SYNTHETIC. next/headers and next/navigation are replaced by an in-memory request. */

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest" });

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      jar.set(name, { value, options });
    },
  }),
  headers: async () => requestHeaders,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const { newGiftAction, placeOrderAction, saveCheckoutAction, startGiftAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

describe("checkout server actions", () => {
  useTestDb();
  beforeEach(() => {
    jar.clear();
    setTestNow(new Date("2026-11-18T15:00:00Z"));
  });
  afterEach(() => setTestNow(null));

  it("hosted: starts a checkout, keeps its token only in an HttpOnly cookie scoped to the organization, and goes to it", async () => {
    const sgo = await createListedSgo();
    const url = await redirectOf(() => startGiftAction(null, form({ slug: sgo.slug, surface: "hosted", giftCents: "25000", donorTimeZone: "America/Chicago" })));
    expect(url).toBe(`/give/${sgo.slug}`);
    const cookie = jar.get(`ecca_give_${sgo.slug.replace(/-/g, "_")}`);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: `/give/${sgo.slug}` });
    expect(url).not.toContain(cookie!.value);

    const saved = await saveCheckoutAction({ kind: "hosted", slug: sgo.slug }, { filingStatus: "single" });
    expect(saved.ok && saved.data.order).toMatchObject({ giftCents: 25_000, filingStatus: "single" });
  });

  it("widget: carries the token in the framed page's path and sets no cookie", async () => {
    const sgo = await createListedSgo();
    const url = await redirectOf(() => startGiftAction(null, form({ slug: sgo.slug, surface: "widget", giftCents: "" })));
    expect(url).toMatch(new RegExp(`^/embed/give/${sgo.slug}/[A-Za-z0-9_-]{32,128}$`));
    expect(jar.size).toBe(0);
    const token = url.split("/").pop() as string;
    const saved = await saveCheckoutAction({ kind: "widget", slug: sgo.slug, token }, { giftCents: 10_000 });
    expect(saved.ok && saved.data.order.giftCents).toBe(10_000);
  });

  it("returns field errors instead of throwing for a bad amount or an unknown organization", async () => {
    const bad = await startGiftAction(null, form({ slug: "fund", surface: "hosted", giftCents: "12.5" }));
    expect(bad).toMatchObject({ ok: false, error: { code: "validation_failed", fields: { giftCents: expect.any(String) } } });
    const unknown = await startGiftAction(null, form({ slug: "no-such-fund", surface: "hosted", giftCents: "" }));
    expect(unknown).toMatchObject({ ok: false, error: { code: "not_found" } });
    const surface = await startGiftAction(null, form({ slug: "fund", surface: "elsewhere", giftCents: "" }));
    expect(surface).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("rate-limits checkout creation per connection", async () => {
    const sgo = await createListedSgo();
    let last: unknown = null;
    for (let i = 0; i < 21; i++) {
      try {
        last = await startGiftAction(null, form({ slug: sgo.slug, surface: "widget", giftCents: "" }));
      } catch (e) {
        if (!(e instanceof RedirectSignal)) throw e;
        last = null;
      }
    }
    expect(last).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });

  it("refuses to save without this browser's cookie, with a token-shaped forgery, or with unknown fields", async () => {
    const sgo = await createListedSgo();
    expect(await saveCheckoutAction({ kind: "hosted", slug: sgo.slug }, { giftCents: 1 })).toMatchObject({ ok: false, error: { code: "gone" } });
    expect(await saveCheckoutAction({ kind: "widget", slug: sgo.slug, token: "Z".repeat(43) }, { giftCents: 1 })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await saveCheckoutAction({ kind: "widget", slug: sgo.slug, token: "short" }, {})).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await saveCheckoutAction("not an object", {})).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const url = await redirectOf(() => startGiftAction(null, form({ slug: sgo.slug, surface: "widget", giftCents: "" })));
    const token = url.split("/").pop() as string;
    expect(await saveCheckoutAction({ kind: "widget", slug: sgo.slug, token }, { ssn: "000-00-0000" })).toMatchObject({ ok: false, error: { code: "validation_failed", fields: { ssn: expect.any(String) } } });
  });

  it("places the order and returns the payment for the payment form; ignores a malformed shown-words hash", async () => {
    const sgo = await createListedSgo();
    await redirectOf(() => startGiftAction(null, form({ slug: sgo.slug, surface: "hosted", giftCents: "" })));
    const access = { kind: "hosted", slug: sgo.slug } as const;
    await saveCheckoutAction(access, singleFilerPatch());
    const confirmed = await saveCheckoutAction(access, { designationConfirmed: true });
    expect(confirmed.ok && confirmed.data.canPlaceOrder).toBe(true);
    const placed = await placeOrderAction(access, "<script>");
    expect(placed.ok && placed.data.payment.amountCents).toBe(170_000);
    expect(placed.ok && placed.data.view.status).toBe("awaiting_payment");
    const again = await placeOrderAction(access, confirmed.ok ? confirmed.data.designation.statement?.textSha256 : null);
    expect(again.ok && placed.ok && again.data.payment.paymentId).toBe(placed.ok ? placed.data.payment.paymentId : null);
  });

  it("new gift: forgets this browser's checkout and returns to the start screen", async () => {
    const sgo = await createListedSgo();
    await redirectOf(() => startGiftAction(null, form({ slug: sgo.slug, surface: "hosted", giftCents: "" })));
    const url = await redirectOf(() => newGiftAction(form({ slug: sgo.slug })));
    expect(url).toBe(`/give/${sgo.slug}`);
    const cookie = jar.get(`ecca_give_${sgo.slug.replace(/-/g, "_")}`);
    expect(cookie?.value).toBe("");
    expect(cookie?.options).toMatchObject({ maxAge: 0, path: `/give/${sgo.slug}` });
    expect(await redirectOf(() => newGiftAction(form({ slug: "../x" })))).toBe("/give");
  });
});
