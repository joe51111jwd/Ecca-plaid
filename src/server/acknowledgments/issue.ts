import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { now } from "@/lib/clock";
import { sha256Hex } from "@/lib/crypto";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { audit } from "@/server/audit";
import { queueEmail, renderEmail } from "@/server/email";
import { emitEvent } from "@/server/events";
import { enqueue } from "@/server/jobs";
import { isSystemActor, type SgoActor } from "@/server/sgos";
import { putObject } from "@/server/storage";
import { authorizeStaff, requireOrgId, type ActorContext } from "./access";
import { buildAcknowledgment, type AcknowledgmentBuild } from "./build";
import { buildLetter, letterParagraphs } from "./letter";
import { LETTER_COPY, NOTICE_COPY } from "./letter-copy";
import { renderAcknowledgmentPdf } from "./pdf";

/**
 * Issuing the official acknowledgment: build it from the ledger, render the PDF, store it encrypted (purpose
 * acknowledgment_pdf), version it (a changed year supersedes the earlier version, every version is kept), and deliver
 * it by email ONLY while the donor's e-delivery consent is active, otherwise as a paper mailing task for the SGO
 * (Temp. Treas. Reg. 1.25F-4T(c)(1): electronic only with consent not withdrawn before the statement is furnished).
 * Each spouse is a separate donor, so each gets a separate acknowledgment and number.
 */

const { acknowledgments, acknowledgmentRefreshes, donors, donorDeliveryConsents } = schema;
export type AcknowledgmentRow = typeof acknowledgments.$inferSelect;
type ConsentRow = typeof donorDeliveryConsents.$inferSelect;

const scopeSchema = z.strictObject({ donorId: z.string().min(1).max(100), taxYear: z.number().int().min(2000).max(2200), mode: z.enum(["test", "live"]) });
export type AcknowledgmentScope = z.input<typeof scopeSchema>;

export interface IssueResult {
  /** issued: a new version; unchanged: the latest issued version already says exactly this; blocked; not_required (no designated gift received). */
  outcome: "issued" | "unchanged" | "blocked" | "not_required";
  acknowledgment: AcknowledgmentRow | null;
  /** The version this one superseded. */
  superseded: AcknowledgmentRow | null;
  build: AcknowledgmentBuild;
}

function parseScope(input: unknown) {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the acknowledgment scope.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "input", i.message])) });
  return parsed.data;
}

/** The snake_case shape of `acknowledgment.issued` webhook events (and the API). No donor contact details. */
export function toApiAcknowledgment(row: AcknowledgmentRow) {
  return {
    id: row.id,
    object: "acknowledgment" as const,
    mode: row.mode,
    donor_id: row.donorId,
    tax_year: row.taxYear,
    version: row.version,
    status: row.status,
    sgo_ein: row.sgoEin,
    unique_donor_number: row.uniqueDonorNumber,
    total_designated_cents: row.totalDesignatedCents,
    goods_or_services_provided: row.goodsOrServicesProvided,
    goods_or_services_value_cents: row.goodsOrServicesValueCents,
    donation_ids: row.donationIds,
    delivery: row.delivery,
    issued_at: row.issuedAt?.toISOString() ?? null,
    superseded_by: row.supersededById,
    pdf_sha256: row.pdfSha256,
  };
}

/** The donor's current e-delivery consent with this SGO, locked so a concurrent withdrawal waits for the decision. */
async function activeConsent(tx: DbOrTx, orgId: string, donorId: string, mode: Mode): Promise<ConsentRow | null> {
  const [latest] = await tx
    .select()
    .from(donorDeliveryConsents)
    .where(and(eq(donorDeliveryConsents.orgId, orgId), eq(donorDeliveryConsents.donorId, donorId), eq(donorDeliveryConsents.mode, mode)))
    .orderBy(desc(donorDeliveryConsents.grantedAt), desc(donorDeliveryConsents.id))
    .limit(1)
    .for("update");
  return latest && latest.withdrawnAt === null ? latest : null;
}

async function resolvePendingRefresh(tx: DbOrTx, key: { orgId: string; donorId: string; taxYear: number; mode: Mode }, requestedAt: Date | null): Promise<void> {
  if (!requestedAt) return;
  await tx
    .update(acknowledgmentRefreshes)
    .set({ resolvedAt: now() })
    .where(
      and(
        eq(acknowledgmentRefreshes.orgId, key.orgId),
        eq(acknowledgmentRefreshes.donorId, key.donorId),
        eq(acknowledgmentRefreshes.taxYear, key.taxYear),
        eq(acknowledgmentRefreshes.mode, key.mode),
        eq(acknowledgmentRefreshes.requestedAt, requestedAt),
        isNull(acknowledgmentRefreshes.resolvedAt),
      ),
    );
}

