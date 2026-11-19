import { describe, expect, it } from "vitest";
import { donationsPolicy } from "@/server/donations";
import { accessSchema, checkoutCookieName, checkoutCookieOptions, checkoutPaths, slugSchema, tokenSchema } from "./access";

const TOKEN = "A".repeat(43);

describe("checkout access", () => {
  it("scopes the hosted cookie to the organization's path, HttpOnly, and as long-lived as an idle checkout", () => {
    expect(checkoutCookieName("lone-star-fund")).toBe("ecca_give_lone_star_fund");
    const options = checkoutCookieOptions("lone-star-fund", false);
    expect(options).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/give/lone-star-fund", maxAge: Math.floor(donationsPolicy.CHECKOUT_IDLE_TTL_MS / 1000) });
    expect(checkoutCookieOptions("x", true).secure).toBe(true);
  });

  it("accepts only directory-shaped slugs", () => {
    expect(slugSchema.parse(" Lone-Star ")).toBe("lone-star");
    for (const bad of ["", "a/b", "../etc", "a b", "x".repeat(101), "%2e%2e"]) expect(slugSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts only service-shaped tokens", () => {
    expect(tokenSchema.safeParse(TOKEN).success).toBe(true);
    for (const bad of ["short", `${TOKEN}!`, "x".repeat(129), ""]) expect(tokenSchema.safeParse(bad).success).toBe(false);
  });

  it("requires a token for the widget and refuses one for the hosted page (it comes from the cookie)", () => {
    expect(accessSchema.safeParse({ kind: "hosted", slug: "fund" }).success).toBe(true);
    expect(accessSchema.safeParse({ kind: "hosted", slug: "fund", token: TOKEN }).success).toBe(false);
    expect(accessSchema.safeParse({ kind: "widget", slug: "fund" }).success).toBe(false);
    expect(accessSchema.safeParse({ kind: "widget", slug: "fund", token: TOKEN }).success).toBe(true);
    expect(accessSchema.safeParse({ kind: "other", slug: "fund" }).success).toBe(false);
    expect(accessSchema.safeParse(null).success).toBe(false);
  });

  it("keeps every widget page under /embed (the only frameable paths)", () => {
    const paths = checkoutPaths({ kind: "widget", slug: "fund", token: TOKEN });
    for (const p of Object.values(paths)) expect(p.startsWith("/embed/give/fund")).toBe(true);
    expect(checkoutPaths({ kind: "hosted", slug: "fund" })).toEqual({ checkout: "/give/fund", thanks: "/give/fund/thanks", start: "/give/fund" });
  });
});
