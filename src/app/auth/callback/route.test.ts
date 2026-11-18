import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { getSessionFromToken, requestSignIn } from "@/server/auth";
import { readSignInEmail } from "@/server/auth/test-helpers";
import { useTestDb } from "../../../../tests/helpers/db";
import { GET } from "./route";

const call = (query: string) => GET(new NextRequest(`http://localhost:3111/auth/callback${query}`, { headers: { "x-forwarded-for": "198.51.100.7", "user-agent": "vitest" } }));

describe("GET /auth/callback", () => {
  useTestDb();
  beforeEach(() => setTestNow("2026-11-18T15:00:00Z"));
  afterEach(() => setTestNow(null));

  it("consumes the token, sets a hardened session cookie and redirects to the stored destination", async () => {
    await requestSignIn({ email: "cb@example.com", redirectTo: "/v/abc?step=consent&x=a?b" });
    const { token } = await readSignInEmail("cb@example.com");
    const res = await call(`?token=${token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3111/v/abc?step=consent&x=a?b");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^passport_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    const sessionToken = /passport_session=([^;]+)/.exec(cookie)![1];
    const live = await getSessionFromToken(sessionToken);
    expect(live?.user.email).toBe("cb@example.com");
    expect(live?.session.ip).toBe("198.51.100.7");

    // Second use of the same link: friendly error, no cookie.
    const again = await call(`?token=${token}`);
    expect(again.headers.get("location")).toBe("http://localhost:3111/sign-in?error=link_invalid");
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("falls back to the role-based landing page", async () => {
    const db = await getDb();
    const [u] = await db.insert(schema.users).values({ id: newId("user"), email: "staff@example.com" }).returning();
    const [o] = await db.insert(schema.organizations).values({ id: newId("org"), type: "sgo", name: "Synthetic SGO", slug: "synthetic-sgo" }).returning();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId: o.id, userId: u.id, role: "viewer" });
    await requestSignIn({ email: "staff@example.com" });
    const res = await call(`?token=${(await readSignInEmail("staff@example.com")).token}`);
    expect(res.headers.get("location")).toBe("http://localhost:3111/sgo");

    await requestSignIn({ email: "parent@example.com", locale: "es" });
    const mail = await readSignInEmail("parent@example.com");
    expect(mail.text).toContain("&lang=es");
    expect((await call(`?token=${mail.token}&lang=es`)).headers.get("location")).toBe("http://localhost:3111/family");
  });

  it("sends missing, garbage and expired tokens to the sign-in page, keeping the language", async () => {
    expect((await call("")).headers.get("location")).toBe("http://localhost:3111/sign-in?error=link_invalid");
    expect((await call("?token=%3Cscript%3E&lang=es")).headers.get("location")).toBe("http://localhost:3111/sign-in?error=link_invalid&lang=es");
    await requestSignIn({ email: "late@example.com" });
    const { token } = await readSignInEmail("late@example.com");
    setTestNow("2026-11-18T15:15:00Z");
    expect((await call(`?token=${token}`)).headers.get("location")).toBe("http://localhost:3111/sign-in?error=link_invalid");
  });
});
