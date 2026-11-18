import { AppError } from "@/lib/errors";
import { buildTable, parseActivePointer } from "./dataset";
import { RAW_ACTIVE_POINTER, RAW_DATASETS } from "./tables.generated";
import type { AmiTable, AmiTableSummary } from "./types";

/**
 * The set of threshold tables the application can use, and which one is active.
 *
 * The default registry is built from the dataset files in `data/ami/`, statically imported through
 * `tables.generated.ts` (rewritten by `npm run ami:ingest`, never by hand). Exactly one table is active at a
 * time: `data/ami/active.json` names it, and only `npm run ami:ingest -- --activate <version>` changes it.
 */
export interface AmiTableRegistry {
  /** The table every decision uses unless a caller passes one explicitly. */
  getActiveTable(): AmiTable;
  /** A specific table version, e.g. to re-derive an old decision. Throws `not_found` for an unknown version. */
  getTable(version: string): AmiTable;
  /** Every installed table, in version order, with the active one flagged. */
  listTables(): AmiTableSummary[];
}

export interface CreateTableRegistryInput {
  /** Parsed dataset files. Each is validated; a single invalid file makes the whole registry unusable. */
  datasets: readonly unknown[];
  /** Parsed `active.json`, or null when no table has been activated yet. */
  activePointer: unknown;
}

export function createTableRegistry(input: CreateTableRegistryInput): AmiTableRegistry {
  const tables = new Map<string, AmiTable>();
  for (const raw of input.datasets) {
    const table = buildTable(raw);
    if (tables.has(table.version)) throw new AppError("internal", `AMI table version ${table.version} is installed more than once`);
    tables.set(table.version, table);
  }
  const versions = [...tables.keys()].sort();

  let activeVersion: string | null = null;
  if (input.activePointer !== null && input.activePointer !== undefined) {
    activeVersion = parseActivePointer(input.activePointer).activeVersion;
    if (!tables.has(activeVersion)) {
      throw new AppError("internal", `AMI active pointer names table ${activeVersion}, which is not installed (installed: ${versions.join(", ") || "none"})`);
    }
  }

  const getTable = (version: string): AmiTable => {
    const table = tables.get(version);
    if (!table) throw new AppError("not_found", `AMI table ${String(version)} is not installed (installed: ${versions.join(", ") || "none"})`);
    return table;
  };

  return {
    getActiveTable() {
      if (activeVersion === null) {
        throw new AppError("internal", "No AMI table is active. Run `npm run ami:ingest -- --activate <version>` and commit data/ami/active.json.");
      }
      return getTable(activeVersion);
    },
    getTable,
    listTables() {
      return versions.map((version) => {
        const table = getTable(version);
        return {
          version,
          source: table.source,
          method: table.method,
          state: table.state,
          effectiveDate: table.effectiveDate,
          provisional: table.provisional,
          active: version === activeVersion,
          countyCount: table.countyByFips.size,
          areaCount: table.areaByCode.size,
        };
      });
    },
  };
}

let defaultRegistry: AmiTableRegistry | null = null;

function registry(): AmiTableRegistry {
  defaultRegistry ??= createTableRegistry({ datasets: RAW_DATASETS, activePointer: RAW_ACTIVE_POINTER });
  return defaultRegistry;
}

/** The active table from `data/ami/`. */
export function getActiveTable(): AmiTable {
  return registry().getActiveTable();
}

/** An installed table by version id (for example `hud-fy2026-tx`). */
export function getTable(version: string): AmiTable {
  return registry().getTable(version);
}

export function listTables(): AmiTableSummary[] {
  return registry().listTables();
}
