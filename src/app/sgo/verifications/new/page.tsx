import type { Metadata } from "next";
import { Card, Checkbox, Field, Input, LegalNote, PageHeader, Select } from "@/components/ui";
import { SgoActionForm } from "@/features/sgo/components/SgoActionForm";
import { SGO_PATHS } from "@/features/sgo/nav";
import { REVIEW_ROLE } from "@/features/sgo/policy";
import { requireSgoPage } from "@/features/sgo/server/context";
import { createVerificationAction } from "../../_actions";

export const metadata: Metadata = { title: "New verification" };

/**
 * The no-integration path: create a verification in the dashboard and send the family the link (copy it, or have
 * it emailed). Reviewers and above.
 */
export default async function NewVerificationPage() {
  const ctx = await requireSgoPage(SGO_PATHS.newVerification, REVIEW_ROLE);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New verification"
        back={{ href: SGO_PATHS.verifications, label: "Verifications" }}
        description={`Creates a ${ctx.mode === "test" ? "test" : "live"} verification and a family link. The family opens the link, gives consent, describes the household and sends proof of income; you see the result here.`}
      />
      <Card>
        <SgoActionForm
          action={createVerificationAction}
          orgId={ctx.org.id}
          mode={ctx.mode}
          submitLabel="Create verification"
          pendingText="Creating…"
          resetOnSuccess
          fieldLabels={{ applicantEmail: "Family's email", applicantName: "Applicant name", externalRef: "Your reference" }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Applicant name" optional hint="The parent or guardian who applied.">
              <Input name="applicantName" autoComplete="off" maxLength={200} />
            </Field>
            <Field label="Family's email" optional hint="Needed only to email the link.">
              <Input name="applicantEmail" type="email" autoComplete="off" maxLength={320} />
            </Field>
            <Field label="Student first name" optional>
              <Input name="studentFirstName" autoComplete="off" maxLength={100} />
            </Field>
            <Field label="Student last name" optional>
              <Input name="studentLastName" autoComplete="off" maxLength={100} />
            </Field>
            <Field label="Your reference" optional hint="Your own application or applicant id, to find it later.">
              <Input name="externalRef" autoComplete="off" maxLength={200} />
            </Field>
            <Field label="Language of the family's screens and email">
              <Select name="locale" defaultValue="en">
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </Select>
            </Field>
          </div>
          <Checkbox name="sendInvite" label="Email the link to the family" description="Otherwise copy the link after creating it and send it yourself." />
          <LegalNote>
            A verification checks household income only. It is not an award: offering a scholarship is a separate decision your organization makes on the verification&apos;s page.
          </LegalNote>
        </SgoActionForm>
      </Card>
    </div>
  );
}
