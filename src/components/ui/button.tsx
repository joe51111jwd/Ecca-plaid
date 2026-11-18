import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { isExternalHref } from "./href";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 " +
  "data-[loading=true]:disabled:opacity-100 data-[loading=true]:disabled:cursor-progress";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "rounded-control bg-action text-action-fg shadow-xs hover:bg-action-hover active:bg-action-active",
  secondary: "rounded-control border border-line-strong bg-surface text-fg shadow-xs hover:bg-sunken active:bg-sunken",
  ghost: "rounded-control text-fg hover:bg-sunken active:bg-sunken",
  danger: "rounded-control bg-danger-solid text-danger-solid-fg shadow-xs hover:bg-danger-700 active:bg-danger-800",
  link: "min-h-6 rounded-sm text-link underline decoration-1 underline-offset-4 hover:text-link-hover hover:decoration-2",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-control-sm px-3 text-control",
  md: "h-control-md px-4 text-control",
  lg: "h-control-lg px-5 text-base",
};

const LINK_SIZE: Record<ButtonSize, string> = { sm: "text-control", md: "text-control", lg: "text-base" };
const ICON_SIZE: Record<ButtonSize, string> = { sm: "[&>svg]:size-4", md: "[&>svg]:size-4", lg: "[&>svg]:size-5" };

/** The class string behind Button, for the rare element that must look like one (a file-input label, a <summary>). */
export function buttonClasses(opts: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {}): string {
  const { variant = "primary", size = "md", fullWidth = false } = opts;
  return cn(BASE, VARIANT[variant], variant === "link" ? LINK_SIZE[size] : SIZE[size], fullWidth && "w-full");
}

interface ButtonOwnProps {
  variant?: ButtonVariant;
  /** `sm` for dense dashboards, `md` default, `lg` for the main action of a family or donor step. */
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks activation. For server-action forms use SubmitButton instead. */
  loading?: boolean;
  /** Replaces the label while loading (e.g. "Saving…"). */
  loadingText?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

type ButtonAsButton = ButtonOwnProps & Omit<ComponentProps<"button">, keyof ButtonOwnProps | "href"> & { href?: undefined };

type ButtonAsLink = ButtonOwnProps &
  Omit<ComponentProps<"a">, keyof ButtonOwnProps | "href"> & {
    /** Renders a link that looks like a button: next/link for in-app paths, a plain anchor for external URLs. */
    href: string;
    prefetch?: boolean | null;
    replace?: boolean;
    scroll?: boolean;
    /** A disabled link is rendered without an href and announced as disabled. */
    disabled?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

function ButtonContent({ size, loading, loadingText, leadingIcon, trailingIcon, children }: Pick<ButtonOwnProps, "loading" | "loadingText" | "leadingIcon" | "trailingIcon" | "children"> & { size: ButtonSize }) {
  const icon = cn("inline-flex shrink-0", ICON_SIZE[size]);
  return (
    <>
      {loading ? (
        <Spinner size={size === "lg" ? "md" : "sm"} />
      ) : leadingIcon ? (
        <span aria-hidden="true" className={icon}>
          {leadingIcon}
        </span>
      ) : null}
      {loading && loadingText ? loadingText : children}
      {trailingIcon && !loading ? (
        <span aria-hidden="true" className={icon}>
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
}

/**
 * The one button. Pass `href` to render a link with the same look.
 * Use one primary button per view; pair it with secondary or ghost for the alternatives.
 */
export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", loading = false, loadingText, leadingIcon, trailingIcon, fullWidth, className, children, ...rest } = props;
  const classes = cn(buttonClasses({ variant, size, fullWidth }), className);
  const content = (
    <ButtonContent size={size} loading={loading} loadingText={loadingText} leadingIcon={leadingIcon} trailingIcon={trailingIcon}>
      {children}
    </ButtonContent>
  );

  if (typeof rest.href === "string") {
    const { href, prefetch, replace, scroll, disabled, target, rel, ...anchor } = rest as Omit<ButtonAsLink, keyof ButtonOwnProps>;
    if (disabled || loading) {
      return (
        <a {...anchor} role="link" aria-disabled="true" aria-busy={loading || undefined} data-loading={loading || undefined} className={classes}>
          {content}
        </a>
      );
    }
    if (isExternalHref(href)) {
      return (
        <a {...anchor} href={href} target={target} rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)} className={classes}>
          {content}
        </a>
      );
    }
    return (
      <Link {...anchor} href={href} prefetch={prefetch} replace={replace} scroll={scroll} target={target} rel={rel} className={classes}>
        {content}
      </Link>
    );
  }

  const { type = "button", disabled, ...button } = rest as Omit<ButtonAsButton, keyof ButtonOwnProps>;
  return (
    <button {...button} type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-loading={loading || undefined} className={classes}>
      {content}
    </button>
  );
}

const ICON_BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "size-control-sm [&>svg]:size-4",
  md: "size-control-md [&>svg]:size-5",
  lg: "size-control-lg [&>svg]:size-5",
};

interface IconButtonOwnProps {
  /** Required: the accessible name, also shown as the native tooltip. Say what it does ("Remove pay stub"), not what it is. */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, "link">;
  size?: ButtonSize;
  className?: string;
}

type IconButtonAsButton = IconButtonOwnProps & Omit<ComponentProps<"button">, keyof IconButtonOwnProps | "href" | "children" | "aria-label"> & { href?: undefined };
type IconButtonAsLink = IconButtonOwnProps & Omit<ComponentProps<"a">, keyof IconButtonOwnProps | "href" | "children" | "aria-label"> & { href: string };
export type IconButtonProps = IconButtonAsButton | IconButtonAsLink;

/** A square button that shows only an icon. `label` is mandatory because the icon alone is not an accessible name. */
export function IconButton(props: IconButtonProps) {
  const { label, icon, variant = "ghost", size = "md", className, ...rest } = props;
  const classes = cn(BASE, VARIANT[variant], ICON_BUTTON_SIZE[size], "shrink-0", className);
  if (typeof rest.href === "string") {
    const { href, target, rel, ...anchor } = rest as Omit<IconButtonAsLink, keyof IconButtonOwnProps>;
    if (isExternalHref(href)) {
      return (
        <a {...anchor} href={href} target={target} rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)} aria-label={label} title={label} className={classes}>
          {icon}
        </a>
      );
    }
    return (
      <Link {...anchor} href={href} target={target} rel={rel} aria-label={label} title={label} className={classes}>
        {icon}
      </Link>
    );
  }
  const { type = "button", ...button } = rest as Omit<IconButtonAsButton, keyof IconButtonOwnProps>;
  return (
    <button {...button} type={type} aria-label={label} title={label} className={classes}>
      {icon}
    </button>
  );
}

export interface TextLinkProps extends Omit<ComponentProps<"a">, "href"> {
  href: string;
  /** `quiet` drops the underline until hover; use only where the surrounding layout makes it obviously a link (nav, table cells). */
  tone?: "default" | "quiet";
}

/** An inline text link. In-app paths use next/link; external URLs open as plain anchors. */
export function TextLink({ href, tone = "default", className, children, target, rel, ...rest }: TextLinkProps) {
  const classes = cn(
    "rounded-sm text-link decoration-1 underline-offset-[3px] hover:text-link-hover hover:underline hover:decoration-2",
    tone === "default" && "underline",
    className,
  );
  if (isExternalHref(href)) {
    return (
      <a {...rest} href={href} target={target} rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link {...rest} href={href} target={target} rel={rel} className={classes}>
      {children}
    </Link>
  );
}
