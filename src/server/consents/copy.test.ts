import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import {
  CONSENT_COPY,
  CONSENT_COPY_KINDS,
  CONSENT_LOCALES,
  CONSENT_VAR_TYPES,
  CURRENT_CONSENT_VERSION,
  consentTemplateSha256,
  formatConsentDate,
  getConsentCopy,
  placeholdersOf,
  renderConsent,
  type ConsentCopyKind,
} from "./copy";

// Synthetic organization and email used throughout. Not a real SGO or person.
const ORG = "Synthetic Scholarship Fund";
const VARS = {
  verification_share: { organizationName: ORG, shareUntil: "2027-12-31", uploadRetentionDays: 90 },
  rail_connect: { organizationName: ORG, providerName: "Simulated Payroll", incomeYear: 2026 },
  passport_reuse: { organizationName: ORG, decidedDate: "2027-01-15", resultValidUntil: "2027-12-31", shareUntil: "2027-06-30" },
  electronic_delivery: { email: "parent@example.com" },
} as const;

/**
 * The words of a published version must never change: a grant's stored hash would stop matching the text.
 * If one of these fails, revert the wording or publish a NEW version (and point CURRENT_CONSENT_VERSION at it),
 * then add its hash here. Never update an existing hash.
 */
const LOCKED_TEMPLATE_SHA256: Record<string, string> = {
  "verification_share.v1/en": "2d54ed5348a2ee76fbc3f427f9db73b4b821ec0a12db7089a92b3e6bbf33d791",
  "verification_share.v1/es": "80162ec2d360a4f93294b988434fd6471529b2306accca14dca74548c57472d8",
  "rail_connect.v1/en": "7afe39b7b2985444c5cb63b306f98e7b2e010036976dd7f652bda6cd22a344e2",
  "rail_connect.v1/es": "483e7169f3a5b6933639e9465b61b99f7d8aa6ab76444c358a00f3a9a33b52b2",
  "passport_reuse.v1/en": "263dc3cb69ca7771ffcc14046797fb891257f825654c08069e1e999d89465bf1",
  "passport_reuse.v1/es": "0535a43080a0659af22748dc02fc97683c46611518616edb9b01cc2276322f4b",
  "electronic_delivery.v1/en": "1a7e12fda5e3ae2e59a18c3cd5c00fe506bc483d6b1155ebe1a9a2a44ee4ce76",
  "electronic_delivery.v1/es": "50c3f82529c3623cdf5f660ab0642a25f869a836d6967d11ee1e3c0057ac02ae",
};

/** Rendered text hashes for fixed synthetic variables: locks the rendering (joining, date words) too. */
const LOCKED_RENDERED_SHA256: Record<string, string> = {
  "verification_share/en": "afc0120078be37f8f93b2394b5b443630a07e79c1d62a6251bc5518175dea928",
  "rail_connect/en": "c7755120d81f4d33adf2ae92663229a6f97e7b7589ead04ecad960bc37aca431",
  "passport_reuse/en": "1e2094dd75f6b87bfde48e2a712536c8db909382d2558e8fb02c2601b52f2102",
  "electronic_delivery/en": "15452bd62e954de42d226c79179280bb62e0396b73452b37259801dac27edb22",
  "verification_share/es": "c9731eaa0b452b92c4bdd4730c47de40c41da48f1bfff1eedd49fc962f2e8d6e",
  "rail_connect/es": "ee406745ad75739423790e3ddcc1f5bdea2b25dff1a80557d37f3b7164f48705",
  "passport_reuse/es": "1c37a26c1cca7cfe672cd7fb1c7fd5d17c1c10fa5039a28552eeae0d266050a6",
  "electronic_delivery/es": "d3d8f2106364d3a0ff7b2c05b710637197456cf37a58b2969fd31fbf56f0df45",
};

function render(kind: ConsentCopyKind, locale: "en" | "es") {
  return renderConsent(kind, locale, VARS[kind] as never);
}

function errorFields(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (e) {
    if (isAppError(e) && e.code === "validation_failed") return (e.details as { fields: Record<string, string> }).fields;
    throw e;
  }
  throw new Error("expected validation_failed");
}

