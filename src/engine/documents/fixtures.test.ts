/**
 * Manifest-driven end-to-end test: reads every SYNTHETIC fixture in tests/fixtures/synthetic/ through
 * `readDocument` and checks classification, every expected field, the summaries and the exact review and
 * not-acceptable reasons. Also checks that the committed files are what the catalog generates today.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findFullSsns, readDocument, type DocumentReadResult } from "./index";
import { FIXTURE_HOUSEHOLD, FIXTURE_REFERENCE_DATE, SYNTHETIC_FIXTURES, type FixtureExpectation } from "./synthetic-catalog";

const DIR = resolve(__dirname, "../../../tests/fixtures/synthetic");

interface ManifestEntry {
  id: string;
  file: string;
  contentType: string;
  declaredKind: string;
  expected: FixtureExpectation;
}
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  referenceDate: string;
  household: typeof FIXTURE_HOUSEHOLD;
  fixtures: ManifestEntry[];
};

async function read(entry: ManifestEntry): Promise<DocumentReadResult> {
  return readDocument({
    bytes: new Uint8Array(readFileSync(join(DIR, entry.file))),
    contentType: entry.contentType,
    declaredKind: entry.declaredKind as never,
    referenceDate: manifest.referenceDate,
    household: [...manifest.household],
  });
}

describe("synthetic fixture manifest", () => {
  it("matches the catalog and carries at least 20 distinct documents", () => {
    expect(manifest.referenceDate).toBe(FIXTURE_REFERENCE_DATE);
    expect(manifest.fixtures.map((f) => f.id)).toEqual(SYNTHETIC_FIXTURES.map((f) => f.id));
    expect(new Set(manifest.fixtures.map((f) => f.file)).size).toBeGreaterThanOrEqual(20);
    for (const f of manifest.fixtures) expect(f.file).toMatch(/^SYNTHETIC_/);
  });

  it("committed files are byte-identical to what the generator produces", async () => {
    for (const f of SYNTHETIC_FIXTURES) {
      if (!f.build) continue;
      const fresh = await f.build();
      const committed = new Uint8Array(readFileSync(join(DIR, f.file)));
      expect(Buffer.compare(Buffer.from(fresh), Buffer.from(committed)), `${f.file} is stale: run npx tsx scripts/make-fixtures.ts`).toBe(0);
    }
  });

  it("every PDF fixture with a text layer carries the synthetic banner", async () => {
    for (const entry of manifest.fixtures) {
      const r = await read(entry);
      if (r.textSource === "pdf_text") expect(r.synthetic, entry.id).toBe(true);
    }
  });
});

describe.each(manifest.fixtures.map((f) => [f.id, f] as const))("fixture %s", (_id, entry) => {
  it("reads as expected", async () => {
    const r = await read(entry);
    const e = entry.expected;
    const ctx = `${entry.id} ${entry.file}`;
    expect(r.status, ctx).toBe(e.status);
    expect(r.detectedKind, ctx).toBe(e.kind);
    expect(r.classification?.subtype ?? null, ctx).toBe(e.subtype);
    expect(r.reviewReasons.map((x) => x.code).sort(), ctx).toEqual([...e.reviewReasons].sort());
    expect(r.notAcceptable.map((x) => x.code).sort(), ctx).toEqual([...e.notAcceptable].sort());
    for (const [key, value] of Object.entries(e.fields ?? {})) {
      expect(r.extraction?.fields[key]?.value, `${ctx} field ${key}`).toEqual(value);
    }
    for (const key of e.absentFields ?? []) expect(r.extraction?.fields[key], `${ctx} field ${key} must be absent`).toBeUndefined();
    if (e.award) {
      expect(r.extraction?.award, ctx).not.toBeNull();
      for (const [key, value] of Object.entries(e.award)) {
        expect((r.extraction!.award as unknown as Record<string, unknown>)[key], `${ctx} award.${key}`).toEqual(value);
      }
    }
    if (e.income) {
      const income = r.extraction?.income;
      expect(income, ctx).toBeTruthy();
      if (e.income.taxYear !== undefined) expect(income!.taxYear, ctx).toBe(e.income.taxYear);
      if (e.income.selfEmploymentIndicated !== undefined) expect(income!.selfEmploymentIndicated, ctx).toBe(e.income.selfEmploymentIndicated);
      if (e.income.likelyFinalStubOfYear !== undefined) expect(income!.likelyFinalStubOfYear, ctx).toBe(e.income.likelyFinalStubOfYear);
      for (const a of e.income.amounts ?? []) {
        expect(income!.amounts.some((x) => x.measure === a.measure && x.amountCents === a.amountCents), `${ctx} amount ${a.measure}`).toBe(true);
      }
    }
    // Never a silent yes: anything not cleanly extracted has a reason; extracted documents have none.
    if (r.status === "extracted") expect(r.reviewReasons).toEqual([]);
    else expect(r.reviewReasons.length).toBeGreaterThan(0);
    // No SSN-shaped number anywhere in the output.
    expect(findFullSsns(r), ctx).toEqual([]);
    // Every field has provenance within bounds.
    for (const [key, f] of Object.entries(r.extraction?.fields ?? {})) {
      expect(f.confidence, `${ctx} ${key}`).toBeGreaterThanOrEqual(0);
      expect(f.confidence, `${ctx} ${key}`).toBeLessThanOrEqual(1);
      if (f.page !== null) expect(f.page).toBeGreaterThanOrEqual(1);
    }
  });
});
