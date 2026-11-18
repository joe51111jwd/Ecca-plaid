/**
 * npm run ami:ingest -- <command>
 *
 * Builds and installs the area-median-income threshold tables the Texas income engine uses
 * (src/engine/ami). The pure logic lives in src/engine/ami/ingest; this file only reads and writes files.
 *
 *   --source hud --file data/hud/Section8-FY26.xlsx --state TX
 *       Read HUD's Section 8 income-limit workbook and write the provisional table data/ami/hud-fy<year>-tx.json.
 *   --source irs --file <csv> --version irs-<year> --effective-date YYYY-MM-DD [--citation "<IRB citation>"]
 *       Read a transcription of the IRS limitation table (CSV contract irs-limitation-csv-v1, documented in
 *       src/engine/ami/ingest/irs.ts and docs/runbooks/irs-table-swap-in.md) and write data/ami/<version>.json.
 *   --irs-template <out.csv> [--layout area|county]
 *       Write an empty transcription sheet with the Texas geography filled in.
 *   --verify-transcription <second.csv> --against <version>
 *       Compare a second person's independent transcription with an installed IRS table (double entry).
 *   --diff <version> [--against <version>]
 *       Compare two installed tables (default: against the active one).
 *   --activate <version> [--dry-run]
 *       Print the comparison with the active table, then make <version> the active table (data/ami/active.json).
 *   --list
 *       Show the installed tables.
 *
 * Ingesting never activates. Activation is always a separate, explicit command whose output a person reviews
 * before committing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Imported module by module, never through "@/engine/ami": that entry point loads the generated import list
// of installed tables, and this command must keep working when that list is stale or broken.
import { computeThreshold } from "@/engine/ami/compute";
import { MAX_TABULATED_FAMILY_SIZE } from "@/engine/ami/constants";
import { buildTable, parseActivePointer } from "@/engine/ami/dataset";
import { formatWholeUsd } from "@/engine/ami/format";
import {
  buildHudDataset,
  buildIrsDataset,
  compareIrsTranscriptions,
  diffTables,
  diffToCsv,
  findHudReleaseBySha256,
  formatDiffReport,
  renderIrsCsvTemplate,
  renderRegistryModule,
  serializeActivePointer,
  serializeDataset,
  type IrsTemplateLayout,
} from "@/engine/ami/ingest";
import type { AmiTable } from "@/engine/ami/types";
import { invalid, isAppError } from "@/lib/errors";

export interface CliIo {
  /** Directory that paths given on the command line are resolved against. */
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** The defaults are anchored to the repository, not to the working directory, so the command cannot write a second data/ami somewhere else. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = "data/ami";
const DEFAULT_REGISTRY_FILE = "src/engine/ami/tables.generated.ts";
const ACTIVE_FILE = "active.json";
/** Sub-directory of the data directory that keeps the exact transcription CSV each IRS table was built from. */
const SOURCES_DIR = "sources";

const USAGE = `Usage: npm run ami:ingest -- <command> [options]

Commands
  --source hud --file <xlsx> --state TX     Ingest HUD's Section 8 income-limit workbook (provisional table).
        [--version <id>] [--fiscal-year <yyyy>] [--sheet <name>]
        [--effective-date YYYY-MM-DD --effective-date-citation <text> --source-url <url>]   (only for a file that is not pinned)
  --source irs --file <csv> --version irs-<year> --effective-date YYYY-MM-DD
        [--citation <Internal Revenue Bulletin citation>] [--source-url <url>] [--reference <hud version>] [--state TX]
                                            Ingest a transcription of the IRS limitation table.
  --irs-template <out.csv> [--layout area|county] [--reference <hud version>]
                                            Write an empty transcription sheet for the IRS table.
  --verify-transcription <second.csv> --against <irs version>
                                            Compare a second, independent transcription with an installed IRS table.
  --diff <version> [--against <version>]    Compare two installed tables (default: against the active table).
  --activate <version> [--dry-run]          Print the comparison with the active table, then activate <version>.
        [--allow-provisional-over-irs]
  --list                                    List installed tables.
  --help                                    Show this text.

Options for --diff and --activate
  --changed-only        List only the county-and-size cells that differ (the summary always covers all cells).
  --report <file.csv>   Also write the full comparison as CSV.

Other options
  --replace             Allow an ingest to overwrite an installed table whose contents differ. The limits of the
                        active table can never be overwritten; ingest those under a new version id.
  --data-dir <dir>      Dataset directory (default ${DEFAULT_DATA_DIR}). Must be given together with --registry-file.
  --registry-file <ts>  Generated import list (default ${DEFAULT_REGISTRY_FILE}).

Ingesting never activates a table. See docs/runbooks/irs-table-swap-in.md.
`;

