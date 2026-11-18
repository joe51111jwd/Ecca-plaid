import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { cn } from "./cn";

const MARK_SIZE = { sm: "size-6", md: "size-8", lg: "size-10" } as const;
const WORD_SIZE = { sm: "text-lg", md: "text-[1.375rem]", lg: "text-[1.75rem]" } as const;

export interface LogoMarkProps {
  size?: keyof typeof MARK_SIZE;
  /** `brand` on light surfaces, `inverse` on dark brand surfaces. */
  tone?: "brand" | "inverse";
  className?: string;
  /** Accessible name. Leave empty when the wordmark or other text beside it already names the product. */
  title?: string;
}

/**
 * The mark: a "P" whose bowl carries a seal — a page that has been checked. Original geometry, two colours.
 * The same drawing is the favicon (src/app/icon.svg) and public/brand/mark.svg.
 */
export function LogoMark({ size = "md", tone = "brand", className, title }: LogoMarkProps) {
  const field = tone === "inverse" ? "#ffffff" : "var(--color-brand-700)";
  const glyph = tone === "inverse" ? "var(--color-brand-800)" : "#ffffff";
  return (
    <svg viewBox="0 0 32 32" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className={cn("shrink-0", MARK_SIZE[size], className)}>
      <rect width="32" height="32" rx="8" style={{ fill: field }} />
      <path d="M10.5 7.5h8a6.5 6.5 0 0 1 0 13h-4v4h-4v-17Z" style={{ fill: glyph }} />
      <circle cx="18.25" cy="14" r="2.75" style={{ fill: "var(--color-accent-400)" }} />
    </svg>
  );
}

export interface LogoProps {
  size?: keyof typeof MARK_SIZE;
  tone?: "brand" | "inverse";
  /** `full` = mark + wordmark, `mark` = mark only, `wordmark` = name only. */
  variant?: "full" | "mark" | "wordmark";
  /** Wrap in a link (usually "/"). */
  href?: string;
  className?: string;
}

/** Product logo. The name comes from BRAND in src/lib/brand — never type it by hand. */
export function Logo({ size = "md", tone = "brand", variant = "full", href, className }: LogoProps) {
  const content = (
    <>
      {variant !== "wordmark" ? <LogoMark size={size} tone={tone} title={variant === "mark" ? BRAND.name : undefined} /> : null}
      {variant !== "mark" ? <span className={cn("font-display leading-none font-semibold tracking-tight", WORD_SIZE[size], tone === "inverse" ? "text-white" : "text-brand-900")}>{BRAND.name}</span> : null}
    </>
  );
  const classes = cn("inline-flex items-center gap-2.5", className);
  if (href) {
    return (
      <Link href={href} aria-label={`${BRAND.name} — home`} className={cn(classes, "rounded-md")}>
        {content}
      </Link>
    );
  }
  return <span className={classes}>{content}</span>;
}
