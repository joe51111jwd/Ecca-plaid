import { notFound } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { isSandboxAvailable } from "@/server/payments";

/**
 * The sandbox pages exist only where the sandbox processor may be used. In a production deployment
 * configured for Stripe they answer 404, exactly like a URL that was never there. Every page under /sandbox
 * calls this first; the server actions behind them check the same thing again.
 */
export function assertSandboxPagesEnabled(): void {
  if (!isSandboxAvailable()) notFound();
}

/** Runs a sandbox lookup and turns "not found" (unknown id, wrong key, wrong processor) into the 404 page. */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
}

/** First value of a search param that may be repeated. */
export function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : null;
}

const MAX_RETURN_PATH_LENGTH = 2000;

/**
 * The page a payer continues to after a hosted sandbox payment. Only a path on this site is accepted: the
 * value arrives in the query string, and an absolute or protocol-relative URL there would turn the pay page
 * into an open redirect.
 */
export function safeReturnPath(value: string | null): string | null {
  if (!value || value.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  // Control characters have no place in a path and are a classic way around prefix checks.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}
