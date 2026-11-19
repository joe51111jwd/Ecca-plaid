/** Small display helpers for the dashboard. Pure. */

/**
 * A long identifier shortened for scanning: "77c11c64…0a89". Values short enough to read whole are returned as they
 * are, so a shortened value always hides at least a few characters (the full value stays in the title and copy button).
 */
export function shortHash(value: string, head = 8, tail = 6): string {
  const v = value.trim();
  const h = Number.isFinite(head) ? Math.max(1, Math.floor(head)) : 1;
  const t = Number.isFinite(tail) ? Math.max(1, Math.floor(tail)) : 1;
  if (v.length <= h + t + 3) return v;
  return `${v.slice(0, h)}…${v.slice(-t)}`;
}
