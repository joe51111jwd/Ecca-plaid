"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "./button";
import { cn } from "./cn";
import { uiStrings, type UiLocale, type UiStrings } from "./locale";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based copy below (permission denied, insecure context).
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function useCopy(value: string) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    const ok = await writeClipboard(value);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return { state, copy };
}

type CopyLabels = Partial<Pick<UiStrings, "copy" | "copied" | "copyFailed">>;

export interface CopyButtonProps {
  /** The text placed on the clipboard. */
  value: string;
  /** Visible label. Defaults to "Copy". Ignored when `iconOnly`. */
  children?: ReactNode;
  /** What is being copied, for screen readers when the visible label is generic: "Copy API key". */
  label?: string;
  iconOnly?: boolean;
  variant?: Exclude<ButtonVariant, "link" | "danger">;
  size?: ButtonSize;
  locale?: UiLocale;
  labels?: CopyLabels;
  className?: string;
}

/** Copies a value and confirms it visibly and to screen readers ("Copied"). */
export function CopyButton({ value, children, label, iconOnly, variant = "secondary", size = "sm", locale = "en", labels, className }: CopyButtonProps) {
  const t = uiStrings(locale, labels);
  const { state, copy } = useCopy(value);
  const icon = state === "copied" ? <Check className="text-success-600" /> : <Copy />;
  const status = state === "copied" ? t.copied : state === "failed" ? t.copyFailed : "";
  return (
    <span className={cn("inline-flex", className)}>
      {iconOnly ? (
        <IconButton label={label ?? t.copy} icon={icon} variant={variant} size={size} onClick={copy} />
      ) : (
        <Button variant={variant} size={size} leadingIcon={icon} onClick={copy} aria-label={label}>
          {state === "copied" ? t.copied : state === "failed" ? t.copyFailed : (children ?? t.copy)}
        </Button>
      )}
      <span role="status" className="sr-only">
        {status}
      </span>
    </span>
  );
}

export interface CodeBlockProps {
  /** The exact text. Whitespace is preserved. */
  code: string;
  /** Header text: a file name, "Request", "Embed snippet". */
  title?: ReactNode;
  /** Shown as a small tag in the header ("bash", "json", "html"). There is no syntax colouring. */
  language?: string;
  /** Show the copy button. Default true. */
  copyable?: boolean;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
  /** `dark` for developer-facing snippets; `light` inside dense settings pages. */
  tone?: "dark" | "light";
  locale?: UiLocale;
  className?: string;
}

/** A block of code or configuration to read or copy: request examples, embed snippets, webhook payloads. */
export function CodeBlock({ code, title, language, copyable = true, wrap, tone = "dark", locale = "en", className }: CodeBlockProps) {
  const dark = tone === "dark";
  return (
    <figure data-surface={dark ? "inverse" : undefined} className={cn("max-w-full min-w-0 overflow-hidden rounded-card border", dark ? "border-ink-800 bg-ink-900 text-ink-100" : "border-line bg-sunken text-fg", className)}>
      {title || language || copyable ? (
        <figcaption className={cn("flex min-h-11 items-center justify-between gap-3 border-b px-4 py-1.5 text-xs", dark ? "border-ink-700 text-ink-300" : "border-line text-fg-muted")}>
          <span className="flex min-w-0 items-center gap-2">
            {title ? <span className="truncate font-medium">{title}</span> : null}
            {language ? <span className={cn("rounded px-1.5 py-0.5 font-mono", dark ? "bg-ink-800" : "bg-ink-200")}>{language}</span> : null}
          </span>
          {copyable ? <CopyButton value={code} variant="ghost" size="sm" locale={locale} /> : null}
        </figcaption>
      ) : null}
      {/* Scrollable code must be reachable by keyboard. */}
      <pre tabIndex={0} className={cn("overflow-x-auto p-4 font-mono text-[0.8125rem] leading-6", wrap && "break-words whitespace-pre-wrap")}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export interface CopyFieldProps {
  /** Names the value for screen readers and is shown above it: "Publishable key", "Signing secret". */
  label: string;
  value: string;
  /** Mask the value until the person chooses to reveal it (secrets shown once, signing secrets). */
  secret?: boolean;
  /** A line under the field: "Shown once. Store it now." */
  hint?: ReactNode;
  locale?: UiLocale;
  className?: string;
}

/** A read-only value with a copy button: API keys, webhook secrets, family links, ids. */
export function CopyField({ label, value, secret, hint, locale = "en", className }: CopyFieldProps) {
  const t = uiStrings(locale);
  const [revealed, setRevealed] = useState(!secret);
  const masked = "•".repeat(Math.min(Math.max(value.length, 8), 32));
  return (
    <div className={cn("min-w-0", className)}>
      <p className="mb-1.5 text-sm font-medium text-fg">{label}</p>
      <div className="flex items-stretch gap-2">
        <div className="flex min-h-control-md min-w-0 flex-1 items-center rounded-control border border-line-strong bg-sunken px-3">
          <code aria-label={label} className="block w-full overflow-x-auto font-mono text-[0.8125rem] whitespace-nowrap text-fg">
            {revealed ? value : masked}
          </code>
        </div>
        {secret ? (
          <IconButton label={revealed ? `${t.hide} ${label}` : `${t.show} ${label}`} icon={revealed ? <EyeOff /> : <Eye />} variant="secondary" aria-pressed={revealed} onClick={() => setRevealed((v) => !v)} />
        ) : null}
        <CopyButton value={value} label={`${t.copy} ${label}`} size="md" locale={locale} />
      </div>
      {hint ? <p className="mt-1.5 text-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}
