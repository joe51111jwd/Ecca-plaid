import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, getPrimaryOrg } from "@/server/auth";
import { SGO_ORG_COOKIE, SGO_PREFERENCE_COOKIE_MAX_AGE_S } from "@/features/sgo/policy";
import { env, isProd } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /sgo/switch/{orgId}: the org switcher. Stores which of the person's own SGOs is on screen; an organization
 * they do not belong to is refused with 404. A view preference only: every page re-checks the membership.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }): Promise<Response> {
  const { orgId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent("/sgo")}`);
  const chosen = await getPrimaryOrg(user, "sgo", { orgId }).catch(() => null);
  if (!chosen) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  (await cookies()).set(SGO_ORG_COOKIE, chosen.org.id, { httpOnly: true, sameSite: "lax", secure: isProd() || env().APP_URL.startsWith("https://"), path: "/sgo", maxAge: SGO_PREFERENCE_COOKIE_MAX_AGE_S });
  redirect("/sgo");
}
