import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cn } from "./cn";

const PADDING = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;
const TONE = {
  default: "border-line bg-surface",
  sunken: "border-line bg-sunken",
  brand: "border-brand-line bg-brand-surface",
  caution: "border-dashed border-caution-line bg-caution-surface",
} as const;

export interface CardProps {
  as?: "div" | "section" | "article" | "li" | "aside";
  /** `none` when the card holds a Table, CardHeader/CardBody/CardFooter or its own sections. Default `md`. */
  padding?: keyof typeof PADDING;
  tone?: keyof typeof TONE;
  /** Lifts on hover. Only for a card that is itself (or contains) one link — see `href`. */
  interactive?: boolean;
  /** Makes the whole card one link (the card becomes an anchor: do not nest other links or buttons inside). */
  href?: string;
  className?: string;
  children?: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}

/** A bordered surface that groups related content. Borders, not shadows, carry the structure. */
export function Card({ as: Tag = "div", padding = "md", tone = "default", interactive, href, className, children, ...rest }: CardProps) {
  const classes = cn(
    "block rounded-card border",
    TONE[tone],
    PADDING[padding],
    (interactive || href) && "transition-[border-color,box-shadow] hover:border-ink-400 hover:shadow-md",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small label above the title. */
  eyebrow?: ReactNode;
  /** Buttons or a badge at the end of the header row. */
  actions?: ReactNode;
  /** Heading level for the title. Default h2. */
  level?: 2 | 3 | 4;
  /** Set when the header sits in a `padding="none"` card and needs its own padding and divider. */
  divided?: boolean;
  className?: string;
  id?: string;
}

export function CardHeader({ title, description, eyebrow, actions, level = 2, divided, className, id }: CardHeaderProps) {
  const Heading = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", divided && "border-b border-line px-5 py-4 sm:px-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{eyebrow}</p> : null}
        <Heading id={id} className="text-base font-semibold text-fg">
          {title}
        </Heading>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Padded body for a `padding="none"` card. */
export function CardBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}

/** Footer strip for a `padding="none"` card: totals, pagination, secondary actions. */
export function CardFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("rounded-b-card border-t border-line bg-canvas px-5 py-3 sm:px-6", className)}>{children}</div>;
}

export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level. Default h2. */
  level?: 2 | 3;
  className?: string;
  children?: ReactNode;
  id?: string;
}

/** A titled region of a page (not a box). Use it to split a page into named parts; put Cards inside. */
export function Section({ title, description, actions, level = 2, className, children, id }: SectionProps) {
  const generated = useId();
  const headingId = `${id ?? `sec${generated}`}-title`;
  const Heading = `h${level}` as "h2" | "h3";
  return (
    <section id={id} aria-labelledby={headingId} className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Heading id={headingId} className={cn("font-semibold text-fg", level === 2 ? "text-lg" : "text-base")}>
            {title}
          </Heading>
          {description ? <p className="mt-1 max-w-reading text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface Breadcrumb {
  label: ReactNode;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Trail back up the hierarchy. The current page is the title, so it is not repeated here. */
  breadcrumbs?: Breadcrumb[];
  /** A single "back" link instead of breadcrumbs (detail pages on phones, step flows). */
  back?: { href: string; label: ReactNode };
  /** Status badges and ids shown beside the title. */
  meta?: ReactNode;
  /** Page-level buttons. One primary at most. */
  actions?: ReactNode;
  /** `display` sets the title in the serif display face — donor and family pages. `default` is the compact dashboard title. */
  variant?: "default" | "display";
  className?: string;
}

/** The h1 of a page, with its trail, status and actions. Every page has exactly one. */
export function PageHeader({ title, description, breadcrumbs, back, meta, actions, variant = "default", className }: PageHeaderProps) {
  return (
    <header className={cn("space-y-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight aria-hidden="true" className="size-4 text-fg-disabled" /> : null}
                {crumb.href ? (
                  <Link href={crumb.href} className="rounded-sm hover:text-fg hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      {back ? (
        <Link href={back.href} className="inline-flex min-h-6 items-center gap-1 rounded-sm text-sm font-medium text-fg-muted hover:text-fg">
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={cn("text-fg", variant === "display" ? "font-display text-display-sm sm:text-display-md" : "text-2xl font-semibold tracking-tight")}>{title}</h1>
            {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
          </div>
          {description ? <p className={cn("mt-2 max-w-reading text-fg-muted", variant === "display" ? "text-lg" : "text-sm")}>{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
