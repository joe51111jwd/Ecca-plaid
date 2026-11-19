"use client";

import { useEffect, useState } from "react";
import { DOM_EVENTS } from "../../messages";

export interface HostEventLogProps {
  /** Where the camp shows the booking's status once a handoff exists. */
  statusHref: string;
}

interface Entry {
  at: string;
  type: string;
  detail: string;
}

/**
 * What the camp's page hears from the embed script ("passport:handoff" DOM events), shown so the demo makes the
 * contract visible. A real site would store the handoff id and read the status server-side.
 */
export function HostEventLog({ statusHref }: HostEventLogProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
      const { type, ...rest } = detail;
      if (type === "handoff.created") setCreated(true);
      setEntries((list) => [...list, { at: new Date().toLocaleTimeString("en-US"), type: String(type), detail: JSON.stringify(rest) }]);
    };
    document.addEventListener(DOM_EVENTS.any, onEvent);
    return () => document.removeEventListener(DOM_EVENTS.any, onEvent);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-fg">Events the camp&apos;s page received</p>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">None yet. Click the scholarship button.</p>
      ) : (
        <ol className="space-y-1 font-mono text-xs" aria-live="polite">
          {entries.map((e, i) => (
            <li key={i} className="rounded-control bg-sunken px-2 py-1 break-all">
              <span className="text-fg-subtle">{e.at}</span> <strong>{e.type}</strong> {e.detail}
            </li>
          ))}
        </ol>
      )}
      {created ? (
        <a href={statusHref} className="text-sm text-link underline underline-offset-4">
          See this booking&apos;s status on the camp&apos;s site
        </a>
      ) : null}
    </div>
  );
}
