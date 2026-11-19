/**
 * The SGO dashboard's operations, guard and downloads on the embedded database. Every organization, person and
 * document here is SYNTHETIC.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/db/client";
import type { MemberRole, Mode } from "@/db/schema";
import { setTestNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { emitEvent } from "@/server/events";
import { addDocument, getVerification, signCertification, submit } from "@/server/verifications";
import { drainJobs, hideEnumerableArrayExtensions, makeStaff, makeTestFamily, makeTestSgo, startedVerification, syntheticW2, TEST_NOW, userByEmail, type TestSgo } from "@/server/verifications/test-support";
import { listDeliveries, setWebhookResolverForTests } from "@/server/webhooks";
import { useTestDb } from "../../../../tests/helpers/db";
import type { SgoActor } from "../types";
import { resolveSgoContext } from "./context";
import { contentDisposition, documentFile, downloadErrorResponse, evidenceFile, fileResponse, serveDashboardFile } from "./downloads";
import * as ops from "./operations";
import { loadHome, loadShellCounts } from "./queries";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}

async function actorFor(email: string, orgId: string, role: MemberRole, mode: Mode = "test"): Promise<SgoActor> {
  const user = await userByEmail(email);
  return { userId: user.id, orgId, role, mode, request: { ip: "198.51.100.20", userAgent: "vitest-sgo-ui" } };
}

async function staff(sgo: TestSgo, role: MemberRole, email: string, mode: Mode = "test"): Promise<SgoActor> {
  const a = await makeStaff(sgo.orgId, role, email, mode);
  return { userId: a.id, orgId: sgo.orgId, role, mode, request: { ip: a.request?.ip ?? null, userAgent: a.request?.userAgent ?? null } };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

/** A decided verification with a SYNTHETIC W-2 and its evidence pack, in `sgo`. */
async function decidedIn(sgo: TestSgo, email: string) {
  const family = await makeTestFamily(email);
  const { verification } = await startedVerification(sgo, family, { externalRef: `SYN-${email}` });
  await addDocument({ verificationId: verification.id, declaredKind: "w2", bytes: await syntheticW2(), filename: "w2.pdf", contentType: "application/pdf" }, family.actor);
  await signCertification(verification.id, family.actor, { kind: "no_other_income", locale: "en" });
  await submit(verification.id, family.actor);
  await drainJobs();
  setTestNow(TEST_NOW);
  return verification.id;
}

