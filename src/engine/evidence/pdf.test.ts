import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { PDF_COPY } from "./copy";
import { formatUtcClock, formatUtcTimestamp, groupHash } from "./format";
import { EVIDENCE_PDF_RENDERER, renderEvidencePdf } from "./pdf";
import { buildEvidenceRecord, signEvidenceRecord } from "./record";
import { syntheticCategoricalEligibleInput, syntheticDirectReviewedInput, syntheticDocuments, syntheticHarrisThreshold, syntheticIrsPublishedThreshold } from "./synthetic-fixtures";
import { extractPdfText, generateTestSigningKey, type ExtractedPdf } from "./test-support";
import type { EvidenceInput, EvidencePdfOptions, SignedEvidence } from "./types";

const key = generateTestSigningKey("test-pdf-key");
const OPTIONS: EvidencePdfOptions = { verifyUrl: "https://passport.example.org/.well-known/jwks.json", brand: { name: "Passport" } };

function altered(base: EvidenceInput, change: (input: EvidenceInput) => void): EvidenceInput {
  const copy = structuredClone(base);
  change(copy);
  return copy;
}

async function render(input: EvidenceInput, options: EvidencePdfOptions = OPTIONS): Promise<{ signed: SignedEvidence; bytes: Uint8Array; pdf: ExtractedPdf }> {
  const signed = signEvidenceRecord(buildEvidenceRecord(input), key);
  const bytes = await renderEvidencePdf(signed, options);
  return { signed, bytes, pdf: await extractPdfText(bytes) };
}

/** A direct verification decided by the engine against a single (synthetic) published limit: no provisional wording anywhere in its input. */
function publishedLimitInput(): EvidenceInput {
  return altered(syntheticDirectReviewedInput(), (copy) => {
    copy.threshold = syntheticIrsPublishedThreshold();
    copy.household.members.pop();
    copy.household.size = 4;
  });
}

const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/;
const NINE_DIGITS = /\b\d{9}\b/;

