/**
 * The module boundary: what the barrel exports, and that the module stays pure (docs/architecture.md:
 * "PURE. ... engine and taxmath import only lib"; no database, network, file system, environment or clock).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as taxmath from "./index";

const directory = fileURLToPath(new URL(".", import.meta.url));
const sourceFiles = readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

describe("purity", () => {
  it("covers every source file of the module", () => {
    expect(sourceFiles.sort()).toEqual(
      ["authority.ts", "constants.ts", "copy.ts", "credit.ts", "dates.ts", "eligibility.ts", "fees.ts", "hash.ts", "index.ts", "panel.ts", "substantial-contributor.ts", "validation.ts"].sort(),
    );
  });

  it.each(sourceFiles)("%s imports only zod, src/lib and its own siblings", (name) => {
    const source = readFileSync(join(directory, name), "utf8");
    const specifiers = Array.from(source.matchAll(/\bfrom\s+"([^"]+)"/g), (match) => match[1]);
    for (const specifier of specifiers) {
      expect(specifier, `${name} imports ${specifier}`).toMatch(/^(zod|@\/lib\/(errors|money|brand)|\.\/[a-z-]+)$/);
    }
    expect(source, name).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it.each(sourceFiles)("%s reads no clock, environment, network, storage or randomness", (name) => {
    const code = readFileSync(join(directory, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code, name).not.toMatch(/\bDate\.now\s*\(/);
    expect(code, name).not.toMatch(/\bnew Date\(\s*\)/);
    expect(code, name).not.toMatch(/\bprocess\./);
    expect(code, name).not.toMatch(/\bMath\.random\b/);
    expect(code, name).not.toMatch(/\bfetch\s*\(/);
    expect(code, name).not.toMatch(/\b(localStorage|sessionStorage|document|window|globalThis)\b/);
    expect(code, name).not.toMatch(/\bperformance\.now\b/);
  });
});

describe("the public API", () => {
  it("exports the functions other modules code against", () => {
    const functions = [
      "previewCredit",
      "computeTaxpayerCredit",
      "applyLiabilityLimit",
      "suggestDesignation",
      "carryforwardWindow",
      "renderCreditPanel",
      "assessCreditEligibility",
      "determineTaxYear",
      "isBeforeCreditStart",
      "creditStartInstant",
      "classifyPaymentMethod",
      "computeGiftLines",
      "describeFeeStructure",
      "assertFeeStructureAllowed",
      "isFeeStructure",
      "assessSubstantialContributor",
      "renderCopy",
      "renderCopyDynamic",
      "renderCopyWithProof",
      "copySha256",
      "copyTemplate",
      "getCopy",
      "listCopy",
      "isCopyId",
      "hasTranslation",
      "acknowledgmentDueDate",
      "irsContributionReportDueDate",
      "lastCarryforwardYear",
      "rulesFingerprint",
      "getRule",
      "rule",
      "isAuthority",
      "formatIsoDateLong",
      "isIsoDate",
      "startOfDateInTimeZone",
      "zonedDateTime",
    ] as const;
    for (const name of functions) expect(typeof taxmath[name], name).toBe("function");
  });

  it("exports the versions, the rule registry and the copy registry", () => {
    expect(taxmath.TAXMATH_VERSION).toBe("25f-taxmath.2026-11-18.v1");
    expect(taxmath.COPY_VERSION).toBe("25f-copy.2026-11-18.v1");
    expect(taxmath.CREDIT_CAP_PER_TAXPAYER_CENTS.value).toBe(170_000);
    expect(taxmath.CARRYFORWARD_YEARS.value).toBe(5);
    expect(taxmath.FIRST_ELIGIBLE_DATE.value).toBe("2027-01-01");
    expect(taxmath.RULES.creditCapPerTaxpayerCents).toBe(taxmath.CREDIT_CAP_PER_TAXPAYER_CENTS);
    expect(taxmath.COPY["note.preview_not_tax_advice"].id).toBe("note.preview_not_tax_advice");
    expect(taxmath.FEE_STRUCTURES).toEqual(["none", "sgo_invoiced", "donor_service_fee"]);
    expect(taxmath.FILING_STATUSES).toEqual(["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"]);
    expect(taxmath.TAXPAYER_ROLES).toEqual(["individual", "spouse_1", "spouse_2"]);
    expect(taxmath.SGO_LIST_SOURCES).toEqual(["provisional_curated", "irs_published"]);
  });

  it("does not export the test seams", () => {
    expect(Object.keys(taxmath)).not.toContain("defineCopyEntry");
    expect(Object.keys(taxmath)).not.toContain("renderCopyEntry");
  });
});
