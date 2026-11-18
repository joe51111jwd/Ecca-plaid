/**
 * What the tax copy may never claim, enforced over the WHOLE registry and over rendered panels.
 *
 * Sources for the rules: docs/architecture.md ("Copy rules (legal accuracy)") and
 * docs/reference/donor-credit-rules.md, Engineering Implications 5 ("Must not say"). Each scanner is first
 * proven against synthetic sentences it must catch and must let through, then run over every entry.
 */
import { describe, expect, it } from "vitest";
import { COPY, COPY_CONSTANTS, listCopy, renderCopyDynamic, type CopyEntry } from "./copy";
import { previewCredit, type CreditPreviewInput } from "./credit";
import { assessCreditEligibility } from "./eligibility";
import { FEE_STRUCTURES, computeGiftLines, describeFeeStructure } from "./fees";
import { renderCreditPanel } from "./panel";

/* ------------------------------------------------------------------ helpers */

/** Splits copy into sentences. "U.S." is the only abbreviation the registry uses. */
function sentences(text: string): string[] {
  return text
    .replace(/U\.S\./g, "U·S·")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/U·S·/g, "U.S.").trim())
    .filter((sentence) => sentence.length > 0);
}

/** Every entry rendered with stand-in values, so scanners see the words a donor would see ("$3,400", not "{jointCap}"). */
function rendered(entry: CopyEntry): string {
  const vars = Object.fromEntries(entry.variables.map((name) => [name, `[${name}]`]));
  return renderCopyDynamic(entry.id, vars, { sgoListSource: "irs_published" });
}

const ALL = listCopy().map((entry) => ({ entry, text: rendered(entry) }));

/* ------------------------------------------------------------------ 1. "free" and friends */

const FREE_WORDS = /\bfree\b|\bcosts? you nothing\b|\bcost you nothing\b|\bguarantee[sd]?\b|\bno cost\b|\bno charge\b|\bwithout cost\b|\bzero cost\b|\bat no expense\b/i;

/** A sentence that uses a "free" word must itself say: nonrefundable, limited by tax liability, capped, and not covering fees. */
function freeClaimViolation(sentence: string): string | null {
  if (!FREE_WORDS.test(sentence)) return null;
  const missing: string[] = [];
  if (!/\bnonrefundable\b/i.test(sentence)) missing.push("nonrefundable");
  if (!/\btax liability\b|\btax you (actually )?owe\b/i.test(sentence)) missing.push("tax liability");
  if (!/\$1,700|\bup to \{cap\}/.test(sentence)) missing.push("the cap");
  if (!/\bfee\b/i.test(sentence)) missing.push("fees excluded");
  return missing.length > 0 ? `uses a "free" claim without: ${missing.join(", ")}` : null;
}

/* ------------------------------------------------------------------ 2. deductibility */

