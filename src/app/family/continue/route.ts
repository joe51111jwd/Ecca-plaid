import type { NextRequest } from "next/server";
import { handleContinue } from "@/features/intake/server/routes";

export const dynamic = "force-dynamic";

/** GET /family/continue — the sign-in email's destination for a sign-in started from a verification link. */
export async function GET(request: NextRequest) {
  return handleContinue(request);
}
