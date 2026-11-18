import { formatUsd } from "@/lib/money";

/**
 * Display formatting shared by the record's sentences and the PDF. Pure string work on values that are
 * already validated; nothing here reads a clock or a time zone database.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** Cents as "$312,000.00": always with cents, so printed arithmetic is unambiguous. */
export function formatMoney(cents: number): string {
  return formatUsd(cents, { cents: true });
}

/** "2026-08-14" -> "August 14, 2026". */
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "2026-11-18T15:04:05.000Z" -> "2026-11-18 15:04:05 UTC". The record always stores UTC, so this is a slice, not a conversion. */
export function formatUtcTimestamp(isoTimestamp: string): string {
  return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 19)} UTC`;
}

/** "2026-11-18T15:04:05.000Z" -> "2026-11-18 15:04:05", for table columns whose header already says UTC. */
export function formatUtcClock(isoTimestamp: string): string {
  return `${isoTimestamp.slice(0, 10)} ${isoTimestamp.slice(11, 19)}`;
}

/** "2026-11-18T15:04:05.000Z" -> "2026-11-18" (the UTC calendar date). */
export function utcDateOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/** 248113 -> "248,113 bytes". Exact on purpose: an auditor compares it with the file. */
export function formatBytes(bytes: number): string {
  return `${String(bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${bytes === 1 ? "byte" : "bytes"}`;
}

/** 64 hex digits -> eight groups of eight, the way fingerprints are usually read aloud and compared. */
export function groupHash(hex: string): string {
  return hex.match(/.{1,8}/g)?.join(" ") ?? hex;
}

/** "verification_share" -> "Verification share". For identifiers that have no dedicated label. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.\-:]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
