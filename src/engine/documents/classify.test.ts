import { describe, expect, it } from "vitest";
import { classifyDocument } from "./classify";

const SSA_HEAD = (program: string, subject: string) => `Social Security Administration\n${program}\n${subject}\n                          Date: March 4, 2026\n`;

describe("classifyDocument", () => {
  it.each([
    ["Form TF0001\nNotice about your case:\nTEXAS HEALTH AND HUMAN SERVICES COMMISSION", "award_letter", "tx_hhsc_tf0001"],
    ["Notice of Benefit Denial or Reduction\nForm H1017", "award_letter", "tx_hhsc_h1017"],
    ["To find out if you can get or keep getting benefits, we need more facts from you:\nForm 1020", "award_letter", "tx_hhsc_h1020"],
    ["TANF/SNAP Benefits Notice of Eligibility\nOnly the checked boxes apply to you.", "award_letter", "tx_hhsc_h1009"],
    ["Form H1830-R\nIt is time to renew your benefits.", "award_letter", "tx_hhsc_renewal"],
    ["Here is your Lone Star Card", "award_letter", "benefit_card"],
    ["HEALTH AND HUMAN SERVICES COMMISSION\nDeadline Extended to Return Renewal Packet", "award_letter", "tx_hhsc_other"],
    ["Texas WIC\nVerification of Certification (VOC)\nCertification End Date: 09/30/2027", "award_letter", "wic_certification"],
    ["WIC Notification of Ineligibility/Termination", "award_letter", "wic_ineligible"],
    ["Voucher\nHousing Choice Voucher Program\nform HUD-52646 (10/2026)", "award_letter", "hcv_voucher"],
    ["Family Report\n2a. Type of action: 2\nform HUD-50058 (11/2013)", "award_letter", "hud_50058"],
    ["Example City Housing Authority\nTenant Rent: $212.00", "award_letter", "pha_notice"],
    ["Social Security Administration\nBenefit Verification Letter\nInformation About Supplemental Security Income Payments", "award_letter", "ssa_benefit_verification"],
    [SSA_HEAD("Supplemental Security Income", "Notice of Award") + "SSA-L8025", "award_letter", "ssa_ssi_notice"],
    [SSA_HEAD("Retirement, Survivors, and Disability Insurance", "Notice of Award"), "award_letter", "ssa_title2_notice"],
    [SSA_HEAD("Special Veterans Benefits", "Important Information"), "award_letter", "ssa_title2_notice"],
    ["Social Security Administration\nImportant Information\nWe are writing about your benefits.", "award_letter", "ssa_other"],
    ["Tax Return Transcript\nThis Product Contains Sensitive Taxpayer Data\nTax Period Ending: Dec. 31, 2025", "irs_transcript", "irs_tax_return_transcript"],
    ["Wage and Income Transcript\nThis Product Contains Sensitive Taxpayer Data\nForm W-2 Wage and Tax Statement", "irs_transcript", "irs_wage_income_transcript"],
    ["Verification of Non-filing Letter", "irs_transcript", "irs_verification_of_nonfiling"],
    ["1040 U.S. Individual Income Tax Return 2025\nOMB No. 1545-0074\nTotal amount from Form(s) W-2, box 1", "tax_return", "form_1040"],
    ["Form 1040-X Amended U.S. Individual Income Tax Return", "tax_return", "form_1040_variant"],
    ["Form W-2 Wage and Tax Statement 2025\nOMB No. 1545-0029", "w2", "irs_w2"],
    ["Form W-2c Corrected Wage and Tax Statement", "w2", "irs_w2c"],
    ["Your children are approved for free meals under the National School Lunch Program.", "award_letter", "school_meals_notice"],
    ["Texas Workforce Commission\nYour unemployment benefits: weekly benefit amount $300.00", "other_income", "unemployment_notice"],
    ["Employer: FIXTURE FOODS LLC\nPay Date: 12/26/2025\nGross Pay 1,650.00\nNet Pay 1,298.40\nYTD", "pay_stub", "pay_stub"],
    ["Join us at the park on Saturday.", "unknown", "unknown"],
    ["", "unknown", "unknown"],
  ])("%#: → %s/%s", (text, kind, subtype) => {
    const c = classifyDocument(text);
    expect([c.kind, c.subtype]).toEqual([kind, subtype]);
    expect(c.signals.length).toBeGreaterThan(0);
  });

  it("decides SSI vs SSDI by the heading line, not by 'Supplemental Security Income' in a worksheet", () => {
    const t2 = `${SSA_HEAD("Retirement, Survivors, and Disability Insurance", "Notice of Change in Benefits")}\nWorksheet: Supplemental Security Income and Social Security benefits (type A)`;
    expect(classifyDocument(t2).subtype).toBe("ssa_title2_notice");
  });

  it("ignores the synthetic banner when classifying and reports heuristic types with lower confidence", () => {
    expect(classifyDocument("SYNTHETIC SAMPLE — NOT A REAL DOCUMENT\nJoin us").subtype).toBe("unknown");
    expect(classifyDocument("Example City Housing Authority\nTenant Rent: $212.00").confidence).toBeLessThan(0.8);
    expect(classifyDocument("Form TF0001\nNotice about your case:").confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("detects Spanish", () => {
    const es = "Form TF0001\nAviso sobre su caso:\nQuién recibe beneficios de comida SNAP\nNombre Número EDG Programa Fecha\nUsted tiene derecho a pedir una audiencia sobre su caso y sus beneficios para los niños de la casa por la fecha del aviso.";
    expect(classifyDocument(es)).toMatchObject({ subtype: "tx_hhsc_tf0001", language: "es" });
  });
});