describe("consent copy registry", () => {
  it("locks the template hash of every published version", () => {
    const actual = Object.fromEntries(CONSENT_COPY.map((e) => [`${e.version}/${e.locale}`, consentTemplateSha256(e)]));
    expect(actual).toEqual(LOCKED_TEMPLATE_SHA256);
  });

  it("locks the rendered text hash for fixed variables", () => {
    for (const kind of CONSENT_COPY_KINDS) for (const locale of CONSENT_LOCALES) expect(render(kind, locale).sha256, `${kind}/${locale}`).toBe(LOCKED_RENDERED_SHA256[`${kind}/${locale}`]);
  });

  it("has a current version in both languages for every kind, and version ids are named after their kind", () => {
    for (const kind of CONSENT_COPY_KINDS) {
      for (const locale of CONSENT_LOCALES) {
        const entry = getConsentCopy(CURRENT_CONSENT_VERSION[kind], locale);
        expect(entry?.kind).toBe(kind);
      }
    }
    for (const e of CONSENT_COPY) expect(e.version).toMatch(new RegExp(`^${e.kind}\\.v\\d+$`));
    const keys = CONSENT_COPY.map((e) => `${e.version}/${e.locale}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("English and Spanish of each version use the same placeholders, scope keys and paragraph count", () => {
    for (const version of new Set(CONSENT_COPY.map((e) => e.version))) {
      const en = getConsentCopy(version, "en")!;
      const es = getConsentCopy(version, "es")!;
      expect(placeholdersOf(es), version).toEqual(placeholdersOf(en));
      expect(Object.keys(es.scope).sort(), version).toEqual(Object.keys(en.scope).sort());
      expect(es.scope).toEqual(en.scope);
      expect(es.paragraphs.length, version).toBe(en.paragraphs.length);
      // Every paragraph-level placeholder appears in the same paragraph in both languages.
      en.paragraphs.forEach((p, i) => {
        const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
        expect(names(es.paragraphs[i]!), `${version} paragraph ${i}`).toEqual(names(p));
      });
    }
  });

  it("uses exactly the declared variables of its kind", () => {
    for (const e of CONSENT_COPY) expect(placeholdersOf(e), e.version).toEqual(Object.keys(CONSENT_VAR_TYPES[e.kind]).sort());
  });

  it("registry entries are frozen", () => {
    const entry = CONSENT_COPY[0]!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.paragraphs)).toBe(true);
    expect(() => {
      (entry as { title: string }).title = "changed";
    }).toThrow();
  });

  it("the sharing consent says who, what, why, how long, what is not shared, how to say no and withdraw", () => {
    const en = render("verification_share", "en");
    const text = en.text;
    expect(text).toContain(ORG);
    expect(text).toContain("December 31, 2027");
    expect(text).toContain("90 days");
    expect(text).toMatch(/proposed federal rules/);
    expect(text).toMatch(/not a credit check/);
    expect(text).toMatch(/do not sell/);
    expect(text).toMatch(/password/);
    expect(text).toMatch(/take back this permission/);
    expect(text).toMatch(/you do not have to agree/i);
    expect(text).toMatch(/written instruction/);
    expect(en.scope).toMatchObject({ recipient: ORG, shareUntil: "2027-12-31", uploadRetentionDays: 90, purpose: "scholarship_income_eligibility" });
    expect(en.scope.notShared).toEqual(["bank_or_payroll_login", "full_social_security_number"]);

    const es = render("verification_share", "es");
    expect(es.text).toContain("31 de diciembre de 2027");
    expect(es.text).toContain("90 días");
    expect(es.text).toMatch(/reglas federales propuestas/);
    expect(es.text).toMatch(/no es una revisión de crédito/i);
    expect(es.text).toMatch(/Usted/);
    expect(es.scope).toEqual(en.scope);
  });

  it("the rail consent names the year retrieved and the upload alternative", () => {
    const en = render("rail_connect", "en");
    expect(en.text).toContain("2026");
    expect(en.text).toMatch(/upload documents instead/);
    const es = render("rail_connect", "es");
    expect(es.text).toMatch(/subir documentos en su lugar/);
    expect(en.scope).toMatchObject({ incomeYear: 2026, alternative: "upload_documents" });
  });

  it("the passport consent is a new permission for the second organization", () => {
    const en = render("passport_reuse", "en");
    expect(en.text).toMatch(/new permission, just for Synthetic Scholarship Fund/);
    expect(en.text).toContain("January 15, 2027");
    expect(render("passport_reuse", "es").text).toContain("15 de enero de 2027");
  });
});

describe("renderConsent", () => {
  it("returns the exact shown text and its SHA-256", () => {
    const r = render("electronic_delivery", "en");
    expect(r.text).toBe([r.title, ...r.paragraphs, r.checkboxLabel].join("\n\n"));
    expect(r.sha256).toBe(sha256Hex(r.text));
    expect(r.version).toBe("electronic_delivery.v1");
    expect(r.text).not.toMatch(/\{\w+\}/);
  });

  it("rejects missing, extra and malformed variables", () => {
    expect(errorFields(() => renderConsent("verification_share", "en", { organizationName: ORG, shareUntil: "2027-12-31" } as never))).toHaveProperty("uploadRetentionDays");
    expect(errorFields(() => renderConsent("electronic_delivery", "en", { email: "a@example.com", extra: "x" } as never))).toHaveProperty("extra");
    expect(errorFields(() => renderConsent("verification_share", "en", { ...VARS.verification_share, shareUntil: "2027-02-30" }))).toHaveProperty("shareUntil");
    expect(errorFields(() => renderConsent("verification_share", "en", { ...VARS.verification_share, uploadRetentionDays: 1.5 }))).toHaveProperty("uploadRetentionDays");
    expect(errorFields(() => renderConsent("verification_share", "en", { ...VARS.verification_share, organizationName: "   " }))).toHaveProperty("organizationName");
    expect(errorFields(() => renderConsent("verification_share", "en", { ...VARS.verification_share, organizationName: "x".repeat(201) }))).toHaveProperty("organizationName");
    expect(errorFields(() => renderConsent("electronic_delivery", "en", { email: "not-an-email" }))).toHaveProperty("email");
  });

  it("rejects unknown kinds, languages and versions", () => {
    expect(() => renderConsent("donor_e_delivery" as never, "en", {} as never)).toThrow();
    expect(() => renderConsent("electronic_delivery", "fr" as never, VARS.electronic_delivery)).toThrow();
    expect(() => renderConsent("electronic_delivery", "en", VARS.electronic_delivery, { version: "electronic_delivery.v99" })).toThrow(/Unknown consent version/);
    expect(() => renderConsent("electronic_delivery", "en", VARS.electronic_delivery, { version: "verification_share.v1" })).toThrow(/Unknown consent version/);
  });

  it("inserts values literally: braces in a value are never expanded", () => {
    const r = renderConsent("verification_share", "en", { ...VARS.verification_share, organizationName: "Fund {shareUntil} & Co" });
    expect(r.title).toContain("Fund {shareUntil} & Co");
    expect(r.scope.recipient).toBe("Fund {shareUntil} & Co");
  });

  it("collapses whitespace and strips control characters in text values", () => {
    const r = renderConsent("verification_share", "en", { ...VARS.verification_share, organizationName: "  Synthetic\n\tScholarship   Fund " });
    expect(r.vars.organizationName).toBe(ORG);
    expect(r.sha256).toBe(LOCKED_RENDERED_SHA256["verification_share/en"]);
  });

  it("returns fresh arrays the caller may not use to mutate the registry", () => {
    const r = render("electronic_delivery", "en");
    (r.scope.channels as string[]).push("fax");
    expect(render("electronic_delivery", "en").scope.channels).toEqual(["email", "account_page"]);
  });
});

describe("formatConsentDate", () => {
  it.each([
    ["2027-01-01", "en", "January 1, 2027"],
    ["2027-12-31", "en", "December 31, 2027"],
    ["2027-01-01", "es", "1 de enero de 2027"],
    ["2028-02-29", "es", "29 de febrero de 2028"],
  ] as const)("%s in %s", (iso, locale, expected) => {
    expect(formatConsentDate(iso, locale)).toBe(expected);
  });
});
