import { env } from "@/lib/env";
import { SandboxProcessor } from "./sandbox";
import { createStripeProcessorFromEnv } from "./stripe";
import type { PaymentProcessor, ProcessorName } from "./types";

/**
 * Which processor the app talks to.
 *
 * `PAYMENTS_PROVIDER` (sandbox by default, or stripe) chooses the processor for NEW payments and invoices.
 * An existing payment or invoice always goes back to the processor that created it (`processorFor`), so
 * records made before a configuration change keep working.
 */

const g = globalThis as unknown as {
  __eccaPaymentProcessors?: Partial<Record<ProcessorName, PaymentProcessor>>;
  __eccaPaymentProcessorOverrides?: Partial<Record<ProcessorName, PaymentProcessor>>;
};

function build(name: ProcessorName): PaymentProcessor {
  return name === "stripe" ? createStripeProcessorFromEnv() : new SandboxProcessor();
}

/** The processor that created (and therefore owns) an existing payment or invoice. */
export function processorFor(name: ProcessorName): PaymentProcessor {
  const override = g.__eccaPaymentProcessorOverrides?.[name];
  if (override) return override;
  const cache = (g.__eccaPaymentProcessors ??= {});
  return (cache[name] ??= build(name));
}

/** The processor configured for new payments and invoices. */
export function getProcessor(): PaymentProcessor {
  return processorFor(env().PAYMENTS_PROVIDER);
}

/**
 * Test-only: replaces the processor registered under `processor.name` (for example a StripeProcessor built
 * around a fake client). Pass the name with `null` to remove the replacement.
 */
export function setProcessorForTests(name: ProcessorName, processor: PaymentProcessor | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("setProcessorForTests is not allowed in production");
  const overrides = (g.__eccaPaymentProcessorOverrides ??= {});
  if (processor) overrides[name] = processor;
  else delete overrides[name];
}
