import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import type { HandoffSgoChoice, Mode } from "@/db/schema";
import { addMs, MS, now } from "@/lib/clock";
import { encryptField, hashToken } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { newId, newToken } from "@/lib/ids";
import { audit, type AuditActor, type AuditRequestInfo } from "@/server/audit";
import { emailAddressSchema } from "@/server/auth";
import { assertActivePartnership, getActivePartnerSgos, getBusinessProfile, isAllowedOrigin, isAllowedReturnUrl, resolvePublishableKey, type BusinessRecord } from "@/server/businesses";
import { enforceRateLimit } from "@/server/ratelimit";
import { createVerification, METADATA_LIMITS } from "@/server/verifications";
import { auditContextOf, authorizeOperator, emitHandoffEvent, lockHandoff, type HandoffActor } from "./internal";
import { BOOKING_LIMITS, EMBED_RATE_LIMITS, FAMILY_LINK_PURPOSE, HANDOFF_EMBED_PATH, HANDOFF_PAGE_PATH, HANDOFF_TOKEN_BYTES, HANDOFF_TOKEN_PATTERN } from "./policy";
import type { HandoffRow } from "./serialize";
import { isFinal } from "./state";

/**
 * Creating a point-of-booking handoff. Two entry points share one core:
 *  - server-to-server, with the business's secret API key (the API layer authenticates the key and passes
 *    `{ kind: "api", businessOrgId, mode, apiKeyId }`);
 *  - browser-initiated from the embed, with the business's publishable key. That key is public, so the request's
 *    Origin must be one the business allowed, strict per-key and per-IP rate limits apply, and every booking field is
 *    treated as untrusted display text. An amount that arrives this way is recorded as unconfirmed.
 */

export type HandoffSource =
  | {
      kind: "api";
      businessOrgId: string;
      mode: Mode;
      apiKeyId: string;
      request?: AuditRequestInfo | null;
    }
  | {
      kind: "embed";
      publishableKey: string;
      origin: string | null | undefined;
      ip: string | null | undefined;
      userAgent?: string | null;
    };

export interface CreateHandoffInput {
  bookingRef: string;
  bookingDescription?: string | null;
  bookingAmountCents?: number | null;
  familyEmail?: string | null;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  /** Where the family goes back to; its origin must be one of the business's allowed origins. */
  returnUrl?: string | null;
  channel: "embed" | "redirect";
  /** The business's own keys and values, echoed in webhooks. Same limits as verification metadata. */
  metadata?: Record<string, string> | null;
  /** A partner SGO the business wants this family handed to. Must be an active partner. */
  sgoOrgId?: string | null;
  locale?: "en" | "es";
  /** Server-to-server only: a retried create with the same key is refused with the existing handoff's id. */
  idempotencyKey?: string | null;
}

