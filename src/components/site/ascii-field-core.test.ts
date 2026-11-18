import { describe, expect, it } from "vitest";
import { createFrame, DEFAULT_FIELD_OPTIONS, FIELD_GLYPHS, FIELD_LEVELS, FIELD_MAX_COLS, FIELD_MAX_ROWS, frameToLines, gridFor, renderField } from "./ascii-field-core";

describe("FIELD_GLYPHS", () => {
  it("draws only from the site's glyph family", () => {
    for (const ch of FIELD_GLYPHS) expect("$§%0123456789F/[]{}<>+~-:.").toContain(ch);
  });
});

describe("gridFor", () => {
  it("covers the box with whole cells", () => {
    expect(gridFor(100, 50, 10, 20)).toEqual({ cols: 10, rows: 3 });
  });
  it("returns 0×0 for invalid input and clamps huge boxes", () => {
    expect(gridFor(-1, 50, 10, 20)).toEqual({ cols: 0, rows: 0 });
    expect(gridFor(100, Number.NaN, 10, 20)).toEqual({ cols: 0, rows: 0 });
    expect(gridFor(1e9, 1e9, 1, 1)).toEqual({ cols: FIELD_MAX_COLS, rows: FIELD_MAX_ROWS });
  });
});

describe("renderField", () => {
  const grid = { cols: 120, rows: 40 };

  it("is dense at the top and blank at the bottom (fades toward the headline)", () => {
    const lines = frameToLines(renderField(createFrame(grid), 0));
    const density = (line: string) => line.replace(/ /g, "").length / line.length;
    expect(density(lines[0])).toBeGreaterThan(0.9);
    expect(density(lines[lines.length - 1])).toBe(0);
    const topHalf = lines.slice(0, 20).join("").replace(/ /g, "").length;
    const bottomHalf = lines.slice(20).join("").replace(/ /g, "").length;
    expect(topHalf).toBeGreaterThan(bottomHalf * 2);
  });

  it("is deterministic for the same time, and drifts over time", () => {
    const a = frameToLines(renderField(createFrame(grid), 3));
    const b = frameToLines(renderField(createFrame(grid), 3));
    const c = frameToLines(renderField(createFrame(grid), 40));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("keeps levels in range and zero exactly when blank", () => {
    const f = renderField(createFrame(grid), 12.5);
    for (let i = 0; i < f.glyphs.length; i++) {
      expect(f.levels[i]).toBeLessThan(FIELD_LEVELS);
      expect(f.glyphs[i] === 0).toBe(f.levels[i] === 0);
      expect(f.glyphs[i]).toBeLessThanOrEqual(Array.from(FIELD_GLYPHS).length);
    }
  });

  it("treats a non-finite time as zero", () => {
    expect(frameToLines(renderField(createFrame(grid), Number.NaN))).toEqual(frameToLines(renderField(createFrame(grid), 0)));
  });

  it("rejects nonsensical options", () => {
    expect(() => renderField(createFrame(grid), 0, { ...DEFAULT_FIELD_OPTIONS, fadeStart: 0.9, fadeEnd: 0.5 })).toThrow(RangeError);
    expect(() => renderField(createFrame(grid), 0, { ...DEFAULT_FIELD_OPTIONS, drift: -1 })).toThrow(RangeError);
    expect(() => renderField(createFrame(grid), 0, { ...DEFAULT_FIELD_OPTIONS, seed: Number.NaN })).toThrow(RangeError);
  });

  it("handles an empty grid", () => {
    expect(frameToLines(renderField(createFrame({ cols: 0, rows: 0 }), 1))).toEqual([]);
  });
});
