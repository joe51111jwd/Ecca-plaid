import { z } from "zod";

/**
 * Typed environment. Everything has a zero-config local default so `npm run dev` works with no setup:
 * embedded Postgres (PGlite), local encrypted file storage, an email outbox instead of real email,
 * a sandbox payment processor, and a simulated data rail. Production must set the real values.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Directory for local state (embedded DB, encrypted uploads, dev keys). */
  ECCA_DATA_DIR: z.string().default(".data"),
  /** Postgres connection string. When unset, an embedded PGlite database under ECCA_DATA_DIR is used. */
  DATABASE_URL: z.string().optional(),
  /** 32-byte base64 key that wraps all encryption keys. Required in production. */
  ECCA_MASTER_KEY: z.string().optional(),
  /** Ed25519 private key (PKCS8 PEM) used to sign evidence records. Required in production. */
  EVIDENCE_SIGNING_PRIVATE_KEY: z.string().optional(),
  EVIDENCE_SIGNING_KEY_ID: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["outbox", "resend"]).default("outbox"),
  EMAIL_FROM: z.string().default("Passport <no-reply@localhost>"),
  RESEND_API_KEY: z.string().optional(),

  PAYMENTS_PROVIDER: z.enum(["sandbox", "stripe"]).default("sandbox"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  RAIL_PROVIDER: z.enum(["simulated", "plaid"]).default("simulated"),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),

  /** Optional: enables model-assisted extraction for scanned/photographed documents. Without it they go to human review. */
  ANTHROPIC_API_KEY: z.string().optional(),

  /** Shared secret for the cron-triggered job runner endpoint. */
  CRON_SECRET: z.string().optional(),
  /** Run queued jobs inside the web process (default for the embedded DB). Set "false" when a separate worker runs. */
  JOBS_INLINE: z.string().optional(),
  /** Comma-separated emails that are granted platform-admin on first sign-in. */
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  /** Test/demo clock override, ignored in production. */
  ECCA_FAKE_NOW: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
export const usingEmbeddedDb = () => !env().DATABASE_URL;
export const jobsInline = () => (env().JOBS_INLINE ? env().JOBS_INLINE !== "false" : usingEmbeddedDb());
export const appUrl = (path = "") => `${env().APP_URL.replace(/\/$/, "")}${path.startsWith("/") || path === "" ? path : `/${path}`}`;
export const platformAdminEmails = () =>
  env()
    .PLATFORM_ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
