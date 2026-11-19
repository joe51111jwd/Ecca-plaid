import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Alert, Field, Input, PageHeader, Select, TextLink } from "@/components/ui";
import { ActionForm } from "@/features/handoff/components/ActionForm";
import { PORTAL_HOME } from "@/features/handoff/policy";
import { VENDOR_TYPES, vendorTypeLabel } from "@/server/businesses";
import { getPrimaryOrg, requireUser } from "@/server/auth";
import { signupAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up your business · Business portal", robots: { index: false, follow: false } };

/**
 * /partner/signup — a signed-in person sets up their camp, school or other business and becomes its owner. Success
 * fees are commercial terms set by the platform, not here; families never pay.
 */
export default async function SignupPage() {
  const user = await requireUser({ returnTo: `${PORTAL_HOME}/signup` });
  const existing = await getPrimaryOrg(user, "business");

  return (
    <FocusShell width="lg" secureNote={false}>
      <PageHeader
        variant="display"
        title="Offer scholarships at checkout"
        description="Set up your business to add a “Pay with a scholarship” button to your booking checkout. Families verify their income with a partner scholarship organization while you hold their spot."
      />
      {existing ? (
        <Alert tone="info" className="mt-6">
          You already belong to {existing.org.name}. <TextLink href={PORTAL_HOME}>Go to its portal</TextLink>, or set up another business below.
        </Alert>
      ) : null}
      <div className="mt-8">
        <ActionForm action={signupAction} submitLabel="Set up my business" submitSize="lg" fieldLabels={{ name: "Business name", vendorType: "Kind of business", website: "Website", billingEmail: "Billing email" }}>
          <Field label="Business name">
            <Input name="name" required maxLength={200} autoComplete="organization" />
          </Field>
          <Field label="Kind of business" hint="Which providers qualify is still being defined under the proposed rules; you can change this later.">
            <Select name="vendorType" placeholder="Choose one" required>
              {VENDOR_TYPES.map((v) => (
                <option key={v} value={v}>
                  {vendorTypeLabel(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Website" optional>
            <Input name="website" type="url" placeholder="https://www.camp.example.org" autoComplete="url" />
          </Field>
          <Field label="Billing email" hint="Invoices for your success fees go here. Families are never charged.">
            <Input name="billingEmail" type="email" required defaultValue={user.email} autoComplete="email" />
          </Field>
          <p className="text-sm text-fg-muted">You will be the owner, signed in as {user.email}.</p>
        </ActionForm>
      </div>
    </FocusShell>
  );
}
