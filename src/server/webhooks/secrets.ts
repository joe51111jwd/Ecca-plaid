import { z } from "zod";
import { decryptField, encryptField } from "@/lib/crypto";
import { WEBHOOK_SECRET_PREFIX } from "./signing";

/**
 * At-rest form of an endpoint's signing secrets (`webhook_endpoints.secret_enc`).
 *
 * The column holds `encryptField(..., "webhook-secret")` of either the bare secret ("whsec_...") or,
 * once a secret was rotated, a small JSON keyring that also carries the previous secret until its
 * overlap ends. During the overlap deliveries are signed with both, so a receiver can switch secrets
 * without dropping a single webhook.
 */

const ENCRYPTION_PURPOSE = "webhook-secret";

export interface EndpointSecrets {
  current: string;
  previous?: { secret: string; expiresAt: Date };
}

const keyring = z.object({
  current: z.string().startsWith(WEBHOOK_SECRET_PREFIX),
  previous: z.object({ secret: z.string().startsWith(WEBHOOK_SECRET_PREFIX), expiresAt: z.iso.datetime() }).optional(),
});

export function sealEndpointSecrets(secrets: EndpointSecrets): string {
  if (!secrets.previous) return encryptField(secrets.current, ENCRYPTION_PURPOSE);
  const stored: z.infer<typeof keyring> = { current: secrets.current, previous: { secret: secrets.previous.secret, expiresAt: secrets.previous.expiresAt.toISOString() } };
  return encryptField(JSON.stringify(stored), ENCRYPTION_PURPOSE);
}

export function openEndpointSecrets(secretEnc: string): EndpointSecrets {
  const plain = decryptField(secretEnc, ENCRYPTION_PURPOSE);
  if (plain.startsWith(WEBHOOK_SECRET_PREFIX)) return { current: plain };
  const parsed = keyring.parse(JSON.parse(plain));
  return { current: parsed.current, ...(parsed.previous ? { previous: { secret: parsed.previous.secret, expiresAt: new Date(parsed.previous.expiresAt) } } : {}) };
}

/** Secrets to sign with at `at`: the current one first, then the previous one while its overlap lasts. */
export function signingSecrets(secrets: EndpointSecrets, at: Date): string[] {
  return secrets.previous && secrets.previous.expiresAt.getTime() > at.getTime() ? [secrets.current, secrets.previous.secret] : [secrets.current];
}
