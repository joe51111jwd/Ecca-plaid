"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Moves the browser on to `href` once mounted. Used where a server redirect would leave the page blank while the
 * router follows it (the landing page refreshed right after sign-in); the caller shows a loading state meanwhile.
 */
export function ClientRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <noscript>
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
    </noscript>
  );
}
