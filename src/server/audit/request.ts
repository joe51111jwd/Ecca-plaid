import { isIP } from "node:net";

export interface AuditRequestInfo {
  ip?: string | null;
  userAgent?: string | null;
}

/** Anything with a `get(name)` like `Request.headers` or the result of `await headers()` from next/headers. */
export interface HeaderReader {
  get(name: string): string | null;
}

export const MAX_USER_AGENT_LENGTH = 512;

/** Accepts "203.0.113.7", "203.0.113.7:4711", "[2001:db8::1]:443", "::ffff:203.0.113.7". Returns null for anything else. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let candidate = raw.trim();
  if (candidate.length === 0 || candidate.length > 100) return null;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(candidate);
  if (bracketed) candidate = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  // An IPv4 client seen through a dual-stack proxy is the same client as its plain IPv4 form.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(candidate);
  if (mapped) candidate = mapped[1];
  return isIP(candidate) === 0 ? null : candidate.toLowerCase();
}

/**
 * Client address and user agent for audit entries and rate-limit keys.
 *
 * The address is the first hop of `x-forwarded-for` (what the edge proxy saw as the client), falling back to
 * `x-real-ip`. It is only as trustworthy as the proxy in front of the app: behind a platform edge that
 * overwrites the header it is the real client; with no proxy a caller can set it, so treat it as a hint.
 */
export function requestInfoFromHeaders(headers: HeaderReader): { ip: string | null; userAgent: string | null } {
  const forwarded = headers.get("x-forwarded-for");
  const ip = normalizeIp(forwarded?.split(",")[0]) ?? normalizeIp(headers.get("x-real-ip"));
  return { ip, userAgent: cleanUserAgent(headers.get("user-agent")) };
}

export function cleanUserAgent(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > MAX_USER_AGENT_LENGTH ? cleaned.slice(0, MAX_USER_AGENT_LENGTH) : cleaned;
}