describe("renderEvidencePdf: what an auditor has to find", () => {
  it("prints every required element of a categorical decision", async () => {
    const { signed, pdf } = await render(syntheticCategoricalEligibleInput());
    const { record } = signed;
    const cover = pdf.pages[0];

    // Decision in words, status and method, on the cover.
    expect(cover).toContain("Income verification evidence pack");
    expect(cover).toContain(record.decision.summary);
    expect(cover).toContain("Eligible - Household income requirement met");
    expect(cover).toContain("Categorical eligibility verification method");
    expect(cover).toContain("Prop. Reg. 1.25F-3(c)(6)(iii)(B), REG-117199-25 (proposed regulations, not final)");
    // Household size, area, limit, categorical basis.
    expect(cover).toContain("Household size 4 persons");
    expect(cover).toContain("Harris County, TX (FIPS 48201)");
    expect(cover).toContain("Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area (area code METRO26420M26420)");
    expect(cover).toContain("$312,000.00");
    expect(cover).toContain("Table hud-fy2026-tx, effective May 1, 2026");
    expect(cover).toContain("Categorical basis Supplemental Nutrition Assistance Program (SNAP) Documentation dated August 14, 2026.");
    expect(cover).toContain("Sofía Peña");
    expect(cover).toContain("ver_SYNTHETICcategorical01");
    expect(cover).toContain("Synthetic Sample Scholarship Fund (not a real organization)");
    expect(cover).toContain("EIN 00-0000000");
    expect(cover).toContain("SGO reference: SYNTHETIC-APP-0001");

    // Threshold with source, table version and effective date; the formula with its numbers.
    expect(pdf.text).toContain("1. How this limit was calculated");
    expect(pdf.text).toContain("300% x $104,000 area median income x 1.00 family-size multiplier (4 persons) = $312,000.00");
    expect(pdf.text).toContain("6 x $52,000 HUD very-low-income limit (4 persons) = $312,000.00");
    expect(pdf.text).toContain("Source of the table Provisional (hud_provisional)");
    expect(pdf.text).toContain("Table version hud-fy2026-tx");
    expect(pdf.text).toContain("Effective date of the table May 1, 2026 (2026-05-01)");
    expect(pdf.text).toContain("Area median income (four-person basis) $104,000.00");
    expect(pdf.text).toContain(record.threshold.label.explanation);
    expect(pdf.text).toContain(record.threshold.label.readings_note);
    expect(pdf.text).toContain(`Which limit the decision relied on ${record.threshold.relied_on_statement}`);

    // Consent version and timestamp.
    expect(pdf.text).toContain("5. Consent record");
    expect(pdf.text).toContain("Text version synthetic-consent-copy.v1");
    expect(pdf.text).toContain(`Given ${formatUtcTimestamp(record.consent.granted_at)} by María Peña`);
    expect(pdf.text).toContain("Given 2027-01-11 17:55:42 UTC by María Peña");
    expect(pdf.text).toContain(groupHash(record.consent.copy_sha256));

    // Document identifiers, hashes, extraction method and what was read.
    for (const document of record.documents) {
      expect(pdf.text).toContain(document.id);
      expect(pdf.compact).toContain(document.sha256);
      expect(pdf.compact).toContain(document.filename);
    }
    expect(pdf.text).toContain("Read by document parser Raw file retained");
    expect(pdf.text).toContain("184,233 bytes");
    expect(pdf.text).toContain("Certification period ends certification_period_end 2027-01-31 95%");
    expect(pdf.text).toContain(PDF_COPY.noRails);

    // Who or what reviewed: here, the engine.
    expect(pdf.text).toContain("Decision made by Decision engine, version synthetic-decision-engine-1.0.0");
    expect(pdf.text).toContain(PDF_COPY.noReviewEngine("synthetic-decision-engine-1.0.0"));
    expect(pdf.text).toContain("categorical_approval_current");

    // Categorical detail and timeline.
    expect(pdf.text).toContain("4. Categorical eligibility detail");
    expect(pdf.text).toContain("Approval status read from the document Currently approved");
    expect(pdf.text).toContain("Household member named M.P. (adult) hm_SYNTHETICmember000002");
    expect(pdf.text).toContain(`${formatUtcClock("2027-01-11T17:55:42.000Z")} Consent given Family`);
    expect(pdf.text).not.toContain("Household income for");
  });

  it("prints every required element of a reviewed direct decision", async () => {
    const { signed, pdf } = await render(syntheticDirectReviewedInput());
    const { record } = signed;
    const cover = pdf.pages[0];
    expect(cover).toContain(record.decision.summary);
    expect(cover).toContain("Direct income verification method");
    expect(cover).toContain("Review of written documentation and other relevant data sources. Prop. Reg. 1.25F-3(c)(6)(iii)(A)");
    expect(cover).toContain("Household size 5 persons");
    expect(cover).toContain("Starr County, TX (FIPS 48427)");
    expect(cover).toContain("$125,388.00 to $271,200.00, depending on the reading");
    expect(cover).toContain("The decision relied on the lower bound: $125,388.00");
    expect(cover).toContain("Household income counted (2026) $84,250.37");
    expect(cover).toContain("Students Mateo Garza, Elena Garza");
    expect(cover).toContain("Decided 2027-02-03 15:12:44 UTC Reviewer: Riley Example (synthetic reviewer) (usr_SYNTHETICreviewer00001)");

    // Every reading, both bounds, and the plain statement of which was relied on.
    for (const reading of record.threshold.readings) {
      expect(pdf.text).toContain(reading.label);
      expect(pdf.text).toContain(reading.formula);
      expect(pdf.text).toContain(reading.id);
    }
    expect(pdf.text).toContain("Lower bound (smallest reading) $125,388.00");
    expect(pdf.text).toContain("Upper bound (largest reading) $271,200.00");
    expect(pdf.text).toContain(record.threshold.relied_on_statement);

    // Documents, the purged one, the rail and its report hash.
    for (const document of record.documents) {
      expect(pdf.text).toContain(document.id);
      expect(pdf.compact).toContain(document.sha256);
    }
    expect(pdf.text).toContain("Keyed by a reviewer Raw file deleted on 2027-03-05; hash retained");
    expect(pdf.text).toContain("rail_SYNTHETICpayroll000001");
    expect(pdf.compact).toContain(record.rails[0].report_sha256);
    expect(pdf.text).toContain("Under consent con_SYNTHETICconsent000003");

    // Income by category with sources and the total.
    expect(pdf.text).toContain("4. Household income for 2026");
    expect(pdf.text).toContain("Wages and salaries Form W-2, box 1 Member A.G. (adult) Document doc_SYNTHETICw200000000001 Counted Cash wages for the income year $52,310.00");
    expect(pdf.text).toContain("Not counted Non-cash item; not counted under the proposed rules $7,200.00");
    expect(pdf.text).toContain("Total household cash income counted for 2026 $84,250.37");

    // Both consents.
    expect(pdf.text).toContain("Given 2027-01-29 20:05:51 UTC by Ana Garza");
    expect(pdf.text).toContain("Consent to connect a data source");
    expect(pdf.text).toContain("Text version synthetic-rail-consent-copy.v1");

    // Who reviewed the exception, and what they wrote.
    expect(pdf.text).toContain("Decision made by Reviewer: Riley Example (synthetic reviewer) (usr_SYNTHETICreviewer00001)");
    expect(pdf.text).toContain(`Reviewer notes ${record.decision.decided_by.reviewer_notes}`);
    expect(pdf.text).toContain("Who or what reviewed exceptions");
    expect(pdf.text).toContain("2027-02-03 15:12:44 Reviewer: Riley Example (synthetic reviewer) usr_SYNTHETICreviewer00001 Resolved: eligible Counted income is within the limit under both readings");
    expect(pdf.text).toContain("2027-01-30 08:02:10 Decision engine Sent to review");
    expect(pdf.text).not.toContain("Categorical eligibility detail");
  });

  it("ends with an integrity page that says how to verify", async () => {
    const { signed, pdf } = await render(syntheticDirectReviewedInput());
    const last = pdf.pages[pdf.pages.length - 1];
    expect(last).toContain("8. Integrity and verification");
    expect(last).toContain(PDF_COPY.governs);
    expect(last).toContain(`Record SHA-256 ${groupHash(signed.signature.record_sha256)}`);
    expect(last.replace(/\s+/g, "")).toContain(signed.signature.value);
    expect(last).toContain("Signature algorithm EdDSA (Ed25519)");
    expect(last).toContain("Signing key id test-pdf-key");
    expect(last).toContain("ecca-jcs-1");
    expect(last).toContain("Public keys https://passport.example.org/.well-known/jwks.json");
    expect(last).toContain("npm run evidence:verify -- <record.json> --jwks <key-set file or URL>");
    expect(last).toContain('pick the key whose "kid" is test-pdf-key');
    expect(last).toContain("Engine version synthetic-decision-engine-1.0.0");
    expect(last).toContain("Income taxonomy version synthetic-income-taxonomy-1");
    expect(last).toContain("Data-minimization rule evidence-minimization.v1");
    // Nothing but the integrity section shares the last page.
    expect(last).not.toContain("7. Timeline");
  });

  it("states a nothing-found result in words instead of leaving a blank", async () => {
    const input = altered(syntheticCategoricalEligibleInput(), (copy) => {
      copy.timeline = [];
      copy.documents[0].extractedFields = [];
      copy.documents[0].extractedBy = null;
    });
    const { pdf } = await render(input);
    expect(pdf.text).toContain(PDF_COPY.noTimeline);
    expect(pdf.text).toContain(PDF_COPY.noFields);
    expect(pdf.text).toContain("No fields read");
  });
});

