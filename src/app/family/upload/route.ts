import type { NextRequest } from "next/server";
import { handleUpload } from "@/features/intake/server/routes";

export const dynamic = "force-dynamic";

/** POST /family/upload — one family document per request (multipart), from the page or the embedded flow. */
export async function POST(request: NextRequest) {
  return handleUpload(request);
}
