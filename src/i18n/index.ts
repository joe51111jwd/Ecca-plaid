/**
 * Dictionaries for the family-facing screens (English and Spanish). Pure: safe to import from server and client
 * components alike. Pages pass a `Locale` across the client boundary and each component looks its words up here
 * (dictionary entries can be functions, which cannot be serialized as props).
 */
import { en, type Dictionary } from "./en";
import { es } from "./es";

export type { Dictionary } from "./en";

export type Locale = "en" | "es";
export const LOCALES: readonly Locale[] = ["en", "es"];
export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that remembers the language a person chose with the toggle. */
export const LOCALE_COOKIE = "ecca_locale";
/** How long the language choice is remembered (one year). */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = Object.freeze({ en, es });

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "es";
}

/** A locale from untrusted input ("es", "ES", "es-MX", ["es"]), or null when it is not one we support. */
export function parseLocale(value: unknown): Locale | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const tag = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(tag) ? tag : null;
}

/**
 * The first supported locale among the candidates, in priority order (for example: the `?lang=` query, the
 * remembered cookie, the household's saved language, the language the organization sent the link in).
 */
export function pickLocale(...candidates: unknown[]): Locale {
  for (const candidate of candidates) {
    const locale = parseLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/** Picks the right half of a `{ en, es }` pair produced by a service. */
export function pickBilingual(value: { en: string; es: string }, locale: Locale): string {
  return locale === "es" ? value.es : value.en;
}