describe("renderEvidencePdf: provisional label", () => {
  it("shows the provisional block on the cover, in the threshold label's exact words, when the limit is provisional", async () => {
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput()]) {
      const { signed, pdf } = await render(input);
      const label = signed.record.threshold.label;
      expect(signed.record.threshold.provisional).toBe(true);
      expect(pdf.pages[0]).toContain(`${label.badge} ${label.limit_label} ${label.source_line}`);
      expect(pdf.pages[0]).toContain("Provisional Provisional income limit (HUD-derived) Provisional, HUD-derived limit computed from HUD FY 2026 area median family income (effective May 1, 2026). This is not an IRS-published limit.");
      expect(pdf.text).toContain(label.explanation);
    }
  });

  it("uses whatever words the label carries, not its own", async () => {
    const input = altered(syntheticCategoricalEligibleInput(), (copy) => {
      copy.threshold.label = { copyVersion: "custom.v9", badge: "Interim figure", limitLabel: "Interim limit (custom wording)", sourceLine: "Custom source line for this test.", explanation: "Custom explanation for this test.", readingsNote: "Custom note about readings." };
    });
    const { pdf } = await render(input);
    expect(pdf.pages[0]).toContain("Interim figure Interim limit (custom wording) Custom source line for this test.");
    expect(pdf.text).toContain("Custom explanation for this test.");
    expect(pdf.text).toContain("Custom note about readings.");
    expect(pdf.text).toContain("Wording version custom.v9");
  });

  it("has no provisional block, and no such word anywhere, when the limit is not provisional", async () => {
    const { signed, pdf } = await render(publishedLimitInput());
    expect(signed.record.threshold.provisional).toBe(false);
    expect(pdf.text).not.toMatch(/provisional/i);
    expect(pdf.text).not.toMatch(/HUD/);
    // The source of the limit is still on the cover and in section 1, in the label's words.
    expect(pdf.pages[0]).toContain("Income limit (IRS-published) $300,000.00 IRS-published limit (SYNTHETIC CITATION), effective January 1, 2027.");
    expect(pdf.text).toContain("Source of the table IRS-published (irs_published)");
    expect(pdf.text).toContain(signed.record.threshold.label.explanation);
    expect(pdf.text).toContain("The limit under the table in use");
    expect(pdf.text).not.toContain("Every reading of the limit");
    expect(pdf.text).not.toContain("Lower bound (smallest reading)");
  });
});

