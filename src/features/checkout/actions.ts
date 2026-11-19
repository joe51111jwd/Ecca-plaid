"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MS } from "@/lib/clock";
import { isProd } from "@/lib/env";
import { actionError, AppError, invalid, type ActionResult } from "@/lib/errors";
import type { ClientPayment } from "@/server/payments";
import { getCurrentUser, getRequestInfo } from "@/server/auth";
import { enforceRateLimit } from "@/server/ratelimit";
import { accessSchema, checkoutCookieName, checkoutCookieOptions, checkoutPaths, slugSchema, type CheckoutAccess } from "./access";
import { beginGift, placeGift, saveGift } from "./flow";
import type { CheckoutClientView } from "./view-model";

/**
 * Server actions behind the donor checkout (hosted page and widget). No sign-in is required to give: what
 * authorizes a call is the checkout's bearer token, read from the HttpOnly cookie (hosted) or carried by the
 * framed page's URL (widget). The donations service validates every field and re-checks every rule.
 */

/** Starting a checkout creates a row; a person needs a few, a script does not get many. */
const START_LIMIT = { limit: 20, windowMs: 10 * MS.minute };

const startSchema = z.strictObject({
  slug: slugSchema,
  surface: z.enum(["hosted", "widget"]),
  giftCents: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      if (!/^\d{1,12}$/.test(v)) {
        ctx.addIssue({ code: "custom", message: "Enter an amount in dollars, like 250." });
        return z.NEVER;
      }
      return Number(v);
    }),
  donorTimeZone: z.string().trim().max(64).optional(),
});

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

async function tokenFor(access: CheckoutAccess): Promise<string> {
  if (access.kind === "widget") return access.token;
  const token = (await cookies()).get(checkoutCookieName(access.slug))?.value;
  if (!token) throw new AppError("gone", "This checkout is no longer open in this browser. Start your gift again.");
  return token;
}

function parseAccess(raw: unknown): CheckoutAccess {
  const parsed = accessSchema.safeParse(raw);
  if (!parsed.success) throw invalid("This checkout link is not valid.");
  return parsed.data;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The "Start your gift" form. Creates the checkout, then sends the browser to it. */
export async function startGiftAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let destination: string;
  try {
    const parsed = startSchema.safeParse({ slug: field(formData, "slug"), surface: field(formData, "surface"), giftCents: field(formData, "giftCents") ?? "", donorTimeZone: field(formData, "donorTimeZone") });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "form"] ??= issue.message;
      throw invalid("Check the amount.", { fields });
    }
    const { slug, surface, giftCents } = parsed.data;
    const request = await getRequestInfo();
    await enforceRateLimit(`give-start:${request.ip ?? "unknown"}`, { ...START_LIMIT, message: "Too many checkouts started from this connection." });
    // A signed-in donor's gifts appear on their page; inside another site's frame our session cookie is not sent.
    const user = surface === "hosted" ? await getCurrentUser() : null;
    const donorTimeZone = parsed.data.donorTimeZone && isTimeZone(parsed.data.donorTimeZone) ? parsed.data.donorTimeZone : null;
    const { token } = await beginGift({ slug, source: surface, userId: user?.id ?? null, giftCents, donorTimeZone });
    if (surface === "hosted") {
      (await cookies()).set(checkoutCookieName(slug), token, checkoutCookieOptions(slug, isProd()));
      destination = checkoutPaths({ kind: "hosted", slug }).checkout;
    } else {
      destination = checkoutPaths({ kind: "widget", slug, token }).checkout;
    }
  } catch (e) {
    return actionError(e);
  }
  redirect(destination);
}

/** Saves part of the form as the donor types; returns the new view (numbers, copy and field errors). */
export async function saveCheckoutAction(rawAccess: unknown, patch: unknown): Promise<ActionResult<CheckoutClientView>> {
  try {
    const access = parseAccess(rawAccess);
    return { ok: true, data: await saveGift(await tokenFor(access), patch) };
  } catch (e) {
    return actionError(e);
  }
}

/** Places the order (donation records with the designation, one payment) and returns what the payment form needs. */
export async function placeOrderAction(rawAccess: unknown, shownDesignationTextSha256: unknown): Promise<ActionResult<{ view: CheckoutClientView; payment: ClientPayment }>> {
  try {
    const access = parseAccess(rawAccess);
    const shown = typeof shownDesignationTextSha256 === "string" && /^[0-9a-f]{64}$/.test(shownDesignationTextSha256) ? shownDesignationTextSha256 : null;
    const user = access.kind === "hosted" ? await getCurrentUser() : null;
    const result = await placeGift(await tokenFor(access), { userId: user?.id ?? null, request: await getRequestInfo(), shownDesignationTextSha256: shown });
    return { ok: true, data: result };
  } catch (e) {
    return actionError(e);
  }
}

/** Hosted only: forgets this browser's checkout for the SGO (after a completed or expired one) and starts over. */
export async function newGiftAction(formData: FormData): Promise<void> {
  const slug = slugSchema.safeParse(field(formData, "slug"));
  if (!slug.success) redirect("/give");
  (await cookies()).set(checkoutCookieName(slug.data), "", { ...checkoutCookieOptions(slug.data, isProd()), maxAge: 0 });
  redirect(checkoutPaths({ kind: "hosted", slug: slug.data }).start);
}
