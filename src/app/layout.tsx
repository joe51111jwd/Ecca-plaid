import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/layout/skip-link";
import { uiStrings } from "@/components/ui/locale";
import { ToastProvider } from "@/components/ui/toast";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Household income verification for scholarship organizations, a giving checkout that shows the federal scholarship tax credit math, and a scholarship handoff for camps and schools. Built first for Texas.",
  applicationName: BRAND.name,
  // Phone numbers, dates and dollar amounts on these pages are data, not links.
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // brand-700, the header/action colour.
  themeColor: "#174F60",
  colorScheme: "light",
};

/**
 * Root document. Language defaults to English; a shell rendering Spanish marks its own subtree with
 * lang="es" (and updates <html lang> on the client). Every page gets the skip link and the toast host.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <SkipLink>{uiStrings("en").skipToContent}</SkipLink>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
