import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIST_CSV_LIMITS, parseSgoListCsv } from "./list-csv";

const HEADER = "state,name,ein,status,listed_from,removed_on";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseSgoListCsv (synthetic data only)", () => {
  it("parses the synthetic IRS-list fixture: comments, column order, case, quoting, nine-digit EINs", () => {
    const text = readFileSync(join(__dirname, "fixtures", "irs-list.synthetic.csv"), "utf8");
    const { rows, errors } = parseSgoListCsv(text, "irs_published");
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.line, r.state, r.name, r.ein, r.status, r.listedFrom, r.removedOn])).toEqual([
      [4, "TX", "Synthetic Scholars Fund, Inc.", "00-1234567", "listed", "2027-01-01", null],
      [5, "TX", "Synthetic Niños Educación Fund", "00-2345678", "removed", "2027-01-01", "2027-03-15"],
      [6, "OK", "Synthetic Prairie Grants", "00-3456789", "listed", null, null],
      [9, "TX", "Synthetic Lone Star Aid", "00-4567890", "listed", "2027-01-01", null],
    ]);
    expect(rows[0].raw).toMatchObject({ state: "tx", ein: "001234567", status: "listed" });
  });

  it("parses the sandbox seed file", () => {
    const text = readFileSync(join(process.cwd(), "data", "sgo-list", "provisional-sandbox.csv"), "utf8");
    const { rows, errors } = parseSgoListCsv(text, "provisional_curated");
    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      expect(r.name).toMatch(/^Demo: .*\(sandbox/);
      expect(r.ein).toMatch(/^00-/);
    }
    expect(rows.filter((r) => r.status === "removed")).toHaveLength(1);
  });

  it("accepts BOM, CRLF and blank lines", () => {
    const { rows, errors } = parseSgoListCsv(`﻿${HEADER}\r\n\r\nTX,A Fund,12-3456789,listed,,\r\n`, "provisional_curated");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("allows a missing EIN on the provisional list and requires it on the IRS list", () => {
    expect(parseSgoListCsv(csv("TX,Name Only Fund,,listed,,"), "provisional_curated").errors).toEqual([]);
    expect(parseSgoListCsv(csv("TX,Name Only Fund,,listed,,"), "irs_published").errors).toEqual([{ line: 2, message: "ein is required on the IRS-published list." }]);
  });

  it.each([
    ["state,name,ein,status,listed_from", "missing column(s) removed_on"],
    [`${HEADER},extra`, 'unknown column(s) "extra"'],
    ["state,name,ein,status,listed_from,removed_on,state", "repeated column(s) state"],
    ["", "no header row"],
  ])("rejects a bad header: %s", (header, fragment) => {
    const { rows, errors } = parseSgoListCsv(`${header}\nTX,A,12-3456789,listed,,`, "provisional_curated");
    if (header === "") {
      // An empty first line is skipped, so the data row is read as the header.
      expect(errors[0].message).toContain("header must be exactly");
    } else {
      expect(errors[0].message).toContain(fragment);
    }
    expect(rows).toEqual([]);
  });

  it("reports every bad row with its line number and never returns a partial row", () => {
    const { rows, errors } = parseSgoListCsv(
      csv(
        "XX,Bad State,12-3456789,listed,,",
        "TX,,12-3456780,listed,,",
        "TX,Bad Ein,12-345678,listed,,",
        "TX,Bad Status,12-3456781,pending,,",
        "TX,Bad Date,12-3456782,listed,2027-02-30,",
        "TX,Removed Without Date,12-3456783,removed,,",
        "TX,Listed With Date,12-3456784,listed,,2027-01-01",
        "TX,Removed Before Listed,12-3456785,removed,2027-02-01,2027-01-31",
        "TX,Too Few,12-3456786,listed,",
        "TX,Good,12-3456787,listed,,",
        `TX,${"x".repeat(201)},12-3456788,listed,,`,
        'TX,"Unbalanced,12-3456789,listed,,',
      ),
      "provisional_curated",
    );
    expect(rows.map((r) => r.name)).toEqual(["Good"]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]);
    expect(errors.find((e) => e.line === 2)?.message).toContain("not a two-letter code");
    expect(errors.find((e) => e.line === 6)?.message).toContain("2027-02-30");
    expect(errors.find((e) => e.line === 13)?.message).toContain("Unbalanced quotes");
  });

  it("rejects duplicate (state, EIN) and (state, normalized name) rows, but not the same EIN in two States", () => {
    const { rows, errors } = parseSgoListCsv(
      csv("TX,Fund A,12-3456789,listed,,", "TX,Fund A renamed,123456789,listed,,", "OK,Fund A,12-3456789,listed,,", "TX,Niños Fund,,listed,,", "TX,ninos  FUND,,listed,,"),
      "provisional_curated",
    );
    expect(rows.map((r) => r.line)).toEqual([2, 4, 5]);
    expect(errors).toEqual([
      { line: 3, message: "Duplicate of line 2 (same state and EIN)." },
      { line: 6, message: "Duplicate of line 5 (same state and name)." },
    ]);
  });

  it("keys names in every script, and refuses names with no letters or digits", () => {
    const { rows, errors } = parseSgoListCsv(csv("TX,合成奖学金基金,,listed,,", "TX,合成教育基金,,listed,,", "TX,Synthetic Straße Fund,,listed,,", "TX,Synthetic Strasse Fund,,listed,,", "TX,!!!,,listed,,", "TX,???,,listed,,"), "provisional_curated");
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(errors).toEqual([
      { line: 5, message: "Duplicate of line 4 (same state and name)." },
      { line: 6, message: "name has no letters or digits." },
      { line: 7, message: "name has no letters or digits." },
    ]);
  });

  it("collapses whitespace in names and does not treat formula-looking text specially", () => {
    const { rows } = parseSgoListCsv(csv('TX,"  Spaced    Out   Fund ",12-3456789,listed,,', "TX,=HYPERLINK(1),12-3456780,listed,,"), "provisional_curated");
    expect(rows.map((r) => r.name)).toEqual(["Spaced Out Fund", "=HYPERLINK(1)"]);
  });

  it("refuses files over the size limit without parsing", () => {
    const big = HEADER + "\n" + "x".repeat(LIST_CSV_LIMITS.maxBytes);
    const { rows, errors } = parseSgoListCsv(big, "provisional_curated");
    expect(rows).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 0 });
  });
});
