"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface RefreshWhileProps {
  /** Keep asking the server for the page while this is true. */
  active: boolean;
  intervalMs?: number;
  /** Stop after this many refreshes (the page then says what to do). */
  maxAttempts?: number;
}

/** Re-renders the server page every few seconds while a background step (recording a paid gift) finishes. */
export function RefreshWhile({ active, intervalMs = 2000, maxAttempts = 30 }: RefreshWhileProps) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (!active || attempts >= maxAttempts) return;
    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [active, attempts, intervalMs, maxAttempts, router]);
  return null;
}
