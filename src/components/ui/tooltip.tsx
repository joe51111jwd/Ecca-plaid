"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { uiStrings, type UiLocale } from "./locale";
import { placePopover, type PopoverPlacement } from "./position";

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex='-1'])";

export interface TooltipProps {
  /** Short supplementary text. Never the only place a fact lives: touch screens do not show tooltips. */
  content: ReactNode;
  side?: PopoverPlacement;
  /** Milliseconds before it shows on hover. Keyboard focus shows it immediately. */
  delay?: number;
  className?: string;
  /** The element the tooltip describes. If it is not focusable itself, the wrapper becomes focusable. */
  children: ReactNode;
}

/**
 * Hover/focus hint for a control. It is hoverable, dismissible with Esc, and rendered in the browser top
 * layer so tables and dialogs cannot clip it.
 */
export function Tooltip({ content, side = "top", delay = 350, className, children }: TooltipProps) {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selfFocusable, setSelfFocusable] = useState(false);

  // Point the wrapped control at the tooltip. Done on the DOM because the child may be server-rendered.
  useEffect(() => {
    const target = wrapper.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (!target) {
      setSelfFocusable(true);
      return;
    }
    const before = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before) target.setAttribute("aria-describedby", before);
      else target.removeAttribute("aria-describedby");
    };
  }, [id]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const el = bubble.current;
    if (el?.matches(":popover-open")) el.hidePopover();
  }, []);

  const show = useCallback(
    (wait: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const el = bubble.current;
        if (!el || !el.isConnected || typeof el.showPopover !== "function") return;
        if (!el.matches(":popover-open")) el.showPopover();
        placePopover(wrapper.current, el, side, 6);
      }, wait);
    },
    [side],
  );

  useEffect(() => hide, [hide]);

  return (
    <span
      ref={wrapper}
      className={cn("inline-flex", className)}
      tabIndex={selfFocusable ? 0 : undefined}
      aria-describedby={selfFocusable ? id : undefined}
      onMouseEnter={() => show(delay)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      {children}
      <span ref={bubble} id={id} role="tooltip" popover="manual" className="ui-popover ui-tooltip max-w-64 px-2.5 py-1.5 text-xs leading-4 font-medium">
        {content}
      </span>
    </span>
  );
}

export interface DefinitionTooltipProps {
  /** The term being explained, as it should be read out ("area median income"). */
  term: string;
  /** One or two plain sentences. No jargon inside the explanation of jargon. */
  definition: ReactNode;
  /** The visible text. Defaults to the term. */
  children?: ReactNode;
  side?: PopoverPlacement;
  locale?: UiLocale;
  className?: string;
}

/**
 * A plain-language explainer for a term, opened by tap or click (so it works on phones), closed by Esc,
 * a tap outside, or the same button. The explanation is announced when it opens.
 */
export function DefinitionTooltip({ term, definition, children, side = "bottom", locale = "en", className }: DefinitionTooltipProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const t = uiStrings(locale);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) placePopover(button.current, el, side);
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [side]);

  // The text is measured after it renders, so place again once it is in.
  useEffect(() => {
    if (open) placePopover(button.current, panel.current, side);
  }, [open, side]);

  return (
    <span className="inline">
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={t.definitionOf(term)}
        className={cn("inline rounded-sm text-left underline decoration-fg-subtle decoration-dotted decoration-1 underline-offset-4 hover:decoration-fg hover:decoration-solid", className)}
      >
        {children ?? term}
      </button>
      <span ref={panel} id={id} popover="auto" className="ui-popover w-72 max-w-[calc(100vw-1rem)] p-3 text-sm leading-5 font-normal text-fg">
        <span role="status" className="block">
          {open ? (
            <>
              <span className="mb-1 block font-semibold">{term}</span>
              <span className="block text-fg-muted">{definition}</span>
            </>
          ) : null}
        </span>
      </span>
    </span>
  );
}
