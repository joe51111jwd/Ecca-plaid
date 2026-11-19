import type { Metadata } from "next";
import { flowMetadata, renderTokenFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /embed/verify/{token} — the same link inside a scholarship organization's own page (EmbedShell, sign-in by code). */
export default async function EmbedVerificationPage({ params, searchParams }: Props) {
  return renderTokenFlow("embed", (await params).token, null, await searchParams);
}
