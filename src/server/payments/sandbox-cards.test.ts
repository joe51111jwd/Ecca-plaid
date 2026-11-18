import { describe, expect, it } from "vitest";
import { formatCardNumber, isExpired, isValidSecurityCode, normalizeCardNumber, parseExpiry, passesLuhn, resolveSandboxCard, SANDBOX_TEST_CARDS, sandboxTestExpiry } from "./sandbox-cards";

describe("sandbox test cards", () => {
  it("documents one number per outcome, each a well-formed card number", () => {
    expect(SANDBOX_TEST_CARDS.map((c) => [c.display, c.outcome])).toEqual([
      ["4242 4242 4242 4242", "succeeded"],
      ["4000 0000 0000 0002", "declined"],
      ["4000 0000 0000 9995", "insufficient_funds"],
      ["4242 4242 4242 0000", "processing_then_succeeded"],
      ["4242 4242 4242 0018", "processing_then_failed"],
    ]);
    for (const card of SANDBOX_TEST_CARDS) {
      expect(card.number).toMatch(/^\d{16}$/);
      expect(passesLuhn(card.number)).toBe(true);
      expect(card.label.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
    }
    expect(new Set(SANDBOX_TEST_CARDS.map((c) => c.number)).size).toBe(SANDBOX_TEST_CARDS.length);
  });

  it("resolves a typed number however it is spaced, and nothing else", () => {
    expect(resolveSandboxCard("4242424242424242")?.outcome).toBe("succeeded");
    expect(resolveSandboxCard(" 4242 4242 4242 4242 ")?.outcome).toBe("succeeded");
    expect(resolveSandboxCard("4000-0000-0000-0002")?.outcome).toBe("declined");
    expect(resolveSandboxCard("4242 4242 4242 0000")?.outcome).toBe("processing_then_succeeded");
    // Well-formed numbers that are not test numbers: refused, so a real card typed by mistake is never "accepted".
    expect(resolveSandboxCard("4111111111111111")).toBeNull();
    expect(resolveSandboxCard("5555555555554444")).toBeNull();
    expect(resolveSandboxCard("4242424242424241")).toBeNull();
    expect(resolveSandboxCard("")).toBeNull();
    expect(resolveSandboxCard("4242 4242 4242 4242 x")).toBeNull();
    expect(resolveSandboxCard("４２４２４２４２４２４２４２４２")).toBeNull();
  });

  it("normalizes and formats card numbers", () => {
    expect(normalizeCardNumber("4242 4242-4242 4242")).toBe("4242424242424242");
    expect(normalizeCardNumber("42424242424")).toBeNull();
    expect(normalizeCardNumber("42424242424242424242")).toBeNull();
    expect(normalizeCardNumber("4242 4242 4242 424a")).toBeNull();
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("378282246310005")).toBe("3782 8224 6310 005");
    expect(passesLuhn("4242424242424241")).toBe(false);
    expect(passesLuhn("")).toBe(false);
    expect(passesLuhn("4242 4242")).toBe(false);
  });

  it("parses expiry dates the ways people type them", () => {
    expect(parseExpiry("12/30")).toEqual({ month: 12, year: 2030 });
    expect(parseExpiry("1/27")).toEqual({ month: 1, year: 2027 });
    expect(parseExpiry(" 03 / 2031 ")).toEqual({ month: 3, year: 2031 });
    expect(parseExpiry("0929")).toEqual({ month: 9, year: 2029 });
    expect(parseExpiry("09-29")).toEqual({ month: 9, year: 2029 });
    for (const bad of ["", "13/30", "00/30", "12/3", "12/300", "ab/cd", "12/30/31", "12 30 31"]) expect(parseExpiry(bad)).toBeNull();
  });

  it("treats a card as good through the end of its expiry month", () => {
    const today = new Date("2026-12-10T15:00:00Z");
    expect(isExpired({ month: 12, year: 2026 }, today)).toBe(false);
    expect(isExpired({ month: 11, year: 2026 }, today)).toBe(true);
    expect(isExpired({ month: 1, year: 2027 }, today)).toBe(false);
    expect(isExpired({ month: 12, year: 2025 }, today)).toBe(true);
    expect(isExpired({ month: 12, year: 2026 }, new Date("2026-12-31T23:59:59Z"))).toBe(false);
    expect(isExpired({ month: 12, year: 2026 }, new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });

  it("accepts any 3 or 4 digit security code", () => {
    for (const ok of ["123", "0000", " 123 "]) expect(isValidSecurityCode(ok)).toBe(true);
    for (const bad of ["", "12", "12345", "12a", "1 23"]) expect(isValidSecurityCode(bad)).toBe(false);
  });

  it("suggests an expiry date that the form will accept", () => {
    for (const today of [new Date("2026-11-18T00:00:00Z"), new Date("2027-12-31T23:59:59Z"), new Date("2096-06-01T00:00:00Z")]) {
      const suggested = sandboxTestExpiry(today);
      expect(suggested).toMatch(/^12\/\d{2}$/);
      const parsed = parseExpiry(suggested);
      // Two-digit years are read as 20xx, so the helper is only meaningful this century; within it, never expired.
      if (today.getUTCFullYear() < 2096) expect(isExpired(parsed!, today)).toBe(false);
    }
    expect(sandboxTestExpiry(new Date("2026-11-18T00:00:00Z"))).toBe("12/30");
  });
});
