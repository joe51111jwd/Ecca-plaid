"use client";

import { FileText, Landmark, Upload } from "lucide-react";
import { useActionState, useState } from "react";
import {
  Alert,
  Checkbox,
  DateInput,
  Field,
  Fieldset,
  Form,
  FormActions,
  FormError,
  Input,
  RadioGroup,
  Select,
  SubmitButton,
  Textarea,
  fieldError,
  type RadioOption,
} from "@/components/ui";
import type { MemberKind } from "@/db/schema";
import { getDictionary, type Locale } from "@/i18n";
import { addressAction, consentAction, countyAction, custodyAction, inviteAdultAction, memberAction, ownerAction, pathAction, reuseAction, signStatementAction, startAction, submitAction } from "../actions";
import { asksDateOfBirth, MEMBER_KIND_CHOICES, RELATIONSHIP_CHOICES, type RelationshipChoice } from "../form-data";
import { HiddenFields, type FlowFormFields } from "./hidden-fields";

/* ------------------------------------------------------------------------------------------ landing */

/** "Continue" for a person who is already signed in when they open the link. */
export function ContinueForm({ base, locale, label }: { base: string; locale: Locale; label: string }) {
  const [state, action, pending] = useActionState(startAction, null);
  const t = getDictionary(locale);
  return (
    <Form action={action} className="space-y-4">
      <HiddenFields values={{ base, lang: locale }} />
      <FormError state={state} locale={locale} title={t.errors.title} />
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {label}
      </SubmitButton>
    </Form>
  );
}

/* ---------------------------------------------------------------------------------------- passport */

export function ReuseForm({ fields, sourceId, consentSha }: { fields: FlowFormFields; sourceId: string; consentSha: string }) {
  const t = getDictionary(fields.lang);
  const [state, action, pending] = useActionState(reuseAction, null);
  return (
    <Form action={action} className="space-y-5">
      <HiddenFields values={{ ...fields, source: sourceId, sha: consentSha }} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldIds={{ attest: "attest" }} />
      <Checkbox id="attest" name="attest" variant="card" label={t.reuse.attestLabel} description={t.reuse.attestHint} error={fieldError(state, "attest")} />
      <SubmitButton pending={pending} pendingText={t.reuse.using} size="lg" fullWidth>
        {t.reuse.useButton}
      </SubmitButton>
    </Form>
  );
}

/* ----------------------------------------------------------------------------------------- consent */

/** The tick box and button under the consent text. The text itself is rendered verbatim by the screen. */
export function ConsentForm({ fields, checkboxLabel, sha }: { fields: FlowFormFields; checkboxLabel: string; sha: string }) {
  const t = getDictionary(fields.lang);
  const [state, action, pending] = useActionState(consentAction, null);
  return (
    <Form action={action} className="space-y-5">
      <HiddenFields values={{ ...fields, sha }} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldIds={{ agree: "agree" }} />
      {/* Never pre-ticked: the box is the written instruction. */}
      <Checkbox id="agree" name="agree" variant="card" label={checkboxLabel} error={fieldError(state, "agree")} />
      <SubmitButton pending={pending} pendingText={t.consent.agreeing} size="lg" fullWidth>
        {t.consent.agree}
      </SubmitButton>
    </Form>
  );
}

/* ----------------------------------------------------------------------------------------- address */

export interface AddressDefaults {
  line1: string;
  line2: string;
  city: string;
  zip: string;
}

export function AddressForm({ fields, defaults }: { fields: FlowFormFields; defaults: AddressDefaults }) {
  const t = getDictionary(fields.lang);
  const a = t.address;
  const [state, action, pending] = useActionState(addressAction, null);
  const err = (name: string) => fieldError(state, name);
  return (
    <Form action={action} noValidate className="space-y-5">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldLabels={{ line1: a.line1, city: a.city, zip: a.zip, state: a.state }} />
      <Field label={a.line1} error={err("line1")} id="line1" locale={fields.lang}>
        <Input name="line1" autoComplete="address-line1" defaultValue={defaults.line1} maxLength={200} />
      </Field>
      <Field label={a.line2} optional id="line2" locale={fields.lang}>
        <Input name="line2" autoComplete="address-line2" defaultValue={defaults.line2} maxLength={200} />
      </Field>
      <Field label={a.city} error={err("city")} id="city" locale={fields.lang}>
        <Input name="city" autoComplete="address-level2" defaultValue={defaults.city} maxLength={100} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={a.state} hint={a.texasOnly} error={err("state")} id="state" locale={fields.lang}>
          <Input name="stateDisplay" value={a.stateValue} readOnly aria-readonly="true" />
        </Field>
        <Field label={a.zip} error={err("zip")} id="zip" locale={fields.lang}>
          <Input name="zip" autoComplete="postal-code" inputMode="numeric" defaultValue={defaults.zip} maxLength={10} />
        </Field>
      </div>
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {a.save}
      </SubmitButton>
    </Form>
  );
}

