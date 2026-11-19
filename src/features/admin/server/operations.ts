import { getDb } from "@/db/client";
import { centralDateString, now } from "@/lib/clock";
import { actionError, conflict, forbidden, invalid, isAppError, type ActionResult } from "@/lib/errors";
import { formatUsd } from "@/lib/money";
import { audit } from "@/server/audit";
import { isPlatformAdmin } from "@/server/auth";
import { createBusiness, formatBps, setSuccessFee } from "@/server/businesses";
import { recordOperatorRefund, donationsPolicy } from "@/server/donations";
import { processDeletionRequest } from "@/server/households";
import { getJob, retryJob } from "@/server/jobs";
import { addMember, removeMember, updateMemberRole } from "@/server/orgs";
import { revokeConnectionsForConsent } from "@/server/rails";
import { getSetting, setSetting } from "@/server/settings";
import { createSgo, importSgoList, linkProfileToListEntry } from "@/server/sgos";
import { cancelVerification } from "@/server/verifications";
import { startOfDateInTimeZone } from "@/taxmath";
import { parseForm, readFile, readText } from "../form-data";
import {
  addMemberSchema,
  changeRoleSchema,
  createBusinessFormSchema,
  createBusinessFromForm,
  createSgoFormSchema,
  createSgoFromForm,
  creditStartDateSchema,
  deletionSchema,
  feeStructureFromForm,
  feeStructureSchema,
  importListFromForm,
  importListSchema,
  linkEntrySchema,
  LIST_UPLOAD_MAX_BYTES,
  listSourceSchema,
  liveGiftsFromForm,
  liveGiftsSchema,
  orgStatusSchema,
  refundSchema,
  removeListEntryFromForm,
  removeListEntrySchema,
  removeMemberSchema,
  retryJobSchema,
  successFeeSchema,
} from "../forms";
import { buildRemovalCsv } from "../sgo-list-removal";
import type { AdminActor, AdminNotice, AdminOperation } from "../types";
import { countListedEntriesBySource, getListEntry, getVerificationScopes, setOrganizationStatus } from "./queries";

/**
 * Every admin form's work: validate the submission, call the owning service, word the outcome. Each operation takes
 * the already-authenticated platform admin (see ./run-action) and returns an ActionResult, so the same function is
 * what the server action runs and what the tests call. Services check authorization again and write the audit
 * entries; the few audit entries written here are for acts whose service records none.
 */

/** Zone in which dates typed by an operator are read (US Central: the Texas reference zone used across the app). */
export const ADMIN_TIME_ZONE = "America/Chicago";

/**
 * POLICY: the SGO list source may only be switched to a source that has at least this many listed entries. Every
 * gift is refused for an SGO not on the active list, so pointing donors at an empty list would stop all giving.
 */
export const LIST_SOURCE_MIN_LISTED_ENTRIES = 1;

const ok = (notice: AdminNotice): ActionResult<AdminNotice> => ({ ok: true, data: notice });

/**
 * Wraps an operation body: re-checks that the actor is a platform admin (some services, such as settings and the job
 * queue, leave authorization to their caller), and turns thrown AppErrors into a failed ActionResult.
 */
function operation(body: (actor: AdminActor, formData: FormData) => Promise<AdminNotice>): AdminOperation {
  return async (actor, formData) => {
    try {
      if (typeof actor?.userId !== "string" || !(await isPlatformAdmin(actor.userId))) throw forbidden();
      return ok(await body(actor, formData));
    } catch (e) {
      return actionError(e);
    }
  };
}

const userActor = (actor: AdminActor) => ({ userId: actor.userId, request: actor.request });
const today = () => centralDateString(now());

/** A date an operator typed as "retrieved on": today means now; an earlier day means the start of that day in Central time. */
export function retrievalInstant(date: string, at: Date = now()): Date {
  return date === centralDateString(at) ? at : startOfDateInTimeZone(date, ADMIN_TIME_ZONE);
}

/* -------------------------------------------------------------------------------------- gates and fees */

