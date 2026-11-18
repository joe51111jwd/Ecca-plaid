"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { UiLocale } from "@/components/ui/locale";
import { HtmlLang } from "./html-lang";

/** `source` of every message an embedded page posts to its parent. Check it (and event.origin) before trusting a message. */
export const EMBED_MESSAGE_SOURCE = "ecca-embed";

/** Posted to the parent whenever the embedded content's height changes. `height` is in CSS pixels. */
export interface EmbedResizeMessage {
  source: typeof EMBED_MESSAGE_SOURCE;
  type: "resize";
  height: number;
}

export interface EmbedAutoHeightOptions {
  /** Origin allowed to receive the message. Default "*". */
  targetOrigin?: string;
  /** Turn reporting off without unmounting. Default true. */
  enabled?: boolean;
}

/**
 * Reports the height of an element to the parent window (for an iframe that sizes itself to its content).
 * Attach the returned ref to the element that wraps ALL embedded content; it must not be stretched to the
 * viewport (no min-height: 100%), or the iframe could never shrink.
 *
 * The parent listens with:
 *   window.addEventListener("message", (e) => {
 *     if (e.origin !== APP_ORIGIN || e.data?.source !== "ecca-embed" || e.data.type !== "resize") return;
 *     iframe.style.height = e.data.height + "px";
 *   });
 */
export function useEmbedAutoHeight<T extends HTMLElement = HTMLDivElement>(options: EmbedAutoHeightOptions = {}): RefObject<T | null> {
  const { targetOrigin = "*", enabled = true } = options;
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || window.parent === window) return;
    let last = -1;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      const message: EmbedResizeMessage = { source: EMBED_MESSAGE_SOURCE, type: "resize", height };
      window.parent.postMessage(message, targetOrigin);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    // Web fonts and images can change the height without resizing the observed box's own style.
    window.addEventListener("load", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("load", report);
    };
  }, [enabled, targetOrigin]);

  return ref;
}

/** The measured wrapper used by EmbedShell. */
export function EmbedFrame({ children, autoHeight, targetOrigin, locale }: { children: ReactNode; autoHeight: boolean; targetOrigin?: string; locale: UiLocale }) {
  const ref = useEmbedAutoHeight<HTMLDivElement>({ targetOrigin, enabled: autoHeight });
  return (
    <div ref={ref} lang={locale} data-shell="embed" data-density="touch" className="w-full p-4">
      <HtmlLang locale={locale} />
      {children}
    </div>
  );
}