/** Issue (or block, or confirm unchanged) inside the caller's transaction. Caller has authorized. */
export async function issueInTx(tx: DbOrTx, orgId: string, scope: { donorId: string; taxYear: number; mode: Mode }, who: ActorContext): Promise<IssueResult> {
  const { donorId, taxYear, mode } = scope;
  const key = { orgId, donorId, taxYear, mode };
  // One generator at a time per donor: the version numbers and the superseding stay linear.
  const [donor] = await tx.select({ id: donors.id }).from(donors).where(eq(donors.id, donorId)).for("update");
  if (!donor) throw notFound("Donor");
  const [refresh] = await tx
    .select()
    .from(acknowledgmentRefreshes)
    .where(and(eq(acknowledgmentRefreshes.orgId, orgId), eq(acknowledgmentRefreshes.donorId, donorId), eq(acknowledgmentRefreshes.taxYear, taxYear), eq(acknowledgmentRefreshes.mode, mode), isNull(acknowledgmentRefreshes.resolvedAt)));
  const requestedAt = refresh?.requestedAt ?? null;
  const rows = await tx
    .select()
    .from(acknowledgments)
    .where(and(eq(acknowledgments.orgId, orgId), eq(acknowledgments.donorId, donorId), eq(acknowledgments.taxYear, taxYear), eq(acknowledgments.mode, mode)))
    .orderBy(desc(acknowledgments.version));
  const latest = rows[0] ?? null;
  const latestIssued = rows.find((r) => r.status === "issued") ?? null;
  const placeholder = latest && (latest.status === "blocked" || latest.status === "draft") ? latest : null;
  const build = await buildAcknowledgment(orgId, donorId, taxYear, { mode, previouslyIssued: rows.some((r) => r.status === "issued" || r.status === "superseded") }, tx);
  const at = now();

  if (build.status === "not_required") {
    if (placeholder) await tx.delete(acknowledgments).where(eq(acknowledgments.id, placeholder.id));
    await resolvePendingRefresh(tx, key, requestedAt);
    return { outcome: "not_required", acknowledgment: null, superseded: null, build };
  }

  if (build.status === "blocked") {
    const values = {
      status: "blocked" as const,
      blockedReason: build.blockers[0]?.message ?? null,
      blockers: build.blockers,
      sgoEin: build.sgo.ein,
      uniqueDonorNumber: build.donorNumber?.number ?? null,
      totalDesignatedCents: build.totalDesignatedCents,
      nonDesignatedCents: build.totalNonDesignatedCents,
      goodsOrServicesProvided: build.goodsOrServices.provided,
      goodsOrServicesValueCents: build.goodsOrServices.valueCents,
      goodsOrServicesDescription: build.goodsOrServices.description,
      donationIds: build.donationIds,
      updatedAt: at,
    };
    let row: AcknowledgmentRow;
    const changed = !placeholder || JSON.stringify(placeholder.blockers) !== JSON.stringify(build.blockers) || placeholder.totalDesignatedCents !== build.totalDesignatedCents;
    if (placeholder) {
      [row] = await tx.update(acknowledgments).set(values).where(eq(acknowledgments.id, placeholder.id)).returning();
    } else {
      [row] = await tx.insert(acknowledgments).values({ id: newId("acknowledgment"), orgId, donorId, mode, taxYear, version: (latest?.version ?? 0) + 1, ...values, createdAt: at }).returning();
    }
    if (changed) {
      await audit({ actor: who.audit, orgId, action: "acknowledgment.blocked", target: { type: "acknowledgment", id: row.id }, metadata: { donorId, taxYear, mode, blockers: build.blockers.map((b) => b.code), systemReason: who.systemReason ?? null }, request: who.request }, tx);
    }
    await resolvePendingRefresh(tx, key, requestedAt);
    return { outcome: "blocked", acknowledgment: row, superseded: null, build };
  }

  if (latestIssued && latestIssued.contentSha256 === build.contentSha256) {
    if (placeholder) await tx.delete(acknowledgments).where(eq(acknowledgments.id, placeholder.id));
    await resolvePendingRefresh(tx, key, requestedAt);
    return { outcome: "unchanged", acknowledgment: latestIssued, superseded: null, build };
  }

  const snapshot = build.snapshot;
  if (!snapshot || !build.contentSha256) throw new AppError("internal", "A ready acknowledgment has no snapshot");
  const id = placeholder?.id ?? newId("acknowledgment");
  const version = placeholder?.version ?? (latest?.version ?? 0) + 1;
  const letter = buildLetter({
    acknowledgmentId: id,
    mode,
    taxYear,
    version,
    issuedAt: at,
    snapshot,
    totalDesignatedCents: build.totalDesignatedCents,
    totalNonDesignatedCents: build.totalNonDesignatedCents,
    goodsOrServices: build.goodsOrServices,
    previous: latestIssued?.issuedAt ? { version: latestIssued.version, issuedAt: latestIssued.issuedAt } : null,
  });
  const pdf = await renderAcknowledgmentPdf(letter, at);
  const filename = `${mode === "test" ? "sandbox-" : ""}acknowledgment-${taxYear}-${donorId}-v${version}.pdf`;
  const object = await putObject({ bytes: pdf, contentType: "application/pdf", purpose: "acknowledgment_pdf", filename, orgId }, tx);
  const consent = await activeConsent(tx, orgId, donorId, mode);

  const values = {
    status: "issued" as const,
    blockedReason: null,
    blockers: [],
    sgoEin: snapshot.sgo.ein,
    uniqueDonorNumber: snapshot.donorNumber.number,
    totalDesignatedCents: build.totalDesignatedCents,
    nonDesignatedCents: build.totalNonDesignatedCents,
    goodsOrServicesProvided: build.goodsOrServices.provided,
    goodsOrServicesValueCents: build.goodsOrServices.valueCents,
    goodsOrServicesDescription: build.goodsOrServices.description,
    donationIds: build.donationIds,
    pdfObjectId: object.id,
    pdfSha256: sha256Hex(pdf),
    contentSha256: build.contentSha256,
    snapshot,
    delivery: consent ? ("email" as const) : ("paper_required" as const),
    deliveryEmail: consent?.email ?? null,
    deliveryConsentId: consent?.id ?? null,
    issuedAt: at,
    deliveredAt: null,
    issuedBy: who.label,
    updatedAt: at,
  };
  let row: AcknowledgmentRow;
  if (placeholder) [row] = await tx.update(acknowledgments).set(values).where(eq(acknowledgments.id, placeholder.id)).returning();
  else [row] = await tx.insert(acknowledgments).values({ id, orgId, donorId, mode, taxYear, version, ...values, createdAt: at }).returning();

  let superseded: AcknowledgmentRow | null = null;
  if (latestIssued) {
    [superseded] = await tx.update(acknowledgments).set({ status: "superseded", supersededAt: at, supersededById: row.id, updatedAt: at }).where(eq(acknowledgments.id, latestIssued.id)).returning();
  }

  if (consent) {
    const paragraphs = [...letterParagraphs(letter), LETTER_COPY.emailPdfNote];
    const details = [...letter.meta, { label: letter.donor.label, value: letter.donor.lines.join("\n") }];
    const { html, text } = renderEmail({ heading: letter.title, preheader: `${letter.title}: ${letter.sgo.name}, ${taxYear}`, paragraphs, details });
    const subject = `${mode === "test" ? NOTICE_COPY.sandboxPrefix : ""}${letter.title} (${taxYear}) - ${letter.sgo.name}`;
    const email = await queueEmail({ to: consent.email, subject, template: "acknowledgment", html, text, related: { type: "acknowledgment", id: row.id } }, tx);
    await enqueue("email.send", { emailId: email.id }, { dedupeKey: `email:${email.id}` }, tx);
    [row] = await tx.update(acknowledgments).set({ emailId: email.id }).where(eq(acknowledgments.id, row.id)).returning();
  }

  await emitEvent({ orgId, type: "acknowledgment.issued", payload: { ...toApiAcknowledgment(row), supersedes: superseded?.id ?? null }, mode }, tx);
  await audit(
    {
      actor: who.audit,
      orgId,
      action: "acknowledgment.issue",
      target: { type: "acknowledgment", id: row.id },
      metadata: { donorId, taxYear, mode, version, delivery: row.delivery, supersedes: superseded?.id ?? null, pdfSha256: row.pdfSha256, totalDesignatedCents: row.totalDesignatedCents, systemReason: who.systemReason ?? null },
      request: who.request,
    },
    tx,
  );
  await resolvePendingRefresh(tx, key, requestedAt);
  return { outcome: "issued", acknowledgment: row, superseded, build };
}