export const saveFeeStructure = operation(async (actor, formData) => {
  const value = parseForm(feeStructureSchema(today()), feeStructureFromForm(formData), "Check the fee structure details.");
  const saved = await setSetting("fees.structure", value, { actorUserId: actor.userId, request: actor.request });
  const rate = saved.active === "sgo_invoiced" ? ` at ${formatBps(saved.sgoFeeBps)}` : saved.active === "donor_service_fee" ? ` at ${formatBps(saved.donorServiceFeeBps)}` : "";
  return { message: saved.active === "none" ? "Saved. No platform fee is taken on section 25F gifts." : `Saved. The fee structure is now ${saved.active.replace(/_/g, " ")}${rate}.` };
});

export const setLiveGifts = operation(async (actor, formData) => {
  const input = parseForm(liveGiftsSchema, liveGiftsFromForm(formData), "Check the live gifts switch.");
  const db = await getDb();
  const current = await getSetting("gifts.liveEnabled", db);
  if (current === input.enabled) throw conflict(input.enabled ? "Live gifts are already on." : "Live gifts are already off.");
  await db.transaction(async (tx) => {
    await setSetting("gifts.liveEnabled", input.enabled, { actorUserId: actor.userId, request: actor.request }, tx);
    if (input.enabled) {
      await audit(
        {
          actor: { type: "user", id: actor.userId },
          action: "settings.live_gifts_counsel_reference",
          target: { type: "platform_setting", id: "gifts.liveEnabled" },
          metadata: { counselReference: input.counselReference },
          request: actor.request,
        },
        tx,
      );
    }
  });
  return { message: input.enabled ? "Live gifts are on. Gifts still earn the credit only from the credit start date and only for listed SGOs." : "Live gifts are off. Only sandbox gifts can be made." };
});

export const setCreditStartDate = operation(async (actor, formData) => {
  const { date } = parseForm(creditStartDateSchema, { date: readText(formData, "date") }, "Check the date.");
  const saved = await setSetting("credit.startDate", date, { actorUserId: actor.userId, request: actor.request });
  return { message: `Saved. The credit start date is ${saved} (outside production only).` };
});

export const setListSource = operation(async (actor, formData) => {
  const { source } = parseForm(listSourceSchema, { source: readText(formData, "source") }, "Choose a list source.");
  const db = await getDb();
  const current = await getSetting("sgoList.source", db);
  if (current === source) throw conflict("That list is already the active source.");
  const listed = await countListedEntriesBySource(db);
  if (listed[source] < LIST_SOURCE_MIN_LISTED_ENTRIES) {
    throw invalid("That list has no listed entries yet. Import it first: switching now would refuse every gift.", { fields: { source: "Import this list first." } });
  }
  await setSetting("sgoList.source", source, { actorUserId: actor.userId, request: actor.request }, db);
  return {
    message: source === "irs_published" ? "Donors are now checked against the IRS-published list." : "Donors are now checked against the provisional curated list, labeled provisional.",
    details: [{ label: "Listed entries", value: String(listed[source]) }],
  };
});

/* ------------------------------------------------------------------------------------------ SGO list */

export const importList = operation(async (actor, formData) => {
  const input = parseForm(importListSchema, importListFromForm(formData), "Check the import details.");
  const file = readFile(formData, "file");
  if (!file) throw invalid("Choose the list file (CSV).", { fields: { file: "Choose a CSV file." } });
  if (file.size > LIST_UPLOAD_MAX_BYTES) throw invalid(`The file is larger than ${Math.floor(LIST_UPLOAD_MAX_BYTES / 1024)} KB.`, { fields: { file: "Too large." } });
  if (input.retrievedOn > today()) throw invalid("The download date cannot be in the future.", { fields: { retrievedOn: "Use today or an earlier date." } });
  const csv = await file.text();
  const report = await importSgoList({ source: input.source, csv, sourceUrl: input.sourceUrl, retrievedAt: retrievalInstant(input.retrievedOn) }, userActor(actor));
  return {
    message: `Imported ${report.rowCount} row${report.rowCount === 1 ? "" : "s"} into the ${input.source === "irs_published" ? "IRS-published" : "provisional"} list.`,
    details: [
      { label: "Added", value: String(report.added) },
      { label: "Updated", value: String(report.updated) },
      { label: "Removed", value: String(report.removed) },
      { label: "Unchanged", value: String(report.unchanged) },
      { label: "Not in file (left unchanged)", value: String(report.notInFile) },
      { label: "File SHA-256", value: report.sha256 },
    ],
  };
});

