import type { ReactNode } from "react";
import { cn } from "./cn";

export interface CheckboxGroupProps {
  /** `<Checkbox>` elements. */
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Accepted so the group can sit directly inside `<Fieldset>`; each Checkbox carries its own required/invalid state. */
  "aria-invalid"?: boolean | "true" | "false";
  required?: boolean;
}

/** Lays out a set of checkboxes and takes the wiring from `<Fieldset label=…>`. */
export function CheckboxGroup({ children, className, id, ...aria }: CheckboxGroupProps) {
  return (
    <div id={id} role="group" aria-labelledby={aria["aria-labelledby"]} aria-describedby={aria["aria-describedby"]} className={cn("flex flex-col gap-1", className)}>
      {children}
    </div>
  );
}
