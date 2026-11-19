"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Field, RadioGroup } from "@/components/ui";
import { RailConnect, type RailConnectActions, type RailConnectionView, type RailConnectStrings, type RailConsentText } from "@/features/rails";
import { getDictionary } from "@/i18n";
import { railCompleteAction, railDeclineAction, railRefreshAction, railStartAction, switchToUploadAction } from "../actions";
import type { FlowFormFields } from "./hidden-fields";

export interface ConnectPanelProps {
  fields: FlowFormFields;
  /** Adults who may connect from this sign-in: the person themselves (their own account only). */
  adults: Array<{ id: string; name: string }>;
  consent: RailConsentText;
  initialConnection: RailConnectionView | null;
  /** Where the "upload instead" escape hatch goes if recording the preference fails (it never blocks the family). */
  uploadHref: string;
}

/**
 * Auto-submit: choose whose account and what kind, then the shared <RailConnect> (consent, provider screen,
 * progress). "Upload documents instead" is always there and keeps everything already provided.
 */
export function ConnectPanel({ fields, adults, consent, initialConnection, uploadHref }: ConnectPanelProps) {
  const t = getDictionary(fields.lang);
  const c = t.connect;
  const router = useRouter();
  const [memberId, setMemberId] = useState(initialConnection?.memberId ?? adults[0]?.id ?? "");
  const [kind, setKind] = useState<"payroll" | "bank">(initialConnection?.kind === "bank" ? "bank" : "payroll");
  const [chosen, setChosen] = useState(Boolean(initialConnection));

  const context = useMemo(() => ({ base: fields.base, v: fields.v, lang: fields.lang }), [fields.base, fields.v, fields.lang]);
  const actions: RailConnectActions = useMemo(
    () => ({
      start: (input) => railStartAction(context, { memberId, kind }, input),
      complete: (connectionId, clientResult) => railCompleteAction(context, connectionId, clientResult),
      decline: (connectionId) => railDeclineAction(context, connectionId),
      refresh: (connectionId) => railRefreshAction(context, connectionId),
    }),
    [context, memberId, kind],
  );

  const onUploadInstead = useCallback(() => {
    switchToUploadAction(context)
      .then((result) => router.push(result.ok ? result.data.href : uploadHref))
      .catch(() => router.push(uploadHref));
  }, [context, router, uploadHref]);

  const strings: RailConnectStrings = c.rail;

  if (adults.length === 0) {
    return (
      <div className="space-y-4">
        <Alert tone="info">{c.ownerOnlyNote}</Alert>
        <Button variant="secondary" size="lg" onClick={onUploadInstead}>
          {c.rail.uploadInstead}
        </Button>
      </div>
    );
  }

  if (!chosen) {
    return (
      <div className="space-y-6">
        {adults.length > 1 ? (
          <Field label={c.whoLegend} hint={c.whoHint} as="group" id="rail-member" locale={fields.lang}>
            <RadioGroup name="memberId" options={adults.map((a) => ({ value: a.id, label: a.name }))} value={memberId} onChange={setMemberId} />
          </Field>
        ) : null}
        <Field label={c.kindLegend} as="group" id="rail-kind" locale={fields.lang}>
          <RadioGroup
            name="kind"
            options={[
              { value: "payroll", label: c.kindPayroll },
              { value: "bank", label: c.kindBank },
            ]}
            value={kind}
            onChange={(v) => setKind(v === "bank" ? "bank" : "payroll")}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => setChosen(true)} disabled={!memberId}>
            {c.chooseFirst}
          </Button>
          <Button size="lg" variant="ghost" onClick={onUploadInstead}>
            {c.rail.uploadInstead}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RailConnect locale={fields.lang} strings={strings} consent={consent} actions={actions} onUploadInstead={onUploadInstead} onFinished={() => router.refresh()} initialConnection={initialConnection} />
    </div>
  );
}
