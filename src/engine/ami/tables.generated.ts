// GENERATED FILE. Do not edit by hand.
// Written by `npm run ami:ingest` (scripts/ami-ingest.ts): it lists every dataset file in data/ami so the
// engine can load them through static imports, with no file system access at runtime.
import activePointer from "../../../data/ami/active.json";
import table0 from "../../../data/ami/hud-fy2026-tx.json";

/** Contents of data/ami/active.json; null until a table has been activated. */
export const RAW_ACTIVE_POINTER: unknown = activePointer;

/** Every dataset file in data/ami, in version order. Validated by the registry before use. */
export const RAW_DATASETS: readonly unknown[] = [table0];
