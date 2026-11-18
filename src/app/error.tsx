"use client";

import { useEffect } from "react";
import { SystemPage } from "@/components/layout/system-page";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

/** Route-level error boundary. Shows no technical detail; the digest lets support find the server log entry. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <SystemPage
      eyebrow="Something went wrong"
      title="This page didn’t load"
      description={<p>Try again. If it keeps happening, contact us and we will look into it.</p>}
      actions={
        <>
          <Button size="lg" onClick={() => retry()}>
            Try again
          </Button>
          <Button href="/" variant="secondary" size="lg">
            Go to the home page
          </Button>
        </>
      }
      footnote={
        <p>
          Help: <a className="underline underline-offset-[3px]" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
          {digest ? <span className="mt-1 block font-mono text-xs">Reference: {digest}</span> : null}
        </p>
      }
    />
  );
}
