import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { getSgoProfile } from "@/server/sgos";
import { acknowledgmentDueDate, irsContributionReportDueDate } from "@/taxmath";
import { donorAddressLines, donorFullName, type AcknowledgmentBlocker } from "./build";
import { SANDBOX_DONOR_NUMBER_PREFIX, WORKLIST_ID_CHUNK } from "./policy";
import { acknowledgmentSummaries, donorNumberSummaries, type AcknowledgmentSummary, type DonorNumberSummary } from "./status";

/**
 * The SGO's acknowledgment worklist for one calendar year and mode: every donor who designated a gift that year,
 * what their acknowledgment needs next, and the counts the January reminders report. Derived from stored state
 * (donations, donor numbers, acknowledgment versions, refresh requests, consents) without rendering anything, so
 * it is cheap enough for the dashboard and the daily job. Reads only.
 */

const { donations, donors, acknowledgments, donorDeliveryConsents } = schema;

/**
 * The next step for one donor, most urgent first:
 *  - add_sgo_ein:             the organization's EIN is missing (required item (A)).
 *  - register_portal:         live only: no donor number can exist before IRS SGO portal registration.
 *  - enter_donor_number:      enter (or import) the number created in the IRS SGO portal.
 *  - generate_sandbox_number: test only: generate a TEST- number.
 *  - review:                  blocked for another reason (all gifts refunded, incomplete address, sandbox number in live, ...).
 *  - issue:                   nothing is missing: issue (or re-issue after a change).
 *  - mail_paper:              issued on paper (no active e-delivery consent) and not yet recorded as mailed.
 *  - none:                    issued, delivered and up to date.
 */
export type WorklistAction = "add_sgo_ein" | "register_portal" | "enter_donor_number" | "generate_sandbox_number" | "review" | "issue" | "mail_paper" | "none";

export const WORKLIST_ACTIONS: readonly WorklistAction[] = ["add_sgo_ein", "register_portal", "enter_donor_number", "generate_sandbox_number", "review", "issue", "mail_paper", "none"];

export interface WorklistItem {
  donor: { id: string; fullName: string; email: string; addressLines: string[] };
  /** Received (succeeded) designated total for the year; refunded gifts are out. */
  designatedCents: number;
  nonDesignatedCents: number;
  giftCount: number;
  refundedCount: number;
  lastContributedAt: Date | null;
  donorNumber: DonorNumberSummary;
  acknowledgment: AcknowledgmentSummary;
  /** The reasons stored on the latest blocked version, if it is blocked. */
  blockers: AcknowledgmentBlocker[];
  eDelivery: { active: boolean; email: string | null; consentId: string | null };
  action: WorklistAction;
}

export interface WorklistCounts {
  donors: number;
  /** Issued, in force and reflecting every change. */
  upToDate: number;
  missingDonorNumber: number;
  readyToIssue: number;
  paperToMail: number;
  needsReview: number;
  /** Donors needing any action at all (everything except "none"). */
  outstanding: number;
}

