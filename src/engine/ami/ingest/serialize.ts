import type { AmiDataset } from "../types";

/**
 * Canonical text of the files the ingest writes. The same dataset always serializes to the same bytes:
 * keys are emitted in one fixed order, areas are sorted by code and counties by FIPS code (plain code-unit
 * order, independent of locale), numbers are integers, and there is no timestamp. Re-running an ingest on
 * the same input therefore produces a byte-identical file and a clean `git diff`.
 *
 * Areas and counties are written one record per line so a reviewer can read a change line by line.
 */

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function indentBlock(json: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return json
    .split("\n")
    .map((line, index) => (index === 0 ? line : pad + line))
    .join("\n");
}

function recordLines(records: readonly object[]): string {
  if (records.length === 0) return "[]";
  return `[\n${records.map((record) => `    ${JSON.stringify(record)}`).join(",\n")}\n  ]`;
}

export function serializeDataset(dataset: AmiDataset): string {
  const fields: Array<[string, string]> = [
    ["schemaVersion", JSON.stringify(dataset.schemaVersion)],
    ["version", JSON.stringify(dataset.version)],
    ["source", JSON.stringify(dataset.source)],
    ["method", JSON.stringify(dataset.method)],
    ["state", JSON.stringify(dataset.state)],
    ["stateFips", JSON.stringify(dataset.stateFips)],
  ];
  if (dataset.source === "hud_provisional") fields.push(["fiscalYear", JSON.stringify(dataset.fiscalYear)]);
  fields.push(["effectiveDate", JSON.stringify(dataset.effectiveDate)]);
  if (dataset.source === "hud_provisional") {
    fields.push(["effectiveDateCitation", JSON.stringify(dataset.effectiveDateCitation)]);
  } else {
    fields.push(["citation", JSON.stringify(dataset.citation)], ["contract", JSON.stringify(dataset.contract)]);
  }
  fields.push([
    "sourceFile",
    indentBlock(JSON.stringify({ name: dataset.sourceFile.name, sha256: dataset.sourceFile.sha256, url: dataset.sourceFile.url }, null, 2), 2),
  ]);

  if (dataset.source === "hud_provisional") {
    const m = dataset.multipliers;
    fields.push([
      "multipliers",
      `{\n    "bySizeBps": [${m.bySizeBps.join(", ")}],\n    "additionalPersonBps": ${JSON.stringify(m.additionalPersonBps)},\n    "citation": ${JSON.stringify(m.citation)}\n  }`,
    ]);
    const areas = [...dataset.areas]
      .sort((a, b) => compareCodeUnits(a.code, b.code))
      .map((area) => ({
        code: area.code,
        name: area.name,
        metro: area.metro,
        medianIncomeDollars: area.medianIncomeDollars,
        hudPublished: {
          veryLowIncome4PersonDollars: area.hudPublished.veryLowIncome4PersonDollars,
          lowIncome4PersonDollars: area.hudPublished.lowIncome4PersonDollars,
          veryLowIncomeBySizeDollars: [...area.hudPublished.veryLowIncomeBySizeDollars],
        },
      }));
    fields.push(["areas", recordLines(areas)]);
  } else {
    const areas = [...dataset.areas]
      .sort((a, b) => compareCodeUnits(a.code, b.code))
      .map((area) => ({
        code: area.code,
        name: area.name,
        limitCents: [...area.limitCents],
        additionalPersonCents: area.additionalPersonCents,
        medianIncomeDollars: area.medianIncomeDollars,
      }));
    fields.push(["areas", recordLines(areas)]);
  }

  const counties = [...dataset.counties].sort((a, b) => compareCodeUnits(a.fips, b.fips)).map((county) => ({ fips: county.fips, name: county.name, areaCode: county.areaCode }));
  fields.push(["counties", recordLines(counties)]);

  return `{\n${fields.map(([key, value]) => `  ${JSON.stringify(key)}: ${value}`).join(",\n")}\n}\n`;
}

/** Text of `data/ami/active.json`. */
export function serializeActivePointer(activeVersion: string): string {
  return `${JSON.stringify({ activeVersion }, null, 2)}\n`;
}

export interface RegistryModuleInput {
  /** Installed table versions; each has a `<version>.json` file in the data directory. */
  versions: readonly string[];
  /** Whether `active.json` exists yet. */
  hasActivePointer: boolean;
  /** Import path from the generated module to the data directory, POSIX separators, e.g. "../../../data/ami". */
  dataImportPath: string;
}

/**
 * Source of `src/engine/ami/tables.generated.ts`: the static imports that compile every dataset file into
 * the engine. Written by the ingest command so that installing a table never needs a hand edit.
 */
export function renderRegistryModule(input: RegistryModuleInput): string {
  const versions = [...input.versions].sort(compareCodeUnits);
  const base = input.dataImportPath.replace(/\/+$/, "");
  const lines: string[] = [
    "// GENERATED FILE. Do not edit by hand.",
    "// Written by `npm run ami:ingest` (scripts/ami-ingest.ts): it lists every dataset file in data/ami so the",
    "// engine can load them through static imports, with no file system access at runtime.",
  ];
  if (input.hasActivePointer) lines.push(`import activePointer from ${JSON.stringify(`${base}/active.json`)};`);
  versions.forEach((version, index) => lines.push(`import table${index} from ${JSON.stringify(`${base}/${version}.json`)};`));
  lines.push(
    "",
    "/** Contents of data/ami/active.json; null until a table has been activated. */",
    `export const RAW_ACTIVE_POINTER: unknown = ${input.hasActivePointer ? "activePointer" : "null"};`,
    "",
    "/** Every dataset file in data/ami, in version order. Validated by the registry before use. */",
    `export const RAW_DATASETS: readonly unknown[] = [${versions.map((_, index) => `table${index}`).join(", ")}];`,
    "",
  );
  return lines.join("\n");
}