describe("SGO dashboard operations", () => {
  useTestDb();
  beforeAll(() => hideEnumerableArrayExtensions());
  beforeEach(() => {
    setTestNow(TEST_NOW);
    for (const level of ["error", "warn", "info", "log"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  });
  afterEach(() => {
    setTestNow(null);
    setWebhookResolverForTests(null);
    vi.restoreAllMocks();
  });

  it("creates a verification in the dashboard's org and mode and shows the family link once", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const owner = await actorFor(a.ownerEmail, a.orgId, "owner");
    const result = await ops.createVerificationOp(owner, fd({ applicantName: "Dana Sample", externalRef: "SYN-1", locale: "en" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.shownOnce?.value).toMatch(/\/v\/[A-Za-z0-9_-]{20,}$/);
    const db = await getDb();
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, a.orgId));
    expect(row).toMatchObject({ mode: "test", externalRef: "SYN-1", createdByType: "user", createdById: owner.userId });
    // Only the hash of the family token is stored.
    expect(JSON.stringify(row)).not.toContain(result.data.shownOnce!.value.split("/v/")[1]);
  });

  it("enforces roles: viewers look, reviewers review, admins manage", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const viewer = await staff(a, "viewer", "viewer-a@example.org");
    const reviewer = await actorFor(a.reviewerEmail, a.orgId, "reviewer");
    const owner = await actorFor(a.ownerEmail, a.orgId, "owner");

    const v = await ops.createVerificationOp(viewer, fd({}));
    expect(v.ok ? "ok" : v.error.code).toBe("forbidden");
    const r = await ops.createVerificationOp(reviewer, fd({}));
    expect(r.ok).toBe(true);
    const k = await ops.createApiKeyOp(reviewer, fd({ name: "Admissions" }));
    expect(k.ok ? "ok" : k.error.code).toBe("forbidden");
    const key = await ops.createApiKeyOp(owner, fd({ name: "Admissions" }));
    expect(key.ok && key.data.shownOnce?.value.startsWith("ecca_test_")).toBe(true);
    const policy = await ops.updatePolicyOp(reviewer, fd({ incomeCapPct: "250", reviewBandBps: "500", rawRetentionDays: "30" }));
    expect(policy.ok ? "ok" : policy.error.code).toBe("forbidden");
  });

  it("refuses a role the actor claims but does not hold, and an organization they are not in", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const viewer = await staff(a, "viewer", "viewer-a@example.org");
    // The role on the actor is a cached copy; the database decides.
    const inflated = { ...viewer, role: "owner" as const };
    const res = await ops.createApiKeyOp(inflated, fd({ name: "x" }));
    expect(res.ok ? "ok" : res.error.code).toBe("forbidden");

    const ownerA = await actorFor(a.ownerEmail, a.orgId, "owner");
    const forged = { ...ownerA, orgId: b.orgId };
    const created = await ops.createVerificationOp(forged, fd({}));
    expect(created.ok ? "ok" : created.error.code).toBe("forbidden");
    const db = await getDb();
    expect(await db.select().from(schema.verifications).where(eq(schema.verifications.orgId, b.orgId))).toHaveLength(0);
    // A business or missing organization is not an SGO.
    const nowhere = await ops.createVerificationOp({ ...ownerA, orgId: "org_doesnotexist000000000" }, fd({}));
    expect(nowhere.ok ? "ok" : nowhere.error.code).toBe("forbidden");
  });

  it("tenant isolation: SGO A cannot read, review or download SGO B's verification; B can", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const bId = await decidedIn(b, "family-b@example.com");
    expect((await getVerification(b.orgId, bId, { mode: "test" })).status).toBe("eligible");

    const ownerA = await actorFor(a.ownerEmail, a.orgId, "owner");
    const ownerB = await actorFor(b.ownerEmail, b.orgId, "owner");

    expect(await codeOf(evidenceFile(ownerA, bId, "pdf"))).toBe("not_found");
    const denied = await serveDashboardFile((actor) => evidenceFile(actor, bId, "pdf"), async () => ({ actor: ownerA }));
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("Not found");

    const allowed = await serveDashboardFile((actor) => evidenceFile(actor, bId, "pdf"), async () => ({ actor: ownerB }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("application/pdf");
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
    expect((await allowed.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const resolve = await ops.resolveReviewOp(ownerA, fd({ verificationId: bId, resolution: "eligible", method: "direct", notes: "Trying across tenants" }));
    expect(resolve.ok ? "ok" : resolve.error.code).toBe("not_found");
    const cancel = await ops.cancelVerificationOp(ownerA, fd({ verificationId: bId }));
    expect(cancel.ok ? "ok" : cancel.error.code).toBe("not_found");

    const db = await getDb();
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.verificationId, bId));
    expect(await codeOf(documentFile(ownerA, doc!.id))).toBe("not_found");
    const own = await documentFile(ownerB, doc!.id);
    expect(own).toMatchObject({ verificationId: bId, disposition: "inline", contentType: "application/pdf" });
    // Every open of a raw file is audited.
    const views = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "document.view"), eq(schema.auditLogs.orgId, b.orgId)));
    expect(views).toHaveLength(1);
  });

  it("the mode is a scope too: a test verification is not found from live mode", async () => {
    const b = await makeTestSgo("Synthetic Fund B");
    const bId = await decidedIn(b, "family-mode@example.com");
    const live = await actorFor(b.ownerEmail, b.orgId, "owner", "live");
    expect(await codeOf(evidenceFile(live, bId, "json"))).toBe("not_found");
    expect(await codeOf(evidenceFile(live, bId, "exe"))).toBe("not_found");
  });

  it("resolve requires notes; ask-for-more requires items", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const reviewer = await actorFor(a.reviewerEmail, a.orgId, "reviewer");
    const res = await ops.resolveReviewOp(reviewer, fd({ verificationId: "ver_x", resolution: "eligible", method: "direct", notes: "  " }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.fields).toHaveProperty("notes");
    const ask = await ops.requestMoreInfoOp(reviewer, fd({ verificationId: "ver_x", message: "Please", items: "" }));
    expect(ask.ok ? "ok" : ask.error.fields).toHaveProperty("items");
  });

  it("sandbox donor numbers only in test mode", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const live = await actorFor(a.ownerEmail, a.orgId, "owner", "live");
    const res = await ops.generateSandboxNumbersOp(live, fd({ taxYear: "2026" }));
    expect(res.ok ? "ok" : res.error.message).toMatch(/only in test mode/);
    const res2 = await ops.generateSandboxNumberOp(live, fd({ taxYear: "2026", donorId: "dnr_x" }));
    expect(res2.ok ? "ok" : res2.error.message).toMatch(/only in test mode/);
  });

  it("webhooks: the secret is shown once, changes are audited, and a delivery of the other mode cannot be resent", async () => {
    setWebhookResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    const a = await makeTestSgo("Synthetic Fund A");
    const owner = await actorFor(a.ownerEmail, a.orgId, "owner");
    const created = await ops.createWebhookOp(owner, fd({ url: "https://hooks.example.org/passport", eventTypes: ["verification.decided"] }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.shownOnce?.secret).toBe(true);
    const db = await getDb();
    const audits = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, a.orgId), eq(schema.auditLogs.action, "webhook_endpoint.create")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain(created.data.shownOnce!.value);

    await emitEvent({ orgId: a.orgId, type: "verification.decided", payload: { id: "ver_SYNTHETIC" }, mode: "live" });
    const [delivery] = await listDeliveries({ orgId: a.orgId });
    expect(delivery).toBeDefined();
    const fromTest = await ops.resendDeliveryOp(owner, fd({ deliveryId: delivery!.id }));
    expect(fromTest.ok ? "ok" : fromTest.error.code).toBe("not_found");
    const fromLive = await ops.resendDeliveryOp({ ...owner, mode: "live" }, fd({ deliveryId: delivery!.id }));
    expect(fromLive.ok).toBe(true);

    const reviewer = await actorFor(a.reviewerEmail, a.orgId, "reviewer");
    const del = await ops.deleteWebhookOp(reviewer, fd({ endpointId: "whe_x" }));
    expect(del.ok ? "ok" : del.error.code).toBe("forbidden");
  });

  it("team: anyone may leave, only admins remove others", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const viewer = await staff(a, "viewer", "viewer-a@example.org");
    const reviewer = await actorFor(a.reviewerEmail, a.orgId, "reviewer");
    const kick = await ops.removeMemberOp(viewer, fd({ userId: reviewer.userId }));
    expect(kick.ok ? "ok" : kick.error.code).toBe("forbidden");
    const leave = await ops.removeMemberOp(viewer, fd({ userId: viewer.userId }));
    expect(leave.ok).toBe(true);
    const after = await ops.createVerificationOp(viewer, fd({}));
    expect(after.ok ? "ok" : after.error.code).toBe("forbidden");
  });

  it("refuses a form rendered for another organization", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const owner = await actorFor(a.ownerEmail, a.orgId, "owner");
    expect(() => ops.assertSameOrg(owner, fd({ orgId: "org_other" }))).toThrow(/another organization/);
    expect(() => ops.assertSameOrg(owner, fd({ orgId: a.orgId }))).not.toThrow();
    expect(() => ops.assertSameOrg(owner, fd({}))).not.toThrow();
  });

  it("self-serve signup makes the signed-in person the owner of a new SGO", async () => {
    const user = await userByEmail("founder@example.org");
    const missing = await ops.signupOp(user, null, fd({ name: "Synthetic New Fund" }));
    expect(missing.ok ? "ok" : missing.error.fields).toHaveProperty("testModeUnderstood");
    const made = await ops.signupOp(user, null, fd({ name: "Synthetic New Fund", testModeUnderstood: "on", state: "TX" }));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const ctx = await resolveSgoContext(user, { orgId: null, mode: "live" }, null);
    expect(ctx).toMatchObject({ role: "owner", mode: "test", liveAvailable: false });
    expect(ctx!.org.id).toBe(made.data.record.org.id);
  });

  it("guard: no SGO is null; a stale org choice falls back to the person's own; live needs a verified listing", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const b = await makeTestSgo("Synthetic Fund B");
    const stranger = await userByEmail("stranger@example.org");
    expect(await resolveSgoContext(stranger, { orgId: null, mode: null }, null)).toBeNull();

    const reviewer = await userByEmail(a.reviewerEmail);
    const ctx = await resolveSgoContext(reviewer, { orgId: b.orgId, mode: "live" }, null);
    expect(ctx!.org.id).toBe(a.orgId);
    expect(ctx!.role).toBe("reviewer");
    expect(ctx!.mode).toBe("test");
    expect(ctx!.actor).toMatchObject({ orgId: a.orgId, role: "reviewer", mode: "test" });

    const db = await getDb();
    const [entry] = await db
      .insert(schema.sgoListEntries)
      .values({ id: "sle_SYNTHETIC000000000000", source: "provisional_curated", state: "TX", name: "Synthetic Fund A", matchKey: "name:synthetic fund a" })
      .returning();
    await db.update(schema.sgoProfiles).set({ listEntryId: entry!.id }).where(eq(schema.sgoProfiles.orgId, a.orgId));
    const live = await resolveSgoContext(reviewer, { orgId: a.orgId, mode: "live" }, null);
    expect(live).toMatchObject({ mode: "live", liveAvailable: true });
  });

  it("home and shell counts load for an empty organization", async () => {
    const a = await makeTestSgo("Synthetic Fund A");
    const owner = await actorFor(a.ownerEmail, a.orgId, "owner");
    const home = await loadHome(owner, "2026-11-18");
    expect(home.counts.total).toBe(0);
    expect(home.reportingYear).toBe(2026);
    expect(home.checklist.items.length).toBeGreaterThan(0);
    expect(home.attention.map((i) => i.key)).toContain("onboarding");
    expect(await loadShellCounts(owner)).toEqual({ reviewCount: 0, partnerRequests: 0 });
  });
});

