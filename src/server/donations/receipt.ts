import type { Mode } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { formatUsd } from "@/lib/money";
import { renderEmail } from "@/server/email";
import { determineTaxYear, formatIsoDateLong, renderCopy, renderCopyDynamic, type CopyLocale, type EligibilityBlocker } from "@/taxmath";

/**
 * The immediate email receipt: plainly a payment receipt, NOT the official section 25F acknowledgment (which
 * follows by January 31 with the unique donor number). Designated, non-designated and any service fee are separate
 * lines; it says whether the gift was made on the credit-eligible path or exactly why not; sandbox receipts carry a
 * watermark. Every tax sentence comes from the taxmath copy registry. Pure.
 */

export interface ReceiptDonation {
  role: "individual" | "spouse_1" | "spouse_2";
  fullName: string;
  designatedCents: number;
  nonDesignatedCents: number;
}

export interface ReceiptInput {
  mode: Mode;
  sgoName: string;
  sgoEin: string | null;
  paymentId: string;
  paidAt: Date;
  donorTimeZone: string;
  donations: readonly ReceiptDonation[];
  serviceFeeCents: number;
  chargedCents: number;
  /** The designation words exactly as confirmed (one statement covers both spouses on a joint gift). */
  designationText: string;
  creditEligible: boolean;
  blockers: readonly Pick<EligibilityBlocker, "message">[];
  locale?: CopyLocale;
}

export interface ReceiptEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildReceiptEmail(input: ReceiptInput): ReceiptEmail {
  const locale = input.locale ?? "en";
  const paidDate = formatIsoDateLong(determineTaxYear(input.paidAt, input.donorTimeZone).localDate, locale);
  const sgoName = input.sgoName;
  const joint = input.donations.length > 1;
  const nonDesignatedCents = input.donations.reduce((sum, d) => sum + d.nonDesignatedCents, 0);

  const paragraphs: string[] = [];
  if (input.mode === "test") paragraphs.push(renderCopy("receipt.sandbox", {}, { locale }));
  paragraphs.push(renderCopy("receipt.not_official_acknowledgment", { sgoName }, { locale }));
  for (const d of input.donations) {
    const sentence = renderCopy("receipt.designated", { designatedAmount: formatUsd(d.designatedCents), sgoName, paidDate }, { locale });
    paragraphs.push(joint ? `${d.fullName}: ${sentence}` : sentence);
  }
  if (nonDesignatedCents > 0) paragraphs.push(renderCopy("receipt.non_designated", { nonDesignatedAmount: formatUsd(nonDesignatedCents) }, { locale }));
  if (input.serviceFeeCents > 0) paragraphs.push(renderCopy("receipt.service_fee", { platformName: BRAND.name, feeAmount: formatUsd(input.serviceFeeCents) }, { locale }));
  paragraphs.push(renderCopy("receipt.goods_or_services_none", { sgoName }, { locale }));
  if (input.creditEligible) {
    paragraphs.push(renderCopy("receipt.credit_eligible_path", {}, { locale }));
  } else {
    paragraphs.push(renderCopy("receipt.not_credit_eligible", {}, { locale }));
    for (const blocker of input.blockers) paragraphs.push(`- ${blocker.message}`);
  }
  paragraphs.push(input.designationText);

  const designatedLabel = renderCopyDynamic("fee.line.designated_contribution", {}, { locale });
  const details: Array<{ label: string; value: string }> = [];
  for (const d of input.donations) {
    details.push({ label: joint ? `${designatedLabel} (${d.fullName})` : designatedLabel, value: formatUsd(d.designatedCents, { cents: true }) });
  }
  if (nonDesignatedCents > 0) details.push({ label: renderCopyDynamic("fee.line.non_designated_gift", {}, { locale }), value: formatUsd(nonDesignatedCents, { cents: true }) });
  if (input.serviceFeeCents > 0) details.push({ label: renderCopyDynamic("fee.line.donor_service_fee", {}, { locale }), value: formatUsd(input.serviceFeeCents, { cents: true }) });
  details.push({ label: "Total charged", value: formatUsd(input.chargedCents, { cents: true }) });
  details.push({ label: "Date", value: paidDate });
  details.push({ label: "Organization", value: input.sgoEin ? `${sgoName} (EIN ${input.sgoEin})` : sgoName });
  details.push({ label: "Payment reference", value: input.paymentId });

  const sandbox = input.mode === "test";
  const heading = sandbox ? "Sandbox payment receipt" : "Payment receipt";
  const { html, text } = renderEmail({ heading, preheader: `${heading}: ${sgoName}`, paragraphs, details, locale });
  return { subject: `${sandbox ? "[Sandbox] " : ""}Payment receipt for your gift to ${sgoName}`, html, text };
}
