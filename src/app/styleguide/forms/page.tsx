import { AtSign, MapPin, Search } from "lucide-react";
import type { Metadata } from "next";
import { Alert, Badge, Button, Checkbox, CheckboxGroup, DateInput, DefinitionTooltip, Field, Fieldset, FormActions, FormError, Input, MoneyInput, OtpInput, RadioGroup, Select, Switch, TextLink, Textarea } from "@/components/ui";
import { DateInputDemo, FileDropzoneDemo, MoneyInputDemo, OtpInputDemo, PathChoiceDemo, ServerFormDemo, StaticDropzoneDemo } from "../_demos";
import { C, DoDont, Example, GUIDE_METADATA, GuideChrome, GuideSection, Row, Specimen } from "../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Style guide — Forms" };

const TOC = [
  { id: "field", label: "Field · Fieldset" },
  { id: "input", label: "Input" },
  { id: "textarea", label: "Textarea" },
  { id: "select", label: "Select" },
  { id: "checkbox", label: "Checkbox · CheckboxGroup" },
  { id: "switch", label: "Switch" },
  { id: "radio", label: "RadioGroup" },
  { id: "money-input", label: "MoneyInput" },
  { id: "date-input", label: "DateInput" },
  { id: "otp-input", label: "OtpInput" },
  { id: "file-dropzone", label: "FileDropzone" },
  { id: "server-form", label: "Forms with server actions" },
];

const FILING_STATUS = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married filing jointly", description: "Each spouse can be associated with a contribution." },
  { value: "married_separate", label: "Married filing separately" },
  { value: "head_of_household", label: "Head of household" },
  { value: "qualifying_surviving_spouse", label: "Qualifying surviving spouse" },
];

