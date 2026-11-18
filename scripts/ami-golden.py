#!/usr/bin/env python3
"""Independent golden numbers for the Texas income engine.

This script is the second, independent implementation of the provisional section 25F income limit. It
shares NO code and NO intermediate data with the TypeScript engine (src/engine/ami) or its ingest: it reads
the official HUD workbook itself (zipfile + xml, Python standard library only) and does its own arithmetic
with exact rationals. The Vitest suite then requires the engine to reproduce every row it writes.

Rule implemented (proposed regulations REG-117199-25, economic analysis, "Defining a Family Size
Adjustment" and Table 1):

    limit = 300% x area median gross income x HUD family-size multiplier
    multipliers for family sizes 1..8: 0.70 0.80 0.90 1.00 1.08 1.16 1.24 1.32
    each member above 8 adds 0.08
    (the rule's example: median $100,000 -> $270,000 for 3 persons, $300,000 for 4)

No rounding is applied. The script fails if any limit is not a whole number of cents.

Output: src/engine/ami/__golden__/hud-fy2026-tx-thresholds.csv with the columns
    fips, county, area_code, median, size, threshold_cents
one row per Texas county and family size 1..8 (254 x 8 = 2,032 rows), plus sizes 9..12 for a fixed sample
of counties.

Usage (from the repository root; -I keeps Python from importing anything but the standard library):

    python3 -I scripts/ami-golden.py            # rewrite the golden file
    python3 -I scripts/ami-golden.py --check    # verify the committed golden file, change nothing

The golden file is owned by the founder. Regenerate it only when the HUD source file changes, and review the
diff by hand before committing it. These figures are HUD-derived and provisional; they are not IRS limits.
"""

import argparse
import csv
import hashlib
import io
import os
import re
import sys
import zipfile
from decimal import Decimal
from fractions import Fraction
from xml.etree import ElementTree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLSX = os.path.join(REPO_ROOT, "data", "hud", "Section8-FY26.xlsx")
DEFAULT_OUT = os.path.join(REPO_ROOT, "src", "engine", "ami", "__golden__", "hud-fy2026-tx-thresholds.csv")

# SHA-256 of the official file https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx
PINNED_SHA256 = "bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0"

SHEET_NAME = "Section8-FY26"
MEDIAN_COLUMN = "median2026"
STATE_POSTAL = "TX"
STATE_FIPS = "48"
EXPECTED_COUNTIES = 254

CAP = Fraction(300, 100)
MULTIPLIERS = [Fraction(Decimal(text)) for text in ("0.70", "0.80", "0.90", "1.00", "1.08", "1.16", "1.24", "1.32")]
PER_EXTRA_PERSON = Fraction(Decimal("0.08"))

# Family sizes 9..12 are written for these counties only: the largest metros, the lowest and highest
# medians in the state, the cross-state Texarkana area, and two county/city name traps.
LARGE_HOUSEHOLD_SAMPLE = (
    "48015",  # Austin County (not the city of Austin)
    "48029",  # Bexar
    "48037",  # Bowie (Texarkana area, shared with Arkansas)
    "48113",  # Dallas
    "48141",  # El Paso
    "48173",  # Glasscock (highest median)
    "48201",  # Harris
    "48215",  # Hidalgo
    "48225",  # Houston County (not the city of Houston)
    "48301",  # Loving
    "48427",  # Starr (lowest median)
    "48439",  # Tarrant
    "48453",  # Travis
)
LARGE_HOUSEHOLD_SIZES = (9, 10, 11, 12)

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_DOC_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def fail(message):
    sys.stderr.write("ami-golden: " + message + "\n")
    sys.exit(1)


def multiplier(size):
    if size < 1:
        raise ValueError("family size must be at least 1")
    if size <= 8:
        return MULTIPLIERS[size - 1]
    return MULTIPLIERS[7] + PER_EXTRA_PERSON * (size - 8)


def limit_cents(median_dollars, size):
    dollars = CAP * Fraction(median_dollars) * multiplier(size)
    cents = dollars * 100
    if cents.denominator != 1:
        fail("limit for median %d, size %d is not a whole number of cents: %s" % (median_dollars, size, cents))
    return cents.numerator


def column_index(reference):
    letters = re.match(r"^([A-Z]+)[0-9]+$", reference)
    if not letters:
        fail("unexpected cell reference %r" % reference)
    index = 0
    for letter in letters.group(1):
        index = index * 26 + (ord(letter) - 64)
    return index - 1


def string_item_text(element):
    # Plain text is in <t>; rich text is split across <r><t> runs. Phonetic runs (<rPh>) are not text.
    parts = []
    for child in element:
        if child.tag == NS_MAIN + "t":
            parts.append(child.text or "")
        elif child.tag == NS_MAIN + "r":
            for run_child in child:
                if run_child.tag == NS_MAIN + "t":
                    parts.append(run_child.text or "")
    return "".join(parts)


