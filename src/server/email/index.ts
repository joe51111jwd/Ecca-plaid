import { and, desc, eq, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError, invalid, notFound } from "@/lib/errors";
import { newSortableId } from "@/server/audit";

/**
 * Transactional email.
 *
 *   const { html, text } = renderEmail({ heading, paragraphs, cta });
 *   await sendEmail({ to, subject, template: "magic_link", html, text, related: { type: "magic_link", id }, sensitive: true });
 *
 * Every message is first recorded in the `emails` table and then handed to the configured provider:
 *  - "outbox" (default): the row is marked sent and nothing leaves the machine. Read it at /dev/mail.
 *  - "resend": delivered through the Resend HTTP API.
 *
 * To send as part of a database transaction without calling the provider inside it, record the message with
 * `queueEmail(input, tx)` and enqueue the job "email.send" with `{ emailId }` in the same transaction.
 */

export type Email = typeof schema.emails.$inferSelect;

export interface SendEmailInput {
  /** One plain address (no display name). Stored lower-cased. */
  to: string;
  subject: string;
  /** Stable name of the message type, e.g. "magic_link", "donation_receipt". Used for filtering and metrics. */
  template: string;
  html: string;
  text: string;
  /** The record this message is about, for support and for the dev mailbox. */
  related?: { type: string; id: string } | null;
  /**
   * The body carries a credential (a sign-in link or code). Once a real provider has accepted the message
   * the stored body is replaced by a notice, so credentials do not accumulate in the database. With the
   * outbox provider the body is kept: reading it there is the whole point.
   */
  sensitive?: boolean;
}

export const SENSITIVE_BODY_REMOVED = "[Body removed after delivery: this message carried a sign-in credential.]";

const MAX_SUBJECT_LENGTH = 250;
const MAX_BODY_LENGTH = 1_000_000;
const MAX_ERROR_LENGTH = 500;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

/** A subject is one header line: control characters (including CR/LF, i.e. header injection) become spaces. */
function cleanSubject(raw: string): string {
  const oneLine = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(oneLine);
  return chars.length > MAX_SUBJECT_LENGTH ? `${chars.slice(0, MAX_SUBJECT_LENGTH - 1).join("")}…` : oneLine;
}

const emailAddress = z.string().trim().toLowerCase().pipe(z.email().max(254));

const sendEmailSchema = z.object({
  to: emailAddress,
  subject: z.string().transform(cleanSubject).pipe(z.string().min(1)),
  template: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  html: z.string().min(1).max(MAX_BODY_LENGTH),
  text: z.string().min(1).max(MAX_BODY_LENGTH),
  related: z.object({ type: z.string().trim().min(1).max(100), id: z.string().trim().min(1).max(200) }).nullish(),
  sensitive: z.boolean().optional(),
});

function parseInput(input: SendEmailInput): z.output<typeof sendEmailSchema> {
  const parsed = sendEmailSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "email"] ??= issue.message;
    throw invalid(`Invalid email: ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("; ")}`, { fields });
  }
  return parsed.data;
}

/**
 * Records a message without delivering it (status "queued"). Deliver it later with the "email.send" job or
 * `deliverEmail(id)`.
 */
export async function queueEmail(input: SendEmailInput, dbOrTx?: DbOrTx): Promise<Email> {
  const data = parseInput(input);
  const db = dbOrTx ?? (await getDb());
  const e = env();
  const [row] = await db
    .insert(schema.emails)
    .values({
      // Sortable id: the outbox lists by id, i.e. in the order messages were recorded, even while the
      // application clock (createdAt) is frozen by a test or demo.
      id: newSortableId("email"),
      toEmail: data.to,
      fromEmail: e.EMAIL_FROM,
      subject: data.subject,
      template: data.template,
      html: data.html,
      text: data.text,
      status: "queued",
      provider: e.EMAIL_PROVIDER,
      relatedType: data.related?.type ?? null,
      relatedId: data.related?.id ?? null,
      createdAt: now(),
    })
    .returning();
  return row;
}

class DeliveryError extends Error {}

let warnedAboutOutboxInProduction = false;

