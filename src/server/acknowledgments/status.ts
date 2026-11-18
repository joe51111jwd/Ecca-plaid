import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";

/** Status reads for the SGO dashboard and the donor's page. */

const { acknowledgmentRefreshes, acknowledgments, donorNumbers } = schema;

/* ------------------------------------------------------------------ status reads */

export type AcknowledgmentStatus = "not_generated" | "draft" | "issued" | "superseded" | "blocked";

export interface AcknowledgmentSummary {
  status: AcknowledgmentStatus;
  /** Latest version's id and number, when one exists. */
  acknowledgmentId: string | null;
  version: number | null;
  issuedAt: Date | null;
  deliveredAt: Date | null;
  delivery: "email" | "paper_required" | null;
  blockedReason: string | null;
  pdfObjectId: string | null;
  /** A gift or refund changed the year's total after the latest version (or no version exists yet). */
  needsRegeneration: boolean;
  /**
   * The version currently in force with the donor (status "issued"), which can be older than the latest version when
   * a later version is blocked: the donor keeps the document they were given until a new one is issued.
   */
  issued: IssuedVersionSummary | null;
}

export interface IssuedVersionSummary {
  acknowledgmentId: string;
  version: number;
  issuedAt: Date | null;
  delivery: "email" | "paper_required";
  deliveredAt: Date | null;
  pdfObjectId: string | null;
  totalDesignatedCents: number;
}

export interface StatusScope {
  orgId: string;
  mode: Mode;
  taxYear: number;
  donorIds: readonly string[];
}

/** The latest acknowledgment of each donor for one SGO and calendar year. */
export async function acknowledgmentSummaries(scope: StatusScope, dbOrTx?: DbOrTx): Promise<Map<string, AcknowledgmentSummary>> {
  const out = new Map<string, AcknowledgmentSummary>();
  if (scope.donorIds.length === 0) return out;
  const db = dbOrTx ?? (await getDb());
  const ids = [...new Set(scope.donorIds)];
  const rows = await db
    .select()
    .from(acknowledgments)
    .where(and(eq(acknowledgments.orgId, scope.orgId), eq(acknowledgments.mode, scope.mode), eq(acknowledgments.taxYear, scope.taxYear), inArray(acknowledgments.donorId, ids)))
    .orderBy(desc(acknowledgments.version));
  const pending = await db
    .select({ donorId: acknowledgmentRefreshes.donorId })
    .from(acknowledgmentRefreshes)
    .where(
      and(
        eq(acknowledgmentRefreshes.orgId, scope.orgId),
        eq(acknowledgmentRefreshes.mode, scope.mode),
        eq(acknowledgmentRefreshes.taxYear, scope.taxYear),
        inArray(acknowledgmentRefreshes.donorId, ids),
        isNull(acknowledgmentRefreshes.resolvedAt),
      ),
    );
  const stale = new Set(pending.map((p) => p.donorId));
  for (const donorId of ids) {
    const latest = rows.find((r) => r.donorId === donorId);
    const issued = rows.find((r) => r.donorId === donorId && r.status === "issued");
    out.set(donorId, {
      status: latest?.status ?? "not_generated",
      acknowledgmentId: latest?.id ?? null,
      version: latest?.version ?? null,
      issuedAt: latest?.issuedAt ?? null,
      deliveredAt: latest?.deliveredAt ?? null,
      delivery: latest?.delivery ?? null,
      blockedReason: latest?.blockedReason ?? null,
      pdfObjectId: latest?.pdfObjectId ?? null,
      needsRegeneration: stale.has(donorId),
      issued: issued
        ? { acknowledgmentId: issued.id, version: issued.version, issuedAt: issued.issuedAt, delivery: issued.delivery, deliveredAt: issued.deliveredAt, pdfObjectId: issued.pdfObjectId, totalDesignatedCents: issued.totalDesignatedCents }
        : null,
    });
  }
  return out;
}

/**
 * - assigned:                 a number entered or imported from the IRS SGO portal.
 * - sandbox:                  a test-mode number, not valid for filing.
 * - pending_sgo_registration: the SGO has not registered in the IRS SGO portal, so it cannot create numbers yet.
 * - not_assigned:             the SGO is registered but has not recorded this donor's number.
 */
export type DonorNumberStatus = "assigned" | "sandbox" | "pending_sgo_registration" | "not_assigned";

export interface DonorNumberSummary {
  status: DonorNumberStatus;
  number: string | null;
  source: "irs_portal_entered" | "irs_portal_import" | "sandbox_generated" | null;
  assignedAt: Date | null;
}

/** Each donor's unique donor number for one SGO and calendar year. Never invents one. */
export async function donorNumberSummaries(scope: StatusScope & { sgoPortalRegistered: boolean }, dbOrTx?: DbOrTx): Promise<Map<string, DonorNumberSummary>> {
  const out = new Map<string, DonorNumberSummary>();
  if (scope.donorIds.length === 0) return out;
  const db = dbOrTx ?? (await getDb());
  const ids = [...new Set(scope.donorIds)];
  const rows = await db
    .select()
    .from(donorNumbers)
    .where(and(eq(donorNumbers.orgId, scope.orgId), eq(donorNumbers.mode, scope.mode), eq(donorNumbers.taxYear, scope.taxYear), inArray(donorNumbers.donorId, ids)));
  for (const donorId of ids) {
    const row = rows.find((r) => r.donorId === donorId);
    if (row) {
      out.set(donorId, { status: row.source === "sandbox_generated" ? "sandbox" : "assigned", number: row.number, source: row.source, assignedAt: row.assignedAt });
    } else {
      out.set(donorId, { status: scope.sgoPortalRegistered ? "not_assigned" : "pending_sgo_registration", number: null, source: null, assignedAt: null });
    }
  }
  return out;
}
