import { describe, expect, it } from "vitest";
import { readFlag, readInt, readLines, readMoney, readText } from "./form-data";
import {
  incomeLineFromForm,
  keyedFieldsFromForm,
  measureLabel,
  measuresFor,
  newVerificationFromForm,
  offerAwardFromForm,
  policyFromForm,
  requestInfoFromForm,
  resolveFromForm,
  roleFromForm,
  signupFromForm,
  webhookFromForm,
} from "./forms";

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}

function fieldsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    return ((e as { details?: { fields?: Record<string, string> } }).details?.fields ?? {}) as Record<string, string>;
  }
  throw new Error("expected a validation error");
}

describe("form-data", () => {
  it("reads text, flags, lines and ints defensively", () => {
    const f = fd({ a: "  hi ", flag: "on", lines: "one\r\n\n two \n", n: "42" });
    f.append("file", new Blob(["x"]), "x.csv");
    expect(readText(f, "a")).toBe("hi");
    expect(readText(f, "file")).toBe("");
    expect(readText(f, "missing")).toBe("");
    expect(readFlag(f, "flag")).toBe(true);
    expect(readFlag(f, "a")).toBe(false);
    expect(readLines(f, "lines")).toEqual(["one", "two"]);
    expect(readInt(f, "n", "n")).toBe(42);
    expect(readInt(f, "missing", "n")).toBeNull();
    expect(() => readInt(fd({ n: "4.2" }), "n", "n")).toThrow(/whole number/);
  });

  it("parses money into integer cents and refuses floats, junk and unwanted negatives", () => {
    expect(readMoney(fd({ m: "$41,250.5" }), "m", { label: "x" })).toBe(4_125_050);
    expect(readMoney(fd({ m: "-1,000" }), "m", { label: "x", allowNegative: true })).toBe(-100_000);
    expect(readMoney(fd({ m: "(250.00)" }), "m", { label: "x", allowNegative: true })).toBe(-25_000);
    expect(() => readMoney(fd({ m: "-5" }), "m", { label: "x" })).toThrow(/cannot be negative/);
    expect(() => readMoney(fd({ m: "1.005" }), "m", { label: "x" })).toThrow(/dollar amount/);
    expect(() => readMoney(fd({ m: "1e6" }), "m", { label: "x" })).toThrow(/dollar amount/);
    expect(() => readMoney(fd({ m: "" }), "m", { label: "the amount" })).toThrow(/Enter the amount/);
  });
});

