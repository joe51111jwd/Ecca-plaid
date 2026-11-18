import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkBrandColor,
  checkWebUrl,
  contrastWithWhite,
  darkenForWhiteText,
  isAllowedOrigin,
  isAllowedReturnUrl,
  isVendorType,
  MIN_BRAND_CONTRAST_RATIO,
  normalizeOrigin,
  normalizeOriginList,
  relativeLuminance,
  VENDOR_TYPES,
  vendorTypeLabel,
} from "./validation";

// Synthetic origins only: *.example is reserved for documentation (RFC 2606).
const profile = { allowedOrigins: ["https://camp.example", "https://booking.camp.example:8443", "http://localhost:3100"] };

afterEach(() => vi.unstubAllEnvs());

describe("vendor types", () => {
  it("accepts exactly the schema union", () => {
    expect(VENDOR_TYPES).toEqual(["summer_camp", "private_school", "microschool", "tutoring", "after_school", "other"]);
    for (const t of VENDOR_TYPES) {
      expect(isVendorType(t)).toBe(true);
      expect(vendorTypeLabel(t).length).toBeGreaterThan(0);
    }
    for (const bad of ["", "Summer_Camp", "camp", "toString", "__proto__", "hasOwnProperty", null, undefined, 1, {}]) expect(isVendorType(bad)).toBe(false);
  });
});

describe("normalizeOrigin", () => {
  it.each([
    ["https://camp.example", "https://camp.example"],
    ["  https://camp.example  ", "https://camp.example"],
    ["https://camp.example\n", "https://camp.example"],
    ["https://camp.example/", "https://camp.example"],
    ["HTTPS://CAMP.Example", "https://camp.example"],
    ["https://camp.example:443", "https://camp.example"],
    ["https://camp.example:8443", "https://camp.example:8443"],
    ["https://www.sub.camp.example", "https://www.sub.camp.example"],
    ["https://exämple.example", "https://xn--exmple-cua.example"],
    ["https://xn--exmple-cua.example", "https://xn--exmple-cua.example"],
    ["https://camp.xn--p1ai", "https://camp.xn--p1ai"],
    ["http://localhost", "http://localhost"],
    ["http://localhost:3100", "http://localhost:3100"],
    ["https://localhost:3100", "https://localhost:3100"],
  ])("accepts %s → %s", (raw, expected) => {
    expect(normalizeOrigin(raw)).toEqual({ ok: true, origin: expected });
  });

  it.each([
    ["http://camp.example", /must use https/],
    ["https://*.camp.example", /wildcards/],
    ["*", /wildcards/],
    ["https://camp.example/booking", /no path/],
    ["https://camp.example/?x=1", /no path/],
    ["https://camp.example#frag", /no path/],
    ["https://camp.example//", /not an origin|no path/],
    ["https://user@camp.example", /not an origin/],
    ["https://user:pw@camp.example", /not an origin/],
    ["https://camp.example\\@evil.example", /not an origin/],
    ["https://ex%61mple.example", /not an origin/],
    ["https://camp.example.", /valid domain/],
    ["https://camp", /valid domain/],
    ["https://-camp.example", /valid domain/],
    ["https://camp_site.example", /valid domain/],
    ["https://203.0.113.5", /IP address/],
    ["https://[2001:db8::1]", /IP address/],
    ["https://camp.example:0", /port 0/],
    ["https://camp.example:99999", /not a valid origin/],
    ["camp.example", /not an origin/],
    ["//camp.example", /not an origin/],
    ["ftp://camp.example", /not an origin/],
    ["javascript://camp.example", /not an origin/],
    ["https:// camp.example", /not an origin/],
    ["https://camp\t.example", /not an origin/],
    ["", /not an origin/],
    ["null", /not an origin/],
  ])("rejects %j", (raw, reason) => {
    const r = normalizeOrigin(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 42, {}, ["https://camp.example"]]) expect(normalizeOrigin(v).ok).toBe(false);
  });

  it("refuses localhost in production, and still refuses plain http elsewhere", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(normalizeOrigin("http://localhost:3100")).toMatchObject({ ok: false, reason: expect.stringMatching(/development and test/) });
    expect(normalizeOrigin("https://localhost")).toMatchObject({ ok: false });
    expect(normalizeOrigin("http://camp.example").ok).toBe(false);
    expect(normalizeOrigin("https://camp.example")).toEqual({ ok: true, origin: "https://camp.example" });
  });

  it("normalizes a list, collapsing duplicates and reporting errors by index", () => {
    expect(normalizeOriginList(["https://camp.example", "HTTPS://camp.example/", "https://camp.example:443", "https://b.example"])).toEqual({
      ok: true,
      origins: ["https://camp.example", "https://b.example"],
    });
    const bad = normalizeOriginList(["https://camp.example", "https://*.x.example", "http://camp.example"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(["1", "2"]);
    expect(normalizeOriginList([])).toEqual({ ok: true, origins: [] });
  });
});

