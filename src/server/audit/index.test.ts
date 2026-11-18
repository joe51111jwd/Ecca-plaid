import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { useTestDb } from "../../../tests/helpers/db";
import * as auditModule from "./index";
import { AUDIT_METADATA_LIMITS, audit, listAuditLogs, normalizeIp, requestInfoFromHeaders, sanitizeAuditMetadata, SYSTEM_ACTOR } from "./index";

describe("sanitizeAuditMetadata", () => {
  it("records a __proto__ key from parsed JSON as data instead of swapping the output's prototype", () => {
    const out = sanitizeAuditMetadata(JSON.parse('{"__proto__": {"note": "x", "token": "secret"}, "a": 1}'))!;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse('{"__proto__": {"note": "x"}, "a": 1}'));
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("returns null for missing metadata and rejects non-objects", () => {
    expect(sanitizeAuditMetadata(undefined)).toBeNull();
    expect(sanitizeAuditMetadata(null)).toBeNull();
    expect(() => sanitizeAuditMetadata(["a"] as unknown as Record<string, unknown>)).toThrow(TypeError);
    expect(() => sanitizeAuditMetadata("x" as unknown as Record<string, unknown>)).toThrow(TypeError);
  });

  it("drops secret-looking keys at every depth, whatever their casing", () => {
    const out = sanitizeAuditMetadata({
      token: "abc",
      accessToken: "abc",
      client_secret: "abc",
      Password: "hunter2",
      SSN: "123-45-6789",
      ssnLast4: "6789",
      Authorization: "Bearer abc",
      keep: "yes",
      nested: { refresh_token: "abc", fine: 1, deeper: [{ webhookSecret: "abc", ok: true }] },
    });
    expect(out).toEqual({ keep: "yes", nested: { fine: 1, deeper: [{ ok: true }] } });
  });

  it("masks formatted SSNs inside values even when the key looks harmless", () => {
    const out = sanitizeAuditMetadata({ note: "Parent wrote 123-45-6789 on the form", list: ["987-65-4321", "ok"] });
    expect(out).toEqual({ note: "Parent wrote [redacted] on the form", list: ["[redacted]", "ok"] });
  });

  it("truncates long strings", () => {
    const long = "x".repeat(AUDIT_METADATA_LIMITS.maxStringLength + 40);
    const out = sanitizeAuditMetadata({ long, short: "x".repeat(AUDIT_METADATA_LIMITS.maxStringLength) })!;
    expect(out.short).toHaveLength(AUDIT_METADATA_LIMITS.maxStringLength);
    expect(out.long as string).toMatch(/^x{500}… \[truncated 40 chars\]$/);
  });

  it("never stores bytes, and converts values JSON cannot hold", () => {
    const out = sanitizeAuditMetadata({
      file: Buffer.from("%PDF-1.7 synthetic"),
      view: new Uint8Array(12),
      raw: new ArrayBuffer(8),
      when: new Date("2026-11-18T10:00:00.000Z"),
      badDate: new Date("nope"),
      big: 12n,
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      undef: undefined,
      fn: () => 1,
      sym: Symbol("s"),
      err: new Error("failed for 123-45-6789"),
      set: new Set(["a", "b"]),
      map: new Map<string, unknown>([
        ["k", 1],
        ["apiToken", "abc"],
      ]),
      instance: new URL("https://example.com/?token=abc"),
      nothing: null,
      flag: false,
      zero: 0,
    });
    expect(out).toEqual({
      file: "[binary 18 bytes]",
      view: "[binary 12 bytes]",
      raw: "[binary 8 bytes]",
      when: "2026-11-18T10:00:00.000Z",
      badDate: null,
      big: "12",
      nan: null,
      inf: null,
      err: { name: "Error", message: "failed for [redacted]" },
      set: ["a", "b"],
      map: { k: 1 },
      instance: "[URL]",
      nothing: null,
      flag: false,
      zero: 0,
    });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("survives circular, very deep and very wide structures", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(sanitizeAuditMetadata(circular)).toEqual({ name: "loop", self: "[circular]" });

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(JSON.stringify(sanitizeAuditMetadata(deep))).toContain("[truncated: too deep]");

    const wide = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    const outWide = sanitizeAuditMetadata(wide)!;
    expect(Object.keys(outWide)).toHaveLength(AUDIT_METADATA_LIMITS.maxKeysPerObject + 1);
    expect(outWide["[omitted keys]"]).toBe(30);

    const outArr = sanitizeAuditMetadata({ items: Array.from({ length: 60 }, (_, i) => i) })!;
    expect(outArr.items as unknown[]).toHaveLength(AUDIT_METADATA_LIMITS.maxArrayItems + 1);
    expect((outArr.items as unknown[]).at(-1)).toBe("[+10 more]");
  });

  it("does not mutate its input and repeats a shared (non-circular) object", () => {
    const shared = { a: 1 };
    const input = { first: shared, second: shared, password: "x" };
    expect(sanitizeAuditMetadata(input)).toEqual({ first: { a: 1 }, second: { a: 1 } });
    expect(input).toEqual({ first: { a: 1 }, second: { a: 1 }, password: "x" });
  });
});

describe("requestInfoFromHeaders", () => {
  it("takes the first hop of x-forwarded-for and the user agent", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2", "user-agent": "Mozilla/5.0 (synthetic)" });
    expect(requestInfoFromHeaders(h)).toEqual({ ip: "203.0.113.7", userAgent: "Mozilla/5.0 (synthetic)" });
  });

  it("falls back to x-real-ip and to nulls", () => {
    expect(requestInfoFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }))).toEqual({ ip: "198.51.100.4", userAgent: null });
    expect(requestInfoFromHeaders(new Headers())).toEqual({ ip: null, userAgent: null });
    expect(requestInfoFromHeaders(new Headers({ "x-forwarded-for": "not-an-ip", "x-real-ip": "198.51.100.4" })).ip).toBe("198.51.100.4");
  });

  it("refuses values that are not addresses (header injection, junk, oversize)", () => {
    for (const bad of ["<script>alert(1)</script>", "unknown", "", " ", "1.2.3", "999.1.1.1", "203.0.113.7; DROP TABLE", "a".repeat(500)]) {
      expect(normalizeIp(bad)).toBeNull();
    }
    expect(requestInfoFromHeaders(new Headers({ "x-forwarded-for": "evil, 203.0.113.7" })).ip).toBeNull();
  });

  it("normalizes ports, brackets, IPv6 case and IPv4-mapped addresses", () => {
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  it("truncates the user agent and strips control characters", () => {
    const info = requestInfoFromHeaders({ get: (name) => (name === "user-agent" ? `bot\u0000\u0007 ${"a".repeat(2000)}` : null) });
    expect(info.userAgent).toHaveLength(512);
    expect(info.userAgent?.startsWith("bot  a")).toBe(true);
  });
});

