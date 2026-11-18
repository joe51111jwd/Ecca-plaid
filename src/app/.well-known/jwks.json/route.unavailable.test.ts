import { afterEach, describe, expect, it, vi } from "vitest";

// A deployment whose signing key cannot be loaded (production without EVIDENCE_SIGNING_PRIVATE_KEY).
vi.mock("@/engine/evidence/platform", () => ({
  platformJwks: () => {
    throw new Error("EVIDENCE_SIGNING_PRIVATE_KEY is required in production");
  },
}));

import { GET } from "./route";

describe("GET /.well-known/jwks.json without a usable signing key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 503 with the standard error body, uncached, and says nothing about the cause", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = GET(new Request("http://localhost/.well-known/jwks.json"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as unknown;
    expect(body).toEqual({ error: { code: "not_available", message: "The evidence signing key is not available" } });
    expect(JSON.stringify(body)).not.toContain("EVIDENCE_SIGNING_PRIVATE_KEY");
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
