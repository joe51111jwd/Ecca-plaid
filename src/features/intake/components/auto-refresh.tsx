"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the page from the server every `intervalMs` while `enabled` (documents being read, a decision being
 * made). Pauses while the tab is hidden so a forgotten tab does not keep asking.
 */
export function AutoRefresh({ intervalMs, enabled = true }: { intervalMs: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, router]);
  return null;
}
