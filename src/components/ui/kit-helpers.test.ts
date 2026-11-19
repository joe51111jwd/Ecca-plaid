import { describe, expect, it } from "vitest";
import { actionError, invalid, type ActionResult } from "@/lib/errors";
import { initialsOf } from "./avatar";
import { fieldError, formMessage, hasFormError } from "./form-helpers";
import { isExternalHref } from "./href";
import { UI_STRINGS, uiStrings, type UiStrings } from "./locale";

describe("form helpers", () => {
  const failed = actionError(invalid("Check the highlighted answers.", { fields: { email: "Enter an email address." } }));
  const ok: ActionResult<{ id: string }> = { ok: true, data: { id: "x" } };

  it("reads field and form messages from a failed ActionResult", () => {
    expect(fieldError(failed, "email")).toBe("Enter an email address.");
    expect(fieldError(failed, "other")).toBeUndefined();
    expect(formMessage(failed)).toBe("Check the highlighted answers.");
    expect(hasFormError(failed)).toBe(true);
  });

  it("is quiet for the initial state and for success", () => {
    for (const state of [null, undefined, ok]) {
      expect(fieldError(state, "email")).toBeUndefined();
      expect(formMessage(state)).toBeUndefined();
      expect(hasFormError(state)).toBe(false);
    }
  });

  it("handles a failure without field errors", () => {
    const plain = actionError(invalid("Nope"));
    expect(fieldError(plain, "email")).toBeUndefined();
    expect(formMessage(plain)).toBe("Nope");
  });
});

describe("isExternalHref", () => {
  it("treats schemes and protocol-relative URLs as external", () => {
    for (const href of ["https://www.irs.gov/", "http://example.com", "mailto:help@example.com", "tel:+15125550100", "//cdn.example.com/x.js", "HTTPS://EXAMPLE.COM"]) {
      expect(isExternalHref(href), href).toBe(true);
    }
  });

  it("treats paths, queries and fragments as in-app", () => {
    for (const href of ["/give", "/sgo/verifications?status=pending", "#main-content", "?page=2", "give", "./next", "/v/abc:def"]) {
      expect(isExternalHref(href), href).toBe(false);
    }
  });
});

describe("initialsOf", () => {
  it("uses the first two words", () => {
    expect(initialsOf("Maria Alvarez")).toBe("MA");
    expect(initialsOf("Camp Cedar Creek")).toBe("CC");
    expect(initialsOf("Prairie Lantern Scholarship Fund")).toBe("PL");
    expect(initialsOf("  maria   de la  cruz ")).toBe("MD");
  });

  it("uses letters only", () => {
    expect(initialsOf("Demo: Lone Star Fund (sandbox)")).toBe("DL");
    expect(initialsOf("(Demo) — 42 Acme")).toBe("DA");
    expect(initialsOf("123 !!")).toBe("?");
  });

  it("handles single names, empty names and non-ASCII letters", () => {
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("Élodie Ñandú")).toBe("ÉÑ");
    expect(initialsOf("𝒜lice Bob")).toBe("𝒜B");
  });
});

describe("UI strings", () => {
  const locales = Object.keys(UI_STRINGS) as Array<keyof typeof UI_STRINGS>;
  const keys = Object.keys(UI_STRINGS.en) as Array<keyof UiStrings>;

  it("has the same keys in every locale and no empty strings", () => {
    for (const locale of locales) {
      expect(Object.keys(UI_STRINGS[locale]).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const value = UI_STRINGS[locale][key];
        if (typeof value === "string") expect(value.trim(), `${locale}.${key}`).not.toBe("");
        else expect(typeof value, `${locale}.${key}`).toBe("function");
      }
    }
  });

  it("formats the parameterised strings", () => {
    expect(uiStrings("en").stepOf(2, 5)).toBe("Step 2 of 5");
    expect(uiStrings("es").stepOf(2, 5)).toBe("Paso 2 de 5");
    expect(uiStrings("en").otpDigit(1, 6)).toBe("Digit 1 of 6");
    expect(uiStrings("es").fileRemove("carta.pdf")).toBe("Quitar carta.pdf");
    expect(uiStrings("en").definitionOf("household")).toContain("household");
  });

  it("applies overrides without mutating the built-in strings", () => {
    expect(uiStrings("en", { next: "Continue" }).next).toBe("Continue");
    expect(uiStrings("en").next).toBe("Next");
    expect(uiStrings().previous).toBe("Previous");
  });

  it("the provisional explanation never claims the IRS table exists", () => {
    for (const locale of locales) {
      const text = UI_STRINGS[locale].provisionalBody;
      expect(text).toMatch(/HUD/);
      expect(text).toMatch(/IRS/);
    }
    expect(UI_STRINGS.en.provisionalBody).toMatch(/has not yet published/);
    expect(UI_STRINGS.es.provisionalBody).toMatch(/aún no ha publicado/);
  });
});
