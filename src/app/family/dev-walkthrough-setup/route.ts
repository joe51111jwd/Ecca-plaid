// TEMPORARY (family-ui browser walk-through only; deleted before the module is handed over). SYNTHETIC data.
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb, schema } from "@/db/client";
import { isProd } from "@/lib/env";
import { newId } from "@/lib/ids";
import { createSgo, systemActor } from "@/server/sgos";
import { createVerification, getVerificationDetail, listReviewQueue, resolveReview } from "@/server/verifications";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (isProd()) return new NextResponse(null, { status: 404 });
  for (const key of Object.keys(Array.prototype)) Object.defineProperty(Array.prototype, key, { enumerable: false });
  const p = request.nextUrl.searchParams;
  const db = await getDb();
  if (p.get("cmd") === "create") {
    const label = p.get("label") ?? "en";
    const { org } = await createSgo({ name: `Synthetic Lone Star Scholarship Fund ${label.toUpperCase()}`, ownerEmail: `owner-${label}@example.org` }, systemActor("family-ui walkthrough (synthetic)"));
    const [user] = await db.insert(schema.users).values({ id: newId("user"), email: `reviewer-${label}@example.org` }).returning();
    await db.insert(schema.memberships).values({ id: newId("membership"), orgId: org.id, userId: user!.id, role: "reviewer" });
    const created = await createVerification({ orgId: org.id, mode: "test", locale: label === "es" ? "es" : "en", returnUrl: "http://localhost:3121/", createdBy: { type: "user", id: user!.id } });
    return NextResponse.json({ orgId: org.id, token: created.familyToken });
  }
  const orgId = p.get("orgId") ?? "";
  const members = await db.select().from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
  const rev = members.find((x) => x.role === "reviewer")!;
  const actor = { type: "user" as const, id: rev.userId, mode: "test" as const };
  const queue = await listReviewQueue(orgId, { mode: "test" });
  const resolved: string[] = [];
  for (const item of queue.items) {
    const detail = await getVerificationDetail(orgId, item.verificationId, actor);
    const letter = detail.documents.find((d) => d.declaredKind === "award_letter");
    await resolveReview(orgId, item.verificationId, { resolution: "eligible", notes: "SYNTHETIC walkthrough: SNAP approval letter checked by a person.", basis: letter ? { method: "categorical", documentId: letter.id } : { method: "direct" } }, actor);
    resolved.push(item.verificationId);
  }
  return NextResponse.json({ resolved });
}