export const removeListEntry = operation(async (actor, formData) => {
  const input = parseForm(removeListEntrySchema, removeListEntryFromForm(formData), "Check the removal details.");
  if (input.learnedOn > today()) throw invalid("The confirmation date cannot be in the future.", { fields: { learnedOn: "Use today or an earlier date." } });
  const entry = await getListEntry(input.entryId);
  if (!entry) throw invalid("That list entry no longer exists.", { fields: { entryId: "Not found." } });
  const csv = buildRemovalCsv(entry, input.removedOn);
  const report = await importSgoList({ source: entry.source, csv, sourceUrl: input.sourceUrl ?? entry.sourceUrl, retrievedAt: retrievalInstant(input.learnedOn) }, userActor(actor));
  return {
    message: `${entry.name} is marked removed effective ${input.removedOn}. Gifts on or after that date are refused.`,
    details: [{ label: "File SHA-256 (audit log)", value: report.sha256 }],
  };
});

export const linkListEntry = operation(async (actor, formData) => {
  const input = parseForm(linkEntrySchema, { orgId: readText(formData, "orgId"), entryId: readText(formData, "entryId") }, "Choose a list entry.");
  const profile = await linkProfileToListEntry(input.orgId, input.entryId, userActor(actor));
  return { message: input.entryId === null ? `${profile.displayName} is no longer linked to a list entry.` : `${profile.displayName} is linked to the list entry.` };
});

/* ---------------------------------------------------------------------------------------- organizations */

export const createSgoOp = operation(async (actor, formData) => {
  const input = parseForm(createSgoFormSchema, createSgoFromForm(formData), "Check the organization details.");
  const { org } = await createSgo(input, userActor(actor));
  return { message: `Created ${org.name}. It is not on any list until you link it to a list entry.`, details: [{ label: "Organization id", value: org.id }], link: { href: `/admin/organizations/${org.id}`, label: "Open organization" } };
});

export const createBusinessOp = operation(async (actor, formData) => {
  const input = parseForm(createBusinessFormSchema, createBusinessFromForm(formData), "Check the business details.");
  const { org } = await createBusiness({ ...input, vendorType: input.vendorType as Parameters<typeof createBusiness>[0]["vendorType"], website: input.website ?? undefined }, userActor(actor));
  return { message: `Created ${org.name}. Its success fee is $0 until you set one.`, details: [{ label: "Organization id", value: org.id }], link: { href: `/admin/organizations/${org.id}`, label: "Open organization" } };
});

export const setOrgStatusOp = operation(async (actor, formData) => {
  const input = parseForm(orgStatusSchema, { orgId: readText(formData, "orgId"), status: readText(formData, "status"), reason: readText(formData, "reason") }, "Check the details.");
  const org = await setOrganizationStatus(input, actor);
  return { message: org.status === "suspended" ? `${org.name} is suspended.` : `${org.name} is active again.` };
});

export const addMemberOp = operation(async (actor, formData) => {
  const input = parseForm(addMemberSchema, { orgId: readText(formData, "orgId"), email: readText(formData, "email"), role: readText(formData, "role") }, "Check the member details.");
  const { user, isNewUser } = await addMember(input, userActor(actor));
  return { message: `${user.email} was added as ${input.role}.${isNewUser ? " A new account was created; they sign in with their email." : ""}` };
});

export const changeRoleOp = operation(async (actor, formData) => {
  const input = parseForm(changeRoleSchema, { orgId: readText(formData, "orgId"), userId: readText(formData, "userId"), role: readText(formData, "role") }, "Choose a role.");
  await updateMemberRole(input, userActor(actor));
  return { message: `Role changed to ${input.role}.` };
});

export const removeMemberOp = operation(async (actor, formData) => {
  const input = parseForm(removeMemberSchema, { orgId: readText(formData, "orgId"), userId: readText(formData, "userId") }, "Missing member.");
  await removeMember(input, userActor(actor));
  return { message: "The member was removed." };
});

