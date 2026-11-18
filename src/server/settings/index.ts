import { isDeepStrictEqual } from "node:util";
import { eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/db/client";
import { now } from "@/lib/clock";
import { AppError, badRequest, invalid } from "@/lib/errors";
import { audit, type AuditRequestInfo } from "@/server/audit";
import { SETTING_DEFINITIONS, SETTING_KEYS, isSettingKey, type SettingDefinition, type SettingKey, type SettingValue } from "./definitions";

/**
 * Typed platform settings over the `platform_settings` table.
 *
 *   const fees = await getSetting("fees.structure");
 *   const { "gifts.liveEnabled": live, "credit.startDate": start } = await getSettings(["gifts.liveEnabled", "credit.startDate"]);
 *   await setSetting("gifts.liveEnabled", true, { actorUserId: admin.id });
 *
 * Values are read from the database on every call (no cross-request cache): these are legal gates, and a
 * stale "live gifts on" is worse than one extra primary-key lookup.
 */

function definition(key: SettingKey): SettingDefinition<z.ZodType> {
  if (!isSettingKey(key)) throw badRequest(`Unknown setting "${String(key)}"`);
  return SETTING_DEFINITIONS[key] as unknown as SettingDefinition<z.ZodType>;
}

/** Read straight from process.env (like src/lib/clock) so a cached env() can never unlock a production gate. */
const inProduction = () => process.env.NODE_ENV === "production";

export function getSettingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return structuredClone(definition(key).default) as SettingValue<K>;
}

export type SettingSource =
  /** No row: the registry default applies. */
  | "default"
  /** A valid stored value. */
  | "stored"
  /** A row exists but no longer passes validation; the default applies until an admin saves a valid value. */
  | "invalid_stored"
  /** Production pins this setting to its default; any stored value is ignored. */
  | "production_locked";

function resolve<K extends SettingKey>(key: K, row: { value: unknown } | undefined): { value: SettingValue<K>; source: SettingSource } {
  const def = definition(key);
  if (def.productionLocked && inProduction()) return { value: getSettingDefault(key), source: "production_locked" };
  if (!row) return { value: getSettingDefault(key), source: "default" };
  const parsed = def.schema.safeParse(row.value);
  if (!parsed.success) {
    // Fail safe, loudly: defaults are the conservative state (see ./definitions).
    console.error(`[settings] Stored value for "${key}" is invalid; using the default. ${summarize(parsed.error)}`);
    return { value: getSettingDefault(key), source: "invalid_stored" };
  }
  return { value: parsed.data as SettingValue<K>, source: "stored" };
}

function summarize(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/** Validates an untrusted value (e.g. an admin form submission) for `key`. Throws `validation_failed` with per-field messages. */
export function parseSettingValue<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const parsed = definition(key).schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "value"] ??= issue.message;
    throw invalid(`Invalid value for setting "${key}": ${summarize(parsed.error)}`, { key, fields });
  }
  return parsed.data as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(key: K, dbOrTx?: DbOrTx): Promise<SettingValue<K>> {
  definition(key);
  const db = dbOrTx ?? (await getDb());
  const [row] = await db.select({ value: schema.platformSettings.value }).from(schema.platformSettings).where(eq(schema.platformSettings.key, key));
  return resolve(key, row).value;
}

/** Reads several settings in one query. Returns an object keyed by setting key. */
export async function getSettings<const K extends readonly SettingKey[]>(keys: K, dbOrTx?: DbOrTx): Promise<{ [P in K[number]]: SettingValue<P> }> {
  for (const key of keys) definition(key);
  const out: Partial<Record<SettingKey, unknown>> = {};
  if (keys.length > 0) {
    const db = dbOrTx ?? (await getDb());
    const rows = await db
      .select({ key: schema.platformSettings.key, value: schema.platformSettings.value })
      .from(schema.platformSettings)
      .where(inArray(schema.platformSettings.key, [...keys]));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const key of keys) out[key] = resolve(key, byKey.get(key)).value;
  }
  return out as { [P in K[number]]: SettingValue<P> };
}

export interface SetSettingOptions {
  /** The platform admin making the change; `null` for system writes (seed scripts, migrations). */
  actorUserId: string | null;
  /** Recorded on the audit entry. */
  request?: AuditRequestInfo | null;
}

/**
 * Validates and stores a setting, records who changed it and when, and writes an audit entry
 * (`settings.update`, with the previous and the new value) in the same transaction.
 *
 * Authorization is the caller's job: call `requirePlatformAdmin()` first.
 */
export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>, opts: SetSettingOptions, dbOrTx?: DbOrTx): Promise<SettingValue<K>> {
  const def = definition(key);
  const next = parseSettingValue(key, value);
  if (def.productionLocked && inProduction() && !isDeepStrictEqual(next, def.default)) {
    throw new AppError("forbidden", `"${key}" cannot be changed in production`);
  }

  const db = dbOrTx ?? (await getDb());
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key));
    if (existing && isDeepStrictEqual(existing.value, next)) return;
    const previous = resolve(key, existing).value;
    const updatedAt = now();
    await tx
      .insert(schema.platformSettings)
      .values({ key, value: next, updatedAt, updatedBy: opts.actorUserId })
      .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value: next, updatedAt, updatedBy: opts.actorUserId } });
    await audit(
      {
        actor: opts.actorUserId ? { type: "user", id: opts.actorUserId } : { type: "system" },
        action: "settings.update",
        target: { type: "platform_setting", id: key },
        metadata: { from: previous, to: next },
        request: opts.request,
      },
      tx,
    );
  });
  return next;
}

export interface SettingSnapshot<K extends SettingKey = SettingKey> {
  key: K;
  description: string;
  /** The value in effect. */
  value: SettingValue<K>;
  defaultValue: SettingValue<K>;
  source: SettingSource;
  productionLocked: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Every setting with its effective value and provenance, in registry order (for the platform-admin screen). */
export async function listSettings(dbOrTx?: DbOrTx): Promise<SettingSnapshot[]> {
  const db = dbOrTx ?? (await getDb());
  const rows = await db.select().from(schema.platformSettings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return SETTING_KEYS.map((key) => {
    const row = byKey.get(key);
    const { value, source } = resolve(key, row);
    return {
      key,
      description: SETTING_DEFINITIONS[key].description,
      value,
      defaultValue: getSettingDefault(key),
      source,
      productionLocked: definition(key).productionLocked === true,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  FEE_STRUCTURES,
  STATUTORY_CREDIT_START_DATE,
  COUNSEL_MEMO_REQUIRED_MESSAGE,
  isSettingKey,
  type FeeStructure,
  type SettingKey,
  type SettingValue,
  type SettingValues,
} from "./definitions";
