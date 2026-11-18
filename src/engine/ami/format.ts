import { formatUsd } from "@/lib/money";
import { BASIS_POINTS } from "./constants";
import type { ThresholdCopyLocale } from "./types";

const MONTHS: Record<ThresholdCopyLocale, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

/** "2026-05-01" -> "May 1, 2026" (en) or "1 de mayo de 2026" (es). Pure string work, no time zones involved. */
export function formatLongDate(isoDate: string, locale: ThresholdCopyLocale = "en"): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = MONTHS[locale][month - 1];
  return locale === "es" ? `${day} de ${monthName} de ${year}` : `${monthName} ${day}, ${year}`;
}

/** Basis points as a decimal string with two places: 10800 -> "1.08". Exact; no floating point. */
export function formatMultiplier(bps: number): string {
  const whole = Math.trunc(bps / BASIS_POINTS);
  const fraction = bps % BASIS_POINTS;
  const digits = String(fraction).padStart(4, "0");
  // Two decimals cover every HUD multiplier; keep more only when the basis points need them.
  return `${whole}.${digits.endsWith("00") ? digits.slice(0, 2) : digits}`;
}

/** Cents as "$312,000.00" (always with cents, so printed arithmetic is unambiguous). */
export function formatExactUsd(cents: number): string {
  return formatUsd(cents, { cents: true });
}

/** Whole dollars as "$104,000". */
export function formatWholeUsd(dollars: number): string {
  return formatUsd(dollars * 100, { cents: false });
}