describe("download responses", () => {
  it("maps errors without revealing whether an id exists", async () => {
    expect(downloadErrorResponse(new AppError("forbidden", "x")).status).toBe(404);
    expect(downloadErrorResponse(new AppError("not_found", "x")).status).toBe(404);
    expect(downloadErrorResponse(new AppError("unauthenticated", "x")).status).toBe(401);
    expect(downloadErrorResponse(new AppError("gone", "File deleted")).status).toBe(410);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(downloadErrorResponse(new Error("boom")).status).toBe(500);
    vi.restoreAllMocks();
  });

  it("encodes file names safely and sandboxes untrusted inline files", () => {
    expect(contentDisposition("attachment", 'évidence "x".pdf')).toBe(`attachment; filename="_vidence _x_.pdf"; filename*=UTF-8''%C3%A9vidence%20%22x%22.pdf`);
    const img = fileResponse({ bytes: Buffer.from("x"), contentType: "image/png", filename: "a.png", disposition: "inline" });
    expect(img.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    const pdf = fileResponse({ bytes: Buffer.from("%PDF"), contentType: "application/pdf", filename: "a.pdf", disposition: "attachment", sha256: "ab" });
    expect(pdf.headers.get("content-security-policy")).toBeNull();
    expect(pdf.headers.get("x-content-sha256")).toBe("ab");
  });
});
