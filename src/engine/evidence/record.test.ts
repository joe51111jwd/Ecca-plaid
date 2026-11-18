import { createHmac, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, publicJwk, sha256Hex } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { EVIDENCE_COPY_VERSION } from "./copy";
import { EMPTY_SHA256, EVIDENCE_POLICY } from "./policy";
import { buildEvidenceRecord, canonicalRecordBytes, signEvidenceRecord, verifySignedEvidence, type EvidenceInputErrorDetails, type EvidenceIssue } from "./record";
import {
  syntheticCategoricalEligibleInput,
  syntheticDirectReviewedInput,
  syntheticDocuments,
  syntheticHarrisThreshold,
  syntheticIrsPublishedThreshold,
  syntheticSha256,
  syntheticStarrThreshold,
} from "./synthetic-fixtures";
import { generateTestSigningKey, jwksOf } from "./test-support";
import type { EvidenceInput, EvidenceRecord, SignedEvidence } from "./types";

/* ------------------------------------------------------------------------------------------ helpers */

type Mutable = Record<string, unknown>;

/** A typed part of the input, loosened so a test can delete or mistype its fields. */
function loose(value: object): Mutable {
  return value as unknown as Mutable;
}

/** Applies `change` to a deep copy of a synthetic input. The copy is loosely typed so tests can break it. */
function altered(base: EvidenceInput, change: (input: Mutable & EvidenceInput) => void): EvidenceInput {
  const copy = structuredClone(base) as Mutable & EvidenceInput;
  change(copy);
  return copy;
}

function issuesOf(input: unknown): EvidenceIssue[] {
  try {
    buildEvidenceRecord(input as EvidenceInput);
  } catch (error) {
    if (!isAppError(error)) throw error;
    expect(error.code).toBe("validation_failed");
    const details = error.details as EvidenceInputErrorDetails;
    expect(details.reason).toBe("evidence_input_invalid");
    expect(details.issues.length).toBeGreaterThan(0);
    for (const issue of details.issues) expect(details.fields[issue.path]).toBeTypeOf("string");
    return details.issues;
  }
  throw new Error("expected buildEvidenceRecord to refuse this input");
}

function expectIssue(input: unknown, path: string, code: EvidenceIssue["code"], message?: RegExp): void {
  const issues = issuesOf(input);
  const match = issues.find((issue) => issue.path === path && issue.code === code && (message === undefined || message.test(issue.message)));
  expect(match, `expected ${code} at ${path}; got ${JSON.stringify(issues)}`).toBeDefined();
}

/** Every leaf of a JSON value with the path that leads to it. */
function leaves(value: unknown, path: Array<string | number> = []): Array<{ path: Array<string | number>; value: unknown }> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, [...path, index]));
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, entry]) => leaves(entry, [...path, key]));
  return [{ path, value }];
}

function containers(value: unknown, path: Array<string | number> = []): Array<{ path: Array<string | number>; value: unknown }> {
  if (Array.isArray(value)) return [{ path, value }, ...value.flatMap((entry, index) => containers(entry, [...path, index]))];
  if (value !== null && typeof value === "object") return [{ path, value }, ...Object.entries(value).flatMap(([key, entry]) => containers(entry, [...path, key]))];
  return [];
}

function at(root: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string | number, unknown>)[key], root);
}

function setAt(root: unknown, path: Array<string | number>, value: unknown): void {
  const parent = at(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]] = value;
}

function mutated(value: unknown): unknown {
  if (typeof value === "string") return `${value}x`;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  return "null was here";
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

const key = generateTestSigningKey("test-key-1");
const jwks = jwksOf(key);

function signedSample(input: EvidenceInput = syntheticDirectReviewedInput()): SignedEvidence {
  return signEvidenceRecord(buildEvidenceRecord(input), key);
}

const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/;
const NINE_DIGITS = /\b\d{9}\b/;

/* --------------------------------------------------------------------------------------- the record */

describe("buildEvidenceRecord: the two synthetic samples", () => {
  it("builds the categorical sample with every element an auditor needs", () => {
    const record = buildEvidenceRecord(syntheticCategoricalEligibleInput());
    expect(record.schema_version).toBe("1");
    expect(record.record_type).toBe("income_verification_evidence");
    expect(record.copy_version).toBe(EVIDENCE_COPY_VERSION);
    expect(record.mode).toBe("test");
    expect(record.decision).toMatchObject({
      status: "eligible",
      method: "categorical",
      method_label: "Categorical eligibility verification method",
      method_basis: "categorical_documentation",
      application_date: "2027-01-11",
      income_year: 2026,
      decided_at: "2027-01-12T16:20:31.000Z",
      decided_by: { type: "engine", reviewer_id: null, reviewer_name: null, reviewer_notes: null },
    });
    expect(record.decision.method_citation).toContain("1.25F-3(c)(6)(iii)(B)");
    expect(record.decision.method_citation).toContain("not final");
    expect(record.decision.summary).toBe(
      "Eligible: the household income requirement is met under the categorical eligibility verification method of the proposed regulations (REG-117199-25), which are not final. " +
        "Written documentation dated August 14, 2026 shows that an individual in the student's household currently is approved for Supplemental Nutrition Assistance Program (SNAP).",
    );
    expect(record.household.size).toBe(4);
    expect(record.geography).toEqual({
      state: "TX",
      county_fips: "48201",
      county_name: "Harris County",
      area_code: "METRO26420M26420",
      area_name: "Houston-The Woodlands-Sugar Land, TX HUD Metro FMR Area",
      zip: "77002",
      county_resolution: "geocoder",
    });
    expect(record.threshold).toMatchObject({
      limit_cents: 31_200_000,
      source: "hud_provisional",
      table_version: "hud-fy2026-tx",
      effective_date: "2026-05-01",
      provisional: true,
      readings_agree: true,
      relied_on: "none",
      relied_on_limit_cents: null,
    });
    expect(record.threshold.relied_on_statement).toMatch(/^Household income was not compared with the income limit/);
    expect(record.income).toBeNull();
    expect(record.categorical).toMatchObject({ program: "SNAP", letter_date: "2026-08-14", approval_status: "current", document_id: "doc_SYNTHETICawardletter01" });
    expect(record.documents).toHaveLength(1);
    expect(record.documents[0]).toMatchObject({ id: "doc_SYNTHETICawardletter01", sha256: syntheticSha256("SNAP award letter"), raw_file_status: "retained", purged_at: null, extracted_by: "parser" });
    expect(record.consent).toMatchObject({ copy_version: "synthetic-consent-copy.v1", granted_at: "2027-01-11T17:55:42.000Z", granted_by: "María Peña", locale: "es" });
    expect(record.data_minimization).toEqual({ rule_version: EVIDENCE_POLICY.dataMinimizationRuleVersion, ssn_patterns_removed: 0, extracted_fields_removed: 0, income_detail_omitted: false });
    expect(record.versions).toEqual({ engine: "synthetic-decision-engine-1.0.0", taxonomy: "synthetic-income-taxonomy-1", rule_set: "25F_STATUTE + REG-117199-25_PROPOSED_2026-10-02" });
  });

  it("builds the reviewed direct sample and says who decided and which bound was relied on", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    expect(record.mode).toBe("live");
    expect(record.decision.decided_by).toEqual({
      type: "reviewer",
      reviewer_id: "usr_SYNTHETICreviewer00001",
      reviewer_name: "Riley Example (synthetic reviewer)",
      reviewer_notes: expect.stringContaining("Pay stub photo is legible"),
    });
    expect(record.decision.method_basis).toBe("written_documentation_and_other_relevant_data_sources");
    expect(record.decision.method_citation).toContain("1.25F-3(c)(6)(iii)(A)");
    expect(record.income).toMatchObject({ year: 2026, total_counted_cents: 8_425_037 });
    expect(record.threshold.readings.map((reading) => [reading.id, reading.limit_cents])).toEqual([
      ["median_product", 12_538_800],
      ["section8_vli", 27_120_000],
    ]);
    expect(record.threshold).toMatchObject({ lower_bound_cents: 12_538_800, upper_bound_cents: 27_120_000, readings_agree: false, relied_on: "lower_bound", relied_on_limit_cents: 12_538_800 });
    expect(record.threshold.relied_on_statement).toBe(
      "The readings give different limits. The decision relied on the lower bound, $125,388.00 (Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis)). " +
        "Household income of $84,250.37 is not greater than the lower bound, so it is not greater than the limit under any reading shown.",
    );
    expect(record.decision.summary).toBe(
      "Eligible: the household income requirement is met. Household cash income counted for calendar year 2026 is $84,250.37, which is not greater than the provisional income limit of $125,388.00 " +
        "(the lower bound of the readings shown in the limit calculation) for a household of 5 in Starr County, TX. A reviewer made the decision; see the review trail.",
    );
    expect(record.documents.find((document) => document.id === "doc_SYNTHETICpaystub000001")).toMatchObject({ raw_file_status: "purged", purged_at: "2027-03-05T09:00:00.000Z" });
    expect(record.rails).toEqual([
      {
        id: "rail_SYNTHETICpayroll000001",
        provider: "simulated",
        kind: "payroll",
        report_sha256: syntheticSha256("payroll report"),
        connected_at: "2027-01-29T20:21:09.000Z",
        retrieved_at: "2027-01-29T20:21:40.000Z",
        member_id: "hm_SYNTHETICmember000014",
        consent_id: "con_SYNTHETICconsent000003",
      },
    ]);
    expect(record.additional_consents.map((consent) => consent.kind)).toEqual(["rail_connect"]);
    expect(record.review_trail.map((entry) => [entry.actor.type, entry.action])).toEqual([
      ["engine", "Sent to review"],
      ["reviewer", "Keyed fields from the pay stub"],
      ["reviewer", "Resolved: eligible"],
    ]);
  });

  it("holds only strings, safe integers, booleans and null, under snake_case keys", () => {
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput()]) {
      const record = buildEvidenceRecord(input);
      for (const leaf of leaves(record)) {
        const ok = leaf.value === null || typeof leaf.value === "string" || typeof leaf.value === "boolean" || (typeof leaf.value === "number" && Number.isSafeInteger(leaf.value));
        expect(ok, `${leaf.path.join(".")} = ${String(leaf.value)}`).toBe(true);
        // Keys inside a consent scope are the caller's; everything else is the schema's.
        const schemaKeys = leaf.path.filter((part, index) => typeof part === "string" && !leaf.path.slice(0, index).includes("scope"));
        for (const part of schemaKeys) expect(part, leaf.path.join(".")).toMatch(/^[a-z][a-z0-9_]*$/);
      }
      expect(() => canonicalJson(record)).not.toThrow();
    }
  });

  it("is a pure function of its input: same input, same record, whatever order the lists arrive in", () => {
    const input = syntheticDirectReviewedInput();
    const first = buildEvidenceRecord(input);
    expect(buildEvidenceRecord(structuredClone(input))).toEqual(first);
    const shuffled = altered(input, (copy) => {
      copy.documents.reverse();
      copy.income!.items.reverse();
      copy.household.members.reverse();
      copy.timeline.reverse();
      copy.reviewTrail.reverse();
    });
    const second = buildEvidenceRecord(shuffled);
    expect(second.documents).toEqual(first.documents);
    expect(second.income).toEqual(first.income);
    expect(second.timeline.map((entry) => entry.at)).toEqual(first.timeline.map((entry) => entry.at));
    expect(second.review_trail.map((entry) => entry.at)).toEqual(first.review_trail.map((entry) => entry.at));
    expect(second.household.members.map((member) => member.role)).toEqual(["student", "student", "adult", "adult", "other"]);
    expect(input).toEqual(syntheticDirectReviewedInput()); // the input object is not modified
  });

  it("accepts Date objects and offsets for instants and stores UTC", () => {
    const record = buildEvidenceRecord(
      altered(syntheticCategoricalEligibleInput(), (copy) => {
        copy.generatedAt = new Date("2027-01-12T16:20:35.000Z");
        copy.decision.decidedAt = "2027-01-12T10:20:31-06:00";
        copy.consent.grantedAt = "2027-01-11T17:55Z";
      }),
    );
    expect(record.generated_at).toBe("2027-01-12T16:20:35.000Z");
    expect(record.decision.decided_at).toBe("2027-01-12T16:20:31.000Z");
    expect(record.consent.granted_at).toBe("2027-01-11T17:55:00.000Z");
  });

  it("ignores fields it does not declare, so a threshold result or a database row can be passed as is", () => {
    const base = syntheticCategoricalEligibleInput();
    const withExtras = altered(base, (copy) => {
      Object.assign(copy.threshold, { multiplierBps: 10000, householdSize: 4, exact: true, area: { code: "x" }, county: { fips: "48201" } });
      Object.assign(copy.threshold.label, { familyNote: "ignored", locale: "en", readingIds: ["median_product"] });
      Object.assign(copy.household.members[0], { dobEnc: "v1.aaa.bbb.ccc", userId: "usr_1", createdAt: "2027-01-01T00:00:00Z" });
      Object.assign(copy, { unknownTopLevel: { anything: 1.5 } });
    });
    expect(buildEvidenceRecord(withExtras)).toEqual(buildEvidenceRecord(base));
  });
});