def read_sheet(xlsx_bytes, sheet_name):
    """Returns the sheet as a list of rows; each row is a list of cell values (str, int/Fraction or None)."""
    archive = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationship_id = None
    for sheet in workbook.iter(NS_MAIN + "sheet"):
        if sheet.get("name") == sheet_name:
            relationship_id = sheet.get(NS_DOC_REL + "id")
    if relationship_id is None:
        fail("workbook has no sheet named %r" % sheet_name)

    sheet_path = None
    shared_strings_path = None
    for relationship in ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels")).iter(NS_PKG_REL + "Relationship"):
        target = relationship.get("Target")
        path = target[1:] if target.startswith("/") else "xl/" + target
        if relationship.get("Id") == relationship_id:
            sheet_path = path
        if relationship.get("Type", "").endswith("/sharedStrings"):
            shared_strings_path = path
    if sheet_path is None:
        fail("could not locate the worksheet part for %r" % sheet_name)

    shared_strings = []
    if shared_strings_path is not None:
        for item in ElementTree.fromstring(archive.read(shared_strings_path)).iter(NS_MAIN + "si"):
            shared_strings.append(string_item_text(item))

    rows = []
    sheet_data = ElementTree.fromstring(archive.read(sheet_path)).find(NS_MAIN + "sheetData")
    for row in sheet_data.iter(NS_MAIN + "row"):
        cells = []
        for cell in row.iter(NS_MAIN + "c"):
            index = column_index(cell.get("r"))
            cell_type = cell.get("t", "n")
            value_element = cell.find(NS_MAIN + "v")
            raw = value_element.text if value_element is not None else None
            if cell_type == "s":
                value = shared_strings[int(raw)]
            elif cell_type == "inlineStr":
                value = string_item_text(cell.find(NS_MAIN + "is"))
            elif cell_type == "str":
                value = raw or ""
            elif cell_type == "n":
                if raw is None or raw.strip() == "":
                    value = None
                else:
                    number = Fraction(Decimal(raw.strip()))
                    value = number.numerator if number.denominator == 1 else number
            else:
                fail("cell %s has unsupported type %r" % (cell.get("r"), cell_type))
            while len(cells) < index:
                cells.append(None)
            cells.append(value)
        if any(value not in (None, "") for value in cells):
            rows.append(cells)
    return rows


def texas_counties(rows):
    header = {}
    for position, name in enumerate(rows[0]):
        if isinstance(name, str):
            header[name.strip().lower()] = position
    for required in ("fips", "stusps", "state", "county", "county_name", "hud_area_code", MEDIAN_COLUMN):
        if required not in header:
            fail("sheet has no %r column" % required)

    def value(row, name):
        position = header[name]
        return row[position] if position < len(row) else None

    counties = {}
    for row in rows[1:]:
        if value(row, "stusps") != STATE_POSTAL:
            continue
        fips = value(row, "fips")
        county_code = value(row, "county")
        if not (isinstance(fips, str) and re.match(r"^[0-9]{10}$", fips)):
            fail("malformed fips %r" % (fips,))
        if value(row, "state") != STATE_FIPS or fips[:2] != STATE_FIPS or fips[2:5] != county_code or fips[5:] != "99999":
            fail("row for fips %s is not a whole Texas county row" % fips)
        median = value(row, MEDIAN_COLUMN)
        if not (isinstance(median, int) and not isinstance(median, bool) and median > 0):
            fail("median for fips %s is not a positive whole number: %r" % (fips, median))
        name = value(row, "county_name")
        area_code = value(row, "hud_area_code")
        if not (isinstance(name, str) and name.strip()) or not (isinstance(area_code, str) and area_code.strip()):
            fail("missing county name or area code for fips %s" % fips)
        fips5 = fips[:5]
        if fips5 in counties:
            fail("county %s appears more than once" % fips5)
        counties[fips5] = (name.strip(), area_code.strip(), median)
    if len(counties) != EXPECTED_COUNTIES:
        fail("expected %d Texas counties, found %d" % (EXPECTED_COUNTIES, len(counties)))
    for fips5 in LARGE_HOUSEHOLD_SAMPLE:
        if fips5 not in counties:
            fail("sample county %s is not in the workbook" % fips5)
    return counties


def render(counties):
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["fips", "county", "area_code", "median", "size", "threshold_cents"])
    for fips5 in sorted(counties):
        name, area_code, median = counties[fips5]
        sizes = list(range(1, 9))
        if fips5 in LARGE_HOUSEHOLD_SAMPLE:
            sizes.extend(LARGE_HOUSEHOLD_SIZES)
        for size in sizes:
            writer.writerow([fips5, name, area_code, median, size, limit_cents(median, size)])
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Write or check the independent golden thresholds for the Texas income engine.")
    parser.add_argument("--xlsx", default=DEFAULT_XLSX, help="HUD Section 8 income-limit workbook")
    parser.add_argument("--out", default=DEFAULT_OUT, help="golden CSV to write or check")
    parser.add_argument("--check", action="store_true", help="compare with the existing golden file instead of writing it")
    arguments = parser.parse_args()

    with open(arguments.xlsx, "rb") as handle:
        xlsx_bytes = handle.read()
    digest = hashlib.sha256(xlsx_bytes).hexdigest()
    # Checked before the XML is parsed: only the pinned official file is ever read.
    if digest != PINNED_SHA256:
        fail("%s has sha256 %s, expected the pinned official file %s" % (arguments.xlsx, digest, PINNED_SHA256))

    # The rule's own worked example must come out of this arithmetic before anything is written.
    if limit_cents(100000, 3) != 27000000 or limit_cents(100000, 4) != 30000000:
        fail("self-test failed: the proposed rule's $100,000 example does not reproduce")

    counties = texas_counties(read_sheet(xlsx_bytes, SHEET_NAME))
    text = render(counties)
    data_rows = text.count("\n") - 1

    if arguments.check:
        with open(arguments.out, "r", encoding="utf-8", newline="") as handle:
            existing = handle.read()
        if existing != text:
            fail("%s does not match the numbers computed from the workbook; regenerate it and review the diff" % arguments.out)
        print("ami-golden: %s is up to date (%d rows)" % (arguments.out, data_rows))
        return

    os.makedirs(os.path.dirname(arguments.out), exist_ok=True)
    with open(arguments.out, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)
    print("ami-golden: wrote %s (%d counties, %d rows)" % (arguments.out, len(counties), data_rows))


if __name__ == "__main__":
    main()
