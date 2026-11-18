/**
 * Pure building blocks of `npm run ami:ingest` (scripts/ami-ingest.ts): they turn bytes and text into
 * validated datasets, canonical file contents and review reports. All file access lives in the script.
 */
export { diffTables, diffToCsv, formatDiffReport, type AreaChange, type FormatDiffOptions, type ThresholdDiff, type ThresholdDiffRow } from "./diff";
export { buildHudDataset, type HudIngestInput, type HudIngestResult, type HudIngestStats } from "./hud";
export { findHudReleaseBySha256, KNOWN_HUD_RELEASES, type HudRelease } from "./hud-releases";
export {
  buildIrsDataset,
  compareIrsTranscriptions,
  IRS_CSV_COLUMNS,
  IRS_CSV_CONTRACT,
  IRS_VERSION_PATTERN,
  renderIrsCsvTemplate,
  type IrsIngestInput,
  type IrsIngestResult,
  type IrsIngestStats,
  type IrsTemplateLayout,
} from "./irs";
export { renderRegistryModule, serializeActivePointer, serializeDataset, type RegistryModuleInput } from "./serialize";
export { listXlsxSheets, readXlsxSheet, type XlsxCell, type XlsxRow } from "./xlsx";
