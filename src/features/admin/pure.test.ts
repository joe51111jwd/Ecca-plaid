import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSgoListCsv } from "@/server/sgos";
import { buildFeePreviews, ILLUSTRATIVE_GIFT_CENTS } from "./fee-preview";
import { daysBetween, summarizeGates, type GateInput } from "./gates";
import { adminNav } from "./nav";
import { IRS_TABLE_SWAP_IN_STEPS, SWAP_IN_RUNBOOK_PATH } from "./runbook";
import { assertRemovable, buildRemovalCsv, type RemovableEntry } from "./sgo-list-removal";

const ROOT = join(__dirname, "..", "..", "..");

describe("fee previews", () => {
  it("never reduces the designated amount and keeps any fee on its own line", () => {
    for (const rates of [
      { sgoFeeBps: 0, donorServiceFeeBps: 0 },
      { sgoFeeBps: 250, donorServiceFeeBps: 300 },
      { sgoFeeBps: 1000, donorServiceFeeBps: 1000 },
    ]) {
      const previews = buildFeePreviews({ active: "none", ...rates });
      expect(previews.map((p) => p.structure)).toEqual(["none", "sgo_invoiced", "donor_service_fee"]);
      for (const p of previews) {
        expect(p.lines.depositedTo25fAccountCents).toBe(ILLUSTRATIVE_GIFT_CENTS);
        const designated = p.lines.lines.find((l) => l.kind === "designated_contribution");
        expect(designated?.amountCents).toBe(ILLUSTRATIVE_GIFT_CENTS);
        expect(p.lines.chargedToDonorCents).toBe(p.lines.lines.reduce((sum, l) => sum + l.amountCents, 0));
      }
      const none = previews[0];
      expect(none.lines.platformRevenueCents).toBe(0);
      expect(none.counselMemoRequirement).toBeNull();
      expect(previews[1].lines.sgoInvoicedFeeCents).toBe((ILLUSTRATIVE_GIFT_CENTS * rates.sgoFeeBps) / 10_000);
      expect(previews[1].lines.chargedToDonorCents).toBe(ILLUSTRATIVE_GIFT_CENTS);
      expect(previews[2].lines.donorServiceFeeCents).toBe((ILLUSTRATIVE_GIFT_CENTS * rates.donorServiceFeeBps) / 10_000);
      expect(previews[1].counselMemoRequirement).not.toBeNull();
    }
  });

  it("marks the active structure and flags a structure with no rate on file", () => {
    const previews = buildFeePreviews({ active: "sgo_invoiced", sgoFeeBps: 0, donorServiceFeeBps: 200 });
    expect(previews.filter((p) => p.isActive).map((p) => p.structure)).toEqual(["sgo_invoiced"]);
    expect(previews.find((p) => p.structure === "sgo_invoiced")?.rateMissing).toBe(true);
    expect(previews.find((p) => p.structure === "donor_service_fee")?.rateMissing).toBe(false);
    expect(previews.find((p) => p.structure === "none")?.rateMissing).toBe(false);
  });
});

describe("gate summary", () => {
  const base: GateInput = {
    today: "2026-11-18",
    fees: { active: "none", counselMemoRef: null, title: "No platform fee" },
    liveGiftsEnabled: false,
    creditStartDate: "2027-01-01",
    creditStartLocked: false,
    listSource: "provisional_curated",
    listedEntries: { provisional_curated: 3, irs_published: 0 },
    incomeTable: { version: "hud-fy2026-tx", provisional: true },
  };
  const byKey = (input: GateInput) => Object.fromEntries(summarizeGates(input).map((g) => [g.key, g]));

  it("counts days in calendar terms", () => {
    expect(daysBetween("2026-11-18", "2027-01-01")).toBe(44);
    expect(daysBetween("2027-01-01", "2027-01-01")).toBe(0);
    expect(daysBetween("2027-01-02", "2027-01-01")).toBe(-1);
    expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
    expect(() => daysBetween("2027-02-30", "2027-03-01")).toThrow();
  });

  it("reports the conservative defaults", () => {
    const g = byKey(base);
    expect(Object.keys(g)).toEqual(["fees", "live_gifts", "credit_start", "sgo_list", "income_table"]);
    expect(g.fees.value).toBe("None");
    expect(g.live_gifts.value).toBe("Off");
    expect(g.credit_start.detail).toMatch(/^44 days away/);
    expect(g.sgo_list.tone).toBe("caution");
    expect(g.sgo_list.detail).toMatch(/provisional/);
    expect(g.income_table.tone).toBe("caution");
    expect(g.income_table.value).toBe("HUD-derived");
    expect(byKey({ ...base, incomeTable: { version: "irs-2027", provisional: false } }).income_table).toMatchObject({ value: "IRS-published", tone: "neutral" });
  });

  it("warns when live gifts are on before the credit start date", () => {
    const g = byKey({ ...base, liveGiftsEnabled: true });
    expect(g.live_gifts.value).toBe("On (held)");
    expect(g.live_gifts.detail).toContain("2027-01-01");
    const after = byKey({ ...base, liveGiftsEnabled: true, today: "2027-01-01" });
    expect(after.live_gifts.value).toBe("On");
    expect(after.credit_start.detail).toMatch(/^In effect/);
  });

  it("says one day, and notes a production lock", () => {
    expect(byKey({ ...base, today: "2026-12-31", creditStartLocked: true }).credit_start.detail).toBe("1 day away. Gifts before it do not earn the credit. Fixed in production.");
  });

  it("flags an empty active list as stopping all gifts", () => {
    const g = byKey({ ...base, listSource: "irs_published" });
    expect(g.sgo_list.tone).toBe("danger");
    expect(g.sgo_list.value).toBe("IRS-published (empty)");
  });

  it("names the fee structure and memo when one is active, and never calls the IRS list provisional", () => {
    const g = byKey({ ...base, fees: { active: "sgo_invoiced", counselMemoRef: "MEMO-1", title: "Invoiced to the SGO" }, listSource: "irs_published", listedEntries: { provisional_curated: 0, irs_published: 1 } });
    expect(g.fees.value).toBe("Invoiced to the SGO");
    expect(g.fees.detail).toContain("MEMO-1");
    expect(g.sgo_list.detail).toBe("1 listed entry on the imported IRS list.");
    expect(g.sgo_list.detail).not.toMatch(/provisional/i);
  });
});

