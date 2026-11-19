import { FlaskConical, Radio } from "lucide-react";
import type { ReactNode } from "react";
import type { Mode } from "@/db/schema";
import { cn } from "@/components/ui";

export interface ModeSwitchProps {
  mode: Mode;
  liveAvailable: boolean;
  /** Server action that stores the choice and refreshes the page. */
  action: (formData: FormData) => void | Promise<void>;
}

/**
 * The test/live switch in the top bar. A plain form with two submit buttons, so it works before hydration. Live is
 * disabled (with the reason in its title) until the organization's listing is verified.
 */
export function ModeSwitch({ mode, liveAvailable, action }: ModeSwitchProps) {
  const option = (value: Mode, label: string, icon: ReactNode, disabled: boolean, title: string) => {
    const active = mode === value;
    return (
      <button
        type="submit"
        name="mode"
        value={value}
        disabled={disabled || active}
        aria-pressed={active}
        title={title}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold transition-colors [&>svg]:size-3.5",
          active ? (value === "test" ? "bg-caution-surface text-caution-fg ring-1 ring-caution-line" : "bg-success-surface text-success-fg ring-1 ring-success-line") : "text-fg-muted hover:bg-sunken hover:text-fg",
          disabled && !active && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        {icon}
        {label}
      </button>
    );
  };
  return (
    <form action={action} aria-label="Data mode" className="flex items-center gap-0.5 rounded-control border border-line bg-surface p-0.5">
      {option("test", "Test", <FlaskConical aria-hidden="true" />, false, "Sandbox data: test verifications, sandbox gifts and sandbox donor numbers")}
      {option("live", "Live", <Radio aria-hidden="true" />, !liveAvailable, liveAvailable ? "Real data" : "Live mode opens once a platform admin has verified your organization against the SGO list")}
    </form>
  );
}
