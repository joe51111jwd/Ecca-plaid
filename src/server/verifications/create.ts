/**
 * Creating a verification: the SGO (API key or dashboard user) or a point-of-booking handoff asks for one; the
 * family gets a single secret link.
 */
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { Mode } from "@/db/schema";
import { addMs, centralDateString, now } from "@/lib/clock";
import { hashToken } from "@/lib/crypto";
import { appUrl, isProd } from "@/lib/env";
import { forbidden, invalid, isAppError, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit, type AuditActor } from "@/server/audit";
import { emailAddressSchema } from "@/server/auth";
import { renderEmail } from "@/server/email";
import { getSgoProfile } from "@/server/sgos";
import { invitationCopy } from "./copy";
import { recordVerificationEvent, type VerificationRow } from "./internal";
import { queueAndSend } from "./mail";
import {
  FAMILY_LINK_PATH,
  FAMILY_LINK_TTL_MS,
  FAMILY_TOKEN_BYTES,
  MAX_APPLICANT_NAME_LENGTH,
  MAX_EXTERNAL_REF_LENGTH,
  MAX_RETURN_URL_LENGTH,
  MAX_STUDENT_NAME_LENGTH,
  METADATA_LIMITS,
} from "./policy";

export interface CreateVerificationInput {
  orgId: string;
  mode: Mode;
  applicantEmail?: string | null;
  applicantName?: string | null;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  /** The SGO's own applicant or application id. */
  externalRef?: string | null;
  /** Where the family is sent when it finishes: https, or http://localhost in non-production. */
  returnUrl?: string | null;
  /** At most 20 string values; keys of letters, digits, `_`, `-` and `.`. */
  metadata?: Record<string, string> | null;
  handoffId?: string | null;
  /** Email the family link to `applicantEmail`. Requires `applicantEmail`. */
  sendInvite?: boolean;
  locale?: "en" | "es";
  createdBy: { type: "api_key" | "user" | "handoff"; id: string };
}

