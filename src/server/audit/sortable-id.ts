import { randomBytes } from "node:crypto";
import { ID_PREFIX, type IdKind } from "@/lib/ids";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Like `newId(kind)`, but ids sort in the order they were created: the usual prefix, then 10 characters of
 * real-clock milliseconds (strictly increasing within a process), then 12 random characters (60 bits).
 *
 * For append-only logs that are listed newest-first (audit entries, the email outbox). Their timestamps
 * follow the application clock, which tests and demos freeze, so many rows can share one instant; ordering
 * by such an id still returns them exactly as written. Digits and upper-case letters only, so the order is
 * the same under every Postgres collation.
 */
export function newSortableId(kind: IdKind): string {
  const g = globalThis as unknown as { __eccaSortableIdClock?: number };
  const tick = Math.max(Date.now(), (g.__eccaSortableIdClock ?? 0) + 1);
  g.__eccaSortableIdClock = tick;
  let time = "";
  for (let rest = tick, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) time = ALPHABET[rest % 32] + time;
  let random = "";
  for (const byte of randomBytes(12)) random += ALPHABET[byte % 32];
  return `${ID_PREFIX[kind]}_${time}${random}`;
}
