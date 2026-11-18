/** Organization slugs: lower-case ASCII letters, digits and single hyphens; used in URLs, so some words are reserved. */

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 48;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Words that collide with routes, roles or impersonation targets. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "billing",
  "dashboard",
  "dev",
  "docs",
  "embed",
  "family",
  "give",
  "help",
  "login",
  "logout",
  "new",
  "null",
  "partner",
  "passport",
  "platform",
  "root",
  "security",
  "settings",
  "sgo",
  "sign-in",
  "sign-out",
  "signin",
  "signout",
  "static",
  "status",
  "support",
  "system",
  "undefined",
  "v",
  "www",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/** "Niños de Texas, Inc." → "ninos-de-texas-inc". Returns "" when nothing usable remains. */
export function slugify(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

/** Appends "-n", trimming the base so the result stays within the maximum length. */
export function withSuffix(base: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  return `${base.slice(0, room).replace(/-+$/g, "")}-${suffix}`;
}