describe("isAllowedOrigin", () => {
  it.each([
    ["https://camp.example", true],
    ["https://booking.camp.example:8443", true],
    ["http://localhost:3100", true],
    // Different scheme, port or host never match.
    ["http://camp.example", false],
    ["https://camp.example:8443", false],
    ["https://booking.camp.example", false],
    ["http://localhost:3000", false],
    ["https://localhost:3100", false],
    ["https://www.camp.example", false],
    ["https://camp.example.evil.example", false],
    ["https://evilcamp.example", false],
    // Crafted, non-canonical or junk values.
    ["https://camp.example/", false],
    ["https://camp.example\n", false],
    [" https://camp.example", false],
    ["HTTPS://CAMP.EXAMPLE", false],
    ["https://camp.example/path", false],
    ["https://user@camp.example", false],
    ["null", false],
    ["", false],
    ["*", false],
  ])("%j → %s", (origin, expected) => {
    expect(isAllowedOrigin(profile, origin)).toBe(expected);
  });

  it("matches internationalized names only in their punycode form, and lookalikes never match", () => {
    const idn = { allowedOrigins: ["https://exämple.example"] };
    expect(isAllowedOrigin(idn, "https://xn--exmple-cua.example")).toBe(true);
    // Cyrillic "а" (U+0430) looks like Latin "a" but is a different host.
    expect(isAllowedOrigin({ allowedOrigins: ["https://camp.example"] }, "https://cаmp.example")).toBe(false);
    expect(isAllowedOrigin({ allowedOrigins: ["https://camp.example"] }, new URL("https://cаmp.example").origin)).toBe(false);
  });

  it("handles missing or empty lists and non-string candidates", () => {
    expect(isAllowedOrigin({ allowedOrigins: [] }, "https://camp.example")).toBe(false);
    expect(isAllowedOrigin({ allowedOrigins: null }, "https://camp.example")).toBe(false);
    expect(isAllowedOrigin(profile, null)).toBe(false);
    expect(isAllowedOrigin(profile, undefined)).toBe(false);
  });

  it("ignores stored entries that are not valid in the current environment", () => {
    expect(isAllowedOrigin({ allowedOrigins: ["https://*.camp.example", "http://camp.example"] }, "http://camp.example")).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowedOrigin(profile, "http://localhost:3100")).toBe(false);
    expect(isAllowedOrigin(profile, "https://camp.example")).toBe(true);
  });
});

describe("isAllowedReturnUrl", () => {
  it.each([
    ["https://camp.example", true],
    ["https://camp.example/", true],
    ["https://camp.example/booking/123?session=2#done", true],
    ["https://CAMP.example/booking", true],
    ["https://camp.example:443/booking", true],
    ["https://booking.camp.example:8443/checkout", true],
    ["http://localhost:3100/return", true],
    // Open-redirect attempts.
    ["https://camp.example.evil.example/booking", false],
    ["https://evil.example/https://camp.example", false],
    ["https://evil.example/?next=https://camp.example", false],
    ["https://camp.example@evil.example/", false],
    ["https://camp.example:443@evil.example/", false],
    ["https://user:pw@camp.example/", false],
    ["https://user@camp.example/", false],
    ["https://camp.example\\@evil.example/", false],
    ["https://evil.example\\.camp.example/", false],
    ["https://camp.example%2F@evil.example/", false],
    ["https://camp.exam%70le/", false],
    ["//camp.example/booking", false],
    ["/booking", false],
    ["camp.example/booking", false],
    ["javascript:alert(1)//https://camp.example", false],
    ["data:text/html,https://camp.example", false],
    ["http://camp.example/booking", false],
    ["https://camp.example:8443/booking", false],
    ["https://cаmp.example/", false],
    ["https://xn--cmp-8cd.example/", false],
    ["https://camp.exa\nmple/", false],
    ["https://camp.exa\tmple/", false],
    [" https://camp.example/", false],
    ["https://camp.example/ booking", false],
    ["", false],
  ])("%j → %s", (url, expected) => {
    expect(isAllowedReturnUrl(profile, url)).toBe(expected);
  });

  it("rejects overlong URLs and non-strings", () => {
    expect(isAllowedReturnUrl(profile, `https://camp.example/${"a".repeat(2100)}`)).toBe(false);
    expect(isAllowedReturnUrl(profile, null)).toBe(false);
    expect(isAllowedReturnUrl(profile, undefined)).toBe(false);
  });

  it("allows an internationalized host that was listed", () => {
    expect(isAllowedReturnUrl({ allowedOrigins: ["https://exämple.example"] }, "https://exämple.example/return")).toBe(true);
    expect(isAllowedReturnUrl({ allowedOrigins: ["https://exämple.example"] }, "https://xn--exmple-cua.example/return")).toBe(true);
  });

  it("never allows localhost in production even when listed", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isAllowedReturnUrl(profile, "http://localhost:3100/return")).toBe(false);
  });
});

