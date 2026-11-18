/**
 * Integrity of the tax copy registry: ids, placeholders, rendering, versions and hashes.
 * What the words may and may not claim is tested in banned-claims.test.ts. All names here are synthetic.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { AUTHORITIES } from "./authority";
import { CREDIT_CAP_PER_TAXPAYER_CENTS } from "./constants";
import {
  COPY,
  COPY_CONSTANTS,
  COPY_IDS,
  COPY_LOCALES,
  COPY_VERSION,
  copySha256,
  copyTemplate,
  defineCopyEntry,
  getCopy,
  hasTranslation,
  isCopyId,
  listCopy,
  renderCopy,
  renderCopyDynamic,
  renderCopyEntry,
  renderCopyWithProof,
  type CopyConstantName,
  type CopyEntry,
  type CopyId,
} from "./copy";

/**
 * The registry hash for each published COPY_VERSION. If this test fails you changed a word: bump
 * COPY_VERSION in copy.ts and add the new hash here, so stored donations keep pointing at the words they saw.
 */
const PUBLISHED_REGISTRY_HASHES: Record<string, string> = {
  "25f-copy.2026-11-18.v1": "a15be8bbc5c8d924ac2e01c772ed752749b674ba81ec2163ebc089eb79066a8a",
  "25f-copy.2026-11-18.v2": "e06fe170aeee7d6e11e2346cd74d1569945301bd244172bfd5947fa20571d5fc",
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** A synthetic value for every caller-supplied placeholder used anywhere in the registry. */
const SYNTHETIC_VARS: Record<string, string> = {
  aggregateAmount: "$6,000",
  calendarYear: "2027",
  creditStartDate: "January 1, 2027",
  description: "Synthetic tote bag",
  designatedAmount: "$1,700",
  donorNumber: "SANDBOX-0000-SYNTHETIC",
  ein: "00-0000000",
  email: "donor@example.com",
  estimatedValue: "$12",
  feeAmount: "$17",
  listCheckedDate: "March 1, 2027",
  listState: "Texas",
  listedFrom: "February 10, 2027",
  nonDesignatedAmount: "$300",
  paidDate: "January 15, 2027",
  platformName: "Synthetic Platform",
  projectedAmount: "$6,500",
  removedOn: "March 10, 2027",
  sgoName: "Synthetic Scholarship Fund",
  sharePercent: "2.14 percent",
  shareTestTotal: "$300,000",
  spouse1Amount: "$1,700",
  spouse1Name: "Robin Synthetic",
  spouse2Amount: "$1,500",
  spouse2Name: "Dana Synthetic",
  stateName: "Texas",
  totalContributions: "$280,000",
  totalDesignated: "$1,700",
};

const varsFor = (entry: CopyEntry) => Object.fromEntries(entry.variables.map((name) => [name, SYNTHETIC_VARS[name]]));
const renderAny = (entry: CopyEntry) => renderCopyDynamic(entry.id, varsFor(entry), { sgoListSource: "irs_published" });

function expectInternalError(run: () => unknown, pattern: RegExp): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe("internal");
  expect((thrown as AppError).message).toMatch(pattern);
}

