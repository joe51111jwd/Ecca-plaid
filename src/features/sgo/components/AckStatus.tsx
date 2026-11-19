import { Badge, StatusBadge } from "@/components/ui";

/** An acknowledgment summary's status; "not_generated" (no version yet) has no stored row, so no StatusBadge kind. */
export function AckStatus({ status }: { status: "not_generated" | "draft" | "issued" | "superseded" | "blocked" }) {
  if (status === "not_generated") {
    return (
      <Badge tone="neutral" size="sm">
        Not built yet
      </Badge>
    );
  }
  return <StatusBadge kind="acknowledgment" status={status} size="sm" />;
}
