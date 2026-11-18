import { describe, expect, it } from "vitest";
import { formatLongDate, nameKey, normalizeEin } from "./identity";
import { chooseEntry, describeListing, type ListEntry } from "./list-status";
import { stateDateString } from "./states";

function entry(over: Partial<ListEntry> = {}): ListEntry {
  return {
    id: "sle_synthetic",
    source: "provisional_curated",
    state: "TX",
    name: "Synthetic Fund",
    ein: "00-1234567",
    matchKey: "ein:00-1234567",
    status: "listed",
    listedFrom: null,
    removedOn: null,
    sourceUrl: null,
    sourceRetrievedAt: new Date("2026-11-10T18:00:00Z"),
    raw: null,
    importedAt: new Date("2026-11-10T18:05:00Z"),
    updatedAt: new Date("2026-11-10T18:05:00Z"),
    ...over,
  };
}

describe("identity helpers", () => {
  it("normalizes EINs strictly", () => {
    expect(normalizeEin("12-3456789")).toBe("12-3456789");
    expect(normalizeEin(" 123456789 ")).toBe("12-3456789");
    for (const bad of ["1-23456789", "12-345678", "12 3456789", "abcdefghi", "12-34567890", "", null, 123456789]) expect(normalizeEin(bad)).toBeNull();
  });

  it("builds case- and diacritic-insensitive name keys", () => {
    expect(nameKey("Niños de Texas, Inc.")).toBe("ninos de texas inc");
    expect(nameKey("A & B")).toBe(nameKey("a and b"));
  });

  it("formats calendar dates without a time-zone shift", () => {
    expect(formatLongDate("2027-01-01")).toBe("January 1, 2027");
  });

  it("reads dates in the State's reference zone", () => {
    // Central daylight time (UTC-5) is in force on March 15, 2027.
    expect(stateDateString(new Date("2027-03-15T04:59:00Z"), "TX")).toBe("2027-03-14");
    expect(stateDateString(new Date("2027-03-15T05:00:00Z"), "TX")).toBe("2027-03-15");
  });
});

describe("describeListing", () => {
  it("labels a provisional listing without implying credit eligibility", () => {
    const r = describeListing(entry(), "provisional_curated", new Date("2026-11-18T12:00:00Z"));
    expect(r).toMatchObject({ status: "provisional", source: "provisional_curated", entryId: "sle_synthetic" });
    expect(r.label).toBe("On the provisional list — the IRS SGO list has not been published");
    expect(r.label.toLowerCase()).not.toContain("eligible");
  });

  it("labels an IRS listing with the retrieval date in the State's calendar", () => {
    const e = entry({ source: "irs_published", sourceRetrievedAt: new Date("2027-01-01T03:00:00Z") });
    // 03:00 UTC on January 1 is still December 31 in Texas.
    expect(describeListing(e, "irs_published", new Date("2027-01-05T12:00:00Z")).label).toBe("On the IRS SGO list as of December 31, 2026");
  });

  it("ignores an entry from the inactive source", () => {
    expect(describeListing(entry(), "irs_published", new Date()).status).toBe("unlisted");
    expect(describeListing(entry(), "irs_published", new Date()).label).toBe("Not on the IRS SGO list");
    expect(describeListing(null, "provisional_curated", new Date()).label).toBe("Not on the provisional list");
  });

  it("takes a removal effect from its effective date in Central time, inclusive", () => {
    const e = entry({ status: "removed", removedOn: "2027-03-15" });
    expect(describeListing(e, "provisional_curated", new Date("2027-03-15T04:59:59Z")).status).toBe("provisional");
    const removed = describeListing(e, "provisional_curated", new Date("2027-03-15T05:00:00Z"));
    expect(removed.status).toBe("removed");
    expect(removed.label).toBe("Removed from the provisional list effective March 15, 2027 — gifts can no longer be accepted");
  });

  it("treats a listing as not in effect before listed_from", () => {
    const e = entry({ listedFrom: "2027-01-01" });
    const before = describeListing(e, "provisional_curated", new Date("2027-01-01T05:59:00Z"));
    expect(before).toMatchObject({ status: "unlisted", entryId: "sle_synthetic" });
    expect(before.label).toBe("On the provisional list from January 1, 2027 — not in effect yet");
    expect(describeListing(e, "provisional_curated", new Date("2027-01-01T06:00:00Z")).status).toBe("provisional");
  });
});

describe("chooseEntry", () => {
  const linked = entry({ id: "sle_prov" });
  const irs = entry({ id: "sle_irs", source: "irs_published" });

  it("never matches a profile that was not linked, even with a listed EIN", () => {
    expect(chooseEntry({ ein: "00-1234567", state: "TX", listEntryId: null }, null, [irs], "irs_published")).toBeNull();
  });

  it("uses the linked entry on its own source", () => {
    expect(chooseEntry({ ein: "00-1234567", state: "TX", listEntryId: "sle_prov" }, linked, [], "provisional_curated")?.id).toBe("sle_prov");
  });

  it("carries a verified EIN over to the IRS list in the same State only", () => {
    const p = { ein: "00-1234567", state: "TX", listEntryId: "sle_prov" };
    expect(chooseEntry(p, linked, [irs], "irs_published")?.id).toBe("sle_irs");
    expect(chooseEntry(p, linked, [entry({ id: "sle_ok", source: "irs_published", state: "OK" })], "irs_published")).toBeNull();
    expect(chooseEntry(p, linked, [entry({ id: "sle_other", source: "irs_published", ein: "00-7654321" })], "irs_published")).toBeNull();
  });

  it("does not carry over when the linked entry had no EIN or the EINs disagree", () => {
    expect(chooseEntry({ ein: "00-1234567", state: "TX", listEntryId: "sle_prov" }, entry({ id: "sle_prov", ein: null }), [irs], "irs_published")).toBeNull();
    expect(chooseEntry({ ein: "00-9999999", state: "TX", listEntryId: "sle_prov" }, linked, [irs], "provisional_curated")).toBeNull();
  });
});
