import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEmail } from "@/server/email";
import { assertDevMailboxEnabled, firstParam, formatTimestamp, previewDocument } from "./shared";

describe("dev mailbox helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is available in development and test", () => {
    expect(() => assertDevMailboxEnabled()).not.toThrow();
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertDevMailboxEnabled()).not.toThrow();
  });

  it("answers 404 in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    let thrown: unknown;
    try {
      assertDevMailboxEnabled();
    } catch (e) {
      thrown = e;
    }
    // next/navigation's notFound() signals a 404 by throwing an error with this digest.
    expect((thrown as { digest?: string } | undefined)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("reads the first value of a possibly repeated search param", () => {
    expect(firstParam(undefined)).toBe("");
    expect(firstParam("  a@example.com ")).toBe("a@example.com");
    expect(firstParam(["b@example.com", "c@example.com"])).toBe("b@example.com");
    expect(firstParam([])).toBe("");
  });

  it("adds a base target to the preview without disturbing the document", () => {
    const { html } = renderEmail({ heading: "Hi", paragraphs: ["x"], cta: { label: "Go", url: "https://example.org/go" } });
    const preview = previewDocument(html);
    expect(preview.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(preview).toContain('<head><base target="_blank">');
    expect(preview.replace('<base target="_blank">', "")).toBe(html);
    expect(preview.match(/<base /g)).toHaveLength(1);
  });

  it("handles documents without a head or a doctype", () => {
    expect(previewDocument("<p>Hello</p>")).toBe('<base target="_blank"><p>Hello</p>');
    expect(previewDocument("<!doctype html><p>Hello</p>")).toBe('<!doctype html><base target="_blank"><p>Hello</p>');
    expect(previewDocument('<HEAD lang="en"><title>x</title></HEAD><p>y</p>')).toBe('<HEAD lang="en"><base target="_blank"><title>x</title></HEAD><p>y</p>');
    expect(previewDocument("")).toBe('<base target="_blank">');
  });

  it("formats timestamps in US Central time", () => {
    expect(formatTimestamp(new Date("2027-01-15T18:30:05Z"))).toBe("Jan 15, 2027, 12:30:05 PM CST");
    expect(formatTimestamp(new Date("2026-07-04T18:30:05Z"))).toBe("Jul 4, 2026, 1:30:05 PM CDT");
    expect(formatTimestamp(null)).toBe("—");
  });
});
