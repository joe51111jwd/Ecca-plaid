import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEmail, sendEmail } from "@/server/email";
import { useTestDb } from "../../../../../tests/helpers/db";
import { GET } from "./route";

const get = (query: string) => GET(new NextRequest(`http://localhost:3000/dev/mail/latest${query}`));

async function send(to: string, subject: string, url: string, template = "magic_link") {
  const { html, text } = renderEmail({ heading: subject, paragraphs: ["Synthetic test message."], cta: { label: "Open", url } });
  return sendEmail({ to, subject, template, html, text });
}

describe("GET /dev/mail/latest", () => {
  useTestDb();
  afterEach(() => vi.unstubAllEnvs());

  it("returns the newest email for the recipient with its links", async () => {
    await send("parent@example.com", "First link", "https://app.example.org/auth?token=first");
    await send("other@example.com", "Someone else", "https://app.example.org/auth?token=other");
    const newest = await send("parent@example.com", "Second link", "https://app.example.org/auth?token=second&next=%2Ffamily");

    const res = await get("?to=parent%40example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: newest.id,
      to: "parent@example.com",
      subject: "Second link",
      template: "magic_link",
      status: "sent",
      text: newest.text,
      html: newest.html,
      links: ["https://app.example.org/auth?token=second&next=%2Ffamily"],
      createdAt: newest.createdAt.toISOString(),
    });
  });

  it("matches the recipient case-insensitively and can narrow by template", async () => {
    await send("parent@example.com", "Sign in", "https://app.example.org/auth?token=1", "magic_link");
    await send("parent@example.com", "Receipt", "https://app.example.org/receipt/1", "donation_receipt");
    expect((await (await get("?to=PARENT@example.com")).json()).subject).toBe("Receipt");
    expect((await (await get("?to=parent@example.com&template=magic_link")).json()).subject).toBe("Sign in");
    expect((await get("?to=parent@example.com&template=unknown")).status).toBe(404);
  });

  it("answers 404 when nothing was sent to that address", async () => {
    await send("other@example.com", "Hello", "https://app.example.org/x");
    const res = await get("?to=parent@example.com");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Email not found" } });
  });

  it("answers 400 without a recipient", async () => {
    for (const query of ["", "?to=", "?to=%20%20", "?template=magic_link"]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });

  it("does not exist in production", async () => {
    await send("parent@example.com", "Sign in", "https://app.example.org/auth?token=1");
    vi.stubEnv("NODE_ENV", "production");
    await expect(get("?to=parent@example.com")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
