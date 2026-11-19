import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { useTestDb } from "../../../tests/helpers/db";
import { setTestNow } from "@/lib/clock";
import { saveCheckout, startCheckout } from "@/server/donations";
import { createListedSgo, jointPatch, singleFilerPatch } from "@/server/donations/test-support";

useTestDb();
it("dump", async () => {
  setTestNow("2026-11-18T15:00:00Z");
  const sgo = await createListedSgo({ portalRegistered: true });
  const { token, view: v0 } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
  const v1 = await saveCheckout(token, singleFilerPatch());
  const v2 = await saveCheckout(token, { designationConfirmed: true });
  const { token: t2 } = await startCheckout({ sgoSlug: sgo.slug, source: "hosted" });
  const j = await saveCheckout(t2, jointPatch());
  writeFileSync("/tmp/claude-0/-home-user-Ecca-plaid/15c61476-42d6-5659-afff-f1e87e379983/scratchpad/work/donor-ui/views.json", JSON.stringify({ v0, v1, v2, j }, null, 1));
});
