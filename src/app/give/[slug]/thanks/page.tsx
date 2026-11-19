import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { FocusShell } from "@/components/layout";
import { Button } from "@/components/ui";
import { checkoutCookieName, checkoutPaths, loadReceipt, newGiftAction, ReceiptView, RefreshWhile, resolveCheckout, slugSchema } from "@/features/checkout";
import { SandboxBanner } from "@/features/payments";
import { getCurrentUser } from "@/server/auth";
import { getPublicSgo } from "@/server/sgos";

export const metadata: Metadata = { title: "Receipt", robots: { index: false } };

type Params = Promise<{ slug: string }>;

/**
 * The confirmation page after paying. The payment form's query string is only a hint: the state shown here is
 * read from the server (the checkout and its payment).
 */
export default async function GiveThanksPage({ params }: { params: Params }) {
  const parsed = slugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  const slug = parsed.data;
  const paths = checkoutPaths({ kind: "hosted", slug });
  const token = (await cookies()).get(checkoutCookieName(slug))?.value ?? null;
  const resolved = await resolveCheckout(token, slug);
  if (resolved.kind !== "active" && resolved.kind !== "completed") redirect(paths.checkout);
  const { view, receipt, payment } = await loadReceipt(token as string);
  const paid = payment?.status === "succeeded";
  const finishing = view.status !== "completed" && paid;
  // Not paid (yet): the checkout page shows the payment step or the outcome.
  if (view.status !== "completed" && !paid) redirect(paths.checkout);

  const sgo = await getPublicSgo(slug);
  const user = await getCurrentUser();
  return (
    <FocusShell partner={{ name: receipt.sgo.name, logoUrl: sgo?.logoUrl ?? null }} banner={receipt.sandbox ? <SandboxBanner /> : undefined} width="lg" secureNote="donor">
      <RefreshWhile active={finishing} />
      <ReceiptView
        receipt={receipt}
        finishing={finishing}
        actions={
          <>
            <Button href={user ? "/donor" : `/sign-in?next=${encodeURIComponent("/donor")}`} variant="secondary">
              {user ? "My gifts" : "Sign in to see your gifts"}
            </Button>
            <form action={newGiftAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="ghost">
                Make another gift
              </Button>
            </form>
          </>
        }
      />
    </FocusShell>
  );
}