/* ------------------------------------------------------------------------------- data minimization */

describe("buildEvidenceRecord: data minimization", () => {
  it("names students, reduces everyone else to initials, and carries no date of birth", () => {
    const record = buildEvidenceRecord(syntheticCategoricalEligibleInput());
    expect(record.household.students).toEqual([{ member_id: "hm_SYNTHETICmember000001", name: "Sofía Peña" }]);
    expect(record.household.members).toEqual([
      { member_id: "hm_SYNTHETICmember000001", role: "student", initials: "S.P.", relationship: "Self" },
      { member_id: "hm_SYNTHETICmember000002", role: "adult", initials: "M.P.", relationship: "Mother" },
      { member_id: "hm_SYNTHETICmember000003", role: "adult", initials: "J.P.", relationship: "Father" },
      { member_id: "hm_SYNTHETICmember000004", role: "child", initials: "L.P.", relationship: "Sister" },
    ]);
    const json = JSON.stringify(record);
    // The consenting adult is named in the consent record; the other adult and the sibling are named nowhere.
    expect(json).not.toContain("José");
    expect(json).not.toContain("Lucía");
    expect(json.match(/María Peña/g)).toHaveLength(1);
  });

  it("drops a date of birth or identity number however the caller tries to pass it", () => {
    const dob = "2015-03-02";
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      Object.assign(copy.household.members[0], { dob, dateOfBirth: dob, dobEnc: dob, ssn: "123-45-6789" });
      Object.assign(copy.household, { dob });
      Object.assign(copy.decision, { studentDob: dob });
      copy.documents[0].extractedFields.push(
        { key: "date_of_birth", label: "Date of birth", value: dob },
        { key: "employee_dob", label: "DOB", value: dob },
        { key: "dateOfBirth", label: "Born", value: dob },
        { key: "birthdate", label: "Birth date", value: dob },
        { key: "ssn", label: "SSN", value: "XXX-XX-6789" },
        { key: "employee_social", label: "Social Security number", value: "last four 6789" },
        { key: "recipient_tin", label: "Recipient TIN", value: "ends 6789" },
        { key: "bank_account_number", label: "Account number", value: "ending 4321" },
        { key: "routing", label: "Routing number", value: "000000000" },
        { key: "field_17", label: "Driver's license", value: "TX 0000" },
      );
    });
    const record = buildEvidenceRecord(input);
    const json = JSON.stringify(record);
    expect(json).not.toContain(dob);
    expect(json).not.toContain("6789");
    expect(json).not.toContain("4321");
    expect(record.data_minimization.extracted_fields_removed).toBe(10);
    // Income lines that merely mention Social Security are not identity fields and stay.
    const kept = buildEvidenceRecord(
      altered(syntheticDirectReviewedInput(), (copy) => {
        copy.documents[0].extractedFields.push({ key: "social_security_benefits_box_5", label: "Social Security benefits (box 5)", amountCents: 1_200_000 });
      }),
    );
    expect(kept.documents.flatMap((document) => document.extracted_fields).map((field) => field.key)).toContain("social_security_benefits_box_5");
    expect(kept.data_minimization.extracted_fields_removed).toBe(0);
  });

  it("removes anything shaped like a Social Security number from every free-text field", () => {
    const ssnForms = ["123-45-6789", "123 45 6789", "123.45.6789", "123456789", `123${String.fromCharCode(0x2013)}45${String.fromCharCode(0x2013)}6789`, `123${String.fromCharCode(0x200b)}-45-6789`];
    for (const ssn of ssnForms) {
      const input = altered(syntheticDirectReviewedInput(), (copy) => {
        copy.externalRef = `applicant ${ssn}`;
        copy.sgo.name = `Synthetic SGO ${ssn}`;
        copy.decision.reasons[0].message = `see ${ssn}.`;
        (copy.decision.decidedBy as { notes: string }).notes = `SSN on stub: ${ssn}`;
        (copy.decision.decidedBy as { reviewerName: string }).reviewerName = `Riley ${ssn}`;
        copy.household.members[0].firstName = `Mateo ${ssn}`;
        copy.household.members[2].relationship = `Mother (${ssn})`;
        copy.household.custody = { livesInMultipleHouseholds: true, notes: `other parent SSN ${ssn}` };
        copy.geography.countyName = `Starr County ${ssn}`;
        copy.threshold.formula = `formula ${ssn}`;
        copy.income!.items[0].description = `W-2 for ${ssn}`;
        copy.income!.items[0].basis = `basis ${ssn}`;
        copy.income!.items[0].categoryLabel = `Wages ${ssn}`;
        copy.documents[0].filename = `${ssn} w2.pdf`;
        copy.documents[0].extractedFields[1] = { key: "employer_name", label: `Employer ${ssn}`, value: `Employee ${ssn}` };
        copy.documents[0].contentType = `application/pdf; name=${ssn}`;
        copy.rails[0].provider = `provider ${ssn}`;
        copy.consent.grantedBy = `Ana Garza ${ssn}`;
        copy.consent.scope = { note: `ssn ${ssn}`, account_id: ssn, nested: { list: [`x ${ssn}`] } };
        copy.reviewTrail[1].notes = `keyed; SSN ${ssn}`;
        copy.reviewTrail[1].action = `Keyed ${ssn}`;
        copy.reviewTrail[1].actor.name = `Riley ${ssn}`;
        copy.timeline[0].event = `Created for ${ssn}`;
        copy.timeline[0].detail = `detail ${ssn}`;
        copy.versions.engine = `engine ${ssn}`;
      });
      const record = buildEvidenceRecord(input);
      for (const leaf of leaves(record)) {
        if (typeof leaf.value !== "string") continue;
        expect(leaf.value, leaf.path.join(".")).not.toMatch(SSN_DASHED);
        expect(leaf.value, leaf.path.join(".")).not.toMatch(NINE_DIGITS);
        expect(leaf.value, leaf.path.join(".")).not.toContain("6789");
      }
      expect(record.data_minimization.ssn_patterns_removed).toBeGreaterThanOrEqual(24);
      expect(record.documents[0].filename).toBe(`${EVIDENCE_POLICY.ssnReplacement} w2.pdf`);
    }
  });

  it("leaves longer numbers, money and hashes alone", () => {
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.decision.reasons[0].message = "Called 512-555-0100 about receipt 1234567890 and case 12345678; total $1,234,567.89.";
    });
    const record = buildEvidenceRecord(input);
    expect(record.decision.reasons[0].message).toBe("Called 512-555-0100 about receipt 1234567890 and case 12345678; total $1,234,567.89.");
    expect(record.data_minimization.ssn_patterns_removed).toBe(0);
    expect(record.documents.map((document) => document.sha256)).toEqual(syntheticDirectReviewedInput().documents.map((document) => document.sha256));
  });

  it("refuses an identifier that is itself shaped like a Social Security number", () => {
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.household.members[4].id = "123-45-6789")), "household.members[4].id", "invalid", /Social Security/);
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.verificationId = "123456789")), "verificationId", "invalid", /Social Security/);
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.consent.scope = { "123-45-6789": "x" })), "consent.scope", "invalid", /Social Security/);
  });

  it("names staff who review and nobody else in the trail and the timeline", () => {
    const record = buildEvidenceRecord(
      altered(syntheticDirectReviewedInput(), (copy) => {
        copy.timeline[1].actor = { type: "family", id: "usr_SYNTHETICparent0000001", name: "Ana Garza" };
        copy.timeline[5].actor = { type: "system", name: "Worker 7" };
      }),
    );
    expect(record.timeline[1].actor).toEqual({ type: "family", id: "usr_SYNTHETICparent0000001", name: null });
    expect(record.timeline[5].actor).toEqual({ type: "system", id: null, name: null });
    expect(record.timeline[0].actor).toEqual({ type: "user", id: "usr_SYNTHETICstaff00000001", name: "Jordan Example (synthetic staff)" });
    expect(record.review_trail[2].actor.name).toBe("Riley Example (synthetic reviewer)");
  });

  it("normalizes text: NFC, no invisible or bidirectional controls, single spaces", () => {
    const rightToLeftOverride = String.fromCharCode(0x202e);
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const decomposedEnye = `n${String.fromCharCode(0x0303)}`;
    const record = buildEvidenceRecord(
      altered(syntheticCategoricalEligibleInput(), (copy) => {
        copy.household.members[0].lastName = `Pe${decomposedEnye}a`;
        copy.household.members[0].firstName = "  Sof\u00eda \n";
        copy.sgo.name = `Synthetic${zeroWidthSpace} Sample ${rightToLeftOverride}Fund\t(test)\u0000`;
        copy.documents[0].filename = "C:\\Users\\parent\\Desktop\\..\\award: letter?.pdf";
      }),
    );
    expect(record.household.students[0].name).toBe("Sofía Peña");
    expect(record.household.students[0].name).toHaveLength(10);
    expect(record.sgo.name).toBe("Synthetic Sample Fund (test)");
    expect(record.documents[0].filename).toBe("award_ letter_.pdf");
  });

  it("keeps a file name printable and bounded without losing its extension", () => {
    const longName = `${"a".repeat(300)}.pdf`;
    const record = buildEvidenceRecord(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.documents[0].filename = longName)));
    expect(record.documents[0].filename).toHaveLength(EVIDENCE_POLICY.limits.filename);
    expect(record.documents[0].filename.endsWith("~.pdf")).toBe(true);
    const hidden = buildEvidenceRecord(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.documents[0].filename = "../../.env")));
    expect(hidden.documents[0].filename).toBe("env");
  });

  it("leaves income detail out of a decided categorical record, and says that it did", () => {
    const income = { year: 2026, totalCountedCents: 4_200_000, items: [{ id: "inc_SYNTHETICextra00000001", category: "wages", categoryLabel: "Wages and salaries", annualAmountCents: 4_200_000, treatment: "counted" as const, source: "self_reported" as const }] };
    const record = buildEvidenceRecord(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.income = income)));
    expect(record.income).toBeNull();
    expect(record.data_minimization.income_detail_omitted).toBe(true);
    expect(JSON.stringify(record)).not.toContain("inc_SYNTHETICextra00000001");
    // Everything else is the record the same input gives without the income detail.
    const plain = buildEvidenceRecord(syntheticCategoricalEligibleInput());
    expect({ ...record, data_minimization: plain.data_minimization }).toEqual(plain);
  });

  it("leaves categorical detail out of a decided direct record", () => {
    const record = buildEvidenceRecord(altered(syntheticDirectReviewedInput(), (copy) => void (copy.categorical = { program: "SNAP", letterDate: "2026-08-14", approvalStatus: "unclear" })));
    expect(record.categorical).toBeNull();
    expect(record).toEqual(buildEvidenceRecord(syntheticDirectReviewedInput()));
  });

  it("carries whatever detail exists while a verification is still in review", () => {
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.decision.status = "needs_review";
      copy.decision.decidedBy = { type: "engine" };
      copy.decision.reasons = [{ code: "categorical_direct_conflict", message: "The letter and the income documents point different ways.", memberIds: ["hm_SYNTHETICmember000013"], sourceIds: ["doc_SYNTHETICw200000000001"] }];
      copy.categorical = { program: "SNAP", letterDate: "2026-08-14", approvalStatus: "unclear", namedMemberId: "hm_SYNTHETICmember000013" };
    });
    const record = buildEvidenceRecord(input);
    expect(record.income).not.toBeNull();
    expect(record.categorical).toMatchObject({ program: "SNAP", approval_status: "unclear" });
    expect(record.data_minimization.income_detail_omitted).toBe(false);
    expect(record.decision.reasons).toEqual([{ code: "categorical_direct_conflict", message: "The letter and the income documents point different ways.", member_ids: ["hm_SYNTHETICmember000013"], source_ids: ["doc_SYNTHETICw200000000001"] }]);
    // In review with nothing at all is also a state a pack can describe.
    const empty = buildEvidenceRecord(altered(input, (copy) => void ((copy.income = null), (copy.categorical = null))));
    expect(empty.income).toBeNull();
    expect(empty.categorical).toBeNull();
    expect(empty.decision.summary).toBe("Needs review: no eligibility decision has been made. No household income has been recorded yet for calendar year 2026. The reasons are listed in this record.");
    expect(empty.threshold.relied_on_statement).toBe("No eligibility decision has been made, so no limit has been relied on. No household income has been recorded yet.");
  });
});

