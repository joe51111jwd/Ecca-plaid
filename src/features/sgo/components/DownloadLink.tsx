import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui";

/**
 * A plain anchor to a dashboard file route, styled as a button. Not next/link: a client-side navigation or a
 * prefetch would request the file (and write an audit entry) without the person asking for it.
 */
export function DownloadLink({ href, children, variant = "secondary", size = "sm", newTab = false }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; newTab?: boolean }) {
  return (
    <a href={href} className={buttonClasses({ variant, size })} {...(newTab ? { target: "_blank", rel: "noopener" } : { download: "" })}>
      <Download aria-hidden="true" className="size-4" />
      {children}
    </a>
  );
}
