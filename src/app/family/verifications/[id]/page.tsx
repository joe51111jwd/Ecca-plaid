import type { Metadata } from "next";
import { flowMetadata, renderIdFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /family/verifications/{id} — a household's income check opened from the household page or an email. */
export default async function FamilyVerificationPage({ params, searchParams }: Props) {
  return renderIdFlow((await params).id, null, await searchParams);
}