/* ----------------------------------------------------------------------------- refusing to build */

describe("buildEvidenceRecord: refuses when an audit field is missing", () => {
  const base = syntheticDirectReviewedInput;

  it.each([
    ["threshold.source", (copy: Mutable & EvidenceInput) => delete loose(copy.threshold).source],
    ["threshold.tableVersion", (copy: Mutable & EvidenceInput) => delete loose(copy.threshold).tableVersion],
    ["threshold.tableVersion", (copy: Mutable & EvidenceInput) => void (copy.threshold.tableVersion = "   ")],
    ["threshold.effectiveDate", (copy: Mutable & EvidenceInput) => delete loose(copy.threshold).effectiveDate],
    ["threshold.effectiveDate", (copy: Mutable & EvidenceInput) => void (copy.threshold.effectiveDate = "2026-02-30")],
    ["threshold.effectiveDate", (copy: Mutable & EvidenceInput) => void (copy.threshold.effectiveDate = "May 1, 2026")],
    ["threshold", (copy: Mutable & EvidenceInput) => delete (copy as Mutable).threshold],
    ["consent.copyVersion", (copy: Mutable & EvidenceInput) => delete loose(copy.consent).copyVersion],
    ["consent.copyVersion", (copy: Mutable & EvidenceInput) => void (copy.consent.copyVersion = "")],
    ["consent.grantedAt", (copy: Mutable & EvidenceInput) => delete loose(copy.consent).grantedAt],
    ["consent.grantedAt", (copy: Mutable & EvidenceInput) => void (copy.consent.grantedAt = "yesterday")],
    ["consent.grantedAt", (copy: Mutable & EvidenceInput) => void (copy.consent.grantedAt = new Date(Number.NaN))],
    ["consent.copySha256", (copy: Mutable & EvidenceInput) => delete loose(copy.consent).copySha256],
    ["consent", (copy: Mutable & EvidenceInput) => delete (copy as Mutable).consent],
    ["decision.decidedBy.reviewerId", (copy: Mutable & EvidenceInput) => delete loose(copy.decision.decidedBy).reviewerId],
    ["decision.decidedBy.reviewerName", (copy: Mutable & EvidenceInput) => void (loose(copy.decision.decidedBy).reviewerName = " ")],
    ["decision.decidedBy.notes", (copy: Mutable & EvidenceInput) => delete loose(copy.decision.decidedBy).notes],
    ["decision.decidedBy.notes", (copy: Mutable & EvidenceInput) => void (loose(copy.decision.decidedBy).notes = "\n\t ")],
    ["decision.decidedBy", (copy: Mutable & EvidenceInput) => delete loose(copy.decision).decidedBy],
    ["decision.decidedBy.type", (copy: Mutable & EvidenceInput) => void (loose(copy.decision).decidedBy = { type: "somebody" })],
    ["documents[1].sha256", (copy: Mutable & EvidenceInput) => delete loose(copy.documents[1]).sha256],
    ["documents[1].sha256", (copy: Mutable & EvidenceInput) => void (copy.documents[1].sha256 = "abc123")],
    ["documents[1].sha256", (copy: Mutable & EvidenceInput) => void (copy.documents[1].sha256 = EMPTY_SHA256)],
    ["rails[0].reportSha256", (copy: Mutable & EvidenceInput) => void (copy.rails[0].reportSha256 = "z".repeat(64))],
  ])("%s", (path, change) => {
    expectIssue(altered(base(), change), path, "missing_audit_field");
  });

  it("a decided verification needs at least one document hash or report hash", () => {
    const noEvidence = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.documents = [];
      copy.rails = [];
      copy.income = { year: 2026, totalCountedCents: 0, items: [] };
    });
    expectIssue(noEvidence, "documents", "missing_audit_field", /at least one document hash or data-connection report hash/);

    // A report hash alone is enough ...
    const railOnly = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.documents = [];
      copy.income = { year: 2026, totalCountedCents: 5_000_000, items: [{ id: "inc_SYNTHETICrail0000001", category: "wages", categoryLabel: "Wages and salaries", annualAmountCents: 5_000_000, counted: true, source: "rail", railId: "rail_SYNTHETICpayroll000001" }] };
    });
    expect(buildEvidenceRecord(railOnly).decision.method_basis).toBe("other_relevant_data_sources");

    // ... and a verification still in review may have nothing yet.
    const inReview = altered(noEvidence, (copy) => {
      copy.decision.status = "needs_review";
      copy.decision.decidedBy = { type: "engine" };
      copy.decision.reasons = [{ code: "no_evidence_yet", message: "Nothing usable has been submitted." }];
    });
    const record = buildEvidenceRecord(inReview);
    expect(record.decision.method_basis).toBe("none_recorded");
    expect(record.threshold.relied_on).toBe("none");
  });

  it("an income figure taken from a document or a connection must point at it", () => {
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.income!.items[0].documentId = null)), "income.items[0].documentId", "missing_audit_field");
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.income!.items[0].documentId = "doc_SYNTHETICmissing000001")), "income.items[0].documentId", "inconsistent");
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void Object.assign(copy.income!.items[3], { source: "rail" })), "income.items[3].railId", "missing_audit_field");
  });

  it("an eligible categorical decision needs the program, the letter date and the document", () => {
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.program = null)), "categorical.program", "missing_audit_field");
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.letterDate = null)), "categorical.letterDate", "missing_audit_field");
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.documentId = null)), "categorical.documentId", "missing_audit_field");
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.documentId = "doc_SYNTHETICother000000001")), "categorical.documentId", "inconsistent");
  });

  it("a review entry by a person must identify the person", () => {
    expectIssue(altered(syntheticDirectReviewedInput(), (copy) => void (copy.reviewTrail[1].actor = { type: "reviewer" })), "reviewTrail[1].actor", "missing_audit_field");
  });

  it("reports every problem at once, with a readable message", () => {
    const input = altered(syntheticDirectReviewedInput(), (copy) => {
      delete loose(copy.threshold).effectiveDate;
      delete loose(copy.consent).copyVersion;
      copy.documents[0].sha256 = "nope";
    });
    const issues = issuesOf(input);
    expect(issues.map((issue) => issue.path).sort()).toEqual(["consent.copyVersion", "documents[0].sha256", "threshold.effectiveDate"]);
    try {
      buildEvidenceRecord(input);
    } catch (error) {
      expect((error as Error).message).toMatch(/^The evidence record cannot be built: /);
      expect((error as Error).message).toContain("threshold.effectiveDate is required: the date the income-limit table took effect");
    }
  });

  it("refuses input that is not an object at all", () => {
    for (const input of [null, undefined, "record", 42, []]) expect(issuesOf(input).length).toBeGreaterThan(0);
  });
});

