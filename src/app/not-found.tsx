import type { Metadata } from "next";
import { SystemPage } from "@/components/layout/system-page";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Page not found" };

/** Rendered for unmatched URLs and for notFound(). Server component with plain links only. */
export default function NotFound() {
  return (
    <SystemPage
      eyebrow="Error 404"
      title="We can’t find that page"
      description={
        <p>
          The link may be mistyped, or the page may have moved. If you followed a link from an email, open the newest email from {BRAND.name} — older links stop working.
        </p>
      }
      actions={
        <>
          <Button href="/" size="lg">
            Go to the home page
          </Button>
          <Button href="/family" variant="secondary" size="lg">
            Continue a scholarship application
          </Button>
        </>
      }
    />
  );
}
