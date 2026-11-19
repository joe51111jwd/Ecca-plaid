import type { NextRequest } from "next/server";
import { handleExport } from "@/features/intake/server/routes";

export const dynamic = "force-dynamic";

/** GET /family/data — download everything held about the household (owner only). */
export async function GET(request: NextRequest) {
  return handleExport(request);
}
