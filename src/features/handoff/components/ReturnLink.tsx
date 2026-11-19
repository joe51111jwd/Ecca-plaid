"use client";

import { ArrowLeft } from "lucide-react";
import type { HandoffStatus } from "@/db/schema";
import { closedMessage } from "../messages";

export interface ReturnLinkProps {
  href: string;
  label: string;
  handoffId: string;
  status: HandoffStatus;
  /** In the embed: tell the business's page the family is leaving, and navigate the top window. */
  parentOrigin?: string | null;
}

/** "Return to {business}". In the embed it posts `handoff.closed` to the verified parent before leaving. */
export function ReturnLink({ href, label, handoffId, status, parentOrigin }: ReturnLinkProps) {
  return (
    <a
      href={href}
      target={parentOrigin ? "_top" : undefined}
      rel="noopener"
      onClick={() => {
        if (parentOrigin && window.parent !== window) window.parent.postMessage(closedMessage({ id: handoffId, status }), parentOrigin);
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-link underline decoration-1 underline-offset-4 hover:text-link-hover hover:decoration-2"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {label}
    </a>
  );
}