export interface Worklist {
  orgId: string;
  mode: Mode;
  taxYear: number;
  acknowledgmentDueDate: string;
  reportDueDate: string;
  sgo: { name: string; legalName: string | null; ein: string | null; portalRegistered: boolean };
  counts: WorklistCounts;
  byAction: Record<WorklistAction, number>;
  items: WorklistItem[];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

const isSandboxNumber = (n: DonorNumberSummary) => n.source === "sandbox_generated" || (n.number ?? "").toUpperCase().startsWith(SANDBOX_DONOR_NUMBER_PREFIX);

export function nextAction(input: {
  mode: Mode;
  einOnFile: boolean;
  portalRegistered: boolean;
  donorNumber: DonorNumberSummary;
  acknowledgment: AcknowledgmentSummary;
  blockers: readonly AcknowledgmentBlocker[];
  designatedCents: number;
}): WorklistAction {
  const { acknowledgment: ack } = input;
  const upToDate = ack.status === "issued" && !ack.needsRegeneration;
  if (upToDate) return ack.issued && ack.issued.delivery === "paper_required" && !ack.issued.deliveredAt ? "mail_paper" : "none";
  // Everything acknowledged was refunded: building again yields a blocked version that a person must review.
  if (input.designatedCents === 0) return ack.status === "blocked" ? "review" : "issue";
  if (!input.einOnFile) return "add_sgo_ein";
  if (input.donorNumber.number === null) {
    if (input.mode === "live" && !input.portalRegistered) return "register_portal";
    return input.mode === "test" ? "generate_sandbox_number" : "enter_donor_number";
  }
  if (input.mode === "live" && isSandboxNumber(input.donorNumber)) return "review";
  // Other reasons a stored version was blocked (incomplete address, goods without a description) need a person.
  const otherBlockers = input.blockers.filter((b) => !["sgo_ein_missing", "donor_number_missing", "donor_number_pending_sgo_registration"].includes(b.code));
  if (ack.status === "blocked" && !ack.needsRegeneration && otherBlockers.length > 0) return "review";
  return "issue";
}

/** Builds the worklist. The caller authorizes and audits. */
export async function computeWorklist(db: DbOrTx, orgId: string, mode: Mode, taxYear: number): Promise<Worklist> {
  const { profile } = await getSgoProfile(orgId, db);
  const sums = await db
    .select({
      donorId: donations.donorId,
      designatedCents: sql<string>`coalesce(sum(case when ${donations.status} = 'succeeded' then ${donations.designatedAmountCents} else 0 end), 0)`,
      nonDesignatedCents: sql<string>`coalesce(sum(case when ${donations.status} = 'succeeded' then ${donations.nonDesignatedAmountCents} else 0 end), 0)`,
      giftCount: sql<string>`count(*) filter (where ${donations.status} = 'succeeded')`,
      refundedCount: sql<string>`count(*) filter (where ${donations.status} = 'refunded')`,
      lastContributedAt: max(donations.contributedAt),
    })
    .from(donations)
    .where(and(eq(donations.orgId, orgId), eq(donations.mode, mode), eq(donations.taxYear, taxYear), inArray(donations.status, ["succeeded", "refunded"])))
    .groupBy(donations.donorId);

  const donorIds = sums.map((s) => s.donorId);
  const donorRows: Array<typeof donors.$inferSelect> = [];
  const numbers = new Map<string, DonorNumberSummary>();
  const acks = new Map<string, AcknowledgmentSummary>();
  const blockersByDonor = new Map<string, AcknowledgmentBlocker[]>();
  const consents = new Map<string, typeof donorDeliveryConsents.$inferSelect>();
  for (const ids of chunks(donorIds, WORKLIST_ID_CHUNK)) {
    donorRows.push(...(await db.select().from(donors).where(inArray(donors.id, ids))));
    const scope = { orgId, mode, taxYear, donorIds: ids };
    for (const [k, v] of await donorNumberSummaries({ ...scope, sgoPortalRegistered: profile.irsPortalRegistered }, db)) numbers.set(k, v);
    for (const [k, v] of await acknowledgmentSummaries(scope, db)) acks.set(k, v);
    const blocked = await db
      .select({ donorId: acknowledgments.donorId, blockers: acknowledgments.blockers, version: acknowledgments.version })
      .from(acknowledgments)
      .where(and(eq(acknowledgments.orgId, orgId), eq(acknowledgments.mode, mode), eq(acknowledgments.taxYear, taxYear), eq(acknowledgments.status, "blocked"), inArray(acknowledgments.donorId, ids)));
    for (const b of blocked) blockersByDonor.set(b.donorId, b.blockers as AcknowledgmentBlocker[]);
    const consentRows = await db
      .select()
      .from(donorDeliveryConsents)
      .where(and(eq(donorDeliveryConsents.orgId, orgId), eq(donorDeliveryConsents.mode, mode), inArray(donorDeliveryConsents.donorId, ids)))
      .orderBy(desc(donorDeliveryConsents.grantedAt), desc(donorDeliveryConsents.id));
    for (const c of consentRows) if (!consents.has(c.donorId)) consents.set(c.donorId, c);
  }
  const donorById = new Map(donorRows.map((d) => [d.id, d]));

  const items: WorklistItem[] = [];
  for (const s of sums) {
    const donor = donorById.get(s.donorId);
    const acknowledgment = acks.get(s.donorId);
    const donorNumber = numbers.get(s.donorId);
    if (!donor || !acknowledgment || !donorNumber) continue;
    const designatedCents = Number(s.designatedCents);
    // Every gift refunded before any acknowledgment existed: there is nothing to acknowledge.
    if (designatedCents === 0 && acknowledgment.status === "not_generated") continue;
    const blockers = acknowledgment.status === "blocked" ? (blockersByDonor.get(s.donorId) ?? []) : [];
    const consent = consents.get(s.donorId);
    const active = consent !== undefined && consent.withdrawnAt === null;
    items.push({
      donor: { id: donor.id, fullName: donorFullName(donor), email: donor.email, addressLines: donorAddressLines(donor) },
      designatedCents,
      nonDesignatedCents: Number(s.nonDesignatedCents),
      giftCount: Number(s.giftCount),
      refundedCount: Number(s.refundedCount),
      lastContributedAt: s.lastContributedAt ?? null,
      donorNumber,
      acknowledgment,
      blockers,
      eDelivery: { active, email: active ? consent.email : null, consentId: active ? consent.id : null },
      action: nextAction({ mode, einOnFile: Boolean(profile.ein), portalRegistered: profile.irsPortalRegistered, donorNumber, acknowledgment, blockers, designatedCents }),
    });
  }
  const rank = (a: WorklistAction) => WORKLIST_ACTIONS.indexOf(a);
  items.sort((a, b) => rank(a.action) - rank(b.action) || a.donor.fullName.localeCompare(b.donor.fullName) || a.donor.id.localeCompare(b.donor.id));

  const byAction = Object.fromEntries(WORKLIST_ACTIONS.map((a) => [a, 0])) as Record<WorklistAction, number>;
  for (const i of items) byAction[i.action] += 1;
  const counts: WorklistCounts = {
    donors: items.length,
    upToDate: items.filter((i) => i.acknowledgment.status === "issued" && !i.acknowledgment.needsRegeneration).length,
    missingDonorNumber: byAction.enter_donor_number + byAction.register_portal + byAction.generate_sandbox_number,
    readyToIssue: byAction.issue,
    paperToMail: byAction.mail_paper,
    needsReview: byAction.review,
    outstanding: items.length - byAction.none,
  };
  return {
    orgId,
    mode,
    taxYear,
    acknowledgmentDueDate: acknowledgmentDueDate(taxYear),
    reportDueDate: irsContributionReportDueDate(taxYear),
    sgo: { name: profile.displayName, legalName: profile.legalName, ein: profile.ein, portalRegistered: profile.irsPortalRegistered },
    counts,
    byAction,
    items,
  };
}
