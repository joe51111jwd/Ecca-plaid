/**
 * The pure parts of the walkthrough recorder: caption reading time, timestamps, the title-card markup (escaped) and
 * the text version of the video.
 */
import { describe, expect, it } from "vitest";
import { cardHtml, clock, MIN_CAPTION_MS, MIN_CARD_MS, MS_PER_CHAR, readingMs, renderScript, type TimelineEntry } from "./record-demo";

describe("readingMs", () => {
  it("is roughly 60 ms (55 ms) per character, never under the minimum", () => {
    expect(MS_PER_CHAR).toBe(55);
    expect(readingMs("")).toBe(MIN_CAPTION_MS);
    expect(readingMs("short")).toBe(3_000);
    const long = "x".repeat(100);
    expect(readingMs(long)).toBe(5_500);
    expect(readingMs("abc", MIN_CARD_MS)).toBe(MIN_CARD_MS);
    expect(readingMs("x".repeat(200), MIN_CARD_MS, 42)).toBe(8_400);
  });
});

describe("clock", () => {
  it("formats m:ss and rounds to the nearest second", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(59_499)).toBe("0:59");
    expect(clock(59_500)).toBe("1:00");
    expect(clock(605_000)).toBe("10:05");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("cardHtml", () => {
  it("escapes every piece of text so a caption can never inject markup", () => {
    const html = cardHtml("K<b>", 'Title "&" <script>alert(1)</script>', ["a < b", "c > d"]);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Title &quot;&amp;&quot;");
    expect(html).toContain("<li>a &lt; b</li>");
    expect(html).toContain("K&lt;b&gt;");
    expect(html).toContain("synthetic data only");
  });
});

describe("renderScript", () => {
  const chapters = [
    { id: 0, title: "Intro" },
    { id: 1, title: "Website" },
    { id: 2, title: "Skipped" },
  ];
  const entries: TimelineEntry[] = [
    { chapter: 0, atMs: 0, kind: "card", lines: ["Passport: Title", "Line one"] },
    { chapter: 1, atMs: 4_000, kind: "caption", lines: ["The home page."] },
    { chapter: 1, atMs: 65_000, kind: "caption", lines: ["Later."] },
  ];
  const starts = new Map([
    [0, 0],
    [1, 30_000],
  ]);

  it("places every card and caption at its time in the joined video", () => {
    const md = renderScript(chapters, entries, starts, 125_000, "2026-11-19");
    expect(md).toContain("## 0:00 — Chapter 0: Intro");
    expect(md).toContain("**[0:00] Title card**");
    expect(md).toContain("> Line one");
    expect(md).toContain("## 0:30 — Chapter 1: Website");
    expect(md).toContain("- **[0:34]** The home page.");
    expect(md).toContain("- **[1:35]** Later.");
    expect(md).toContain("(`passport-walkthrough.mp4`, 2:05)");
  });

  it("leaves out chapters that were not recorded and never prints three blank lines", () => {
    const md = renderScript(chapters, entries, starts, 125_000, "2026-11-19");
    expect(md).not.toContain("Skipped");
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith("\n")).toBe(true);
  });
});