export const setSuccessFeeOp = operation(async (actor, formData) => {
  const input = parseForm(successFeeSchema, { orgId: readText(formData, "orgId"), flatDollars: readText(formData, "flatDollars"), percent: readText(formData, "percent") }, "Check the fee terms.");
  const profile = await setSuccessFee(input.orgId, { flatCents: input.flatDollars, bps: input.percent }, userActor(actor));
  return { message: `Saved. ${profile.displayName} pays ${formatUsd(profile.successFeeFlatCents, { cents: true })} plus ${formatBps(profile.successFeeBps)} per completed booking, billed to the business.` };
});

/* ---------------------------------------------------------------------------------------------- jobs */

export const retryJobOp = operation(async (actor, formData) => {
  const { jobId } = parseForm(retryJobSchema, { jobId: readText(formData, "jobId") }, "Missing job.");
  const before = await getJob(jobId);
  const job = await retryJob(jobId);
  // The queue does not audit operator retries itself.
  await audit({ actor: { type: "user", id: actor.userId }, action: "job.retry", target: { type: "job", id: job.id }, metadata: { type: job.type, previousStatus: before.status, previousAttempts: before.attempts }, request: actor.request });
  return { message: `Job ${job.type} is queued to run now.` };
});

/* -------------------------------------------------------------------------------------------- privacy */

export const processDeletionOp = operation(async (actor, formData) => {
  const input = parseForm(deletionSchema, { householdId: readText(formData, "householdId"), reason: readText(formData, "reason") }, "Check the request details.");
  const report = await processDeletionRequest(input.householdId, userActor(actor), { reason: input.reason });

  // The households service leaves open rail connections and verifications for their own services to close.
  const followUp: string[] = [];
  let railsClosed = 0;
  if (report.railConnectionIdsToClose.length > 0) {
    try {
      railsClosed = (await revokeConnectionsForConsent(report.railConnectionIdsToClose, { actor: userActor(actor) })).revoked.length;
    } catch (e) {
      followUp.push(`Data connections could not all be closed (${isAppError(e) ? e.message : "unexpected error"}). Process the request again to retry.`);
    }
  }
  let canceled = 0;
  for (const v of await getVerificationScopes(report.openVerificationIds)) {
    try {
      await cancelVerification(v.orgId, v.id, { type: "user", id: actor.userId, mode: v.mode, request: actor.request });
      canceled++;
    } catch (e) {
      followUp.push(`Verification ${v.id} was not canceled (${isAppError(e) ? e.message : "unexpected error"}).`);
    }
  }

  return {
    message: followUp.length === 0 ? "The deletion request was processed." : `The deletion request was processed, with follow-up needed: ${followUp.join(" ")}`,
    details: [
      { label: "Raw uploads purged", value: String(report.purgedObjectIds.length) },
      { label: "Already purged", value: String(report.alreadyPurgedObjectIds.length) },
      { label: "Documents marked purged", value: String(report.documentIdsMarkedPurged.length) },
      { label: "Dates of birth cleared", value: String(report.membersDobCleared) },
      { label: "Phone numbers cleared", value: String(report.phonesCleared) },
      { label: "Consents revoked", value: String(report.revokedConsentIds.length) },
      { label: "Data connections closed", value: `${railsClosed} of ${report.railConnectionIdsToClose.length}` },
      { label: "Open verifications canceled", value: `${canceled} of ${report.openVerificationIds.length}` },
    ],
  };
});

/* -------------------------------------------------------------------------------------------- refunds */

export const refundOp = operation(async (actor, formData) => {
  const input = parseForm(refundSchema, { donationId: readText(formData, "donationId"), reason: readText(formData, "reason"), counselReference: readText(formData, "counselReference") }, "Check the refund details.");
  if (input.reason.length < donationsPolicy.REFUND_REASON_MIN_LENGTH) {
    throw invalid(`Give a reason of at least ${donationsPolicy.REFUND_REASON_MIN_LENGTH} characters.`, { fields: { reason: "Too short." } });
  }
  const result = await recordOperatorRefund({ donationId: input.donationId, actorUserId: actor.userId, reason: input.reason, counselReference: input.counselReference, request: actor.request });
  return {
    message: result.refundStatus === "succeeded" ? "The refund was issued." : "The refund was requested. The gift stays succeeded until the processor confirms it.",
    details: [
      { label: "Payment", value: result.paymentId },
      { label: "Donations on the payment", value: result.donationIds.join(", ") },
    ],
  };
});