describe("renderEvidencePdf: test mode", () => {
  it("watermarks every page and says so on the cover and in the footer, in test mode only", async () => {
    const test = await render(syntheticCategoricalEligibleInput());
    expect(test.signed.record.mode).toBe("test");
    expect(test.pdf.pages.length).toBeGreaterThan(3);
    for (const page of test.pdf.pages) {
      // Once for the watermark and once for the footer on every page.
      expect(page.match(/TEST MODE/g)!.length).toBeGreaterThanOrEqual(2);
    }
    expect(test.pdf.pages[0]).toContain(PDF_COPY.testBanner);
    expect(test.pdf.pages[0]).toContain("Mode Test (sandbox)");
    expect(test.pdf.info.Subject).toContain("(test mode)");

    const live = await render(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.mode = "live")));
    expect(live.pdf.text).not.toMatch(/test mode/i);
    expect(live.pdf.text).not.toMatch(/sandbox/i);
    expect(live.pdf.pages[0]).toContain("Mode Live");
    expect(live.pdf.info.Subject).not.toContain("test");
  });
});

describe("renderEvidencePdf: pagination", () => {
  it("is US Letter with a header and a 'Page X of Y' footer on every page", async () => {
    const { signed, bytes, pdf } = await render(syntheticDirectReviewedInput());
    const document = await PDFDocument.load(bytes);
    const total = document.getPageCount();
    expect(total).toBe(pdf.pages.length);
    for (const page of document.getPages()) expect(page.getSize()).toEqual({ width: 612, height: 792 });
    pdf.pages.forEach((page, index) => {
      expect(page).toContain(`Page ${index + 1} of ${total}`);
      expect(page).toContain("Passport | Income verification evidence pack");
      expect(page).toContain(signed.record.verification_id);
      expect(page).toContain(`Generated ${formatUtcTimestamp(signed.record.generated_at)}`);
      expect(page).toContain(`Record SHA-256 ${signed.signature.record_sha256.slice(0, 16)}...`);
    });
  });

  it("carries 40 documents across pages, repeating the table header and losing nothing", async () => {
    const documents = syntheticDocuments(40);
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.documents = documents;
      copy.income = {
        year: 2026,
        totalCountedCents: documents.length * 100_000,
        items: documents.map((document, index) => ({
          id: `inc_SYNTHETICbulkitem00${String(index + 1).padStart(3, "0")}`,
          category: "wages",
          categoryLabel: "Wages and salaries",
          annualAmountCents: 100_000,
          counted: true,
          source: "document" as const,
          documentId: document.id,
        })),
      };
    });
    const few = await render(syntheticDirectReviewedInput());
    const { signed, pdf } = await render(input);
    expect(signed.record.documents).toHaveLength(40);
    expect(pdf.pages.length).toBeGreaterThan(few.pdf.pages.length + 5);

    for (const document of signed.record.documents) {
      // In the documents table, in the fields section and in the income table.
      expect(pdf.text.split(document.id).length - 1, document.id).toBeGreaterThanOrEqual(3);
      expect(pdf.compact).toContain(document.sha256);
      expect(pdf.compact).toContain(document.filename);
    }
    const withDocumentHeader = pdf.pages.filter((page) => page.includes("Document File Extraction and raw file SHA-256 of the stored file"));
    expect(withDocumentHeader.length).toBeGreaterThanOrEqual(3);
    const withIncomeHeader = pdf.pages.filter((page) => page.includes("Category Source Counted Annual amount"));
    expect(withIncomeHeader.length).toBeGreaterThanOrEqual(2);
    expect(pdf.text).toContain("Documents (40)");
    expect(pdf.text).toContain("Total household cash income counted for 2026 $40,000.00");

    const total = pdf.pages.length;
    pdf.pages.forEach((page, index) => expect(page).toContain(`Page ${index + 1} of ${total}`));
    // A section heading is never left alone at the bottom of a page.
    for (const page of pdf.pages) expect(page).not.toMatch(/\d\. [A-Z][a-z ]+ (TEST MODE \| )?Generated \d{4}/);
  });

  it("wraps long text and breaks long tokens instead of running off the page", async () => {
    const longNotes = Array.from({ length: 50 }, (_, index) => `Sentence ${index + 1} of the reviewer's long synthetic note about the documents.`).join(" ");
    const longToken = "x".repeat(600);
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      (copy.decision.decidedBy as { notes: string }).notes = longNotes;
      copy.reviewTrail[1].notes = `${longToken} end-of-token`;
      copy.timeline[3].detail = Array.from({ length: 90 }, (_, index) => `detail${index}`).join(" ");
    });
    const { pdf } = await render(input);
    expect(pdf.text).toContain("Sentence 50 of the reviewer's long synthetic note about the documents.");
    expect(pdf.compact).toContain(longToken);
    expect(pdf.text).toContain("end-of-token");
    expect(pdf.text).toContain("detail89");
    const total = pdf.pages.length;
    pdf.pages.forEach((page, index) => expect(page).toContain(`Page ${index + 1} of ${total}`));
  });

  it("splits a table row that is taller than a whole page", async () => {
    // About 4,000 characters in a 150-point column is roughly 120 lines: two pages of one table row.
    const words = Array.from({ length: 500 }, (_, index) => `note${index}`);
    const base = await render(syntheticDirectReviewedInput());
    const { pdf } = await render(altered(syntheticDirectReviewedInput(), (copy) => void (copy.reviewTrail[1].notes = words.join(" "))));
    expect(pdf.pages.length).toBeGreaterThanOrEqual(base.pdf.pages.length + 2);
    for (const word of words) expect(pdf.text, word).toContain(`${word} `);
    const spread = pdf.pages.filter((page) => /note\d+/.test(page));
    expect(spread.length).toBeGreaterThanOrEqual(3);
    // The table header is repeated on each page the row continues on.
    for (const page of spread) expect(page).toContain("When (UTC) Who or what Action Notes");
    const total = pdf.pages.length;
    pdf.pages.forEach((page, index) => expect(page).toContain(`Page ${index + 1} of ${total}`));
  });
});

