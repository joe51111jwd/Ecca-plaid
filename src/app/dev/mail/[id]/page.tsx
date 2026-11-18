import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { extractLinks, getEmail } from "@/server/email";
import { assertDevMailboxEnabled, formatTimestamp, previewDocument } from "../shared";
import { StatusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dev mailbox",
  robots: { index: false, follow: false },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-neutral-200 px-3 py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function DevMailMessagePage({ params }: { params: Promise<{ id: string }> }) {
  assertDevMailboxEnabled();
  const { id } = await params;
  const email = await getEmail(id);
  if (!email) notFound();
  const links = extractLinks(email.text);

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <nav className="mb-4 text-sm">
        <Link href="/dev/mail" className="underline">
          ← All emails
        </Link>
        <span className="mx-2 text-neutral-400">/</span>
        <Link href={`/dev/mail?to=${encodeURIComponent(email.toEmail)}`} className="underline">
          Emails to {email.toEmail}
        </Link>
      </nav>

      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Development only</p>
        <h1 data-testid="mail-subject" className="mt-1 text-2xl font-semibold">
          {email.subject}
        </h1>
      </header>

      <section aria-labelledby="mail-details" className="mb-8">
        <h2 id="mail-details" className="mb-2 text-sm font-semibold">
          Details
        </h2>
        <dl className="rounded border border-neutral-300">
          <Row label="To">{email.toEmail}</Row>
          <Row label="From">{email.fromEmail}</Row>
          <Row label="Template">
            <code className="font-mono text-xs">{email.template}</code>
          </Row>
          <Row label="Status">
            <StatusBadge status={email.status} />
            <span className="ml-2 text-neutral-500">via {email.provider}</span>
          </Row>
          {email.error ? (
            <Row label="Error">
              <span className="text-red-700">{email.error}</span>
            </Row>
          ) : null}
          {email.providerId ? <Row label="Provider id">{email.providerId}</Row> : null}
          {email.relatedType ? (
            <Row label="About">
              <code className="font-mono text-xs">
                {email.relatedType} {email.relatedId}
              </code>
            </Row>
          ) : null}
          <Row label="Recorded">
            <time dateTime={email.createdAt.toISOString()}>{formatTimestamp(email.createdAt)}</time>
          </Row>
          <Row label="Sent">{email.sentAt ? <time dateTime={email.sentAt.toISOString()}>{formatTimestamp(email.sentAt)}</time> : "—"}</Row>
          <Row label="Id">
            <code className="font-mono text-xs">{email.id}</code>
          </Row>
        </dl>
      </section>

      {links.length > 0 ? (
        <section aria-labelledby="mail-links" className="mb-8">
          <h2 id="mail-links" className="mb-2 text-sm font-semibold">
            Links in this email
          </h2>
          <ul className="space-y-1 text-sm">
            {links.map((href) => (
              <li key={href}>
                <a href={href} data-testid="mail-link" className="break-all underline">
                  {href}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="mail-html" className="mb-8">
        <h2 id="mail-html" className="mb-2 text-sm font-semibold">
          HTML version
        </h2>
        {/* No allow-scripts and no allow-same-origin: the message is displayed, never executed, and cannot touch this page. */}
        <iframe
          title={`HTML version of "${email.subject}"`}
          data-testid="mail-html"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={previewDocument(email.html)}
          className="h-[640px] w-full rounded border border-neutral-300 bg-white"
        />
      </section>

      <section aria-labelledby="mail-text">
        <h2 id="mail-text" className="mb-2 text-sm font-semibold">
          Text version
        </h2>
        <pre data-testid="mail-text" className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-neutral-300 p-4 font-mono text-sm">
          {email.text}
        </pre>
      </section>
    </main>
  );
}