export interface CreateVerificationResult {
  verification: VerificationRow;
  /** The family link token. Returned once; only its hash is stored. */
  familyToken: string;
  /** `${APP_URL}/v/<token>`. A credential: never log it, never put it in an API read. */
  familyUrl: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function optionalText(max: number, label: string) {
  return z
    .string()
    .nullish()
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined) return null;
      const v = raw.replace(/\s+/g, " ").trim();
      if (v.length === 0) return null;
      if (CONTROL.test(raw.replace(/[\t\n\r]/g, " "))) {
        ctx.addIssue({ code: "custom", message: `${label} contains control characters.` });
        return z.NEVER;
      }
      if (Array.from(v).length > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be at most ${max} characters.` });
        return z.NEVER;
      }
      return v;
    });
}

const METADATA_KEY = /^[A-Za-z0-9_.-]+$/;

const metadataSchema = z
  .record(z.string(), z.string())
  .nullish()
  .transform((raw, ctx) => {
    if (raw === null || raw === undefined) return {};
    const keys = Object.keys(raw);
    if (keys.length > METADATA_LIMITS.maxKeys) {
      ctx.addIssue({ code: "custom", message: `At most ${METADATA_LIMITS.maxKeys} metadata keys.` });
      return z.NEVER;
    }
    const out: Record<string, string> = {};
    for (const key of keys) {
      const value = raw[key];
      if (key.length === 0 || key.length > METADATA_LIMITS.maxKeyLength || !METADATA_KEY.test(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: `Metadata keys are 1 to ${METADATA_LIMITS.maxKeyLength} letters, digits, "_", "-" or ".".` });
        return z.NEVER;
      }
      if (typeof value !== "string" || Array.from(value).length > METADATA_LIMITS.maxValueLength || CONTROL.test(value)) {
        ctx.addIssue({ code: "custom", path: [key], message: `Metadata values are text of at most ${METADATA_LIMITS.maxValueLength} characters without control characters.` });
        return z.NEVER;
      }
      out[key] = value;
    }
    if (Buffer.byteLength(JSON.stringify(out), "utf8") > METADATA_LIMITS.maxTotalBytes) {
      ctx.addIssue({ code: "custom", message: `Metadata must be at most ${METADATA_LIMITS.maxTotalBytes} bytes as JSON.` });
      return z.NEVER;
    }
    return out;
  });

/**
 * A return URL must be absolute https, or http on localhost / 127.0.0.1 / [::1] outside production; never with
 * credentials in it. Returns the normalized URL.
 */
export function validateReturnUrl(raw: string, production: boolean = isProd()): string {
  if (raw.length > MAX_RETURN_URL_LENGTH) throw invalid("returnUrl is too long.", { fields: { returnUrl: `At most ${MAX_RETURN_URL_LENGTH} characters.` } });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid("returnUrl must be an absolute URL.", { fields: { returnUrl: "Must be an absolute https URL." } });
  }
  if (url.username || url.password) throw invalid("returnUrl must not contain credentials.", { fields: { returnUrl: "Must not contain a user name or password." } });
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const ok = url.protocol === "https:" || (!production && url.protocol === "http:" && localHost);
  if (!ok) throw invalid("returnUrl must use https.", { fields: { returnUrl: production ? "Must be an https URL." : "Must be an https URL (or http on localhost while developing)." } });
  return url.href;
}

const createSchema = z.strictObject({
  orgId: z.string().min(1).max(128),
  mode: z.enum(["test", "live"]),
  applicantEmail: z
    .string()
    .nullish()
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined || raw.trim() === "") return null;
      const parsed = emailAddressSchema.safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
        return z.NEVER;
      }
      return parsed.data;
    }),
  applicantName: optionalText(MAX_APPLICANT_NAME_LENGTH, "applicantName"),
  studentFirstName: optionalText(MAX_STUDENT_NAME_LENGTH, "studentFirstName"),
  studentLastName: optionalText(MAX_STUDENT_NAME_LENGTH, "studentLastName"),
  externalRef: optionalText(MAX_EXTERNAL_REF_LENGTH, "externalRef"),
  returnUrl: z.string().nullish(),
  metadata: metadataSchema,
  handoffId: z.string().min(1).max(128).nullish(),
  sendInvite: z.boolean().optional(),
  locale: z.enum(["en", "es"]).optional(),
  createdBy: z.strictObject({ type: z.enum(["api_key", "user", "handoff"]), id: z.string().min(1).max(128) }),
});

function auditActorOf(createdBy: CreateVerificationInput["createdBy"]): AuditActor {
  if (createdBy.type === "api_key") return { type: "api_key", id: createdBy.id };
  if (createdBy.type === "user") return { type: "user", id: createdBy.id };
  return { type: "system", id: createdBy.id };
}

/**
 * Creates a verification for an SGO and returns the family link once. Only the SHA-256 of the 256-bit token is
 * stored; the link works for FAMILY_LINK_TTL_DAYS. With `sendInvite` the link is emailed to `applicantEmail` in
 * `locale` (the email is marked sensitive: its body is dropped once a real provider accepts it).
 *
 * Throws validation_failed (bad input), not_found (no such SGO), forbidden (the SGO is suspended).
 */
export async function createVerification(input: CreateVerificationInput, dbOrTx?: DbOrTx): Promise<CreateVerificationResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
    throw invalid("The verification request is not valid.", { fields });
  }
  const data = parsed.data;
  const returnUrl = data.returnUrl === null || data.returnUrl === undefined || data.returnUrl.trim() === "" ? null : validateReturnUrl(data.returnUrl.trim());
  if (data.sendInvite && !data.applicantEmail) throw invalid("An applicant email is required to send the invitation.", { fields: { applicantEmail: "Required when sendInvite is true." } });
  if (data.createdBy.type === "handoff" && !data.handoffId) throw invalid("A handoff-created verification must name its handoff.", { fields: { handoffId: "Required." } });
  const locale = data.locale ?? "en";

  const db = dbOrTx ?? (await getDb());
  return db.transaction(async (tx) => {
    let sgo;
    try {
      sgo = await getSgoProfile(data.orgId, tx);
    } catch (e) {
      if (isAppError(e) && e.code === "not_found") throw notFound("Organization");
      throw e;
    }
    if (sgo.org.status === "suspended") throw forbidden("This organization cannot start verifications.");

    const token = newToken(FAMILY_TOKEN_BYTES);
    const at = now();
    const expiresAt = addMs(at, FAMILY_LINK_TTL_MS);
    const familyUrl = appUrl(`${FAMILY_LINK_PATH}/${token}`);
    const [verification] = await tx
      .insert(schema.verifications)
      .values({
        id: newId("verification"),
        orgId: sgo.org.id,
        mode: data.mode,
        status: "pending",
        stage: "created",
        externalRef: data.externalRef,
        applicantEmail: data.applicantEmail,
        applicantName: data.applicantName,
        studentFirstName: data.studentFirstName,
        studentLastName: data.studentLastName,
        metadata: data.metadata,
        returnUrl,
        createdByType: data.createdBy.type,
        createdById: data.createdBy.id,
        familyTokenHash: hashToken(token),
        familyTokenExpiresAt: expiresAt,
        locale,
        handoffId: data.handoffId ?? null,
        createdAt: at,
        updatedAt: at,
      })
      .returning();

    await recordVerificationEvent(tx, verification.id, "created", { type: data.createdBy.type === "handoff" ? "system" : data.createdBy.type, id: data.createdBy.id }, {
      createdVia: data.createdBy.type,
      inviteRequested: data.sendInvite === true,
      ...(data.handoffId ? { handoffId: data.handoffId } : {}),
    });

    if (data.sendInvite && data.applicantEmail) {
      const copy = invitationCopy(locale, sgo.profile.displayName || sgo.org.name, centralDateString(expiresAt));
      const rendered = renderEmail({ locale, preheader: copy.preheader, heading: copy.heading, paragraphs: copy.paragraphs, cta: { label: copy.cta, url: familyUrl }, footerNote: copy.footerNote });
      await queueAndSend(
        { to: data.applicantEmail, subject: copy.subject, template: "verification_invite", html: rendered.html, text: rendered.text, related: { type: "verification", id: verification.id }, sensitive: true },
        tx,
      );
      await recordVerificationEvent(tx, verification.id, "invite.queued", { type: "system", id: null }, { locale });
    }

    await audit(
      {
        actor: auditActorOf(data.createdBy),
        orgId: sgo.org.id,
        action: "verification.create",
        target: { type: "verification", id: verification.id },
        metadata: {
          mode: data.mode,
          createdVia: data.createdBy.type,
          hasApplicantEmail: data.applicantEmail !== null,
          inviteSent: data.sendInvite === true,
          hasReturnUrl: returnUrl !== null,
          metadataKeys: Object.keys(data.metadata).length,
          ...(data.handoffId ? { handoffId: data.handoffId } : {}),
        },
      },
      tx,
    );
    return { verification, familyToken: token, familyUrl };
  });
}
