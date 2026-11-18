"use client";

import type { MouseEvent, ReactNode } from "react";

/** The id every shell puts on its `<main>`. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * "Skip to main content", the first focusable element on every page (rendered by the root layout).
 * It targets #main-content, and falls back to the first <main> or <h1> on a page built without a shell.
 */
export function SkipLink({ children }: { children: ReactNode }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(MAIN_CONTENT_ID) ?? document.querySelector<HTMLElement>("main") ?? document.querySelector<HTMLElement>("h1");
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
    target.scrollIntoView({ block: "start" });
  };
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={onClick}
      className="sr-only rounded-control bg-surface px-4 py-3 text-sm font-semibold text-link shadow-lg focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-toast"
    >
      {children}
    </a>
  );
}
