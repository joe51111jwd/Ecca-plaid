import { CircleCheck, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, Badge, Disclosure, KeyValueList, LineItems } from "@/components/ui";
import type { ReceiptSummary } from "./view-model";

export interface ReceiptViewProps {
  receipt: ReceiptSummary;
  /** The payment went through but the gift is still being recorded (seconds, normally). */
  finishing?: boolean;
  /** Buttons under the receipt ("My gifts", "Give again"). */
  actions?: ReactNode;
}

/**
 * The confirmation page's receipt summary: what was paid, line by line, the designation words as confirmed, that
 * this is not the official acknowledgment, and what to keep for Form 8525. Every tax sentence is the registry's.
 */
export function ReceiptView({ receipt, finishing, actions }: ReceiptViewProps) {
  return (
    <div className="space-y-6" data-testid="receipt" data-sandbox={receipt.sandbox || undefined}>
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-medium text-success-fg">
          <CircleCheck aria-hidden="true" className="size-5" />
          {receipt.sandbox ? "Sandbox gift complete" : "Thank you. Your gift is complete."}
        </p>
        <h1 className="text-2xl font-semibold text-fg">Receipt for your gift to {receipt.sgo.name}</h1>
        {receipt.sandbox ? (
          <Badge tone="caution" size="sm">
            Sandbox
          </Badge>
        ) : null}
      </header>

      {finishing ? (
        <Alert tone="info" role="status" title="Recording your gift">
          <p>Your payment went through. This page updates in a moment with the recorded gift.</p>
        </Alert>
      ) : null}

      <div className="space-y-2" data-testid="receipt-notes">
        {receipt.receiptNotes.map((n) => (
          <p key={n.id} data-copy-id={n.id} className={n.id === "receipt.not_official_acknowledgment" ? "rounded-card border border-line bg-sunken p-4 text-base font-medium text-fg" : "text-sm text-fg-muted"}>
            {n.text}
          </p>
        ))}
      </div>

      <LineItems
        label="What you paid"
        showCents
        items={receipt.lines.map((l) => ({ label: l.label, amountCents: l.amountCents, hint: l.hint ?? undefined }))}
        total={{ label: receipt.sandbox ? "Total (sandbox, not charged)" : "Total charged", amountCents: receipt.totalCents }}
      />

      <KeyValueList
        items={[
          { label: "Organization", value: receipt.sgo.ein ? `${receipt.sgo.name} (EIN ${receipt.sgo.ein})` : receipt.sgo.name },
          ...receipt.contributors.map((c, i) => ({
            label: receipt.contributors.length > 1 ? `Donor ${i + 1}` : "Donor",
            value: [c.name ?? "", c.email ? `· ${c.email}` : "", c.eDelivery ? "· acknowledgment by email" : "· acknowledgment by mail"].filter(Boolean).join(" "),
          })),
          ...(receipt.paymentId ? [{ label: "Payment reference", value: <span className="font-mono text-sm">{receipt.paymentId}</span> }] : []),
        ]}
      />

      {receipt.designationText ? (
        <blockquote className="border-l-4 border-brand-700 pl-4 text-sm text-fg" data-testid="receipt-designation">
          {receipt.designationText}
        </blockquote>
      ) : null}

      {receipt.outcome ? (
        <div className={receipt.outcome.creditEligible ? "rounded-card border border-success-line bg-success-surface p-4 text-success-fg" : "rounded-card border border-warning-line bg-warning-surface p-4 text-warning-fg"} data-testid="receipt-outcome" data-eligible={receipt.outcome.creditEligible}>
          <p className="font-semibold" data-copy-id={receipt.outcome.headline.id}>
            {receipt.outcome.headline.text}
          </p>
          {receipt.outcome.reasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {receipt.outcome.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Your emailed receipt is the full record of this gift. Signed-in donors also find it under My gifts.</p>
      )}

      <Disclosure
        id="receipt-keep"
        summary={
          <span className="flex items-center gap-2">
            <FileText aria-hidden="true" className="size-5 text-fg-muted" />
            What to keep for your tax return
          </span>
        }
      >
        <div className="space-y-2" data-testid="receipt-keep">
          {receipt.keep.map((k) => (
            <p key={k.id} data-copy-id={k.id} className="text-sm leading-6 text-fg-muted">
              {k.text}
            </p>
          ))}
        </div>
      </Disclosure>

      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
