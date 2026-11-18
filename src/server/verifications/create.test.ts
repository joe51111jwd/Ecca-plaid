import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { listOutbox } from "@/server/email";
import { useTestDb } from "../../../tests/helpers/db";
import { createVerification, validateReturnUrl } from "./create";
import { getVerificationByFamilyToken } from "./family";
import { FAMILY_LINK_TTL_DAYS } from "./policy";
import { baseCreate, errorOf, makeTestSgo, TEST_NOW } from "./test-support";

describe("createVerification", () => {
  useTestDb();
  beforeEach(() => setTestNow(TEST_NOW));
  afterEach(() => setTestNow(null));

  it("stores only the hash of a 256-bit token and returns the family link once", async () => {
    const sgo = await makeTestSgo();
    const res = await createVerification(baseCreate(sgo.orgId, { metadata: { cohort: "2027", "app.id": "A-1" }, returnUrl: "https://sgo.example.org/done?x=1" }));
    expect(res.familyToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(res.familyToken, "base64url")).toHaveLength(32);
    expect(res.familyUrl).toBe(`http://localhost:3000/v/${res.familyToken}`);
    const db = await getDb();
    const [row] = await db.select().from(schema.verifications).where(eq(schema.verifications.id, res.verification.id));
    expect(row.familyTokenHash).toBe(hashToken(res.familyToken));
    expect(JSON.stringify(row)).not.toContain(res.familyToken);
    expect(row).toMatchObject({ status: "pending", stage: "created", mode: "test", createdByType: "api_key", metadata: { cohort: "2027", "app.id": "A-1" }, returnUrl: "https://sgo.example.org/done?x=1", locale: "en" });
    expect(row.familyTokenExpiresAt.getTime() - Date.parse(TEST_NOW)).toBe(FAMILY_LINK_TTL_DAYS * 86_400_000);
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "verification.create"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorType: "api_key", orgId: sgo.orgId, targetId: row.id });
    expect(JSON.stringify(audits[0])).not.toContain(res.familyToken);
    expect(JSON.stringify(audits[0])).not.toContain("dana@example.com");
    // No email unless asked for.
    expect(await listOutbox({ template: "verification_invite" })).toHaveLength(0);
  });

  it("emails the invitation in the requested language, marked sensitive", async () => {
    const sgo = await makeTestSgo("Fondo Sintético de Becas");
    const res = await createVerification(baseCreate(sgo.orgId, { sendInvite: true, locale: "es", applicantEmail: "  Ana@Example.COM " }));
    const [mail] = await listOutbox({ template: "verification_invite" });
    expect(mail.toEmail).toBe("ana@example.com");
    expect(mail.subject).toContain("Fondo Sintético de Becas");
    expect(mail.text).toContain(res.familyUrl);
    expect(mail.text).toContain("18 de diciembre de 2026");
    expect(mail.text).toContain("no significa que se otorgue una beca");
    const db = await getDb();
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "email.send"));
    expect(jobs[0].payload).toMatchObject({ emailId: mail.id, redactAfterSend: true });
  });

  it("each verification gets a distinct token", async () => {
    const sgo = await makeTestSgo();
    const a = await createVerification(baseCreate(sgo.orgId));
    const b = await createVerification(baseCreate(sgo.orgId));
    expect(a.familyToken).not.toBe(b.familyToken);
    expect((await getVerificationByFamilyToken(a.familyToken)).state).toBe("active");
  });

  it("refuses bad input with field-level details", async () => {
    const sgo = await makeTestSgo();
    const cases: Array<[string, Parameters<typeof baseCreate>[1]]> = [
      ["applicantEmail", { applicantEmail: "not-an-email" }],
      ["mode", { mode: "prod" as never }],
      ["sendInvite", { sendInvite: true, applicantEmail: null }],
      ["metadata", { metadata: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])) }],
      ["metadata", { metadata: { "bad key": "v" } }],
      ["metadata", { metadata: { k: "x".repeat(501) } }],
      ["metadata", { metadata: { k: "line\u0000break" } }],
      ["externalRef", { externalRef: "x".repeat(201) }],
      ["applicantName", { applicantName: "a\u0007b" }],
      ["createdBy", { createdBy: { type: "robot" as never, id: "x" } }],
      ["handoffId", { createdBy: { type: "handoff", id: "ho_1" }, handoffId: null }],
    ];
    for (const [field, override] of cases) {
      const err = await errorOf(createVerification(baseCreate(sgo.orgId, override)));
      expect(err.code, field).toBe("validation_failed");
      expect(JSON.stringify(err.details), field).toContain(field === "sendInvite" ? "applicantEmail" : field === "handoffId" ? "handoffId" : field);
    }
    const unknown = await errorOf(createVerification({ ...baseCreate(sgo.orgId), extra: 1 } as never));
    expect(unknown.code).toBe("validation_failed");
  });

  it("refuses an unknown or non-SGO organization and a suspended SGO", async () => {
    const sgo = await makeTestSgo();
    expect((await errorOf(createVerification(baseCreate("org_doesnotexist0000000000")))).code).toBe("not_found");
    const db = await getDb();
    await db.update(schema.organizations).set({ status: "suspended" }).where(eq(schema.organizations.id, sgo.orgId));
    expect((await errorOf(createVerification(baseCreate(sgo.orgId)))).code).toBe("forbidden");
  });

  it("records handoff-created verifications with their handoff and a system audit actor", async () => {
    const sgo = await makeTestSgo();
    const res = await createVerification(baseCreate(sgo.orgId, { createdBy: { type: "handoff", id: "ho_SYNTHETIC1" }, handoffId: "ho_SYNTHETIC1" }));
    expect(res.verification).toMatchObject({ createdByType: "handoff", handoffId: "ho_SYNTHETIC1" });
    const db = await getDb();
    const [a] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "verification.create"));
    expect(a.actorType).toBe("system");
  });
});

describe("validateReturnUrl", () => {
  it("accepts https and, outside production, http on localhost", () => {
    expect(validateReturnUrl("https://sgo.example.org/x", true)).toBe("https://sgo.example.org/x");
    expect(validateReturnUrl("http://localhost:4000/back", false)).toBe("http://localhost:4000/back");
    expect(validateReturnUrl("http://127.0.0.1/back", false)).toBe("http://127.0.0.1/back");
  });

  it("refuses everything else", () => {
    for (const [url, prod] of [
      ["http://localhost:4000/back", true],
      ["http://sgo.example.org", false],
      ["javascript:alert(1)", false],
      ["ftp://sgo.example.org", false],
      ["/relative", false],
      ["https://user:pass@sgo.example.org", false],
      [`https://sgo.example.org/${"a".repeat(2001)}`, false],
      ["http://localhost.evil.example", false],
    ] as const) {
      expect(() => validateReturnUrl(url, prod), url).toThrow();
    }
  });
});
