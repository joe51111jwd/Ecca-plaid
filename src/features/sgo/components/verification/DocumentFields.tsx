import { Fragment } from "react";
import { Badge, DateTime, Disclosure, Money } from "@/components/ui";
import { presentFields, type PresentedField, type StoredField } from "../../field-labels";

function confidenceTone(c: number): "success" | "warning" | "danger" {
  return c >= 0.9 ? "success" : c >= 0.6 ? "warning" : "danger";
}

function Value({ field }: { field: PresentedField }) {
  const d = field.display;
  switch (d.kind) {
    case "money":
      return <Money cents={d.cents} showCents />;
    case "date":
      return <DateTime value={d.iso} format="date" />;
    case "text":
      return <span className="break-words">{d.text}</span>;
    case "missing":
      return <span className="text-fg-subtle">Not read</span>;
  }
}

function Rows({ rows, grouped }: { rows: PresentedField[]; grouped: boolean }) {
  return (
    <>
      {rows.map((f, i) => (
        <Fragment key={f.key}>
          {grouped && f.group && f.group !== rows[i - 1]?.group ? (
            <tr>
              <th scope="colgroup" colSpan={3} className="pt-3 pb-1 text-left text-xs font-semibold text-fg">
                {f.group}
              </th>
            </tr>
          ) : null}
          <tr className="border-b border-line last:border-0">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-muted">
              {f.label}
            </th>
            <td className={f.display.kind === "money" ? "py-1.5 pr-3 text-right text-fg nums" : "py-1.5 pr-3 text-right text-fg"}>
              <Value field={f} />
            </td>
            <td className="w-14 py-1.5 text-right">
              <Badge size="sm" tone={confidenceTone(f.confidence)}>
                {Math.round(f.confidence * 100)}%
              </Badge>
            </td>
          </tr>
        </Fragment>
      ))}
    </>
  );
}

function FieldTable({ rows, grouped, caption }: { rows: PresentedField[]; grouped: boolean; caption: string }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className="w-[55%]" />
        <col />
        <col className="w-16" />
      </colgroup>
      <thead className="sr-only">
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Value</th>
          <th scope="col">Confidence</th>
        </tr>
      </thead>
      <tbody>
        <Rows rows={rows} grouped={grouped} />
      </tbody>
    </table>
  );
}

/** The fields read from one document in reviewer words, with the reader's confidence; bookkeeping fields fold away. */
export function DocumentFields({ fields, filename }: { fields: readonly StoredField[]; filename: string }) {
  const { primary, internal, grouped } = presentFields(fields);
  if (primary.length === 0 && internal.length === 0) return <p className="text-fg-muted">No fields could be read from this file.</p>;
  return (
    <div className="space-y-2">
      {primary.length > 0 ? <FieldTable rows={primary} grouped={grouped} caption={`Fields read from ${filename}`} /> : null}
      {internal.length > 0 ? (
        <Disclosure summary={`Show all fields (${internal.length} more)`} variant="plain">
          <FieldTable rows={internal} grouped={grouped} caption={`Other fields read from ${filename}`} />
        </Disclosure>
      ) : null}
    </div>
  );
}
