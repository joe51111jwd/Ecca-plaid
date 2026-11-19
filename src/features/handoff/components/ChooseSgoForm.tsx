"use client";

import { RadioGroup } from "@/components/ui";
import type { FamilyActionState } from "../types";
import { ActionForm } from "./ActionForm";

export interface ChooseSgoFormProps {
  token: string;
  locale: "en" | "es";
  choices: Array<{ sgoOrgId: string; displayName: string; website: string | null }>;
  labels: { heading: string; hint: string; submit: string; pending: string; error: string };
  action: (previous: FamilyActionState, formData: FormData) => Promise<FamilyActionState>;
}

/** The family picks one of the business's partner scholarship organizations. */
export function ChooseSgoForm({ token, locale, choices, labels, action }: ChooseSgoFormProps) {
  return (
    <ActionForm action={action} submitLabel={labels.submit} pendingText={labels.pending} submitSize="lg" errorTitle={labels.error} quietSuccess locale={locale} aria-label={labels.heading}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <fieldset className="space-y-3">
        <legend className="text-lg font-semibold text-fg">{labels.heading}</legend>
        <p className="text-sm text-fg-muted">{labels.hint}</p>
        <RadioGroup
          name="sgoOrgId"
          variant="cards"
          required
          options={choices.map((c) => ({ value: c.sgoOrgId, label: c.displayName, description: c.website ?? undefined }))}
        />
      </fieldset>
    </ActionForm>
  );
}
