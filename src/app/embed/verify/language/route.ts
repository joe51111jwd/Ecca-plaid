import type { NextRequest } from "next/server";
import { handleLanguage } from "@/features/intake/server/routes";

export const dynamic = "force-dynamic";

/** GET /embed/verify/language?to=es&next=/embed/verify/… — the language switch inside a partner's frame. */
export async function GET(request: NextRequest) {
  return handleLanguage(request, "embed");
}
