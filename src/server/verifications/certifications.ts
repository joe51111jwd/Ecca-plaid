/**
 * Income certifications: a household adult's signed statement that a member had no income in the income year, or
 * that there was no income beyond what the documents show (the proposed rule's "certification that there is
 * none"). Stored like a consent: version, SHA-256 of the exact words, locale, signer, time, IP and user agent.
 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { CertificationKind, VerificationLocale } from "@/db/schema";
import { centralYear, now } from "@/lib/clock";
import { conflict, forbidden, invalid, isAppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { assertActiveConsent } from "@/server/consents";
import { getSgoProfile } from "@/server/sgos";
import { renderCertification, type RenderedCertification } from "./copy";
import {
  assertFamilyEditable,
  familyAuditActor,
  newCertificationId,
  recordVerificationEvent,
  requireFamilyAccess,
  type CertificationRow,
  type FamilyAccess,
  type FamilyActor,
  type VerificationRow,
} from "./internal";

export interface CertificationView {
  id: string;
  kind: CertificationKind;
  memberId: string | null;
  incomeYear: number;
  signedByMemberId: string;
  copyVersion: string;
  locale: VerificationLocale;
  signedAt: Date;
}

export function toCertificationView(row: CertificationRow): CertificationView {
  return { id: row.id, kind: row.kind, memberId: row.memberId, incomeYear: row.incomeYear, signedByMemberId: row.signedByMemberId, copyVersion: row.copyVersion, locale: row.locale, signedAt: row.signedAt };
}

/** The income year a certification signed now is about: the year before the application (or before today, until the family submits). */
export function certificationIncomeYear(v: Pick<VerificationRow, "applicationDate">): number {
  return v.applicationDate ? Number(v.applicationDate.slice(0, 4)) - 1 : centralYear(now()) - 1;
}

const requestSchema = z.strictObject({
  kind: z.enum(["zero_income", "no_other_income"]),
  memberId: z.string().min(1).max(128).nullish(),
  locale: z.enum(["en", "es"]),
  shownSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});

export interface CertificationRequest {
  kind: CertificationKind;
  /** Required for zero_income; optional for no_other_income (omit for the whole household). */
  memberId?: string | null;
  locale: VerificationLocale;
  /** SHA-256 of the words the person saw (from previewCertification). Refused if they changed since. */
  shownSha256?: string | null;
}

type MemberRow = typeof schema.householdMembers.$inferSelect;

/** The signer's own adult row on the household: the owner's row, or the adult row linked to their sign-in. */
async function signerMember(db: DbOrTx, fa: FamilyAccess): Promise<MemberRow> {
  const hm = schema.householdMembers;
  const ownerClause = fa.access.access === "owner" ? eq(hm.isOwner, true) : undefined;
  const rows = await db
    .select()
    .from(hm)
    .where(and(eq(hm.householdId, fa.verification.householdId!), isNull(hm.removedAt), ownerClause ? or(ownerClause, eq(hm.userId, fa.user.id)) : eq(hm.userId, fa.user.id)))
    .orderBy(asc(hm.createdAt));
  const signer = rows.find((r) => r.kind === "adult");
  if (!signer) throw forbidden("Add yourself to the household as an adult before signing a statement.");
  return signer;
}

async function resolve(db: DbOrTx, fa: FamilyAccess, req: z.infer<typeof requestSchema>): Promise<{ signer: MemberRow; member: MemberRow | null; rendered: RenderedCertification; incomeYear: number }> {
  const signer = await signerMember(db, fa);
  let member: MemberRow | null = null;
  if (req.memberId) {
    const [m] = await db
      .select()
      .from(schema.householdMembers)
      .where(and(eq(schema.householdMembers.id, req.memberId), eq(schema.householdMembers.householdId, fa.verification.householdId!), isNull(schema.householdMembers.removedAt)))
      .limit(1);
    if (!m) throw invalid("Choose a person from the household.", { fields: { memberId: "Not a member of this household." } });
    member = m;
  } else if (req.kind === "zero_income") {
    throw invalid("Choose the person who had no income.", { fields: { memberId: "Required for a statement of no income." } });
  }
  const sgo = await getSgoProfile(fa.verification.orgId, db);
  const incomeYear = certificationIncomeYear(fa.verification);
  const rendered = renderCertification(req.kind, req.locale, {
    signerName: `${signer.firstName} ${signer.lastName}`,
    ...(member ? { memberName: `${member.firstName} ${member.lastName}` } : {}),
    incomeYear,
    organizationName: sgo.profile.displayName || sgo.org.name,
  });
  return { signer, member, rendered, incomeYear };
}

function parseRequest(input: CertificationRequest): z.infer<typeof requestSchema> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? "certification")] ??= issue.message;
    throw invalid("The statement request is not valid.", { fields });
  }
  return parsed.data;
}

