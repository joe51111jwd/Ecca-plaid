import { describe, expect, it } from "vitest";
import { buildCheckoutView, type CheckoutContext, type CheckoutForm } from "@/server/donations";
import { COPY, type CopyId } from "@/taxmath";
import { ALWAYS_VISIBLE_NOTES, groupPanelNotes, NOTE_GROUP_TITLES, panelHeadline } from "./panel-layout";
import { standingPanel, toClientView, type ClientPanel } from "./view-model";

/* Every person, organization and EIN below is SYNTHETIC test data. */

const NOW = new Date("2026-11-18T15:00:00Z");

function context(): CheckoutContext {
  return {
    now: NOW,
    session: { id: "checkout_synthetic", mode: "test", status: "open", source: "hosted", createdAt: NOW, expiresAt: new Date(NOW.getTime() + 86_400_000), placedAt: null, paymentId: null, orderNumber: 0 },
    sgo: { orgId: "org_synthetic", slug: "synthetic-fund", displayName: "Synthetic Scholarship Fund", legalName: "Synthetic Scholarship Fund Inc", ein: "00-1234567", state: "TX", portalRegistered: true },
    list: { status: "provisional", source: "provisional_curated", label: "On the provisional list", entryId: "sgolist_synthetic", listedFrom: "2026-11-01", removedOn: null, retrievedAt: "2027-02-20T12:00:00.000Z", refusal: null },
    settings: { creditStartDate: "2027-01-01", liveEnabled: false, fees: { active: "none", sgoFeeBps: 0, donorServiceFeeBps: 0, counselMemoRef: null } },
  };
}

const SINGLE: CheckoutForm = {
  giftCents: 200_000,
  filingStatus: "single",
  email: "avery@synthetic.example",
  address: { line1: "100 Synthetic Way", city: "Austin", state: "TX", zip: "78701" },
  contributors: { primary: { firstName: "Avery", lastName: "Synthetic", designatedCents: 180_000, expectedStateCreditCents: 10_000 } },
  attestations: { individual: true, usCitizenOrResident: true, noEarmark: true, notInExchangeForScholarship: true },
  donorTimeZone: "America/Chicago",
};

const JOINT: CheckoutForm = {
  ...SINGLE,
  giftCents: 340_000,
  filingStatus: "married_joint",
  contributors: { primary: { firstName: "Jordan", lastName: "Testperson" }, spouse: { firstName: "Riley", lastName: "Testperson", email: "riley@synthetic.example" } },
  attestations: { ...SINGLE.attestations, jointOnBehalfOfBoth: true },
};

const panelOf = (form: CheckoutForm) => toClientView(buildCheckoutView(form, context())).panel;

describe("groupPanelNotes", () => {
  it("never drops or duplicates a caveat and keeps the order inside each place", () => {
    for (const panel of [standingPanel(), panelOf(SINGLE), panelOf(JOINT)]) {
      const grouped = groupPanelNotes(panel.notes);
      const placed = [...grouped.visible, ...grouped.groups.flatMap((g) => g.notes)];
      expect(placed.map((n) => n.id).sort()).toEqual(panel.notes.map((n) => n.id).sort());
      const order = (ids: string[]) => ids.map((id) => panel.notes.findIndex((n) => n.id === id));
      for (const list of [grouped.visible, ...grouped.groups.map((g) => g.notes)]) {
        const idx = order(list.map((n) => n.id));
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
      }
    }
  });

  it("keeps the preview label and the proposed-rules label in view, and words them as the registry does", () => {
    const grouped = groupPanelNotes(standingPanel().notes);
    expect(grouped.visible.map((n) => n.id)).toEqual(["note.preview_not_tax_advice", "note.proposed_rules_not_final"]);
    for (const n of grouped.visible) expect(n.text.length).toBeGreaterThan(20);
  });

  it("keeps the before-the-start-date reason in view when the preview carries it", () => {
    const grouped = groupPanelNotes(panelOf(SINGLE).notes);
    expect(grouped.visible.map((n) => n.id)).toContain("note.before_credit_start");
    for (const g of grouped.groups) for (const n of g.notes) expect(ALWAYS_VISIBLE_NOTES.has(n.id)).toBe(false);
  });

  it("groups the standing caveats under the three headings, in a fixed order", () => {
    const grouped = groupPanelNotes(standingPanel().notes);
    expect(grouped.groups.map((g) => g.title)).toEqual([NOTE_GROUP_TITLES.how, NOTE_GROUP_TITLES.limits]);
    expect(grouped.groups[0].notes.map((n) => n.id)).toContain("note.cap_per_taxpayer");
    expect(grouped.groups[1].notes.map((n) => n.id)).toEqual(expect.arrayContaining(["note.carryforward", "note.liability_not_estimated"]));
  });

  it("puts the record-keeping caveats under 'What to keep' and an unknown caveat under the first heading", () => {
    const grouped = groupPanelNotes([
      { id: "note.claim_form", text: "a" },
      { id: "note.goods_or_services", text: "b" },
      { id: "note.what_to_keep", text: "c" },
      { id: "note.not_in_the_map" as CopyId, text: "d" },
    ]);
    expect(grouped.groups.map((g) => [g.key, g.notes.map((n) => n.text)])).toEqual([
      ["how", ["b", "d"]],
      ["keep", ["a", "c"]],
    ]);
  });

  it("handles no caveats at all", () => {
    expect(groupPanelNotes([])).toEqual({ visible: [], groups: [] });
  });

  it("only names caveats that exist in the registry", () => {
    for (const id of ALWAYS_VISIBLE_NOTES) expect(COPY[id]).toBeDefined();
  });
});