describe("renderEvidencePdf: characters the standard fonts cannot print", () => {
  it("prints Latin-1 names such as Peña as they are, with no note", async () => {
    const { pdf } = await render(syntheticCategoricalEligibleInput());
    expect(pdf.text).toContain("Sofía Peña");
    expect(pdf.text).toContain("María Peña");
    expect(pdf.text).not.toContain("could not be printed");
  });

  it("transliterates or replaces everything else, never throws, and says that it did", async () => {
    const names: Array<[first: string, last: string, printed: string]> = [
      ["Nguyễn", "Thị Hương", "Nguyen Thi Huong"],
      ["Łukasz", "Żółć", "Lukasz Zólc"],
      ["Đặng", "Văn Đức", "Dang Van Duc"],
      ["Zoë", "Brontë-O’Neill", "Zoë Brontë-O’Neill"],
      ["王", "小明", "? ??"],
      ["Мария", "Иванова", "????? ???????"],
      ["أحمد", "علي", "???? ???"],
      ["Aiyana 🙂", "Two-Rivers", "Aiyana ? Two-Rivers"],
    ];
    for (const [first, last, printed] of names) {
      const input = altered(syntheticCategoricalEligibleInput(), (copy) => {
        copy.household.members[0].firstName = first;
        copy.household.members[0].lastName = last;
        copy.consent.grantedBy = `${first} ${last}`;
      });
      const { signed, pdf } = await render(input);
      // The signed record keeps the name exactly; only the PDF's rendering of it changes.
      expect(signed.record.household.students[0].name).toBe(`${first} ${last}`);
      expect(pdf.pages[0], `${first} ${last}`).toContain(`Student ${printed}`);
      expect(pdf.text).toContain(`by ${printed}`);
      const changed = printed !== `${first} ${last}`;
      expect(pdf.text.includes("could not be printed with its standard fonts"), `${first} ${last}`).toBe(changed);
      if (changed) expect(pdf.pages[pdf.pages.length - 1]).toMatch(/\d+ characters? in this PDF could not be printed with its standard fonts and (was|were) transliterated or shown as "\?"\. The signed JSON record holds the original text\./);
    }
  });

  it("counts each substituted character once", async () => {
    const input = altered(syntheticCategoricalEligibleInput(), (copy) => {
      copy.household.members[3].relationship = "Sister ≤ 小";
    });
    const { pdf } = await render(input);
    expect(pdf.text).toContain("Sister <= ?");
    expect(pdf.text).toContain(PDF_COPY.transliteration(2));
  });

  it("handles unprintable characters in every free-text position, including the page header", async () => {
    const odd = "Ωmega → 测试 ✓";
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.sgo.name = `Synthetic ${odd} Fund`;
      copy.externalRef = odd;
      copy.decision.reasons[0].message = odd;
      (copy.decision.decidedBy as { notes: string; reviewerName: string }).notes = odd;
      (copy.decision.decidedBy as { notes: string; reviewerName: string }).reviewerName = odd;
      copy.geography.countyName = `Starr ${odd}`;
      copy.threshold.formula = odd;
      copy.threshold.label.explanation = `This limit is provisional. ${odd}`;
      copy.income!.items[0].description = odd;
      copy.documents[0].filename = `${odd}.pdf`;
      copy.documents[0].extractedFields[1] = { key: "employer_name", label: odd, value: odd };
      copy.rails[0].provider = odd;
      copy.consent.scope = { [odd]: [odd, { [odd]: odd }] };
      copy.reviewTrail[1].notes = odd;
      copy.timeline[0].event = odd;
      copy.versions.engine = odd;
    });
    const { pdf } = await render(input, { verifyUrl: "https://passport.example.org/.well-known/jwks.json", brand: { name: `Passport ${odd}` } });
    expect(pdf.text).toContain("?mega -> ?? ?");
    expect(pdf.pages[2]).toContain("Passport ?mega -> ?? ? | Income verification evidence pack");
    expect(pdf.info.Author).toBe(`Passport ${odd}`);
  });
});

