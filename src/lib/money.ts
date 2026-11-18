/** All money is integer US cents. Never use floats for money. */
export type Cents = number;

export function dollars(n: number): Cents {
  return Math.round(n * 100);
}

export function formatUsd(cents: Cents, opts: { cents?: boolean } = {}): string {
  const showCents = opts.cents ?? cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(cents / 100);
}

/** Parses "1,700", "$1700.50", "1700.5" → cents. Returns null when not a valid non-negative amount. */
export function parseUsdToCents(input: string): Cents | null {
  const s = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** floor(a * num / den) using BigInt so large products never lose precision. */
export function mulDivFloor(a: Cents, num: number, den: number): Cents {
  return Number((BigInt(a) * BigInt(num)) / BigInt(den));
}

/** round-half-up(a * num / den). */
export function mulDivRound(a: Cents, num: number, den: number): Cents {
  const n = BigInt(a) * BigInt(num);
  const d = BigInt(den);
  return Number((n * 2n + d) / (d * 2n));
}
