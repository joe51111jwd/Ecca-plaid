"use client";

import { useEffect } from "react";
import type { UiLocale } from "@/components/ui/locale";

/**
 * Sets <html lang> to the language of the current flow and restores it on leave. The root layout renders
 * lang="en"; a shell showing Spanish also marks its own subtree with lang="es", so the language is correct
 * even before this runs.
 */
export function HtmlLang({ locale }: { locale: UiLocale }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = locale;
    return () => {
      root.lang = before;
    };
  }, [locale]);
  return null;
}
