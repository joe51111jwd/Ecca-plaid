import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db/client";
import { setTestNow } from "@/lib/clock";
import { listAuditLogs } from "@/server/audit";
import { useTestDb } from "../../../tests/helpers/db";
import {
  COUNSEL_MEMO_REQUIRED_MESSAGE,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  getSetting,
  getSettingDefault,
  getSettings,
  isSettingKey,
  listSettings,
  parseSettingValue,
  setSetting,
  type SettingKey,
  type SettingValue,
} from "./index";

const admin = { actorUserId: "usr_admin" };

describe("platform settings", () => {
  const t = useTestDb();

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setTestNow(null);
  });

  const storedRow = async (key: SettingKey) => (await t.db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key)))[0];
  const putRaw = (key: string, value: unknown) => t.db.insert(schema.platformSettings).values({ key, value });

  describe("registry and defaults", () => {
    it("defines exactly the documented keys with the documented defaults", async () => {
      expect([...SETTING_KEYS].sort()).toEqual(
        ["business.defaultSuccessFee", "credit.startDate", "fees.structure", "gifts.liveEnabled", "retention.defaults", "sgoList.source"].sort(),
      );
      expect(await getSetting("fees.structure")).toEqual({ active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null, approvedAt: null });
      expect(await getSetting("credit.startDate")).toBe("2027-01-01");
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
      expect(await getSetting("sgoList.source")).toBe("provisional_curated");
      expect(await getSetting("business.defaultSuccessFee")).toEqual({ flatCents: 0, bps: 0 });
      expect(await getSetting("retention.defaults")).toEqual({ rawUploadDays: 30 });
    });

    it("every default passes its own schema and has a description", () => {
      for (const key of SETTING_KEYS) {
        const def = SETTING_DEFINITIONS[key];
        expect(def.schema.safeParse(def.default).success, key).toBe(true);
        expect(def.description.length, key).toBeGreaterThan(10);
      }
    });

    it("hands out copies, so a caller cannot mutate the registry default", async () => {
      const a = await getSetting("fees.structure");
      a.active = "sgo_invoiced";
      a.sgoFeeBps = 999;
      expect(await getSetting("fees.structure")).toEqual(getSettingDefault("fees.structure"));
      const d = getSettingDefault("retention.defaults");
      d.rawUploadDays = 1;
      expect(getSettingDefault("retention.defaults")).toEqual({ rawUploadDays: 30 });
    });

    it("knows which strings are setting keys", () => {
      expect(isSettingKey("gifts.liveEnabled")).toBe(true);
      expect(isSettingKey("gifts.liveenabled")).toBe(false);
      expect(isSettingKey("toString")).toBe(false);
      expect(isSettingKey("__proto__")).toBe(false);
    });

    it("rejects unknown keys on every entry point", async () => {
      const bogus = "nope.nothing" as SettingKey;
      await expect(getSetting(bogus)).rejects.toMatchObject({ code: "bad_request" });
      await expect(getSettings([bogus])).rejects.toMatchObject({ code: "bad_request" });
      await expect(setSetting(bogus, true as never, admin)).rejects.toMatchObject({ code: "bad_request" });
      expect(() => getSettingDefault("constructor" as SettingKey)).toThrow(/Unknown setting/);
    });
  });

  describe("reading", () => {
    it("reads several settings in one call, mixing stored values and defaults", async () => {
      await setSetting("gifts.liveEnabled", true, admin);
      await setSetting("retention.defaults", { rawUploadDays: 90 }, admin);
      const values = await getSettings(["gifts.liveEnabled", "retention.defaults", "credit.startDate"]);
      expect(values).toEqual({ "gifts.liveEnabled": true, "retention.defaults": { rawUploadDays: 90 }, "credit.startDate": "2027-01-01" });
      const live: boolean = values["gifts.liveEnabled"];
      expect(live).toBe(true);
      expect(await getSettings([])).toEqual({});
    });

    it("does not cache: a change made elsewhere is visible on the next read", async () => {
      expect(await getSetting("sgoList.source")).toBe("provisional_curated");
      await putRaw("sgoList.source", "irs_published");
      expect(await getSetting("sgoList.source")).toBe("irs_published");
      await t.db.delete(schema.platformSettings);
      expect(await getSetting("sgoList.source")).toBe("provisional_curated");
    });

    it("reads inside a transaction see that transaction's writes", async () => {
      await t.db.transaction(async (tx) => {
        await setSetting("gifts.liveEnabled", true, admin, tx);
        expect(await getSetting("gifts.liveEnabled", tx)).toBe(true);
        expect((await getSettings(["gifts.liveEnabled"], tx))["gifts.liveEnabled"]).toBe(true);
      });
    });

    it("falls back to the (conservative) default when a stored row is unreadable, and says so", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await putRaw("gifts.liveEnabled", "yes please");
      await putRaw("retention.defaults", { rawUploadDays: 100000 });
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
      expect(await getSetting("retention.defaults")).toEqual({ rawUploadDays: 30 });
      expect(spy).toHaveBeenCalled();
      const listed = await listSettings();
      expect(listed.find((s) => s.key === "gifts.liveEnabled")).toMatchObject({ value: false, source: "invalid_stored" });
    });

    it("never honours a hand-edited fee structure that skips the counsel memo", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await putRaw("fees.structure", { active: "donor_service_fee", sgoFeeBps: 0, donorServiceFeeBps: 300, counselMemoRef: null, approvedAt: null });
      expect((await getSetting("fees.structure")).active).toBe("none");
      expect((await getSettings(["fees.structure"]))["fees.structure"].donorServiceFeeBps).toBe(0);
    });
  });

  describe("writing", () => {
    it("stores the value with who and when, and returns it", async () => {
      setTestNow("2026-12-02T15:00:00.000Z");
      const result = await setSetting("business.defaultSuccessFee", { flatCents: 2500, bps: 150 }, admin);
      expect(result).toEqual({ flatCents: 2500, bps: 150 });
      const row = await storedRow("business.defaultSuccessFee");
      expect(row.value).toEqual({ flatCents: 2500, bps: 150 });
      expect(row.updatedBy).toBe("usr_admin");
      expect(row.updatedAt.toISOString()).toBe("2026-12-02T15:00:00.000Z");
      expect(await getSetting("business.defaultSuccessFee")).toEqual({ flatCents: 2500, bps: 150 });
    });

    it("overwrites an existing value and updates the provenance", async () => {
      setTestNow("2026-12-02T15:00:00.000Z");
      await setSetting("retention.defaults", { rawUploadDays: 60 }, admin);
      setTestNow("2026-12-03T09:30:00.000Z");
      await setSetting("retention.defaults", { rawUploadDays: 45 }, { actorUserId: "usr_other" });
      const row = await storedRow("retention.defaults");
      expect(row.value).toEqual({ rawUploadDays: 45 });
      expect(row.updatedBy).toBe("usr_other");
      expect(row.updatedAt.toISOString()).toBe("2026-12-03T09:30:00.000Z");
      expect(await t.db.select().from(schema.platformSettings)).toHaveLength(1);
    });

    it("audits every change with the previous and new value, the actor and the request", async () => {
      await setSetting("gifts.liveEnabled", true, { actorUserId: "usr_admin", request: { ip: "203.0.113.7", userAgent: "synthetic-agent" } });
      await setSetting("gifts.liveEnabled", false, { actorUserId: null });
      const { items } = await listAuditLogs({ targetType: "platform_setting", targetId: "gifts.liveEnabled" });
      expect(items).toHaveLength(2);
      const [second, first] = items;
      expect(first).toMatchObject({
        action: "settings.update",
        actorType: "user",
        actorId: "usr_admin",
        ip: "203.0.113.7",
        userAgent: "synthetic-agent",
        metadata: { from: false, to: true },
      });
      expect(second).toMatchObject({ action: "settings.update", actorType: "system", actorId: null, metadata: { from: true, to: false } });
    });

    it("does nothing (no write, no audit entry) when the value is unchanged", async () => {
      setTestNow("2026-12-02T15:00:00.000Z");
      await setSetting("fees.structure", { active: "none", sgoFeeBps: 100, donorServiceFeeBps: 0, counselMemoRef: null, approvedAt: null }, admin);
      setTestNow("2026-12-09T15:00:00.000Z");
      // Same value, different key order.
      await setSetting("fees.structure", { approvedAt: null, counselMemoRef: null, donorServiceFeeBps: 0, sgoFeeBps: 100, active: "none" }, { actorUserId: "usr_other" });
      const row = await storedRow("fees.structure");
      expect(row.updatedBy).toBe("usr_admin");
      expect(row.updatedAt.toISOString()).toBe("2026-12-02T15:00:00.000Z");
      expect((await listAuditLogs({ action: "settings.update" })).items).toHaveLength(1);
    });

    it("records an explicit save of the default value", async () => {
      await setSetting("gifts.liveEnabled", false, admin);
      expect((await storedRow("gifts.liveEnabled")).value).toBe(false);
      expect((await listSettings()).find((s) => s.key === "gifts.liveEnabled")?.source).toBe("stored");
    });

    it("writes nothing when validation fails", async () => {
      await expect(setSetting("retention.defaults", { rawUploadDays: 0 }, admin)).rejects.toMatchObject({ code: "validation_failed" });
      expect(await t.db.select().from(schema.platformSettings)).toHaveLength(0);
      expect((await listAuditLogs()).items).toHaveLength(0);
    });

    it("rolls back with the caller's transaction, value and audit entry together", async () => {
      await expect(
        t.db.transaction(async (tx) => {
          await setSetting("gifts.liveEnabled", true, admin, tx);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
      expect((await listAuditLogs()).items).toHaveLength(0);
    });

    it("repairs an unreadable stored row on the next valid save", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await putRaw("sgoList.source", { nonsense: true });
      await setSetting("sgoList.source", "irs_published", admin);
      expect(await getSetting("sgoList.source")).toBe("irs_published");
      const [entry] = (await listAuditLogs({ targetId: "sgoList.source" })).items;
      expect(entry.metadata).toEqual({ from: "provisional_curated", to: "irs_published" });
    });
  });

  describe("fees.structure: no cut of a 25F gift before the counsel memo", () => {
    const base = { sgoFeeBps: 100, donorServiceFeeBps: 0, approvedAt: null } as const;

    it.each(["sgo_invoiced", "donor_service_fee"] as const)("refuses to activate %s without a memo reference", async (active) => {
      for (const counselMemoRef of [null, "", "   ", "\n\t"]) {
        const attempt = setSetting("fees.structure", { ...base, active, counselMemoRef }, admin);
        await expect(attempt).rejects.toMatchObject({ code: "validation_failed", details: { key: "fees.structure", fields: { counselMemoRef: COUNSEL_MEMO_REQUIRED_MESSAGE } } });
      }
      expect((await getSetting("fees.structure")).active).toBe("none");
      expect(await storedRow("fees.structure")).toBeUndefined();
    });

    it("activates a structure once the memo is recorded, and keeps the invariant on later edits", async () => {
      const approved = { active: "sgo_invoiced", sgoFeeBps: 100, donorServiceFeeBps: 0, counselMemoRef: "Counsel memo 2026-12-15 (synthetic ref)", approvedAt: "2026-12-15T17:00:00Z" } as const;
      await setSetting("fees.structure", approved, admin);
      expect(await getSetting("fees.structure")).toEqual(approved);

      // Removing the memo while a fee is active is the same violation.
      await expect(setSetting("fees.structure", { ...approved, counselMemoRef: null }, admin)).rejects.toMatchObject({ code: "validation_failed" });
      expect(await getSetting("fees.structure")).toEqual(approved);

      // Turning the fee off never needs a memo.
      await setSetting("fees.structure", { ...approved, active: "none", counselMemoRef: null, approvedAt: null }, admin);
      expect((await getSetting("fees.structure")).active).toBe("none");
    });

    it("allows recording the memo and rates ahead of activation", async () => {
      const staged = { active: "none", sgoFeeBps: 100, donorServiceFeeBps: 250, counselMemoRef: "memo-ref (synthetic)", approvedAt: null } as const;
      await setSetting("fees.structure", staged, admin);
      expect(await getSetting("fees.structure")).toEqual(staged);
    });

    it("bounds the rates and rejects malformed shapes", async () => {
      const ok = { active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null, approvedAt: null } as const;
      const bad: unknown[] = [
        { ...ok, sgoFeeBps: 1001 },
        { ...ok, sgoFeeBps: -1 },
        { ...ok, sgoFeeBps: 12.5 },
        { ...ok, sgoFeeBps: "100" },
        { ...ok, donorServiceFeeBps: 1001 },
        { ...ok, donorServiceFeeBps: Number.NaN },
        { ...ok, active: "percentage" },
        { ...ok, approvedAt: "December 15" },
        { ...ok, approvedAt: "2026-12-15" },
        { ...ok, counselMemoRef: 42 },
        { ...ok, counselMemoRef: "x".repeat(501) },
        { ...ok, extra: true },
        { active: "none" },
        null,
        "none",
        [],
      ];
      for (const value of bad) {
        await expect(setSetting("fees.structure", value as SettingValue<"fees.structure">, admin), JSON.stringify(value)).rejects.toMatchObject({ code: "validation_failed" });
      }
      await setSetting("fees.structure", { ...ok, sgoFeeBps: 1000, donorServiceFeeBps: 1000, approvedAt: "2026-12-15T11:00:00-06:00" }, admin);
      expect((await getSetting("fees.structure")).sgoFeeBps).toBe(1000);
    });
  });

  describe("credit.startDate: movable only outside production", () => {
    it("accepts real calendar dates and nothing else", async () => {
      await setSetting("credit.startDate", "2026-11-01", admin);
      expect(await getSetting("credit.startDate")).toBe("2026-11-01");
      for (const bad of ["2027-02-30", "2027-13-01", "01/01/2027", "2027-1-1", "2027-01-01T00:00:00Z", "", "tomorrow", 20270101, null]) {
        await expect(setSetting("credit.startDate", bad as string, admin), String(bad)).rejects.toMatchObject({ code: "validation_failed" });
      }
      expect(await getSetting("credit.startDate")).toBe("2026-11-01");
    });

    it("refuses any non-default value in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await expect(setSetting("credit.startDate", "2026-12-01", admin)).rejects.toMatchObject({ code: "forbidden" });
      expect(await storedRow("credit.startDate")).toBeUndefined();
      expect((await listAuditLogs()).items).toHaveLength(0);
      await expect(setSetting("credit.startDate", "2027-01-01", admin)).resolves.toBe("2027-01-01");
      expect((await storedRow("credit.startDate")).value).toBe("2027-01-01");
    });

    it("ignores a stored override in production (e.g. a database copied from a demo)", async () => {
      await setSetting("credit.startDate", "2026-06-01", admin);
      expect(await getSetting("credit.startDate")).toBe("2026-06-01");
      vi.stubEnv("NODE_ENV", "production");
      expect(await getSetting("credit.startDate")).toBe("2027-01-01");
      expect((await getSettings(["credit.startDate"]))["credit.startDate"]).toBe("2027-01-01");
      expect((await listSettings()).find((s) => s.key === "credit.startDate")).toMatchObject({ value: "2027-01-01", source: "production_locked", productionLocked: true });
    });

    it("leaves ordinary settings changeable in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await setSetting("gifts.liveEnabled", true, admin);
      expect(await getSetting("gifts.liveEnabled")).toBe(true);
    });
  });

  describe("the remaining keys validate their shapes", () => {
    it("gifts.liveEnabled is a real boolean", async () => {
      for (const bad of ["true", 1, null, {}]) {
        await expect(setSetting("gifts.liveEnabled", bad as boolean, admin)).rejects.toMatchObject({ code: "validation_failed" });
      }
      await setSetting("gifts.liveEnabled", true, admin);
      expect(await getSetting("gifts.liveEnabled")).toBe(true);
    });

    it("sgoList.source is one of the two sources", async () => {
      await expect(setSetting("sgoList.source", "state_published" as never, admin)).rejects.toMatchObject({ code: "validation_failed" });
      await setSetting("sgoList.source", "irs_published", admin);
      expect(await getSetting("sgoList.source")).toBe("irs_published");
    });

    it("business.defaultSuccessFee has non-negative integer cents and at most 2000 bps", async () => {
      for (const bad of [{ flatCents: -1, bps: 0 }, { flatCents: 10.5, bps: 0 }, { flatCents: 0, bps: 2001 }, { flatCents: 0, bps: -5 }, { flatCents: 0 }, { flatCents: 0, bps: 0, currency: "usd" }]) {
        await expect(setSetting("business.defaultSuccessFee", bad as SettingValue<"business.defaultSuccessFee">, admin), JSON.stringify(bad)).rejects.toMatchObject({ code: "validation_failed" });
      }
      await setSetting("business.defaultSuccessFee", { flatCents: 0, bps: 2000 }, admin);
      expect(await getSetting("business.defaultSuccessFee")).toEqual({ flatCents: 0, bps: 2000 });
    });

    it("retention.defaults keeps raw uploads between 1 and 365 days", async () => {
      for (const days of [0, 366, -30, 1.5]) {
        await expect(setSetting("retention.defaults", { rawUploadDays: days }, admin)).rejects.toMatchObject({ code: "validation_failed" });
      }
      for (const days of [1, 365]) {
        await setSetting("retention.defaults", { rawUploadDays: days }, admin);
        expect(await getSetting("retention.defaults")).toEqual({ rawUploadDays: days });
      }
    });
  });

  describe("helpers for the admin screen", () => {
    it("parseSettingValue returns typed values and per-field messages", () => {
      expect(parseSettingValue("retention.defaults", { rawUploadDays: 14 })).toEqual({ rawUploadDays: 14 });
      try {
        parseSettingValue("business.defaultSuccessFee", { flatCents: -1, bps: 9999 });
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ code: "validation_failed", status: 422 });
        const fields = (e as { details: { fields: Record<string, string> } }).details.fields;
        expect(Object.keys(fields).sort()).toEqual(["bps", "flatCents"]);
      }
      expect(() => parseSettingValue("gifts.liveEnabled", "yes")).toThrow(/gifts\.liveEnabled/);
    });

    it("lists every setting with its effective value and provenance", async () => {
      setTestNow("2026-12-02T15:00:00.000Z");
      await setSetting("gifts.liveEnabled", true, admin);
      const listed = await listSettings();
      expect(listed.map((s) => s.key)).toEqual(SETTING_KEYS);
      expect(listed.find((s) => s.key === "gifts.liveEnabled")).toMatchObject({
        value: true,
        defaultValue: false,
        source: "stored",
        productionLocked: false,
        updatedBy: "usr_admin",
        updatedAt: new Date("2026-12-02T15:00:00.000Z"),
      });
      expect(listed.find((s) => s.key === "credit.startDate")).toMatchObject({ value: "2027-01-01", source: "default", productionLocked: true, updatedAt: null, updatedBy: null });
    });

    it("ignores rows for keys that no longer exist", async () => {
      await putRaw("legacy.removedKey", { anything: 1 });
      expect(await listSettings()).toHaveLength(SETTING_KEYS.length);
      expect(await getSetting("gifts.liveEnabled")).toBe(false);
    });
  });
});