/**
 * Builds the donor's acknowledgment for the SGO and calendar year and issues it when nothing is missing: a new
 * version when anything it prints changed, "unchanged" when the latest issued version already says exactly this,
 * "blocked" (stored, with every reason) when the EIN, the donor number or another required item is missing.
 */
export async function issueAcknowledgment(orgId: string, scope: AcknowledgmentScope, actor: SgoActor, dbOrTx?: DbOrTx): Promise<IssueResult> {
  const org = requireOrgId(orgId);
  const data = parseScope(scope);
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    return issueInTx(tx, org, data, who);
  });
}

/* ------------------------------------------------------------------ paper delivery and consent withdrawal */

const mailedSchema = z.strictObject({ note: z.string().trim().max(500).optional() });

/**
 * Records that SGO staff mailed the printed acknowledgment (the paper path, also used after a bounced email). Sets
 * the delivery to paper with the time it was recorded.
 */
export async function markAcknowledgmentMailed(orgId: string, acknowledgmentId: string, input: z.input<typeof mailedSchema>, actor: SgoActor, dbOrTx?: DbOrTx): Promise<AcknowledgmentRow> {
  const org = requireOrgId(orgId);
  const parsed = mailedSchema.safeParse(input ?? {});
  if (!parsed.success) throw invalid("Check the note.", { fields: { note: parsed.error.issues[0]?.message ?? "Invalid" } });
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const who = await authorizeStaff(tx, actor, org);
    const [row] = typeof acknowledgmentId === "string" ? await tx.select().from(acknowledgments).where(and(eq(acknowledgments.id, acknowledgmentId), eq(acknowledgments.orgId, org))).for("update") : [];
    if (!row) throw notFound("Acknowledgment");
    if (row.status !== "issued" && row.status !== "superseded") throw conflict(`Only an issued acknowledgment can be mailed; this one is ${row.status}.`);
    const at = now();
    const [updated] = await tx.update(acknowledgments).set({ delivery: "paper_required", deliveredAt: at, mailedBy: who.label, updatedAt: at }).where(eq(acknowledgments.id, row.id)).returning();
    await audit({ actor: who.audit, orgId: org, action: "acknowledgment.mailed", target: { type: "acknowledgment", id: row.id }, metadata: { donorId: row.donorId, taxYear: row.taxYear, mode: row.mode, version: row.version, note: parsed.data.note ?? null }, request: who.request }, tx);
    return updated;
  });
}