describe("panelHeadline", () => {
  it("is empty before there is a gift", () => {
    expect(panelHeadline(standingPanel())).toEqual({ designated: null, credit: null, notCreditable: [] });
  });

  it("reads one donor's designated amount, estimated credit and the amounts the credit does not cover from the panel's own lines", () => {
    const panel = panelOf(SINGLE);
    const lines = panel.sections.flatMap((s) => s.lines);
    const amount = (id: string) => lines.find((l) => l.id === id)?.amountCents;
    const headline = panelHeadline(panel);
    expect(headline.designated).toMatchObject({ id: "designated", amountCents: 180_000, label: lines.find((l) => l.id === "designated")?.label });
    expect(headline.credit?.amountCents).toBe(amount("estimated_credit"));
    expect(headline.notCreditable.map((f) => f.id)).toEqual(lines.filter((l) => ["over_cap", "non_designated", "state_credit_reduction"].includes(l.id) && l.amountCents > 0).map((l) => l.id));
    expect(headline.notCreditable.find((f) => f.id === "non_designated")?.amountCents).toBe(20_000);
  });

  it("uses the joint total and adds both spouses' designated amounts", () => {
    const panel = panelOf(JOINT);
    const joint = panel.sections.find((s) => s.key === "joint_total")?.lines.find((l) => l.id === "joint_total_credit");
    const headline = panelHeadline(panel);
    expect(joint).toBeDefined();
    expect(headline.credit).toMatchObject({ id: "joint_total_credit", amountCents: joint?.amountCents });
    const designated = panel.sections.filter((s) => s.key !== "joint_total" && s.key !== "liability").flatMap((s) => s.lines).filter((l) => l.id === "designated");
    expect(headline.designated?.amountCents).toBe(designated.reduce((a, l) => a + l.amountCents, 0));
  });

  it("leaves out zero amounts and ignores lines in the liability section", () => {
    const panel: ClientPanel = {
      title: "t",
      status: "preview",
      notes: [],
      sections: [
        { key: "individual", heading: "h", lines: [
          { id: "designated", label: "Designated", amountCents: 100_000, role: "amount" },
          { id: "over_cap", label: "Above the limit", amountCents: 0, role: "subtraction" },
          { id: "estimated_credit", label: "Estimated credit", amountCents: 100_000, role: "result" },
        ] },
        { key: "liability", heading: "l", lines: [{ id: "estimated_credit", label: "x", amountCents: 999, role: "result" }] },
      ],
    };
    expect(panelHeadline(panel)).toEqual({
      designated: { id: "designated", label: "Designated", amountCents: 100_000 },
      credit: { id: "estimated_credit", label: "Estimated credit", amountCents: 100_000 },
      notCreditable: [],
    });
  });
});