describe("registry integrity", () => {
  it("has unique, well-formed ids and a complete entry behind each", () => {
    expect(COPY_IDS.length).toBeGreaterThan(100);
    expect(new Set(COPY_IDS).size).toBe(COPY_IDS.length);
    expect(listCopy().map((entry) => entry.id)).toEqual([...COPY_IDS]);
    for (const id of COPY_IDS) {
      const entry = COPY[id];
      expect(id).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/);
      expect(entry.id).toBe(id);
      expect(getCopy(id)).toBe(entry);
      expect(entry.text.trim()).toBe(entry.text);
      expect(entry.text.length).toBeGreaterThan(3);
      expect(entry.text).not.toMatch(/\s{2,}|\n|\t/);
      expect(AUTHORITIES).toContain(entry.authority);
      expect(entry.citation.trim().length, `${id} citation`).toBeGreaterThan(10);
      expect(["label", "statement", "attestation"]).toContain(entry.kind);
      expect(["donor", "sgo"]).toContain(entry.audience);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(Object.isFrozen(COPY)).toBe(true);
    expect(Object.isFrozen(COPY_IDS)).toBe(true);
  });

  it("never shows two different ids the same words", () => {
    const seen = new Map<string, string>();
    for (const entry of listCopy()) {
      expect(seen.get(entry.text), `${entry.id} repeats ${seen.get(entry.text)}`).toBeUndefined();
      seen.set(entry.text, entry.id);
    }
  });

  it("cites the document its authority tag names", () => {
    const expected: Record<string, RegExp> = {
      statute: /26 U\.S\.C\. 25F/,
      temporary_reg: /T\.D\. 10057/,
      proposed_reg: /REG-117199-25/,
      irs_web: /IRS/,
      product_policy: /\S/,
    };
    for (const entry of listCopy()) expect(entry.citation, `${entry.id} (${entry.authority})`).toMatch(expected[entry.authority]);
  });

  it("statements are sentences; attestations are in the donor's own voice", () => {
    for (const entry of listCopy()) {
      if (entry.kind === "statement") expect(entry.text, entry.id).toMatch(/[.:)]$|\{[A-Za-z]+\}$/);
      if (entry.kind === "attestation") expect(entry.text, entry.id).toMatch(/^(I |This payment is made on behalf of both spouses)/);
      if (entry.kind === "label") expect(entry.text, entry.id).not.toMatch(/\.$/);
    }
  });

  it("knows a copy id from any other string", () => {
    expect(isCopyId("note.cap_per_taxpayer")).toBe(true);
    expect(isCopyId("note.does_not_exist")).toBe(false);
    expect(isCopyId("toString")).toBe(false);
    expect(isCopyId("__proto__")).toBe(false);
    expect(isCopyId(undefined)).toBe(false);
    expectInternalError(() => getCopy("note.does_not_exist" as CopyId), /Unknown tax copy id/);
    expectInternalError(() => renderCopyDynamic("constructor" as CopyId), /Unknown tax copy id/);
  });

  it("contains every piece of copy the checkout needs", () => {
    const required: CopyId[] = [
      // panel lines and labels
      "panel.title",
      "line.designated",
      "line.estimated_credit",
      "line.over_cap",
      "line.state_credit_reduction",
      "note.preview_not_tax_advice",
      "note.proposed_rules_not_final",
      // each caveat the panel must show
      "note.cap_per_taxpayer",
      "note.joint_each_spouse",
      "note.state_credit_reduction",
      "note.nonrefundable",
      "note.liability_limit",
      "note.carryforward",
      "note.section_170_no_double_benefit",
      "note.excess_may_be_deductible",
      "note.what_to_keep",
      "note.claim_form",
      // designation, irrevocability, attestations, earmarking
      "designation.statement",
      "designation.statement_joint",
      "designation.irrevocable",
      "attest.individual",
      "attest.us_citizen_or_resident",
      "attest.no_earmark",
      "attest.not_in_exchange",
      "notice.no_earmark",
      // list and timing labels
      "notice.sgo_list_provisional",
      "eligibility.before_credit_start_sandbox",
      // fees, one explanation per structure
      "fee.none.donor",
      "fee.sgo_invoiced.donor",
      "fee.donor_service_fee.donor",
      "fee.line.donor_service_fee",
      // receipt and acknowledgment
      "receipt.not_official_acknowledgment",
      "ack.total_designated",
      "ack.donor_number",
      "ack.goods_or_services_none",
    ];
    for (const id of required) expect(isCopyId(id), id).toBe(true);
  });
});

