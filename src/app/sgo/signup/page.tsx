import type { Metadata } from "next";
import { FocusShell } from "@/components/layout";
import { Card, Checkbox, Field, Input, LegalNote, PageHeader, Select } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { requireUser } from "@/server/auth";
import { US_STATES } from "@/server/sgos";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { SGO_PATHS } from "@/features/sgo/nav";
import { optionalSgoContext } from "@/features/sgo/server/context";
import { signupAction } from "../_actions";

export const metadata: Metadata = { title: "Create your organization's workspace" };

/**
 * Self-serve creation of an SGO workspace. The signed-in person becomes its owner; the workspace starts in test mode
 * and stays there until a platform admin has verified the organization against the SGO list.
 */
export default async function SgoSignupPage() {
  const user = await requireUser({ returnTo: SGO_PATHS.signup });
  const existing = await optionalSgoContext();

  const form = (
    <div className="space-y-6">
      <PageHeader
        title={existing ? "Create another organization's workspace" : "Create your organization's workspace"}
        description={`Set up ${BRAND.name} for your scholarship granting organization. You (${user.email}) become its owner.`}
      />
      <Card>
        <SgoActionForm action={signupAction} orgId={null} submitLabel="Create workspace" pendingText="Creating…" fieldLabels={{ name: "Organization name", ein: "EIN", testModeUnderstood: "Test mode" }}>
          <Field label="Organization name">
            <Input name="name" maxLength={200} autoComplete="organization" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="EIN" optional hint="NN-NNNNNNN. Needed later for acknowledgments.">
              <Input name="ein" placeholder="12-3456789" maxLength={10} autoComplete="off" />
            </Field>
            <Field label="City" optional>
              <Input name="city" maxLength={100} />
            </Field>
            <Field label="State">
              <Select name="state" defaultValue="TX">
                {Object.entries(US_STATES).map(([code, s]) => (
                  <option key={code} value={code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Checkbox
            name="testModeUnderstood"
            variant="card"
            label="I understand the workspace starts in test mode"
            description="You can try every screen with sandbox data. Live mode opens once a platform admin has verified your organization against the SGO list; creating a workspace does not put you on any list."
          />
        </SgoActionForm>
      </Card>
      <LegalNote>The SGO list is provisional until the IRS publishes its list. Being on it is checked by a person at the platform, never by this form.</LegalNote>
    </div>
  );

  if (existing) return form;
  return (
    <FocusShell width="lg" homeHref="/">
      {form}
    </FocusShell>
  );
}
