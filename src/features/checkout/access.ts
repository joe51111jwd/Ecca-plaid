import { z } from "zod";
import { donationsPolicy } from "@/server/donations";

/**
 * How a browser holds on to its checkout. A checkout is reached only through its opaque bearer token
 * (the donations service stores just its hash).
 *
 *   hosted (/give/{slug})              an HttpOnly cookie scoped to that SGO's path: the token never appears in a
 *                                      URL, history or referrer, and a reload resumes the same checkout.
 *   widget (/embed/give/{slug}/{tok})  the token is a path segment of the framed page. Third-party cookies are
 *                                      blocked inside another site's iframe by most browsers, so a cookie would lose
 *                                      the checkout on the first navigation. The URL lives only inside the iframe:
 *                                      the host page cannot read a cross-origin frame's location, and the
 *                                      Referrer-Policy (strict-origin-when-cross-origin) strips the path from
 *                                      requests to other origins.
 */

/** SGO slugs as the directory accepts them. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,100}$/, "Unknown organization.");

/** Checkout tokens as the donations service issues them (base64url). */
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, "This checkout link is not valid.");

export const accessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("hosted"), slug: slugSchema }),
  z.strictObject({ kind: z.literal("widget"), slug: slugSchema, token: tokenSchema }),
]);

export type CheckoutAccess = z.output<typeof accessSchema>;

/** Name of the hosted checkout cookie for one SGO. */
export function checkoutCookieName(slug: string): string {
  return `ecca_give_${slug.replace(/-/g, "_")}`;
}

export interface CheckoutCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

/** The cookie lives as long as an idle checkout does (the service expires it after the same time). */
export function checkoutCookieOptions(slug: string, production: boolean): CheckoutCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: production, path: `/give/${slug}`, maxAge: Math.floor(donationsPolicy.CHECKOUT_IDLE_TTL_MS / 1000) };
}

/** Where each surface's pages live. */
export function checkoutPaths(access: { kind: "hosted"; slug: string } | { kind: "widget"; slug: string; token: string }): { checkout: string; thanks: string; start: string } {
  if (access.kind === "hosted") return { checkout: `/give/${access.slug}`, thanks: `/give/${access.slug}/thanks`, start: `/give/${access.slug}` };
  return { checkout: `/embed/give/${access.slug}/${access.token}`, thanks: `/embed/give/${access.slug}/${access.token}/thanks`, start: `/embed/give/${access.slug}` };
}
