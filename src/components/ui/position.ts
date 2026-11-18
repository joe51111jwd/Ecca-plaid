export type PopoverPlacement = "top" | "bottom" | "top-start" | "top-end" | "bottom-start" | "bottom-end";

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  /** The side actually used after flipping. */
  side: "top" | "bottom";
}

/**
 * Where to put a floating box next to its anchor, in viewport coordinates (for position: fixed).
 *  - prefers the requested side and flips to the other when it does not fit there but fits (or fits better) opposite;
 *  - aligns to the anchor's centre, start or end, then clamps inside the viewport with `margin`;
 *  - a box wider or taller than the viewport is pinned to the top/left margin rather than pushed off-screen.
 */
export function computePopoverPosition(
  anchor: Box,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: PopoverPlacement = "bottom",
  gap = 8,
  margin = 8,
): PopoverPosition {
  const [preferred, align = "center"] = placement.split("-") as ["top" | "bottom", ("start" | "end")?];
  const spaceAbove = anchor.top - margin;
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - margin;
  const need = popover.height + gap;

  let side: "top" | "bottom" = preferred;
  if (preferred === "bottom" && spaceBelow < need && spaceAbove > spaceBelow) side = "top";
  if (preferred === "top" && spaceAbove < need && spaceBelow > spaceAbove) side = "bottom";

  const rawTop = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - gap - popover.height;
  const rawLeft = align === "start" ? anchor.left : align === "end" ? anchor.left + anchor.width - popover.width : anchor.left + anchor.width / 2 - popover.width / 2;

  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  return {
    top: Math.round(Math.min(Math.max(rawTop, margin), maxTop)),
    left: Math.round(Math.min(Math.max(rawLeft, margin), maxLeft)),
    side,
  };
}

/** Positions an open top-layer element beside its anchor. No-op when either is missing. */
export function placePopover(anchor: Element | null, popover: HTMLElement | null, placement: PopoverPlacement, gap?: number): void {
  if (!anchor || !popover) return;
  const a = anchor.getBoundingClientRect();
  const p = popover.getBoundingClientRect();
  const position = computePopoverPosition(
    { top: a.top, left: a.left, width: a.width, height: a.height },
    { width: p.width, height: p.height },
    { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    placement,
    gap,
  );
  popover.style.top = `${position.top}px`;
  popover.style.left = `${position.left}px`;
  popover.dataset.side = position.side;
}
