import { describe, expect, it } from "vitest";
import { parseForm, readFile, readFlag, readText, zodFieldErrors } from "./form-data";
import {
  addMemberSchema,
  bpsToPercentInput,
  centsToDollarsInput,
  createSgoFormSchema,
  createSgoFromForm,
  deletionSchema,
  enumParam,
  feeStructureFromForm,
  feeStructureSchema,
  hrefWith,
  importListSchema,
  isCalendarDate,
  linkEntrySchema,
  liveGiftsFromForm,
  liveGiftsSchema,
  orgStatusSchema,
  parseAuditFilter,
  parseCountyParam,
  parseJobsFilter,
  parseListEntryFilter,
  parseOrgFilter,
  parseOutboxFilter,
  parsePercentToBps,
  removeListEntrySchema,
  successFeeSchema,
  textParam,
} from "./forms";

const TODAY = "2026-11-18";

function fd(entries: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

function issues(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, input: unknown): Record<string, string> {
  const r = schema.safeParse(input);
  if (r.success) return {};
  return zodFieldErrors(r.error as Parameters<typeof zodFieldErrors>[0]);
}

describe("primitives", () => {
  it("accepts only real calendar dates", () => {
    expect(isCalendarDate("2027-01-01")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2027-13-01", "2027-1-1", "20270101", "", "1899-12-31", "2027-01-01T00:00:00Z"]) expect(isCalendarDate(bad)).toBe(false);
  });

  it("parses percentages into basis points without floating point", () => {
    expect(parsePercentToBps("2.5")).toBe(250);
    expect(parsePercentToBps("2.5%")).toBe(250);
    expect(parsePercentToBps(" 0.01 ")).toBe(1);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("0.29")).toBe(29);
    for (const bad of ["-1", "1.234", "abc", "", "1e2", "1,5", "1000"]) expect(parsePercentToBps(bad)).toBeNull();
  });

  it("round-trips basis points and cents through the input formats", () => {
    for (const bps of [0, 1, 10, 25, 250, 999, 1000, 2000]) expect(parsePercentToBps(bpsToPercentInput(bps))).toBe(bps);
    expect(bpsToPercentInput(250)).toBe("2.5");
    expect(centsToDollarsInput(0)).toBe("0");
    expect(centsToDollarsInput(2550)).toBe("25.50");
    expect(centsToDollarsInput(100)).toBe("1");
    expect(() => bpsToPercentInput(-1)).toThrow();
    expect(() => centsToDollarsInput(1.5)).toThrow();
  });

  it("reads FormData defensively", () => {
    const f = fd({ a: " x ", flag: "on", file: new File(["data"], "list.csv", { type: "text/csv" }) });
    expect(readText(f, "a")).toBe(" x ");
    expect(readText(f, "missing")).toBe("");
    expect(readText(f, "file")).toBe("");
    expect(readFlag(f, "flag")).toBe(true);
    expect(readFlag(f, "a")).toBe(false);
    expect(readFile(f, "file")?.name).toBe("list.csv");
    expect(readFile(f, "a")).toBeNull();
    expect(readFile(fd({ empty: new File([], "") }), "empty")).toBeNull();
  });

  it("parseForm throws validation_failed with per-field messages", () => {
    expect(() => parseForm(addMemberSchema, { orgId: "org_1", email: "", role: "boss" })).toThrow(expect.objectContaining({ code: "validation_failed", details: { fields: expect.objectContaining({ email: expect.any(String), role: expect.any(String) }) } }));
  });
});

describe("fee structure form", () => {
  const schema = feeStructureSchema(TODAY);
  const base = { active: "none", sgoFeePercent: "", donorServiceFeePercent: "", counselMemoRef: "", approvedOn: "" };

  it("allows none without a memo and stores zero rates", () => {
    expect(schema.parse(base)).toEqual({ active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null, approvedAt: null });
  });

  it("refuses to leave none without the memo reference and date", () => {
    const e = issues(schema, { ...base, active: "sgo_invoiced", sgoFeePercent: "3" });
    expect(e.counselMemoRef).toMatch(/counsel/i);
    expect(e.approvedOn).toMatch(/date/i);
  });

  it("refuses a whitespace-only memo reference", () => {
    expect(issues(schema, { ...base, active: "donor_service_fee", donorServiceFeePercent: "2", counselMemoRef: "   ", approvedOn: "2026-11-01" }).counselMemoRef).toBeDefined();
  });

  it("requires a non-zero rate for the structure being activated", () => {
    expect(issues(schema, { ...base, active: "sgo_invoiced", counselMemoRef: "MEMO-1", approvedOn: "2026-11-01" }).sgoFeePercent).toBeDefined();
    expect(issues(schema, { ...base, active: "donor_service_fee", counselMemoRef: "MEMO-1", approvedOn: "2026-11-01" }).donorServiceFeePercent).toBeDefined();
  });

  it("refuses rates above the registry maximum and malformed rates", () => {
    expect(issues(schema, { ...base, sgoFeePercent: "10.01" }).sgoFeePercent).toMatch(/at most 10%/);
    expect(issues(schema, { ...base, donorServiceFeePercent: "abc" }).donorServiceFeePercent).toBeDefined();
  });

  it("refuses a memo date in the future or not a date", () => {
    expect(issues(schema, { ...base, approvedOn: "2026-11-19" }).approvedOn).toMatch(/future/);
    expect(issues(schema, { ...base, approvedOn: "2026-02-30" }).approvedOn).toBeDefined();
  });

  it("produces the settings value with approvedAt at midnight UTC of the memo date", () => {
    const value = schema.parse({ active: "sgo_invoiced", sgoFeePercent: "2.5", donorServiceFeePercent: "0", counselMemoRef: " MEMO-2026-17 ", approvedOn: "2026-11-18" });
    expect(value).toEqual({ active: "sgo_invoiced", sgoFeeBps: 250, donorServiceFeeBps: 0, counselMemoRef: "MEMO-2026-17", approvedAt: "2026-11-18T00:00:00.000Z" });
  });

  it("reads the form fields by name", () => {
    expect(feeStructureFromForm(fd({ active: "none", sgoFeePercent: "1", donorServiceFeePercent: "2", counselMemoRef: "m", approvedOn: TODAY }))).toEqual({
      active: "none",
      sgoFeePercent: "1",
      donorServiceFeePercent: "2",
      counselMemoRef: "m",
      approvedOn: TODAY,
    });
  });
});

describe("live gifts form", () => {
  it("turning off needs nothing", () => {
    expect(liveGiftsSchema.safeParse(liveGiftsFromForm(fd({ enabled: "off" }))).success).toBe(true);
  });

  it("turning on needs the acknowledgment and a counsel reference", () => {
    const e = issues(liveGiftsSchema, liveGiftsFromForm(fd({ enabled: "on" })));
    expect(Object.keys(e).sort()).toEqual(["acknowledged", "counselReference"]);
    expect(issues(liveGiftsSchema, liveGiftsFromForm(fd({ enabled: "on", acknowledged: "on", counselReference: "ab" }))).counselReference).toBeDefined();
    expect(liveGiftsSchema.parse(liveGiftsFromForm(fd({ enabled: "on", acknowledged: "on", counselReference: " MEMO-9 " })))).toEqual({ enabled: true, acknowledged: true, counselReference: "MEMO-9" });
  });

  it("anything but enabled=on means off", () => {
    expect(liveGiftsFromForm(fd({ enabled: "true" })).enabled).toBe(false);
  });
});

describe("SGO list forms", () => {
  it("validates an import", () => {
    expect(importListSchema.parse({ source: "irs_published", sourceUrl: "", retrievedOn: TODAY })).toEqual({ source: "irs_published", sourceUrl: null, retrievedOn: TODAY });
    expect(Object.keys(issues(importListSchema, { source: "other", sourceUrl: "", retrievedOn: "yesterday" })).sort()).toEqual(["retrievedOn", "source"]);
  });

  it("validates a removal", () => {
    expect(removeListEntrySchema.parse({ entryId: "sle_abc", removedOn: "2027-03-15", learnedOn: TODAY, sourceUrl: "" }).sourceUrl).toBeNull();
    expect(issues(removeListEntrySchema, { entryId: "sle abc;", removedOn: "2027-03-15", learnedOn: TODAY, sourceUrl: "" }).entryId).toBeDefined();
  });

  it("treats an empty entry as unlink", () => {
    expect(linkEntrySchema.parse({ orgId: "org_1", entryId: "" })).toEqual({ orgId: "org_1", entryId: null });
    expect(linkEntrySchema.parse({ orgId: "org_1", entryId: "sle_1" })).toEqual({ orgId: "org_1", entryId: "sle_1" });
    expect(linkEntrySchema.safeParse({ orgId: "org_1", entryId: "../x" }).success).toBe(false);
  });
});

describe("organization forms", () => {
  it("defaults the SGO State to TX and upper-cases it", () => {
    expect(createSgoFromForm(fd({ name: "A" })).state).toBe("TX");
    expect(createSgoFormSchema.parse({ name: " Fund ", ein: "", city: "", state: "tx", ownerEmail: "o@example.org" })).toEqual({ name: "Fund", ein: null, city: null, state: "TX", ownerEmail: "o@example.org" });
  });

  it("requires a reason for status changes and only allows active/suspended", () => {
    expect(issues(orgStatusSchema, { orgId: "org_1", status: "active", reason: "bad" }).reason).toBeDefined();
    expect(issues(orgStatusSchema, { orgId: "org_1", status: "pending", reason: "Because of a contract change" }).status).toBeDefined();
  });

  it("parses success fees in dollars and percent", () => {
    expect(successFeeSchema.parse({ orgId: "org_1", flatDollars: "$1,250.50", percent: "2.5" })).toEqual({ orgId: "org_1", flatDollars: 125050, percent: 250 });
    expect(successFeeSchema.parse({ orgId: "org_1", flatDollars: "", percent: "" })).toEqual({ orgId: "org_1", flatDollars: 0, percent: 0 });
    const e = issues(successFeeSchema, { orgId: "org_1", flatDollars: "10000.01", percent: "20.01" });
    expect(Object.keys(e).sort()).toEqual(["flatDollars", "percent"]);
    expect(issues(successFeeSchema, { orgId: "org_1", flatDollars: "-5", percent: "1" }).flatDollars).toBeDefined();
  });

  it("requires a substantive deletion reason", () => {
    expect(issues(deletionSchema, { householdId: "hh_1", reason: "  short  " }).reason).toBeDefined();
    expect(issues(deletionSchema, { householdId: "hh_1", reason: "x".repeat(501) }).reason).toBeDefined();
  });
});

describe("filters", () => {
  it("reads the first value and ignores unknown enum values", () => {
    expect(enumParam({ s: ["dead", "queued"] }, "s", ["dead", "queued"] as const)).toBe("dead");
    expect(enumParam({ s: "DROP TABLE" }, "s", ["dead"] as const, "dead")).toBe("dead");
    expect(textParam({ q: "a\u0000b" }, "q")).toBeUndefined();
    expect(textParam({ q: "x".repeat(201) }, "q")).toBeUndefined();
    expect(textParam({ q: "  ok " }, "q")).toBe("ok");
  });

  it("parses the audit filter and refuses unsafe cursors", () => {
    expect(parseAuditFilter({ orgId: "org_1", action: "settings.update", before: "abc_-123" })).toEqual({ orgId: "org_1", action: "settings.update", before: "abc_-123" });
    expect(parseAuditFilter({ before: "a b" })).toEqual({});
  });

  it("defaults jobs to failed and clamps the page", () => {
    expect(parseJobsFilter({})).toEqual({ status: "dead", page: 1 });
    expect(parseJobsFilter({ status: "all", page: "3", type: "webhook.deliver" })).toEqual({ status: "all", type: "webhook.deliver", page: 3 });
    expect(parseJobsFilter({ page: "0" }).page).toBe(1);
    expect(parseJobsFilter({ page: "2.5" }).page).toBe(1);
    expect(parseJobsFilter({ page: "99999" }).page).toBe(1);
  });

  it("parses organization, list, outbox and county filters", () => {
    expect(parseOrgFilter({ type: "sgo", status: "suspended", q: "fund" })).toEqual({ type: "sgo", status: "suspended", q: "fund" });
    expect(parseOrgFilter({ type: "bank" })).toEqual({});
    expect(parseListEntryFilter({ state: "tx", source: "irs_published", status: "removed", q: "fund" })).toEqual({ state: "TX", source: "irs_published", status: "removed", query: "fund" });
    expect(parseListEntryFilter({ state: "Texas" })).toEqual({});
    expect(parseOutboxFilter({ to: "a@example.com", template: "" })).toEqual({ to: "a@example.com" });
    expect(parseCountyParam({ county: "48201" })).toBe("48201");
    expect(parseCountyParam({ county: "4820" })).toBeUndefined();
  });

  it("builds hrefs without empty parameters and with encoding", () => {
    expect(hrefWith("/admin/jobs", { status: "dead", type: undefined, page: 2 })).toBe("/admin/jobs?status=dead&page=2");
    expect(hrefWith("/admin/audit", {})).toBe("/admin/audit");
    expect(hrefWith("/admin/audit", { action: "a&b=c" })).toBe("/admin/audit?action=a%26b%3Dc");
  });
});
