import type { VendorType } from "@/db/schema";

/**
 * Pure validators for business profiles: vendor types, embed origins and return URLs, brand colors, hold windows.
 * No database access, so the embed route and redirects can call them on every request.
 */

/* ------------------------------------------------------------------------------------- vendor types */

// A record rather than an array so that adding a vendor type to the schema fails to compile until it is listed here.
const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  summer_camp: "Summer camp",
  private_school: "Private school",
  microschool: "Microschool",
  tutoring: "Tutoring",
  after_school: "After-school program",
  other: "Other",
};

/**
 * Kinds of establishment that can install the handoff. Kept configurable because the proposed rules do not yet
 * settle which providers and expenses qualify (a summer camp may or may not be a qualifying use in the final rules).
 */
export const VENDOR_TYPES = Object.keys(VENDOR_TYPE_LABELS) as VendorType[];

export function isVendorType(value: unknown): value is VendorType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(VENDOR_TYPE_LABELS, value);
}

export function vendorTypeLabel(type: VendorType): string {
  return VENDOR_TYPE_LABELS[type];
}

/* --------------------------------------------------------------------------------------- hold window */

/** Accepted range for how long a reservation is held while verification or an award is pending (1 hour to 30 days). */
export const HOLD_WINDOW_HOURS = { min: 1, max: 720 } as const;

/* ------------------------------------------------------------------------------------------- origins */

function inProduction(): boolean {
  // Read straight from process.env, like src/server/settings: a cached env() must never relax a production rule.
  return process.env.NODE_ENV === "production";
}

/** POLICY: how many embed origins one business may list. Sources are silent; a camp has a site or two, not dozens. */
export const MAX_ALLOWED_ORIGINS = 20;
/** POLICY: longest return URL accepted. Matches what browsers and proxies handle reliably. */
export const MAX_RETURN_URL_LENGTH = 2048;

/** Host names that are only ever allowed outside production, and only over plain http. */
const DEV_LOOPBACK_HOST = "localhost";

/*
 * Scheme, "://", a host with an optional port, at most one trailing slash. Everything that could smuggle a different
 * host past a naive comparison is rejected before the URL parser sees it: userinfo ("@"), backslashes (which WHATWG
 * parsers read as "/"), percent-escapes in the host, wildcards, whitespace and control characters.
 */
