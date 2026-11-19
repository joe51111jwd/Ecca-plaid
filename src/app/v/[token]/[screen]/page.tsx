import type { Metadata } from "next";
import { flowMetadata, renderTokenFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ token: string; screen: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /v/{token}/{screen} — one step of the family flow; the server decides whether it may be shown now. */
export default async function VerificationStepPage({ params, searchParams }: Props) {
  const { token, screen } = await params;
  return renderTokenFlow("page", token, screen, await searchParams);
}