export default function StyleGuideForms() {
  return (
    <GuideChrome
      title="Forms"
      lead={
        <p>
          Every control goes inside a <C>Field</C> (one input) or a <C>Fieldset</C> (one question, several inputs). They wire the label, hint and error to the control for you. Controls work in plain forms with server actions:
          composite controls submit through a hidden field named by <C>name</C>.
        </p>
      }
      toc={TOC}
    >
      <GuideSection id="anatomy" title="Anatomy">
        <Specimen
          id="field"
          name="Field · Fieldset"
          importLine='import { Field, Fieldset } from "@/components/ui"'
          note={
            <p>
              <C>Field</C> renders label → hint → control → error and injects <C>id</C>, <C>aria-labelledby</C>, <C>aria-describedby</C>, <C>aria-invalid</C> and <C>required</C> into its child. Use <C>Fieldset</C> (fieldset/legend)
              for RadioGroup, DateInput, OtpInput and CheckboxGroup. When the control needs a wrapper, pass a function: <C>{"{(control) => <div><Input {...control} /></div>}"}</C>.
            </p>
          }
        >
          <Example label="Label only · with hint · required · optional · label action">
            <div className="grid max-w-3xl gap-6 md:grid-cols-2">
              <Field label="First name">
                <Input name="firstName" autoComplete="given-name" defaultValue="Maria" />
              </Field>
              <Field label="Email" hint="We send a sign-in link here. No password.">
                <Input type="email" name="email" autoComplete="email" inputMode="email" placeholder="name@example.com" />
              </Field>
              <Field label="Legal name of the organization" required>
                <Input name="legalName" />
              </Field>
              <Field label="Apartment or unit" optional>
                <Input name="unit" autoComplete="address-line2" />
              </Field>
              <Field label="Household size" labelAction={<DefinitionTooltip term="household" definition="The student and everyone who lives with the student.">Who counts?</DefinitionTooltip>}>
                <Select name="householdSize" defaultValue="4">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Search applicants" hideLabel>
                <Input type="search" name="q" placeholder="Search applicants (label hidden, still announced)" leading={<Search />} />
              </Field>
            </div>
          </Example>
          <Example label="Error — the control turns red-bordered and the message is announced with it">
            <div className="grid max-w-3xl gap-6 md:grid-cols-2">
              <Field label="ZIP code" hint="Five digits." error="Enter a Texas ZIP code, like 77002.">
                <Input name="zip" inputMode="numeric" autoComplete="postal-code" defaultValue="7700" leading={<MapPin />} />
              </Field>
              <Fieldset label="Student’s date of birth" error="Enter a real date. February has 28 days in 2015.">
                <DateInput name="dobError" defaultValue={null} />
              </Fieldset>
            </div>
          </Example>
          <Example label="Guidance">
            <DoDont
              dos={[
                "Write the label as the thing to enter (“Email”), the hint as how to enter it, the error as how to fix it.",
                "Set autoComplete and inputMode on every personal field — it is the cheapest accessibility win on a phone.",
                "In family flows mark the few optional fields with `optional`; in dashboards mark required ones with `required`.",
              ]}
              donts={["Don’t use a placeholder as the label. Placeholders vanish and fail contrast.", "Don’t validate while the person is still typing; validate on submit in the server action.", "Don’t wrap RadioGroup or DateInput in Field — use Fieldset."]}
            />
          </Example>
        </Specimen>
      </GuideSection>

      <GuideSection id="controls" title="Controls">
        <Specimen id="input" name="Input" importLine='import { Input } from "@/components/ui"' note={<p>Single-line text. Takes every native input attribute. <C>leading</C>/<C>trailing</C> put a decorative icon or unit inside the box.</p>}>
          <Example label="Sizes — sm · md · lg">
            <div className="grid max-w-3xl gap-4 md:grid-cols-3">
              <Field label="Small (dashboards)">
                <Input size="sm" defaultValue="APP-1042" />
              </Field>
              <Field label="Medium (default)">
                <Input defaultValue="Maria Alvarez" />
              </Field>
              <Field label="Large">
                <Input size="lg" defaultValue="Harris County" />
              </Field>
            </div>
          </Example>
          <Example label="Adornments · placeholder · disabled · read-only · invalid">
            <div className="grid max-w-3xl gap-4 md:grid-cols-2">
              <Field label="Billing email">
                <Input type="email" leading={<AtSign />} defaultValue="billing@campcedarcreek.example" />
              </Field>
              <Field label="Success fee (basis points)">
                <Input inputMode="numeric" trailing="bps" placeholder="0" />
              </Field>
              <Field label="Organization id" hint="Disabled: not editable and not submitted.">
                <Input disabled defaultValue="org_4Ke8HtP3" />
              </Field>
              <Field label="County" hint="Read-only: submitted, but set from the address.">
                <Input readOnly defaultValue="Harris County" />
              </Field>
              <Field label="EIN">
                <Input invalid defaultValue="00-000" />
              </Field>
            </div>
          </Example>
        </Specimen>

        <Specimen id="textarea" name="Textarea" importLine='import { Textarea } from "@/components/ui"' note={<p>Multi-line text. Resizes vertically.</p>}>
          <Example label="Default · disabled">
            <div className="grid max-w-3xl gap-4 md:grid-cols-2">
              <Field label="Note for the reviewer" hint="Visible to your team only." optional>
                <Textarea name="note" defaultValue="Second W-2 is from a job that ended in March." />
              </Field>
              <Field label="Resolution notes">
                <Textarea disabled defaultValue="Resolved by Daniel Okafor." />
              </Field>
            </div>
          </Example>
        </Specimen>

        <Specimen id="select" name="Select" importLine='import { Select } from "@/components/ui"' note={<p>The native select, styled. Native on purpose: it is the most reliable picker on phones and with assistive technology. Use RadioGroup when there are five or fewer options and room to show them.</p>}>
          <Example label="With placeholder · sizes · disabled · invalid">
            <div className="grid max-w-3xl gap-4 md:grid-cols-2">
              <Field label="County">
                <Select name="county" placeholder="Choose a county">
                  <option value="48201">Harris County</option>
                  <option value="48157">Fort Bend County</option>
                  <option value="48339">Montgomery County</option>
                </Select>
              </Field>
              <Field label="Rows per page">
                <Select size="sm" defaultValue="25">
                  <option>25</option>
                  <option>50</option>
                  <option>100</option>
                </Select>
              </Field>
              <Field label="Vendor type">
                <Select disabled defaultValue="summer_camp">
                  <option value="summer_camp">Summer camp</option>
                </Select>
              </Field>
              <Field label="Benefit program" error="Choose the program named on the letter.">
                <Select name="program" placeholder="Choose a program">
                  <option>SNAP</option>
                  <option>TANF</option>
                  <option>WIC</option>
                  <option>Section 8</option>
                  <option>SSI</option>
                </Select>
              </Field>
            </div>
          </Example>
        </Specimen>

        <Specimen id="checkbox" name="Checkbox · CheckboxGroup" importLine='import { Checkbox, CheckboxGroup } from "@/components/ui"' note={<p>A labelled checkbox; the whole row is the target. <C>variant=&quot;card&quot;</C> for a consent or designation the person must actively tick. Put several in <C>{"<Fieldset><CheckboxGroup>"}</C>.</p>}>
          <Example label="Plain · with description · checked · disabled · error">
            <div className="grid max-w-3xl gap-x-8 gap-y-2 md:grid-cols-2">
              <Checkbox name="remember" label="Email me when there is a result" />
              <Checkbox name="spanish" label="Send emails in Spanish" description="You can change this later." defaultChecked />
              <Checkbox name="locked" label="Accepts applicants from handoffs" disabled defaultChecked />
              <Checkbox name="individual" label="I am giving as an individual" error="Confirm this to continue." />
            </div>
          </Example>
          <Example label="Card — consent and designation">
            <div className="max-w-2xl space-y-3">
              <Checkbox variant="card" name="consent" label="I agree to share my income verification result" description="Recipient, purpose and duration are stated above this box on the real screen. The exact words come from the consent copy module." />
              <Checkbox variant="card" name="designate" defaultChecked label="Designation checkbox (checked)" description="The words of a tax designation always come from src/taxmath/copy, never from a component." />
              <Checkbox variant="card" name="noEarmark" label="Card with an error" error="Tick the box to continue." />
            </div>
          </Example>
          <Example label="A set of checkboxes in a Fieldset">
            <Fieldset label="Which documents do you have?" hint="Choose all that apply." className="max-w-md">
              <CheckboxGroup>
                <Checkbox name="docs" value="award_letter" label="A benefits award letter" />
                <Checkbox name="docs" value="tax_return" label="Last year’s tax return" defaultChecked />
                <Checkbox name="docs" value="w2" label="W-2s" />
                <Checkbox name="docs" value="pay_stub" label="Pay stubs" />
              </CheckboxGroup>
            </Fieldset>
          </Example>
        </Specimen>

        <Specimen id="switch" name="Switch" importLine='import { Switch } from "@/components/ui"' note={<p>An on/off setting (not a form answer). A native checkbox with <C>role=&quot;switch&quot;</C>, so it submits without script. Use Checkbox for agreements.</p>}>
          <Example label="Start-aligned · end-aligned in a settings list · disabled">
            <div className="grid max-w-3xl gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Switch name="acceptsDonations" label="Accept donations" description="Show this organization on the giving page." defaultChecked />
                <Switch name="acceptsHandoffs" label="Accept handoff applicants" />
                <Switch name="irs" label="Registered in the IRS SGO portal" disabled />
              </div>
              <div className="divide-y divide-line rounded-card border border-line px-4">
                <Switch align="end" className="py-3" name="notifyReview" label="Email me about reviews" description="When a verification needs a person." defaultChecked />
                <Switch align="end" className="py-3" name="notifyDecided" label="Email me about decisions" />
              </div>
            </div>
          </Example>
        </Specimen>

        <Specimen
          id="radio"
          name="RadioGroup"
          importLine='import { RadioGroup, type RadioOption } from "@/components/ui"'
          note={
            <p>
              One choice from a few. <C>variant=&quot;cards&quot;</C> for a decision with consequences — the upload-or-auto-submit choice, filing status. Server pages use <C>defaultValue</C>; client components may control it with{" "}
              <C>value</C>/<C>onChange</C>. Always inside a <C>Fieldset</C>.
            </p>
          }
        >
          <Example label="Cards — upload or auto-submit (controlled)">
            <PathChoiceDemo />
          </Example>
          <Example label="Cards — filing status, two columns (uncontrolled, defaultValue)">
            <Fieldset label="Filing status" hint="As you expect to file for the year of the gift." className="max-w-2xl">
              <RadioGroup name="filingStatus" variant="cards" columns={2} defaultValue="married_joint" options={FILING_STATUS} />
            </Fieldset>
          </Example>
          <Example label="List · with descriptions · a disabled option · error">
            <div className="grid max-w-3xl gap-8 md:grid-cols-2">
              <Fieldset label="Does the student live in more than one home?">
                <RadioGroup
                  name="custody"
                  defaultValue="no"
                  options={[
                    { value: "no", label: "No" },
                    { value: "yes", label: "Yes", description: "We will ask how the student’s time is split." },
                    { value: "unsure", label: "I’m not sure", description: "A person will follow up.", disabled: true },
                  ]}
                />
              </Fieldset>
              <Fieldset label="Preferred language" error="Choose a language.">
                <RadioGroup
                  name="locale"
                  options={[
                    { value: "en", label: "English" },
                    { value: "es", label: "Español" },
                  ]}
                />
              </Fieldset>
            </div>
          </Example>
        </Specimen>

        <Specimen id="money-input" name="MoneyInput" importLine='import { MoneyInput, parseMoneyText, formatMoneyText } from "@/components/ui"' note={<p>Dollar amounts. Shows grouped dollars, emits <strong>integer cents</strong> through <C>onValueChange</C> and through a hidden field called <C>name</C>, and opens the numeric keypad with a decimal key on phones. Never does float arithmetic.</p>}>
          <Example label="Controlled, with the emitted value">
            <MoneyInputDemo />
          </Example>
          <Example label="Whole dollars only · sizes · error · disabled">
            <div className="grid max-w-3xl gap-4 md:grid-cols-2">
              <Field label="Expected state tax credit" hint="Whole dollars. Enter 0 if none.">
                <MoneyInput name="stateCreditCents" allowCents={false} defaultValueCents={0} />
              </Field>
              <Field label="Booking amount (large)">
                <MoneyInput name="bookingCents" size="lg" defaultValueCents={42_500} />
              </Field>
              <Field label="Gift amount" error="Enter an amount of at least $1.">
                <MoneyInput name="giftCents" />
              </Field>
              <Field label="Flat success fee">
                <MoneyInput name="feeCents" disabled defaultValueCents={0} />
              </Field>
            </div>
          </Example>
        </Specimen>

        <Specimen id="date-input" name="DateInput" importLine='import { DateInput, checkDateParts } from "@/components/ui"' note={<p>Month, day and year as three labelled fields — never a calendar popup. Submits <C>YYYY-MM-DD</C> through the hidden field <C>name</C> (empty while incomplete or not a real date). <C>min</C>/<C>max</C> bound it. No auto-advance between fields, by design.</p>}>
          <Example label="Controlled, with the emitted value">
            <DateInputDemo />
          </Example>
          <Example label="Spanish labels · large · disabled">
            <div className="grid max-w-3xl gap-8 md:grid-cols-2">
              <Fieldset label="Fecha de nacimiento del estudiante" locale="es">
                <DateInput name="dobEs" locale="es" />
              </Fieldset>
              <Fieldset label="Award letter date">
                <DateInput name="awardDate" defaultValue="2026-09-30" disabled />
              </Fieldset>
            </div>
          </Example>
        </Specimen>

        <Specimen id="otp-input" name="OtpInput" importLine='import { OtpInput } from "@/components/ui"' note={<p>The six-digit sign-in code. One box per digit, auto-advance, Backspace walks back, arrows move, paste and SMS/email autofill fill every box. <C>autoSubmit</C> submits the surrounding form on the last digit. Submits one string through the hidden field <C>name</C>.</p>}>
          <Example label="Controlled — type, paste “482 913”, use Backspace">
            <OtpInputDemo />
          </Example>
          <Example label="Error · disabled">
            <div className="grid max-w-3xl gap-8 md:grid-cols-2">
              <Fieldset label="Enter the 6-digit code" error="That code didn’t match. Check the newest email and try again.">
                <OtpInput name="codeError" defaultValue="482913" />
              </Fieldset>
              <Fieldset label="Enter the 6-digit code">
                <OtpInput name="codeDisabled" defaultValue="48" disabled />
              </Fieldset>
            </div>
          </Example>
        </Specimen>

        <Specimen
          id="file-dropzone"
          name="FileDropzone"
          importLine='import { FileDropzone, partitionFiles, type DropzoneFile } from "@/components/ui"'
          note={
            <p>
              Drag and drop, choose files, or — on a phone — take a photo. <strong>Presentational only:</strong> it never uploads. You upload in <C>onFilesAdded</C> and feed each file’s status back through <C>files</C>.{" "}
              <C>accept</C>, <C>maxSizeBytes</C> and <C>maxFiles</C> are checked for the person’s convenience (<C>onFilesRejected</C> tells you why); the server must enforce them again.
            </p>
          }
        >
          <Example label="Interactive — done, uploading and failed rows; add a file to watch a simulated upload">
            <FileDropzoneDemo />
          </Example>
          <Example label="Empty · disabled · Spanish · inside a Field with an error">
            <div className="grid gap-6 lg:grid-cols-2">
              <StaticDropzoneDemo hint="PDF, JPG or PNG, up to 15 MB each." disabled />
              <Field label="Carta de beneficios" error="Suba al menos un documento." locale="es">
                <StaticDropzoneDemo locale="es" capture hint="PDF, JPG o PNG, hasta 15 MB cada uno." />
              </Field>
            </div>
          </Example>
        </Specimen>
      </GuideSection>

      <GuideSection id="patterns" title="Patterns">
        <Specimen
          id="server-form"
          name="Forms with server actions"
          importLine='import { FormError, SubmitButton, FormActions, fieldError } from "@/components/ui"'
          note={
            <div className="space-y-2">
              <p>
                The standard form: a server action that returns <C>ActionResult</C> (from <C>@/lib/errors</C>), <C>useActionState</C> in a small client component, <C>FormError</C> at the top, <C>fieldError(state, name)</C> on each
                Field, and <C>SubmitButton</C> for the pending state. Source: <C>src/app/styleguide/_demos.tsx</C> (ServerFormDemo) and <C>_actions.ts</C>.
              </p>
              <p>
                After an action returns, React resets <em>uncontrolled</em> native inputs. Either control them (as the demo does) or have the action return the submitted values and pass them to <C>defaultValue</C>. MoneyInput,
                DateInput and OtpInput keep their own state.
              </p>
            </div>
          }
        >
          <Example label="Live — submit it empty, then fix the fields">
            <ServerFormDemo />
          </Example>
          <Example label="FormError — static rendering of the summary">
            <FormError
              className="max-w-lg"
              focusOnError={false}
              message="Check the highlighted answers and try again."
              fields={{ email: "Enter an email address, like name@example.com.", dob: "Enter the full date of birth, with a four-digit year." }}
              fieldLabels={{ email: "Email", dob: "Date of birth" }}
              fieldIds={{ email: "demo-email", dob: "demo-dob" }}
            />
          </Example>
          <Example label="FormActions — align start (step flows), end (dialogs, dashboards), between">
            <div className="max-w-2xl space-y-5">
              <FormActions align="start">
                <Button size="lg">Continue</Button>
                <Button size="lg" variant="ghost">
                  Save and finish later
                </Button>
              </FormActions>
              <FormActions>
                <Button variant="secondary">Cancel</Button>
                <Button>Save changes</Button>
              </FormActions>
              <FormActions align="between">
                <Button variant="ghost">Back</Button>
                <Button>Continue to payment</Button>
              </FormActions>
            </div>
          </Example>
          <Example label="A complete family step in touch density (what FocusShell gives you)" surface="canvas">
            <div data-density="touch" className="mx-auto max-w-focus rounded-panel border border-line bg-surface p-5 shadow-sm sm:p-8">
              <h3 className="font-display text-display-sm text-fg">Where do you live?</h3>
              <p className="mt-2 text-base text-fg-muted">We use your address to find the income limit for your area.</p>
              <form className="mt-6 space-y-5">
                <Field label="Street address">
                  <Input name="addressLine1" autoComplete="address-line1" defaultValue="1200 Sample Street" />
                </Field>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4">
                  <Field label="City">
                    <Input name="city" autoComplete="address-level2" defaultValue="Houston" />
                  </Field>
                  <Field label="ZIP code">
                    <Input name="zip" autoComplete="postal-code" inputMode="numeric" defaultValue="77002" />
                  </Field>
                </div>
                <Alert tone="info">
                  <p>
                    This ZIP code is in <strong className="font-semibold">Harris County</strong>. <TextLink href="/styleguide/forms#server-form">Not right?</TextLink>
                  </p>
                </Alert>
                <FormActions align="start">
                  <Button size="lg">Continue</Button>
                  <Button size="lg" variant="ghost">
                    Save and finish later
                  </Button>
                </FormActions>
              </form>
              <Row className="mt-6 border-t border-line pt-4">
                <Badge tone="neutral" size="sm">
                  Sample layout
                </Badge>
                <span className="text-sm text-fg-muted">Every control here is at least 44px tall.</span>
              </Row>
            </div>
          </Example>
        </Specimen>
      </GuideSection>
    </GuideChrome>
  );
}
