/**
 * Turns what a service threw into an ActionResult failure in the family's language. Services write their messages
 * in English for operators; the family sees a sentence from the dictionary chosen by the error's code, its
 * `details.reason` and, for field problems, the field name. Nothing internal (stack, SQL, ids) is ever shown.
 */
import { getDictionary, type Dictionary, type Locale } from "@/i18n";
import { isAppError, type ActionResult, type ErrorCode } from "@/lib/errors";

export type ActionFailure = Extract<ActionResult<never>, { ok: false }>;

type ErrorKey = Exclude<keyof Dictionary["errors"], "title" | "files" | "fields">;
type FileKey = keyof Dictionary["errors"]["files"];
type FieldKey = keyof Dictionary["errors"]["fields"];

const REASON_KEYS: Readonly<Record<string, ErrorKey>> = {
  link_used: "linkUsed",
  link_expired: "linkExpired",
  verification_canceled: "canceled",
  verification_expired: "expired",
  verification_locked: "locked",
  verification_closed: "locked",
  no_evidence: "noEvidence",
  household_incomplete: "householdIncomplete",
  too_many_documents: "tooManyDocuments",
  too_many_bytes: "tooManyBytes",
  source_not_reusable: "sourceNotReusable",
  household_changed: "householdChanged",
  already_submitted: "alreadySubmitted",
  already_reused: "alreadyReused",
  connection_closed: "connectionClosed",
  copy_changed: "consentChanged",
  consent_missing: "consentRequired",
};

const FILE_REASON_KEYS: Readonly<Record<string, FileKey>> = {
  empty: "empty",
  too_large: "tooLarge",
  unsupported_type: "type",
  dangerous_type: "type",
  type_mismatch: "mismatch",
};

/**
 * Service messages that carry no machine-readable reason, matched exactly. A changed wording simply falls back to
 * the generic sentence for the error code, never to the raw English text in Spanish.
 */
const MESSAGE_KEYS: Readonly<Record<string, ErrorKey>> = {
  "The adult in charge of the household is always listed as an adult.": "ownerAlwaysAdult",
  "This adult has their own sign-in. Remove them from the household instead of changing who they are.": "linkedAdult",
  "The adult in charge of the household cannot be removed.": "cannotRemoveOwner",
  "Enter your address first.": "addressFirst",
  "Add yourself to the household as an adult before signing a statement.": "signerNotAdult",
  "A household can list at most 20 people.": "tooManyPeople",
  "Right now we can only verify households that live in Texas. Please check the state and ZIP code in your address.": "texasOnly",
  "The household is not complete yet.": "householdNotComplete",
};

/** Field names services use that are not form field names, mapped to the field the family can fix. */
const FIELD_ALIASES: Readonly<Record<string, FieldKey>> = {
  owner_member: "firstName",
  student: "students",
  address: "line1",
  county: "county",
  studentMemberIds: "students",
  monthsInThisHousehold: "months",
  bytes: "declaredKind",
};

const CODE_FALLBACK: Readonly<Partial<Record<ErrorCode, ErrorKey>>> = {
  unauthenticated: "signInAgain",
  forbidden: "forbidden",
  not_found: "notFound",
  rate_limited: "rateLimited",
  gone: "linkExpired",
};

function detailString(details: unknown, key: string): string | null {
  if (!details || typeof details !== "object") return null;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function detailFields(details: unknown): Record<string, string> | null {
  if (!details || typeof details !== "object") return null;
  const fields = (details as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

function isFieldKey(t: Dictionary, key: string): key is FieldKey {
  return Object.prototype.hasOwnProperty.call(t.errors.fields, key);
}

/**
 * Field messages in the family's language, keyed by the form's field names. A field the dictionary knows gets the
 * dictionary's sentence; an unknown one keeps the service's English sentence only on English screens.
 */
export function localizeFields(fields: Record<string, string>, locale: Locale): Record<string, string> {
  const t = getDictionary(locale);
  const out: Record<string, string> = {};
  for (const [name, message] of Object.entries(fields)) {
    const alias = FIELD_ALIASES[name];
    const target = alias ?? name;
    if (alias && out[alias]) continue;
    if (target === "state" || /Texas/.test(message)) out[target] = t.errors.fields.state;
    else if (isFieldKey(t, target)) out[target] = t.errors.fields[target];
    else out[target] = locale === "en" ? message : t.errors.fields.generic;
  }
  return out;
}

const MAX_CAUSE_DEPTH = 3;

/**
 * An unexpected error as one log line without the family's data. Database errors carry the query's parameters in
 * their message (drizzle: "Failed query: …\nparams: <names, address, date of birth>") and pg errors in `detail`;
 * only the error's name, the first line of each message (the parameterized SQL, never its values) and the stack
 * frames are kept.
 */
export function describeForLog(e: unknown): string {
  const parts: string[] = [];
  let current: unknown = e;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(`non-error ${typeof current}`);
      break;
    }
    const firstLine = (current.message.split("\n", 1)[0] ?? "").slice(0, 500);
    parts.push(`${current.name}: ${firstLine}`);
    current = current.cause;
  }
  const frames = e instanceof Error && typeof e.stack === "string" ? e.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 8) : [];
  return [parts.join(" <- caused by "), ...frames].join("\n");
}

/** A failure with a dictionary message (for checks the page makes itself before calling a service). */
export function failure(code: ErrorCode, message: string, fields?: Record<string, string>): ActionFailure {
  return { ok: false, error: { code, message, ...(fields ? { fields } : {}) } };
}

/**
 * The ActionResult failure for anything a service threw. `fallback` is the sentence for an error the dictionary has
 * no specific words for (for example the invite form's "could not invite this person").
 */
export function localizeError(e: unknown, locale: Locale, opts: { fallback?: ErrorKey } = {}): ActionFailure {
  const t = getDictionary(locale);
  if (!isAppError(e)) {
    console.error(`[intake] unexpected error: ${describeForLog(e)}`);
    return failure("internal", t.errors.generic);
  }
  const reason = detailString(e.details, "reason");
  const fields = detailFields(e.details);

  if (reason && FILE_REASON_KEYS[reason]) return failure(e.code, t.errors.files[FILE_REASON_KEYS[reason]]);
  if (reason && REASON_KEYS[reason]) return failure(e.code, t.errors[REASON_KEYS[reason]], fields ? localizeFields(fields, locale) : undefined);
  if (reason?.startsWith("consent_")) return failure(e.code, t.errors.consentRequired);

  const byMessage = MESSAGE_KEYS[e.message];
  if (byMessage) return failure(e.code, t.errors[byMessage], fields ? localizeFields(fields, locale) : undefined);

  if (e.code === "validation_failed") {
    const localized = fields ? localizeFields(fields, locale) : undefined;
    const first = localized ? Object.values(localized)[0] : undefined;
    return failure(e.code, first && Object.keys(localized ?? {}).length === 1 ? first : t.errors.fields.generic, localized);
  }
  const key = opts.fallback ?? CODE_FALLBACK[e.code] ?? "generic";
  return failure(e.code, t.errors[key]);
}
