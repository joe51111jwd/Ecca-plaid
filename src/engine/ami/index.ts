/**
 * Texas income engine: area median income tables and the section 25F household income limit.
 *
 * Pure: no database, network, file system, environment or clock. The dataset files in `data/ami/` are
 * compiled in through static imports. The ingest (`./ingest`, used by `npm run ami:ingest`) is a separate
 * entry point and is deliberately not re-exported here, so application bundles do not carry it.
 */
export {
  AMI_POLICY,
  BASIS_POINTS,
  EXPECTED_COUNTY_COUNT,
  HUD_FAMILY_SIZE_MULTIPLIERS,
  MAX_TABULATED_FAMILY_SIZE,
  METHOD_HUD_DERIVED,
  METHOD_IRS_PUBLISHED,
  MIN_CAP_PCT,
  STATUTORY_CAP_PCT,
  THRESHOLD_COPY_VERSION,
} from "./constants";
export { buildTable, isIsoCalendarDate, type BuildTableOptions } from "./dataset";
export { describeThresholdSource, thresholdSourceName } from "./labels";
export { createTableRegistry, getActiveTable, getTable, listTables, type AmiTableRegistry, type CreateTableRegistryInput } from "./registry";
export { familySizeMultiplierBps } from "./compute";
export { countiesInArea, getArea, getCounty, getThreshold, listCounties, thresholdRow } from "./threshold";
export type {
  AmiArea,
  AmiCounty,
  AmiCountyRecord,
  AmiDataset,
  AmiSourceFile,
  AmiState,
  AmiTable,
  AmiTableSummary,
  FamilySizeMultipliers,
  GetThresholdInput,
  HudAreaRecord,
  HudDerivedDataset,
  IrsAreaRecord,
  IrsPublishedDataset,
  ThresholdCopyLocale,
  ThresholdErrorReason,
  ThresholdMethod,
  ThresholdResult,
  ThresholdRow,
  ThresholdSource,
  ThresholdSourceDescription,
} from "./types";
