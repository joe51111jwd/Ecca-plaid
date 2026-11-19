import type { Metadata } from "next";
import { flowMetadata, renderTokenFlow } from "@/features/intake/screens";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return flowMetadata(await searchParams);
}

/** /v/{token} — the landing page of a verification link (or the screen the family should be on). */
export default async function VerificationLinkPage({ params, searchParams }: Props) {
  return renderTokenFlow("page", (await params).token, null, await searchParams);
}
