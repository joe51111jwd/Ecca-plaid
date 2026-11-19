import type { Metadata } from "next";
import { renderFamilyHome } from "@/features/intake/screens";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My household", robots: { index: false, follow: false } };

/** /family — the signed-in household page. */
export default async function FamilyHomePage({ searchParams }: Props) {
  return renderFamilyHome(await searchParams);
}