describe("buildEvidenceRecord: refuses input that contradicts itself", () => {
  it.each([
    ["household.size", (copy: Mutable & EvidenceInput) => void (copy.household.size = 6), /roster lists 5 persons/],
    ["household.members", (copy: Mutable & EvidenceInput) => void copy.household.members.forEach((member) => void (member.role = "adult")), /role student/],
    ["household.members", (copy: Mutable & EvidenceInput) => void (copy.household.members[1].id = copy.household.members[0].id), /more than once/],
    ["decision.incomeYear", (copy: Mutable & EvidenceInput) => void (copy.decision.incomeYear = 2027), /calendar year before the application date \(2026\)/],
    ["income.year", (copy: Mutable & EvidenceInput) => void (copy.income!.year = 2025), /decision\.incomeYear/],
    ["income.totalCountedCents", (copy: Mutable & EvidenceInput) => void (copy.income!.totalCountedCents += 1), /counted lines add up to 8425037 cents/],
    ["income.totalCountedCents", (copy: Mutable & EvidenceInput) => void (copy.income!.items[3].treatment = "counted"), /add up to/],
    ["income.items[0].counted", (copy: Mutable & EvidenceInput) => void (copy.income!.items[0].counted = false), /contradicts treatment "counted"/],
    ["income.items[0].treatment", (copy: Mutable & EvidenceInput) => void delete loose(copy.income!.items[0]).treatment, /counted, excluded or review/],
    ["income.lowerBoundCents", (copy: Mutable & EvidenceInput) => void (copy.income!.lowerBoundCents = 8_425_038), /greater than totalCountedCents/],
    ["income.upperBoundCents", (copy: Mutable & EvidenceInput) => void (copy.income!.upperBoundCents = 8_425_036), /less than totalCountedCents/],
    ["threshold.statutoryUpperBoundCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.statutoryUpperBoundCents = 27_119_999), /lower than the largest reading/],
    ["income.items[0].memberId", (copy: Mutable & EvidenceInput) => void (copy.income!.items[0].memberId = "hm_SYNTHETICstranger00001"), /roster/],
    ["threshold.lowerBoundCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.lowerBoundCents = 1), /smallest reading/],
    ["threshold.upperBoundCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.upperBoundCents = 99_999_999), /largest reading/],
    ["threshold.readingsAgree", (copy: Mutable & EvidenceInput) => void (copy.threshold.readingsAgree = true), /different limits/],
    ["threshold.thresholdCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.thresholdCents = 20_000_000), /one of the readings/],
    ["threshold.provisional", (copy: Mutable & EvidenceInput) => void (copy.threshold.provisional = false), /HUD-derived/],
    ["threshold.statutoryThresholdCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.statutoryThresholdCents = 1_000), /cap can only lower/],
    ["threshold.readings", (copy: Mutable & EvidenceInput) => void (copy.threshold.readings[1].id = "median_product"), /more than once/],
    ["documents", (copy: Mutable & EvidenceInput) => void (copy.documents[1].id = copy.documents[0].id), /more than once/],
    ["documents[0].memberId", (copy: Mutable & EvidenceInput) => void (copy.documents[0].memberId = "hm_SYNTHETICstranger00001"), /roster/],
    ["documents[1].purgedAt", (copy: Mutable & EvidenceInput) => void (copy.documents[1].purgedAt = "2027-01-01T00:00:00Z"), /earlier than uploadedAt/],
    ["documents[1].purgedAt", (copy: Mutable & EvidenceInput) => void (copy.documents[1].purgedAt = "2028-01-01T00:00:00Z"), /later than generatedAt/],
    ["documents[0].uploadedAt", (copy: Mutable & EvidenceInput) => void (copy.documents[0].uploadedAt = "2030-01-01T00:00:00Z"), /later than generatedAt/],
    ["rails[0].consentId", (copy: Mutable & EvidenceInput) => void (copy.rails[0].consentId = "con_SYNTHETICmissing00001"), /consents/],
    ["rails[0].retrievedAt", (copy: Mutable & EvidenceInput) => void (copy.rails[0].retrievedAt = "2027-01-29T20:00:00Z"), /earlier than connectedAt/],
    ["consent.grantedAt", (copy: Mutable & EvidenceInput) => void (copy.consent.grantedAt = "2027-02-04T00:00:00Z"), /consent has to come first/],
    ["decision.decidedAt", (copy: Mutable & EvidenceInput) => void (copy.generatedAt = "2027-02-01T00:00:00Z"), /later than generatedAt/],
    ["decision.expiresAt", (copy: Mutable & EvidenceInput) => void (copy.decision.expiresAt = "2027-02-03T15:12:44Z"), /not later than decidedAt/],
    ["documents[0].extractedFields[0]", (copy: Mutable & EvidenceInput) => void (copy.documents[0].extractedFields[0] = { key: "k", label: "L", value: "v", amountCents: 5 }), /exactly one/],
    ["documents[0].extractedFields[0]", (copy: Mutable & EvidenceInput) => void (copy.documents[0].extractedFields[0] = { key: "k", label: "L" }), /exactly one/],
    ["timeline[0].at", (copy: Mutable & EvidenceInput) => void (copy.timeline[0].at = "2029-01-01T00:00:00Z"), /later than generatedAt/],
  ])("%s", (path, change, message) => {
    const issues = issuesOf(altered(syntheticDirectReviewedInput(), change));
    const match = issues.find((issue) => issue.path === path && message.test(issue.message));
    expect(match, JSON.stringify(issues)).toBeDefined();
    expect(["inconsistent", "invalid"]).toContain(match!.code);
  });

  it("the income total is checked without floating point", () => {
    // Added left to right as doubles these give 9007199254740990; the exact sum is 9007199254740991.
    const amounts = [Number.MAX_SAFE_INTEGER, 1, 1, -2];
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).not.toBe(Number.MAX_SAFE_INTEGER);
    const big = altered(syntheticDirectReviewedInput(), (copy) => {
      copy.decision.status = "ineligible";
      copy.income!.items = amounts.map((amount, n) => ({ id: `inc_SYNTHETICbig000000000${n}`, category: "wages", categoryLabel: "Wages and salaries", annualAmountCents: amount, counted: true, source: "self_reported" as const }));
      copy.income!.totalCountedCents = Number.MAX_SAFE_INTEGER;
    });
    expect(buildEvidenceRecord(big).income!.total_counted_cents).toBe(Number.MAX_SAFE_INTEGER);
    expectIssue(altered(big, (copy) => void (copy.income!.totalCountedCents = Number.MAX_SAFE_INTEGER - 1)), "income.totalCountedCents", "inconsistent");
    // A total beyond the safe integer range is refused rather than rounded.
    expectIssue(altered(big, (copy) => void (copy.income!.totalCountedCents = Number.MAX_SAFE_INTEGER + 2)), "income.totalCountedCents", "invalid");
  });
});

describe("buildEvidenceRecord: refuses malformed values", () => {
  it.each([
    ["mode", (copy: Mutable & EvidenceInput) => void ((copy as Mutable).mode = "production")],
    ["verificationId", (copy: Mutable & EvidenceInput) => void (copy.verificationId = "ver 1")],
    ["verificationId", (copy: Mutable & EvidenceInput) => void (copy.verificationId = "../etc/passwd")],
    ["sgo.ein", (copy: Mutable & EvidenceInput) => void (copy.sgo.ein = "12-34567")],
    ["decision.status", (copy: Mutable & EvidenceInput) => void (loose(copy.decision).status = "pending")],
    ["decision.applicationDate", (copy: Mutable & EvidenceInput) => void (copy.decision.applicationDate = "2027-13-01")],
    ["decision.decidedAt", (copy: Mutable & EvidenceInput) => void (copy.decision.decidedAt = "2027-02-03T15:12:44")],
    ["decision.decidedAt", (copy: Mutable & EvidenceInput) => void (copy.decision.decidedAt = new Date(8.64e15))],
    ["geography.countyFips", (copy: Mutable & EvidenceInput) => void (copy.geography.countyFips = "4842")],
    ["geography.state", (copy: Mutable & EvidenceInput) => void (copy.geography.state = "Texas")],
    ["geography.zip", (copy: Mutable & EvidenceInput) => void (copy.geography.zip = "78582-1234")],
    ["threshold.thresholdCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.thresholdCents = 125388.5)],
    ["threshold.thresholdCents", (copy: Mutable & EvidenceInput) => void (copy.threshold.thresholdCents = 0)],
    ["threshold.multiplier", (copy: Mutable & EvidenceInput) => void (loose(copy.threshold).multiplier = 1.08)],
    ["threshold.capPct", (copy: Mutable & EvidenceInput) => void (copy.threshold.capPct = 301)],
    ["threshold.readings", (copy: Mutable & EvidenceInput) => void (copy.threshold.readings = [])],
    ["income.items[0].annualAmountCents", (copy: Mutable & EvidenceInput) => void (copy.income!.items[0].annualAmountCents = 52310.25)],
    ["income.items[0].annualAmountCents", (copy: Mutable & EvidenceInput) => void (copy.income!.items[0].annualAmountCents = Number.POSITIVE_INFINITY)],
    ["documents[0].sizeBytes", (copy: Mutable & EvidenceInput) => void (copy.documents[0].sizeBytes = 0)],
    ["documents[0].kind", (copy: Mutable & EvidenceInput) => void (loose(copy.documents[0]).kind = "passport")],
    ["documents[0].extractedFields[0].confidencePct", (copy: Mutable & EvidenceInput) => void (copy.documents[0].extractedFields[0].confidencePct = 99.5)],
    ["consent.scope", (copy: Mutable & EvidenceInput) => void (copy.consent.scope = { retentionYears: 2.5 })],
    ["consent.scope", (copy: Mutable & EvidenceInput) => void (copy.consent.scope = { a: { b: { c: { d: { e: 1 } } } } })],
    ["consent.scope", (copy: Mutable & EvidenceInput) => void (loose(copy.consent).scope = ["x"])],
    ["decision.decidedBy.notes", (copy: Mutable & EvidenceInput) => void (loose(copy.decision.decidedBy).notes = "n".repeat(EVIDENCE_POLICY.limits.notes + 1))],
    ["household.custody.monthsInThisHousehold", (copy: Mutable & EvidenceInput) => void (copy.household.custody = { livesInMultipleHouseholds: true, monthsInThisHousehold: 13 })],
    ["generatedAt", (copy: Mutable & EvidenceInput) => delete (copy as Mutable).generatedAt],
    ["versions.engine", (copy: Mutable & EvidenceInput) => delete loose(copy.versions).engine],
    ["versions.taxonomy", (copy: Mutable & EvidenceInput) => void (copy.versions.taxonomy = "")],
  ])("%s", (path, change) => {
    const issues = issuesOf(altered(syntheticDirectReviewedInput(), change));
    expect(issues.some((issue) => issue.path === path), JSON.stringify(issues)).toBe(true);
  });

  it("normalizes an EIN and a hash written in upper case", () => {
    const record = buildEvidenceRecord(
      altered(syntheticDirectReviewedInput(), (copy) => {
        copy.sgo.ein = "000000000";
        copy.documents[0].sha256 = copy.documents[0].sha256.toUpperCase();
      }),
    );
    expect(record.sgo.ein).toBe("00-0000000");
    expect(record.documents.find((document) => document.id === "doc_SYNTHETICw200000000001")!.sha256).toBe(syntheticSha256("Form W-2"));
  });

  it("refuses more documents than one pack can reasonably carry", () => {
    const input = altered(syntheticDirectReviewedInput(), (copy) => void (copy.documents = syntheticDocuments(EVIDENCE_POLICY.limits.documents + 1)));
    expect(issuesOf(input).some((issue) => issue.path === "documents" && /more than 200 entries/.test(issue.message))).toBe(true);
  });
});

/* -------------------------------------------------------------- decisions the record cannot support */

describe("buildEvidenceRecord: the decision has to follow from the record", () => {
  function direct(status: "eligible" | "ineligible" | "needs_review", incomeCents: number, by: "engine" | "reviewer" = "engine", threshold = syntheticStarrThreshold()): EvidenceInput {
    return altered(syntheticDirectReviewedInput(), (copy) => {
      copy.threshold = threshold;
      copy.household.size = 5;
      copy.decision.status = status;
      if (by === "engine") copy.decision.decidedBy = { type: "engine" };
      copy.decision.reasons = [{ code: "synthetic", message: "Synthetic reason." }];
      copy.income = {
        year: 2026,
        totalCountedCents: incomeCents,
        items: [{ id: "inc_SYNTHETICsingle0000001", category: "wages", categoryLabel: "Wages and salaries", annualAmountCents: incomeCents, counted: true, source: "document", documentId: "doc_SYNTHETICw200000000001" }],
      };
    });
  }

  it("eligible at or below the lower bound relies on the lower bound", () => {
    for (const income of [0, 12_538_799, 12_538_800]) {
      const record = buildEvidenceRecord(direct("eligible", income));
      expect(record.threshold.relied_on).toBe("lower_bound");
      expect(record.threshold.relied_on_limit_cents).toBe(12_538_800);
      expect(record.threshold.relied_on_statement).toContain("not greater than the limit under any reading shown");
    }
  });

  it("eligible between the bounds says plainly that it relied on the upper bound", () => {
    for (const income of [12_538_801, 20_000_000, 27_120_000]) {
      const record = buildEvidenceRecord(direct("eligible", income, "reviewer"));
      expect(record.threshold.relied_on).toBe("upper_bound");
      expect(record.threshold.relied_on_limit_cents).toBe(27_120_000);
      expect(record.threshold.relied_on_statement).toMatch(/^The readings give different limits\. The decision relied on the upper bound, \$271,200\.00 \(6 x HUD's Section 8 very-low-income limit/);
      expect(record.threshold.relied_on_statement).toContain("is greater than the lower bound of $125,388.00");
      expect(record.decision.summary).toContain("the upper bound of the readings shown in the limit calculation");
    }
  });

  it("ineligible above the upper bound relies on the upper bound; between the bounds, on the lower", () => {
    const above = buildEvidenceRecord(direct("ineligible", 27_120_001));
    expect(above.threshold.relied_on).toBe("upper_bound");
    expect(above.threshold.relied_on_statement).toContain("greater than the limit under every reading shown");
    expect(above.decision.summary).toMatch(/^Not eligible: the household income requirement is not met\./);

    const between = buildEvidenceRecord(direct("ineligible", 20_000_000, "reviewer"));
    expect(between.threshold.relied_on).toBe("lower_bound");
    expect(between.threshold.relied_on_limit_cents).toBe(12_538_800);
    expect(between.threshold.relied_on_statement).toContain("The decision relied on the lower bound, $125,388.00");
  });

  it("refuses eligible above every reading and ineligible at or below every reading", () => {
    expectIssue(direct("eligible", 27_120_001), "decision.status", "decision_contradicts_record", /greater than the statutory limit under every reading/);
    expectIssue(direct("eligible", 27_120_001, "reviewer"), "decision.status", "decision_contradicts_record");
    expectIssue(direct("ineligible", 12_538_800), "decision.status", "decision_contradicts_record", /not greater than the limit under any reading/);
    expectIssue(direct("ineligible", 1, "reviewer"), "decision.status", "decision_contradicts_record");
  });

  it("with one limit, compares against that limit, boundary included", () => {
    const harris = (status: "eligible" | "ineligible", income: number) =>
      altered(direct(status, income, "engine", syntheticHarrisThreshold()), (copy) => {
        copy.household.members.pop();
        copy.household.size = 4;
      });
    const atLimit = buildEvidenceRecord(harris("eligible", 31_200_000));
    expect(atLimit.threshold).toMatchObject({ relied_on: "single_limit", relied_on_limit_cents: 31_200_000 });
    expect(atLimit.threshold.relied_on_statement).toBe("The decision compared household income of $312,000.00 with the income limit of $312,000.00. Income is not greater than the limit.");
    const over = buildEvidenceRecord(harris("ineligible", 31_200_001));
    expect(over.threshold.relied_on_statement).toBe("The decision compared household income of $312,000.01 with the income limit of $312,000.00. Income is greater than the limit.");
    expectIssue(harris("eligible", 31_200_001), "decision.status", "decision_contradicts_record");
    expectIssue(harris("ineligible", 31_200_000), "decision.status", "decision_contradicts_record");
  });

  it("needs_review relies on nothing and says where income stands", () => {
    const record = buildEvidenceRecord(direct("needs_review", 20_000_000));
    expect(record.threshold.relied_on).toBe("none");
    expect(record.threshold.relied_on_limit_cents).toBeNull();
    expect(record.threshold.relied_on_statement).toBe(
      "No eligibility decision has been made, so no limit has been relied on. Household income counted so far is $200,000.00, which is greater than the lower bound of $125,388.00 and not greater than the upper bound of $271,200.00.",
    );
    expect(record.decision.summary).toMatch(/^Needs review: no eligibility decision has been made\./);
    expect(record.decision.summary).toContain("is between $125,388.00 and $271,200.00, depending on the reading shown in the limit calculation");
    expectIssue(altered(direct("needs_review", 1), (copy) => void (copy.decision.reasons = [])), "decision.reasons", "invalid", /why the verification needs review/);
  });

  it("a categorical verification is never ineligible, and never eligible on an approval that is not current", () => {
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.decision.status = "ineligible")), "decision.status", "decision_contradicts_record", /cannot be ineligible under the categorical method/);
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.approvalStatus = "not_current")), "decision.status", "decision_contradicts_record", /not current/);
    // An unclear approval is a reviewer's call, never the engine's.
    expectIssue(altered(syntheticCategoricalEligibleInput(), (copy) => void (copy.categorical!.approvalStatus = "unclear")), "decision.status", "decision_contradicts_record", /goes to a reviewer/);
    const reviewed = buildEvidenceRecord(
      altered(syntheticCategoricalEligibleInput(), (copy) => {
        copy.categorical!.approvalStatus = "unclear";
        copy.decision.decidedBy = { type: "reviewer", reviewerId: "usr_SYNTHETICreviewer00001", reviewerName: "Riley Example (synthetic reviewer)", notes: "Called the agency line printed on the letter; approval confirmed." };
      }),
    );
    expect(reviewed.decision.summary).toContain("The approval status read from the document was unclear, and a reviewer made the decision; see the review trail.");
  });

  it("a categorical verification in review may still lack the program and the date", () => {
    const record = buildEvidenceRecord(
      altered(syntheticCategoricalEligibleInput(), (copy) => {
        copy.decision.status = "needs_review";
        copy.decision.reasons = [{ code: "document_unreadable", message: "The letter could not be read." }];
        copy.categorical = { program: null, letterDate: null, approvalStatus: "unclear" };
      }),
    );
    expect(record.categorical).toEqual({ program: null, program_label: null, letter_date: null, approval_status: "unclear", issuing_agency: null, named_member_id: null, benefit_period_end: null, document_id: null });
    expect(record.decision.summary).toBe(
      "Needs review: no eligibility decision has been made. Documentation was submitted under the categorical eligibility verification method of the proposed regulations (REG-117199-25), which are not final. The reasons are listed in this record.",
    );
  });

  it("a reviewer may find a household within the statutory limit although above the SGO's stricter cap", () => {
    const capped = (status: "eligible" | "ineligible", income: number, by: "engine" | "reviewer" = "reviewer") =>
      altered(direct(status, income, by, syntheticHarrisThreshold()), (copy) => {
        copy.household.members.pop();
        copy.household.size = 4;
        Object.assign(copy.threshold, { capPct: 200, thresholdCents: 20_800_000, lowerBoundCents: 20_800_000, upperBoundCents: 20_800_000 });
        copy.threshold.readings.forEach((reading) => void (reading.thresholdCents = 20_800_000));
      });
    const record = buildEvidenceRecord(capped("eligible", 25_000_000));
    expect(record.threshold).toMatchObject({ cap_pct: 200, upper_bound_cents: 20_800_000, statutory_upper_bound_cents: 31_200_000, relied_on: "statutory_limit", relied_on_limit_cents: 31_200_000 });
    expect(record.threshold.relied_on_statement).toBe(
      "The decision relied on the limit at the statutory 300 percent, $312,000.00. Household income of $250,000.00 is not greater than it, and is greater than the limit at the SGO's stricter cap of 200 percent ($208,000.00).",
    );
    expect(record.decision.summary).toBe(
      "Eligible: the household income requirement is met. Household cash income counted for calendar year 2026 is $250,000.00, which is not greater than the provisional income limit of $312,000.00 at the statutory 300 percent " +
        "for a household of 4 in Starr County, TX. It is greater than the limit at the SGO's stricter cap of 200 percent ($208,000.00). A reviewer made the decision; see the review trail.",
    );
    // At the cap itself the capped limit is what was relied on; above the statutory limit nobody is eligible.
    expect(buildEvidenceRecord(capped("eligible", 20_800_000)).threshold).toMatchObject({ relied_on: "single_limit", relied_on_limit_cents: 20_800_000 });
    expect(buildEvidenceRecord(capped("eligible", 31_200_000)).threshold.relied_on).toBe("statutory_limit");
    expectIssue(capped("eligible", 31_200_001), "decision.status", "decision_contradicts_record", /statutory limit under every reading \(\$312,000\.00\)/);
    // Above the cap is over the SGO's limit, so "ineligible" stands on the capped figure.
    expect(buildEvidenceRecord(capped("ineligible", 25_000_000, "engine")).threshold).toMatchObject({ relied_on: "single_limit", relied_on_limit_cents: 20_800_000 });

    // The statutory figure of each reading is stated, never estimated.
    const unstated = altered(capped("eligible", 25_000_000), (copy) => void copy.threshold.readings.forEach((reading) => delete loose(reading).statutoryThresholdCents));
    expectIssue(unstated, "threshold.readings[0].statutoryThresholdCents", "invalid", /required when the cap is below 300 percent/);
    const stated = buildEvidenceRecord(altered(unstated, (copy) => void (copy.threshold.statutoryUpperBoundCents = 31_200_000)));
    expect(stated.threshold.statutory_upper_bound_cents).toBe(31_200_000);
    expect(stated.threshold.readings[0].statutory_limit_cents).toBeNull();
  });

  it("carries the income range and says when a decision rests on lines whose treatment is open", () => {
    const withOpenLine = (status: "eligible" | "ineligible", countedCents: number, openCents: number, by: "engine" | "reviewer" = "reviewer") =>
      altered(direct(status, countedCents, by), (copy) => {
        copy.income!.items.push({
          id: "inc_SYNTHETICopen000000001",
          category: "regular_contributions_from_outside",
          categoryLabel: "Regular support from outside the household",
          annualAmountCents: openCents,
          treatment: "review",
          basis: "The sources do not settle whether this counts",
          source: "self_reported",
        });
      });

    // Recorded income within the lower bound, but the open line could take it over: only a reviewer's call makes this ineligible.
    const record = buildEvidenceRecord(withOpenLine("ineligible", 10_000_000, 5_000_000));
    expect(record.income).toMatchObject({ total_counted_cents: 10_000_000, lower_bound_cents: 10_000_000, upper_bound_cents: 15_000_000 });
    expect(record.income!.items.map((item) => item.treatment)).toEqual(["review", "counted"]);
    expect(record.threshold).toMatchObject({ relied_on: "lower_bound", relied_on_limit_cents: 12_538_800 });
    expect(record.threshold.relied_on_statement).toBe(
      "The decision relied on the lower bound, $125,388.00 (Area median income x family-size multiplier (the worked example in the proposed rule's economic analysis)). " +
        "Recorded household income of $100,000.00 is not greater than it; with the lines whose treatment is open, household income is as much as $150,000.00, which is greater. The decision rests on those lines.",
    );
    expect(record.decision.summary).toBe(
      "Not eligible: the household income requirement is not met. Household cash income counted for calendar year 2026 is $100,000.00; with the lines whose treatment is open it is as much as $150,000.00, " +
        "which is greater than the provisional income limit of $125,388.00 (the lower bound of the readings shown in the limit calculation) for a household of 5 in Starr County, TX. A reviewer made the decision; see the review trail.",
    );
    // If even the most the household can have is within the lowest reading, "ineligible" cannot stand.
    expectIssue(withOpenLine("ineligible", 10_000_000, 2_538_800), "decision.status", "decision_contradicts_record", /at most \$125,388\.00 is not greater than the limit under any reading/);

    // An eligible decision is described by the recorded figure, with the range beside it.
    const eligible = buildEvidenceRecord(altered(withOpenLine("eligible", 5_000_000, 1_000_000, "engine"), (copy) => void (copy.income!.lowerBoundCents = 4_000_000)));
    expect(eligible.income).toMatchObject({ total_counted_cents: 5_000_000, lower_bound_cents: 4_000_000, upper_bound_cents: 6_000_000 });
    expect(eligible.threshold.relied_on_statement).toMatch(/not greater than the limit under any reading shown\. Lines that can be read more than one way put household income between \$40,000\.00 and \$60,000\.00\.$/);

    // An explicit range from the income engine wins over the default.
    const explicit = buildEvidenceRecord(altered(withOpenLine("eligible", 5_000_000, 1_000_000, "engine"), (copy) => void (copy.income!.upperBoundCents = 7_500_000)));
    expect(explicit.income!.upper_bound_cents).toBe(7_500_000);
  });

  it("accepts counted: true or false where a treatment is not given", () => {
    const record = buildEvidenceRecord(
      altered(syntheticDirectReviewedInput(), (copy) => {
        for (const item of copy.income!.items) {
          item.counted = item.treatment === "counted";
          delete loose(item).treatment;
        }
      }),
    );
    expect(record).toEqual(buildEvidenceRecord(syntheticDirectReviewedInput()));
    expect(record.income!.items.map((item) => item.treatment).sort()).toEqual(["counted", "counted", "counted", "excluded"]);
  });

  it("carries the shared-custody facts and how they were resolved", () => {
    const record = buildEvidenceRecord(
      altered(syntheticDirectReviewedInput(), (copy) => {
        copy.household.custody = { livesInMultipleHouseholds: true, monthsInThisHousehold: 8, equalTime: false, thisHouseholdHasHigherIncome: null, notes: "Weekdays here, weekends with the other parent.", outcome: "this_household_longest" };
      }),
    );
    expect(record.household.custody).toEqual({
      lives_in_multiple_households: true,
      months_in_this_household: 8,
      equal_time: false,
      this_household_has_higher_income: null,
      notes: "Weekdays here, weekends with the other parent.",
      outcome: "this_household_longest",
    });
  });

  it("only calls a limit provisional when the table is, and never names the IRS on its own", () => {
    const published = altered(direct("eligible", 10_000_000, "engine", syntheticIrsPublishedThreshold()), (copy) => {
      copy.household.members.pop();
      copy.household.size = 4;
    });
    const record = buildEvidenceRecord(published);
    expect(record.threshold.provisional).toBe(false);
    expect(record.decision.summary).toBe(
      "Eligible: the household income requirement is met. Household cash income counted for calendar year 2026 is $100,000.00, which is not greater than the income limit of $300,000.00 for a household of 4 in Starr County, TX.",
    );
    expect(record.decision.summary + record.threshold.relied_on_statement).not.toMatch(/provisional|IRS|HUD/i);
    expectIssue(altered(published, (copy) => void (copy.threshold.provisional = true)), "threshold.provisional", "inconsistent", /IRS-published/);
  });

  it("an SGO's stricter cap is carried with the statutory figure beside it", () => {
    const capped = altered(direct("eligible", 10_000_000, "engine", syntheticHarrisThreshold()), (copy) => {
      copy.household.members.pop();
      copy.household.size = 4;
      Object.assign(copy.threshold, { capPct: 200, thresholdCents: 20_800_000, lowerBoundCents: 20_800_000, upperBoundCents: 20_800_000 });
      copy.threshold.readings.forEach((reading) => void (reading.thresholdCents = 20_800_000));
    });
    const record = buildEvidenceRecord(capped);
    expect(record.threshold).toMatchObject({ cap_pct: 200, limit_cents: 20_800_000, statutory_limit_cents: 31_200_000 });
    expect(record.threshold.readings[0]).toMatchObject({ limit_cents: 20_800_000, statutory_limit_cents: 31_200_000 });
  });
});

/* ---------------------------------------------------------------------------------------- signing */

describe("signEvidenceRecord", () => {
  it("signs the canonical bytes with Ed25519 and describes how", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    const signed = signEvidenceRecord(record, key);
    expect(signed.record).toBe(record);
    expect(signed.signature).toEqual({
      alg: "EdDSA",
      kid: "test-key-1",
      value: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
      canonicalization: "ecca-jcs-1",
      record_sha256: sha256Hex(canonicalJson(record)),
    });
    expect(Buffer.from(canonicalRecordBytes(record)).toString("utf8")).toBe(canonicalJson(record));
    // Ed25519 is deterministic: the same record and key always give the same signature.
    expect(signEvidenceRecord(record, key).signature.value).toBe(signed.signature.value);
    expect(verifySignedEvidence(signed, jwks)).toEqual({ valid: true, kid: "test-key-1" });
  });

  it("refuses any key that is not an Ed25519 private key", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => signEvidenceRecord(record, { kid: "rsa", privateKey: rsa.privateKey })).toThrow(/Ed25519 private key only/);
    expect(() => signEvidenceRecord(record, { kid: "ec", privateKey: ec.privateKey })).toThrow(/Ed25519 private key only/);
    expect(() => signEvidenceRecord(record, { kid: "public", privateKey: key.publicKey })).toThrow(/Ed25519 private key only/);
    expect(() => signEvidenceRecord(record, { kid: "", privateKey: key.privateKey })).toThrow(/key id/);
  });

  it("refuses to sign something that is not a current evidence record", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    expect(() => signEvidenceRecord({ ...record, schema_version: "2" } as unknown as EvidenceRecord, key)).toThrow(/current schema version/);
    expect(() => signEvidenceRecord({ ...record, extra: 1.5 } as unknown as EvidenceRecord, key)).toThrow(/safe integers/);
  });
});

