import { describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { getDictionary, parseLocale, pickBilingual, pickLocale } from "./index";

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ""): Leaf[] {
  if (typeof value === "string" || typeof value === "function") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [{ path, value }];
}

/** Calls a dictionary function with sample arguments of the right arity so its output can be checked. */
function render(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "function") return [];
  const fn = value as (...args: unknown[]) => string;
  const samples: unknown[][] = [];
  if (fn.length === 0) samples.push([]);
  else if (fn.length === 1) samples.push(["Sample Fund"], [1], [3], [2025]);
  else samples.push(["Sample Fund", 2025], ["Avery", 2025]);
  return samples.map((args) => fn(...args));
}

const enLeaves = leaves(en);
const esLeaves = leaves(es);

describe("dictionaries", () => {
  it("English and Spanish have exactly the same entries", () => {
    expect(esLeaves.map((l) => l.path).sort()).toEqual(enLeaves.map((l) => l.path).sort());
  });

  it("every entry has the same type and arity in both languages", () => {
    const esByPath = new Map(esLeaves.map((l) => [l.path, l.value]));
    for (const { path, value } of enLeaves) {
      const other = esByPath.get(path);
      expect(typeof other, path).toBe(typeof value);
      if (typeof value === "function") expect((other as (...a: unknown[]) => unknown).length, path).toBe(value.length);
    }
  });

  it("no entry renders empty, undefined or with a leftover placeholder", () => {
    for (const { path, value } of [...enLeaves, ...esLeaves]) {
      // The kinds table uses "" for "no hint"; everything else must have words.
      if (path.endsWith(".hint") && value === "") continue;
      for (const text of render(value)) {
        expect(text.trim().length, path).toBeGreaterThan(0);
        expect(text, path).not.toMatch(/undefined|null|NaN|\{[a-zA-Z]+\}|\[object/);
      }
    }
  });

  it("Spanish is translated, not copied from English", () => {
    const esByPath = new Map(esLeaves.map((l) => [l.path, l.value]));
    const identical: string[] = [];
    for (const { path, value } of enLeaves) {
      if (typeof value !== "string" || value.length < 12) continue;
      if (esByPath.get(path) === value) identical.push(path);
    }
    expect(identical).toEqual([]);
  });

  it("Spanish uses the formal 'usted', never 'tú' forms", () => {
    // Forms that only exist in the informal register ("sube", "elige" are also the formal third person, so they are not listed).
    const informal = /(^|[^\p{L}])(tú|tu|tus|ti|contigo|tienes|puedes|eres|quieres|necesitas|haz|hazlo|vuelves)(?=$|[^\p{L}])/iu;
    for (const { path, value } of esLeaves) for (const text of render(value)) expect(text, path).not.toMatch(informal);
  });

  it("family screens never mention fees, prices or payment", () => {
    const money = /\$|\bfees?\b|\bprice|\bpay (a|the|now)\b|\bpayment|(?<!in )\bcharges?\b|\bcost|\bfree\b|\bcuota|\bprecio|(?<!talón de |talones de )\bpago\b|\bcobr|\bgratis\b|\bcosto/i;
    for (const { path, value } of [...enLeaves, ...esLeaves]) for (const text of render(value)) expect(text, path).not.toMatch(money);
  });

  it("never promises a scholarship and keeps the not-a-promise sentence in both languages", () => {
    const promise = /\b(you will get|guaranteed|you qualify for a scholarship|recibirá una beca|garantiza)\b/i;
    for (const { path, value } of [...enLeaves, ...esLeaves]) for (const text of render(value)) expect(text, path).not.toMatch(promise);
    expect(en.outcome.notAPromise).toMatch(/not a promise/);
    expect(es.outcome.notAPromise).toMatch(/no es una promesa/);
  });

  it("household size reads naturally for one and many people", () => {
    expect(en.people.sizeBack(1)).toBe("1 person lives in your home.");
    expect(en.people.sizeBack(4)).toBe("4 people live in your home.");
    expect(es.people.sizeBack(1)).toBe("1 persona vive en su casa.");
    expect(es.people.sizeBack(4)).toBe("4 personas viven en su casa.");
  });
});

describe("locale helpers", () => {
  it("parses supported tags in any case or region and refuses the rest", () => {
    expect(parseLocale("es")).toBe("es");
    expect(parseLocale("ES-mx")).toBe("es");
    expect(parseLocale(["en"])).toBe("en");
    expect(parseLocale("fr")).toBeNull();
    expect(parseLocale("")).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
    expect(parseLocale(42)).toBeNull();
    expect(parseLocale({ toString: () => "es" })).toBeNull();
  });

  it("picks the first supported candidate and falls back to English", () => {
    expect(pickLocale(undefined, "fr", "es", "en")).toBe("es");
    expect(pickLocale(null, "")).toBe("en");
  });

  it("returns the dictionary of the locale", () => {
    expect(getDictionary("es")).toBe(es);
    expect(getDictionary("en").common.continue).toBe("Continue");
  });

  it("picks one half of a bilingual pair", () => {
    expect(pickBilingual({ en: "Received", es: "Recibido" }, "es")).toBe("Recibido");
    expect(pickBilingual({ en: "Received", es: "Recibido" }, "en")).toBe("Received");
  });
});
