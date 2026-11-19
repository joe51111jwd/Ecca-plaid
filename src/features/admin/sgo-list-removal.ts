import { invalid } from "@/lib/errors";
import type { SgoListEntryStatus, SgoListSource } from "@/db/schema";
import { isCalendarDate } from "./forms";

/**
 * "Mark removed with date" on the SGO list screen.
 *
 * List entries are written only by `importSgoList` (src/server/sgos), which records the file's SHA-256, source
 * address and retrieval time on the audit log and raises the per-SGO "sgo_list.entry_removed" entries. So a removal
 * entered by hand is submitted to that same importer as a one-row list file carrying the entry exactly as it is,
 * with status "removed" and the effective date. The importer leaves entries a file does not mention untouched
 * (ABSENT_ENTRY_POLICY "report_only"), so nothing else changes.
 */

export interface RemovableEntry {
  id: string;
  source: SgoListSource;
  state: string;
  name: string;
  ein: string | null;
  status: SgoListEntryStatus;
  listedFrom: string | null;
  removedOn: string | null;
}

/** RFC 4180 field: always quoted, quotes doubled. Values are kept byte-for-byte (no spreadsheet escaping). */
function field(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Throws `validation_failed` (field `removedOn`) when the removal cannot be recorded for this entry. */
export function assertRemovable(entry: RemovableEntry, removedOn: string): void {
  if (!isCalendarDate(removedOn)) throw invalid("Enter the removal's effective date.", { fields: { removedOn: "Enter a full date." } });
  if (entry.listedFrom && removedOn < entry.listedFrom) {
    throw invalid(`The removal date cannot be before the listing date (${entry.listedFrom}).`, { fields: { removedOn: `Use ${entry.listedFrom} or later.` } });
  }
  if (entry.status === "removed" && entry.removedOn === removedOn) {
    throw invalid(`This entry is already removed effective ${removedOn}.`, { fields: { removedOn: "Already recorded." } });
  }
  if (/[\r\n]/.test(entry.name)) throw invalid("This entry's name cannot be written to a list file.");
}

/** The one-row list file (contract: src/server/sgos/list-csv.ts) that removes `entry` effective `removedOn`. */
export function buildRemovalCsv(entry: RemovableEntry, removedOn: string): string {
  assertRemovable(entry, removedOn);
  const header = "state,name,ein,status,listed_from,removed_on";
  const row = [entry.state, entry.name, entry.ein ?? "", "removed", entry.listedFrom ?? "", removedOn].map(field).join(",");
  return `# Removal entered in the admin console for list entry ${entry.id}\n${header}\n${row}\n`;
}
