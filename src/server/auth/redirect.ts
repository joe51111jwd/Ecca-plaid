/**
 * Post-sign-in redirect targets come from query strings and form fields, i.e. from anyone. Only same-origin
 * relative paths are accepted; everything else (absolute URLs, protocol-relative "//host", backslash tricks
 * that browsers normalise to "//host", control characters, scheme URLs like "javascript:") is rejected.
 */

const MAX_REDIRECT_LENGTH = 2048;
const PROBE_ORIGIN = "http://redirect-probe.invalid";

/** Paths that must never be a post-sign-in destination (they would loop or undo the sign-in). */
const BLOCKED_SEGMENTS = ["/auth", "/sign-out", "/sign-in"] as const;

function isBlocked(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return BLOCKED_SEGMENTS.some((p) => lower === p || lower.startsWith(`${p}/`));
}

/**
 * Returns a normalised same-origin path (`/path?query#hash`) or null when the input is not acceptable.
 *
 *   sanitizeRedirect("/family?x=1")      → "/family?x=1"
 *   sanitizeRedirect("//evil.com")        → null
 *   sanitizeRedirect("/\\evil.com")       → null
 *   sanitizeRedirect("https://evil.com")  → null
 */
export function sanitizeRedirect(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > MAX_REDIRECT_LENGTH) return null;
  if (input[0] !== "/") return null;
  if (input[1] === "/") return null;
  if (input.includes("\\")) return null;
  // Any control character or whitespace: browsers strip tabs/newlines inside URLs, which can turn "/\t/evil" into "//evil".
  if (/[\u0000- \u007f-   ]/.test(input)) return null;
  // Percent-encoded slash/backslash right after the leading slash would decode to "//" or "/\" in some routers.
  if (/^\/%(2f|5c)/i.test(input)) return null;

  let url: URL;
  try {
    url = new URL(input, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  if (isBlocked(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
