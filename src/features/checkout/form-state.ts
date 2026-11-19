/**
 * Pure helpers for the checkout form on the client: accumulating partial saves, deciding which field errors to
 * show, and ordering them. No React, no server imports, so they are unit-tested directly.
 */

/** A partial save as the donations service accepts it (validated there; this only builds it). */
export type Patch = { [key: string]: PatchValue };
export type PatchValue = string | number | boolean | null | Patch;

function isPatch(value: PatchValue | undefined): value is Patch {
  return typeof value === "object" && value !== null;
}

/**
 * Merges a later patch into an earlier one, field by field. A later scalar (including null, which clears) wins;
 * nested objects merge, so typing a city after a street keeps both in one save.
 */
export function mergePatch(earlier: Patch, later: Patch): Patch {
  const out: Patch = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    const before = out[key];
    out[key] = isPatch(value) && isPatch(before) ? mergePatch(before, value) : value;
  }
  return out;
}

export function isEmptyPatch(patch: Patch): boolean {
  return Object.keys(patch).length === 0;
}

/** Every dotted field path a patch touches ("address.city", "contributors.spouse.giftCents"). */
export function patchPaths(patch: Patch, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPatch(value)) out.push(path, ...patchPaths(value, path));
    else out.push(path);
  }
  return out;
}

/** Builds a nested patch from a dotted path: ("address.city", "Austin") → { address: { city: "Austin" } }. */
export function patchAt(path: string, value: PatchValue): Patch {
  const parts = path.split(".");
  let node: PatchValue = value;
  for (let i = parts.length - 1; i >= 0; i--) node = { [parts[i]]: node };
  return node as Patch;
}

/** Text as typed → the value to save: trimmed text, or null to clear the field. */
export function textValue(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Drops the errors of the fields a successful save just touched (the service reports the new ones). */
export function withoutPaths<T>(errors: Readonly<Record<string, T>>, paths: readonly string[]): Record<string, T> {
  const touched = new Set(paths);
  return Object.fromEntries(Object.entries(errors).filter(([key]) => !touched.has(key)));
}

/**
 * What is left of a patch the service refused field by field, once the refused fields are taken out. The service
 * validates a patch as a whole, so one bad value (a half-typed email or ZIP) would otherwise drop every other field
 * typed in the same debounce window. A leaf is dropped when it is a refused path, lies under one, or contains one
 * (`address: null` when `address.zip` was refused). Returns an empty patch when no refused path matches anything,
 * so a caller re-saving the remainder can never loop on the same refusal.
 */
export function withoutRejected(patch: Patch, rejectedPaths: readonly string[]): Patch {
  const rejected = rejectedPaths.filter((p) => p !== "");
  const hits = (path: string) => rejected.some((r) => r === path || r.startsWith(`${path}.`) || path.startsWith(`${r}.`));
  let removed = false;
  const prune = (node: Patch, prefix: string): Patch => {
    const out: Patch = {};
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isPatch(value) && !rejected.includes(path) && !rejected.some((r) => path.startsWith(`${r}.`))) {
        const inner = prune(value, path);
        if (Object.keys(inner).length > 0) out[key] = inner;
        else if (Object.keys(value).length > 0) removed = true;
        else out[key] = inner;
      } else if (hits(path)) {
        removed = true;
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  const rest = prune(patch, "");
  return removed ? rest : {};
}

export interface ErrorVisibility {
  /** Problems that block the order, from the service's view (shown once a field was touched, or all after "Review"). */
  blocking: Readonly<Record<string, string>>;
  /** Rejections of what was typed (shown once the field was left, or all after "Continue"). */
  rejected: Readonly<Record<string, string>>;
  /** Fields the donor has left (blur) or set with a single choice; typing alone does not count. */
  touched: ReadonlySet<string>;
  showAll: boolean;
}

/**
 * The message to show under one field, or null. Nothing shows while the donor is still typing into a field for the
 * first time: only once they leave it, or press Continue. A rejection of the typed value wins over a missing value.
 */
export function errorFor(path: string, v: ErrorVisibility): string | null {
  if (!v.showAll && !v.touched.has(path)) return null;
  return v.rejected[path] ?? v.blocking[path] ?? null;
}

/**
 * The order the form shows its fields in, so "Review" can move focus to the first problem. Paths the service
 * reports that are not listed (session, sgo, mode) are not fields and come first.
 */
export const FIELD_ORDER: readonly string[] = [
  "giftCents",
  "contributors.primary.designatedCents",
  "filingStatus",
  "contributors.primary.giftCents",
  "contributors.spouse.giftCents",
  "contributors.spouse.designatedCents",
  "contributors.primary.expectedStateCreditCents",
  "contributors.spouse.expectedStateCreditCents",
  "contributors.primary.firstName",
  "contributors.primary.lastName",
  "contributors.spouse.firstName",
  "contributors.spouse.lastName",
  "contributors.spouse.email",
  "email",
  "address.line1",
  "address.city",
  "address.state",
  "address.zip",
  "attestations.individual",
  "attestations.usCitizenOrResident",
  "attestations.noEarmark",
  "attestations.notInExchangeForScholarship",
  "attestations.jointOnBehalfOfBoth",
  "designationConfirmed",
  "contributors.primary.eDeliveryConsent",
  "contributors.spouse.eDeliveryConsent",
];

export function orderedErrors(errors: Readonly<Record<string, string>>): Array<{ path: string; message: string }> {
  const rank = (path: string) => {
    const i = FIELD_ORDER.indexOf(path);
    return i === -1 ? -1 : i;
  };
  return Object.entries(errors)
    .map(([path, message]) => ({ path, message }))
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/** A DOM id for a field path (used for focus and error links). */
export function fieldId(path: string): string {
  return `give-${path.replace(/[^A-Za-z0-9]+/g, "-")}`;
}
