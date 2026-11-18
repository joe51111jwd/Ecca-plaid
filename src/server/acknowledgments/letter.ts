import type { AcknowledgmentSnapshot, Mode } from "@/db/schema";
import { centralDateString } from "@/lib/clock";
import { formatUsd } from "@/lib/money";
import { formatIsoDateLong, renderCopy } from "@/taxmath";
import { fill, LETTER_COPY } from "./letter-copy";

/**
 * The words of one acknowledgment version, as plain data: the PDF and the email both render exactly this, so the two
 * forms of the document can never say different things. Pure.
 *
 * The five items of Temp. Treas. Reg. 1.25F-4T(c)(1)(i) are the `required` block, in the regulation's order
 * (A) EIN, (C) donor number, (B) designated total, (D) the goods-or-services statement and, when goods or services
 * were provided, (E) their description and good-faith value; every one is a taxmath copy entry (ack.*).
 */

export interface LetterInput {
  acknowledgmentId: string;
  mode: Mode;
  taxYear: number;
  version: number;
  issuedAt: Date;
  snapshot: AcknowledgmentSnapshot;
  totalDesignatedCents: number;
  totalNonDesignatedCents: number;
  goodsOrServices: { provided: boolean; description: string | null; valueCents: number };
  /** The version this one replaces, if any. */
  previous: { version: number; issuedAt: Date } | null;
}

export interface LetterContent {
  title: string;
  /** Test mode: the watermark printed across every page, and the notice at the top. */
  watermark: string | null;
  testNotice: string | null;
  sgo: { name: string; legalName: string | null; location: string | null };
  meta: Array<{ label: string; value: string }>;
  donor: { label: string; lines: string[] };
  requiredHeading: string;
  required: string[];
  replaces: string | null;
  gifts: { heading: string; columns: [string, string, string, string]; rows: Array<[string, string, string, string]>; total: [string, string, string, string]; note: string };
  notesHeading: string;
  notes: string[];
  footer: string;
}

const usd = (cents: number) => formatUsd(cents, { cents: true });

export function buildLetter(input: LetterInput): LetterContent {
  const { snapshot, taxYear } = input;
  const sgoName = snapshot.sgo.legalName?.trim() || snapshot.sgo.name;
  const test = input.mode === "test";
  const issuedDate = formatIsoDateLong(centralDateString(input.issuedAt));

  const required: string[] = [renderCopy("ack.ein", { ein: snapshot.sgo.ein }), renderCopy("ack.donor_number", { donorNumber: snapshot.donorNumber.number })];
  if (snapshot.donorNumber.source === "sandbox_generated") required.push(renderCopy("ack.sandbox_donor_number"));
  required.push(renderCopy("ack.total_designated", { sgoName, calendarYear: String(taxYear), totalDesignated: usd(input.totalDesignatedCents) }));
  required.push(
    input.goodsOrServices.provided
      ? renderCopy("ack.goods_or_services_provided", { sgoName, description: input.goodsOrServices.description ?? "", estimatedValue: usd(input.goodsOrServices.valueCents) })
      : renderCopy("ack.goods_or_services_none", { sgoName }),
  );

  const columns = LETTER_COPY.giftsColumns;
  return {
    title: renderCopy("ack.title"),
    watermark: test ? LETTER_COPY.testWatermark : null,
    testNotice: test ? LETTER_COPY.testNotice : null,
    sgo: {
      name: sgoName,
      legalName: snapshot.sgo.legalName && snapshot.sgo.legalName !== snapshot.sgo.name ? snapshot.sgo.name : null,
      location: [snapshot.sgo.city, snapshot.sgo.state].filter((p) => p && p.trim()).join(", ") || null,
    },
    meta: [
      { label: LETTER_COPY.calendarYearLabel, value: String(taxYear) },
      { label: LETTER_COPY.issuedLabel, value: issuedDate },
      { label: LETTER_COPY.documentLabel, value: input.acknowledgmentId },
      { label: LETTER_COPY.versionLabel, value: String(input.version) },
    ],
    donor: { label: LETTER_COPY.donorLabel, lines: [snapshot.donor.fullName, ...snapshot.donor.addressLines] },
    requiredHeading: LETTER_COPY.requiredHeading,
    required,
    replaces: input.previous ? fill(LETTER_COPY.replaces, { previousVersion: input.previous.version, previousDate: formatIsoDateLong(centralDateString(input.previous.issuedAt)) }) : null,
    gifts: {
      heading: fill(LETTER_COPY.giftsHeading, { calendarYear: taxYear }),
      columns: [columns.date, columns.designated, columns.notDesignated, columns.reference],
      rows: snapshot.gifts.map((g) => [formatIsoDateLong(g.localDate), usd(g.designatedCents), usd(g.nonDesignatedCents), g.donationId]),
      total: [LETTER_COPY.giftsTotal, usd(input.totalDesignatedCents), usd(input.totalNonDesignatedCents), ""],
      note: LETTER_COPY.giftsNote,
    },
    notesHeading: LETTER_COPY.notesHeading,
    notes: [
      renderCopy("ack.credit_not_promised"),
      renderCopy("note.what_to_keep"),
      renderCopy("ack.how_to_claim"),
      renderCopy("note.section_170_no_double_benefit"),
      renderCopy("note.excess_may_be_deductible"),
      LETTER_COPY.notTaxAdvice,
    ],
    footer: `${sgoName}  |  ${input.acknowledgmentId}  |  ${LETTER_COPY.versionLabel} ${input.version}`,
  };
}

/** The letter as plain text (email body and tests), in reading order. */
export function letterParagraphs(letter: LetterContent): string[] {
  const out: string[] = [];
  if (letter.testNotice) out.push(letter.testNotice);
  out.push(...letter.required);
  if (letter.replaces) out.push(letter.replaces);
  out.push(letter.gifts.heading);
  for (const row of letter.gifts.rows) out.push(`${row[0]}: ${letter.gifts.columns[1]} ${row[1]}; ${letter.gifts.columns[2]} ${row[2]}`);
  out.push(letter.gifts.note);
  out.push(...letter.notes);
  return out;
}
