/**
 * Audit metadata is free-form context ("which fields changed", "which reason was given"). It must never
 * become a second copy of a secret or of a family's documents, so everything passes through this sanitizer
 * before it is written.
 */

/** Keys whose values are never recorded, at any depth. */
export const SENSITIVE_KEY_PATTERN = /token|secret|password|ssn|authorization/i;

export const AUDIT_METADATA_LIMITS = {
  /** Longer strings are cut: metadata describes an action, it does not hold document text. */
  maxStringLength: 500,
  maxDepth: 6,
  maxKeysPerObject: 50,
  maxArrayItems: 50,
} as const;

const REDACTED = "[redacted]";
/** Formatted Social Security numbers are masked wherever they appear, whatever the key is called. */
const SSN_IN_TEXT = /\b\d{3}-\d{2}-\d{4}\b/g;

function sanitizeString(value: string): string {
  const masked = value.replace(SSN_IN_TEXT, REDACTED);
  const max = AUDIT_METADATA_LIMITS.maxStringLength;
  if (masked.length <= max) return masked;
  return `${masked.slice(0, max)}… [truncated ${masked.length - max} chars]`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const DROP = Symbol("drop");

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown | typeof DROP {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return sanitizeString(value);
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return DROP;
  }
  const obj = value as object;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  // Raw bytes are document contents by definition: record only that they were there.
  if (obj instanceof ArrayBuffer || obj instanceof SharedArrayBuffer) return `[binary ${obj.byteLength} bytes]`;
  if (ArrayBuffer.isView(obj)) return `[binary ${obj.byteLength} bytes]`;
  if (obj instanceof Error) return { name: obj.name, message: sanitizeString(obj.message) };
  if (seen.has(obj)) return "[circular]";
  if (depth >= AUDIT_METADATA_LIMITS.maxDepth) return "[truncated: too deep]";
  seen.add(obj);
  try {
    if (Array.isArray(obj) || obj instanceof Set) {
      const items = Array.isArray(obj) ? obj : [...obj];
      const out: unknown[] = [];
      for (const item of items.slice(0, AUDIT_METADATA_LIMITS.maxArrayItems)) {
        const v = sanitizeValue(item, depth + 1, seen);
        out.push(v === DROP ? null : v);
      }
      if (items.length > AUDIT_METADATA_LIMITS.maxArrayItems) out.push(`[+${items.length - AUDIT_METADATA_LIMITS.maxArrayItems} more]`);
      return out;
    }
    if (obj instanceof Map) return sanitizeEntries([...obj.entries()].map(([k, v]) => [String(k), v]), depth, seen);
    if (isPlainObject(obj)) return sanitizeEntries(Object.entries(obj), depth, seen);
    // Class instances (requests, database rows with prototypes, streams…) are not metadata.
    return `[${obj.constructor?.name ?? "object"}]`;
  } finally {
    seen.delete(obj);
  }
}

function sanitizeEntries(entries: Array<[string, unknown]>, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let kept = 0;
  let omitted = 0;
  for (const [key, raw] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const v = sanitizeValue(raw, depth + 1, seen);
    if (v === DROP) continue;
    if (kept >= AUDIT_METADATA_LIMITS.maxKeysPerObject) {
      omitted++;
      continue;
    }
    // defineProperty, not assignment: a "__proto__" key (e.g. from parsed JSON) must be recorded as data,
    // not swap the prototype of the output and vanish from the stored entry.
    Object.defineProperty(out, sanitizeString(key), { value: v, enumerable: true, writable: true, configurable: true });
    kept++;
  }
  if (omitted > 0) out["[omitted keys]"] = omitted;
  return out;
}

/**
 * Returns a JSON-safe copy of `metadata` with secrets removed:
 *  - keys matching {@link SENSITIVE_KEY_PATTERN} are dropped at any depth (`token`, `clientSecret`, `password`,
 *    `ssn`, `authorization`, …);
 *  - formatted SSNs inside any string are masked;
 *  - long strings are truncated, binary values are replaced by a size note, deep or huge structures are cut.
 * `null`/`undefined` in → `null` out.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Audit metadata must be a plain object");
  }
  const seen = new WeakSet<object>([metadata]);
  return sanitizeEntries(Object.entries(metadata), 0, seen);
}
