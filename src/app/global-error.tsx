"use client";

import { useEffect } from "react";
import { SystemPage } from "@/components/layout/system-page";
import { Button, buttonClasses } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the whole document, so it brings
 * its own <html>, <body> and stylesheet, and uses a plain anchor (the router may be what failed).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <title>{`Something went wrong · ${BRAND.name}`}</title>
        <SystemPage
          homeHref={null}
          eyebrow="Something went wrong"
          title={`${BRAND.name} couldn’t load`}
          description={<p>This is a problem on our side, not something you did. Try again in a moment.</p>}
          actions={
            <>
              <Button size="lg" onClick={() => retry()}>
                Try again
              </Button>
              {/* A full document load on purpose: the client router may be what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                Go to the home page
              </a>
            </>
          }
          footnote={
            <p>
              Help: <a className="underline underline-offset-[3px]" href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
              {digest ? <span className="mt-1 block font-mono text-xs">Reference: {digest}</span> : null}
            </p>
          }
        />
      </body>
    </html>
  );
}
