import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTestNow } from "@/lib/clock";
import { PaymentForm, SandboxBanner, SandboxInvoicePayButton } from "@/features/payments";
import { createBusinessInvoice, createDonationPayment, getPayment, sendInvoice } from "@/server/payments";
import { createTestBusiness, createTestCheckout, createTestSgo } from "@/server/payments/test-support";
import { useTestDb } from "../../../tests/helpers/db";
import SandboxInvoicePage from "./invoice/[invoiceId]/page";
import SandboxPayPage from "./pay/[paymentId]/page";
import { assertSandboxPagesEnabled, firstParam, safeReturnPath } from "./shared";

/** What `notFound()` throws: Next.js turns it into the 404 page. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

type AnyProps = Record<string, unknown>;

/** Every element in a rendered tree (pages are plain element trees until React renders them). */
function elements(node: unknown, found: ReactElement<AnyProps>[] = []): ReactElement<AnyProps>[] {
  if (Array.isArray(node)) for (const child of node) elements(child, found);
  else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<AnyProps>;
    found.push(element);
    for (const value of Object.values(element.props)) elements(value, found);
  }
  return found;
}

describe("sandbox pages", () => {
  useTestDb();
  let paymentId: string;
  let payUrl: URL;
  let invoiceId: string;
  let invoiceUrl: URL;

  const payPage = (id: string, query: Record<string, string | string[]> = {}) => SandboxPayPage({ params: Promise.resolve({ paymentId: id }), searchParams: Promise.resolve(query) });
  const invoicePage = (id: string, query: Record<string, string | string[]> = {}) => SandboxInvoicePage({ params: Promise.resolve({ invoiceId: id }), searchParams: Promise.resolve(query) });

  beforeEach(async () => {
    setTestNow("2026-12-10T15:00:00.000Z");
    const orgId = await createTestSgo();
    const payment = await createDonationPayment({
      checkoutSessionId: await createTestCheckout(orgId),
      orgId,
      amountCents: 170_000,
      lines: [{ kind: "designated_contribution", amountCents: 170_000, description: "Designated contribution (synthetic)" }],
      idempotencyKey: "attempt-1",
      mode: "test",
    });
    if (payment.client.provider !== "sandbox") throw new Error("expected a sandbox payment");
    paymentId = payment.id;
    payUrl = new URL(payment.client.sandboxUrl, "http://localhost");

    const sent = await sendInvoice((await createBusinessInvoice({ businessOrgId: await createTestBusiness(), mode: "test", lines: [{ description: "Success fee (synthetic)", amountCents: 2_500 }] })).id);
    invoiceId = sent.id;
    invoiceUrl = new URL(sent.hostedUrl as string);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setTestNow(null);
  });

  it("the link a payment hands out opens its pay page, under the sandbox banner", async () => {
    expect(payUrl.pathname).toBe(`/sandbox/pay/${paymentId}`);
    const page = await payPage(paymentId, { key: payUrl.searchParams.get("key") as string, return_url: "/give/thanks?step=done" });
    const tree = elements(page);
    expect(tree[0].props.banner).toMatchObject({ type: SandboxBanner });
    const form = tree.find((e) => e.type === PaymentForm);
    expect(form?.props).toMatchObject({ returnUrl: "/give/thanks?step=done", showSandboxNotice: false, refreshWhilePending: true });
    expect(form?.props.payment).toMatchObject({ provider: "sandbox", paymentId, status: "requires_payment", amountCents: 170_000 });
  });

  it("drops a return_url that is not a path on this site", async () => {
    for (const bad of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "give/thanks", ""]) {
      const page = await payPage(paymentId, { key: payUrl.searchParams.get("key") as string, return_url: bad });
      expect(elements(page).find((e) => e.type === PaymentForm)?.props.returnUrl).toBeUndefined();
    }
  });

  it("is a 404 without the payment's key, with another payment's key, or for an unknown payment", async () => {
    await expect(payPage(paymentId)).rejects.toMatchObject(NOT_FOUND);
    await expect(payPage(paymentId, { key: "sbx_pay_wrong" })).rejects.toMatchObject(NOT_FOUND);
    await expect(payPage(paymentId, { key: invoiceUrl.searchParams.get("key") as string })).rejects.toMatchObject(NOT_FOUND);
    await expect(payPage("pay_missing", { key: payUrl.searchParams.get("key") as string })).rejects.toMatchObject(NOT_FOUND);
    // A repeated query parameter cannot smuggle a second value past the check.
    await expect(payPage(paymentId, { key: ["sbx_pay_wrong", payUrl.searchParams.get("key") as string] })).rejects.toMatchObject(NOT_FOUND);
  });

  it("the hosted invoice opens from its emailed link, with the pay button while it is open", async () => {
    expect(invoiceUrl.pathname).toBe(`/sandbox/invoice/${invoiceId}`);
    const key = invoiceUrl.searchParams.get("key") as string;
    const page = await invoicePage(invoiceId, { key });
    const tree = elements(page);
    expect(tree[0].props.banner).toMatchObject({ type: SandboxBanner });
    expect(tree.find((e) => e.type === SandboxInvoicePayButton)?.props).toEqual({ invoiceId, invoiceKey: key });
    await expect(invoicePage(invoiceId)).rejects.toMatchObject(NOT_FOUND);
    await expect(invoicePage(invoiceId, { key: payUrl.searchParams.get("key") as string })).rejects.toMatchObject(NOT_FOUND);
    await expect(invoicePage("inv_missing", { key })).rejects.toMatchObject(NOT_FOUND);
  });

  it("refuses to exist in production when Stripe is the processor, even with a valid link", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    expect(() => assertSandboxPagesEnabled()).toThrow(expect.objectContaining(NOT_FOUND));
    await expect(payPage(paymentId, { key: payUrl.searchParams.get("key") as string })).rejects.toMatchObject(NOT_FOUND);
    await expect(invoicePage(invoiceId, { key: invoiceUrl.searchParams.get("key") as string })).rejects.toMatchObject(NOT_FOUND);
    vi.unstubAllEnvs();
    expect((await getPayment(paymentId)).status).toBe("requires_payment");

    // In production with the sandbox as the configured processor (a demo deployment) the pages work.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_PROVIDER", "sandbox");
    expect(() => assertSandboxPagesEnabled()).not.toThrow();
  });

  it("safeReturnPath accepts only same-site paths", () => {
    expect(safeReturnPath("/give/thanks")).toBe("/give/thanks");
    expect(safeReturnPath("/give/thanks?a=1&b=2#top")).toBe("/give/thanks?a=1&b=2#top");
    for (const bad of [null, "", "give", "https://evil.example", "//evil.example", "/\\evil.example", "/a\\b", "/a\nb", "/a\u0000b", `/${"a".repeat(2001)}`]) expect(safeReturnPath(bad)).toBeNull();
  });

  it("firstParam takes the first of repeated values and treats empty as absent", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam("")).toBeNull();
    expect(firstParam([])).toBeNull();
  });
});