describe("renderEvidencePdf: reproducible and well described", () => {
  it("gives identical bytes for identical input", async () => {
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput()]) {
      const signed = signEvidenceRecord(buildEvidenceRecord(input), key);
      const first = await renderEvidencePdf(signed, OPTIONS);
      await new Promise((resolve) => setTimeout(resolve, 1100)); // a new wall-clock second must not change anything
      const second = await renderEvidencePdf(structuredClone(signed), { ...OPTIONS, brand: { ...OPTIONS.brand } });
      expect(sha256Hex(second)).toBe(sha256Hex(first));
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    }
  });

  it("changes when the record, the key set URL or the brand changes", async () => {
    const signed = signEvidenceRecord(buildEvidenceRecord(syntheticCategoricalEligibleInput()), key);
    const base = sha256Hex(await renderEvidencePdf(signed, OPTIONS));
    const later = signEvidenceRecord(buildEvidenceRecord(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.generatedAt = "2027-01-12T16:20:36.000Z"))), key);
    expect(sha256Hex(await renderEvidencePdf(later, OPTIONS))).not.toBe(base);
    expect(sha256Hex(await renderEvidencePdf(signed, { ...OPTIONS, verifyUrl: "https://other.example.org/.well-known/jwks.json" }))).not.toBe(base);
    expect(sha256Hex(await renderEvidencePdf(signed, { ...OPTIONS, brand: { name: "Other" } }))).not.toBe(base);
  });

  it("sets title, subject, language, producer and dates from the record, not from the clock", async () => {
    const { signed, bytes, pdf } = await render(syntheticDirectReviewedInput());
    expect(pdf.info.Title).toBe("Income verification evidence pack ver_SYNTHETICdirect0000001");
    expect(pdf.info.Subject).toBe("Household income verification for Synthetic Sample Scholarship Fund (not a real organization): eligible, direct method");
    expect(pdf.info.Author).toBe("Passport");
    expect(pdf.info.Creator).toBe("Passport evidence engine synthetic-decision-engine-1.0.0");
    expect(pdf.info.Producer).toBe(`${EVIDENCE_PDF_RENDERER} (pdf-lib)`);
    expect(pdf.info.Language).toBe("en-US");
    expect(pdf.info.Keywords).toContain(`record-sha256:${signed.signature.record_sha256}`);
    expect(pdf.info.CreationDate).toBe("D:20270305090004Z");
    expect(pdf.info.ModDate).toBe("D:20270305090004Z");
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(document.getCreationDate()?.toISOString()).toBe(signed.record.generated_at);
    expect(document.getModificationDate()?.toISOString()).toBe(signed.record.generated_at);
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("refuses to render an envelope whose hash does not match its record", async () => {
    const signed = signEvidenceRecord(buildEvidenceRecord(syntheticCategoricalEligibleInput()), key);
    const tampered = structuredClone(signed);
    tampered.record.decision.status = "ineligible";
    await expect(renderEvidencePdf(tampered, OPTIONS)).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("record_sha256 does not match") });
    await expect(renderEvidencePdf({ ...signed, record: { ...signed.record, schema_version: "2" as "1" } }, OPTIONS)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses a key set URL that is not an absolute http(s) URL, and an empty brand", async () => {
    const signed = signEvidenceRecord(buildEvidenceRecord(syntheticCategoricalEligibleInput()), key);
    for (const verifyUrl of ["", "/.well-known/jwks.json", "javascript:alert(1)", "file:///etc/passwd", "not a url"]) {
      await expect(renderEvidencePdf(signed, { ...OPTIONS, verifyUrl }), verifyUrl).rejects.toMatchObject({ code: "validation_failed" });
    }
    await expect(renderEvidencePdf(signed, { ...OPTIONS, brand: { name: "  " } })).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("renderEvidencePdf: nothing sensitive reaches the page", () => {
  it("has no Social Security number pattern and no date of birth in the record or in the PDF text", async () => {
    const dob = "2015-03-02";
    const hostile = altered(syntheticDirectReviewedInput(), (copy) => {
      Object.assign(copy.household.members[0], { dob, dateOfBirth: dob });
      (copy.decision.decidedBy as { notes: string }).notes = "Stub shows SSN 123-45-6789 and 987654321; ignored.";
      copy.documents[0].filename = "w2 123-45-6789.pdf";
      copy.documents[0].extractedFields.push({ key: "employee_ssn", label: "Employee SSN", value: "123-45-6789" }, { key: "dob", label: "Date of birth", value: dob }, { key: "employee_name", label: "Employee", value: "A.G. 123 45 6789" });
      copy.reviewTrail[1].notes = "SSN 123456789 seen on the stub";
      copy.timeline[0].detail = `born ${dob}`.replace(dob, "123.45.6789");
    });
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput(), hostile]) {
      const { signed, pdf } = await render(input);
      const json = JSON.stringify(signed);
      for (const text of [json, pdf.text]) {
        expect(text).not.toMatch(SSN_DASHED);
        expect(text).not.toMatch(NINE_DIGITS);
        expect(text).not.toContain(dob);
        expect(text).not.toMatch(/date of birth\s*[:=]/i);
        expect(text).not.toMatch(/\bdob\b/i);
      }
      expect(pdf.text).not.toContain("6789");
      expect(pdf.text).toContain(PDF_COPY.minimization);
    }
    const { signed, pdf } = await render(hostile);
    expect(signed.record.data_minimization).toMatchObject({ ssn_patterns_removed: 6, extracted_fields_removed: 2 });
    expect(pdf.text).toContain("6 number-shaped tokens resembling a Social Security number and 2 extracted fields naming a birth date or an identity or account number were removed.");
  });

  it("prints initials, not names, for household members who are not students", async () => {
    const { pdf } = await render(syntheticCategoricalEligibleInput());
    expect(pdf.text).not.toContain("José");
    expect(pdf.text).not.toContain("Lucía");
    expect(pdf.text).toContain("hm_SYNTHETICmember000003 Adult J.P. Father");
    expect(pdf.text).toContain("hm_SYNTHETICmember000004 Child L.P. Sister");
  });
});
