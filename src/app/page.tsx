import { PublicShell } from "@/components/layout/public-shell";
import { Landing } from "@/components/marketing/landing";

/** Public landing page: who this is for, how verification works, and what is still provisional. */
export default function HomePage() {
  return (
    <PublicShell>
      <Landing />
    </PublicShell>
  );
}
