import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmbedShell } from "@/components/layout";
import { Button } from "@/components/ui";
import { checkoutPaths, loadReceipt, ReceiptView, RefreshWhile, resolveCheckout, slugSchema, tokenSchema } from "@/features/checkout";
import { getPublicSgo } from "@/server/sgos";

export const metadata: Metadata = { title: "Receipt", robots: { index: false }, referrer: "no-referrer" };

type Params = Promise<{ slug: string; token: string }>;

/** The widget's confirmation page. State is read from the server; the payment form's query string is only a hint. */
export default async function EmbedThanksPage({ params }: { params: Params }) {
  const raw = await params;
  const slug = slugSchema.safeParse(raw.slug);
  const token = tokenSchema.safeParse(raw.token);
  if (!slug.success || !token.success) notFound();
  const access = { kind: "widget", slug: slug.data, token: token.data } as const;
  const paths = checkoutPaths(access);
  const resolved = await resolveCheckout(token.data, slug.data);
  if (resolved.kind !== "active" && resolved.kind !== "completed") redirect(paths.checkout);
  const { view, receipt, payment } = await loadReceipt(token.data);
  const paid = payment?.status === "succeeded";
  if (view.status !== "completed" && !paid) redirect(paths.checkout);
  const finishing = view.status !== "completed" && paid;
  const sgo = await getPublicSgo(slug.data);
  return (
    <EmbedShell partner={{ name: receipt.sgo.name, logoUrl: sgo?.logoUrl ?? null }} secureNote="donor">
      <RefreshWhile active={finishing} />
      <div className="rounded-panel border border-line bg-surface p-5 shadow-sm">
        <ReceiptView
          receipt={receipt}
          finishing={finishing}
          actions={
            <Button href={paths.start} variant="secondary">
              Make another gift
            </Button>
          }
        />
      </div>
    </EmbedShell>
  );
}
