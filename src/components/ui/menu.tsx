"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "./cn";
import { isExternalHref } from "./href";
import { placePopover, type PopoverPlacement } from "./position";

export interface MenuItem {
  label: ReactNode;
  /** Navigate. */
  href?: string;
  /** Or run a server action (rendered as a one-button form). `fields` are sent as hidden inputs. */
  action?: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  icon?: ReactNode;
  /** Small second line. */
  description?: ReactNode;
  /** `danger` for destructive items — and confirm them (ConfirmButton) rather than acting from a menu. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
}

export interface DropdownMenuProps {
  /** Accessible name of the trigger ("Account menu", "Actions for Maria Alvarez"). */
  label: string;
  /** Visible content of the trigger. Default: an ellipsis icon. */
  trigger?: ReactNode;
  items: MenuItem[];
  /** Non-interactive content above the items (who is signed in). */
  header?: ReactNode;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  /** `icon` = square ghost button (row actions); `button` = bordered; `plain` = no chrome (wraps an avatar and name). */
  triggerStyle?: "icon" | "button" | "plain";
  className?: string;
}

const ITEM =
  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:py-3";

/**
 * A small menu of links and actions behind one button: the account menu, the "…" on a table row.
 * It is a disclosure (button + list), not an ARIA application menu, so Tab moves through the items and
 * Esc or a click outside closes it.
 */
export function DropdownMenu({ label, trigger, items, header, align = "end", triggerStyle = "icon", className }: DropdownMenuProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const placement: PopoverPlacement = align === "end" ? "bottom-end" : "bottom-start";

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") placePopover(button.current, el, placement, 6);
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [placement]);

  const close = () => {
    const el = panel.current;
    if (el?.matches(":popover-open")) el.hidePopover();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={triggerStyle === "icon" ? label : undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium text-fg transition-colors",
          triggerStyle === "icon" && "size-control-sm hover:bg-sunken [&>svg]:size-4",
          triggerStyle === "button" && "h-control-sm border border-line-strong bg-surface px-3 shadow-xs hover:bg-sunken",
          triggerStyle === "plain" && "min-h-control-sm px-1.5 hover:bg-sunken",
          className,
        )}
      >
        {trigger ?? <Ellipsis aria-hidden="true" />}
      </button>
      <div ref={panel} id={id} popover="auto" className="ui-popover min-w-52 max-w-[calc(100vw-1rem)] p-1.5">
        {header ? <div className="mb-1.5 border-b border-line px-2.5 pt-1.5 pb-2.5 text-sm">{header}</div> : null}
        <ul>
          {items.map((item, index) => {
            const tone = item.tone === "danger" ? "text-danger-fg" : "text-fg";
            const inner = (
              <>
                {item.icon ? (
                  <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-fg-muted [&>svg]:size-4">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.description ? <span className="block text-xs font-normal text-fg-muted">{item.description}</span> : null}
                </span>
              </>
            );
            return (
              <li key={index} className={cn(item.separated && "mt-1.5 border-t border-line pt-1.5")}>
                {item.action ? (
                  <form action={item.action} onSubmit={close}>
                    {item.fields ? Object.entries(item.fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />) : null}
                    <button type="submit" disabled={item.disabled} className={cn(ITEM, tone)}>
                      {inner}
                    </button>
                  </form>
                ) : item.href && !item.disabled ? (
                  isExternalHref(item.href) ? (
                    <a href={item.href} onClick={close} className={cn(ITEM, tone)}>
                      {inner}
                    </a>
                  ) : (
                    <Link href={item.href} onClick={close} className={cn(ITEM, tone)}>
                      {inner}
                    </Link>
                  )
                ) : (
                  <span aria-disabled="true" className={cn(ITEM, tone, "cursor-not-allowed opacity-50 hover:bg-transparent")}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
