import type { Metadata } from "next";
import { flowMetadata, renderTokenFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ token: string; screen: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /embed/verify/{token}/{screen} — one step of the embedded family flow. */
export default async function EmbedVerificationStepPage({ params, searchParams }: Props) {
  const { token, screen } = await params;
  return renderTokenFlow("embed", token, screen, await searchParams);
}
