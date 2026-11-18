import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Alert, Banner, Button, Card, Field, Fieldset, FormActions, Input, LegalNote, LineItems, Money, MoneyInput, OrgMark, ProvisionalBadge, RadioGroup, Stepper } from "@/components/ui";
import { SAMPLE_SGO } from "../../_data";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — donor checkout" };

/**
 * LAYOUT sample for the donor checkout. The sentences about the credit here are limited to the build spec's
 * own wording and exist only to show where the panel goes; the real panel takes every number and sentence
 * from src/taxmath.
 */
export default function CheckoutShellDemo() {
  return (
    <FocusShell
      banner={<Banner tone="sandbox">Sandbox — no money moves. Gifts made here are not eligible for the credit.</Banner>}
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
            <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Credit preview</p>
            <p className="mt-2">
              <Money cents={170_000} variant="display" />
            </p>
            <p className="mt-1 text-sm text-fg-muted">Preview for this gift, before the limits below.</p>
          </div>
          <div className="px-5 py-4">
            <LineItems
              label="Preview"
              items={[
                { label: "Your gift", amountCents: 170_000 },
                { label: "Federal credit cap per taxpayer", amountCents: 170_000, emphasis: "muted" },
                { label: "Expected state tax credit", amountCents: 0, emphasis: "muted", hint: "Reduces the federal credit." },
              ]}
            />
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
              <li>Nonrefundable: it cannot be more than your federal income tax for the year.</li>
              <li>Unused credit may be carried forward for up to five years.</li>
            </ul>
            <LegalNote title="Preview, not tax advice" className="mt-4">
              <p>Sample layout. The real panel’s wording comes from the tax copy module.</p>
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
        <Field label="Gift amount" hint="The federal credit is capped at $1,700 per taxpayer.">
          <MoneyInput name="amountCents" size="lg" defaultValueCents={170_000} />
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
          <p>A gift cannot be earmarked for a named student.</p>
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
