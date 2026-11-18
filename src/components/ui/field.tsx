import { CircleAlert } from "lucide-react";
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";

/** What Field hands to its control. Every kit control accepts these; spread them on a custom one. */
export interface FieldControlProps {
  id: string;
  "aria-labelledby": string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** Help shown under the label, before the control. One short sentence. */
  hint?: ReactNode;
  /** Validation message. When set, the control is marked invalid and the message is announced with it. */
  error?: ReactNode | null | false;
  /** Marks the control required and shows the marker. In family flows prefer marking the few optional fields instead. */
  required?: boolean;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  /**
   * `label` (default) for a single input, select or textarea.
   * `group` renders fieldset/legend, for one question answered with several inputs:
   * RadioGroup, DateInput, OtpInput, a set of checkboxes.
   */
  as?: "label" | "group";
  /** Keeps the label for screen readers but hides it visually (search boxes, table filters). */
  hideLabel?: boolean;
  /** Sits at the end of the label row: a DefinitionTooltip, a "Why do we ask?" link. */
  labelAction?: ReactNode;
  /** Control id. Generated when omitted. */
  id?: string;
  locale?: UiLocale;
  className?: string;
  /** One kit control, or a function that receives the wiring props when the control needs a wrapper. */
  children: ReactElement | ((control: FieldControlProps) => ReactNode);
}

/**
 * Label + hint + control + error, wired for assistive technology.
 * Field injects id, aria-labelledby, aria-describedby, aria-invalid and required into its child.
 */
export function Field({ label, hint, error, required, optional, as = "label", hideLabel, labelAction, id, locale = "en", className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `f${generated}`;
  const labelId = `${controlId}-label`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const t = uiStrings(locale);

  const control: FieldControlProps = {
    id: controlId,
    "aria-labelledby": labelId,
    ...(hintId || errorId ? { "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { required: true } : {}),
  };

  let rendered: ReactNode;
  if (typeof children === "function") {
    rendered = children(control);
  } else if (isValidElement<Record<string, unknown>>(children)) {
    const own = children.props["aria-describedby"];
    rendered = cloneElement(children, {
      ...control,
      ...(typeof own === "string" && own ? { "aria-describedby": [own, control["aria-describedby"]].filter(Boolean).join(" ") } : {}),
    });
  } else {
    rendered = children;
  }

  const labelText = (
    <>
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-danger-600">
          *
        </span>
      ) : null}
      {optional ? <span className="ml-1.5 font-normal text-fg-muted">({t.optional})</span> : null}
    </>
  );
  const labelClasses = cn("text-sm font-medium text-fg in-data-[density=touch]:text-base", hideLabel && "sr-only");
  const labelRow = (node: ReactNode) =>
    labelAction && !hideLabel ? (
      <div className="flex items-baseline justify-between gap-3">
        {node}
        <span className="shrink-0 text-sm">{labelAction}</span>
      </div>
    ) : (
      node
    );

  const body = (
    <>
      {hint ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
      <div className={cn(!hideLabel && "mt-1.5")}>{rendered}</div>
      {error ? (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger-fg">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );

  if (as === "group") {
    return (
      <fieldset className={cn("min-w-0", className)}>
        {labelRow(
          <legend id={labelId} className={cn(labelClasses, "p-0")}>
            {labelText}
          </legend>,
        )}
        {body}
      </fieldset>
    );
  }
  return (
    <div className={cn("min-w-0", className)}>
      {labelRow(
        <label id={labelId} htmlFor={controlId} className={cn(labelClasses, "block")}>
          {labelText}
        </label>,
      )}
      {body}
    </div>
  );
}

/** Field with fieldset/legend semantics: one question, several inputs (RadioGroup, DateInput, OtpInput, checkbox sets). */
export function Fieldset(props: Omit<FieldProps, "as">) {
  return <Field {...props} as="group" />;
}
