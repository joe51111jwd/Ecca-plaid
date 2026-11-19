import Link from "next/link";
import { Badge } from "@/components/ui";
import type { GateSummary } from "../gates";

/** The legal switches at a glance: one linked card per gate. */
export function GateCards({ gates }: { gates: GateSummary[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {gates.map((gate) => (
        <li key={gate.key}>
          <Link
            href={gate.href}
            className="flex h-full flex-col gap-2 rounded-card border border-line bg-surface p-4 transition-[border-color,box-shadow] hover:border-ink-400 hover:shadow-md"
          >
            <span className="text-sm font-medium text-fg-muted">{gate.title}</span>
            <span>
              <Badge tone={gate.tone}>{gate.value}</Badge>
            </span>
            <span className="text-sm text-fg-muted">{gate.detail}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
