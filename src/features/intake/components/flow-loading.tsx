import { EmbedShell, FocusShell } from "@/components/layout";
import { Skeleton, Spinner } from "@/components/ui";
import type { Surface } from "../flow";

/**
 * What the family sees while the next screen of the flow is prepared (for example right after the sign-in code,
 * before the permission screen), instead of a blank page. The locale is not known here, so it says it in both.
 */
export function FlowLoading({ surface }: { surface: Surface }) {
  const body = (
    <div className="space-y-5">
      <Spinner size="lg" className="text-brand-700" />
      <Skeleton shape="text" lines={3} />
      <p role="status" className="text-sm text-fg-muted">
        Loading… <span lang="es">Cargando…</span>
      </p>
    </div>
  );
  if (surface === "embed") {
    return (
      <EmbedShell locale="en">
        <div className="rounded-panel border border-line bg-surface p-5 shadow-sm">{body}</div>
      </EmbedShell>
    );
  }
  return (
    <FocusShell locale="en" homeHref={null}>
      {body}
    </FocusShell>
  );
}
