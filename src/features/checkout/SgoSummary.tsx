import { ExternalLink } from "lucide-react";
import { orgMarkName } from "@/components/layout/org-mark-name";
import { Alert, OrgMark, ProvisionalBadge } from "@/components/ui";
import type { PublicSgo } from "@/server/sgos";
import { directoryListNotice } from "./view-model";
import { WhyDisclosure } from "./WhyDisclosure";

export interface SgoSummaryProps {
  sgo: PublicSgo;
  /** h1 on the organization's own page, h2 in a list. */
  level?: 1 | 2;
}

/**
 * One organization as the directory shows it: its name, the name and EIN exactly as the list carries them (so a
 * donor can check it against the list they rely on), and the list's own label. The provisional list says that it
 * is provisional.
 */
export function SgoSummary({ sgo, level = 1 }: SgoSummaryProps) {
  const Heading = level === 1 ? "h1" : "h2";
  const notice = directoryListNotice(sgo.list.source);
  const removed = sgo.list.status === "removed";
  return (
    <div className="space-y-3" data-testid="sgo-summary" data-list-status={sgo.list.status}>
      <div className="flex items-start gap-3">
        <OrgMark name={orgMarkName(sgo.displayName)} logoUrl={sgo.logoUrl} size="md" />
        <div className="min-w-0">
          <Heading className={level === 1 ? "text-2xl font-semibold text-fg" : "text-lg font-semibold text-fg"}>{sgo.displayName}</Heading>
          <p className="text-sm text-fg-muted">
            {[sgo.city, sgo.state].filter(Boolean).join(", ")}
            {sgo.ein ? ` · EIN ${sgo.ein}` : ""}
          </p>
        </div>
      </div>
      {sgo.description && level === 1 ? <p className="text-base text-fg">{sgo.description}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {sgo.list.source === "provisional_curated" ? <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge> : null}
        <span className="text-fg-muted" data-testid="list-label">
          {sgo.list.label}
        </span>
      </div>
      <p className="text-sm text-fg-muted">
        Listed as <span className="font-medium text-fg">{sgo.list.listedName}</span>
        {sgo.list.listedEin ? <> (EIN {sgo.list.listedEin})</> : null}
      </p>
      {notice && level === 1 ? <WhyDisclosure items={[notice]} summary="About this list" /> : null}
      {sgo.website && level === 1 && /^https?:\/\//i.test(sgo.website) ? (
        <a href={sgo.website} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-1 text-sm font-medium text-action underline">
          Organization website
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      ) : null}
      {removed ? (
        <Alert tone="danger" role="alert" title="A gift to this organization cannot be accepted">
          <p>{sgo.list.label}</p>
        </Alert>
      ) : null}
    </div>
  );
}