describe("placeholders", () => {
  it("every placeholder is a constant or a declared variable, and no brace is left over", () => {
    const constantNames = Object.keys(COPY_CONSTANTS.en);
    for (const entry of listCopy()) {
      const found = [...new Set(Array.from(entry.text.matchAll(/\{([^{}]*)\}/g), (match) => match[1]))];
      for (const name of found) expect(name, `${entry.id} {${name}}`).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
      expect([...entry.variables, ...entry.constants].sort(), entry.id).toEqual([...found].sort());
      for (const name of entry.constants) expect(constantNames, `${entry.id} {${name}}`).toContain(name);
      for (const name of entry.variables) expect(constantNames, `${entry.id} {${name}}`).not.toContain(name);
      expect(entry.text.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, ""), entry.id).not.toMatch(/[{}]/);
    }
  });

  it("the test fixture supplies every variable the registry uses, and nothing stale", () => {
    const used = new Set(listCopy().flatMap((entry) => entry.variables));
    expect([...used].sort()).toEqual(Object.keys(SYNTHETIC_VARS).sort());
  });

  it("fills constants from the rule values, in both locales", () => {
    expect(COPY_CONSTANTS.en).toEqual({
      cap: "$1,700",
      jointCap: "$3,400",
      carryforwardYears: "five",
      otherCreditSections: "21, 22, 24, 25, 25A, 25B, 25C and 25E",
      proposedRuleId: "REG-117199-25",
      claimForm: "Form 8525",
      claimFormTitle: "Federal Scholarship Tax Credit",
      claimFormFilingSeason: "2028",
      firstCreditYear: "2027",
      acknowledgmentDeadline: "January 31",
      stateListDeadline2027: "February 15, 2027",
      substantialAmount: "$5,000",
      substantialPercent: "2 percent",
    });
    expect(COPY_CONSTANTS.es).toMatchObject({
      cap: "$1,700",
      carryforwardYears: "cinco",
      otherCreditSections: "21, 22, 24, 25, 25A, 25B, 25C y 25E",
      acknowledgmentDeadline: "31 de enero",
      stateListDeadline2027: "15 de febrero de 2027",
      substantialPercent: "2 por ciento",
    });
    expect(Object.keys(COPY_CONSTANTS.es).sort()).toEqual(Object.keys(COPY_CONSTANTS.en).sort());
    expect(COPY_CONSTANTS.en.cap).toBe(`$${(CREDIT_CAP_PER_TAXPAYER_CENTS.value / 100).toLocaleString("en-US")}`);
    // Every constant is used by at least one entry.
    const used = new Set<CopyConstantName>(listCopy().flatMap((entry) => entry.constants));
    expect([...used].sort()).toEqual(Object.keys(COPY_CONSTANTS.en).sort());
  });

  it("types no section 25F number into a sentence: figures come only from constants and variables", () => {
    for (const entry of listCopy()) {
      const withoutSectionNumbers = entry.text
        .replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, "")
        .replace(/[Ss]ection 25F/g, "")
        .replace(/section 26\(a\)/g, "")
        .replace(/section 170/g, "")
        .replace(/December 31/g, "");
      expect(withoutSectionNumbers, entry.id).not.toMatch(/\d/);
      expect(entry.text, entry.id).not.toMatch(/\$\s?\d/);
    }
  });
});