describe("audit log", () => {
  const t = useTestDb();
  afterEach(() => setTestNow(null));

  it("appends an entry with every field, sanitized", async () => {
    setTestNow("2026-12-01T09:30:00.000Z");
    const row = await audit({
      actor: { type: "user", id: "usr_1" },
      orgId: "org_1",
      action: " document.download ",
      target: { type: "document", id: "doc_1" },
      metadata: { reason: "review", sessionToken: "abc", note: "ssn 123-45-6789" },
      request: { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (synthetic)" },
    });
    expect(row.id).toMatch(/^aud_/);
    expect(row).toMatchObject({
      actorType: "user",
      actorId: "usr_1",
      orgId: "org_1",
      action: "document.download",
      targetType: "document",
      targetId: "doc_1",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (synthetic)",
      metadata: { reason: "review", note: "ssn [redacted]" },
    });
    expect(row.at).toEqual(new Date("2026-12-01T09:30:00.000Z"));

    const [stored] = await t.db.select().from(schema.auditLogs);
    expect(stored).toEqual(row);
  });

  it("stores nulls for everything optional", async () => {
    const row = await audit({ actor: SYSTEM_ACTOR, action: "retention.purge" });
    expect(row).toMatchObject({ actorType: "system", actorId: null, orgId: null, targetType: null, targetId: null, ip: null, userAgent: null, metadata: null });
  });

  it("rejects malformed entries instead of writing a useless row", async () => {
    await expect(audit({ actor: SYSTEM_ACTOR, action: "   " })).rejects.toMatchObject({ code: "internal" });
    await expect(audit({ actor: SYSTEM_ACTOR, action: "x".repeat(121) })).rejects.toMatchObject({ code: "internal" });
    await expect(audit({ actor: { type: "robot" as never }, action: "a.b" })).rejects.toMatchObject({ code: "internal" });
    await expect(audit({ actor: SYSTEM_ACTOR, action: "a.b", target: { type: "document", id: "" } })).rejects.toMatchObject({ code: "internal" });
    await expect(audit({ actor: { type: "user", id: " " }, action: "a.b" })).rejects.toMatchObject({ code: "internal" });
    expect(await t.db.select().from(schema.auditLogs)).toHaveLength(0);
  });

  it("stamps entries with the application clock", async () => {
    setTestNow("2031-05-05T00:00:00.000Z");
    const row = await audit({ actor: SYSTEM_ACTOR, action: "clock.check" });
    expect(row.at.toISOString()).toBe("2031-05-05T00:00:00.000Z");
  });

  it("lists entries in the order they were written, even when the clock is frozen", async () => {
    setTestNow("2027-01-15T12:00:00.000Z");
    const rows = [];
    for (let i = 0; i < 40; i++) rows.push(await audit({ actor: SYSTEM_ACTOR, action: `step.${i}` }));
    expect(new Set(rows.map((r) => r.at.getTime())).size).toBe(1);
    for (let i = 1; i < rows.length; i++) expect(rows[i].id > rows[i - 1].id).toBe(true);
    for (const r of rows) expect(r.id).toMatch(/^aud_[0-9A-HJKMNP-TV-Z]{22}$/);

    const all = await listAuditLogs({ limit: 200 });
    expect(all.items.map((r) => r.action)).toEqual(rows.map((r) => r.action).reverse());
    // The same order holds across pages.
    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: auditModule.AuditLogPage = await listAuditLogs({ limit: 7, before: cursor });
      paged.push(...page.items.map((r) => r.action));
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(rows.map((r) => r.action).reverse());
  });

  it("orders by time first: an entry written later under an earlier clock lists as older", async () => {
    setTestNow("2027-01-15T12:00:00.000Z");
    await audit({ actor: SYSTEM_ACTOR, action: "written.first" });
    setTestNow("2027-01-10T12:00:00.000Z");
    await audit({ actor: SYSTEM_ACTOR, action: "written.second" });
    expect((await listAuditLogs()).items.map((r) => r.action)).toEqual(["written.first", "written.second"]);
  });

  it("never issues the same id twice under load", async () => {
    const rows = await Promise.all(Array.from({ length: 200 }, (_, i) => audit({ actor: SYSTEM_ACTOR, action: `burst.${i}` })));
    expect(new Set(rows.map((r) => r.id)).size).toBe(200);
  });

  it("takes part in the caller's transaction", async () => {
    await expect(
      t.db.transaction(async (tx) => {
        await audit({ actor: SYSTEM_ACTOR, action: "will.rollback" }, tx);
        expect((await listAuditLogs({}, tx)).items).toHaveLength(1);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await listAuditLogs()).items).toHaveLength(0);
  });

  it("is append-only: the module exposes no way to change or remove entries", () => {
    const exported = Object.keys(auditModule);
    expect(exported.filter((name) => /update|delete|remove|purge|clear|edit/i.test(name))).toEqual([]);
  });

  async function seed(count: number, overrides: (i: number) => Partial<typeof schema.auditLogs.$inferInsert> = () => ({})) {
    const base = Date.UTC(2026, 10, 18, 12, 0, 0);
    const rows = Array.from({ length: count }, (_, i) => ({
      id: newId("audit"),
      // Pairs share a timestamp so pagination has to break ties on id.
      at: new Date(base + Math.floor(i / 2) * 1000),
      actorType: "user" as const,
      actorId: "usr_1",
      orgId: "org_1",
      action: "verification.read",
      targetType: "verification",
      targetId: `ver_${i}`,
      ...overrides(i),
    }));
    await t.db.insert(schema.auditLogs).values(rows);
    return rows;
  }

  it("pages newest first with a keyset cursor, without gaps or repeats, across timestamp ties", async () => {
    const rows = await seed(23);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: auditModule.AuditLogPage = await listAuditLogs({ limit: 5, before: cursor });
      expect(page.items.length).toBeLessThanOrEqual(5);
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(23);
    const expected = await t.db.execute(sql`select id from audit_logs order by at desc, id desc`);
    expect(seen).toEqual((expected as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id));
    expect(seen).toHaveLength(rows.length);
  });

  it("returns no cursor on the last page, including an exactly full one", async () => {
    await seed(10);
    const first = await listAuditLogs({ limit: 5 });
    expect(first.nextCursor).not.toBeNull();
    const second = await listAuditLogs({ limit: 5, before: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect((await listAuditLogs({ limit: 10 })).nextCursor).toBeNull();
  });

  it("is stable while new entries arrive between pages", async () => {
    await seed(6);
    const first = await listAuditLogs({ limit: 3 });
    await audit({ actor: SYSTEM_ACTOR, orgId: "org_1", action: "arrived.later" });
    const second = await listAuditLogs({ limit: 3, before: first.nextCursor });
    const ids = [...first.items, ...second.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(6);
    expect(second.items.some((r) => r.action === "arrived.later")).toBe(false);
  });

  it("filters by organization, target, actor and action, and combines filters", async () => {
    await seed(12, (i) => ({
      orgId: i % 2 === 0 ? "org_a" : "org_b",
      actorId: i % 3 === 0 ? "usr_x" : "usr_y",
      action: i % 4 === 0 ? "document.download" : "verification.read",
      targetType: i < 6 ? "verification" : "document",
    }));
    expect((await listAuditLogs({ orgId: "org_a" })).items).toHaveLength(6);
    expect((await listAuditLogs({ orgId: "org_a" })).items.every((r) => r.orgId === "org_a")).toBe(true);
    expect((await listAuditLogs({ actorId: "usr_x" })).items).toHaveLength(4);
    expect((await listAuditLogs({ action: "document.download" })).items).toHaveLength(3);
    expect((await listAuditLogs({ targetType: "document" })).items).toHaveLength(6);
    expect((await listAuditLogs({ targetType: "verification", targetId: "ver_3" })).items).toHaveLength(1);
    expect((await listAuditLogs({ orgId: "org_a", actorId: "usr_x", action: "document.download" })).items.map((r) => r.targetId).sort()).toEqual(["ver_0"]);
    expect((await listAuditLogs({ orgId: "org_missing" })).items).toEqual([]);
  });

  it("keeps filters applied across pages (no cross-tenant leak through the cursor)", async () => {
    await seed(20, (i) => ({ orgId: i % 2 === 0 ? "org_a" : "org_b" }));
    const first = await listAuditLogs({ orgId: "org_a", limit: 4 });
    const second = await listAuditLogs({ orgId: "org_a", limit: 4, before: first.nextCursor });
    const third = await listAuditLogs({ orgId: "org_a", limit: 4, before: second.nextCursor });
    const all = [...first.items, ...second.items, ...third.items];
    expect(all).toHaveLength(10);
    expect(all.every((r) => r.orgId === "org_a")).toBe(true);
    expect(third.nextCursor).toBeNull();
  });

  it("validates limit and cursor", async () => {
    for (const limit of [0, -1, 201, 1.5, Number.NaN]) {
      await expect(listAuditLogs({ limit })).rejects.toMatchObject({ code: "bad_request" });
    }
    for (const before of ["garbage", "!!!!", Buffer.from("abc|").toString("base64url"), Buffer.from("|aud_1").toString("base64url"), Buffer.from("1e400|aud_1").toString("base64url")]) {
      await expect(listAuditLogs({ before })).rejects.toMatchObject({ code: "bad_request" });
    }
    expect((await listAuditLogs({ before: null })).items).toEqual([]);
  });
});

describe("newSortableId", () => {
  it("keeps the entity prefix and the usual length", () => {
    expect(auditModule.newSortableId("audit")).toMatch(/^aud_[0-9A-HJKMNP-TV-Z]{22}$/);
    expect(auditModule.newSortableId("email")).toMatch(/^eml_[0-9A-HJKMNP-TV-Z]{22}$/);
  });

  it("is strictly increasing in creation order, also within one millisecond", () => {
    const ids = Array.from({ length: 5000 }, () => auditModule.newSortableId("audit"));
    for (let i = 1; i < ids.length; i++) expect(ids[i] > ids[i - 1]).toBe(true);
    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(ids);
  });

  it("encodes the real clock, not the application clock", () => {
    setTestNow("2001-01-01T00:00:00.000Z");
    const before = auditModule.newSortableId("audit");
    setTestNow("1999-01-01T00:00:00.000Z");
    const after = auditModule.newSortableId("audit");
    setTestNow(null);
    expect(after > before).toBe(true);
  });
});