const OPTIONS = {
  source: { type: "string" },
  file: { type: "string" },
  state: { type: "string" },
  version: { type: "string" },
  "fiscal-year": { type: "string" },
  sheet: { type: "string" },
  "effective-date": { type: "string" },
  "effective-date-citation": { type: "string" },
  "source-url": { type: "string" },
  citation: { type: "string" },
  reference: { type: "string" },
  "irs-template": { type: "string" },
  "verify-transcription": { type: "string" },
  layout: { type: "string" },
  diff: { type: "string" },
  against: { type: "string" },
  activate: { type: "string" },
  "dry-run": { type: "boolean" },
  "allow-provisional-over-irs": { type: "boolean" },
  "changed-only": { type: "boolean" },
  report: { type: "string" },
  replace: { type: "boolean" },
  "data-dir": { type: "string" },
  "registry-file": { type: "string" },
  list: { type: "boolean" },
  help: { type: "boolean" },
} as const;

type Flags = ReturnType<typeof parseFlags>;

function parseFlags(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw invalid(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeFileAtomic(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function readInputFile(path: string): Buffer {
  if (!existsSync(path)) throw invalid(`Input file not found: ${path}`);
  return readFileSync(path);
}

interface Store {
  dataDir: string;
  registryFile: string;
  tables: Map<string, AmiTable>;
  activeVersion: string | null;
}

function show(io: CliIo, path: string): string {
  const rel = relative(io.cwd, path);
  return rel.startsWith("..") ? path : rel;
}

function loadStore(io: CliIo, flags: Flags): Store {
  const customDataDir = flags["data-dir"] !== undefined;
  const customRegistry = flags["registry-file"] !== undefined;
  // A private data directory with the default import list would point the application at the wrong files.
  if (customDataDir !== customRegistry) throw invalid("--data-dir and --registry-file must be given together.");
  const dataDir = flags["data-dir"] !== undefined ? resolve(io.cwd, flags["data-dir"]) : resolve(REPO_ROOT, DEFAULT_DATA_DIR);
  const registryFile = flags["registry-file"] !== undefined ? resolve(io.cwd, flags["registry-file"]) : resolve(REPO_ROOT, DEFAULT_REGISTRY_FILE);

  const tables = new Map<string, AmiTable>();
  let activeVersion: string | null = null;
  if (existsSync(dataDir)) {
    for (const name of readdirSync(dataDir).sort()) {
      if (!name.endsWith(".json")) continue;
      const path = join(dataDir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw invalid(`${show(io, path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (name === ACTIVE_FILE) {
        activeVersion = parseActivePointer(parsed).activeVersion;
        continue;
      }
      const table = buildTable(parsed);
      if (`${table.version}.json` !== name) throw invalid(`${show(io, path)} holds table version ${table.version}; the file must be named ${table.version}.json.`);
      tables.set(table.version, table);
    }
  }
  if (activeVersion !== null && !tables.has(activeVersion)) {
    throw invalid(`${show(io, join(dataDir, ACTIVE_FILE))} names table ${activeVersion}, which is not installed in ${show(io, dataDir)}.`);
  }
  return { dataDir, registryFile, tables, activeVersion };
}

function requireTable(store: Store, version: string): AmiTable {
  const table = store.tables.get(version);
  if (!table) throw invalid(`Table ${version} is not installed (installed: ${[...store.tables.keys()].join(", ") || "none"}).`);
  return table;
}

function writeRegistryModule(io: CliIo, store: Store, versions: readonly string[], hasActivePointer: boolean): void {
  let dataImportPath = relative(dirname(store.registryFile), store.dataDir).split(sep).join("/");
  if (!dataImportPath.startsWith(".")) dataImportPath = `./${dataImportPath}`;
  const contents = renderRegistryModule({ versions, hasActivePointer, dataImportPath });
  const current = existsSync(store.registryFile) ? readFileSync(store.registryFile, "utf8") : null;
  if (current === contents) return;
  writeFileAtomic(store.registryFile, contents);
  io.stdout(`Updated ${show(io, store.registryFile)}\n`);
}

/** Household sizes compared when deciding whether two versions of a table give the same limits (1-8 plus the per-person rule). */
const LIMIT_COMPARISON_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** True when both tables give the same limit, or the same refusal, for every county and compared household size. */
function sameLimits(a: AmiTable, b: AmiTable): boolean {
  const limit = (table: AmiTable, countyFips: string, householdSize: number): number | null => {
    try {
      return computeThreshold(table, { countyFips, householdSize }).thresholdCents;
    } catch (error) {
      if (isAppError(error)) return null;
      throw error;
    }
  };
  const fipsCodes = new Set([...a.countyByFips.keys(), ...b.countyByFips.keys()]);
  for (const fips of fipsCodes) {
    for (const size of LIMIT_COMPARISON_SIZES) {
      if (limit(a, fips, size) !== limit(b, fips, size)) return false;
    }
  }
  return true;
}

/**
 * Writes a dataset file. An installed table is never changed silently, and the limits of the ACTIVE table are
 * never changed at all: that would be an activation without the activation step. Returns the table as the
 * application will load it.
 */
function installDataset(io: CliIo, store: Store, flags: Flags, serialized: string, version: string): AmiTable {
  const table = buildTable(JSON.parse(serialized));
  const path = join(store.dataDir, `${version}.json`);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === serialized) {
    io.stdout(`${show(io, path)} is already up to date (byte-identical).\n`);
  } else if (current !== null) {
    const installed = requireTable(store, version);
    const isActive = store.activeVersion === version;
    const limitsUnchanged = sameLimits(installed, table);
    io.stdout(formatDiffReport(diffTables(installed, table), { changedOnly: true }));
    if (isActive && !limitsUnchanged) {
      throw invalid(
        `${show(io, path)} is the ACTIVE table and this ingest would change its limits. An active table cannot be replaced: ` +
          "ingest under a new version id, review it, and activate it.",
      );
    }
    if (!flags.replace) {
      throw invalid(
        `${show(io, path)} already exists with different contents${limitsUnchanged ? " (the limits are the same; only descriptive fields differ)" : ""}. ` +
          "Ingest under a new version id, or re-run with --replace after reviewing the comparison above.",
      );
    }
    writeFileAtomic(path, serialized);
    io.stdout(`Replaced ${show(io, path)}${limitsUnchanged ? " (limits unchanged; only descriptive fields differ)" : ""}.\n`);
  } else {
    writeFileAtomic(path, serialized);
    io.stdout(`Wrote ${show(io, path)}\n`);
  }
  store.tables.set(version, table);
  writeRegistryModule(io, store, [...store.tables.keys()], store.activeVersion !== null);
  return table;
}

function describeActive(store: Store): string {
  return store.activeVersion ?? "(none)";
}

function activationHint(store: Store, version: string): string {
  if (store.activeVersion === version) return `${version} is the active table.\n`;
  return `Ingest does not activate: the active table is ${describeActive(store)}.\nTo review and activate it: npm run ami:ingest -- --activate ${version}\n`;
}

function ingestHud(io: CliIo, flags: Flags, store: Store): void {
  if (!flags.file) throw invalid("--source hud needs --file <path to the HUD Section 8 .xlsx>.");
  if (flags.state !== "TX") throw invalid("--source hud needs --state TX (the income engine covers Texas only).");
  for (const flag of ["citation", "reference"] as const) {
    if (flags[flag] !== undefined) throw invalid(`--${flag} does not apply to --source hud.`);
  }
  const path = resolve(io.cwd, flags.file);
  const bytes = readInputFile(path);
  const sha256 = sha256Hex(bytes);
  const release = findHudReleaseBySha256(sha256);

  let effectiveDate: string;
  let effectiveDateCitation: string;
  let url: string | null;
  io.stdout(`HUD ingest: ${basename(path)} (sha256 ${sha256})\n`);
  if (release) {
    // The pinned facts win; flags may repeat them but may not contradict them.
    if (flags["effective-date"] !== undefined && flags["effective-date"] !== release.effectiveDate) {
      throw invalid(`This file is the pinned FY ${release.fiscalYear} release, effective ${release.effectiveDate}; --effective-date ${flags["effective-date"]} contradicts it.`);
    }
    if (flags["source-url"] !== undefined && flags["source-url"] !== release.url) {
      throw invalid(`This file is the pinned FY ${release.fiscalYear} release from ${release.url}; --source-url contradicts it.`);
    }
    if (flags["effective-date-citation"] !== undefined && flags["effective-date-citation"] !== release.effectiveDateCitation) {
      throw invalid(`This file is the pinned FY ${release.fiscalYear} release; its effective-date citation is fixed in hud-releases.ts and --effective-date-citation contradicts it.`);
    }
    effectiveDate = release.effectiveDate;
    effectiveDateCitation = release.effectiveDateCitation;
    url = release.url;
    io.stdout(`  Pinned official release: FY ${release.fiscalYear}, effective ${release.effectiveDate}\n`);
  } else {
    if (!flags["effective-date"] || !flags["effective-date-citation"] || !flags["source-url"]) {
      throw invalid(
        "This file's SHA-256 is not a pinned HUD release (src/engine/ami/ingest/hud-releases.ts). " +
          "Pass --effective-date, --effective-date-citation and --source-url for it, and pin it there once it is verified.",
      );
    }
    effectiveDate = flags["effective-date"];
    effectiveDateCitation = flags["effective-date-citation"];
    url = flags["source-url"];
    io.stdout("  WARNING: not a pinned release. Verify the file against huduser.gov before activating its table.\n");
  }

  let fiscalYear: number | undefined;
  if (flags["fiscal-year"] !== undefined) {
    if (!/^\d{4}$/.test(flags["fiscal-year"])) throw invalid("--fiscal-year must be a four-digit year.");
    fiscalYear = Number(flags["fiscal-year"]);
  }
  if (release && fiscalYear !== undefined && fiscalYear !== release.fiscalYear) {
    throw invalid(`This file is the pinned FY ${release.fiscalYear} release; --fiscal-year ${fiscalYear} contradicts it.`);
  }

  const { dataset, stats } = buildHudDataset({
    workbook: new Uint8Array(bytes),
    state: "TX",
    sourceFile: { name: basename(path), sha256, url },
    effectiveDate,
    effectiveDateCitation,
    fiscalYear: fiscalYear ?? release?.fiscalYear,
    sheetName: flags.sheet,
    version: flags.version,
  });
  io.stdout(
    `  Sheet "${stats.sheetName}": ${stats.rowsInSheet} data rows; Texas: ${stats.counties} counties in ${stats.areas} areas (${stats.multiCountyAreas} areas span more than one county)\n` +
      `  Area median family income: ${formatWholeUsd(stats.minMedianDollars)} to ${formatWholeUsd(stats.maxMedianDollars)}\n`,
  );
  installDataset(io, store, flags, serializeDataset(dataset), dataset.version);
  io.stdout(`Table ${dataset.version} is installed. It is HUD-derived and PROVISIONAL.\n${activationHint(store, dataset.version)}`);
}

function decodeUtf8(bytes: Uint8Array, name: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid(`${name} is not valid UTF-8 text. Save the transcription as "CSV UTF-8".`);
  }
}

function referenceCounties(reference: AmiTable): Array<{ fips: string; name: string }> {
  return reference.dataset.counties.map((county) => ({ fips: county.fips, name: county.name }));
}

function transcriptionArchivePath(store: Store, version: string): string {
  return join(store.dataDir, SOURCES_DIR, `${version}.csv`);
}

function pickReference(store: Store, requested: string | undefined): AmiTable {
  if (requested !== undefined) {
    const table = requireTable(store, requested);
    if (table.dataset.source !== "hud_provisional") throw invalid(`--reference must name a HUD-derived table; ${requested} is ${table.dataset.source}.`);
    return table;
  }
  let best: AmiTable | null = null;
  for (const table of store.tables.values()) {
    if (table.dataset.source !== "hud_provisional") continue;
    if (!best || (best.dataset.source === "hud_provisional" && table.dataset.fiscalYear > best.dataset.fiscalYear)) best = table;
  }
  if (!best) throw invalid("No HUD-derived table is installed to supply the Texas county list. Run the HUD ingest first.");
  return best;
}

function ingestIrs(io: CliIo, flags: Flags, store: Store): void {
  if (!flags.file) throw invalid("--source irs needs --file <path to the transcription CSV>.");
  if (!flags.version) throw invalid("--source irs needs --version irs-<year>.");
  if (!flags["effective-date"]) throw invalid("--source irs needs --effective-date YYYY-MM-DD (the date the published limits take effect).");
  if (flags.state !== undefined && flags.state !== "TX") throw invalid("--state must be TX (the income engine covers Texas only).");
  for (const flag of ["fiscal-year", "sheet", "effective-date-citation"] as const) {
    if (flags[flag] !== undefined) throw invalid(`--${flag} does not apply to --source irs.`);
  }
  const path = resolve(io.cwd, flags.file);
  const bytes = readInputFile(path);
  const sha256 = sha256Hex(bytes);
  const reference = pickReference(store, flags.reference);
  io.stdout(`IRS ingest: ${basename(path)} (sha256 ${sha256})\n  County list checked against ${reference.version}\n`);

  const { dataset, stats } = buildIrsDataset({
    csv: decodeUtf8(bytes, basename(path)),
    state: "TX",
    version: flags.version,
    effectiveDate: flags["effective-date"],
    citation: flags.citation ?? null,
    sourceFile: { name: basename(path), sha256, url: flags["source-url"] ?? null },
    referenceCounties: referenceCounties(reference),
  });
  io.stdout(`  ${stats.rows} rows; ${stats.counties} counties in ${stats.areas} areas\n`);
  if (stats.areasWithoutIncrement > 0) {
    io.stdout(`  NOTE: ${stats.areasWithoutIncrement} area(s) have no per-person increment; households above ${MAX_TABULATED_FAMILY_SIZE} there will be refused and must go to review.\n`);
  }
  if (dataset.citation === null) {
    io.stdout("  WARNING: no --citation given. Evidence will cite the Internal Revenue Bulletin without a document number. Re-run with --citation and --replace before activating.\n");
  }
  installDataset(io, store, flags, serializeDataset(dataset), dataset.version);
  // Keep the exact transcription next to the table: the test suite re-reads it against the table, and an
  // auditor can see what was typed in.
  const archive = transcriptionArchivePath(store, dataset.version);
  if (!existsSync(archive) || sha256Hex(readFileSync(archive)) !== sha256) {
    writeFileAtomic(archive, bytes);
    io.stdout(`Archived the transcription as ${show(io, archive)}\n`);
  }
  io.stdout(`Table ${dataset.version} is installed.\n${activationHint(store, dataset.version)}`);
}

function verifyTranscription(io: CliIo, flags: Flags, store: Store): void {
  if (!flags.against) throw invalid("--verify-transcription needs --against <installed IRS table version>.");
  const installed = requireTable(store, flags.against);
  if (installed.dataset.source !== "irs_published") throw invalid(`${installed.version} is not an IRS table; --verify-transcription compares two transcriptions of the IRS table.`);
  const path = resolve(io.cwd, flags["verify-transcription"]!);
  const bytes = readInputFile(path);
  const sha256 = sha256Hex(bytes);
  if (sha256 === installed.dataset.sourceFile.sha256) {
    throw invalid(`${basename(path)} is byte-identical to the file ${installed.version} was built from. The check needs a second transcription made independently by another person.`);
  }
  const { dataset } = buildIrsDataset({
    csv: decodeUtf8(bytes, basename(path)),
    state: "TX",
    version: installed.version,
    effectiveDate: installed.effectiveDate,
    citation: installed.dataset.citation,
    sourceFile: { name: basename(path), sha256, url: null },
    referenceCounties: referenceCounties(pickReference(store, flags.reference)),
  });
  const differences = compareIrsTranscriptions(installed, buildTable(dataset));
  if (differences.length > 0) {
    const shown = differences.slice(0, 60);
    throw invalid(
      `The second transcription differs from ${installed.version} in ${differences.length} place${differences.length === 1 ? "" : "s"}:\n  - ${shown.join("\n  - ")}` +
        `${differences.length > shown.length ? `\n  (and ${differences.length - shown.length} more)` : ""}\nCheck each against the published table, correct whichever transcription is wrong, and ingest again.`,
    );
  }
  io.stdout(
    `The two transcriptions agree: ${installed.countyByFips.size} counties x household sizes 1-${MAX_TABULATED_FAMILY_SIZE}, per-person increments, medians, area names and codes (${basename(path)} vs ${installed.dataset.sourceFile.name}).\n`,
  );
}

function writeTemplate(io: CliIo, flags: Flags, store: Store): void {
  const layout = flags.layout ?? "area";
  if (layout !== "area" && layout !== "county") throw invalid("--layout must be area or county.");
  const reference = pickReference(store, flags.reference);
  const path = resolve(io.cwd, flags["irs-template"]!);
  if (existsSync(path)) throw invalid(`${show(io, path)} already exists; choose another file name so a transcription in progress is never overwritten.`);
  writeFileAtomic(path, renderIrsCsvTemplate(reference, layout as IrsTemplateLayout));
  const rows = layout === "area" ? reference.areaByCode.size : reference.countyByFips.size;
  io.stdout(`Wrote ${show(io, path)}: ${rows} rows (one per ${layout}), geography from ${reference.version}, every limit empty.\n`);
}

/** Every county must produce a positive limit for sizes 1 to 8 that does not fall as the household grows. */
function selfCheck(table: AmiTable): string[] {
  const problems: string[] = [];
  for (const county of table.dataset.counties) {
    let previous = 0;
    for (let householdSize = 1; householdSize <= MAX_TABULATED_FAMILY_SIZE; householdSize++) {
      try {
        const cents = computeThreshold(table, { countyFips: county.fips, householdSize }).thresholdCents;
        if (!(cents > 0) || cents < previous) problems.push(`${county.fips} ${county.name}, household of ${householdSize}: limit ${cents} is not above the limit for a smaller household`);
        previous = cents;
      } catch (error) {
        problems.push(`${county.fips} ${county.name}, household of ${householdSize}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return problems;
}

function printComparison(io: CliIo, flags: Flags, oldTable: AmiTable | null, newTable: AmiTable): void {
  const diff = diffTables(oldTable, newTable);
  io.stdout(formatDiffReport(diff, { changedOnly: flags["changed-only"] === true }));
  if (flags.report) {
    const path = resolve(io.cwd, flags.report);
    writeFileAtomic(path, diffToCsv(diff));
    io.stdout(`Wrote the full comparison to ${show(io, path)}\n`);
  }
}

function compare(io: CliIo, flags: Flags, store: Store): void {
  const candidate = requireTable(store, flags.diff!);
  const againstVersion = flags.against ?? store.activeVersion;
  if (againstVersion === null) throw invalid("No table is active; pass --against <version> to choose what to compare with.");
  printComparison(io, flags, requireTable(store, againstVersion), candidate);
}

function activate(io: CliIo, flags: Flags, store: Store): void {
  const version = flags.activate!;
  const candidate = requireTable(store, version);
  const current = store.activeVersion === null ? null : requireTable(store, store.activeVersion);

  const problems = selfCheck(candidate);
  if (problems.length > 0) {
    throw invalid(`Table ${version} failed its self-check and cannot be activated:\n  - ${problems.slice(0, 20).join("\n  - ")}${problems.length > 20 ? `\n  (and ${problems.length - 20} more)` : ""}`);
  }
  if (candidate.dataset.source === "irs_published") {
    const archive = transcriptionArchivePath(store, version);
    if (!existsSync(archive) || sha256Hex(readFileSync(archive)) !== candidate.dataset.sourceFile.sha256) {
      throw invalid(`${show(io, archive)} is missing or is not the file ${version} was built from. Re-run the IRS ingest so the table and its archived transcription match.`);
    }
  }
  if (current && current.source === "irs_published" && candidate.source === "hud_provisional" && !flags["allow-provisional-over-irs"]) {
    throw invalid(
      `The active table ${current.version} is IRS-published; ${version} is HUD-derived and provisional. ` +
        "Going back to a provisional table is almost never right. Re-run with --allow-provisional-over-irs if it is intended.",
    );
  }

  io.stdout(
    `Candidate: ${candidate.version} (${candidate.source}, effective ${candidate.effectiveDate}, ${candidate.countyByFips.size} counties, ${candidate.areaByCode.size} areas)\n` +
      `Active:    ${current ? `${current.version} (${current.source}, effective ${current.effectiveDate})` : "(none)"}\n\n`,
  );
  printComparison(io, flags, current, candidate);

  if (flags["dry-run"]) {
    io.stdout(`\nDry run: ${show(io, join(store.dataDir, ACTIVE_FILE))} was not changed. The active table is still ${describeActive(store)}.\n`);
    return;
  }
  const activePath = join(store.dataDir, ACTIVE_FILE);
  const contents = serializeActivePointer(version);
  if (existsSync(activePath) && readFileSync(activePath, "utf8") === contents) {
    io.stdout(`\n${version} is already the active table; nothing changed.\n`);
  } else {
    writeFileAtomic(activePath, contents);
    store.activeVersion = version;
    io.stdout(`\nActivated ${version}: ${show(io, activePath)} now names it${current ? ` (was ${current.version})` : ""}.\n`);
  }
  writeRegistryModule(io, store, [...store.tables.keys()], true);
  io.stdout(
    "Before committing:\n" +
      "  1. Read the comparison above (or the --report CSV). Every changed limit changes real decisions.\n" +
      "  2. npx vitest run src/engine/ami      the full Texas suite must pass on the new numbers\n" +
      "  3. git diff data/ami src/engine/ami/tables.generated.ts\n" +
      "See docs/runbooks/irs-table-swap-in.md.\n",
  );
}

function list(io: CliIo, store: Store): void {
  if (store.tables.size === 0) {
    io.stdout(`No tables are installed in ${show(io, store.dataDir)}.\n`);
    return;
  }
  for (const table of [...store.tables.values()].sort((a, b) => (a.version < b.version ? -1 : 1))) {
    const active = table.version === store.activeVersion ? "ACTIVE" : "      ";
    io.stdout(
      `${active}  ${table.version}  ${table.source}${table.provisional ? " (provisional)" : ""}  effective ${table.effectiveDate}  ${table.countyByFips.size} counties, ${table.areaByCode.size} areas  source file ${table.dataset.sourceFile.name}\n`,
    );
  }
  if (store.activeVersion === null) io.stdout("No table is active.\n");
}

/** Runs one command. Returns the process exit code: 0 on success, 1 on any validation or usage failure. */
export function runAmiIngest(argv: string[], io: CliIo): number {
  try {
    const flags = parseFlags(argv);
    if (flags.help) {
      io.stdout(USAGE);
      return 0;
    }
    const commands = [
      flags.source !== undefined,
      flags["irs-template"] !== undefined,
      flags["verify-transcription"] !== undefined,
      flags.diff !== undefined,
      flags.activate !== undefined,
      flags.list === true,
    ].filter(Boolean).length;
    if (commands !== 1) throw invalid(`Give exactly one command: --source, --irs-template, --verify-transcription, --diff, --activate or --list.\n\n${USAGE}`);

    const store = loadStore(io, flags);
    if (flags.source !== undefined) {
      if (flags.source === "hud") ingestHud(io, flags, store);
      else if (flags.source === "irs") ingestIrs(io, flags, store);
      else throw invalid(`--source must be hud or irs (received "${flags.source}").`);
    } else if (flags["irs-template"] !== undefined) writeTemplate(io, flags, store);
    else if (flags["verify-transcription"] !== undefined) verifyTranscription(io, flags, store);
    else if (flags.diff !== undefined) compare(io, flags, store);
    else if (flags.activate !== undefined) activate(io, flags, store);
    else list(io, store);
    return 0;
  } catch (error) {
    if (isAppError(error)) {
      io.stderr(`ami:ingest failed: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // `npm run ami:ingest -- --diff x | head` closes the pipe early; that is not an error.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  process.exitCode = runAmiIngest(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
