import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentOutcome } from "./PaymentOutcome";
import { SANDBOX_EXPLANATION, SANDBOX_HEADLINE, SandboxBanner, SandboxNotice } from "./SandboxNotice";

/** The pieces that render without a browser: what they say, and that sandbox surfaces always say "sandbox". */
describe("payment UI wording", () => {
  it("the sandbox banner and notice carry the headline, in words that cannot be read as a real charge", () => {
    expect(SANDBOX_HEADLINE).toBe("Sandbox — no money moves");
    for (const html of [renderToStaticMarkup(createElement(SandboxBanner)), renderToStaticMarkup(createElement(SandboxNotice))]) {
      expect(html).toContain(SANDBOX_HEADLINE);
      expect(html).toContain(SANDBOX_EXPLANATION);
    }
    expect(renderToStaticMarkup(createElement(SandboxNotice))).toContain('role="note"');
    expect(renderToStaticMarkup(createElement(SandboxBanner, null, "This is a test invoice."))).toContain("This is a test invoice.");
  });

  it("every outcome of a sandbox payment says it is a sandbox payment and is announced politely", () => {
    for (const status of ["succeeded", "processing", "canceled", "refunded"] as const) {
      const sandbox = renderToStaticMarkup(createElement(PaymentOutcome, { status, sandbox: true }));
      expect(sandbox).toContain(`data-status="${status}"`);
      expect(sandbox).toContain('role="status"');
      expect(sandbox.toLowerCase()).toMatch(/sandbox|test payment/);
      const real = renderToStaticMarkup(createElement(PaymentOutcome, { status, sandbox: false }));
      expect(real.toLowerCase()).not.toContain("sandbox");
      expect(real.toLowerCase()).not.toContain("test payment");
    }
    expect(renderToStaticMarkup(createElement(PaymentOutcome, { status: "succeeded", sandbox: true }))).toContain("No money moved.");
    expect(renderToStaticMarkup(createElement(PaymentOutcome, { status: "succeeded", sandbox: false }))).toContain("Payment complete");
    // A pending real payment promises nothing about when or whether it completes.
    expect(renderToStaticMarkup(createElement(PaymentOutcome, { status: "processing", sandbox: false }))).toContain("Payment pending");
  });
});
