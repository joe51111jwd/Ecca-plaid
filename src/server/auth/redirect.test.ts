import { describe, expect, it } from "vitest";
import { sanitizeRedirect } from "./redirect";

describe("sanitizeRedirect", () => {
  it.each([
    ["/", "/"],
    ["/family", "/family"],
    ["/ok?x=1", "/ok?x=1"],
    ["/v/abc?step=2#consent", "/v/abc?step=2#consent"],
    ["/a/../b", "/b"],
    ["/sgo/verifications?status=needs_review&page=2", "/sgo/verifications?status=needs_review&page=2"],
    ["/caf%C3%A9", "/caf%C3%A9"],
  ])("accepts %j", (input, expected) => {
    expect(sanitizeRedirect(input)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "http://localhost:3000/family",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    "/ /evil.com",
    "/\u0000",
    "/x y",
    "/%2f%2fevil.com",
    "/%2F/evil.com",
    "/%5cevil.com",
    "evil.com",
    "family",
    "?next=/x",
    "#frag",
    "",
    "/" + "a".repeat(2048),
    "/auth/callback?token=x",
    "/AUTH/callback",
    "/sign-out",
    "/sign-in?next=/x",
    "/sign-in",
    // Dot segments that normalise into a protocol-relative URL (regression: these used to come out as "//evil.com").
    "/a/..//evil.com",
    "/.//evil.com",
    "/%2e%2e//evil.com",
    "/a/%2e%2e//evil.com",
    "/x/../%2fevil.com",
    "/a/..//evil.com/path?x=1",
    // Percent-encoded blocked segments.
    "/%61uth/callback?token=x",
    "/sign%2Dout",
  ])("rejects %j", (input) => {
    expect(sanitizeRedirect(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    for (const v of [undefined, null, 1, {}, ["/x"], true]) expect(sanitizeRedirect(v)).toBeNull();
  });

  it("does not block paths that merely start with the same letters", () => {
    expect(sanitizeRedirect("/authors")).toBe("/authors");
    expect(sanitizeRedirect("/sign-ins-report")).toBe("/sign-ins-report");
  });
});
