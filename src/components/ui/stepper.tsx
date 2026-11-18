import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";
import { ProgressBar } from "./progress-bar";

export interface Step {
  id: string;
  label: ReactNode;
  /** Makes a completed step a link back to it. Future steps are never links. */
  href?: string;
}

export interface StepperProps {
  steps: Step[];
  /** The id of the step the person is on. */
  current: string;
  /**
   * `auto` (default): compact on phones, numbered row from the `sm` breakpoint.
   * `compact`: "Step 2 of 5 · Household" with a bar — always, for narrow cards and embeds.
   * `full`: always the numbered row.
   */
  variant?: "auto" | "compact" | "full";
  locale?: UiLocale;
  labels?: Partial<Pick<UiStrings, "progress" | "stepOf" | "stepCompleted" | "stepCurrent">>;
  className?: string;
}

/**
 * Where the person is in a multi-step flow (family intake, donor checkout).
 * It shows position, not a promise: keep step names short and concrete ("Household", "Documents").
 */
export function Stepper({ steps, current, variant = "auto", locale = "en", labels, className }: StepperProps) {
  const t = uiStrings(locale, labels);
  const found = steps.findIndex((step) => step.id === current);
  const index = found === -1 ? 0 : found;
  const total = steps.length;
  const currentStep = steps[index];

  const compact = (
    <div className={cn(variant === "auto" && "sm:hidden")}>
      <p className="mb-2 text-sm text-fg-muted">
        <span className="font-semibold text-fg">{t.stepOf(index + 1, total)}</span>
        {currentStep ? <span> · {currentStep.label}</span> : null}
      </p>
      <ProgressBar value={index + 1} max={total} label={t.progress} size="sm" />
    </div>
  );

  const full = (
    <ol className={cn("items-start", variant === "auto" ? "hidden sm:flex" : "flex")}>
      {steps.map((step, i) => {
        const state = i < index ? "done" : i === index ? "current" : "upcoming";
        const marker = (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold nums",
              state === "done" && "border-action bg-action text-action-fg",
              state === "current" && "border-action bg-surface text-brand-fg shadow-[0_0_0_3px_var(--color-brand-100)]",
              state === "upcoming" && "border-line-strong bg-surface text-fg-muted",
            )}
          >
            {state === "done" ? <Check aria-hidden="true" strokeWidth={3} className="size-3.5" /> : i + 1}
          </span>
        );
        const text = (
          <span className={cn("mt-2 block text-center text-xs leading-4", state === "current" ? "font-semibold text-fg" : "font-medium text-fg-muted")}>
            {step.label}
            {state === "done" ? <span className="sr-only"> ({t.stepCompleted})</span> : null}
          </span>
        );
        return (
          <li key={step.id} aria-current={state === "current" ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center px-1">
            {i > 0 ? <span aria-hidden="true" className={cn("absolute top-3.5 right-1/2 left-[-50%] mx-4 h-px", i <= index ? "bg-action" : "bg-line-strong")} /> : null}
            {state === "done" && step.href ? (
              <Link href={step.href} className="group/step relative flex flex-col items-center rounded-sm">
                {marker}
                <span className="group-hover/step:underline">{text}</span>
              </Link>
            ) : (
              <span className="relative flex flex-col items-center">
                {marker}
                {text}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <nav aria-label={t.progress} className={className}>
      {variant !== "full" ? compact : null}
      {variant !== "compact" ? full : null}
    </nav>
  );
}

/** Same component: `ProgressSteps` is the name used in the family-flow designs. */
export const ProgressSteps = Stepper;
