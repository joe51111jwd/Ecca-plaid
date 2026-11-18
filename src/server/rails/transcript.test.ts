import { describe, expect, it } from "vitest";
import { customerFileNumberFor, getTranscriptGuide } from "./transcript";

describe("getTranscriptGuide", () => {
  it.each(["en", "es"] as const)("gives complete %s steps that end in the normal upload path", (locale) => {
    const g = getTranscriptGuide(locale, { incomeYear: 2025 });
    expect(g.locale).toBe(locale);
    expect(g.steps.map((s) => s.id)).toEqual(["sign_in", "tax_records", "choose", "download", "upload"]);
    expect(g.steps.find((s) => s.id === "choose")!.body).toContain("2025");
    expect(g.steps.find((s) => s.id === "tax_records")!.body).toContain('"Tax Records"');
    expect(g.steps.every((s) => s.title.length > 0 && s.body.length > 0 && !/\{\w+\}/.test(s.title + s.body))).toBe(true);
    expect(g.goodToKnow.length).toBeGreaterThan(0);
    expect(g.otherWays.length).toBeGreaterThan(0);
    expect(g.sources.every((u) => u.startsWith("https://www.irs.gov/"))).toBe(true);
  });

  it("says plainly that we never ask for IRS credentials or sign in for the parent", () => {
    expect(getTranscriptGuide("en").neverAsk).toMatch(/never ask for your IRS username, password/);
    expect(getTranscriptGuide("en").neverAsk).toMatch(/never sign in to the IRS for you/);
    expect(getTranscriptGuide("es").neverAsk).toMatch(/Nunca le pediremos su usuario, contraseña/);
    // No step asks the parent to give us anything but the downloaded PDF.
    const all = JSON.stringify(getTranscriptGuide("en", { customerFileNumber: "1234567890" }));
    expect(all).not.toMatch(/send us your password|share your login|enter your IRS password here/i);
  });

  it("adds the Customer File Number step only when a number is given", () => {
    const g = getTranscriptGuide("en", { incomeYear: 2025, customerFileNumber: "4000000001" });
    const step = g.steps.find((s) => s.id === "customer_file_number");
    expect(step?.body).toContain("4000000001");
    expect(step?.body).toMatch(/not your Social Security number/);
  });

  it("falls back to 'last year' without an income year", () => {
    expect(getTranscriptGuide("en").steps.find((s) => s.id === "choose")!.body).toContain("last year");
    expect(getTranscriptGuide("es").steps.find((s) => s.id === "choose")!.body).toContain("el año pasado");
  });

  it("validates its inputs", () => {
    expect(() => getTranscriptGuide("fr" as "en")).toThrow();
    expect(() => getTranscriptGuide("en", { incomeYear: 1999 })).toThrow();
    expect(() => getTranscriptGuide("en", { customerFileNumber: "123456789" })).toThrow();
    expect(() => getTranscriptGuide("en", { customerFileNumber: "0123456789" })).toThrow();
  });
});

describe("customerFileNumberFor", () => {
  it("is a stable 10-digit number that cannot be a 9-digit SSN and differs per verification", () => {
    const a = customerFileNumberFor("ver_A");
    expect(a).toMatch(/^[1-9]\d{9}$/);
    expect(customerFileNumberFor("ver_A")).toBe(a);
    expect(customerFileNumberFor("ver_B")).not.toBe(a);
    expect(() => customerFileNumberFor("")).toThrow();
  });
});