/** The exact words the signer will see, with their hash. */
export async function previewCertification(verificationId: string, actor: FamilyActor, input: CertificationRequest, dbOrTx?: DbOrTx): Promise<RenderedCertification> {
  const req = parseRequest(input);
  const db = dbOrTx ?? (await getDb());
  const fa = await requireFamilyAccess(db, verificationId, actor);
  return (await resolve(db, fa, req)).rendered;
}

/**
 * Records a signed statement. The signer must be an adult on the household roster; the sharing consent must be
 * active. Signing the same statement again (same kind, member and income year) returns the existing one.
 */
export async function signCertification(verificationId: string, actor: FamilyActor, input: CertificationRequest, dbOrTx?: DbOrTx): Promise<CertificationView> {
  const req = parseRequest(input);
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const fa = await requireFamilyAccess(tx, verificationId, actor, { forUpdate: true });
    assertFamilyEditable(fa.verification);
    await assertActiveConsent(fa.verification.id, "verification_share", tx);
    const { signer, member, rendered, incomeYear } = await resolve(tx, fa, req);
    if (req.shownSha256 && req.shownSha256 !== rendered.sha256) throw conflict("The wording of this statement has changed. Please read it again.", { reason: "copy_changed" });

    const c = schema.verificationCertifications;
    const [existing] = await tx
      .select()
      .from(c)
      .where(and(eq(c.verificationId, fa.verification.id), eq(c.kind, req.kind), member ? eq(c.memberId, member.id) : isNull(c.memberId), eq(c.incomeYear, incomeYear), isNull(c.withdrawnAt)))
      .limit(1);
    if (existing) return toCertificationView(existing);

    const [row] = await tx
      .insert(c)
      .values({
        id: newCertificationId(),
        verificationId: fa.verification.id,
        householdId: fa.verification.householdId!,
        kind: req.kind,
        memberId: member?.id ?? null,
        incomeYear,
        signedByUserId: fa.user.id,
        signedByMemberId: signer.id,
        copyVersion: rendered.version,
        copySha256: rendered.sha256,
        locale: rendered.locale,
        vars: rendered.vars,
        signedAt: now(),
        ip: actor.request?.ip?.trim().slice(0, 64) || null,
        userAgent: actor.request?.userAgent?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 512) || null,
      })
      .returning();
    await recordVerificationEvent(tx, fa.verification.id, "certification.signed", { type: "family", id: fa.user.id }, { certificationId: row.id, kind: row.kind, memberId: row.memberId, incomeYear, copyVersion: row.copyVersion });
    await audit(
      {
        actor: familyAuditActor(actor),
        orgId: fa.verification.orgId,
        action: "certification.sign",
        target: { type: "verification_certification", id: row.id },
        metadata: { verificationId: fa.verification.id, kind: row.kind, incomeYear, copyVersion: row.copyVersion, copySha256: row.copySha256 },
        request: actor.request,
      },
      tx,
    );
    return toCertificationView(row);
  });
}

/** Withdraws a statement before submission. Only the adult who signed it may withdraw it. Idempotent. */
export async function withdrawCertification(certificationId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<CertificationView> {
  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    const c = schema.verificationCertifications;
    const [row] = typeof certificationId === "string" && certificationId.length > 0 && certificationId.length <= 128 ? await tx.select().from(c).where(eq(c.id, certificationId)).limit(1).for("update") : [];
    if (!row) throw notFound("Statement");
    const fa = await requireFamilyAccess(tx, row.verificationId, actor, { forUpdate: true }).catch((e: unknown) => {
      throw isAppError(e) && e.code === "not_found" ? notFound("Statement") : e;
    });
    if (row.withdrawnAt) return toCertificationView(row);
    if (row.signedByUserId !== fa.user.id) throw forbidden("Only the person who signed this statement can withdraw it.");
    assertFamilyEditable(fa.verification);
    const [updated] = await tx.update(c).set({ withdrawnAt: now() }).where(eq(c.id, row.id)).returning();
    await recordVerificationEvent(tx, row.verificationId, "certification.withdrawn", { type: "family", id: fa.user.id }, { certificationId: row.id });
    await audit({ actor: familyAuditActor(actor), orgId: fa.verification.orgId, action: "certification.withdraw", target: { type: "verification_certification", id: row.id }, request: actor.request }, tx);
    return toCertificationView(updated);
  });
}

/** Active (not withdrawn) statements on a verification. */
export async function listCertifications(verificationId: string, actor: FamilyActor, dbOrTx?: DbOrTx): Promise<CertificationView[]> {
  const db = dbOrTx ?? (await getDb());
  const fa = await requireFamilyAccess(db, verificationId, actor);
  return (await activeCertificationRows(db, fa.verification.id)).map(toCertificationView);
}

export async function activeCertificationRows(db: DbOrTx, verificationId: string): Promise<CertificationRow[]> {
  const c = schema.verificationCertifications;
  return db.select().from(c).where(and(eq(c.verificationId, verificationId), isNull(c.withdrawnAt))).orderBy(asc(c.signedAt), asc(c.id));
}
