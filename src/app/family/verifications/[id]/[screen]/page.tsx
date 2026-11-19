import type { Metadata } from "next";
import { flowMetadata, renderIdFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ id: string; screen: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /family/verifications/{id}/{screen} — one step of a household's income check, for a signed-in family member. */
export default async function FamilyVerificationStepPage({ params, searchParams }: Props) {
  const { id, screen } = await params;
  return renderIdFlow(id, screen, await searchParams);
}
