import { describe, expect, it } from "vitest";
import {
  captionIndex,
  chipState,
  clampProgress,
  createMeltFrame,
  isFrameEmpty,
  MELT_LEVELS,
  MELT_MAX_COLS,
  MELT_MAX_ROWS,
  MELT_RAMP,
  MELT_STILL_PROGRESS,
  MELT_TIMELINE,
  meltGrid,
  meltToLines,
  renderMelt,
  RESULT_TEXT,
  sampleSheet,
  scanPosition,
  type SheetSample,
  TONE,
  validateTimeline,
} from "./melt-core";

/** Synthetic test sheet: a dark band on top, a mid-grey block, paper elsewhere, one red and one teal patch. */
function syntheticSheet(cols = 40, rows = 60): SheetSample {
  const ink = new Float32Array(cols * rows);
  const tone = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (r < 6) ink[k] = 1;
      else if (r >= 20 && r < 40 && c >= 10 && c < 30) ink[k] = 0.5;
      if (r === 50 && c < 5) {
        ink[k] = 0.8;
        tone[k] = TONE.RED;
      }
      if (r === 52 && c < 5) {
        ink[k] = 0.8;
        tone[k] = TONE.BRAND;
      }
    }
  }
  return { cols, rows, ink, tone };
}

function countGlyphs(sample: SheetSample, p: number): number {
  const frame = renderMelt(sample, createMeltFrame(sample), p);
  let n = 0;
  for (const g of frame.glyph) if (g !== 0) n++;
  return n;
}

describe("glyph ramp", () => {
  it("uses only characters from the subject matter, with no duplicates", () => {
    expect(new Set(MELT_RAMP).size).toBe(Array.from(MELT_RAMP).length);
    for (const ch of MELT_RAMP) expect("$§%0123456789F/[]{}<>+~-:.").toContain(ch);
  });
});

describe("timeline", () => {
  it("accepts the shipped timeline and orders its acts", () => {
    expect(() => validateTimeline(MELT_TIMELINE)).not.toThrow();
    expect(MELT_TIMELINE.scanStart).toBeLessThan(MELT_TIMELINE.scanEnd);
    expect(MELT_TIMELINE.chipStart).toBeLessThan(MELT_TIMELINE.chipEnd);
    // Every column has finished falling by the end of the scroll.
    expect(MELT_TIMELINE.meltStart + MELT_TIMELINE.meltSpread + MELT_TIMELINE.fallDuration).toBeLessThanOrEqual(1);
  });

  it("rejects out-of-order or out-of-range timelines", () => {
    expect(() => validateTimeline({ ...MELT_TIMELINE, scanEnd: 0.01 })).toThrow(RangeError);
    expect(() => validateTimeline({ ...MELT_TIMELINE, chipEnd: 0.1 })).toThrow(RangeError);
    expect(() => validateTimeline({ ...MELT_TIMELINE, fallDuration: 0 })).toThrow(RangeError);
    expect(() => validateTimeline({ ...MELT_TIMELINE, chipEnd: 1.5 })).toThrow(RangeError);
    expect(() => validateTimeline({ ...MELT_TIMELINE, meltStart: Number.NaN })).toThrow(RangeError);
  });

  it("clamps progress, including NaN and infinities", () => {
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampProgress(0.4)).toBe(0.4);
  });

  it("moves the scan line linearly from top to bottom", () => {
    expect(scanPosition(0)).toBe(0);
    expect(scanPosition(MELT_TIMELINE.scanStart)).toBe(0);
    expect(scanPosition((MELT_TIMELINE.scanStart + MELT_TIMELINE.scanEnd) / 2)).toBeCloseTo(0.5, 10);
    expect(scanPosition(MELT_TIMELINE.scanEnd)).toBe(1);
    expect(scanPosition(1)).toBe(1);
  });

  it("swaps the captions at the melt and chip boundaries", () => {
    expect(captionIndex(0)).toBe(0);
    expect(captionIndex(MELT_TIMELINE.meltStart - 0.001)).toBe(0);
    expect(captionIndex(MELT_TIMELINE.meltStart)).toBe(1);
    expect(captionIndex(MELT_TIMELINE.chipStart)).toBe(2);
    expect(captionIndex(1)).toBe(2);
    expect(captionIndex(Number.NaN)).toBe(0);
  });
});

describe("meltGrid", () => {
  it("fits whole cells and keeps the cell aspect", () => {
    const g = meltGrid(500, 650, 5, 1.6);
    expect(g.cols).toBe(100);
    expect(g.rows).toBe(Math.round(650 / 8));
  });

  it("returns an empty grid for bad measurements", () => {
    expect(meltGrid(0, 100, 5, 1.6)).toEqual({ cols: 0, rows: 0 });
    expect(meltGrid(100, Number.NaN, 5, 1.6)).toEqual({ cols: 0, rows: 0 });
    expect(meltGrid(100, 100, -1, 1.6)).toEqual({ cols: 0, rows: 0 });
  });

  it("clamps absurd sizes to the ceilings", () => {
    const g = meltGrid(1e7, 1e7, 1, 1);
    expect(g.cols).toBe(MELT_MAX_COLS);
    expect(g.rows).toBeLessThanOrEqual(MELT_MAX_ROWS);
  });
});