/* ------------------------------------------------------------------------------------------ county */

export interface CountyChoice {
  fips: string;
  name: string;
  /** Share of the ZIP code's land in this county, already formatted ("62%"), when known. */
  share?: string;
}

export function CountyForm({ fields, candidates, allCounties, selected }: { fields: FlowFormFields; candidates: CountyChoice[]; allCounties: CountyChoice[]; selected: string | null }) {
  const t = getDictionary(fields.lang);
  const c = t.county;
  const [state, action, pending] = useActionState(countyAction, null);
  const showList = candidates.length > 0 && candidates.length < allCounties.length;
  const inCandidates = selected ? candidates.some((x) => x.fips === selected) : false;
  const [other, setOther] = useState(!showList || (selected !== null && !inCandidates));
  const [choice, setChoice] = useState<string>(selected && inCandidates ? selected : "");

  const options: RadioOption[] = candidates.map((x) => ({ value: x.fips, label: x.name, description: x.share ? c.share(x.share) : undefined }));
  options.push({ value: "__other", label: c.otherCounty });

  return (
    <Form action={action} className="space-y-5">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} />
      {showList ? (
        <Field label={c.legend} hint={c.help} as="group" error={fieldError(state, "fips")} locale={fields.lang} id="county">
          <RadioGroup
            name={other ? "candidate" : "fips"}
            options={options}
            value={other ? "__other" : choice}
            onChange={(value) => {
              setOther(value === "__other");
              if (value !== "__other") setChoice(value);
            }}
          />
        </Field>
      ) : null}
      {other ? (
        <Field label={c.allCountiesLabel} hint={showList ? undefined : c.help} error={showList ? undefined : fieldError(state, "fips")} locale={fields.lang} id="fips">
          <Select name="fips" defaultValue={selected ?? ""}>
            <option value="" disabled>
              {c.legend}
            </option>
            {allCounties.map((x) => (
              <option key={x.fips} value={x.fips}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {c.save}
      </SubmitButton>
    </Form>
  );
}

/* ------------------------------------------------------------------------------------------ people */

function relationshipOptions(locale: Locale, exclude: readonly RelationshipChoice[] = []) {
  const labels = getDictionary(locale).people.relationships;
  return RELATIONSHIP_CHOICES.filter((r) => !exclude.includes(r)).map((r) => (
    <option key={r} value={r}>
      {labels[r]}
    </option>
  ));
}

export function OwnerForm({ fields, defaults }: { fields: FlowFormFields; defaults: { firstName: string; lastName: string; relationship: string } }) {
  const t = getDictionary(fields.lang);
  const p = t.people;
  const [state, action, pending] = useActionState(ownerAction, null);
  const err = (name: string) => fieldError(state, name);
  return (
    <Form action={action} noValidate className="space-y-5">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldLabels={{ firstName: p.firstName, lastName: p.lastName, relationship: p.yourRelationship }} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={p.firstName} error={err("firstName")} id="firstName" locale={fields.lang}>
          <Input name="firstName" autoComplete="given-name" defaultValue={defaults.firstName} maxLength={60} />
        </Field>
        <Field label={p.lastName} error={err("lastName")} id="lastName" locale={fields.lang}>
          <Input name="lastName" autoComplete="family-name" defaultValue={defaults.lastName} maxLength={60} />
        </Field>
      </div>
      <Field label={p.yourRelationship} error={err("relationship")} id="relationship" locale={fields.lang}>
        <Select name="relationship" defaultValue={defaults.relationship || "parent"}>
          {relationshipOptions(fields.lang, ["self"])}
        </Select>
      </Field>
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {t.common.continue}
      </SubmitButton>
    </Form>
  );
}

export interface MemberDefaults {
  memberId: string | null;
  kind: MemberKind;
  firstName: string;
  lastName: string;
  relationship: string;
  /** Whether the member already has a date of birth on file (the date itself is never sent back to the browser). */
  hasDob: boolean;
  /** A member with their own sign-in stays an adult. */
  kindLocked: boolean;
}

export function MemberForm({ fields, defaults, cancelHref }: { fields: FlowFormFields; defaults: MemberDefaults; cancelHref: string }) {
  const t = getDictionary(fields.lang);
  const p = t.people;
  const [state, action, pending] = useActionState(memberAction, null);
  const [kind, setKind] = useState<MemberKind>(defaults.kind);
  const err = (name: string) => fieldError(state, name);
  const kindOptions: RadioOption[] = MEMBER_KIND_CHOICES.map((k) => ({ value: k, label: p.kinds[k].label, description: p.kinds[k].hint || undefined, disabled: defaults.kindLocked && k !== "adult" }));
  return (
    <Form action={action} noValidate className="space-y-5">
      <HiddenFields values={{ ...fields, memberId: defaults.memberId, hasDob: defaults.hasDob ? "1" : null }} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldLabels={{ firstName: p.firstName, lastName: p.lastName, relationship: p.relationship, kind: p.kindLegend, dob: p.dob }} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={p.firstName} error={err("firstName")} id="firstName" locale={fields.lang}>
          <Input name="firstName" autoComplete="off" defaultValue={defaults.firstName} maxLength={60} />
        </Field>
        <Field label={p.lastName} error={err("lastName")} id="lastName" locale={fields.lang}>
          <Input name="lastName" autoComplete="off" defaultValue={defaults.lastName} maxLength={60} />
        </Field>
      </div>
      <Field label={p.kindLegend} as="group" error={err("kind")} id="kind" locale={fields.lang}>
        <RadioGroup name="kind" options={kindOptions} value={kind} onChange={(v) => setKind(v as MemberKind)} />
      </Field>
      <Field label={p.relationship} hint={p.relationshipHint} error={err("relationship")} id="relationship" locale={fields.lang}>
        <Select name="relationship" defaultValue={defaults.relationship || (kind === "student" ? "self" : "")}>
          <option value="" disabled>
            {p.relationship}
          </option>
          {relationshipOptions(fields.lang)}
        </Select>
      </Field>
      {asksDateOfBirth(kind) ? (
        <Field label={p.dob} hint={p.dobWhy} as="group" error={err("dob")} id="dob" locale={fields.lang}>
          <DateInput name="dob" autoComplete="off" locale={fields.lang} />
        </Field>
      ) : null}
      <FormActions align="start">
        <SubmitButton pending={pending} pendingText={t.common.saving} size="lg">
          {p.save}
        </SubmitButton>
        <a href={cancelHref} className="inline-flex min-h-11 items-center justify-center rounded-control px-4 font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline">
          {t.common.cancel}
        </a>
      </FormActions>
    </Form>
  );
}

/* ----------------------------------------------------------------------------------------- custody */

export interface CustodyDefaults {
  lives: "yes" | "no" | "unsure" | "";
  months: string;
  equal: "yes" | "no" | "unsure" | "";
  higher: "yes" | "no" | "unsure" | "";
  notes: string;
}

export function CustodyForm({ fields, defaults, studentName, incomeYear }: { fields: FlowFormFields; defaults: CustodyDefaults; studentName: string; incomeYear: number }) {
  const t = getDictionary(fields.lang);
  const c = t.custody;
  const [state, action, pending] = useActionState(custodyAction, null);
  const [lives, setLives] = useState(defaults.lives);
  const shared = lives === "yes" || lives === "unsure";
  const tri = (yes: string, no: string): RadioOption[] => [
    { value: "yes", label: yes },
    { value: "no", label: no },
    { value: "unsure", label: t.common.notSure },
  ];
  return (
    <Form action={action} noValidate className="space-y-6">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} />
      <Field label={c.q1(studentName, incomeYear)} as="group" error={fieldError(state, "lives")} id="lives" locale={fields.lang}>
        <RadioGroup name="lives" options={tri(c.q1Yes, c.q1No)} value={lives} onChange={(v) => setLives(v as CustodyDefaults["lives"])} />
      </Field>
      {shared ? (
        <div className="space-y-6 border-l-4 border-line pl-4">
          <Alert tone="info" role="note">
            {c.reviewNote}
          </Alert>
          <Field label={c.q2(studentName, incomeYear)} hint={c.q2Hint} error={fieldError(state, "months")} id="months" optional locale={fields.lang}>
            <Input name="months" inputMode="numeric" defaultValue={defaults.months} maxLength={2} className="max-w-28" />
          </Field>
          <Field label={c.q3} as="group" id="equal" optional locale={fields.lang}>
            <RadioGroup name="equal" options={tri(t.common.yes, t.common.no)} defaultValue={defaults.equal || undefined} />
          </Field>
          <Field label={c.q4} as="group" id="higher" optional locale={fields.lang}>
            <RadioGroup name="higher" options={tri(c.q4Yes, c.q4No)} defaultValue={defaults.higher || undefined} />
          </Field>
        </div>
      ) : null}
      <Field label={c.notes} hint={c.notesHint} optional id="notes" locale={fields.lang}>
        <Textarea name="notes" rows={3} maxLength={1000} defaultValue={defaults.notes} />
      </Field>
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {c.save}
      </SubmitButton>
    </Form>
  );
}

/* -------------------------------------------------------------------------------------------- path */

export function PathForm({ fields, current }: { fields: FlowFormFields; current: "upload" | "auto_submit" | null }) {
  const t = getDictionary(fields.lang);
  const p = t.path;
  const [state, action, pending] = useActionState(pathAction, null);
  return (
    <Form action={action} className="space-y-6">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} />
      <Fieldset label={p.legend} hideLabel locale={fields.lang}>
        <RadioGroup
          name="preference"
          variant="cards"
          defaultValue={current ?? "upload"}
          options={[
            { value: "upload", label: p.upload, description: p.uploadBody, icon: <Upload /> },
            { value: "auto_submit", label: p.connect, description: p.connectBody, icon: <Landmark /> },
          ]}
        />
      </Fieldset>
      <SubmitButton pending={pending} pendingText={t.common.saving} size="lg" fullWidth>
        {p.choose}
      </SubmitButton>
    </Form>
  );
}

/* -------------------------------------------------------------------------------------- statements */

export function StatementForm({ fields, kind, memberId, sha, checkboxLabel }: { fields: FlowFormFields; kind: "zero_income" | "no_other_income"; memberId: string | null; sha: string; checkboxLabel: string }) {
  const t = getDictionary(fields.lang);
  const [state, action, pending] = useActionState(signStatementAction, null);
  return (
    <Form action={action} className="space-y-5">
      <HiddenFields values={{ ...fields, kind, memberId, sha }} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} fieldIds={{ agree: "agree" }} />
      <Checkbox id="agree" name="agree" variant="card" label={checkboxLabel} error={fieldError(state, "agree")} />
      <SubmitButton pending={pending} pendingText={t.statement.signing} size="lg" fullWidth leadingIcon={<FileText aria-hidden="true" className="size-5" />}>
        {t.statement.sign}
      </SubmitButton>
    </Form>
  );
}

/* ------------------------------------------------------------------------------------------ submit */

export function SubmitForm({ fields, disabled }: { fields: FlowFormFields; disabled?: boolean }) {
  const t = getDictionary(fields.lang);
  const [state, action, pending] = useActionState(submitAction, null);
  return (
    <Form action={action} className="space-y-4">
      <HiddenFields values={fields} />
      <FormError state={state} locale={fields.lang} title={t.errors.title} />
      <SubmitButton pending={pending} pendingText={t.review.sending} size="lg" fullWidth disabled={disabled}>
        {t.review.send}
      </SubmitButton>
    </Form>
  );
}

/* ------------------------------------------------------------------------------------- family home */

export function InviteAdultForm({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);
  const f = t.family;
  const [state, action, pending] = useActionState(inviteAdultAction, null);
  const err = (name: string) => fieldError(state, name);
  return (
    <Form action={action} noValidate resetOnSubmit={Boolean(state?.ok)} className="space-y-5">
      <HiddenFields values={{ lang: locale }} />
      <FormError state={state} locale={locale} title={t.errors.title} fieldLabels={{ firstName: f.adultFirstName, lastName: f.adultLastName, relationship: f.adultRelationship, email: f.adultEmail }} />
      {state?.ok ? (
        <Alert tone="success" role="status">
          {f.invited(state.data.email)}
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={f.adultFirstName} error={err("firstName")} id="adult-firstName" locale={locale}>
          <Input name="firstName" autoComplete="off" maxLength={60} />
        </Field>
        <Field label={f.adultLastName} error={err("lastName")} id="adult-lastName" locale={locale}>
          <Input name="lastName" autoComplete="off" maxLength={60} />
        </Field>
      </div>
      <Field label={f.adultRelationship} error={err("relationship")} id="adult-relationship" locale={locale}>
        <Select name="relationship" defaultValue="parent">
          {relationshipOptions(locale, ["self"])}
        </Select>
      </Field>
      <Field label={f.adultEmail} error={err("email")} id="adult-email" locale={locale}>
        <Input name="email" type="email" inputMode="email" autoComplete="off" spellCheck={false} />
      </Field>
      <SubmitButton pending={pending} pendingText={f.inviting} size="lg">
        {f.invite}
      </SubmitButton>
    </Form>
  );
}