describe("dashboard forms", () => {
  it("new verification: all optional, but emailing the link needs an email", () => {
    expect(newVerificationFromForm(fd({}))).toMatchObject({ applicantEmail: null, sendInvite: false, locale: "en" });
    expect(newVerificationFromForm(fd({ applicantEmail: "Dana@Example.COM", sendInvite: "on", locale: "es" }))).toMatchObject({ applicantEmail: "dana@example.com", sendInvite: true, locale: "es" });
    expect(fieldsOf(() => newVerificationFromForm(fd({ sendInvite: "on" })))).toHaveProperty("applicantEmail");
    expect(fieldsOf(() => newVerificationFromForm(fd({ applicantEmail: "not-an-email" })))).toHaveProperty("applicantEmail");
    expect(fieldsOf(() => newVerificationFromForm(fd({ locale: "fr" })))).toHaveProperty("locale");
  });

  it("resolve: notes are mandatory and a categorical basis needs the award letter", () => {
    expect(fieldsOf(() => resolveFromForm(fd({ verificationId: "ver_1", resolution: "eligible", method: "direct", notes: "" })))).toHaveProperty("notes");
    expect(fieldsOf(() => resolveFromForm(fd({ verificationId: "ver_1", resolution: "eligible", method: "categorical", notes: "Checked" })))).toHaveProperty("documentId");
    expect(fieldsOf(() => resolveFromForm(fd({ verificationId: "ver_1", resolution: "maybe", method: "direct", notes: "x" })))).toHaveProperty("resolution");
    expect(resolveFromForm(fd({ verificationId: "ver_1", resolution: "ineligible", method: "categorical", documentId: "doc_1", notes: "Read the letter" }))).toEqual({
      verificationId: "ver_1",
      resolution: "ineligible",
      notes: "Read the letter",
      basis: { method: "categorical", documentId: "doc_1" },
    });
    // A document chosen with the direct method is ignored, not sent.
    expect(resolveFromForm(fd({ verificationId: "ver_1", resolution: "eligible", method: "direct", documentId: "doc_1", notes: "x" })).basis).toEqual({ method: "direct" });
  });

  it("ask for more: a message and at least one item", () => {
    expect(fieldsOf(() => requestInfoFromForm(fd({ verificationId: "v", message: "", items: "W-2" })))).toHaveProperty("message");
    expect(fieldsOf(() => requestInfoFromForm(fd({ verificationId: "v", message: "Please", items: "\n \n" })))).toHaveProperty("items");
    expect(requestInfoFromForm(fd({ verificationId: "v", message: "Please", items: "2025 W-2\nPay stub" })).items).toEqual(["2025 W-2", "Pay stub"]);
  });

  it("income line: amount in cents, required description and basis", () => {
    const line = incomeLineFromForm(fd({ verificationId: "v", category: "wages", annualAmount: "41,250", description: "Employer W-2", basis: "Box 1", incomeYear: "2025" }));
    expect(line).toMatchObject({ annualAmountCents: 4_125_000, incomeYear: 2025, memberId: null, documentId: null });
    expect(fieldsOf(() => incomeLineFromForm(fd({ verificationId: "v", category: "wages", annualAmount: "1", description: "", basis: "x" })))).toHaveProperty("description");
    expect(fieldsOf(() => incomeLineFromForm(fd({ verificationId: "v", category: "", annualAmount: "1", description: "x", basis: "x" })))).toHaveProperty("category");
  });

  it("keyed fields: an award letter keeps its program; an income document needs at least one amount", () => {
    const award = keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "award_letter", program: "SNAP", letterDate: "2026-10-20", approvalStatus: "approved", householdMembers: "DANA SAMPLE\nRILEY SAMPLE" }));
    expect(award.input.award).toMatchObject({ program: "SNAP", letterDate: "2026-10-20", approvalStatus: "approved", householdMembers: ["DANA SAMPLE", "RILEY SAMPLE"], benefitPeriod: null });
    expect(award.input.income).toBeUndefined();
    const notListed = keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "award_letter", program: "" }));
    expect(notListed.input.award?.program).toBeNull();
    expect(notListed.input.award?.approvalStatus).toBe("unclear");

    expect(fieldsOf(() => keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "w2" })))).toHaveProperty("measure_0");
    expect(fieldsOf(() => keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "w2", amount_0: "100" })))).toHaveProperty("measure_0");
    expect(fieldsOf(() => keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "w2", measure_0: "not_a_measure", amount_0: "1" })))).toHaveProperty("measure_0");
    expect(fieldsOf(() => keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "passport" })))).toHaveProperty("kind");
    const w2 = keyedFieldsFromForm(fd({ documentId: "doc_1", kind: "w2", taxYear: "2025", measure_0: "w2_box1_wages", amount_0: "41,250.00", measure_3: "w2_box5_medicare_wages", amount_3: "41250", statement_3: "2" }));
    expect(w2.input.income?.amounts).toEqual([
      { measure: "w2_box1_wages", amountCents: 4_125_000, person: null, payer: null, statement: 1 },
      { measure: "w2_box5_medicare_wages", amountCents: 4_125_000, person: null, payer: null, statement: 2 },
    ]);
    expect(w2.input.income?.taxYear).toBe(2025);
  });

  it("measure labels and per-kind measure lists", () => {
    expect(measureLabel("w2_box1_wages")).toBe("W-2 box1 wages");
    expect(measureLabel("paystub_gross_ytd")).toBe("Pay stub gross ytd");
    expect(measuresFor("w2").every((m) => m.startsWith("w2_"))).toBe(true);
    expect(measuresFor("irs_transcript").some((m) => m.startsWith("wai_"))).toBe(true);
  });

  it("award offer: the reminders must be acknowledged and the amount is in cents", () => {
    expect(fieldsOf(() => offerAwardFromForm(fd({ verificationId: "v", amount: "500", paymentMethod: "direct_to_vendor" })))).toHaveProperty("remindersRead");
    expect(fieldsOf(() => offerAwardFromForm(fd({ verificationId: "v", amount: "500", remindersRead: "on" })))).toHaveProperty("paymentMethod");
    expect(offerAwardFromForm(fd({ verificationId: "v", amount: "1,250.50", paymentMethod: "other", remindersRead: "on" }))).toMatchObject({ amountCents: 125_050, paymentMethod: "other", studentMemberId: null });
  });

  it("policy, role, webhook and signup forms", () => {
    expect(policyFromForm(fd({ incomeCapPct: "250", reviewBandBps: "500", rawRetentionDays: "30" }))).toEqual({ incomeCapPct: 250, reviewBandBps: 500, rawRetentionDays: 30 });
    expect(fieldsOf(() => policyFromForm(fd({ incomeCapPct: "", reviewBandBps: "500", rawRetentionDays: "30" })))).toHaveProperty("incomeCapPct");
    expect(fieldsOf(() => policyFromForm(fd({ incomeCapPct: "300.5", reviewBandBps: "500", rawRetentionDays: "30" })))).toHaveProperty("incomeCapPct");
    expect(roleFromForm(fd({ role: "reviewer" }))).toBe("reviewer");
    expect(fieldsOf(() => roleFromForm(fd({ role: "superuser" })))).toHaveProperty("role");
    expect(webhookFromForm(fd({ url: "https://example.org/h", allEvents: "on", eventTypes: ["verification.decided"] })).eventTypes).toEqual(["*"]);
    expect(webhookFromForm(fd({ url: "https://example.org/h", eventTypes: ["verification.decided", "award.offered"] })).eventTypes).toEqual(["verification.decided", "award.offered"]);
    expect(fieldsOf(() => webhookFromForm(fd({ url: "https://example.org/h" })))).toHaveProperty("eventTypes");
    expect(fieldsOf(() => signupFromForm(fd({ name: "Synthetic Fund" })))).toHaveProperty("testModeUnderstood");
    expect(signupFromForm(fd({ name: "Synthetic Fund", testModeUnderstood: "on", state: "tx" }))).toEqual({ name: "Synthetic Fund", ein: null, city: null, state: "TX" });
  });
});
