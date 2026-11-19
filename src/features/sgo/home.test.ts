import { describe, expect, it } from "vitest";
import { deadlineOf } from "./deadlines";
import { attentionItems, type AttentionInput } from "./home";

const noActions = { add_sgo_ein: 0, register_portal: 0, enter_donor_number: 0, generate_sandbox_number: 0, review: 0, issue: 0, mail_paper: 0, none: 0 };

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    mode: "test",
    reviews: { open: 0, waitingOnFamily: 0, oldestAgeDays: null },
    acknowledgments: { taxYear: 2026, donors: 0, byAction: noActions, outstanding: 0 },
    deadlines: { acknowledgment: deadlineOf("2026-11-18", "2027-01-31"), report: deadlineOf("2026-11-18", "2027-02-28") },
    reportSubmitted: false,
    onboarding: { remaining: 0, total: 6 },
    ...over,
  };
}

describe("attentionItems", () => {
  it("is empty when nothing waits", () => {
    expect(attentionItems(input())).toEqual([]);
  });

  it("does not count reviews that are waiting on the family", () => {
    expect(attentionItems(input({ reviews: { open: 2, waitingOnFamily: 2, oldestAgeDays: null } }))).toEqual([]);
    const items = attentionItems(input({ reviews: { open: 3, waitingOnFamily: 1, oldestAgeDays: 1 } }));
    expect(items[0]).toMatchObject({ key: "reviews", tone: "warning", title: "2 verifications need a reviewer", href: "/sgo/review" });
  });

  it("escalates reviews that waited too long, and orders danger first", () => {
    const items = attentionItems(input({ reviews: { open: 1, waitingOnFamily: 0, oldestAgeDays: 5 }, onboarding: { remaining: 2, total: 6 } }));
    expect(items.map((i) => [i.key, i.tone])).toEqual([
      ["reviews", "danger"],
      ["onboarding", "info"],
    ]);
    expect(items[0]!.title).toBe("1 verification needs a reviewer");
  });

  it("explains blocked acknowledgments and the sandbox-number path in test mode", () => {
    const items = attentionItems(input({ acknowledgments: { taxYear: 2026, donors: 3, byAction: { ...noActions, add_sgo_ein: 1, generate_sandbox_number: 2 }, outstanding: 3 } }));
    const keys = items.map((i) => i.key);
    expect(keys).toEqual(["ack_ein", "ack_numbers"]);
    expect(items[1]!.body).toMatch(/sandbox numbers/);
    expect(items[1]!.body).toMatch(/not valid for filing/);
  });

  it("in live mode says numbers come from the IRS SGO portal and are never invented", () => {
    const items = attentionItems(input({ mode: "live", acknowledgments: { taxYear: 2026, donors: 1, byAction: { ...noActions, enter_donor_number: 1 }, outstanding: 1 } }));
    expect(items[0]!.body).toMatch(/IRS SGO portal/);
    expect(items[0]!.body).toMatch(/never invented/);
  });

  it("calls out approaching and overdue deadlines only while work is outstanding", () => {
    const deadlines = { acknowledgment: deadlineOf("2027-01-20", "2027-01-31"), report: deadlineOf("2027-03-02", "2027-02-28") };
    const busy = attentionItems(input({ deadlines, acknowledgments: { taxYear: 2026, donors: 2, byAction: { ...noActions, issue: 2 }, outstanding: 2 } }));
    expect(busy.find((i) => i.key === "deadline_ack")).toMatchObject({ tone: "warning" });
    expect(busy.find((i) => i.key === "deadline_report")).toMatchObject({ tone: "danger" });
    const done = attentionItems(input({ deadlines, reportSubmitted: true, acknowledgments: { taxYear: 2026, donors: 2, byAction: { ...noActions, none: 2 }, outstanding: 0 } }));
    expect(done.map((i) => i.key)).toEqual([]);
  });

  it("ignores acknowledgments when there are no donors", () => {
    expect(attentionItems(input({ acknowledgments: null }))).toEqual([]);
  });
});
