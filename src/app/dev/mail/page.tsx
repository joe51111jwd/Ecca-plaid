import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { listOutbox } from "@/server/email";
import { assertDevMailboxEnabled, firstParam, formatTimestamp } from "./shared";
import { StatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dev mailbox",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 100;

export default async function DevMailboxPage({ searchParams }: { searchParams: Promise<{ to?: string | string[] }> }) {
  assertDevMailboxEnabled();
  const to = firstParam((await searchParams).to);
  const emails = await listOutbox({ to: to || undefined, limit: PAGE_SIZE });

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Development only</p>
        <h1 className="mt-1 text-2xl font-semibold">Dev mailbox</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Every email the app records, newest first. With the default outbox provider nothing leaves this machine: this page is where sign-in links,
          receipts and acknowledgments are read.
        </p>
      </header>

      <Form action="/dev/mail" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Recipient</span>
          <input
            type="text"
            name="to"
            defaultValue={to}
            placeholder="parent@example.com"
            autoComplete="off"
            className="w-72 rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Filter
        </button>
        {to ? (
          <Link href="/dev/mail" className="px-2 py-2 text-sm underline">
            Show all
          </Link>
        ) : null}
      </Form>

      {emails.length === 0 ? (
        <p data-testid="mail-empty" className="rounded border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          {to ? `No email has been sent to ${to}.` : "No email has been sent yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-300">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{to ? `Emails to ${to}` : "All emails"}, newest first</caption>
            <thead className="border-b border-neutral-300 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Recorded
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  To
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Subject
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Template
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr key={email.id} data-testid="mail-row" className="border-b border-neutral-200 last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                    <time dateTime={email.createdAt.toISOString()}>{formatTimestamp(email.createdAt)}</time>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/dev/mail?to=${encodeURIComponent(email.toEmail)}`} className="hover:underline">
                      {email.toEmail}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/dev/mail/${email.id}`} className="underline">
                      {email.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{email.template}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={email.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {emails.length === PAGE_SIZE ? <p className="mt-3 text-xs text-neutral-500">Showing the newest {PAGE_SIZE} emails. Filter by recipient to see older ones.</p> : null}
    </main>
  );
}
