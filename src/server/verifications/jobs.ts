import { z } from "zod";
import { MS } from "@/lib/clock";
import type { JobHandlers, RecurringJob } from "@/server/jobs/types";
import { decideVerificationJob, EVIDENCE_GENERATE_JOB } from "./decide";
import { DOCUMENT_EXTRACT_JOB } from "./documents";
import { generateEvidenceJob } from "./evidence";
import { extractDocumentJob } from "./extract";
import { DECIDE_WAIT } from "./policy";
import { expireDueVerifications, purgeDueUploads, RETENTION_PURGE_JOB, VERIFICATION_EXPIRE_JOB } from "./retention";
import { VERIFICATION_DECIDE_JOB } from "./submit";

const id = z.string().min(1).max(128);
const extractPayload = z.object({ documentId: id });
const decidePayload = z.object({ verificationId: id, wait: z.number().int().min(0).max(DECIDE_WAIT.maxWaits).optional() });
const evidencePayload = z.object({ verificationId: id });

/** Job handlers owned by this domain. Keys are job type names. Every handler is idempotent and safe to retry. */
export const jobHandlers: JobHandlers = {
  /** Reads one uploaded document: `{ documentId }`. */
  [DOCUMENT_EXTRACT_JOB]: async (payload) => {
    const { documentId } = extractPayload.parse(payload);
    await extractDocumentJob(documentId);
  },
  /** Decides a submitted verification: `{ verificationId, wait? }`. */
  [VERIFICATION_DECIDE_JOB]: async (payload) => {
    const { verificationId, wait } = decidePayload.parse(payload);
    await decideVerificationJob(verificationId, { wait });
  },
  /** Builds, signs and stores the evidence pack, then emits verification.decided: `{ verificationId }`. */
  [EVIDENCE_GENERATE_JOB]: async (payload) => {
    const { verificationId } = evidencePayload.parse(payload);
    await generateEvidenceJob(verificationId);
  },
  /** Deletes raw uploads past their purge date (hashes and extracted fields stay). Throws if any failed, so the run is retried. */
  [RETENTION_PURGE_JOB]: async () => {
    const { failed } = await purgeDueUploads();
    if (failed > 0) throw new Error(`${failed} document purge(s) failed`);
  },
  /** Marks decided results past their expiry as expired. */
  [VERIFICATION_EXPIRE_JOB]: async () => {
    await expireDueVerifications();
  },
};

/** Scheduled work owned by this domain. */
export const recurringJobs: RecurringJob[] = [
  { type: RETENTION_PURGE_JOB, everyMs: MS.hour },
  { type: VERIFICATION_EXPIRE_JOB, everyMs: MS.hour },
];
