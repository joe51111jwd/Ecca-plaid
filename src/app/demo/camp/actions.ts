"use server";

import { refresh } from "next/cache";
import { ensureDemoCamp } from "@/features/handoff/server/demo";
import type { PortalActionState } from "@/features/handoff/types";
import { actionError } from "@/lib/errors";

/**
 * Sets up (or repairs) the demo camp's synthetic data. No sign-in: the demo exists only outside production
 * (demoEnabled), creates only the fixed, obviously fictional organizations, and is idempotent.
 */
export async function setupDemoAction(): Promise<PortalActionState> {
  try {
    await ensureDemoCamp();
  } catch (e) {
    return actionError(e);
  }
  refresh();
  return { ok: true, data: { message: "The demo camp is ready." } };
}
