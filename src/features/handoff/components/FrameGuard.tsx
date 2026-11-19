"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface FrameGuardProps {
  /** The verified origin of the business's page (one of its allowed origins), or null when none was verified. */
  allowedParent: string | null;
  /** Shown instead of the content when the page is framed by a page that is not allowed. */
  fallback: ReactNode;
  children: ReactNode;
}

type Verdict = "pending" | "show" | "block";

/**
 * Shows the framed handoff page only inside an allowed embedding page. Opened on its own (not framed) it always shows.
 * Framed, it requires the origin the embed script reported to have been verified against the business's allowed
 * origins, and, where the browser exposes the real ancestor chain (location.ancestorOrigins), that the parent really
 * is that origin, so a page cannot claim someone else's origin. Content stays hidden until the check has run.
 */
export function FrameGuard({ allowedParent, fallback, children }: FrameGuardProps) {
  const [verdict, setVerdict] = useState<Verdict>("pending");

  useEffect(() => {
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      framed = true;
    }
    let next: Verdict = "show";
    if (framed) {
      const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
      if (!allowedParent) next = "block";
      else if (ancestors && ancestors.length > 0 && ancestors[0] !== allowedParent) next = "block";
    }
    // A one-time decision taken after mount, on facts only the browser has.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerdict(next);
  }, [allowedParent]);

  if (verdict === "block") return <>{fallback}</>;
  return <div hidden={verdict === "pending"}>{children}</div>;
}
