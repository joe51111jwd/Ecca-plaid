# Data retention and deletion policy (draft)

**Status: draft for review, written November 2026.** It describes what the code in this repository does today, citing
the file or function responsible, and marks what is a decision for counsel, the founder or each SGO. Not legal
advice. Companion: [security-policy.md](security-policy.md).

The rule from the build spec this policy implements: **"Keep the decision, extracted fields, and file hashes; delete
raw uploads after a window the SGO agrees to."** And from the reference design: no state without a retention rule.

## 1. Roles

- **The SGO** is the organization of record for its applicants and donors. Verification results, evidence packs and
  donation records are the SGO's records of decisions it is legally required to make and keep. The SGO chooses the
  raw-upload retention window (its `rawRetentionDays` policy, default 30 days, set at `/sgo/settings`).
- **Passport** processes the data for the SGO at the family's written instruction (the consent screen) and keeps
  platform records (audit log, billing ledger).
- **The family** can see and export its own data, withdraw consent and ask for deletion.

**[Decision: counsel]** Whether Passport acts as the SGO's service provider for all of this data, what the SGO
agreement says about retention and return of data, and how this interacts with the FCRA posture.

## 2. What is kept, for how long, and why

| Data | Kept for | Why | Code |
| --- | --- | --- | --- |
| **Raw uploads** (letters, W-2s, returns, pay stubs, photos) | Until the SGO's window after the decision or cancellation (default **30 days**); if the family stops partway, **60 days** after the verification last changed | Needed only to read and review; the spec says delete them after an agreed window | `purgeDueUploads` (`retention.purge`, hourly) in `src/server/verifications/retention.ts`; `ABANDONED_UPLOAD_RETENTION_DAYS` in `src/server/verifications/policy.ts`; `rawRetentionDays` in `src/db/schema/sgo.ts` |
| What happens at purge | The file's bytes are deleted from the object store **and its data key is destroyed**, so even a backup copy of the encrypted blob cannot be read; the SHA-256 is kept; the document becomes "purged" and a `document.purged` timeline entry records the hash | Hashes prove which file was relied on without keeping the file | `purgeObject` in `src/server/storage/index.ts`; `storage.purge_object` job |
| **Decision record**: status, method, limit used (source, table version, effective date, both readings), household size, county, income year, reasons, reviewer notes, timeline | Not deleted automatically | The SGO's audit record; SGOs "will be audited" | `src/server/verifications` |
| **Extracted fields and income lines** (encrypted where sensitive) | With the decision record | The spec: keep extracted fields | `readStoredExtraction`, `EXTRACTION_PURPOSE` in `src/server/verifications/documents.ts` |
| **Evidence pack** (PDF + signed JSON) | Never deleted by any job | What the SGO hands an auditor | `src/server/verifications/evidence.ts` |
| **Consent records** (wording version, hash of the exact words, language, timestamps, revocation) | With the decision record | Proof the family authorized the share | `src/server/consents` |
| **Household** (address, county, members, encrypted dates of birth) | While the account exists; cleared on a deletion request (§4) | Reuse with a second SGO (the "passport") | `src/server/households` |
| **Result validity** | A direct-method result is reusable through December 31 of the application year; a categorical one through the earliest of that date, letter date + 12 months, and the benefit period end. After that it is marked expired (hourly `verification.expire`); evidence is kept | The determination answers one question: income for one calendar year | `DEFAULT_DECISION_POLICY` in `src/engine/decision/policy.ts`; `expireDueVerifications` |
| **Family links** | Expire after **30 days** unopened | Bearer credentials should not live forever | `FAMILY_LINK_TTL_DAYS` in `src/server/verifications/policy.ts` |
| **Sharing consent** | Until the date stated on the consent screen (at most 731 days) or until withdrawn | Consent must say for how long | `CONSENT_MAX_PERIOD_DAYS` in `src/server/consents/index.ts` |
| **Rail connections** | Until the family or the system revokes them; access tokens are encrypted and revoked at the provider | No standing access to payroll or bank data | `revokeConnection`, `revokeConnectionsForConsent` in `src/server/rails` |
| **Donations, designations (exact words + hash), payments, acknowledgments, IRS report files** | Not deleted automatically | The donor's substantiation and the SGO's IRS record | `src/server/donations`, `src/server/acknowledgments` |
| **Audit log** | Never deleted (append-only) | Access logs required by the spec's data-security constraint | `src/server/audit` |
| **Sessions** | Expire after 7 days idle or 30 days absolute; the row is deleted 30 days after it ended | — | `purgeEndedSessions` in `src/server/auth/session.ts` |
| **Sign-in links** | Usable once, for 15 minutes; the row is deleted one day after it expired | — | `purgeExpiredMagicLinks`, `MAGIC_LINK_RETENTION_MS` in `src/server/auth/magic-link.ts` |
| **Sign-in email bodies** | With a real email provider, replaced in the outbox once sent | The code is a credential | `redactAfterSend` in `src/server/email/index.ts` |
| **Other email bodies** | Replaced by a short notice **30 days** after the message was created; who it went to, the subject and the time are kept | Old message text has no further use | `purgeOldEmailBodies`, `EMAIL_BODY_RETENTION_MS` in `src/server/email/index.ts` |
| **API idempotency keys and rate-limit counters** | Deleted once their window has passed | Housekeeping | `purgeExpiredIdempotencyKeys` in `src/server/api/idempotency.ts`; `purgeExpiredRateLimits` in `src/server/ratelimit/index.ts` |
| **Succeeded background jobs** | Deleted after 7 days | Housekeeping | `purgeSucceededJobs`, `SUCCEEDED_JOB_RETENTION_MS` in `src/server/jobs/index.ts` |

