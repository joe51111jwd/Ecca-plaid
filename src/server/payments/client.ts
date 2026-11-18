import type { Mode, PaymentStatus } from "@/db/schema";
import type { PaymentLine } from "./metadata";
import type { CURRENCY } from "./policy";
import type { SandboxTestCard } from "./sandbox-cards";

/**
 * What the browser is given to pay a payment (or to show where it stands). Plain JSON: safe to pass from a
 * server component to `<PaymentForm payment={...}>` in src/features/payments.
 */
export interface ClientPaymentBase {
  paymentId: string;
  mode: Mode;
  status: PaymentStatus;
  amountCents: number;
  currency: typeof CURRENCY;
  description: string;
  lines: PaymentLine[];
  /** Why the last attempt failed, in words the payer may see. */
  failureReason: string | null;
}

export interface SandboxClientPayment extends ClientPaymentBase {
  provider: "sandbox";
  /** The payment's sandbox secret: whoever holds it can complete the test payment. */
  clientSecret: string;
  /** In-app path of the hosted sandbox pay page. Add `&return_url=/path` to send the payer on afterwards. */
  sandboxUrl: string;
  testCards: readonly SandboxTestCard[];
  /** A future expiry date (MM/YY) for the form's "use this number" buttons. */
  testExpiry: string;
}

export interface StripeClientPayment extends ClientPaymentBase {
  provider: "stripe";
  /** Null once the payment can no longer be paid. */
  clientSecret: string | null;
  publishableKey: string;
  /** Set for direct charges: Stripe.js must be loaded for this connected account. */
  connectedAccountId: string | null;
}

export type ClientPayment = SandboxClientPayment | StripeClientPayment;