describe("renderCopy", () => {
  it("renders every entry with its variables and leaves no placeholder behind", () => {
    for (const entry of listCopy()) {
      const text = renderAny(entry);
      expect(text, entry.id).not.toMatch(/[{}]/);
      expect(text, entry.id).not.toMatch(/undefined|null|NaN/);
      for (const name of entry.variables) expect(text, `${entry.id} {${name}}`).toContain(SYNTHETIC_VARS[name]);
      for (const name of entry.constants) expect(text, `${entry.id} {${name}}`).toContain(COPY_CONSTANTS.en[name]);
    }
  });

  it("interpolates the designation statement with the amount and the organization", () => {
    expect(renderCopy("designation.statement", { designatedAmount: "$1,700", sgoName: "Synthetic Scholarship Fund" })).toBe(
      "I designate $1,700 of this payment to Synthetic Scholarship Fund as a qualified contribution under Internal Revenue Code section 25F.",
    );
    expect(
      renderCopy("designation.statement_joint", {
        spouse1Name: "Robin Synthetic",
        spouse1Amount: "$1,700",
        spouse2Name: "Dana Synthetic",
        spouse2Amount: "$1,500",
        sgoName: "Synthetic Scholarship Fund",
      }),
    ).toBe(
      "This payment is made on behalf of both spouses. Robin Synthetic designates $1,700 and Dana Synthetic designates $1,500 of this payment to Synthetic Scholarship Fund as qualified contributions under Internal Revenue Code section 25F.",
    );
  });

  it("fills constants without being asked", () => {
    expect(renderCopy("line.over_cap")).toBe("Less: amount above the $1,700 limit (no federal credit)");
    expect(renderCopy("note.carryforward")).toBe(
      "Credit you cannot use in a year because of the tax-liability limit carries forward for up to five tax years and is used oldest first; after that it expires.",
    );
    expect(renderCopy("note.proposed_rules_not_final")).toBe(
      "Parts of this preview are based on proposed regulations (REG-117199-25) that are not final. The final rules may be different.",
    );
    expect(renderCopy("receipt.not_official_acknowledgment", { sgoName: "Synthetic Scholarship Fund" })).toBe(
      "This is a payment receipt, not the official written acknowledgment for the section 25F credit. Synthetic Scholarship Fund will send your official acknowledgment, with your unique donor number, by January 31 of the year after your gift.",
    );
  });

  it("inserts a value literally, even when it looks like a placeholder or a replacement pattern", () => {
    expect(renderCopy("receipt.goods_or_services_none", { sgoName: "{cap} $& $1 Fund" })).toBe("{cap} $& $1 Fund provided no goods or services in return for this gift.");
  });

  it("refuses a missing, empty, misnamed or non-text variable", () => {
    expectInternalError(() => renderCopyDynamic("designation.statement", { designatedAmount: "$1,700" }), /missing sgoName/);
    expectInternalError(() => renderCopyDynamic("designation.statement"), /missing designatedAmount, sgoName/);
    expectInternalError(() => renderCopyDynamic("designation.statement", { designatedAmount: "$1,700", sgoName: "   " }), /non-empty text value for \{sgoName\}/);
    expectInternalError(() => renderCopyDynamic("designation.statement", { designatedAmount: "$1,700", sgoName: "X", amount: "$5" }), /not used by this entry: amount/);
    expectInternalError(() => renderCopyDynamic("designation.statement", { designatedAmount: 170000 as unknown as string, sgoName: "X" }), /non-empty text value/);
    // A caller may not override a constant such as the cap.
    expectInternalError(() => renderCopyDynamic("line.over_cap", { cap: "$9,999" }), /not used by this entry: cap/);
    expectInternalError(() => renderCopyDynamic("note.nonrefundable", { anything: "x" }), /not used by this entry/);
  });

  it("checks variables at compile time for a literal id", () => {
    // @ts-expect-error sgoName is required
    expect(() => renderCopy("designation.statement", { designatedAmount: "$1,700" })).toThrow(AppError);
    // @ts-expect-error both variables are required
    expect(() => renderCopy("designation.statement")).toThrow(AppError);
    // @ts-expect-error amount is not a variable of this entry
    expect(() => renderCopy("designation.statement", { designatedAmount: "$1", sgoName: "X", amount: "$1" })).toThrow(AppError);
    // @ts-expect-error constants cannot be supplied by the caller
    expect(() => renderCopy("line.over_cap", { cap: "$9,999" })).toThrow(AppError);
    // @ts-expect-error not a copy id
    expect(() => renderCopy("note.nope")).toThrow(AppError);
    expect(renderCopy("note.nonrefundable", {}, { locale: "en" })).toBe(COPY["note.nonrefundable"].text);
  });

  it("returns the version and hashes needed to prove which words were shown", () => {
    const vars = { designatedAmount: "$1,700", sgoName: "Synthetic Scholarship Fund" };
    const proof = renderCopyWithProof("designation.statement", vars);
    expect(proof).toEqual({
      id: "designation.statement",
      copyVersion: COPY_VERSION,
      locale: "en",
      text: renderCopy("designation.statement", vars),
      templateSha256: copySha256("designation.statement"),
      textSha256: sha256(renderCopy("designation.statement", vars)),
    });
    expect(Object.isFrozen(proof)).toBe(true);
    // Same words, same proof; a different amount changes only the text hash.
    expect(renderCopyWithProof("designation.statement", vars)).toEqual(proof);
    const other = renderCopyWithProof("designation.statement", { ...vars, designatedAmount: "$1,000" });
    expect(other.templateSha256).toBe(proof.templateSha256);
    expect(other.textSha256).not.toBe(proof.textSha256);
  });
});

describe("entries that describe the IRS-published list are gated", () => {
  const gated = listCopy().filter((entry) => entry.onlyWhen === "irs_list_is_source");

  it("there are exactly three, and each refuses to render unless the IRS list is the list in use", () => {
    expect(gated.map((entry) => entry.id).sort()).toEqual(["notice.list_reliance", "notice.list_reliance_unavailable", "notice.sgo_list_irs"]);
    for (const entry of gated) {
      const vars = varsFor(entry);
      expectInternalError(() => renderCopyDynamic(entry.id, vars), /may only be shown when that list is the list in use/);
      expectInternalError(() => renderCopyDynamic(entry.id, vars, { sgoListSource: "provisional_curated" }), /may only be shown/);
      expectInternalError(() => renderCopyWithProof(entry.id, vars, { locale: "en" }), /may only be shown/);
      expect(renderCopyDynamic(entry.id, vars, { sgoListSource: "irs_published" })).not.toMatch(/[{}]/);
    }
    expect(renderCopy("notice.sgo_list_irs", { listState: "Texas", platformName: "Synthetic Platform", listCheckedDate: "March 1, 2027" }, { sgoListSource: "irs_published" })).toBe(
      "On the IRS list of scholarship granting organizations for Texas, and not shown as removed, when Synthetic Platform last checked on March 1, 2027.",
    );
  });

  it("ungated entries render under either list source", () => {
    expect(renderCopy("notice.sgo_list_provisional", { platformName: "Synthetic Platform" }, { sgoListSource: "provisional_curated" })).toContain("Provisional list.");
    expect(renderCopy("notice.sgo_list_provisional", { platformName: "Synthetic Platform" }, { sgoListSource: "irs_published" })).toContain("Provisional list.");
  });
});

