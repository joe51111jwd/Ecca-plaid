# Security policy (draft)

**Status: draft for review, written November 2026.** It describes what the code in this repository actually does,
with the file or function that does it, so a reviewer can check every claim. Items marked **[Decision: counsel]**
or **[Decision: SGO]** are not ours to settle alone. This is not legal advice. The build spec requires "encryption,
access logs, a written deletion policy, and a written security policy. SOC 2 comes later"; the companion document is
[data-retention-and-deletion-policy.md](data-retention-and-deletion-policy.md).

## 1. What we protect and why

Passport handles children's and families' data (names, address, county, household members, dates of birth when an
SGO needs them, income documents and benefit letters), donors' names, addresses and gifts, and organizations'
credentials. The spec names the risk directly: "Magic links, uploads, and camp embeds increase the number of places
that data can leak." The controls below are built around four rules from `docs/architecture.md`:

1. Collect only what a decision needs. **Never stored:** full Social Security numbers (document parsers reduce them
   to the last four digits at most — `src/engine/documents/redact.ts`; the evidence record strips SSN patterns —
   `removeSsnPatterns` in `src/engine/evidence/text.ts`), card numbers (cards go to the processor), bank or payroll
   credentials (rails use the provider's hosted flow), donor SSNs or TINs (the checkout form schema refuses unknown
   fields — `src/server/donations/form.ts`).
2. Encrypt sensitive values at rest; store secrets only as hashes.
3. Every tenant-owned row carries `org_id` and every query filters on it, and on `mode` (`test` / `live`).
4. Every read of sensitive data and every change is written to an append-only audit log.

## 2. Encryption and key handling

| What | How | Where |
| --- | --- | --- |
| Root key | One 32-byte master key from `ECCA_MASTER_KEY` (base64). Startup fails in production without it. In development a random key is generated once into `ECCA_DATA_DIR` (file mode 0600). | `getMasterKey()` in `src/lib/crypto.ts` |
| Purpose keys | HKDF-SHA256 sub-keys per purpose (`ecca:<purpose>`), so a key for one use can never decrypt another. | `deriveKey()` in `src/lib/crypto.ts` |
| Sensitive columns (`*_enc`) | AES-256-GCM with a random IV per value, purpose-bound key: dates of birth, family link tokens kept for resending, webhook signing secrets, rail access tokens, stored extractions. | `encryptField` / `encryptJson` in `src/lib/crypto.ts`; e.g. `DOB_ENCRYPTION_PURPOSE` (households), `src/server/webhooks/secrets.ts`, `RAIL_TOKEN_PURPOSE` (rails) |
| Uploaded files | Envelope encryption: each object has its own random 256-bit data key; bytes sealed with AES-256-GCM; the data key is wrapped with a key-encryption key derived from the master key and stored in `objects.wrapped_key`; both seals are bound to the object id (AAD), so blobs and keys cannot be swapped between rows. The object store (local disk or S3) never holds anything that can decrypt a file. Rotating the master key re-wraps data keys without rewriting files. | `src/server/storage/envelope.ts`, `src/server/storage/index.ts` |
| Secrets we look up | Session tokens, sign-in link tokens and API keys are stored only as `hashToken()` (SHA-256 with a domain prefix); 6-digit sign-in codes as an HMAC bound to the link. The full API key is shown once at creation. | `hashToken()` in `src/lib/crypto.ts`; `src/server/auth/magic-link.ts`; `src/server/api/keys.ts` |
| Evidence signatures | Ed25519 (`EVIDENCE_SIGNING_PRIVATE_KEY`, PKCS8 PEM; key id `EVIDENCE_SIGNING_KEY_ID`). The public key set is published at `/.well-known/jwks.json` so SGOs and auditors can verify records independently (`npm run evidence:verify`). | `getSigningKey()` in `src/lib/crypto.ts`; `src/engine/evidence/record.ts`; `scripts/verify-evidence.ts` |
| In transit | HTTPS is provided by the host (Vercel). Session cookies are `Secure` in production. | `sessionCookieOptions()` in `src/server/auth/session.ts` |

Key custody: production keys live only in the hosting provider's encrypted environment settings, readable by the
people who can deploy. **[Decision: founder]** Who holds deploy access, and where an offline copy of the master key
is escrowed (losing it makes every encrypted value and file unreadable). Rotation: the envelope design allows
re-wrapping data keys under a new master key; a rotation command is not yet written (see §10).

## 3. Access control

- **People** sign in with a single-use credential that works as a link or a 6-digit code, valid 15 minutes
  (`MAGIC_LINK_TTL_MS`), with at most 5 code attempts per link. Sign-in requests are rate-limited per address and per
  network (`SIGN_IN_LIMITS`: 5 emails / 15 min per address, 20 / 15 min per network). The response is identical
  whether or not an account exists. Sessions are HttpOnly, SameSite=Lax cookies, expiring after 7 days idle or 30
  days absolute (`SESSION_IDLE_MS`, `SESSION_ABSOLUTE_MS`); sign-out revokes the session row.
  `src/server/auth/magic-link.ts`, `src/server/auth/session.ts`.
- **Roles** come from memberships: owner, admin, reviewer, viewer per organization; platform admins are members of
  the single platform organization (first admins from `PLATFORM_ADMIN_EMAILS`). Guards: `requireUser`,
  `requireOrgMember(orgId, roles)`, `requirePlatformAdmin`, `requireHouseholdAccess` in `src/server/auth/guards.ts`.
  Every page, server action and route handler calls a guard first; services re-check the actor themselves (for
  example review actions require reviewer or above — `src/server/verifications/review-actions.ts`).
