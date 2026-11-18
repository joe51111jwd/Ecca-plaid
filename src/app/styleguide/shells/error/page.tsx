import type { Metadata } from "next";
import { SystemPage } from "@/components/layout";
import { Button } from "@/components/ui";
import { GUIDE_METADATA } from "../../_kit";

export const metadata: Metadata = { ...GUIDE_METADATA, title: "Shell demo — error page" };

/**
 * Lets the style guide show the route error boundary (src/app/error.tsx): with ?throw=1 this page fails on
 * purpose while rendering. Without it, it explains itself.
 */
export default async function ErrorDemo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if ((await searchParams).throw === "1") {
    throw new Error("Style guide demo: this error was thrown on purpose to show the error page.");
  }
  return (
    <SystemPage
      eyebrow="Style guide"
      title="Error page demo"
      description={<p>The button below loads this page in a way that fails on purpose, so you can see what people get when a page throws.</p>}
      actions={
        <>
          <Button href="/styleguide/shells/error?throw=1" size="lg">
            Show the error page
          </Button>
          <Button href="/styleguide/shells" variant="secondary" size="lg">
            Back to shells
          </Button>
        </>
      }
    />
  );
}