function deductibilityViolation(sentence: string): string | null {
  if (/\btax[- ]deductible\b/i.test(sentence)) return 'says "tax-deductible"';
  if (/\bdeductible\b/i.test(sentence)) {
    const conditional = /\bmay be deductible\b/i.test(sentence) && /\bif\b/i.test(sentence) && /\bsection 170\b/i.test(sentence);
    const negative = /\b(is|are) not deductible\b/i.test(sentence) || /\bdoes not treat\b[^.]*\bas deductible\b/i.test(sentence);
    if (!conditional && !negative) return 'says "deductible" without "may be ... if ... section 170"';
    if (/\b(is|are|will be|remains?|stays?|becomes?)\s+(fully |also |still |then |now )?deductible\b/i.test(sentence)) return "asserts that an amount is deductible";
  }
  const deductVerb = /\b(deduct|deducted|deducting)\b/i.test(sentence);
  const deductionClaim = /\b(take|claim|get|receive|qualif\w*|eligible)\b[^.]*\bdeductions?\b/i.test(sentence);
  if ((deductVerb || deductionClaim) && !/\b(cannot|can't|may not|not|never)\b/i.test(sentence)) return "says an amount can be deducted";
  return null;
}

/* ------------------------------------------------------------------ 3. IRS SGO list / limitation table */

function irsPublicationViolation(sentence: string): string | null {
  if (/limitation table/i.test(sentence)) return "mentions the IRS limitation table";
  if (/\bIRS[- ](published|listed|approved|verified|certified|recognized)\b/i.test(sentence)) return "describes something as IRS-published or IRS-approved";
  if (/\b(official|published)\s+IRS\s+(SGO\s+)?list\b/i.test(sentence)) return "calls a list the official or published IRS list";
  if (/\bIRS\b/.test(sentence) && /\blist\b/i.test(sentence)) {
    if (/\blist\b[^.]*\b(is|are|was|has been|have been)\s+(now |already )?(published|posted|available|live|out|released|public)\b/i.test(sentence)) {
      return "says the IRS list is published";
    }
    if (/\b(on|appears on|appear on|listed on|shown on|included on|found on)\s+the\s+(public\s+)?IRS\s+(SGO\s+)?list\b/i.test(sentence)) {
      return "says an organization is on the IRS list";
    }
  }
  return null;
}

describe("the scanners catch what they must and pass what they should (synthetic sentences)", () => {
  it("sentence splitter keeps U.S. together and splits everything else", () => {
    expect(sentences("I am a U.S. citizen or a U.S. resident. Second sentence! Third?")).toEqual(["I am a U.S. citizen or a U.S. resident.", "Second sentence!", "Third?"]);
    expect(sentences("One clause; still one sentence: yes.")).toEqual(["One clause; still one sentence: yes."]);
  });

  it.each([
    "Your gift is free.",
    "Give today: it costs you nothing.",
    "A guaranteed dollar-for-dollar credit.",
    "The credit guarantees your money back.",
    "Give at no cost to you.",
    "Your gift is tax-free money.",
    "There is no charge to you after the credit.",
    // Three of the four qualifiers are not enough.
    "Your gift is effectively free because the nonrefundable credit, up to $1,700, offsets tax you owe.",
    "Your gift is free up to $1,700 if you have enough tax liability, and no fee applies.",
    // The word is banned outright unless qualified, whatever it was meant to say.
    "You are free to choose any organization.",
  ])("free-claim scanner flags: %s", (sentence) => {
    expect(freeClaimViolation(sentence)).not.toBeNull();
  });

  it("free-claim scanner looks sentence by sentence", () => {
    const text = "The credit is nonrefundable, up to $1,700, limited by your tax liability, and never covers a fee. So your gift is free.";
    expect(sentences(text).map(freeClaimViolation)).toEqual([null, expect.stringContaining("nonrefundable")]);
  });

  it.each([
    "A gift is effectively free only to the extent the nonrefundable credit, up to $1,700 per taxpayer, is used against tax you owe, and it never covers a fee.",
    "The credit is nonrefundable: it can only reduce federal income tax you actually owe for the year.",
    "No platform fee is taken on section 25F gifts.",
  ])("free-claim scanner passes: %s", (sentence) => {
    expect(freeClaimViolation(sentence)).toBeNull();
  });

  it.each([
    "The amount above $1,700 is deductible.",
    "The rest of your gift is tax-deductible.",
    "The excess may be deductible.",
    "The excess may be deductible under section 170.",
    "The excess may be deductible if you itemize.",
    "The excess is fully deductible if it meets the requirements of section 170, and may be deductible otherwise.",
    "You can deduct the rest.",
    "You may deduct the amount over the limit.",
    "You can claim a deduction for the rest.",
    "The remainder can be deducted.",
    "This amount qualifies for a charitable deduction.",
  ])("deductibility scanner flags: %s", (sentence) => {
    expect(deductibilityViolation(sentence)).not.toBeNull();
  });

  it.each([
    "The part above the limit may be deductible as a charitable contribution if it meets the requirements of section 170.",
    "Credit that is carried forward is not deductible either.",
    "A qualified contribution for which the credit is allowed cannot also be taken as a charitable contribution deduction under section 170.",
    "This preview does not treat the offset part as deductible; the rules do not settle that question.",
    "A State tax deduction, as opposed to a credit, generally does not reduce the federal credit.",
    "You cannot deduct the credited amount.",
  ])("deductibility scanner passes: %s", (sentence) => {
    expect(deductibilityViolation(sentence)).toBeNull();
  });

  it.each([
    "The IRS SGO list is published.",
    "The IRS list has been posted on the IRS website.",
    "The IRS list of scholarship granting organizations is now available.",
    "This organization is on the IRS list.",
    "This organization appears on the IRS SGO list.",
    "Listed on the public IRS list.",
    "An IRS-approved scholarship granting organization.",
    "IRS-published list of organizations.",
    "Shown on the official IRS list.",
    "The IRS limitation table sets the income limit.",
  ])("IRS-publication scanner flags: %s", (sentence) => {
    expect(irsPublicationViolation(sentence)).not.toBeNull();
  });

  it.each([
    "This list was compiled by Synthetic Platform and is not the IRS list of scholarship granting organizations.",
    "This organization appears only on our provisional list, which is not the IRS list of scholarship granting organizations.",
    "The State must still submit its list of scholarship granting organizations to the IRS.",
    "According to the IRS, an organization must appear on a State's list at the time of the contribution.",
    "This organization has not confirmed that it has registered in the IRS SGO portal.",
  ])("IRS-publication scanner passes: %s", (sentence) => {
    expect(irsPublicationViolation(sentence)).toBeNull();
  });
});

describe("the whole registry", () => {
  it('no "free" / "costs you nothing" / "guaranteed" / "no cost" claim without the nonrefundable, tax-liability, cap and fee qualifiers in the same sentence', () => {
    const using: string[] = [];
    for (const { entry, text } of ALL) {
      for (const sentence of [...sentences(text), ...sentences(entry.text)]) {
        expect(freeClaimViolation(sentence), `${entry.id}: ${sentence}`).toBeNull();
        if (FREE_WORDS.test(sentence)) using.push(entry.id);
      }
    }
    // Exactly one entry uses such a word, and it is the fully qualified statement.
    expect([...new Set(using)]).toEqual(["pitch.effectively_free_qualified"]);
    const pitch = rendered(COPY["pitch.effectively_free_qualified"]);
    expect(sentences(pitch)).toHaveLength(1);
    expect(pitch).toMatch(/only to the extent/);
    expect(pitch).toMatch(/nonrefundable/);
    expect(pitch).toMatch(/up to \$1,700 per taxpayer/);
    expect(pitch).toMatch(/tax liability/);
    expect(pitch).toMatch(/never covers a service fee/);
  });

  it('never says an amount "is deductible": only "may be deductible ... if ... section 170", or that it is not', () => {
    const conditional: string[] = [];
    for (const { entry, text } of ALL) {
      for (const sentence of sentences(text)) {
        expect(deductibilityViolation(sentence), `${entry.id}: ${sentence}`).toBeNull();
        if (/\bmay be deductible\b/i.test(sentence)) conditional.push(entry.id);
      }
    }
    // The over-cap amount is described once, with the regulation's full condition.
    expect(conditional).toEqual(["note.excess_may_be_deductible"]);
    expect(rendered(COPY["note.excess_may_be_deductible"])).toMatch(
      /for which no credit is allowed, such as the part above the \$1,700 limit, may be deductible as a charitable contribution if it meets the requirements of section 170\.$/,
    );
    // The over-cap line and note promise no deduction of their own.
    expect(rendered(COPY["line.over_cap"])).not.toMatch(/deduct/i);
    expect(rendered(COPY["note.over_cap_designation"])).not.toMatch(/deduct/i);
    // The amount cancelled by a State credit is never called deductible (F38).
    expect(rendered(COPY["note.state_credit_offset_not_deductible_here"])).toMatch(/does not treat .* as deductible/);
  });

  it("never states or implies that the IRS SGO list or the limitation table is published", () => {
    const describingTheIrsList: string[] = [];
    for (const { entry, text } of ALL) {
      const problems = sentences(text)
        .map((sentence) => irsPublicationViolation(sentence))
        .filter((problem): problem is string => problem !== null);
      if (entry.onlyWhen === "irs_list_is_source") {
        describingTheIrsList.push(entry.id);
        continue;
      }
      expect(problems, `${entry.id}: ${text}`).toEqual([]);
    }
    // The only entries that speak of an organization being on the IRS list are gated on the IRS list being the source...
    expect(describingTheIrsList.sort()).toEqual(["notice.list_reliance", "notice.list_reliance_unavailable", "notice.sgo_list_irs"]);
    // ...and a gated entry cannot be rendered while the provisional list is in use (see copy.test.ts).
    for (const id of describingTheIrsList) {
      const entry = COPY[id as keyof typeof COPY];
      const vars = Object.fromEntries(entry.variables.map((name) => [name, "x"]));
      expect(() => renderCopyDynamic(entry.id, vars, { sgoListSource: "provisional_curated" })).toThrow();
      expect(() => renderCopyDynamic(entry.id, vars)).toThrow();
    }
    // No ungated entry even uses the phrase "IRS SGO list".
    for (const { entry, text } of ALL) if (entry.onlyWhen === null) expect(text, entry.id).not.toMatch(/IRS SGO list/i);
  });

  it("labels the provisional list as provisional and as not the IRS list", () => {
    const label = rendered(COPY["notice.sgo_list_provisional"]);
    expect(label).toMatch(/^Provisional list\./);
    expect(label).toMatch(/is not the IRS list/);
    expect(label).toMatch(/not labeled credit-eligible/);
    expect(rendered(COPY["eligibility.sgo_list_provisional"])).toMatch(/provisional list, which is not the IRS list/);
  });

  it("tags every sentence derived from the proposed regulations as proposed_reg", () => {
    // Substance that exists only in the proposed regulations, and the tags it may carry.
    const markers: Array<{ what: string; pattern: RegExp; allowed: string[] }> = [
      { what: "the joint-return amount", pattern: /\$3,400/, allowed: ["proposed_reg"] },
      { what: "spouses as separate taxpayers", pattern: /separate taxpayer/i, allowed: ["proposed_reg"] },
      { what: "the other-credits list in the liability limit", pattern: /sections 21, 22/, allowed: ["proposed_reg"] },
      { what: "section 26(a)", pattern: /section 26\(a\)/, allowed: ["proposed_reg"] },
      { what: "the conditional deduction", pattern: /may be deductible/i, allowed: ["proposed_reg"] },
      { what: "carried-forward credit treated as allowed", pattern: /counts as allowed|treated as allowed/i, allowed: ["proposed_reg"] },
      { what: "carryforward before current-year credit", pattern: /used before the credit from this year/i, allowed: ["proposed_reg"] },
      { what: "State credit ordering", pattern: /applying first to the part|applied first to the part|before the \$1,700 limit is applied/i, allowed: ["proposed_reg"] },
      { what: "partnerships and S corporations", pattern: /partnership|S corporation/i, allowed: ["proposed_reg"] },
      { what: "list reliance", pattern: /\brely on\b/i, allowed: ["proposed_reg"] },
      { what: "any participating State's list", pattern: /whatever State you live in|regardless of (your|the taxpayer's) State/i, allowed: ["proposed_reg"] },
      { what: "the missing-donor-number presumption", pattern: /presume/i, allowed: ["proposed_reg"] },
      { what: "substantial contributors", pattern: /substantial contributor/i, allowed: ["proposed_reg"] },
      { what: "the combined joint limit", pattern: /one combined tax-liability limit/i, allowed: ["proposed_reg"] },
      { what: "Form 8525", pattern: /Form 8525/, allowed: ["proposed_reg", "irs_web"] },
      { what: "deposit whether or not a credit results", pattern: /whether or not you end up receiving a credit/i, allowed: ["proposed_reg"] },
    ];
    for (const marker of markers) {
      const matching = ALL.filter(({ text }) => marker.pattern.test(text));
      expect(matching.length, `no entry mentions ${marker.what}; update the marker`).toBeGreaterThan(0);
      for (const { entry, text } of matching) expect(marker.allowed, `${entry.id} mentions ${marker.what}: ${text}`).toContain(entry.authority);
    }

    // A citation to the proposed regulations means the entry is proposed_reg, or a product policy that says it extrapolates them.
    for (const { entry, text } of ALL) {
      if (!/Prop\. Treas\. Reg\.|REG-117199-25/.test(entry.citation)) continue;
      if (entry.authority === "proposed_reg") continue;
      expect(entry.authority, `${entry.id} cites the proposed regulations`).toBe("product_policy");
      expect(text, entry.id).toMatch(/proposed regulations/);
    }
  });

  it("never presents proposed-regulation content as settled law: every proposed_reg statement says it is proposed", () => {
    const proposed = ALL.filter(({ entry }) => entry.authority === "proposed_reg");
    expect(proposed.length).toBeGreaterThan(20);
    for (const { entry, text } of proposed) {
      if (entry.kind === "statement") expect(text, entry.id).toMatch(/\bproposed (rules|regulations)\b/i);
      // Labels and attestations are short captions or the donor's own words; they are covered by the panel note (below).
      expect(["statement", "label", "attestation"]).toContain(entry.kind);
    }
    for (const { entry, text } of ALL) {
      expect(text, entry.id).not.toMatch(/\b(regulations?|rules?) (is|are) (now |already )?(final|the law|law|settled|in effect|in force)\b/i);
      expect(text, entry.id).not.toMatch(/\bfinal regulations (say|provide|require)\b/i);
      expect(text, entry.id).not.toMatch(/\bthe law (says|requires|allows)\b/i);
    }
    expect(rendered(COPY["note.proposed_rules_not_final"])).toMatch(/based on proposed regulations \(REG-117199-25\) that are not final/);
  });

  it("attributes IRS-web-only statements to the IRS", () => {
    for (const { entry, text } of ALL) {
      if (entry.authority === "irs_web" && entry.kind === "statement") expect(text, entry.id).toMatch(/According to the IRS/);
    }
  });

  it('keeps the "each spouse who makes a qualified contribution" condition wherever the joint amount appears', () => {
    const mentioningJointAmount = ALL.filter(({ entry, text }) => /\$3,400/.test(text) || entry.text.includes("{jointCap}"));
    expect(mentioningJointAmount.map(({ entry }) => entry.id).sort()).toEqual(["note.joint_each_spouse", "note.one_spouse_only"]);
    for (const { entry, text } of mentioningJointAmount) {
      expect(text, entry.id).toContain("each spouse who makes a qualified contribution");
      expect(text, entry.id).toMatch(/proposed/);
    }
    expect(COPY_CONSTANTS.en.jointCap).toBe("$3,400");
    expect(rendered(COPY["note.joint_each_spouse"])).toMatch(/only if both spouses make qualified contributions/);
    expect(rendered(COPY["note.one_spouse_only"])).toMatch(/\$3,400 is not available when only one spouse gives/);
    for (const { entry, text } of ALL) {
      expect(text, entry.id).not.toMatch(/\bper (couple|household|family|return)\b/i);
      expect(text, entry.id).not.toMatch(/\bcouples? (get|gets|receive|receives|can claim)\b/i);
    }
  });

  it('keeps the limits attached to "dollar for dollar"', () => {
    const using = ALL.flatMap(({ entry, text }) => sentences(text).filter((sentence) => /dollar for dollar/i.test(sentence)).map((sentence) => ({ id: entry.id, sentence })));
    expect(using.map((use) => use.id)).toEqual(["note.cap_per_taxpayer"]);
    for (const { id, sentence } of using) {
      expect(sentence, id).toMatch(/up to \$1,700 per taxpayer/);
      expect(sentence, id).toMatch(/State tax credit reduction/);
      expect(sentence, id).toMatch(/tax-liability limit/);
    }
  });

  it("never promises the credit, never suggests a gift funds a particular child, and never names Texas as participating", () => {
    for (const { entry, text } of ALL) {
      expect(text, entry.id).not.toMatch(/\byou will (receive|get|earn|be allowed|qualify)\b/i);
      expect(text, entry.id).not.toMatch(/\b(your gift|this gift|you) (qualif(y|ies)|is eligible|are eligible) for the credit\b/i);
      expect(text, entry.id).not.toMatch(/\bentitle[sd]? you\b/i);
      expect(text, entry.id).not.toMatch(/\b(your|their|his|her|a specific) (own )?(child|children|son|daughter|kid|kids|grandchild)\b/i);
      expect(entry.text, entry.id).not.toMatch(/Texas/);
      // A named or particular student appears only in a prohibition.
      for (const sentence of sentences(text)) {
        if (/\b(particular|named|specific) student\b/i.test(sentence)) expect(sentence, entry.id).toMatch(/\b(cannot|may not|not|never)\b/i);
      }
    }
  });

  it("never uses the unverified plain-English names for the credits in sections 21 to 25E", () => {
    const names = /child tax credit|dependent care|elderly|mortgage interest|education credits?|american opportunity|lifetime learning|saver'?s credit|energy|clean vehicle|adoption|alternative minimum|\bAMT\b/i;
    for (const { entry, text } of ALL) expect(text, entry.id).not.toMatch(names);
  });

  it("never describes a fee as part of the contribution, or as covered by the credit", () => {
    const feeSentences = ALL.flatMap(({ entry, text }) => sentences(text).filter((sentence) => /\bfee\b/i.test(sentence)).map((sentence) => ({ id: entry.id, sentence })));
    expect(feeSentences.length).toBeGreaterThan(8);
    for (const { id, sentence } of feeSentences) {
      if (/part of your contribution/i.test(sentence)) expect(sentence, id).toMatch(/not part of your contribution/i);
      expect(sentence, id).not.toMatch(/\bfee (is|are|counts as) (a |part of |included in )(your |the )?(qualified )?contribution\b/i);
      expect(sentence, id).not.toMatch(/\bcredit (also |then )?covers? (the|a|your|any) (service |platform )?fee\b/i);
      expect(sentence, id).not.toMatch(/\bfee\b[^.]*\b(is|are) (credit-eligible|creditable|deductible)\b/i);
    }
    for (const structure of FEE_STRUCTURES) {
      const description = describeFeeStructure(structure, { platformName: "Synthetic Platform" });
      for (const text of [description.donorExplanation, description.sgoExplanation]) {
        for (const sentence of sentences(text)) expect(freeClaimViolation(sentence), sentence).toBeNull();
      }
    }
    expect(describeFeeStructure("donor_service_fee").donorExplanation).toMatch(/not part of your contribution.*not designated.*not covered by the federal credit/);
  });

  it("says an immediate receipt is not the official acknowledgment", () => {
    const receipt = rendered(COPY["receipt.not_official_acknowledgment"]);
    expect(receipt).toMatch(/^This is a payment receipt, not the official written acknowledgment/);
    expect(receipt).toMatch(/unique donor number/);
    expect(receipt).toMatch(/by January 31 of the year after your gift/);
    expect(rendered(COPY["receipt.credit_eligible_path"])).toMatch(/does not promise a credit/);
    expect(rendered(COPY["ack.credit_not_promised"])).toMatch(/does not determine whether/);
  });
});

describe("rendered output obeys the same rules", () => {
  const asOf = new Date("2027-02-01T18:00:00Z");
  const previews: Array<[string, CreditPreviewInput]> = [
    ["a single filer at the cap", { filingStatus: "single", asOf, taxpayers: [{ designatedCents: 170_000 }] }],
    ["a single filer over the cap", { filingStatus: "single", asOf, taxpayers: [{ designatedCents: 250_000 }] }],
    ["a State credit with a non-designated part", { filingStatus: "single", asOf, taxpayers: [{ designatedCents: 170_000, nonDesignatedCents: 30_000, expectedStateCreditCents: 50_000 }] }],
    ["a joint return, both spouses", { filingStatus: "married_joint", asOf, taxpayers: [{ designatedCents: 200_000 }, { designatedCents: 200_000 }] }],
    ["a joint return, one spouse", { filingStatus: "married_joint", asOf, taxpayers: [{ designatedCents: 340_000 }] }],
    [
      "a liability estimate with carryforwards and a fee",
      {
        filingStatus: "married_joint",
        asOf,
        taxYear: 2033,
        donorServiceFeeCents: 3400,
        taxpayers: [{ designatedCents: 170_000, goodsOrServicesValueCents: 1000 }, { designatedCents: 170_000 }],
        liability: { estimatedTaxCents: 100_000, otherCreditsCents: 20_000, carryforwards: [{ originYear: 2027, amountCents: 5000 }, { originYear: 2028, amountCents: 60_000 }] },
      },
    ],
    ["a gift before the credit start", { filingStatus: "single", asOf: new Date("2026-12-01T18:00:00Z"), taxpayers: [{ designatedCents: 170_000 }] }],
    ["a second gift in a year with other qualified contributions", { filingStatus: "single", asOf, taxpayers: [{ designatedCents: 100_000, otherQualifiedContributionsCents: 120_000 }] }],
  ];

  it.each(previews)("the panel for %s", (_label, input) => {
    const preview = previewCredit(input);
    const panel = renderCreditPanel(preview);
    const texts = [panel.title, ...panel.sections.flatMap((section) => [section.heading, ...section.lines.map((line) => line.label)]), ...panel.notes.map((note) => note.text)];
    for (const text of texts) {
      expect(text).not.toMatch(/[{}]/);
      for (const sentence of sentences(text)) {
        expect(freeClaimViolation(sentence), sentence).toBeNull();
        expect(deductibilityViolation(sentence), sentence).toBeNull();
        expect(irsPublicationViolation(sentence), sentence).toBeNull();
      }
    }
    // Preview, not tax advice: always.
    expect(panel.notes.map((note) => note.id)).toContain("note.preview_not_tax_advice");
    // Proposed rules shaped the numbers or the words: the "not final" note is there, in those words.
    const proposedShown = panel.notes.some((note) => note.id !== "note.proposed_rules_not_final" && note.authority === "proposed_reg");
    if (preview.flags.proposedRulesAffectNumbers || proposedShown) {
      const note = panel.notes.find((candidate) => candidate.id === "note.proposed_rules_not_final");
      expect(note?.text).toMatch(/based on proposed regulations .*that are not final/);
    }
    // $3,400 never appears without the each-spouse condition in the same note.
    for (const note of panel.notes) if (/\$3,400/.test(note.text)) expect(note.text).toContain("each spouse who makes a qualified contribution");
    // The panel never shows a tax figure the donor did not enter.
    if (!input.liability) expect(panel.sections.map((section) => section.key)).not.toContain("liability");
  });

  it("eligibility messages and fee lines", () => {
    const eligibility = assessCreditEligibility({
      paidAt: new Date("2026-12-01T18:00:00Z"),
      creditStartDate: "2027-01-01",
      sgo: { listSource: "provisional_curated", listStatus: "removed", removedOn: "2026-11-01", portalRegistered: false, stateParticipation: "advance_election_only" },
      attestations: { individual: false, usCitizenOrResident: false, noEarmark: false, notInExchangeForScholarship: false },
      paymentMethod: "crypto",
      currency: "eur",
      liveMode: false,
    });
    const messages = [...eligibility.blockers.map((blocker) => blocker.message), eligibility.headline?.message ?? ""];
    expect(messages.length).toBeGreaterThan(10);
    for (const message of messages) {
      for (const sentence of sentences(message)) {
        expect(freeClaimViolation(sentence), sentence).toBeNull();
        expect(deductibilityViolation(sentence), sentence).toBeNull();
        expect(irsPublicationViolation(sentence), sentence).toBeNull();
      }
    }
    for (const structure of FEE_STRUCTURES) {
      const gift = computeGiftLines({ structure, designatedCents: 170_000, nonDesignatedCents: 30_000, sgoFeeBps: 100, donorServiceFeeBps: 100 });
      for (const text of [...gift.lines.map((line) => line.label), gift.explanation.text]) {
        for (const sentence of sentences(text)) {
          expect(freeClaimViolation(sentence), sentence).toBeNull();
          expect(irsPublicationViolation(sentence), sentence).toBeNull();
        }
      }
    }
  });
});
