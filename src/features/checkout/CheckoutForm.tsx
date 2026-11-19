"use client";

import { ArrowRight, ChevronLeft, Info, Pencil } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Checkbox, cn, Disclosure, Field, Input, LineItems, Money, MoneyInput, ProvisionalBadge, RadioGroup, Select, Stepper, Switch } from "@/components/ui";
import { PaymentForm } from "@/features/payments";
import { useCheckout } from "./CheckoutProvider";
import { CreditBanner } from "./CreditBanner";
import { errorFor, fieldId, patchAt, textValue, type Patch } from "./form-state";
import {
  blockingProblems,
  CHECKOUT_STEPS,
  firstStepWithProblems,
  nextStep,
  parseStep,
  previousStep,
  problemsByStep,
  STEP_LABELS,
  STEP_PARAM,
  STEP_TITLES,
  stepOfPath,
  stepSearch,
  type CheckoutStepId,
  type StepLayout,
} from "./steps";
import type { CheckoutClientView, ClientContributor, CopyText } from "./view-model";
import { WhyDisclosure } from "./WhyDisclosure";

export interface CheckoutFormProps {
  /** The 50 States and D.C. for the address (from the server; the client never imports the SGO module). */
  states: ReadonlyArray<{ code: string; name: string }>;
  /**
   * Where the credit-eligibility banner shows inside the form. "mobile" (default): only below the lg breakpoint,
   * because the panel beside the form carries it on wide screens. "always": on every width (the widget, whose panel
   * is a folded bar).
   */
  banner?: "mobile" | "always";
}

type ContributorKey = ClientContributor["key"];

const NAME_PARTS = [
  {
    part: "firstName",
    label: "First name",
    autoComplete: "given-name",
    optional: false,
  },
  {
    part: "middleName",
    label: "Middle name",
    autoComplete: "additional-name",
    optional: true,
  },
  {
    part: "lastName",
    label: "Last name",
    autoComplete: "family-name",
    optional: false,
  },
  {
    part: "suffix",
    label: "Suffix",
    autoComplete: "honorific-suffix",
    optional: true,
  },
] as const;

const ADDRESS_STORAGE_PREFIX = "ecca-give-address:";

/** What to move focus to once a step change has rendered. */
type FocusTarget = { kind: "heading" } | { kind: "summary" } | { kind: "field"; path: string };

function Copy({ items, className, itemClassName = "text-sm text-fg-muted" }: { items: readonly CopyText[]; className?: string; itemClassName?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={className}>
      {items.map((c) => (
        <p key={c.id} data-copy-id={c.id} className={itemClassName}>
          {c.text}
        </p>
      ))}
    </div>
  );
}