export interface CreateHandoffResult {
  handoff: HandoffRow;
  /** The family's resume token. Returned once; only its hash is stored. */
  token: string;
  /** Hosted handoff page `${APP_URL}/h/<token>`. A credential: never log it. */
  url: string;
  /** The same page for an iframe: `${APP_URL}/embed/handoff/<token>`. */
  embedUrl: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function displayText(max: number, label: string, required: boolean) {
  return z
    .unknown()
    .optional()
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
        if (required) {
          ctx.addIssue({ code: "custom", message: `${label} is required.` });
          return z.NEVER;
        }
        return null;
      }
      if (typeof raw !== "string") {
        ctx.addIssue({ code: "custom", message: `${label} must be text.` });
        return z.NEVER;
      }
      if (CONTROL.test(raw.replace(/[\t\n\r]/g, " "))) {
        ctx.addIssue({
          code: "custom",
          message: `${label} contains characters that are not allowed.`,
        });
        return z.NEVER;
      }
      const v = raw.replace(/\s+/g, " ").trim();
      if (Array.from(v).length > max) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be at most ${max} characters.`,
        });
        return z.NEVER;
      }
      return v;
    });
}

const METADATA_KEY = /^[A-Za-z0-9_.-]+$/;

const metadataSchema = z
  .unknown()
  .optional()
  .transform((raw, ctx): Record<string, string> => {
    if (raw === null || raw === undefined) return {};
    if (typeof raw !== "object" || Array.isArray(raw)) {
      ctx.addIssue({
        code: "custom",
        message: "metadata must be an object of text values.",
      });
      return z.NEVER;
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > METADATA_LIMITS.maxKeys) {
      ctx.addIssue({
        code: "custom",
        message: `At most ${METADATA_LIMITS.maxKeys} metadata keys.`,
      });
      return z.NEVER;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (key.length === 0 || key.length > METADATA_LIMITS.maxKeyLength || !METADATA_KEY.test(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Metadata keys are 1 to ${METADATA_LIMITS.maxKeyLength} letters, digits, "_", "-" or ".".`,
        });
        return z.NEVER;
      }
      if (typeof value !== "string" || Array.from(value).length > METADATA_LIMITS.maxValueLength || CONTROL.test(value)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Metadata values are text of at most ${METADATA_LIMITS.maxValueLength} characters without control characters.`,
        });
        return z.NEVER;
      }
      out[key] = value;
    }
    if (Buffer.byteLength(JSON.stringify(out), "utf8") > METADATA_LIMITS.maxTotalBytes) {
      ctx.addIssue({
        code: "custom",
        message: `Metadata must be at most ${METADATA_LIMITS.maxTotalBytes} bytes as JSON.`,
      });
      return z.NEVER;
    }
    return out;
  });

const optionalId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .nullish()
  .transform((v) => v ?? null);

const inputSchema = z.object({
  bookingRef: displayText(BOOKING_LIMITS.maxRefLength, "bookingRef", true),
  bookingDescription: displayText(BOOKING_LIMITS.maxDescriptionLength, "bookingDescription", false),
  bookingAmountCents: z
    .number()
    .int("bookingAmountCents must be whole cents.")
    .positive("bookingAmountCents must be positive.")
    .max(BOOKING_LIMITS.maxAmountCents, "bookingAmountCents is too large.")
    .nullish()
    .transform((v) => v ?? null),
  familyEmail: z
    .unknown()
    .optional()
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
      const parsed = emailAddressSchema.safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid email address.",
        });
        return z.NEVER;
      }
      return parsed.data;
    }),
  studentFirstName: displayText(BOOKING_LIMITS.maxStudentNameLength, "studentFirstName", false),
  studentLastName: displayText(BOOKING_LIMITS.maxStudentNameLength, "studentLastName", false),
  returnUrl: z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v.trim() === "" ? null : v.trim())),
  channel: z.enum(["embed", "redirect"], {
    error: "channel must be embed or redirect.",
  }),
  metadata: metadataSchema,
  sgoOrgId: optionalId,
  locale: z.enum(["en", "es"]).optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(BOOKING_LIMITS.maxIdempotencyKeyLength)
    .regex(/^[\x21-\x7e]+$/, "idempotencyKey must be printable ASCII without spaces.")
    .nullish()
    .transform((v) => v ?? null),
});

function validationError(error: z.ZodError): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "input"] ??= issue.message;
  throw invalid("The handoff request is not valid.", { fields });
}

const NO_PARTNER_MESSAGE = "No scholarship organization is accepting families from your booking flow yet. Ask a partner SGO to accept your partnership request before sending families.";

interface ResolvedSource {
  business: BusinessRecord;
  mode: Mode;
  createdVia: "api" | "embed";
  apiKeyId: string | null;
  actor: AuditActor;
  request: AuditRequestInfo | null;
}

async function resolveSource(source: HandoffSource): Promise<ResolvedSource> {
  if (!source || typeof source !== "object") throw forbidden();
  if (source.kind === "api") {
    if (source.mode !== "test" && source.mode !== "live") throw forbidden();
    const db = await getDb();
    await authorizeOperator(db, { type: "api_key", apiKeyId: source.apiKeyId, mode: source.mode }, source.businessOrgId);
    const business = await getBusinessProfile(source.businessOrgId, db);
    if (business.org.status !== "active") throw forbidden("This business cannot start handoffs.");
    return {
      business,
      mode: source.mode,
      createdVia: "api",
      apiKeyId: source.apiKeyId,
      actor: { type: "api_key", id: source.apiKeyId },
      request: source.request ?? null,
    };
  }
  if (source.kind !== "embed") throw forbidden();
  // An unknown key and a disallowed origin get the same answer, so the endpoint cannot be used to probe keys.
  const resolved = await resolvePublishableKey(source.publishableKey);
  if (!resolved || !isAllowedOrigin(resolved.profile, source.origin ?? null)) throw forbidden("This page is not allowed to start a scholarship check.");
  const ip = typeof source.ip === "string" && source.ip.length > 0 ? source.ip : "unknown";
  const message = "Too many scholarship checks were started from this page.";
  await enforceRateLimit(`handoff:embed:key:${resolved.profile.orgId}`, {
    ...EMBED_RATE_LIMITS.perKey,
    message,
  });
  await enforceRateLimit(`handoff:embed:key-ip:${resolved.profile.orgId}:${ip}`, { ...EMBED_RATE_LIMITS.perKeyAndIp, message });
  return {
    business: { org: resolved.org, profile: resolved.profile },
    mode: resolved.mode,
    createdVia: "embed",
    apiKeyId: null,
    actor: { type: "family" },
    request: { ip: source.ip ?? null, userAgent: source.userAgent ?? null },
  };
}

function handoffUrls(token: string): { url: string; embedUrl: string } {
  return {
    url: appUrl(`${HANDOFF_PAGE_PATH}/${token}`),
    embedUrl: appUrl(`${HANDOFF_EMBED_PATH}/${token}`),
  };
}

/**
 * Links a verification at `sgoOrgId` to the handoff (inside the caller's transaction) and stores its family link,
 * encrypted. The verification belongs to the SGO and runs in the handoff's mode.
 */
async function attachVerification(tx: DbOrTx, handoff: HandoffRow, sgoOrgId: string, choice: HandoffSgoChoice, locale: "en" | "es"): Promise<HandoffRow> {
  const created = await createVerification(
    {
      orgId: sgoOrgId,
      mode: handoff.mode,
      applicantEmail: handoff.familyEmail,
      studentFirstName: handoff.studentFirstName,
      studentLastName: handoff.studentLastName,
      handoffId: handoff.id,
      locale,
      createdBy: { type: "handoff", id: handoff.id },
    },
    tx,
  );
  const [updated] = await tx
    .update(schema.handoffs)
    .set({
      sgoOrgId,
      sgoChosenBy: choice,
      verificationId: created.verification.id,
      familyLinkEnc: encryptField(created.familyToken, FAMILY_LINK_PURPOSE),
      updatedAt: now(),
    })
    .where(eq(schema.handoffs.id, handoff.id))
    .returning();
  return updated;
}

/**
 * Creates a handoff. Chooses the partner SGO: the one the business named (it must be an active partner), else the
 * only active partner, else none yet (the family picks from the partners' display names on the handoff page). With
 * no active partner at all the business gets a `conflict` explaining what to do.
 *
 * The hold runs from now for the business's hold window. When the SGO is known the linked verification is created
 * in the same transaction. Emits handoff.started to the business.
 *
 * Throws validation_failed (bad input or return URL), forbidden (bad key / origin / inactive business),
 * rate_limited (embed), conflict (no partner, or a reused idempotency key).
 */
export async function createHandoff(input: CreateHandoffInput, source: HandoffSource): Promise<CreateHandoffResult> {
  const resolved = await resolveSource(source);
  const parsed = inputSchema.safeParse(input ?? {});
  if (!parsed.success) validationError(parsed.error);
  const data = parsed.data;
  const { business, mode } = resolved;

  if (data.returnUrl !== null && !isAllowedReturnUrl(business.profile, data.returnUrl)) {
    throw invalid("The return URL must be on one of your allowed origins.", {
      fields: {
        returnUrl: "Use an https address on one of the origins listed in your business settings.",
      },
    });
  }
  if (resolved.createdVia === "embed" && data.idempotencyKey !== null) {
    throw invalid("idempotencyKey is only accepted on server-to-server requests.", { fields: { idempotencyKey: "Not accepted from the browser." } });
  }

  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    if (data.idempotencyKey !== null) {
      const [existing] = await tx
        .select({ id: schema.handoffs.id })
        .from(schema.handoffs)
        .where(and(eq(schema.handoffs.businessOrgId, business.org.id), eq(schema.handoffs.mode, mode), eq(schema.handoffs.idempotencyKey, data.idempotencyKey)))
        .limit(1);
      if (existing) throw conflict("A handoff was already created with this idempotency key.", { handoffId: existing.id });
    }

    let sgoOrgId: string | null = null;
    let choice: HandoffSgoChoice | null = null;
    if (data.sgoOrgId !== null) {
      await assertActivePartnership(business.org.id, data.sgoOrgId, tx);
      sgoOrgId = data.sgoOrgId;
      choice = "business";
    } else {
      const partners = await getActivePartnerSgos(business.org.id, tx);
      if (partners.length === 0) throw conflict(NO_PARTNER_MESSAGE);
      if (partners.length === 1) {
        sgoOrgId = partners[0].sgoOrgId;
        choice = "single_partner";
      }
    }

    const token = newToken(HANDOFF_TOKEN_BYTES);
    const at = now();
    const inserted = await tx
      .insert(schema.handoffs)
      .values({
        id: newId("handoff"),
        businessOrgId: business.org.id,
        sgoOrgId: null,
        mode,
        status: "started",
        channel: data.channel,
        bookingRef: data.bookingRef as string,
        bookingDescription: data.bookingDescription,
        bookingAmountCents: data.bookingAmountCents,
        bookingAmountConfirmed: resolved.createdVia === "api" && data.bookingAmountCents !== null,
        familyEmail: data.familyEmail,
        studentFirstName: data.studentFirstName,
        studentLastName: data.studentLastName,
        returnUrl: data.returnUrl,
        tokenHash: hashToken(token),
        holdExpiresAt: addMs(at, business.profile.holdWindowHours * MS.hour),
        metadata: data.metadata,
        createdVia: resolved.createdVia,
        createdByApiKeyId: resolved.apiKeyId,
        idempotencyKey: data.idempotencyKey,
        statusChangedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({
        target: [schema.handoffs.businessOrgId, schema.handoffs.mode, schema.handoffs.idempotencyKey],
      })
      .returning();
    // A concurrent create with the same idempotency key won the insert.
    if (!inserted[0]) throw conflict("A handoff was already created with this idempotency key.");
    let handoff = inserted[0];
    if (sgoOrgId !== null && choice !== null) handoff = await attachVerification(tx, handoff, sgoOrgId, choice, data.locale ?? "en");

    await audit(
      {
        actor: resolved.actor,
        orgId: business.org.id,
        action: "handoff.create",
        target: { type: "handoff", id: handoff.id },
        metadata: {
          mode,
          createdVia: resolved.createdVia,
          channel: data.channel,
          sgoOrgId,
          sgoChosenBy: choice,
          hasFamilyEmail: data.familyEmail !== null,
          hasReturnUrl: data.returnUrl !== null,
          holdWindowHours: business.profile.holdWindowHours,
        },
        request: resolved.request,
      },
      tx,
    );
    await emitHandoffEvent(tx, handoff);
    return { handoff, token };
  });
  return { ...result, ...handoffUrls(result.token) };
}

/* ---------------------------------------------------------------------------------- token-holder actions */

export function isWellFormedHandoffToken(token: unknown): token is string {
  return typeof token === "string" && HANDOFF_TOKEN_PATTERN.test(token);
}

/** The handoff behind a family token (locked when `forUpdate`), or null for a malformed or unknown token. */
export async function findByToken(db: DbOrTx, token: unknown, opts: { forUpdate?: boolean } = {}): Promise<HandoffRow | null> {
  if (!isWellFormedHandoffToken(token)) return null;
  const q = db
    .select()
    .from(schema.handoffs)
    .where(eq(schema.handoffs.tokenHash, hashToken(token)))
    .limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

/**
 * The family picks one of the business's partner SGOs on the handoff page (only when the business has several and
 * named none). The choice must be an active partner at this moment; it is made once. Creates the linked verification.
 */
export async function chooseHandoffSgo(token: string, sgoOrgId: string, opts: { locale?: "en" | "es"; request?: AuditRequestInfo | null } = {}): Promise<HandoffRow> {
  if (typeof sgoOrgId !== "string" || sgoOrgId.length === 0 || sgoOrgId.length > 128)
    throw invalid("Choose a scholarship organization.", {
      fields: { sgoOrgId: "Choose one of the listed organizations." },
    });
  const db = await getDb();
  return db.transaction(async (tx) => {
    const handoff = await findByToken(tx, token, { forUpdate: true });
    if (!handoff) throw notFound("Handoff");
    if (handoff.sgoOrgId !== null) {
      if (handoff.sgoOrgId === sgoOrgId) return handoff;
      throw conflict("A scholarship organization was already chosen for this booking.");
    }
    if (isFinal(handoff.status)) throw conflict("This scholarship check has ended.");
    await assertActivePartnership(handoff.businessOrgId, sgoOrgId, tx);
    const updated = await attachVerification(tx, handoff, sgoOrgId, "family", opts.locale ?? "en");
    await audit(
      {
        actor: { type: "family" },
        orgId: handoff.businessOrgId,
        action: "handoff.sgo_chosen",
        target: { type: "handoff", id: handoff.id },
        metadata: { sgoOrgId, chosenBy: "family" },
        request: opts.request ?? null,
      },
      tx,
    );
    return updated;
  });
}

/**
 * Issues a new family token for a handoff that is still open (the business resends the link from its portal). The
 * old link stops working at once. Returns the new URLs; only the new token's hash is stored.
 */
export async function reissueHandoffLink(businessOrgId: string, handoffId: string, actor: HandoffActor): Promise<CreateHandoffResult> {
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    await authorizeOperator(tx, actor, businessOrgId);
    const handoff = await lockHandoff(tx, handoffId, {
      businessOrgId,
      ...(actor.type === "api_key" ? { mode: actor.mode } : {}),
    });
    if (!handoff) throw notFound("Handoff");
    if (isFinal(handoff.status)) throw conflict(`A handoff that is ${handoff.status} has no link to resend.`);
    const token = newToken(HANDOFF_TOKEN_BYTES);
    const [updated] = await tx
      .update(schema.handoffs)
      .set({ tokenHash: hashToken(token), updatedAt: now() })
      .where(eq(schema.handoffs.id, handoff.id))
      .returning();
    const ctx = auditContextOf(actor);
    await audit(
      {
        actor: ctx.actor,
        orgId: businessOrgId,
        action: "handoff.link_reissued",
        target: { type: "handoff", id: handoff.id },
        metadata: { ...ctx.extra },
        request: ctx.request,
      },
      tx,
    );
    return { handoff: updated, token };
  });
  return { ...result, ...handoffUrls(result.token) };
}

/** The message a business gets when it has no active partner SGO (exported for tests and the portal). */
export const NO_PARTNER_ERROR_MESSAGE = NO_PARTNER_MESSAGE;