describe("brand color contrast", () => {
  it("computes WCAG luminance and contrast against white", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 6);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 6);
    // The classic AA boundary: #767676 passes (≈4.54), #777777 fails (≈4.48).
    expect(contrastWithWhite("#767676")).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST_RATIO);
    expect(contrastWithWhite("#777777")).toBeLessThan(MIN_BRAND_CONTRAST_RATIO);
    expect(() => relativeLuminance("red")).toThrow();
  });

  it.each(["#1F4E79", "#000000", "#767676", "#b00020", "#0B5394"])("accepts readable %s", (c) => {
    const r = checkBrandColor(c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.color).toBe(c.toUpperCase());
  });

  it.each(["#FFFFFF", "#FFFF00", "#777777", "#87CEEB", "#00FF00"])("rejects unreadable %s with a darker suggestion", (c) => {
    const r = checkBrandColor(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/hard to read/);
      expect(r.reason).toMatch(/4\.5:1/);
      const suggestion = /such as (#[0-9A-F]{6})/.exec(r.reason)?.[1];
      expect(suggestion).toBeDefined();
      expect(contrastWithWhite(suggestion!)).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST_RATIO);
      expect(checkBrandColor(suggestion).ok).toBe(true);
    }
  });

  it.each(["#FFF", "1F4E79", "#1F4E7", "#1F4E790", "#GGGGGG", "rgb(0,0,0)", "navy", "", " # 1F4E79", null, 0x1f4e79])("rejects malformed %j", (c) => {
    const r = checkBrandColor(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/six hex digits/);
  });

  it("suggests the lightest same-hue shade that passes", () => {
    const s = darkenForWhiteText("#87CEEB");
    expect(contrastWithWhite(s)).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST_RATIO);
    expect(darkenForWhiteText("#1F4E79")).toBe("#1F4E79");
    expect(darkenForWhiteText("#FFFFFF")).toMatch(/^#([0-9A-F]{2})\1\1$/);
  });
});

describe("checkWebUrl", () => {
  it("accepts https logos and http or https websites", () => {
    expect(checkWebUrl("https://cdn.camp.example/logo.png", { httpsOnly: true, label: "Logo" })).toEqual({ ok: true, url: "https://cdn.camp.example/logo.png" });
    expect(checkWebUrl("camp.example", { httpsOnly: false, label: "Website" })).toEqual({ ok: true, url: "https://camp.example/" });
    expect(checkWebUrl("http://camp.example", { httpsOnly: false, label: "Website" })).toEqual({ ok: true, url: "http://camp.example/" });
  });

  it.each([
    "http://cdn.camp.example/logo.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "//cdn.camp.example/logo.png",
    "https://user@cdn.camp.example/logo.png",
    "https://203.0.113.5/logo.png",
    "https://localhost/logo.png",
    "https://cdn.camp.example/lo go.png",
    "https://cdn.camp.example\\logo.png",
    "",
  ])("rejects logo %j", (v) => {
    expect(checkWebUrl(v, { httpsOnly: true, label: "Logo" }).ok).toBe(false);
  });

  it("explains the https requirement for logos", () => {
    const r = checkWebUrl("http://cdn.camp.example/logo.png", { httpsOnly: true, label: "Logo" });
    expect(r).toEqual({ ok: false, reason: "The logo address must start with https://." });
    expect(checkWebUrl(`https://camp.example/${"a".repeat(600)}`, { httpsOnly: false, label: "Website" })).toMatchObject({ ok: false, reason: expect.stringMatching(/at most 500/) });
  });
});