function Group({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-4", className)}>
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function layoutOf(view: CheckoutClientView): StepLayout {
  return { jointShares: view.order.joint && view.order.bothSpouses };
}

/**
 * The donor checkout as four short steps (gift, about you, confirm, review and pay), one visible at a time. Every
 * change is saved to the donations service (debounced while typing), which returns the recomputed view: the panel,
 * the designation words, the fee lines and the field problems all come back from the server. The step lives in the
 * URL (?step=…), so it can be linked to, survives a reload and follows the browser's Back button. Nothing here
 * computes a tax figure or words a tax statement.
 */
export function CheckoutForm({ states, banner = "mobile" }: CheckoutFormProps) {
  const { view, payment, stage, saving, placing, rejected, formError, touched, showAll, optimistic, returnUrl, queue, touch, placeOrder, backToForm, saveNow } = useCheckout();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const primary = view.order.contributors.find((c) => c.key === "primary");
  const spouse = view.order.contributors.find((c) => c.key === "spouse");

  const editable = view.editable && view.status !== "completed";
  const filingStatus = optimistic("filingStatus", view.order.filingStatus);
  const joint = filingStatus === "married_joint";
  const bothSpouses = joint && optimistic("bothSpousesContribute", view.order.joint ? view.order.bothSpouses : true) === true;
  const checked = (path: string, serverValue: boolean) => optimistic(path, serverValue) === true;
  const layout: StepLayout = { jointShares: bothSpouses };

  const placed = stage === "payment" && payment !== null;
  const step: CheckoutStepId = placed ? "review" : parseStep(searchParams.get(STEP_PARAM));

  /* ---------- which problems show ---------- */
  // A step's problems all show once the donor tried to leave it; before that, only fields they touched.
  const [revealed, setRevealed] = useState<ReadonlySet<CheckoutStepId>>(() => new Set());
  const visibility = (path: string) => ({
    blocking: view.errors,
    rejected,
    touched,
    showAll: showAll || revealed.has(stepOfPath(path, layout)),
  });
  const err = (path: string) => errorFor(path, visibility(path));
  const grouped = problemsByStep({ ...view.errors, ...rejected }, layout);
  const shownProblems = (s: CheckoutStepId) => grouped[s].filter((p) => err(p.path) !== null);
  const summary = step === "review" ? CHECKOUT_STEPS.flatMap((s) => shownProblems(s).map((p) => ({ ...p, step: s }))) : shownProblems(step).map((p) => ({ ...p, step }));

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
    ...(view.order.liability
      ? {
          "liability.estimatedTaxCents": view.order.liability.estimatedTaxCents,
          "liability.otherCreditsCents": view.order.liability.otherCreditsCents,
        }
      : {}),
  }));
  const [checking, setChecking] = useState(false);

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

  /* ---------- moving between steps, and focus ---------- */
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const lastStep = useRef<CheckoutStepId>(step);
  const [focusTick, setFocusTick] = useState(0);

  const applyFocus = useCallback((target: FocusTarget) => {
    if (target.kind === "field") {
      const el = document.getElementById(fieldId(target.path));
      if (el) {
        el.focus();
        return;
      }
    }
    if (target.kind === "summary" && summaryRef.current) {
      summaryRef.current.focus();
      return;
    }
    headingRef.current?.focus();
  }, []);

  // After a step change (Continue, Back, the progress links or the browser's own Back), move focus to the new step.
  useEffect(() => {
    if (lastStep.current === step && focusTick === 0) return;
    const stepChanged = lastStep.current !== step;
    lastStep.current = step;
    const target = pendingFocus.current ?? (stepChanged ? ({ kind: "heading" } as const) : null);
    pendingFocus.current = null;
    if (!target) return;
    if (stepChanged) window.scrollTo({ top: 0 });
    applyFocus(target);
  }, [step, focusTick, applyFocus]);

  const goTo = useCallback(
    (target: CheckoutStepId, focus: FocusTarget = { kind: "heading" }) => {
      pendingFocus.current = focus;
      if (target === step) {
        setFocusTick((n) => n + 1);
        return;
      }
      // Next.js folds pushState into its router, so useSearchParams follows without a server round trip.
      window.history.pushState(null, "", `${pathname}${stepSearch(window.location.search, target)}`);
    },
    [pathname, step],
  );

  const reveal = (steps: readonly CheckoutStepId[]) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const s of steps) next.add(s);
      return next;
    });

  const onContinue = async () => {
    const next = nextStep(step);
    if (!next) return;
    if (!editable) {
      goTo(next);
      return;
    }
    setChecking(true);
    try {
      const result = await saveNow();
      const problems = blockingProblems(step, { ...result.view.errors, ...result.rejected }, { ...layoutOf(result.view), filingStatusChosen: result.view.order.filingStatus !== null });
      if (!result.saved || problems.length > 0) {
        reveal([step]);
        goTo(step, { kind: "summary" });
        return;
      }
      goTo(next);
    } finally {
      setChecking(false);
    }
  };

  const onBack = () => {
    const prev = previousStep(step);
    if (prev) goTo(prev);
  };

  const onPlaceOrder = async () => {
    const ok = await placeOrder();
    if (ok) return;
    const result = await saveNow();
    const first = firstStepWithProblems({ ...result.view.errors, ...result.rejected }, layoutOf(result.view));
    reveal(CHECKOUT_STEPS);
    goTo(first ?? "review", { kind: "summary" });
  };

  const onChangeSomething = () => {
    backToForm();
    goTo("gift");
  };

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
            setMoneyField(path, cents, {
              contributors: {
                [c.key]: { giftCents: cents },
                [other]: { giftCents: null },
              },
            });
          }}
          onBlur={() => settleDefault(path)}
          disabled={!editable}
        />
      </Field>
    );
  };

  const several = view.order.contributors.length > 1;
  const stateCreditField = (c: ClientContributor) => {
    const path = `contributors.${c.key}.expectedStateCreditCents`;
    return (
      <Field id={fieldId(path)} label={several ? `${c.heading}: ${view.labels.stateCredit}` : view.labels.stateCredit} optional error={err(path)}>
        <MoneyInput valueCents={shown(path, c.expectedStateCreditCents || null)} onValueChange={(cents) => setMoneyField(path, cents)} onBlur={() => touch(path)} disabled={!editable} />
      </Field>
    );
  };

  const otherContributionsField = (c: ClientContributor) => {
    const path = `contributors.${c.key}.otherQualifiedContributionsCents`;
    return (
      <Field id={fieldId(path)} label={several ? `${c.heading}: ${view.labels.otherContributions}` : view.labels.otherContributions} error={err(path)}>
        <MoneyInput valueCents={shown(path, c.otherQualifiedContributionsCents || null)} onValueChange={(cents) => setMoneyField(path, cents)} onBlur={() => touch(path)} disabled={!editable} />
      </Field>
    );
  };

  const liabilityPatch = (estimated: number | null, otherCredits: number | null): Patch => ({
    liability: estimated === null ? null : { estimatedTaxCents: estimated, otherCreditsCents: otherCredits },
  });

  // The optional State-credit and refinement fields start folded, unless they hold a value or a visible problem.
  const optionalPaths = [
    ...view.order.contributors.flatMap((c) => [`contributors.${c.key}.expectedStateCreditCents`, `contributors.${c.key}.otherQualifiedContributionsCents`]),
    "liability.estimatedTaxCents",
    "liability.otherCreditsCents",
  ];
  const optionalInUse = view.order.contributors.some((c) => c.expectedStateCreditCents > 0 || c.otherQualifiedContributionsCents > 0) || money["liability.estimatedTaxCents"] != null;
  const optionalProblem = optionalPaths.some((p) => err(p) !== null);

  const filingLabel = view.labels.filingStatusOptions.find((o) => o.value === view.order.filingStatus)?.label ?? null;
  const addressLine = [text["address.line1"], text["address.line2"], [text["address.city"], text["address.state"]].filter(Boolean).join(", "), text["address.zip"]].filter(Boolean).join(" · ");

  /* ---------- the steps ---------- */
  const giftStep = (
    <>
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
        <p className="flex items-start gap-2 rounded-card bg-warning-surface px-3 py-2.5 text-sm text-warning-fg" role="note">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span data-copy-id={view.copy.noEarmark.id}>{view.copy.noEarmark.text}</span>
        </p>
      ) : null}
      {!bothSpouses && primary ? (
        <div className="space-y-2">
          {designatedField(primary)}
          <WhyDisclosure items={[...view.copy.designationIntro, ...view.copy.designationAmount]} summary="What designating means" />
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">Each spouse&rsquo;s share and designated amount are on the next step.</p>
          <WhyDisclosure items={view.copy.designationIntro} />
        </div>
      )}
    </>
  );

  const aboutStep = (
    <>
      <Group title="Tax filing">
        <Field as="group" id={fieldId("filingStatus")} label={view.labels.filingStatus} error={err("filingStatus")}>
          <RadioGroup
            name="filingStatus"
            columns={2}
            value={typeof filingStatus === "string" ? filingStatus : ""}
            onChange={(value) => queue({ filingStatus: value }, { immediate: true })}
            options={view.labels.filingStatusOptions.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            disabled={!editable}
          />
        </Field>
        {joint ? (
          <div className="space-y-4 rounded-card border border-line bg-sunken p-4" data-testid="joint-section">
            <Switch label="Both spouses are making this gift" checked={bothSpouses} onChange={(e) => queue({ bothSpousesContribute: e.target.checked }, { immediate: true })} disabled={!editable} />
            <WhyDisclosure items={view.copy.joint} summary="How joint gifts work" />
            {view.order.contributors.map((c) => (
              <fieldset key={c.key} className="space-y-4 rounded-card border border-line bg-surface p-4" data-contributor={c.key}>
                <legend className="px-1 text-base font-semibold text-fg">{c.heading}</legend>
                {nameFields(c)}
                {bothSpouses ? shareField(c) : null}
                {bothSpouses ? designatedField(c) : null}
              </fieldset>
            ))}
            {bothSpouses ? <WhyDisclosure items={view.copy.designationAmount} summary="About the designated amounts" /> : null}
          </div>
        ) : null}
        <Disclosure key={optionalProblem ? "problem" : "quiet"} variant="plain" defaultOpen={optionalInUse || optionalProblem} summary="State tax credit and other details (optional)">
          <div className="mt-3 space-y-5 rounded-card border border-line p-4" data-testid="optional-details">
            {view.order.contributors.map((c) => (
              <div key={c.key}>{stateCreditField(c)}</div>
            ))}
            <WhyDisclosure
              items={[
                {
                  id: "field.state_credit.help",
                  text: view.labels.stateCreditHelp,
                },
              ]}
            />
            {view.order.contributors.map((c) => (
              <div key={c.key}>{otherContributionsField(c)}</div>
            ))}
            <WhyDisclosure
              items={[
                {
                  id: "field.other_contributions.help",
                  text: view.labels.otherContributionsHelp,
                },
              ]}
            />
            <Field id={fieldId("liability.estimatedTaxCents")} label={view.labels.liability} optional error={err("liability.estimatedTaxCents")}>
              <MoneyInput
                valueCents={money["liability.estimatedTaxCents"] ?? null}
                onValueChange={(cents) => setMoneyField("liability.estimatedTaxCents", cents, liabilityPatch(cents, money["liability.otherCreditsCents"] ?? null))}
                disabled={!editable}
              />
            </Field>
            <WhyDisclosure items={[{ id: "field.liability.help", text: view.labels.liabilityHelp }]} />
            <Field id={fieldId("liability.otherCreditsCents")} label={view.labels.otherCredits} optional error={err("liability.otherCreditsCents")}>
              <MoneyInput
                valueCents={money["liability.otherCreditsCents"] ?? null}
                onValueChange={(cents) => setMoneyField("liability.otherCreditsCents", cents, liabilityPatch(money["liability.estimatedTaxCents"] ?? null, cents))}
                disabled={!editable || money["liability.estimatedTaxCents"] == null}
              />
            </Field>
          </div>
        </Disclosure>
      </Group>

      <Group title="Name and mailing address as on your federal tax return" className="border-t border-line pt-6">
        {view.copy.donorNameHelp ? <WhyDisclosure items={[view.copy.donorNameHelp]} /> : null}
        {!view.order.joint && primary ? nameFields(primary) : null}
        <Field id={fieldId("email")} label="Email address" hint="Your receipt goes here." error={err("email")}>
          <Input
            type="email"
            autoComplete="email"
            value={text.email ?? ""}
            maxLength={254}
            onChange={(e) => setTextField("email", e.target.value)}
            onBlur={() => touch("email")}
            disabled={!editable}
          />
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
            <Input
              autoComplete="address-line1"
              value={text["address.line1"] ?? ""}
              maxLength={200}
              onChange={(e) => setTextField("address.line1", e.target.value)}
              onBlur={() => touch("address.line1")}
              disabled={!editable}
            />
          </Field>
          <Field className="sm:col-span-6" id={fieldId("address.line2")} label="Apartment, suite or unit" optional error={err("address.line2")}>
            <Input autoComplete="address-line2" value={text["address.line2"] ?? ""} maxLength={200} onChange={(e) => setTextField("address.line2", e.target.value)} disabled={!editable} />
          </Field>
          <Field className="sm:col-span-3" id={fieldId("address.city")} label="City" error={err("address.city")}>
            <Input
              autoComplete="address-level2"
              value={text["address.city"] ?? ""}
              maxLength={100}
              onChange={(e) => setTextField("address.city", e.target.value)}
              onBlur={() => touch("address.city")}
              disabled={!editable}
            />
          </Field>
          <Field className="sm:col-span-1" id={fieldId("address.state")} label="State" error={err("address.state")}>
            <Select autoComplete="address-level1" value={text["address.state"] ?? ""} placeholder="Choose" onChange={(e) => setTextField("address.state", e.target.value)} disabled={!editable}>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="sm:col-span-2" id={fieldId("address.zip")} label="ZIP code" error={err("address.zip")}>
            <Input
              autoComplete="postal-code"
              inputMode="numeric"
              value={text["address.zip"] ?? ""}
              maxLength={10}
              onChange={(e) => setTextField("address.zip", e.target.value)}
              onBlur={() => touch("address.zip")}
              disabled={!editable}
            />
          </Field>
        </div>
        {!text["address.line1"] && !view.errors["address.line1"] ? (
          <p className="text-sm text-fg-muted" data-testid="address-saved">
            Your mailing address is saved with this checkout. Enter it again only to change it.
          </p>
        ) : null}
      </Group>
    </>
  );

  const confirmStep = (
    <>
      <Group title="Who is giving">
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
        {view.copy.notices.length > 0 ? (
          <Disclosure summary="Who can give, and what is reported" id="checkout-notices">
            <Copy items={view.copy.notices} className="space-y-2" itemClassName="text-sm leading-6 text-fg-muted" />
          </Disclosure>
        ) : null}
      </Group>

      <Group title="Your designation" className="border-t border-line pt-6">
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
        <Copy items={view.copy.designationClosing.filter((c) => c.text === view.designation.irrevocable)} itemClassName="text-sm font-semibold text-fg" />
        <WhyDisclosure items={view.copy.designationClosing.filter((c) => c.text !== view.designation.irrevocable)} summary="Where the designated amount goes" />
      </Group>

      <Group title="Your official acknowledgment" className="border-t border-line pt-6">
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
              onChange={(e) =>
                queue(
                  {
                    contributors: {
                      [c.key]: { eDeliveryConsent: e.target.checked },
                    },
                  },
                  { immediate: true },
                )
              }
              disabled={!editable}
            />
          ) : (
            <p key={c.key} className="text-sm text-fg-muted">
              Enter an email address to choose electronic delivery. Without it, the acknowledgment is mailed to the address above.
            </p>
          );
        })}
      </Group>
    </>
  );

  const recap: Array<{
    label: string;
    value: ReactNode;
    step: CheckoutStepId;
  }> = [
    {
      label: "Gift",
      value: <Money cents={view.order.giftCents} showCents="auto" />,
      step: "gift",
    },
    {
      label: "Designated",
      value: <Money cents={view.order.designatedCents} showCents="auto" />,
      step: view.order.joint && view.order.bothSpouses ? "about" : "gift",
    },
    {
      label: "Filing status",
      value: filingLabel ?? "Not chosen yet",
      step: "about",
    },
    {
      label: view.order.contributors.length > 1 ? "Donors" : "Donor",
      value:
        view.order.contributors
          .map((c) => c.fullName)
          .filter(Boolean)
          .join(" and ") || "Not entered yet",
      step: "about",
    },
    {
      label: "Email",
      value: primary?.email ?? "Not entered yet",
      step: "about",
    },
    ...(addressLine
      ? [
          {
            label: "Mailing address",
            value: addressLine,
            step: "about" as const,
          },
        ]
      : []),
  ];

  const reviewStep = (
    <>
      {placed ? null : (
        <dl className="divide-y divide-line rounded-card border border-line" data-testid="review-recap">
          {recap.map((row) => (
            <div key={row.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <dt className="w-24 shrink-0 text-fg-muted sm:w-32">{row.label}</dt>
              <dd className="min-w-0 flex-1 font-medium break-words text-fg">{row.value}</dd>
              <dd className="shrink-0">
                <button type="button" onClick={() => goTo(row.step)} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-action underline-offset-2 hover:underline">
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Edit
                  <span className="sr-only"> {row.label.toLowerCase()}</span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="review-title" className="space-y-4 rounded-card border border-line bg-sunken p-4 sm:p-5" data-testid="review">
        <div className="flex items-center justify-between gap-3">
          <h3 id="review-title" className="text-base font-semibold text-fg">
            {placed ? "Your gift" : "What you will be charged"}
          </h3>
          {placed ? (
            <Button variant="ghost" size="sm" leadingIcon={<Pencil />} onClick={onChangeSomething}>
              Change something
            </Button>
          ) : null}
        </div>
        {view.review.lines.length > 0 ? (
          <LineItems
            label="What you will be charged"
            showCents
            items={view.review.lines.map((l) => ({
              label: l.label,
              amountCents: l.amountCents,
              hint: l.hint ?? undefined,
            }))}
            total={{
              label: view.mode === "test" ? "Total (sandbox, not charged)" : "Total charged",
              amountCents: view.review.totalCents,
            }}
          />
        ) : (
          <p className="text-sm text-fg-muted">Enter the amount of your gift.</p>
        )}
        {view.review.feeExplanation ? (
          <p className="text-sm text-fg-muted" data-copy-id={view.review.feeExplanation.id}>
            {view.review.feeExplanation.text}
          </p>
        ) : null}

        {placed && payment ? (
          <div data-testid="payment-step">
            <PaymentForm
              payment={payment}
              returnUrl={returnUrl}
              refreshWhilePending
              showLines={false}
              showSandboxNotice={false}
              submitLabel={view.mode === "test" ? "Complete sandbox gift" : undefined}
            />
          </div>
        ) : (
          <Button fullWidth size="lg" onClick={onPlaceOrder} loading={placing} loadingText="Placing your order…" disabled={!editable || placing} data-testid="continue-to-payment">
            Continue to payment
          </Button>
        )}
      </section>
    </>
  );

  const body: Record<CheckoutStepId, ReactNode> = {
    gift: giftStep,
    about: aboutStep,
    confirm: confirmStep,
    review: reviewStep,
  };
  const stepHref = (s: CheckoutStepId) => `${pathname}${stepSearch(searchParams.toString(), s)}`;

  return (
    <div className="space-y-6" data-testid="checkout-form" data-status={view.status} data-stage={stage} data-step={step}>
      <header className="space-y-1.5">
        <h1 className="text-sm font-medium text-fg-muted">
          Give to <span className="text-fg">{view.sgo.name}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          {view.list.source === "provisional_curated" ? <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge> : null}
          <span data-testid="list-label">{view.list.label}</span>
          {view.sgo.ein ? <span className="whitespace-nowrap">EIN {view.sgo.ein}</span> : null}
          {view.mode === "test" ? (
            <Badge tone="caution" size="sm">
              Sandbox
            </Badge>
          ) : null}
        </div>
        <WhyDisclosure items={view.list.notices} summary="About this list" />
      </header>

      <Stepper
        steps={CHECKOUT_STEPS.map((s) => ({
          id: s,
          label: STEP_LABELS[s],
          href: placed ? undefined : stepHref(s),
        }))}
        current={step}
        className="border-y border-line py-4"
      />

      {/* On phones the pinned panel bar names the state on every step; the full reasons open the flow and close it. */}
      {banner === "always" || step === "gift" || step === "review" ? (
        <div className={cn(banner === "mobile" && "lg:hidden")}>
          <CreditBanner banner={view.banner} compact />
        </div>
      ) : null}

      {view.list.refusal ? (
        <Alert tone="danger" role="alert" title="A gift to this organization cannot be accepted">
          <p>{view.list.refusal}</p>
        </Alert>
      ) : null}

      <section aria-labelledby="checkout-step-title" className="space-y-6" data-testid={`step-${step}`}>
        <h2 id="checkout-step-title" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-fg outline-none">
          {STEP_TITLES[step]}
        </h2>

        {formError ? (
          <Alert tone="danger" role="alert" title="Something needs attention">
            <p>{formError}</p>
          </Alert>
        ) : null}

        {summary.length > 0 && !placed ? (
          <div ref={summaryRef} tabIndex={-1} className="outline-none" data-testid="step-problems">
            <Alert tone="warning" title={step === "review" ? "Before you continue" : "Check these before you continue"} role="alert">
              <ul className="list-disc space-y-1 pl-5">
                {summary.map((p) => (
                  <li key={p.path}>
                    <a
                      className="underline"
                      href={`#${fieldId(p.path)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        goTo(p.step, { kind: "field", path: p.path });
                      }}
                    >
                      {step === "review" && p.step !== "review" ? `${STEP_LABELS[p.step]}: ` : ""}
                      {p.message}
                    </a>
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        ) : null}

        <div className="space-y-5">{body[step]}</div>
      </section>

      {placed ? null : (
        <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          {previousStep(step) ? (
            <Button variant="ghost" leadingIcon={<ChevronLeft />} onClick={onBack} data-testid="step-back">
              Back
            </Button>
          ) : null}
          <p className="mr-auto text-xs text-fg-muted" aria-live="polite">
            {saving ? "Saving…" : "Saved as you go."}
          </p>
          {step !== "review" ? (
            <Button onClick={onContinue} trailingIcon={<ArrowRight />} loading={checking} loadingText="Checking…" disabled={checking} data-testid="step-continue">
              Continue
            </Button>
          ) : null}
        </footer>
      )}
    </div>
  );
}
