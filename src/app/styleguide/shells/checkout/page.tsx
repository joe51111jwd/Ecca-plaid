import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Alert, Banner, Button, Card, Field, Fieldset, FormActions, Input, LegalNote, LineItems, Money, MoneyInput, OrgMark, ProvisionalBadge, RadioGroup, Stepper } from "@/components/ui";
import { CREDIT_CAP_PER_TAXPAYER_CENTS, renderCopy } from "@/taxmath";
import { SAMPLE_SGO } from "../../_data";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — donor checkout" };

/**
 * LAYOUT sample for the donor checkout: FocusShell with the `aside` slot. Every sentence about the credit is
 * rendered from the tax copy catalog (src/taxmath/copy) and the cap comes from its constants — a page never
 * writes tax copy of its own. The real panel is built from previewCredit(); this only shows where it goes.
 */
export default function CheckoutShellDemo() {
  const cap = CREDIT_CAP_PER_TAXPAYER_CENTS.value;
  return (
    <FocusShell
      banner={<Banner tone="sandbox">{renderCopy("eligibility.sandbox_mode")}</Banner>}
      progress={
        <Stepper
          current="amount"
          steps={[
            { id: "amount", label: "Amount" },
            { id: "details", label: "Your details" },
            { id: "payment", label: "Payment" },
            { id: "receipt", label: "Receipt" },
          ]}
        />
      }
      back={{ href: "/styleguide/shells", label: "Choose a different organization" }}
      secureNote="donor"
      aside={
        <Card padding="none">
          <div className="border-b border-line px-5 py-4">
            <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{renderCopy("panel.title")}</p>
            <p className="mt-2">
              <Money cents={cap} variant="display" />
            </p>
            <p className="mt-1 text-sm text-fg-muted">{renderCopy("line.estimated_credit")}</p>
          </div>
          <div className="px-5 py-4">
            <LineItems label={renderCopy("panel.title")} items={[{ label: renderCopy("line.designated"), amountCents: cap }]} />
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-fg-muted">
              <li>{renderCopy("note.cap_per_taxpayer")}</li>
              <li>{renderCopy("note.nonrefundable")}</li>
              <li>{renderCopy("note.carryforward")}</li>
            </ul>
            <LegalNote className="mt-4">
              <p>{renderCopy("note.preview_not_tax_advice")}</p>
            </LegalNote>
          </div>
        </Card>
      }
    >
      <div className="flex items-center gap-3">
        <OrgMark name={SAMPLE_SGO.name} size="lg" />
        <div className="min-w-0">
          <p className="text-sm text-fg-muted">You are giving to</p>
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-fg">
            {SAMPLE_SGO.name} <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge>
          </p>
        </div>
      </div>
      <h1 className="mt-6 font-display text-display-sm text-fg">How much would you like to give?</h1>
      <form className="mt-6 space-y-6">
        <Field label="Gift amount">
          <MoneyInput name="amountCents" size="lg" defaultValueCents={cap} />
        </Field>
        <Fieldset label="Filing status" hint="As you expect to file for the year of the gift.">
          <RadioGroup
            name="filingStatus"
            variant="cards"
            columns={2}
            defaultValue="single"
            options={[
              { value: "single", label: "Single" },
              { value: "married_joint", label: "Married filing jointly" },
              { value: "married_separate", label: "Married filing separately" },
              { value: "head_of_household", label: "Head of household" },
            ]}
          />
        </Fieldset>
        <Field label="Email" hint="For your receipt and acknowledgment.">
          <Input type="email" name="email" autoComplete="email" inputMode="email" defaultValue="maria.alvarez@example.com" />
        </Field>
        <Alert tone="neutral">
          <p>{renderCopy("notice.no_earmark")}</p>
        </Alert>
        <FormActions align="start">
          <Button size="lg" href="/styleguide/shells">
            Continue
          </Button>
        </FormActions>
      </form>
    </FocusShell>
  );
}