describe("removal list file", () => {
  const entry: RemovableEntry = {
    id: "sle_SYNTHETIC",
    source: "provisional_curated",
    state: "TX",
    name: 'Synthetic "Quoted", Fund',
    ein: "00-1234567",
    status: "listed",
    listedFrom: "2027-01-01",
    removedOn: null,
  };

  it("produces a one-row file the list parser accepts unchanged", () => {
    const parsed = parseSgoListCsv(buildRemovalCsv(entry, "2027-03-15"), "provisional_curated");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ state: "TX", name: 'Synthetic "Quoted", Fund', ein: "00-1234567", status: "removed", listedFrom: "2027-01-01", removedOn: "2027-03-15" });
  });

  it("keeps a name that starts like a spreadsheet formula byte-for-byte", () => {
    const parsed = parseSgoListCsv(buildRemovalCsv({ ...entry, name: "=Synthetic Fund" }, "2027-03-15"), "provisional_curated");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].name).toBe("=Synthetic Fund");
  });

  it("works for a name-keyed provisional entry and for an IRS entry", () => {
    expect(parseSgoListCsv(buildRemovalCsv({ ...entry, ein: null, listedFrom: null }, "2027-03-15"), "provisional_curated").errors).toEqual([]);
    expect(parseSgoListCsv(buildRemovalCsv({ ...entry, source: "irs_published" }, "2027-03-15"), "irs_published").errors).toEqual([]);
  });

  it("refuses a removal before the listing date, a repeat, or a bad date", () => {
    expect(() => assertRemovable(entry, "2026-12-31")).toThrow(expect.objectContaining({ code: "validation_failed" }));
    expect(() => assertRemovable({ ...entry, status: "removed", removedOn: "2027-03-15" }, "2027-03-15")).toThrow(/already removed/);
    expect(() => assertRemovable(entry, "2027-02-30")).toThrow();
    expect(() => assertRemovable({ ...entry, status: "removed", removedOn: "2027-03-15" }, "2027-04-01")).not.toThrow();
  });
});

describe("runbook", () => {
  it("matches the runbook document step for step", () => {
    const doc = readFileSync(join(ROOT, SWAP_IN_RUNBOOK_PATH), "utf8");
    expect(IRS_TABLE_SWAP_IN_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const s of IRS_TABLE_SWAP_IN_STEPS) {
      expect(doc).toContain(`| ${s.step} | ${s.what} |`);
      if (s.command && s.step !== 8) expect(doc).toContain(s.command);
    }
    expect(doc).toContain("`npx vitest run src/engine/ami` then `npm test`");
  });
});

describe("navigation", () => {
  it("links only to pages that exist, each once", () => {
    const hrefs = adminNav().flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/admin")).toBe(true);
      expect(existsSync(join(ROOT, "src", "app", ...href.split("/").filter(Boolean), "page.tsx"))).toBe(true);
    }
  });

  it("shows the failed-job count only when there is one", () => {
    const jobs = (n?: number) => adminNav({ deadJobs: n }).flatMap((s) => s.items).find((i) => i.href === "/admin/jobs");
    expect(jobs(3)?.count).toBe(3);
    expect(jobs(0)?.count).toBeUndefined();
    expect(jobs()?.count).toBeUndefined();
  });
});
