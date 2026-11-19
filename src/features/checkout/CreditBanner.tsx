import { CircleCheck, FlaskConical, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/components/ui";
import type { CreditBanner as CreditBannerData } from "./view-model";

const TONE: Record<CreditBannerData["tone"], { box: string; icon: typeof Info }> = {
  success: { box: "border-success-line bg-success-surface text-success-fg", icon: CircleCheck },
  sandbox: { box: "hatch border-dashed border-caution-line bg-caution-surface text-caution-fg", icon: FlaskConical },
  warning: { box: "border-warning-line bg-warning-surface text-warning-fg", icon: TriangleAlert },
  info: { box: "border-info-line bg-info-surface text-info-fg", icon: Info },
};

export interface CreditBannerProps {
  banner: CreditBannerData;
  /** Smaller type for the panel column. */
  compact?: boolean;
  className?: string;
}

/**
 * Whether a gift made now would be on the credit-eligible path, and if not, exactly why. Every sentence is the
 * taxmath registry's (through the checkout view); this only lays it out. Shown at the top of the checkout so a
 * sandbox or pre-start gift is never mistaken for a credit-eligible one.
 */
export function CreditBanner({ banner, compact, className }: CreditBannerProps) {
  const { box, icon: Icon } = TONE[banner.tone];
  return (
    <div
      role="status"
      data-testid="credit-banner"
      data-state={banner.state}
      data-reasons={banner.reasonCodes.join(" ")}
      className={cn("rounded-card border", box, compact ? "p-3 text-sm leading-5" : "p-4 text-base", className)}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={cn("mt-0.5 shrink-0", compact ? "size-4" : "size-5")} />
        <div className={cn("min-w-0", compact ? "space-y-1.5" : "space-y-2")}>
          <p className={compact ? "font-medium" : "font-semibold"}>{banner.title}</p>
          {banner.details.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5">
              {banner.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          {banner.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
