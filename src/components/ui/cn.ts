import { clsx, type ClassValue } from "clsx";

/**
 * Joins class names. There is no class-conflict resolution, so a `className` passed to a kit component
 * is for placement (margin, width, grid/flex position) — not for restyling its colours or padding.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
