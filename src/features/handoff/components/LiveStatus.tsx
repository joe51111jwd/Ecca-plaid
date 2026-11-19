"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { HandoffStatus } from "@/db/schema";
import { statusMessage } from "../messages";

export interface LiveStatusProps {
  handoffId: string;
  status: HandoffStatus;
  holdExpiresAt: string | null;
  /** Keep re-reading the page while the handoff is open. */
  poll: boolean;
  intervalMs: number;
  /** In the embed: the verified origin of the business's page, which receives `handoff.status` messages. */
  parentOrigin?: string | null;
}

/**
 * Keeps an open handoff page current: re-renders it from the server on an interval while the tab is visible, and at
 * once when the family comes back to the tab (typically from the verification flow in another tab). In the embed it
 * also tells the business's page the status, posting only to the verified origin.
 */
export function LiveStatus({ handoffId, status, holdExpiresAt, poll, intervalMs, parentOrigin }: LiveStatusProps) {
  const router = useRouter();

  useEffect(() => {
    if (!parentOrigin || window.parent === window) return;
    window.parent.postMessage(statusMessage({ id: handoffId, status, hold: { expiresAt: holdExpiresAt } }), parentOrigin);
  }, [handoffId, status, holdExpiresAt, parentOrigin]);

  useEffect(() => {
    if (!poll) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [poll, intervalMs, router]);

  return null;
}
