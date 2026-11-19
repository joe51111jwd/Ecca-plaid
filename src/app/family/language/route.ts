import type { NextRequest } from "next/server";
import { handleLanguage } from "@/features/intake/server/routes";

export const dynamic = "force-dynamic";

/** GET /family/language?to=es&next=/v/… — switch and remember the family's language. */
export async function GET(request: NextRequest) {
  return handleLanguage(request, "page");
}