/* -------------------------------------------------------------------------------------- verifying */

describe("verifySignedEvidence", () => {
  it("accepts a JWKS document, a single JWK, and keys in memory", () => {
    const signed = signedSample();
    const other = generateTestSigningKey("other-key");
    expect(verifySignedEvidence(signed, jwksOf(other, key))).toEqual({ valid: true, kid: "test-key-1" });
    expect(verifySignedEvidence(signed, publicJwk(key))).toEqual({ valid: true, kid: "test-key-1" });
    expect(verifySignedEvidence(signed, key)).toEqual({ valid: true, kid: "test-key-1" });
    expect(verifySignedEvidence(signed, [other, { kid: key.kid, publicKey: key.publicKey }])).toEqual({ valid: true, kid: "test-key-1" });
  });

  it("survives a JSON round trip, re-indentation and any reordering of keys", () => {
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput()]) {
      const signed = signedSample(input);
      const roundTripped = JSON.parse(JSON.stringify(signed, null, 4)) as unknown;
      expect(verifySignedEvidence(roundTripped, jwks).valid).toBe(true);
      const reordered = reverseKeys(roundTripped);
      expect(Object.keys(reordered as object)).toEqual(["signature", "record"]);
      expect(canonicalJson((reordered as SignedEvidence).record)).toBe(canonicalJson(signed.record));
      expect(verifySignedEvidence(reordered, jwks)).toEqual({ valid: true, kid: "test-key-1" });
    }
  });

  it("detects a change to any single leaf of the record", () => {
    for (const input of [syntheticCategoricalEligibleInput(), syntheticDirectReviewedInput()]) {
      const signed = signedSample(input);
      const all = leaves(signed.record);
      expect(all.length).toBeGreaterThan(150);
      for (const leaf of all) {
        const copy = structuredClone(signed);
        setAt(copy.record, leaf.path, mutated(leaf.value));
        const result = verifySignedEvidence(copy, jwks);
        // The two leaves that say what kind of record this is are checked before the hash.
        const reason = leaf.path[0] === "schema_version" || leaf.path[0] === "record_type" ? "unsupported_schema" : "record_hash_mismatch";
        expect(result, leaf.path.join(".")).toMatchObject({ valid: false, reason, kid: "test-key-1" });
        expect(result.message).toBeTypeOf("string");
      }
    }
  });

  it("detects type swaps that print the same", () => {
    const signed = signedSample();
    for (const leaf of leaves(signed.record)) {
      const swapped = typeof leaf.value === "number" ? String(leaf.value) : typeof leaf.value === "boolean" ? String(leaf.value) : leaf.value === null ? "null" : /^\d+$/.test(leaf.value as string) ? Number(leaf.value) : null;
      if (swapped === null) continue;
      const copy = structuredClone(signed);
      setAt(copy.record, leaf.path, swapped);
      expect(verifySignedEvidence(copy, jwks).valid, leaf.path.join(".")).toBe(false);
    }
  });

  it("detects any key added to, removed from or renamed in any object, and any list edit", () => {
    const signed = signedSample();
    for (const container of containers(signed.record)) {
      const label = container.path.join(".") || "(record)";
      if (Array.isArray(container.value)) {
        const grow = structuredClone(signed);
        (at(grow.record, container.path) as unknown[]).push("extra");
        expect(verifySignedEvidence(grow, jwks).valid, `${label} push`).toBe(false);
        if (container.value.length > 0) {
          const shrink = structuredClone(signed);
          (at(shrink.record, container.path) as unknown[]).pop();
          expect(verifySignedEvidence(shrink, jwks).valid, `${label} pop`).toBe(false);
        }
        if (container.value.length > 1 && canonicalJson(container.value[0]) !== canonicalJson(container.value[1])) {
          const swap = structuredClone(signed);
          const list = at(swap.record, container.path) as unknown[];
          [list[0], list[1]] = [list[1], list[0]];
          expect(verifySignedEvidence(swap, jwks).valid, `${label} reorder`).toBe(false);
        }
        continue;
      }
      const added = structuredClone(signed);
      (at(added.record, container.path) as Mutable).injected = "x";
      expect(verifySignedEvidence(added, jwks).valid, `${label} add`).toBe(false);
      for (const name of Object.keys(container.value as object)) {
        const removed = structuredClone(signed);
        delete (at(removed.record, container.path) as Mutable)[name];
        expect(verifySignedEvidence(removed, jwks).valid, `${label} remove ${name}`).toBe(false);
        const renamed = structuredClone(signed);
        const target = at(renamed.record, container.path) as Mutable;
        target[`${name}_`] = target[name];
        delete target[name];
        expect(verifySignedEvidence(renamed, jwks).valid, `${label} rename ${name}`).toBe(false);
      }
    }
  });

  it("detects a change to any character of the hash or the signature", () => {
    const signed = signedSample();
    for (let index = 0; index < signed.signature.record_sha256.length; index += 1) {
      const copy = structuredClone(signed);
      const char = copy.signature.record_sha256[index];
      copy.signature.record_sha256 = `${copy.signature.record_sha256.slice(0, index)}${char === "0" ? "1" : "0"}${copy.signature.record_sha256.slice(index + 1)}`;
      expect(verifySignedEvidence(copy, jwks)).toMatchObject({ valid: false, reason: "record_hash_mismatch" });
    }
    for (let index = 0; index < signed.signature.value.length; index += 1) {
      const copy = structuredClone(signed);
      const char = copy.signature.value[index];
      copy.signature.value = `${copy.signature.value.slice(0, index)}${char === "A" ? "B" : "A"}${copy.signature.value.slice(index + 1)}`;
      const result = verifySignedEvidence(copy, jwks);
      expect(result.valid, `signature character ${index}`).toBe(false);
      expect(["bad_signature", "malformed_signature"]).toContain(result.reason);
    }
  });

  it("accepts only the canonical spelling of the signature", () => {
    const signed = signedSample();
    const value = signed.signature.value;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // The last character carries two signature bits and four spare bits; fifteen other characters decode to the same bytes.
    const lastIndex = alphabet.indexOf(value[value.length - 1]);
    const sameBytes = Array.from(alphabet).filter((char, index) => index !== lastIndex && index >> 4 === lastIndex >> 4);
    expect(sameBytes).toHaveLength(15);
    for (const char of sameBytes) {
      const spelled = `${value.slice(0, -1)}${char}`;
      expect(Buffer.from(spelled, "base64url").equals(Buffer.from(value, "base64url"))).toBe(true);
      expect(verifySignedEvidence({ ...signed, signature: { ...signed.signature, value: spelled } }, jwks)).toMatchObject({ valid: false, reason: "malformed_signature" });
    }
    const standardBase64 = Buffer.from(value, "base64url").toString("base64");
    for (const spelled of [`${value}=`, `${value}==`, ` ${value}`, `${value}\n`, `${value}A`, `${value}AAAA`, value.slice(0, -1), standardBase64, "", "A"]) {
      if (spelled === value) continue;
      const result = verifySignedEvidence({ ...signed, signature: { ...signed.signature, value: spelled } }, jwks);
      expect(result.valid, JSON.stringify(spelled)).toBe(false);
      expect(result.reason).toBe("malformed_signature");
    }
  });

  it("rejects every algorithm except EdDSA, including look-alikes", () => {
    const signed = signedSample();
    for (const alg of ["none", "None", "HS256", "HS512", "RS256", "PS256", "ES256", "Ed25519", "eddsa", "EDDSA", " EdDSA", "EdDSA ", "", null, undefined, 0, ["EdDSA"], { alg: "EdDSA" }]) {
      const result = verifySignedEvidence({ ...signed, signature: { ...signed.signature, alg } }, jwks);
      expect(result.valid, JSON.stringify(alg)).toBe(false);
      expect(result.reason, JSON.stringify(alg)).toBe("unsupported_alg");
    }
    const withoutAlg: Mutable = { ...signed.signature };
    delete withoutAlg.alg;
    expect(verifySignedEvidence({ ...signed, signature: withoutAlg }, jwks)).toMatchObject({ valid: false, reason: "malformed" });
    for (const canonicalization of ["jcs", "none", "ecca-jcs-2", "", null]) {
      expect(verifySignedEvidence({ ...signed, signature: { ...signed.signature, canonicalization } }, jwks)).toMatchObject({ valid: false, reason: "unsupported_canonicalization" });
    }
  });

  it("is not fooled by an HMAC keyed with the public key", () => {
    const signed = signedSample();
    const publicKeyBytes = Buffer.from(publicJwk(key).x, "base64url");
    const bytes = canonicalRecordBytes(signed.record);
    for (const [alg, digest] of [["HS256", "sha256"], ["HS512", "sha512"]] as const) {
      const mac = createHmac(digest, publicKeyBytes).update(bytes).digest("base64url");
      expect(verifySignedEvidence({ ...signed, signature: { ...signed.signature, alg, value: mac } }, jwks)).toMatchObject({ valid: false, reason: "unsupported_alg" });
      // Even labeled EdDSA, a 64-byte MAC is not a signature.
      const result = verifySignedEvidence({ ...signed, signature: { ...signed.signature, value: mac } }, jwks);
      expect(result.valid).toBe(false);
    }
  });

  it("rejects a key of the wrong type published under the right key id", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    const bytes = canonicalRecordBytes(record);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaJwk = { ...(rsa.publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "test-key-1", use: "sig", alg: "EdDSA" };
    const rsaSigned = { record, signature: { alg: "EdDSA", kid: "test-key-1", value: nodeSign("sha256", bytes, rsa.privateKey).toString("base64url"), canonicalization: "ecca-jcs-1", record_sha256: sha256Hex(bytes) } };
    expect(verifySignedEvidence(rsaSigned, { keys: [rsaJwk] })).toMatchObject({ valid: false, reason: "unsupported_key" });
    expect(verifySignedEvidence(rsaSigned, { kid: "test-key-1", publicKey: rsa.publicKey })).toMatchObject({ valid: false, reason: "unsupported_key" });

    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecJwk = { ...(ec.publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "test-key-1" };
    const signed = signedSample();
    const good = publicJwk(key);
    const x448 = generateKeyPairSync("ed448").publicKey.export({ format: "jwk" }) as Record<string, string>;
    const unusable: Array<Record<string, unknown>> = [
      ecJwk,
      { kty: "oct", k: good.x, kid: "test-key-1", alg: "HS256" },
      { ...x448, kid: "test-key-1" },
      { ...good, crv: "X25519" },
      { ...good, kty: "EC" },
      { ...good, alg: "RS256" },
      { ...good, alg: "HS256" },
      { ...good, use: "enc" },
      { ...good, x: undefined },
      { ...good, x: "not a key" },
      { ...good, x: 12345 },
      { ...good, d: "private-part-must-never-be-in-a-key-set" },
      { kid: "test-key-1" },
    ];
    for (const jwk of unusable) {
      expect(verifySignedEvidence(signed, { keys: [jwk] }), JSON.stringify(jwk)).toMatchObject({ valid: false, reason: "unsupported_key", kid: "test-key-1" });
    }
  });

  it("rejects the wrong key, an unknown key id and an ambiguous key set", () => {
    const signed = signedSample();
    const impostor = generateTestSigningKey("test-key-1");
    expect(verifySignedEvidence(signed, jwksOf(impostor))).toMatchObject({ valid: false, reason: "bad_signature", kid: "test-key-1" });
    expect(verifySignedEvidence(signed, impostor)).toMatchObject({ valid: false, reason: "bad_signature" });
    expect(verifySignedEvidence(signed, jwksOf(generateTestSigningKey("some-other-key")))).toMatchObject({ valid: false, reason: "unknown_kid", kid: "test-key-1" });
    expect(verifySignedEvidence(signed, { keys: [] })).toMatchObject({ valid: false, reason: "unknown_kid" });
    expect(verifySignedEvidence(signed, [])).toMatchObject({ valid: false, reason: "unknown_kid" });
    expect(verifySignedEvidence(signed, { ...publicJwk(key), kid: undefined })).toMatchObject({ valid: false, reason: "unknown_kid" });
    // Two keys under one id: whichever is "right", the set is not trustworthy.
    expect(verifySignedEvidence(signed, { keys: [publicJwk(key), publicJwk(impostor)] })).toMatchObject({ valid: false, reason: "unsupported_key" });
    // Renaming the key id inside the envelope points at a key that did not sign.
    const other = generateTestSigningKey("other-key");
    expect(verifySignedEvidence({ ...signed, signature: { ...signed.signature, kid: "other-key" } }, jwksOf(key, other))).toMatchObject({ valid: false, reason: "bad_signature", kid: "other-key" });
  });

  it("a signature for one record does not verify another", () => {
    const first = signedSample(syntheticCategoricalEligibleInput());
    const second = signedSample(syntheticDirectReviewedInput());
    expect(verifySignedEvidence({ record: second.record, signature: first.signature }, jwks)).toMatchObject({ valid: false, reason: "record_hash_mismatch" });
    // With the hash "fixed up" by the attacker, the signature is what fails.
    expect(verifySignedEvidence({ record: second.record, signature: { ...first.signature, record_sha256: second.signature.record_sha256 } }, jwks)).toMatchObject({ valid: false, reason: "bad_signature" });
  });

  it("allows nothing unsigned to ride along in the envelope", () => {
    const signed = signedSample();
    expect(verifySignedEvidence({ ...signed, note: "approved by audit" }, jwks)).toMatchObject({ valid: false, reason: "malformed" });
    expect(verifySignedEvidence({ ...signed, signature: { ...signed.signature, status: "eligible" } }, jwks)).toMatchObject({ valid: false, reason: "malformed" });
    expect(verifySignedEvidence({ record: signed.record, signature: { ...signed.signature, kid: undefined } }, jwks)).toMatchObject({ valid: false, reason: "malformed" });
  });

  it("rejects other schema versions and other kinds of signed JSON", () => {
    const record = buildEvidenceRecord(syntheticDirectReviewedInput());
    const sign = (value: unknown) => {
      const bytes = Buffer.from(canonicalJson(value), "utf8");
      return { record: value, signature: { alg: "EdDSA", kid: key.kid, value: nodeSign(null, bytes, key.privateKey).toString("base64url"), canonicalization: "ecca-jcs-1", record_sha256: sha256Hex(bytes) } };
    };
    // Genuinely signed by the right key, but not an evidence record of this schema.
    expect(verifySignedEvidence(sign({ ...record, schema_version: "2" }), jwks)).toMatchObject({ valid: false, reason: "unsupported_schema" });
    expect(verifySignedEvidence(sign({ ...record, schema_version: 1 }), jwks)).toMatchObject({ valid: false, reason: "unsupported_schema" });
    expect(verifySignedEvidence(sign({ ...record, record_type: "donation_acknowledgment" }), jwks)).toMatchObject({ valid: false, reason: "unsupported_schema" });
    expect(verifySignedEvidence(sign({ hello: "world" }), jwks)).toMatchObject({ valid: false, reason: "unsupported_schema" });
    expect(verifySignedEvidence(sign(record), jwks)).toEqual({ valid: true, kid: key.kid });
  });

  it("never throws on hostile input", () => {
    const signed = signedSample();
    const cyclic: Mutable = { ...signed.record };
    cyclic.self = cyclic;
    let deep: unknown = "x";
    for (let depth = 0; depth < 20_000; depth += 1) deep = { d: deep };
    const hostile: unknown[] = [
      null,
      undefined,
      "",
      "signed",
      0,
      [],
      {},
      { record: null, signature: null },
      { record: [], signature: {} },
      { record: signed.record },
      { signature: signed.signature },
      { record: signed.record, signature: "sig" },
      { record: signed.record, signature: { ...signed.signature, value: 5 } },
      { record: signed.record, signature: { ...signed.signature, record_sha256: null } },
      { record: { ...signed.record, generated_at: 1.5 }, signature: signed.signature },
      { record: { ...signed.record, extra: Number.NaN }, signature: signed.signature },
      { record: { ...signed.record, extra: 2 ** 60 }, signature: signed.signature },
      { record: { ...signed.record, extra: () => 1 }, signature: signed.signature },
      { record: { ...signed.record, extra: 10n }, signature: signed.signature },
      { record: cyclic, signature: signed.signature },
      { record: { ...signed.record, deep }, signature: signed.signature },
    ];
    for (const input of hostile) {
      const result = verifySignedEvidence(input, jwks);
      expect(result.valid).toBe(false);
      expect(result.reason).toBeTypeOf("string");
      expect(result.message).toBeTypeOf("string");
    }
    expect(verifySignedEvidence({ record: { ...signed.record, generated_at: 1.5 }, signature: signed.signature }, jwks)).toMatchObject({ reason: "not_canonicalizable" });
    for (const keys of [null, undefined, "jwks", 7, { keys: "none" }, { keys: [null, 5, "x"] }, [null]]) {
      expect(verifySignedEvidence(signed, keys as never)).toMatchObject({ valid: false, reason: "unknown_kid" });
    }
  });

  it("__proto__ and constructor members are data, not behaviour", () => {
    const signed = signedSample();
    const text = JSON.stringify(signed).replace('"schema_version":"1"', '"schema_version":"1","__proto__":{"mode":"live"},"constructor":{"prototype":{"x":1}}');
    const parsed = JSON.parse(text) as unknown;
    expect(verifySignedEvidence(parsed, jwks)).toMatchObject({ valid: false, reason: "record_hash_mismatch" });
    expect(({} as Mutable).mode).toBeUndefined();
  });
});
