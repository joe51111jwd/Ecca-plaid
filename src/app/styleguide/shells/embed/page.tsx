import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { EmbedShell } from "@/components/layout";
import { Alert, Button, Card, KeyValue, KeyValueList, Money, StatusBadge } from "@/components/ui";
import { SAMPLE_CAMP, SAMPLE_SGO } from "../../_data";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — embed" };

/** What a family sees inside a camp's booking page. Sample copy; the real handoff copy lives with that feature. */
export default function EmbedShellDemo() {
  return (
    <EmbedShell partner={{ name: SAMPLE_CAMP.name }} secureNote="family">
      <Card>
        <StatusBadge kind="handoff" status="held" />
        <h1 className="mt-3 font-display text-display-sm text-fg">Need help paying for camp?</h1>
        <p className="mt-2 text-base text-fg-muted">
          You can apply for a scholarship from {SAMPLE_SGO.name}. Checking your household income takes a few minutes and is free for families. Your spot is held while you apply.
        </p>
        <KeyValueList className="mt-4" dense>
          <KeyValue label="Booking">{SAMPLE_CAMP.booking}</KeyValue>
          <KeyValue label="Amount">
            <Money cents={42_500} />
          </KeyValue>
        </KeyValueList>
        <div className="mt-5">
          <Button size="lg" fullWidth trailingIcon={<ArrowRight />} href="/styleguide/shells">
            Check if we qualify
          </Button>
        </div>
        <Alert tone="neutral" className="mt-4">
          <p>A scholarship is not guaranteed. {SAMPLE_SGO.name} decides awards.</p>
        </Alert>
      </Card>
    </EmbedShell>
  );
}