const withdrawSchema = z.strictObject({ donorId: z.string().min(1).max(100), mode: z.enum(["test", "live"]), reason: z.string().trim().max(500).optional() });

/**
 * Switches a donor's future acknowledgments from this SGO to paper by withdrawing every active e-delivery consent.
 * The donor themselves (a signed-in user who owns the donor record) or SGO staff (recording a request received by
 * mail or phone) may do it. An acknowledgment already emailed was already furnished; later versions go on paper.
 */
export async function withdrawEDelivery(orgId: string, input: z.input<typeof withdrawSchema>, actor: SgoActor, dbOrTx?: DbOrTx): Promise<{ withdrawn: ConsentRow[] }> {
  const org = requireOrgId(orgId);
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) throw invalid("Check the request.", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])) });
  const { donorId, mode } = parsed.data;
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const [donor] = await tx.select().from(donors).where(eq(donors.id, donorId));
    if (!donor) throw notFound("Donor");
    let who: ActorContext;
    if (!isSystemActor(actor) && typeof actor?.userId === "string") {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, actor.userId));
      if (!user) throw forbidden();
      const ownsDonor = donor.userId === user.id || donor.email === user.email.trim().toLowerCase();
      who = ownsDonor ? { audit: { type: "user", id: user.id }, request: actor.request ?? null, label: user.id } : await authorizeStaff(tx, actor, org);
    } else {
      who = await authorizeStaff(tx, actor, org);
    }
    const active = await tx
      .select()
      .from(donorDeliveryConsents)
      .where(and(eq(donorDeliveryConsents.orgId, org), eq(donorDeliveryConsents.donorId, donorId), eq(donorDeliveryConsents.mode, mode), isNull(donorDeliveryConsents.withdrawnAt)))
      .for("update");
    if (active.length === 0) return { withdrawn: [] };
    const at = now();
    const withdrawn = await tx
      .update(donorDeliveryConsents)
      .set({ withdrawnAt: at, withdrawnByUserId: who.audit.type === "user" ? (who.audit.id ?? null) : null })
      .where(inArray(donorDeliveryConsents.id, active.map((c) => c.id)))
      .returning();
    await audit({ actor: who.audit, orgId: org, action: "donor_delivery_consent.withdraw", target: { type: "donor", id: donorId }, metadata: { mode, consentIds: withdrawn.map((c) => c.id), reason: parsed.data.reason ?? null }, request: who.request }, tx);
    return { withdrawn };
  });
}