describe("sampleSheet", () => {
  function bitmap(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
    return data;
  }

  it("maps black to full ink, paper and transparency to none", () => {
    const data = bitmap(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : x === 2 ? [245, 242, 234, 255] : [0, 0, 0, 0]));
    const s = sampleSheet(data, 4, 2, 4, 1);
    expect(s.ink[0]).toBeCloseTo(1, 5);
    expect(s.ink[2]).toBe(0);
    expect(s.ink[3]).toBe(0);
  });

  it("averages blocks so a half-black cell is mid-grey", () => {
    const data = bitmap(4, 4, (x) => (x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const s = sampleSheet(data, 4, 4, 2, 2);
    for (const v of s.ink) expect(v).toBeGreaterThan(0.3);
    for (const v of s.ink) expect(v).toBeLessThan(0.8);
  });

  it("classifies red and teal ink", () => {
    const data = bitmap(3, 1, (x) => (x === 0 ? [163, 39, 30, 255] : x === 1 ? [23, 79, 96, 255] : [30, 30, 30, 255]));
    const s = sampleSheet(data, 3, 1, 3, 1);
    expect(Array.from(s.tone)).toEqual([TONE.RED, TONE.BRAND, TONE.INK]);
  });

  it("rejects a bitmap smaller than its stated size, and tolerates empty grids", () => {
    expect(() => sampleSheet(new Uint8ClampedArray(4), 2, 2, 1, 1)).toThrow(RangeError);
    expect(sampleSheet(new Uint8ClampedArray(0), 0, 0, 3, 3).ink.every((v) => v === 0)).toBe(true);
    expect(sampleSheet(new Uint8ClampedArray(16), 2, 2, 0, 0).cols).toBe(0);
  });
});

describe("renderMelt", () => {
  const sheet = syntheticSheet();

  it("draws nothing before the scan starts (the picture is still intact)", () => {
    const frame = renderMelt(sheet, createMeltFrame(sheet), 0);
    expect(frame.scan).toBe(0);
    expect(isFrameEmpty(frame)).toBe(true);
  });

  it("only turns cells above the scan line into glyphs", () => {
    const p = MELT_TIMELINE.scanStart + (MELT_TIMELINE.scanEnd - MELT_TIMELINE.scanStart) * 0.5;
    const frame = renderMelt(sheet, createMeltFrame(sheet), p);
    for (let r = 0; r < sheet.rows; r++) {
      const y = r / (sheet.rows - 1);
      for (let c = 0; c < sheet.cols; c++) {
        if (y >= frame.scan) expect(frame.glyph[r * sheet.cols + c]).toBe(0);
      }
    }
    // The solid band on top is fully converted.
    for (let c = 0; c < sheet.cols; c++) expect(frame.glyph[c]).not.toBe(0);
  });

  it("keeps the shading: dark cells get denser glyphs than mid-grey cells", () => {
    const frame = renderMelt(sheet, createMeltFrame(sheet), MELT_TIMELINE.scanEnd);
    const avg = (r0: number, r1: number, c0: number, c1: number) => {
      let sum = 0;
      let n = 0;
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++) {
          const g = frame.glyph[r * sheet.cols + c];
          if (g) {
            sum += g;
            n++;
          }
        }
      return sum / n;
    };
    expect(avg(0, 6, 0, 40)).toBeLessThan(avg(20, 40, 10, 30));
  });

  it("marks the band just behind the scan line as hot, and nothing hot once the scan is done", () => {
    const mid = renderMelt(sheet, createMeltFrame(sheet), (MELT_TIMELINE.scanStart + MELT_TIMELINE.scanEnd) / 2);
    expect(Array.from(mid.tone).includes(TONE.HOT)).toBe(true);
    const done = renderMelt(sheet, createMeltFrame(sheet), MELT_TIMELINE.scanEnd + 0.001);
    expect(Array.from(done.tone).includes(TONE.HOT)).toBe(false);
  });

  it("carries the sheet's colour families into the glyphs", () => {
    const frame = renderMelt(sheet, createMeltFrame(sheet), MELT_TIMELINE.scanEnd + 0.001);
    expect(frame.tone[50 * sheet.cols]).toBe(TONE.RED);
    expect(frame.tone[52 * sheet.cols]).toBe(TONE.BRAND);
  });

  it("drips: cells fall, lower cells fall farther, and the glyph count thins out", () => {
    const before = countGlyphs(sheet, MELT_TIMELINE.scanEnd);
    const during = countGlyphs(sheet, MELT_TIMELINE.meltStart + MELT_TIMELINE.meltSpread + MELT_TIMELINE.fallDuration * 0.5);
    expect(during).toBeLessThan(before);

    const frame = renderMelt(sheet, createMeltFrame(sheet), 0.62);
    let falling = 0;
    for (const d of frame.drop) if (d > 0) falling++;
    expect(falling).toBeGreaterThan(0);
    // Within one column, every surviving lower cell sits farther down than the cells above it (stretching).
    for (let c = 0; c < sheet.cols; c++) {
      let lastY = -Infinity;
      for (let r = 0; r < sheet.rows; r++) {
        const k = r * sheet.cols + c;
        if (!frame.glyph[k]) continue;
        const y = r + frame.drop[k];
        expect(y).toBeGreaterThan(lastY);
        lastY = y;
      }
    }
  });

  it("columns let go at different moments", () => {
    const frame = renderMelt(sheet, createMeltFrame(sheet), MELT_TIMELINE.meltStart + MELT_TIMELINE.meltSpread * 0.5);
    const topDrops = new Set<number>();
    for (let c = 0; c < sheet.cols; c++) topDrops.add(Math.round(frame.drop[c] * 10));
    expect(topDrops.size).toBeGreaterThan(3);
  });

  it("is empty at the end of the scroll, so only the result chip remains", () => {
    expect(isFrameEmpty(renderMelt(sheet, createMeltFrame(sheet), 1))).toBe(true);
  });

  it("is deterministic and reversible (a pure function of progress)", () => {
    const a = meltToLines(renderMelt(sheet, createMeltFrame(sheet), 0.55), 40);
    const frame = createMeltFrame(sheet);
    renderMelt(sheet, frame, 0.95);
    renderMelt(sheet, frame, 0.55);
    expect(meltToLines(frame, 40)).toEqual(a);
  });

  it("changes with the seed", () => {
    const a = meltToLines(renderMelt(sheet, createMeltFrame(sheet), 0.6, 1));
    const b = meltToLines(renderMelt(sheet, createMeltFrame(sheet), 0.6, 2));
    expect(a).not.toEqual(b);
  });

  it("keeps every level and glyph code in range", () => {
    for (const p of [0.1, 0.3, 0.45, 0.6, 0.8]) {
      const frame = renderMelt(sheet, createMeltFrame(sheet), p);
      for (let i = 0; i < frame.glyph.length; i++) {
        expect(frame.glyph[i]).toBeLessThanOrEqual(MELT_RAMP.length);
        expect(frame.level[i]).toBeLessThan(MELT_LEVELS);
        expect(frame.glyph[i] === 0).toBe(frame.level[i] === 0);
      }
    }
  });

  it("composes a still for reduced motion with the sheet scanned and partly melted", () => {
    const frame = renderMelt(sheet, createMeltFrame(sheet), MELT_STILL_PROGRESS);
    expect(frame.scan).toBe(1);
    expect(isFrameEmpty(frame)).toBe(false);
  });

  it("rejects a frame of the wrong size and handles an empty sheet", () => {
    expect(() => renderMelt(sheet, createMeltFrame({ cols: 3, rows: 3 }), 0.5)).toThrow(RangeError);
    const empty: SheetSample = { cols: 0, rows: 0, ink: new Float32Array(0), tone: new Uint8Array(0) };
    expect(isFrameEmpty(renderMelt(empty, createMeltFrame(empty), 0.5))).toBe(true);
  });
});