describe("locales", () => {
  it("English is complete; a missing Spanish text falls back to English and says so", () => {
    expect(COPY_LOCALES).toEqual(["en", "es"]);
    for (const entry of listCopy()) {
      expect(hasTranslation(entry.id, "en")).toBe(true);
      const spanish = entry.translations.es;
      expect(hasTranslation(entry.id, "es")).toBe(spanish !== undefined);
      if (spanish === undefined) {
        const rendered = renderCopyWithProof(entry.id, varsFor(entry), { locale: "es", sgoListSource: "irs_published" });
        expect(rendered.locale, entry.id).toBe("en");
        expect(rendered.text, entry.id).toBe(renderAny(entry));
        expect(copySha256(entry.id, "es")).toBe(copySha256(entry.id, "en"));
      } else {
        // A translation must use exactly the placeholders of the English text.
        const names = (text: string) => [...new Set(Array.from(text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), (match) => match[1]))].sort();
        expect(names(spanish), entry.id).toEqual(names(entry.text));
      }
    }
  });

  it("renders a Spanish text, with Spanish constants, once an entry has one", () => {
    const entry = defineCopyEntry("test.synthetic_entry", {
      kind: "statement",
      audience: "donor",
      text: "Synthetic: {sgoName} keeps credit for {carryforwardYears} years, due {acknowledgmentDeadline}, up to {cap}.",
      es: "Sintético: {sgoName} conserva el crédito por {carryforwardYears} años, hasta el {acknowledgmentDeadline}, máximo {cap}.",
      authority: "product_policy",
      citation: "Synthetic entry used only by this test.",
    });
    expect(entry.variables).toEqual(["sgoName"]);
    expect(entry.constants).toEqual(["carryforwardYears", "acknowledgmentDeadline", "cap"]);
    expect(entry.translations.es).toBeDefined();

    const english = renderCopyEntry(entry, { sgoName: "Fondo Sintético" });
    const spanish = renderCopyEntry(entry, { sgoName: "Fondo Sintético" }, { locale: "es" });
    expect(english.locale).toBe("en");
    expect(english.text).toBe("Synthetic: Fondo Sintético keeps credit for five years, due January 31, up to $1,700.");
    expect(spanish.locale).toBe("es");
    expect(spanish.text).toBe("Sintético: Fondo Sintético conserva el crédito por cinco años, hasta el 31 de enero, máximo $1,700.");
    expect(spanish.templateSha256).not.toBe(english.templateSha256);
    expect(spanish.textSha256).toBe(sha256(spanish.text));
    expectInternalError(() => renderCopyEntry(entry, {}, { locale: "es" }), /missing sgoName/);
  });
});

describe("versions and hashes", () => {
  it("hashes exactly the words of an entry, with constants filled in", () => {
    for (const id of COPY_IDS) {
      const template = copyTemplate(id);
      expect(template).not.toMatch(/\{(cap|jointCap|carryforwardYears|claimForm)\}/);
      expect(copySha256(id), id).toBe(sha256(JSON.stringify([id, "en", template])));
      expect(copySha256(id)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(copyTemplate("designation.statement")).toBe(
      "I designate {designatedAmount} of this payment to {sgoName} as a qualified contribution under Internal Revenue Code section 25F.",
    );
    expect(copyTemplate("line.over_cap")).toBe("Less: amount above the $1,700 limit (no federal credit)");
  });

  it("gives every entry a different hash and is stable from call to call", () => {
    const hashes = COPY_IDS.map((id) => copySha256(id));
    expect(new Set(hashes).size).toBe(COPY_IDS.length);
    expect(COPY_IDS.map((id) => copySha256(id))).toEqual(hashes);
    expect(copySha256()).toBe(copySha256());
    expect(copySha256()).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes).not.toContain(copySha256());
  });

  it("the whole-registry hash covers every id and every word", () => {
    const expected = sha256(JSON.stringify([...COPY_IDS].sort().map((id) => [id, copyTemplate(id), [["es", COPY[id].translations.es ?? null]]])));
    expect(copySha256()).toBe(expected);
  });

  it("pins the registry hash to COPY_VERSION: changing a word without bumping the version fails here", () => {
    expect(COPY_VERSION).toMatch(/^25f-copy\.\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(Object.keys(PUBLISHED_REGISTRY_HASHES)).toContain(COPY_VERSION);
    expect(copySha256(), "tax copy changed: bump COPY_VERSION and record the new hash in PUBLISHED_REGISTRY_HASHES").toBe(
      PUBLISHED_REGISTRY_HASHES[COPY_VERSION],
    );
  });
});
