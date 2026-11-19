import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { es } from "@/i18n/es";
import type { User } from "@/server/auth";
import { hideEnumerableArrayExtensions, makeTestFamily, makeTestSgo, startedVerification, syntheticFixture } from "@/server/verifications/test-support";
import { useTestDb } from "../../../../tests/helpers/db";

// The signed-in person is read from cookies; here it is whoever the test says.
const signedIn: { user: User | null } = { user: null };
vi.mock("./session", () => ({
  getFamilyUser: async () => signedIn.user,
  localeCookieOptions: () => ({ path: "/" }),
  takePendingLink: async () => null,
}));

// The language route sets a cookie; outside a request there is no cookie jar, so record what it sets.
const setCookies: Array<{ name: string; value: string }> = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => void setCookies.push({ name, value }), get: () => undefined }),
}));

const { handleLanguage, handleUpload, isSameOriginRequest, readBodyWithin, safeNextPath, withLang } = await import("./routes");
const { getHousehold } = await import("@/server/households");
const { MAX_UPLOAD_BYTES } = await import("@/server/storage");

const ORIGIN = "http://localhost:3000";

describe("safeNextPath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNextPath("/v/abc?lang=es")).toBe("/v/abc?lang=es");
    expect(safeNextPath("/family")).toBe("/family");
  });

  it("refuses anything that could leave the app", () => {
    for (const bad of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "", "x/y", "/a\nb", "/" + "a".repeat(2001), 42, null]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
  });

  it("normalizes dot segments without escaping the origin", () => {
    expect(safeNextPath("/a/../../family")).toBe("/family");
  });
});

describe("withLang", () => {
  it("sets lang for Spanish and removes it for English", () => {
    expect(withLang("/v/x/people?edit=m1", "es")).toBe("/v/x/people?edit=m1&lang=es");
    expect(withLang("/v/x?lang=es", "en")).toBe("/v/x");
    expect(withLang("/v/x?lang=es", "es")).toBe("/v/x?lang=es");
  });
});

describe("isSameOriginRequest", () => {
  const req = (origin: string | null) => new NextRequest(`${ORIGIN}/family/upload`, { method: "POST", headers: origin ? { origin } : {} });
  it("accepts only our own origin", () => {
    expect(isSameOriginRequest(req(ORIGIN))).toBe(true);
    expect(isSameOriginRequest(req("https://partner.example"))).toBe(false);
    expect(isSameOriginRequest(req("null"))).toBe(false);
    expect(isSameOriginRequest(req(null))).toBe(false);
  });
});