const ORIGIN_SHAPE = /^(https?):\/\/([^/?#@\\%*\s\u0000-\u001f\u007f]+)\/?$/i;
/** DNS name in ASCII (punycode) form: at least two labels, no leading/trailing hyphens, alphabetic or IDN top-level label. */
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export type OriginCheck = { ok: true; origin: string } | { ok: false; reason: string };

/**
 * Validates one embed origin as a business typed it and returns its canonical form (lower-case scheme and host,
 * internationalized names in punycode, default port dropped), which is exactly what browsers send in `Origin`.
 *
 * Rules: https only, except `http://localhost[:port]` outside production. No wildcards, paths, queries, fragments,
 * credentials or IP addresses.
 */
export function normalizeOrigin(raw: unknown): OriginCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Enter an origin such as https://camp.example.org." };
  const value = raw.trim();
  if (value.includes("*")) return { ok: false, reason: `"${value}": wildcards are not allowed. List each origin exactly, for example https://www.camp.example.org.` };
  const shape = ORIGIN_SHAPE.exec(value);
  if (!shape) {
    if (/^https?:\/\/[^/]+\/./i.test(value) || /[?#]/.test(value)) {
      return { ok: false, reason: `"${value}": enter only the scheme and host (and port, if any), with no path, query or fragment.` };
    }
    return { ok: false, reason: `"${value}" is not an origin. Use the form https://camp.example.org (scheme and host only).` };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `"${value}" is not a valid origin.` };
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return { ok: false, reason: `"${value}": enter only the scheme and host (and port, if any).` };
  }
  if (url.port === "0") return { ok: false, reason: `"${value}": port 0 is not a valid port.` };

  const host = url.hostname;
  if (host === DEV_LOOPBACK_HOST) {
    if (inProduction()) return { ok: false, reason: `"${value}": localhost origins are only allowed in development and test.` };
    return { ok: true, origin: url.origin };
  }
  if (url.protocol !== "https:") return { ok: false, reason: `"${value}" must use https (http is only allowed for http://localhost in development).` };
  if (host.startsWith("[") || /^[0-9.]+$/.test(host)) return { ok: false, reason: `"${value}": use the site's domain name, not an IP address.` };
  if (!DNS_NAME.test(host)) return { ok: false, reason: `"${value}" does not have a valid domain name.` };
  return { ok: true, origin: url.origin };
}

/**
 * Validates and canonicalizes a list of origins. Duplicates (after canonicalization) are collapsed; order is kept.
 * Returns per-entry errors keyed by index so a form can point at the bad line.
 */
export function normalizeOriginList(raw: readonly unknown[]): { ok: true; origins: string[] } | { ok: false; errors: Record<number, string> } {
  const errors: Record<number, string> = {};
  const origins: string[] = [];
  raw.forEach((entry, i) => {
    const r = normalizeOrigin(entry);
    if (!r.ok) errors[i] = r.reason;
    else if (!origins.includes(r.origin)) origins.push(r.origin);
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, origins };
}

/**
 * The stored list as it applies right now. Entries are re-validated on every read so a value that is no longer
 * acceptable (an http://localhost entry copied into production, a row edited by hand) never grants access.
 */
function effectiveOrigins(profile: { allowedOrigins: readonly string[] | null | undefined }): Set<string> {
  const out = new Set<string>();
  for (const entry of profile.allowedOrigins ?? []) {
    const r = normalizeOrigin(entry);
    if (r.ok) out.add(r.origin);
  }
  return out;
}

/**
 * Is `origin` (an `Origin` request header, or the origin of an embedding page) one the business allowed?
 * Exact match on scheme, host and port. "null", malformed values and anything with a path never match.
 */
export function isAllowedOrigin(profile: { allowedOrigins: readonly string[] | null | undefined }, origin: string | null | undefined): boolean {
  if (typeof origin !== "string" || origin.length === 0 || origin.length > MAX_RETURN_URL_LENGTH) return false;
  const r = normalizeOrigin(origin);
  if (!r.ok) return false;
  // Browsers always send Origin in canonical form, so a non-canonical candidate was crafted by hand: refuse it.
  if (r.origin !== origin) return false;
  return effectiveOrigins(profile).has(r.origin);
}

/**
 * May we send the family's browser to `url`? Only an absolute http(s) URL whose origin exactly equals one of the
 * business's allowed origins. Rejects credentials in the URL, backslashes, control characters and whitespace, so
 * tricks such as `https://allowed.example.evil.com`, `https://allowed.example@evil.com`,
 * `https://allowed.example\@evil.com` and protocol-relative `//evil.com` never pass.
 */
export function isAllowedReturnUrl(profile: { allowedOrigins: readonly string[] | null | undefined }, url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_RETURN_URL_LENGTH) return false;
  if (/[\s\\\u0000-\u001f\u007f]/.test(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  const authority = /^https?:\/\/([^/?#]*)/i.exec(url)?.[1] ?? "";
  if (authority.includes("@") || authority.includes("%")) return false;
  const r = normalizeOrigin(parsed.origin);
  if (!r.ok) return false;
  return effectiveOrigins(profile).has(r.origin);
}

/* ------------------------------------------------------------------------------------------ branding */

/**
 * POLICY: minimum contrast between the brand color and white button text. 4.5:1 is the WCAG 2.x level AA minimum
 * for normal-size text; buttons in the embed use normal-size white text on the brand color.
 */
export const MIN_BRAND_CONTRAST_RATIO = 4.5;

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgbOf(hex: string): [number, number, number] | null {
  const m = HEX_COLOR.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function luminanceOf([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG relative luminance of a #RRGGBB color (0 = black, 1 = white). Throws for anything else. */
export function relativeLuminance(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) throw new Error(`Not a #RRGGBB color: ${hex}`);
  return luminanceOf(rgb);
}

/** WCAG contrast ratio of white text on the given #RRGGBB background (1 to 21). */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * The lightest shade of the same hue (each channel scaled down by the same factor) that reaches the minimum
 * contrast with white text. Offered in the error message so the business does not have to guess.
 */
export function darkenForWhiteText(hex: string, minRatio = MIN_BRAND_CONTRAST_RATIO): string {
  const rgb = rgbOf(hex);
  if (!rgb) throw new Error(`Not a #RRGGBB color: ${hex}`);
  if (1.05 / (luminanceOf(rgb) + 0.05) >= minRatio) return toHex(rgb);
  for (let pct = 99; pct >= 0; pct--) {
    const shade = rgb.map((v) => Math.floor((v * pct) / 100)) as [number, number, number];
    if (1.05 / (luminanceOf(shade) + 0.05) >= minRatio) return toHex(shade);
  }
  return "#000000";
}

export type BrandColorCheck = { ok: true; color: string; contrast: number } | { ok: false; reason: string };

/** Validates a brand color: exactly #RRGGBB, readable under white text. Returns it upper-cased. */
export function checkBrandColor(raw: unknown): BrandColorCheck {
  if (typeof raw !== "string" || !HEX_COLOR.test(raw.trim())) {
    return { ok: false, reason: "Enter the brand color as # followed by six hex digits, for example #1F4E79." };
  }
  const color = raw.trim().toUpperCase();
  const contrast = contrastWithWhite(color);
  if (contrast < MIN_BRAND_CONTRAST_RATIO) {
    const suggestion = darkenForWhiteText(color);
    return {
      ok: false,
      reason:
        `White text on ${color} is hard to read (contrast ${contrast.toFixed(2)}:1; at least ${MIN_BRAND_CONTRAST_RATIO}:1 is needed). ` +
        `Buttons in the booking flow use white text on your brand color. Try a darker shade such as ${suggestion}.`,
    };
  }
  return { ok: true, color, contrast };
}

/* --------------------------------------------------------------------------------------------- URLs */

/** POLICY: longest website or logo address accepted (same bound the SGO profile uses). */
export const MAX_WEB_URL_LENGTH = 500;

/**
 * Validates a website or logo address. `https` only for logos (they render inside other sites' pages, where mixed
 * content is blocked); websites may also be http. No credentials, no IP addresses, valid DNS name. A bare host such
 * as "camp.example.org" is read as https.
 */
export function checkWebUrl(raw: unknown, opts: { httpsOnly: boolean; label: string }): { ok: true; url: string } | { ok: false; reason: string } {
  const bad = { ok: false as const, reason: `Enter a valid ${opts.httpsOnly ? "https " : ""}web address for the ${opts.label.toLowerCase()}.` };
  if (typeof raw !== "string") return bad;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_WEB_URL_LENGTH) return value.length === 0 ? bad : { ok: false, reason: `${opts.label}: use at most ${MAX_WEB_URL_LENGTH} characters.` };
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) return bad;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!hasScheme && value.startsWith("//")) return bad;
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return bad;
  }
  const okProtocol = url.protocol === "https:" || (!opts.httpsOnly && url.protocol === "http:");
  if (!okProtocol) return { ok: false, reason: opts.httpsOnly ? `The ${opts.label.toLowerCase()} address must start with https://.` : bad.reason };
  if (url.username || url.password || !DNS_NAME.test(url.hostname)) return bad;
  return { ok: true, url: url.toString() };
}