- **Families** reach only their own household: the account holder or an invited adult (`HOUSEHOLD_PERMISSIONS` in
  `src/server/households/access.ts`). Family links are bearer credentials (stored hashed, 30-day expiry) that only
  start a flow; the data behind them needs a signed-in household member.
- **Machines** use API keys `ecca_test_…` / `ecca_live_…`, scoped to one organization and one mode, stored hashed,
  revocable (`src/server/api/keys.ts`). Camps' browser embeds use publishable keys that can only create a handoff,
  are checked against the camp's allowed origins and rate-limited (`src/server/handoffs/create.ts`).
- **Test versus live:** sandbox data and live data are separated by `mode` on every row; a test key cannot read live
  data and vice versa, and an organization cannot use live mode until a platform admin has verified it.

## 4. Tenant isolation

Every service that reads tenant data takes an explicit organization scope and filters by organization **and** mode;
another tenant's row is reported as "not found" (never "forbidden", which would confirm it exists). Covered by
`src/server/verifications/tenancy.test.ts`, `src/server/api/isolation.test.ts` and the end-to-end test
`tests/e2e/isolation.spec.ts` (SGO B cannot open, download, cancel or list SGO A's verification on the dashboard or
through the API). A camp sees only booking-level handoff statuses — never income, documents, reasons or the family's
email (`publicVerificationStatus` in `src/server/handoffs/state.ts`).

## 5. Access logs (audit)

`audit()` in `src/server/audit/index.ts` writes who (user, API key, system), what action, which record, which
organization, and request IP and user agent. The module has no update or delete function: the log is append-only.
Metadata passes through a sanitizer so the log never becomes a second copy of a secret or of a family's documents
(`src/server/audit/sanitize.ts`); tests assert that no extracted value, amount or name reaches audit metadata
(`leakedValues` in `src/server/verifications/test-support.ts`). Audited reads include document views, evidence
downloads, verification detail reads, donor records and exports. Platform admins read the log at `/admin/audit`.
**[Decision: counsel]** How long audit logs are kept (they are currently never deleted).

## 6. Uploads, documents and outbound requests

- File type is decided from the file's own leading bytes, not the uploader's claim; only PDF and photo formats pass;
  size is capped (`src/server/storage/upload-validation.ts`, `DOCUMENT_LIMITS` in
  `src/server/verifications/policy.ts`). Duplicates are detected by SHA-256.
- Documents are parsed without a network or worker (`src/engine/documents/pdf-text.ts`); unreadable or low-confidence
  documents go to a person, never to a silent yes. Optional model-assisted reading (`ANTHROPIC_API_KEY`) treats
  document text as data, and its readings always need human confirmation (`MODEL_READ_REQUIRES_HUMAN_CONFIRMATION`
  in `src/server/documents/model-reader.ts`). In production, synthetic test fixtures are rejected.
- Webhook URLs are checked against server-side request forgery: production accepts only https and refuses private,
  loopback and link-local addresses, re-checked at delivery time (`src/server/webhooks/ssrf.ts`). Deliveries are
  signed (Standard Webhooks, HMAC-SHA256; `src/server/webhooks/signing.ts`), retried with backoff and logged.
- Inbound processor webhooks (Stripe, Plaid) are signature-verified before use (`src/server/payments/webhooks.ts`,
  `src/server/rails/plaid-webhook.ts`).
- Response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a
  restrictive `Permissions-Policy`, and `X-Frame-Options: SAMEORIGIN` everywhere except the embeddable `/embed/*`
  surfaces (`next.config.ts`).
- The cron job endpoint requires `CRON_SECRET` and is closed in production without it
  (`src/app/api/internal/jobs/run/route.ts`). The development mailbox `/dev/mail` returns 404 in production.

## 7. Email

Sign-in emails are marked sensitive: with a real provider their bodies are replaced in the outbox table once sent
(`redactAfterSend` in `src/server/email/index.ts`); outcome emails to families never contain income figures or
document contents (asserted in tests). Notification emails to SGO staff carry ids and counts, not family names.

## 8. People and vendors

- Contracts, Stripe and data-rail accounts are signed through the parent's entity, not in the founder's personal name
  (spec constraint "Under 18"). **[Decision: founder]**
- Sub-processors when production is switched on: the host (Vercel), the Postgres provider, the object store, the email
  provider (Resend), Stripe, the chosen data rail, and optionally Anthropic for document reading. **[Decision:
  counsel]** Data-processing terms with each, and whether the FCRA posture requires a licensed consumer reporting
  agency rail for payroll data.
- Access for staff follows least privilege: SGO reviewers rather than owners for review work; platform admin only for
  people who run the platform.

## 9. Incident basics

1. **Detect:** unexpected audit entries, failed-signature alerts from webhook receivers, job dead letters
   (`/admin/jobs`), host and database alerts.
2. **Contain:** revoke sessions (`revokeAllSessionsForUser`), revoke API keys (`/sgo/developers`), disable webhook
   endpoints, rotate the evidence signing key (publish the new key in the JWKS; old records stay verifiable while the
   old public key is listed), rotate the master key if exposed (re-wrap data keys).
3. **Assess** with the audit log: who read which records, from where, when.
4. **Notify:** affected SGOs (they are the organizations of record for their applicants), families and donors as the
   law requires. **[Decision: counsel]** Which state breach-notification laws apply (Texas Business and Commerce Code
   chapter 521 and the residents' states for donors) and the notice timelines; what the SGO agreements require.
5. **Review:** a written post-incident note within two weeks.

## 10. Known gaps and later work

- No master-key rotation command yet (the envelope format supports it).
- No content security policy header yet; no third-party penetration test.
- **SOC 2 comes later**, as the spec says: the audit log, access control and these policies are the starting evidence.
- Policies are drafts until reviewed by counsel and accepted by the first SGO.
