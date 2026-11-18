import type { EmailStatus } from "@/db/schema";

const STYLES: Record<EmailStatus, string> = {
  sent: "border-emerald-300 bg-emerald-50 text-emerald-800",
  queued: "border-amber-300 bg-amber-50 text-amber-800",
  failed: "border-red-300 bg-red-50 text-red-800",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{status}</span>;
}