describe("POST /family/upload (handleUpload)", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());

  let base: string;
  let verificationId: string;
  let owner: User;

  beforeEach(async () => {
    const sgo = await makeTestSgo();
    const family = await makeTestFamily();
    const created = await startedVerification(sgo, family);
    base = `/v/${created.familyToken}`;
    verificationId = created.verification.id;
    owner = { id: family.userId, email: family.email } as User;
    signedIn.user = owner;
  });

  function upload(fields: Record<string, string | Blob>, opts: { origin?: string | null; lang?: string; contentLength?: string } = {}) {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const headers: Record<string, string> = {};
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.contentLength) headers["content-length"] = opts.contentLength;
    return handleUpload(new NextRequest(`${ORIGIN}/family/upload?lang=${opts.lang ?? "en"}`, { method: "POST", body, headers }));
  }

  const pdf = () => new File([syntheticFixture("SYNTHETIC_tf0001_snap_approved.pdf") as BlobPart], "snap.pdf", { type: "application/pdf" });

  it("stores a document and reports a second copy of the same file as a duplicate", async () => {
    const first = await upload({ base, v: verificationId, lang: "en", kind: "award_letter", file: pdf() });
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body).toMatchObject({ ok: true, data: { duplicate: false, filename: "snap.pdf" } });
    expect(first.headers.get("cache-control")).toBe("no-store");
    const again = await upload({ base, v: verificationId, lang: "en", kind: "award_letter", file: pdf() });
    expect(again.status).toBe(200);
    expect((await again.json()).data.duplicate).toBe(true);
  });

  it("refuses requests from another site", async () => {
    const res = await upload({ base, v: verificationId, lang: "en", kind: "award_letter", file: pdf() }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: { code: "forbidden", message: en.errors.forbidden } });
  });

  it("asks to sign in again when nobody is signed in", async () => {
    signedIn.user = null;
    const res = await upload({ base, v: verificationId, lang: "es", kind: "award_letter", file: pdf() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe(es.errors.signInAgain);
  });

  it("needs a known document kind and a file, with messages in the family's language", async () => {
    const noKind = await upload({ base, v: verificationId, lang: "es", file: pdf() });
    expect(noKind.status).toBe(422);
    expect((await noKind.json()).error.message).toBe(es.errors.files.chooseKind);
    const badKind = await upload({ base, v: verificationId, lang: "en", kind: "unknown", file: pdf() });
    expect(badKind.status).toBe(422);
    const noFile = await upload({ base, v: verificationId, lang: "en", kind: "w2" });
    expect((await noFile.json()).error.message).toBe(en.errors.files.empty);
  });

  it("rejects a file that is not what it claims to be", async () => {
    const fake = new File(["MZ this is not a pdf"], "letter.pdf", { type: "application/pdf" });
    const res = await upload({ base, v: verificationId, lang: "en", kind: "award_letter", file: fake });
    expect(res.status).toBe(422);
    expect((await res.json()).ok).toBe(false);
  });

  it("refuses an oversized request before reading it", async () => {
    const res = await upload({ base, v: verificationId, lang: "en", kind: "w2", file: pdf() }, { contentLength: String(200 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe(en.errors.files.tooLarge);
  });

  it("refuses an oversized body sent without a Content-Length (chunked), without buffering all of it", async () => {
    let pulled = 0;
    let canceled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });
    const req = new NextRequest(`${ORIGIN}/family/upload?lang=en`, {
      method: "POST",
      body: endless,
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await handleUpload(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.message).toBe(en.errors.files.tooLarge);
    expect(canceled).toBe(true);
    expect(pulled).toBeLessThan(MAX_UPLOAD_BYTES + 4 * 1024 * 1024);
  });

  it("refuses a forged flow address or verification id", async () => {
    expect((await upload({ base: "//evil.example/x", v: verificationId, kind: "w2", file: pdf() })).status).toBe(404);
    expect((await upload({ base, v: "../etc", kind: "w2", file: pdf() })).status).toBe(404);
  });

  it("never lets another household add documents to this verification", async () => {
    const stranger = await makeTestFamily("stranger@example.com");
    signedIn.user = { id: stranger.userId, email: stranger.email } as User;
    const res = await upload({ base, v: verificationId, lang: "en", kind: "award_letter", file: pdf() });
    expect([403, 404]).toContain(res.status);
  });
});

describe("readBodyWithin", () => {
  const streamOf = (...parts: number[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const n of parts) controller.enqueue(new Uint8Array(n).fill(7));
        controller.close();
      },
    });

  it("returns the whole body when it fits, exactly at the limit included", async () => {
    expect((await readBodyWithin({ body: streamOf(3, 4) }, 7))?.byteLength).toBe(7);
    expect(await readBodyWithin({ body: null }, 7)).toEqual(new Uint8Array(0));
  });

  it("stops one byte past the limit", async () => {
    expect(await readBodyWithin({ body: streamOf(3, 5) }, 7)).toBeNull();
  });
});

describe("GET /family/language (handleLanguage)", () => {
  useTestDb();

  let owner: User;
  let householdId: string;

  beforeEach(async () => {
    const family = await makeTestFamily();
    owner = { id: family.userId, email: family.email } as User;
    householdId = family.householdId;
    signedIn.user = owner;
    setCookies.length = 0;
  });

  const switchTo = (to: string, next: string, fetchSite: string | null, surface: "page" | "embed" = "page") =>
    handleLanguage(new NextRequest(`${ORIGIN}/family/language?${new URLSearchParams({ to, next })}`, { headers: fetchSite ? { "sec-fetch-site": fetchSite } : {} }), surface);

  it("saves the choice on the household when the switch was clicked on our own page", async () => {
    const res = await switchTo("es", "/family", "same-origin");
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/family?lang=es");
    expect((await getHousehold(householdId, { userId: owner.id })).locale).toBe("es");
  });

  it("never changes the household from another site, or when the browser does not say where the request came from", async () => {
    for (const site of ["cross-site", "same-site", "none", null]) {
      const res = await switchTo("es", "/family", site);
      expect(res.status).toBe(303);
      expect((await getHousehold(householdId, { userId: owner.id })).locale, String(site)).toBe("en");
    }
    // The device's own remembered choice is still set (it only affects this browser).
    expect(setCookies.some((c) => c.value === "es")).toBe(true);
  });

  it("keeps the embedded flow inside /embed", async () => {
    const res = await switchTo("es", "/family", "same-origin", "embed");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
  });
});
