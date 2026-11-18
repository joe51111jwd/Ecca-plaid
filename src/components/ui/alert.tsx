import { CircleAlert, CircleCheck, FlaskConical, Info, Megaphone, Scale, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral" | "legal";

const ALERT_TONE: Record<AlertTone, string> = {
  info: "border-info-line bg-info-surface text-info-fg",
  success: "border-success-line bg-success-surface text-success-fg",
  warning: "border-warning-line bg-warning-surface text-warning-fg",
  danger: "border-danger-line bg-danger-surface text-danger-fg",
  neutral: "border-line bg-sunken text-fg",
  legal: "border-line border-l-4 border-l-ink-400 bg-surface text-fg-muted",
};

const ALERT_ICON: Record<AlertTone, ReactNode> = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
  neutral: <Info />,
  legal: <Scale />,
};

export interface AlertProps {
  /**
   * info = context; success = it worked; warning = a person must act; danger = it failed / cannot continue;
   * neutral = an aside; legal = a legal or tax note (never styled as an error, never hidden).
   */
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Replace the default icon, or pass null for none. */
  icon?: ReactNode | null;
  /** Buttons or links under the text. */
  actions?: ReactNode;
  /** Set role="alert" (interrupts) or "status" (polite) only for messages that appear after an action. Static notes need neither. */
  role?: "alert" | "status" | "note";
  className?: string;
  id?: string;
}

/**
 * An in-flow message box. For form validation use FormError; for a provisional number use ProvisionalNotice;
 * for a page-wide strip use Banner.
 */
export function Alert({ tone = "info", title, children, icon, actions, role, className, id }: AlertProps) {
  const shownIcon = icon === undefined ? ALERT_ICON[tone] : icon;
  return (
    <div id={id} role={role ?? (tone === "legal" ? "note" : undefined)} className={cn("rounded-card border p-4", ALERT_TONE[tone], className)}>
      <div className="flex items-start gap-3">
        {shownIcon ? (
          <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&>svg]:size-5">
            {shownIcon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 text-sm">
          {title ? <p className={cn("font-semibold", tone === "legal" && "text-fg")}>{title}</p> : null}
          {children ? <div className={cn(title && "mt-1", "space-y-2")}>{children}</div> : null}
          {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Same component under the name designers use for a non-urgent aside. */
export const Callout = Alert;

/** A legal or tax note: plain, always visible, never dressed up as an error. Shorthand for `<Alert tone="legal">`. */
export function LegalNote(props: Omit<AlertProps, "tone">) {
  return <Alert {...props} tone="legal" />;
}

export type BannerTone = "sandbox" | "info" | "warning" | "danger" | "success" | "brand";

const BANNER_TONE: Record<BannerTone, string> = {
  sandbox: "hatch border-b border-dashed border-caution-line bg-caution-surface text-caution-fg",
  info: "border-b border-info-line bg-info-surface text-info-fg",
  warning: "border-b border-warning-line bg-warning-surface text-warning-fg",
  danger: "bg-danger-solid text-danger-solid-fg",
  success: "border-b border-success-line bg-success-surface text-success-fg",
  brand: "bg-brand-900 text-white",
};

const BANNER_ICON: Record<BannerTone, ReactNode> = {
  sandbox: <FlaskConical />,
  info: <Info />,
  warning: <TriangleAlert />,
  danger: <CircleAlert />,
  success: <CircleCheck />,
  brand: <Megaphone />,
};

export interface BannerProps {
  /** `sandbox` is reserved for "this is test data / no money moves". */
  tone?: BannerTone;
  children: ReactNode;
  /** A link or small button at the end. */
  action?: ReactNode;
  icon?: ReactNode | null;
  /** Announce politely when it appears after load. */
  live?: boolean;
  className?: string;
}

/** A full-width strip at the very top of a page or shell: sandbox mode, an outage, a deadline. One at a time. */
export function Banner({ tone = "info", children, action, icon, live, className }: BannerProps) {
  const shownIcon = icon === undefined ? BANNER_ICON[tone] : icon;
  return (
    <div role={live ? "status" : undefined} data-surface={tone === "brand" ? "inverse" : undefined} className={cn("px-4 py-2 text-sm font-medium", BANNER_TONE[tone], className)}>
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        {shownIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:size-4">
            {shownIcon}
          </span>
        ) : null}
        <span>{children}</span>
        {action ? <span className="shrink-0">{action}</span> : null}
      </div>
    </div>
  );
}
