import type { Mode } from "@/db/schema";
import { toCsv } from "@/lib/csv";

/** What a delivery needs to know about an event. */
export interface DeliverableEvent {
  id: string;
  type: string;
  mode: Mode;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export type WebhookFormat = "native" | "generic_csv_row";
export const WEBHOOK_FORMATS: readonly WebhookFormat[] = ["native", "generic_csv_row"];

export interface DeliveryBody {
  body: string;
  contentType: string;
}

/** Envelope columns of the `generic_csv_row` format, always first and in this order. */
export const CSV_ENVELOPE_COLUMNS = ["event_id", "event_type", "created_at", "mode"] as const;

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (value === null || value === undefined) {
    out.set(path, "");
  } else if (Array.isArray(value)) {
    // A list of plain values fits one cell; anything nested is kept as JSON so no data is lost.
    const scalar = value.every((v) => v === null || ["string", "number", "boolean"].includes(typeof v));
    out.set(path, scalar ? value.map((v) => (v === null ? "" : String(v))).join(";") : JSON.stringify(value));
  } else if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.set(path, "");
    for (const [key, child] of entries) flatten(child, `${path}.${key}`, out);
  } else {
    out.set(path, String(value));
  }
}

/**
 * The request body for one event in an endpoint's format.
 *
 *  - `native`: JSON `{ id, type, created_at, mode, data }`, where `data` is the event payload.
 *  - `generic_csv_row`: the same event as CSV text, a header line and one data row, for receivers that
 *    ingest spreadsheet rows rather than JSON. Columns: `event_id, event_type, created_at, mode`, then
 *    one `data.<path>` column per payload leaf in alphabetical order (nested keys joined with "."; lists
 *    of plain values joined with ";").
 */
export function buildDeliveryBody(event: DeliverableEvent, format: WebhookFormat): DeliveryBody {
  const createdAt = event.createdAt.toISOString();
  if (format === "generic_csv_row") {
    const data = new Map<string, string>();
    for (const [key, value] of Object.entries(event.payload)) flatten(value, `data.${key}`, data);
    const dataColumns = [...data.keys()].sort();
    const headers = [...CSV_ENVELOPE_COLUMNS, ...dataColumns];
    const row = [event.id, event.type, createdAt, event.mode, ...dataColumns.map((c) => data.get(c))];
    return { body: toCsv(headers, [row]), contentType: "text/csv; charset=utf-8" };
  }
  return {
    body: JSON.stringify({ id: event.id, type: event.type, created_at: createdAt, mode: event.mode, data: event.payload }),
    contentType: "application/json",
  };
}