/** The outbox never delivers. In production that is almost certainly a missing EMAIL_PROVIDER, so say so (once). */
function warnIfOutboxInProduction(): void {
  if (warnedAboutOutboxInProduction || process.env.NODE_ENV !== "production") return;
  warnedAboutOutboxInProduction = true;
  console.warn('[email] EMAIL_PROVIDER is "outbox" in production: emails are recorded but NOT delivered. Set EMAIL_PROVIDER=resend and RESEND_API_KEY.');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** POSTs one message to Resend and returns the provider's message id. Throws DeliveryError with a storable, secret-free reason. */
async function deliverViaResend(email: Email): Promise<string> {
  const apiKey = env().RESEND_API_KEY;
  if (!apiKey) throw new DeliveryError("RESEND_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // A retry of the same message (same row id) must not put two copies in the inbox.
        "Idempotency-Key": email.id,
      },
      body: JSON.stringify({ from: email.fromEmail, to: [email.toEmail], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e instanceof Error ? (e.name === "TimeoutError" ? "request timed out" : e.message) : "unknown error";
    throw new DeliveryError(`Could not reach Resend: ${reason}`);
  }
  const raw = await res.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  const field = (name: string) => (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>)[name] === "string" ? ((body as Record<string, unknown>)[name] as string) : undefined);
  if (!res.ok) throw new DeliveryError(`Resend responded ${res.status}: ${field("message") ?? (raw.trim() || res.statusText || "no details")}`);
  const id = field("id");
  if (!id) throw new DeliveryError("Resend accepted the request but returned no message id");
  return id;
}

export interface DeliverEmailOptions {
  /** See SendEmailInput.sensitive. */
  redactAfterSend?: boolean;
}

async function deliverRow(email: Email, opts: DeliverEmailOptions, db: DbOrTx): Promise<Email> {
  if (email.status === "sent") return email;
  const provider = env().EMAIL_PROVIDER;
  const t = schema.emails;
  // `status <> 'sent'` keeps a concurrent delivery of the same row from being recorded twice.
  const pending = and(eq(t.id, email.id), ne(t.status, "sent"));

  let providerId: string | null = null;
  if (provider === "outbox") warnIfOutboxInProduction();
  if (provider === "resend") {
    try {
      providerId = await deliverViaResend(email);
    } catch (e) {
      if (!(e instanceof DeliveryError)) throw e;
      const error = truncate(e.message, MAX_ERROR_LENGTH);
      await db.update(t).set({ status: "failed", provider, error }).where(pending);
      console.error(`[email] Delivery of ${email.id} (${email.template}) failed: ${error}`);
      throw new AppError("not_available", "We could not send the email right now. Please try again in a moment.", { emailId: email.id });
    }
  }

  const redact = provider !== "outbox" && opts.redactAfterSend === true;
  const [sent] = await db
    .update(t)
    .set({
      status: "sent",
      provider,
      providerId,
      error: null,
      sentAt: now(),
      ...(redact ? { html: SENSITIVE_BODY_REMOVED, text: SENSITIVE_BODY_REMOVED } : {}),
    })
    .where(pending)
    .returning();
  if (sent) return sent;
  const [current] = await db.select().from(t).where(eq(t.id, email.id));
  return current ?? email;
}

/**
 * Records a message and delivers it now. Returns the stored row (status "sent").
 *
 * If the provider fails, the row is marked "failed" with the reason and `AppError("not_available")` is thrown
 * with `details.emailId`, so a job can retry it (`email.send`). When called with a transaction that the
 * error then rolls back, the row disappears with it — record first with `queueEmail` if that matters.
 */
export async function sendEmail(input: SendEmailInput, dbOrTx?: DbOrTx): Promise<Email> {
  const db = dbOrTx ?? (await getDb());
  const email = await queueEmail(input, db);
  return deliverRow(email, { redactAfterSend: input.sensitive === true }, db);
}

/**
 * Delivers (or re-delivers) a recorded message through the currently configured provider. Idempotent: a
 * message that is already "sent" is returned untouched and nothing is sent again.
 */
export async function deliverEmail(emailId: string, opts: DeliverEmailOptions = {}, dbOrTx?: DbOrTx): Promise<Email> {
  const db = dbOrTx ?? (await getDb());
  const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId));
  if (!email) throw notFound("Email");
  return deliverRow(email, opts, db);
}

export interface ListOutboxParams {
  /** Only messages to this address (case-insensitive). */
  to?: string;
  /** Only messages of this template. */
  template?: string;
  /** 1–200, default 50. */
  limit?: number;
}

/**
 * Recorded messages, most recently recorded first (ordered by their creation-ordered ids, so "newest" is
 * reliable even when a test or demo has frozen the application clock). For the development mailbox and tests.
 */
export async function listOutbox(params: ListOutboxParams = {}, dbOrTx?: DbOrTx): Promise<Email[]> {
  const limit = Math.min(200, Math.max(1, Math.trunc(params.limit ?? 50) || 50));
  const t = schema.emails;
  const where: SQL[] = [];
  const to = params.to?.trim().toLowerCase();
  if (to) where.push(eq(t.toEmail, to));
  const template = params.template?.trim();
  if (template) where.push(eq(t.template, template));
  const db = dbOrTx ?? (await getDb());
  return db
    .select()
    .from(t)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(t.id))
    .limit(limit);
}

export async function getEmail(id: string, dbOrTx?: DbOrTx): Promise<Email | null> {
  const db = dbOrTx ?? (await getDb());
  const [row] = await db.select().from(schema.emails).where(eq(schema.emails.id, id));
  return row ?? null;
}

export { escapeHtml, extractLinks, htmlToText, renderEmail, type EmailLocale, type RenderEmailInput, type RenderedEmail } from "./render";
