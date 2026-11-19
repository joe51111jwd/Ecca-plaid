"use client";

import { useEffect, useId, useRef } from "react";

export interface EmbedScriptMountProps {
  /** Absolute URL of public/embed/handoff.js on the Passport host. */
  scriptSrc: string;
  /** data-* attributes exactly as a business would paste them (names without the "data-" prefix). */
  data: Record<string, string>;
}

/**
 * Installs the real embed script the way a booking site's page would: a <script> tag with data attributes, added to
 * the page. (React does not run script tags rendered as JSX, so the demo inserts it after mount.) The script renders
 * its button into the element below.
 */
export function EmbedScriptMount({ scriptSrc, data }: EmbedScriptMountProps) {
  const id = `passport-handoff-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(data);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    for (const [name, value] of Object.entries(JSON.parse(key) as Record<string, string>)) script.setAttribute(`data-${name}`, value);
    script.setAttribute("data-target", id);
    document.body.appendChild(script);
    return () => {
      // A script that has not run yet must not mount into a page that moved on (React re-runs effects in development).
      script.setAttribute("data-passport-mounted", "true");
      script.remove();
      target.replaceChildren();
    };
  }, [scriptSrc, key, id]);

  return <div id={id} ref={ref} />;
}
