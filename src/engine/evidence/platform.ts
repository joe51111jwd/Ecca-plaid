import { getSigningKey, publicJwk } from "@/lib/crypto";
import { buildEvidenceRecord, signEvidenceRecord, verifySignedEvidence } from "./record";
import type { EvidenceInput, EvidenceJwks, EvidenceRecord, EvidenceVerification, SignedEvidence } from "./types";

/**
 * Thin wrappers that use this deployment's evidence signing key (`getSigningKey()` in src/lib/crypto:
 * EVIDENCE_SIGNING_PRIVATE_KEY in production, a generated development key otherwise). The functions in
 * record.ts take the key as an argument and stay pure; services that just want "sign with our key" call these.
 */

/** Signs a record with the deployment's key. */
export function signEvidenceRecordWithPlatformKey(record: EvidenceRecord): SignedEvidence {
  return signEvidenceRecord(record, getSigningKey());
}

/** Builds and signs in one step. */
export function buildSignedEvidence(input: EvidenceInput): SignedEvidence {
  return signEvidenceRecordWithPlatformKey(buildEvidenceRecord(input));
}

/**
 * The public key set served at /.well-known/jwks.json. It holds the current signing key; a key that has been
 * rotated out has to stay published for as long as records signed with it must verify.
 */
export function platformJwks(): EvidenceJwks {
  return { keys: [publicJwk()] };
}

/** Verifies a signed record against the deployment's own published keys. */
export function verifySignedEvidenceWithPlatformKey(signed: unknown): EvidenceVerification {
  return verifySignedEvidence(signed, platformJwks());
}
