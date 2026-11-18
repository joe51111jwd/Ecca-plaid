import { PublicShell } from "@/components/layout/public-shell";
import { SiteHome } from "@/components/site/home";

/** Public home page: an ASCII field hero, the scroll-melt centerpiece, and very little text. */
export default function HomePage() {
  return (
    <PublicShell>
      <SiteHome />
    </PublicShell>
  );
}
