"use client";

import { ArrowDown, Pencil } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Checkbox, Disclosure, Field, Input, LineItems, MoneyInput, ProvisionalBadge, RadioGroup, Select, Switch } from "@/components/ui";
import { PaymentForm } from "@/features/payments";
import { useCheckout } from "./CheckoutProvider";
import { CreditBanner } from "./CreditBanner";
import { errorFor, fieldId, orderedErrors, patchAt, textValue, type Patch } from "./form-state";
import type { ClientContributor, CopyText } from "./view-model";

export interface CheckoutFormProps {
  /** The 50 States and D.C. for the address (from the server; the client never imports the SGO module). */
  states: ReadonlyArray<{ code: string; name: string }>;
}

type ContributorKey = ClientContributor["key"];

const NAME_PARTS = [
  { part: "firstName", label: "First name", autoComplete: "given-name", optional: false },
  { part: "middleName", label: "Middle name", autoComplete: "additional-name", optional: true },
  { part: "lastName", label: "Last name", autoComplete: "family-name", optional: false },
  { part: "suffix", label: "Suffix", autoComplete: "honorific-suffix", optional: true },
] as const;

const ADDRESS_STORAGE_PREFIX = "ecca-give-address:";

function Copy({ items, className }: { items: readonly CopyText[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={className}>
      {items.map((c) => (
        <p key={c.id} data-copy-id={c.id} className="text-sm text-fg-muted">
          {c.text}
        </p>
      ))}
    </div>
  );
}

function Step({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={`${id ?? `step-${n}`}-title`} className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 id={`${id ?? `step-${n}`}-title`} className="flex items-center gap-3 text-lg font-semibold text-fg">
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-surface text-sm font-semibold text-brand-700">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

/**
 * The donor checkout form. Every change is saved to the donations service (debounced while typing), which
 * returns the recomputed view: the panel, the designation words, the fee lines and the field problems all come
 * back from the server. Nothing here computes a tax figure or words a tax statement.
 */
export function CheckoutForm({ states }: CheckoutFormProps) {
  const { view, payment, stage, saving, placing, rejected, formError, touched, showAll, optimistic, returnUrl, queue, touch, placeOrder, backToForm } = useCheckout();
  const visibility = { blocking: view.errors, rejected, touched, showAll };
  const err = (path: string) => errorFor(path, visibility);
  const primary = view.order.contributors.find((c) => c.key === "primary");
  const spouse = view.order.contributors.find((c) => c.key === "spouse");

  /* ---------- local text and money drafts (what is typed; the server's view supplies the rest) ---------- */
  const [text, setText] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of view.order.contributors) {
      for (const { part } of NAME_PARTS) out[`contributors.${c.key}.${part}`] = c[part] ?? "";
      if (c.key === "spouse" && c.email && c.email !== primary?.email) out["contributors.spouse.email"] = c.email;
    }
    out.email = primary?.email ?? "";
    return out;
  });
  const [money, setMoney] = useState<Record<string, number | null>>(() => ({
    giftCents: view.order.giftCents,
    ...(view.order.liability ? { "liability.estimatedTaxCents": view.order.liability.estimatedTaxCents, "liability.otherCreditsCents": view.order.liability.otherCreditsCents } : {}),
  }));
  const [focusRequest, setFocusRequest] = useState(0);

  // The service does not echo the mailing address back, so the browser tab remembers what was typed (until the tab closes).
  const addressKey = `${ADDRESS_STORAGE_PREFIX}${view.sessionId}`;
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(addressKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const restored: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (k.startsWith("address.") && typeof v === "string") restored[k] = v;
      // Restoring browser-held state after hydration is the one place an effect must set state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText((prev) => ({ ...restored, ...prev }));
    } catch {
      /* storage unavailable: the saved address still stands on the server */
    }
  }, [addressKey]);
  useEffect(() => {
    if (view.status === "completed") {
      try {
        window.sessionStorage.removeItem(addressKey);
      } catch {
        /* nothing to clear */
      }
    }
  }, [addressKey, view.status]);

  const setTextField = useCallback(
    (path: string, value: string) => {
      setText((prev) => {
        const next = { ...prev, [path]: value };
        if (path.startsWith("address.")) {
          try {
            const address = Object.fromEntries(Object.entries(next).filter(([k]) => k.startsWith("address.")));
            window.sessionStorage.setItem(addressKey, JSON.stringify(address));
          } catch {
            /* storage unavailable */
          }
        }
        return next;
      });
      queue(patchAt(path, textValue(value)));
    },
    [addressKey, queue],
  );

  const setMoneyField = useCallback(
    (path: string, cents: number | null, patch?: Patch) => {
      setMoney((prev) => ({ ...prev, [path]: cents }));
      queue(patch ?? patchAt(path, cents));
    },
    [queue],
  );

  /** A cleared amount that falls back to a default shows the default again once the field is left. */
  const settleDefault = (path: string) => {
    touch(path);
    setMoney((prev) => {
      if (prev[path] !== null) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };
  const shown = (path: string, fallback: number | null) => (path in money ? money[path] : fallback);

  /* ---------- focus the first problem after "Continue" ---------- */
  useEffect(() => {
    if (focusRequest === 0) return;
    const first = orderedErrors({ ...view.errors, ...rejected }).find((e) => document.getElementById(fieldId(e.path)));
    if (first) document.getElementById(fieldId(first.path))?.focus();
  }, [focusRequest, view.errors, rejected]);

  const onContinue = async () => {
    const placed = await placeOrder();
    if (!placed) setFocusRequest((n) => n + 1);
  };

  const editable = view.editable && view.status !== "completed";
  const filingStatus = optimistic("filingStatus", view.order.filingStatus);
  const joint = filingStatus === "married_joint";
  const bothSpouses = joint && optimistic("bothSpousesContribute", view.order.joint ? view.order.bothSpouses : true) === true;
  const checked = (path: string, serverValue: boolean) => optimistic(path, serverValue) === true;
  const errorList = showAll ? orderedErrors({ ...view.errors, ...rejected }) : [];

  /* ---------- pieces ---------- */
  const nameFields = (c: ClientContributor) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {NAME_PARTS.map(({ part, label, autoComplete, optional }) => {
        const path = `contributors.${c.key}.${part}`;
        return (
          <Field key={path} id={fieldId(path)} label={label} optional={optional} error={err(path)}>
            <Input
              value={text[path] ?? ""}
              autoComplete={c.key === "primary" ? autoComplete : "off"}
              maxLength={part === "suffix" ? 20 : 100}
              onChange={(e) => setTextField(path, e.target.value)}
              onBlur={() => touch(path)}
              disabled={!editable}
            />
          </Field>
        );
      })}
    </div>
  );

  const designatedField = (c: ClientContributor) => {
    const path = `contributors.${c.key}.designatedCents`;
    const explicit = path in money && money[path] !== null;
    return (
      <Field
        id={fieldId(path)}
        label={view.labels.designated}
        error={err(path)}
        labelAction={
          explicit ? (
            <button type="button" className="text-sm font-medium text-action underline" onClick={() => setMoneyField(path, null)} disabled={!editable}>
              Use the suggested amount
            </button>
          ) : null
        }
      >
        <MoneyInput valueCents={shown(path, c.designatedCents)} onValueChange={(cents) => setMoneyField(path, cents)} onBlur={() => settleDefault(path)} disabled={!editable} />
      </Field>
    );
  };

  const shareField = (c: ClientContributor) => {
    const path = `contributors.${c.key}.giftCents`;
    const other: ContributorKey = c.key === "primary" ? "spouse" : "primary";
    return (
      <Field id={fieldId(path)} label={`${c.heading}: amount of the gift`} error={err(path)}>
        <MoneyInput
          valueCents={shown(path, c.giftCents)}
          onValueChange={(cents) => {
            // Typing one spouse's share leaves the other with the rest of the gift.
            setMoney((prev) => {
              const next = { ...prev };
              delete next[`contributors.${other}.giftCents`];
              return next;
            });
            setMoneyField(path, cents, { contributors: { [c.key]: { giftCents: cents }, [other]: { giftCents: null } } });
          }}
          onBlur={() => settleDefault(path)}
          disabled={!editable}
        />
      </Field>
    );
  };

  const stateCreditField = (c: ClientContributor, withHeading: boolean) => {
    const path = `contributors.${c.key}.expectedStateCreditCents`;
    return (
      <Field id={fieldId(path)} label={withHeading ? `${c.heading}: ${view.labels.stateCredit}` : view.labels.stateCredit} hint={view.labels.stateCreditHelp} optional error={err(path)}>
        <MoneyInput valueCents={shown(path, c.expectedStateCreditCents || null)} onValueChange={(cents) => setMoneyField(path, cents)} onBlur={() => touch(path)} disabled={!editable} />
      </Field>
    );
  };

  const otherContributionsField = (c: ClientContributor, withHeading: boolean) => {
    const path = `contributors.${c.key}.otherQualifiedContributionsCents`;
    return (
      <Field id={fieldId(path)} label={withHeading ? `${c.heading}: ${view.labels.otherContributions}` : view.labels.otherContributions} hint={view.labels.otherContributionsHelp} error={err(path)}>
        <MoneyInput valueCents={shown(path, c.otherQualifiedContributionsCents || null)} onValueChange={(cents) => setMoneyField(path, cents)} onBlur={() => touch(path)} disabled={!editable} />
      </Field>
    );
  };

  const liabilityPatch = (estimated: number | null, otherCredits: number | null): Patch => ({
    liability: estimated === null ? null : { estimatedTaxCents: estimated, otherCreditsCents: otherCredits },
  });

  const formHidden = stage === "payment" && payment !== null;

  return (
    <div className="space-y-6" data-testid="checkout-form" data-status={view.status} data-stage={stage}>
      <header className="space-y-3">
        <p className="text-sm font-medium text-fg-muted">Give to</p>
        <h1 className="text-2xl font-semibold text-fg">{view.sgo.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {view.list.source === "provisional_curated" ? <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge> : null}
          <span data-testid="list-label">{view.list.label}</span>
          {view.sgo.ein ? <span>· EIN {view.sgo.ein}</span> : null}
          {view.mode === "test" ? (
            <Badge tone="caution" size="sm">
              Sandbox
            </Badge>
          ) : null}
        </div>
        <Copy items={view.list.notices} className="space-y-1" />
      </header>

      <CreditBanner banner={view.banner} />

      <a href="#tax-math-panel" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-action underline lg:hidden">
        <ArrowDown aria-hidden="true" className="size-4" />
        See the tax credit preview
      </a>

      {view.list.refusal ? (
        <Alert tone="danger" role="alert" title="A gift to this organization cannot be accepted">
          <p>{view.list.refusal}</p>
        </Alert>
      ) : null}

      {formError ? (
        <Alert tone="danger" role="alert" title="Something needs attention">
          <p>{formError}</p>
        </Alert>
      ) : null}

      {formHidden ? null : (
        <div className="space-y-8">
          <Step n={1} title="Your gift">
            <Field id={fieldId("giftCents")} label="Gift amount" error={err("giftCents")}>
              <MoneyInput
                valueCents={money.giftCents ?? null}
                onValueChange={(cents) => setMoneyField("giftCents", cents)}
                onBlur={() => touch("giftCents")}
                disabled={!editable}
                size="lg"
                data-testid="gift-amount"
              />
            </Field>
            {view.copy.noEarmark ? (
              <Alert tone="warning" role="note">
                <p data-copy-id={view.copy.noEarmark.id}>{view.copy.noEarmark.text}</p>
              </Alert>
            ) : null}
            <Copy items={view.copy.designationIntro} className="space-y-2" />
            {!bothSpouses && primary ? designatedField(primary) : null}
            <Copy items={view.copy.designationAmount} className="space-y-2" />
          </Step>

          <Step n={2} title="Federal filing status">
            <Field as="group" id={fieldId("filingStatus")} label={view.labels.filingStatus} error={err("filingStatus")}>
              <RadioGroup
                name="filingStatus"
                columns={2}
                value={typeof filingStatus === "string" ? filingStatus : ""}
                onChange={(value) => queue({ filingStatus: value }, { immediate: true })}
                options={view.labels.filingStatusOptions.map((o) => ({ value: o.value, label: o.label }))}
                disabled={!editable}
              />
            </Field>
            {joint ? (
              <div className="space-y-5 rounded-card border border-line bg-sunken p-4" data-testid="joint-section">
                <Switch
                  label="Both spouses are making this gift"
                  checked={bothSpouses}
                  onChange={(e) => queue({ bothSpousesContribute: e.target.checked }, { immediate: true })}
                  disabled={!editable}
                />
                <Copy items={view.copy.joint} className="space-y-2" />
                {view.order.contributors.map((c) => (
                  <fieldset key={c.key} className="space-y-4 rounded-card border border-line bg-surface p-4" data-contributor={c.key}>
                    <legend className="px-1 text-base font-semibold text-fg">{c.heading}</legend>
                    {nameFields(c)}
                    {bothSpouses ? shareField(c) : null}
                    {bothSpouses ? designatedField(c) : null}
                  </fieldset>
                ))}
              </div>
            ) : null}
          </Step>

          <Step n={3} title="State tax credit">
            {view.order.contributors.map((c) => (
              <div key={c.key}>{stateCreditField(c, view.order.contributors.length > 1)}</div>
            ))}
            <Disclosure summary="Refine the preview (optional)" variant="plain">
              <div className="mt-4 space-y-5">
                {view.order.contributors.map((c) => (
                  <div key={c.key}>{otherContributionsField(c, view.order.contributors.length > 1)}</div>
                ))}
                <Field id={fieldId("liability.estimatedTaxCents")} label={view.labels.liability} hint={view.labels.liabilityHelp} error={err("liability.estimatedTaxCents")}>
                  <MoneyInput
                    valueCents={money["liability.estimatedTaxCents"] ?? null}
                    onValueChange={(cents) => setMoneyField("liability.estimatedTaxCents", cents, liabilityPatch(cents, money["liability.otherCreditsCents"] ?? null))}
                    disabled={!editable}
                  />
                </Field>
                <Field id={fieldId("liability.otherCreditsCents")} label={view.labels.otherCredits} error={err("liability.otherCreditsCents")}>
                  <MoneyInput
                    valueCents={money["liability.otherCreditsCents"] ?? null}
                    onValueChange={(cents) => setMoneyField("liability.otherCreditsCents", cents, liabilityPatch(money["liability.estimatedTaxCents"] ?? null, cents))}
                    disabled={!editable || money["liability.estimatedTaxCents"] == null}
                  />
                </Field>
              </div>
            </Disclosure>
          </Step>

          <Step n={4} title="Name and mailing address as on your federal tax return">
            {view.copy.donorNameHelp ? <p className="text-sm text-fg-muted">{view.copy.donorNameHelp.text}</p> : null}
            {!view.order.joint && primary ? nameFields(primary) : null}
            <Field id={fieldId("email")} label="Email address" hint="Your receipt goes here." error={err("email")}>
              <Input type="email" autoComplete="email" value={text.email ?? ""} maxLength={254} onChange={(e) => setTextField("email", e.target.value)} onBlur={() => touch("email")} disabled={!editable} />
            </Field>
            {bothSpouses && spouse ? (
              <Field id={fieldId("contributors.spouse.email")} label={`${spouse.heading}: email address for their own acknowledgment`} optional error={err("contributors.spouse.email")}>
                <Input
                  type="email"
                  autoComplete="off"
                  value={text["contributors.spouse.email"] ?? ""}
                  maxLength={254}
                  onChange={(e) => setTextField("contributors.spouse.email", e.target.value)}
                  onBlur={() => touch("contributors.spouse.email")}
                  disabled={!editable}
                />
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-6">
              <Field className="sm:col-span-6" id={fieldId("address.line1")} label="Street address" error={err("address.line1")}>
                <Input autoComplete="address-line1" value={text["address.line1"] ?? ""} maxLength={200} onChange={(e) => setTextField("address.line1", e.target.value)} onBlur={() => touch("address.line1")} disabled={!editable} />
              </Field>
              <Field className="sm:col-span-6" id={fieldId("address.line2")} label="Apartment, suite or unit" optional error={err("address.line2")}>
                <Input autoComplete="address-line2" value={text["address.line2"] ?? ""} maxLength={200} onChange={(e) => setTextField("address.line2", e.target.value)} disabled={!editable} />
              </Field>
              <Field className="sm:col-span-3" id={fieldId("address.city")} label="City" error={err("address.city")}>
                <Input autoComplete="address-level2" value={text["address.city"] ?? ""} maxLength={100} onChange={(e) => setTextField("address.city", e.target.value)} onBlur={() => touch("address.city")} disabled={!editable} />
              </Field>
              <Field className="sm:col-span-1" id={fieldId("address.state")} label="State" error={err("address.state")}>
                <Select
                  autoComplete="address-level1"
                  value={text["address.state"] ?? ""}
                  placeholder="Choose"
                  onChange={(e) => setTextField("address.state", e.target.value)}
                  disabled={!editable}
                >
                  {states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field className="sm:col-span-2" id={fieldId("address.zip")} label="ZIP code" error={err("address.zip")}>
                <Input autoComplete="postal-code" inputMode="numeric" value={text["address.zip"] ?? ""} maxLength={10} onChange={(e) => setTextField("address.zip", e.target.value)} onBlur={() => touch("address.zip")} disabled={!editable} />
              </Field>
            </div>
            {!text["address.line1"] && !view.errors["address.line1"] ? (
              <p className="text-sm text-fg-muted" data-testid="address-saved">
                Your mailing address is saved with this checkout. Enter it again only to change it.
              </p>
            ) : null}
          </Step>

          <Step n={5} title="Confirm who is giving">
            <Copy items={view.copy.notices} className="space-y-2" />
            <div className="space-y-3">
              {view.attestations.map((a) => {
                const path = `attestations.${a.key}`;
                return (
                  <Checkbox
                    key={a.key}
                    id={fieldId(path)}
                    variant="card"
                    label={a.text}
                    checked={checked(path, a.confirmed)}
                    error={err(path)}
                    onChange={(e) => queue({ attestations: { [a.key]: e.target.checked } }, { immediate: true })}
                    disabled={!editable}
                  />
                );
              })}
            </div>
          </Step>

          <Step n={6} title="Designate your gift">
            {view.designation.statement ? (
              <Checkbox
                id={fieldId("designationConfirmed")}
                variant="card"
                data-testid="designation-statement"
                label={<span className="font-medium text-fg">{view.designation.statement.text}</span>}
                checked={checked("designationConfirmed", view.designation.confirmed)}
                error={err("designationConfirmed")}
                onChange={(e) => queue({ designationConfirmed: e.target.checked }, { immediate: true })}
                disabled={!editable}
              />
            ) : (
              <p id={fieldId("designationConfirmed")} tabIndex={-1} className="rounded-card border border-dashed border-line p-4 text-sm text-fg-muted">
                {view.errors.designationConfirmed ?? "The designation statement appears once the amount and names are entered."}
              </p>
            )}
            <div className="space-y-2">
              {view.copy.designationClosing.map((c) => (
                <p key={c.id} data-copy-id={c.id} className={c.text === view.designation.irrevocable ? "text-sm font-semibold text-fg" : "text-sm text-fg-muted"}>
                  {c.text}
                </p>
              ))}
            </div>
          </Step>

          <Step n={7} title="How you receive the official acknowledgment">
            {view.consents.map((c) => {
              const path = `contributors.${c.key}.eDeliveryConsent`;
              return c.text ? (
                <Checkbox
                  key={c.key}
                  id={fieldId(path)}
                  variant="card"
                  label={c.text}
                  checked={checked(path, c.given)}
                  error={err(path)}
                  onChange={(e) => queue({ contributors: { [c.key]: { eDeliveryConsent: e.target.checked } } }, { immediate: true })}
                  disabled={!editable}
                />
              ) : (
                <p key={c.key} className="text-sm text-fg-muted">
                  Enter an email address to choose electronic delivery. Without it, the acknowledgment is mailed to the address above.
                </p>
              );
            })}
          </Step>
        </div>
      )}

      <section aria-labelledby="review-title" className="space-y-4 rounded-card border border-line bg-sunken p-4 sm:p-5" data-testid="review">
        <div className="flex items-center justify-between gap-3">
          <h2 id="review-title" className="text-lg font-semibold text-fg">
            {formHidden ? "Your gift" : "Review"}
          </h2>
          {formHidden ? (
            <Button variant="ghost" size="sm" leadingIcon={<Pencil />} onClick={backToForm}>
              Change something
            </Button>
          ) : null}
        </div>
        {view.review.lines.length > 0 ? (
          <LineItems
            label="What you will be charged"
            showCents
            items={view.review.lines.map((l) => ({ label: l.label, amountCents: l.amountCents, hint: l.hint ?? undefined }))}
            total={{ label: view.mode === "test" ? "Total (sandbox, not charged)" : "Total charged", amountCents: view.review.totalCents }}
          />
        ) : (
          <p className="text-sm text-fg-muted">Enter the amount of your gift.</p>
        )}
        {view.review.feeExplanation ? (
          <p className="text-sm text-fg-muted" data-copy-id={view.review.feeExplanation.id}>
            {view.review.feeExplanation.text}
          </p>
        ) : null}

        {errorList.length > 0 && !formHidden ? (
          <Alert tone="warning" title="Before you continue" role="alert">
            <ul className="list-disc space-y-1 pl-5">
              {errorList.map((e) => (
                <li key={e.path}>
                  <a className="underline" href={`#${fieldId(e.path)}`}>
                    {e.message}
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {formHidden && payment ? (
          <div data-testid="payment-step">
            <PaymentForm payment={payment} returnUrl={returnUrl} refreshWhilePending showLines={false} showSandboxNotice={false} submitLabel={view.mode === "test" ? "Complete sandbox gift" : undefined} />
          </div>
        ) : (
          <Button fullWidth size="lg" onClick={onContinue} loading={placing} loadingText="Placing your order…" disabled={!editable || placing} data-testid="continue-to-payment">
            Continue to payment
          </Button>
        )}
        <p className="text-xs text-fg-muted" aria-live="polite">
          {saving ? "Saving…" : "Your answers are saved as you go."}
        </p>
      </section>
    </div>
  );
}
