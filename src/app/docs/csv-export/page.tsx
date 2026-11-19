import type { Metadata } from "next";
import { Callout } from "@/components/ui";
import { CSV_EXPORT_MAX_ROWS, HTTP_SAMPLES, MAX_CSV_COLUMNS, STANDARD_CSV_COLUMNS, VERIFICATION_CSV_COLUMNS } from "@/server/api";
import { C, DocsHeader, DocsSection, RefTable, Sample } from "../_components";

export const metadata: Metadata = { title: "CSV export" };

export default function CsvExportPage() {
  return (
    <>
      <DocsHeader
        eyebrow="CSV export"
        title="Your results, in someone else's columns"
        lead={
          <p>
            Applicant systems and scholarship platforms each import their own spreadsheet layout, and none publishes one for eligibility results. Instead of a fixed format, the
            export lets you choose, order and rename columns so the file drops straight into whatever you already use.
          </p>
        }
      />

      <DocsSection id="request" title="Request">
        <Sample sample={HTTP_SAMPLES.exportCsv} />
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <C>columns</C>: comma-separated column names, in the order you want them. Rename a column with <C>name:Header label</C> (the label may contain spaces; it ends at the
            next comma). Up to {MAX_CSV_COLUMNS} columns. Without <C>columns</C>, every standard column below, in that order.
          </li>
          <li>
            <C>metadata.&lt;key&gt;</C> reads one of your own metadata values (empty when a verification does not have it).
          </li>
          <li>
            <C>status</C> and <C>external_ref</C> filter the rows; <C>header=false</C> leaves out the header row.
          </li>
          <li>Rows are newest first, in the key&apos;s mode only. RFC 4180 CSV, UTF-8, CRLF line ends. Booleans are <C>true</C>/<C>false</C>; empty means no value.</li>
          <li>At most {CSV_EXPORT_MAX_ROWS.toLocaleString("en-US")} rows per export: filter beyond that. Every export is recorded in your audit log.</li>
        </ul>
        <Callout title="Safe to open in a spreadsheet">
          <p>
            Any cell that starts with <C>=</C>, <C>+</C>, <C>-</C>, <C>@</C>, a tab or a carriage return (and is not a plain number) is prefixed with an apostrophe, so a value
            typed by an applicant can never run as a formula. That includes your header labels.
          </p>
        </Callout>
      </DocsSection>

      <DocsSection id="columns" title="Standard columns">
        <RefTable caption="Standard CSV columns" head={["column", "contents"]} rows={STANDARD_CSV_COLUMNS.map((c) => [c, VERIFICATION_CSV_COLUMNS[c].description])} />
      </DocsSection>
    </>
  );
}
