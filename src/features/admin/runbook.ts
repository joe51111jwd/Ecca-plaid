/**
 * The IRS limitation table swap-in, as shown (read-only) on the Income limits screen. Transcribed from
 * docs/runbooks/irs-table-swap-in.md, which is the authority: keep the two in step. Activation stays a command-line
 * and code-review step by design, so this screen has no button that changes the active table.
 */

export const SWAP_IN_RUNBOOK_PATH = "docs/runbooks/irs-table-swap-in.md";

export interface RunbookStep {
  step: number;
  what: string;
  /** Null for a manual step. */
  command: string | null;
}

export const IRS_TABLE_SWAP_IN_STEPS: readonly RunbookStep[] = [
  { step: 1, what: "Get the published table and read its text", command: null },
  { step: 2, what: "Create an empty transcription sheet", command: "npm run ami:ingest -- --irs-template <file.csv>" },
  { step: 3, what: "Transcribe the table into the CSV contract", command: null },
  {
    step: 4,
    what: "Ingest",
    command: 'npm run ami:ingest -- --source irs --file <file.csv> --version irs-<year> --effective-date YYYY-MM-DD --citation "<citation>"',
  },
  { step: 5, what: "Second, independent transcription", command: "npm run ami:ingest -- --verify-transcription <second.csv> --against irs-<year>" },
  { step: 6, what: "Review the comparison with the active table", command: "npm run ami:ingest -- --diff irs-<year> --report <diff.csv>" },
  { step: 7, what: "Activate", command: "npm run ami:ingest -- --activate irs-<year>" },
  { step: 8, what: "Re-run the full Texas suite on the new numbers", command: "npx vitest run src/engine/ami then npm test" },
  { step: 9, what: "Commit, review, deploy", command: null },
];
