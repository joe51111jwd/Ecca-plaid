import { Search } from "lucide-react";
import type { Metadata } from "next";
import { PublicShell } from "@/components/layout";
import { Button, Card, EmptyState, Input, ProvisionalBadge } from "@/components/ui";
import { SgoSummary, directoryListNotice } from "@/features/checkout";
import { getSetting } from "@/server/settings";
import { DIRECTORY_LIMITS, searchSgos } from "@/server/sgos";

export const metadata: Metadata = { title: "Give to a scholarship organization" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v.slice(0, DIRECTORY_LIMITS.maxQueryLength) : "";
}

/**
 * The directory: only organizations a gift can be taken for right now (listed on the list in use, active, accepting
 * gifts). Search is by name or EIN. The list in use is labeled: provisional until the IRS list is the source.
 */
export default async function GivePage({ searchParams }: { searchParams: SearchParams }) {
  const query = firstParam((await searchParams).q).trim();
  const [results, source] = await Promise.all([searchSgos({ query, limit: DIRECTORY_LIMITS.maxLimit }), getSetting("sgoList.source")]);
  const notice = directoryListNotice(source);
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-page px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-3xl space-y-4">
          <h1 className="text-3xl font-semibold text-fg sm:text-4xl">Give to a scholarship granting organization</h1>
          <p className="text-lg text-fg-muted">Find an organization on the list below, then make your gift and see a preview of the federal scholarship tax credit math.</p>
          {notice ? (
            <div className="flex items-start gap-3 rounded-card border border-dashed border-caution-line bg-caution-surface p-4 text-sm text-caution-fg" data-testid="directory-list-notice">
              <ProvisionalBadge size="sm">Provisional list</ProvisionalBadge>
              <p data-copy-id={notice.id}>{notice.text}</p>
            </div>
          ) : null}
        </div>

        <form role="search" action="/give" method="get" className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <label htmlFor="give-search" className="sr-only">
            Search by organization name or EIN
          </label>
          <Input id="give-search" name="q" type="search" defaultValue={query} placeholder="Organization name or EIN" maxLength={DIRECTORY_LIMITS.maxQueryLength} leading={<Search aria-hidden="true" className="size-4" />} className="flex-1" />
          <Button type="submit">Search</Button>
        </form>

        <div className="mt-8" data-testid="directory-results">
          {results.length === 0 ? (
            <EmptyState
              title={query ? `No listed organization matches “${query}”` : "No organizations are listed yet"}
              description={
                query
                  ? "Only organizations on the list in use appear here. Check the spelling, or search by the organization's EIN."
                  : "Organizations appear here once they are on the list in use and accepting gifts through this checkout."
              }
              action={query ? <Button href="/give" variant="secondary">Show all listed organizations</Button> : undefined}
            />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {results.map((sgo) => (
                <Card as="li" key={sgo.orgId} className="flex flex-col justify-between gap-4">
                  <SgoSummary sgo={sgo} level={2} />
                  <Button href={`/give/${sgo.slug}`} data-testid={`give-to-${sgo.slug}`}>
                    Give to this organization
                  </Button>
                </Card>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