**[Decision: counsel]** The record-keeping periods for decision records, evidence packs, donation and acknowledgment
records and the audit log (the code keeps them indefinitely today; a fixed period such as the IRS record-retention
period would be set as a policy constant and enforced by a job). **[Decision: SGO]** Each SGO's raw-upload window
(`rawRetentionDays`).

## 3. Housekeeping job

Ended sessions, expired sign-in links, API idempotency keys, rate-limit counters and old email bodies are removed by
one hourly job, `maintenance.cleanup` (`src/server/maintenance/jobs.ts`). It calls the purge function each domain
owns, so each rule above lives next to the data it covers. None of these rows hold document contents.
**[Decision: founder]** The 30-day email-body window is a default chosen in code; confirm or change it.

## 4. Deletion requests

- **How a family asks:** through support (the request is identified outside the system), then a platform admin
  processes it at `/admin/privacy`. Families can download everything held about their household themselves
  (`exportHouseholdData`, audited as `household.export`, from the family pages).
- **What happens** (`processDeletionRequest` in `src/server/households/privacy.ts`):
  1. Every raw uploaded file of the household is purged at once (bytes deleted, data keys destroyed; each purge
     audited as `object.purge`). The hashes stay, because evidence packs already given to SGOs refer to them.
  2. Personal details not needed for any record are cleared: street address, city, ZIP and county; every member's
     date of birth; the phone number on each linked sign-in.
  3. Every still-active consent is revoked, so no further collection or sharing can happen; open rail connections
     and open verifications are reported so they can be closed.
  4. Kept, because they are the SGO's audit record of a decision it made: verification rows (decision, limit, county
     and household size used), document rows with hashes and extracted fields, income lines, evidence PDFs and signed
     JSON, member names (the evidence names who was counted) and the consent records.
  5. One audit entry, `household.deletion_processed`, records who, when, why and what was done.
  Re-running it is safe.
- **Donors** can withdraw consent to electronic delivery of the acknowledgment before it is sent
  (`withdrawEDeliveryConsent` in `src/server/donations/consents.ts`); the acknowledgment is then mailed on paper.
  Donation and acknowledgment records are not deleted on request because they are tax substantiation.
  **[Decision: counsel]** The response to a donor's deletion request.
- **An SGO leaving the platform:** **[Decision: counsel / SGO agreement]** export format and timing, then deletion of
  that organization's data. Not automated yet.

**[Decision: counsel]** Which state privacy laws apply to families and donors, response deadlines for access and
deletion requests, and whether "kept as the SGO's record" (point 4) satisfies them or must move to the SGO.

## 5. Backups

The production database and object store are backed up by their providers. A purged file's data key is destroyed,
so encrypted copies of it in backups cannot be decrypted. Database backups still contain the cleared fields until
they age out. **[Decision: founder]** Backup retention period at the database provider (it bounds how long cleared
personal details survive in backups).

## 6. Sandbox and test data

All demo and test data is synthetic and labeled so (`tests/fixtures/synthetic`, `scripts/seed.ts`). The sandbox SGO
list and 00- EINs are refused in production, and synthetic documents are rejected there. Sandbox (test-mode) records
follow the same rules as live ones.