describe("chipState", () => {
  it("is blank before it starts", () => {
    const s = chipState(MELT_TIMELINE.chipStart - 0.01);
    expect(s.progress).toBe(0);
    expect(s.chars.join("").trim()).toBe("");
  });

  it("scrambles while resolving and never shows a wrong final letter as resolved", () => {
    const s = chipState((MELT_TIMELINE.chipStart + MELT_TIMELINE.chipEnd) / 2);
    expect(s.progress).toBeGreaterThan(0);
    expect(s.progress).toBeLessThan(1);
    const letters = Array.from(RESULT_TEXT);
    s.chars.forEach((ch, i) => {
      if (s.resolved[i]) expect(ch).toBe(letters[i]);
    });
    expect(s.resolved.some((r) => !r)).toBe(true);
  });

  it("reads the full result by chipEnd and stays resolved", () => {
    for (const p of [MELT_TIMELINE.chipEnd, 0.95, 1]) {
      const s = chipState(p);
      expect(s.chars.join("")).toBe(RESULT_TEXT);
      expect(s.resolved.every(Boolean)).toBe(true);
      expect(s.progress).toBe(1);
    }
  });

  it("reveals characters left to right", () => {
    const s = chipState(MELT_TIMELINE.chipStart + (MELT_TIMELINE.chipEnd - MELT_TIMELINE.chipStart) * 0.2);
    const firstBlank = s.chars.findIndex((c) => c === " ");
    expect(firstBlank).toBeGreaterThan(0);
    expect(s.chars.slice(firstBlank).every((c) => c === " ")).toBe(true);
  });

  it("handles empty text", () => {
    expect(chipState(1, "").chars).toEqual([]);
  });
});
