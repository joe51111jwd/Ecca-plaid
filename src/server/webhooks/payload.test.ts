import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { buildDeliveryBody, CSV_ENVELOPE_COLUMNS, type DeliverableEvent } from "./payload";

const event: DeliverableEvent = {
  id: "evt_SYNTHETIC0000000000001",
  type: "handoff.held",
  mode: "live",
  createdAt: new Date("2026-11-18T15:04:05.678Z"),
  payload: { handoff_id: "ho_SYNTHETIC0000000000001", hold: { expires_at: "2026-11-25T15:04:05.000Z", amount_cents: 125000 }, children: 2, confirmed: false },
};

describe("buildDeliveryBody", () => {
  it("native: JSON envelope { id, type, created_at, mode, data } in that order", () => {
    const { body, contentType } = buildDeliveryBody(event, "native");
    expect(contentType).toBe("application/json");
    expect(body).toBe(
      '{"id":"evt_SYNTHETIC0000000000001","type":"handoff.held","created_at":"2026-11-18T15:04:05.678Z","mode":"live",' +
        '"data":{"handoff_id":"ho_SYNTHETIC0000000000001","hold":{"expires_at":"2026-11-25T15:04:05.000Z","amount_cents":125000},"children":2,"confirmed":false}}',
    );
  });

  it("native: is byte-for-byte stable, so a retry signs the same body", () => {
    expect(buildDeliveryBody(event, "native").body).toBe(buildDeliveryBody({ ...event, payload: { ...event.payload } }, "native").body);
  });

  it("generic_csv_row: a header line and one row with flattened, sorted data columns", () => {
    const { body, contentType } = buildDeliveryBody(event, "generic_csv_row");
    expect(contentType).toBe("text/csv; charset=utf-8");
    expect(body.endsWith("\r\n")).toBe(true);
    const [header, row, ...rest] = parseCsv(body);
    expect(rest).toEqual([]);
    expect(header.slice(0, 4)).toEqual([...CSV_ENVELOPE_COLUMNS]);
    expect(header).toEqual(["event_id", "event_type", "created_at", "mode", "data.children", "data.confirmed", "data.handoff_id", "data.hold.amount_cents", "data.hold.expires_at"]);
    expect(row).toEqual(["evt_SYNTHETIC0000000000001", "handoff.held", "2026-11-18T15:04:05.678Z", "live", "2", "false", "ho_SYNTHETIC0000000000001", "125000", "2026-11-25T15:04:05.000Z"]);
  });

  it("generic_csv_row: handles lists, nulls, empty objects, quoting and payload keys that look like envelope columns", () => {
    const tricky: DeliverableEvent = {
      ...event,
      payload: {
        mode: "payload value, not the envelope",
        tags: ["a", "b", null, 3, true],
        people: [{ role: "parent" }, { role: "child" }],
        empty_list: [],
        empty_object: {},
        nothing: null,
        quote: 'She said "hi"\nthen left',
      },
    };
    const [header, row] = parseCsv(buildDeliveryBody(tricky, "generic_csv_row").body);
    const record = Object.fromEntries(header.map((h, i) => [h, row[i]]));
    expect(record).toEqual({
      event_id: event.id,
      event_type: "handoff.held",
      created_at: "2026-11-18T15:04:05.678Z",
      mode: "live",
      "data.mode": "payload value, not the envelope",
      "data.tags": "a;b;;3;true",
      "data.people": '[{"role":"parent"},{"role":"child"}]',
      "data.empty_list": "",
      "data.empty_object": "",
      "data.nothing": "",
      "data.quote": 'She said "hi"\nthen left',
    });
  });

  it("generic_csv_row: an empty payload still yields the envelope", () => {
    expect(parseCsv(buildDeliveryBody({ ...event, payload: {} }, "generic_csv_row").body)).toEqual([
      ["event_id", "event_type", "created_at", "mode"],
      ["evt_SYNTHETIC0000000000001", "handoff.held", "2026-11-18T15:04:05.678Z", "live"],
    ]);
  });
});
