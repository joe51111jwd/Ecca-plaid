/**
 * Pure model of the scroll-melt centerpiece. A sheet of paperwork is sampled into a character grid; a
 * scan line travels down it; cells the line has passed become glyphs that keep the sheet's shading; the
 * glyph columns then loosen and drip off the page, thinning as they fall; finally one result chip resolves
 * out of scrambled glyphs.
 *
 * Everything here is a function of scroll progress `p` in [0, 1] (never of wall-clock time), so scrolling
 * backwards un-melts the sheet exactly and every frame is reproducible in tests. The canvas renderer
 * (melt.tsx) owns the DOM, sizing and drawing.
 */

/** Glyphs from densest (most ink) to lightest. Characters from the subject: dollars, sections, "25F", brackets. */
export const MELT_RAMP = "$§%80529F3{}[]/<>+~-:.";

/** Ink levels; level 0 means "not drawn". The renderer maps 1..LEVELS-1 to opacities. */
export const MELT_LEVELS = 8;

/** Colour families a glyph can carry. HOT marks cells the scan line has only just passed. */
export const TONE = { INK: 0, BRAND: 1, RED: 2, HOT: 3 } as const;
export type Tone = (typeof TONE)[keyof typeof TONE];

/** Hard ceilings, so a bogus measurement cannot allocate an unbounded grid. */
export const MELT_MAX_COLS = 220;
export const MELT_MAX_ROWS = 300;

/** The single line the drips resolve into. */
export const RESULT_TEXT = "ELIGIBLE · PROVISIONAL";

/**
 * Where each act happens along the scroll, as fractions of the sticky section's travel. Acts overlap a
 * little so the motion never stalls between them.
 */
export interface MeltTimeline {
  /** The scan line enters the top of the sheet. */
  scanStart: number;
  /** The scan line leaves the bottom of the sheet. */
  scanEnd: number;
  /** The first columns begin to drip. */
  meltStart: number;
  /** Spread of column start times after meltStart (columns let go at different moments). */
  meltSpread: number;
  /** Progress a column takes from letting go to having fallen and thinned to nothing. */
  fallDuration: number;
  /** The result chip begins to resolve. */
  chipStart: number;
  /** The result chip is fully resolved. */
  chipEnd: number;
}

export const MELT_TIMELINE: MeltTimeline = {
  scanStart: 0.04,
  scanEnd: 0.4,
  meltStart: 0.4,
  meltSpread: 0.26,
  fallDuration: 0.3,
  chipStart: 0.7,
  chipEnd: 0.88,
};

/** The progress used for the single still image shown under prefers-reduced-motion. */
export const MELT_STILL_PROGRESS = 0.52;

/** Thickness of the "just scanned" band, as a fraction of sheet height. */
const HOT_BAND = 0.035;

/** Sheet luminance treated as blank paper (the SVG's paper is a warm off-white). */
const PAPER_LUMINANCE = 0.9;

/** Darkness below which a cell counts as blank paper. */
const PAPER_THRESHOLD = 0.06;

/**
 * Fraction of blank-paper cells that keep a light glyph. High enough that the scanned sheet reads as one dense
 * block of type (the paper becomes a fine texture) rather than islands of ink, and that the drips stay full.
 */
const PAPER_DOT_RATE = 0.68;

/** Ink level of a paper glyph: light, but well clear of the faintest level so it holds up on the warm page. */
const PAPER_LEVEL = 2;

/** Light glyphs a paper cell can take (the tail of MELT_RAMP), so blank areas do not tile one character. */
const PAPER_GLYPHS = 3;

/** Darkness at which a cell reaches the densest glyph. Lower = more cells read as solid ink. */
const INK_FULL = 0.55;

/** Lightest ink level a cell with ink can have, so mid-tones stay legible in the scanned stage. */
const INK_MIN_LEVEL = 2;

export interface SheetSample {
  cols: number;
  rows: number;
  /** Row-major darkness 0 (paper) .. 1 (solid ink). */
  ink: Float32Array;
  /** Row-major colour family (TONE.INK, TONE.BRAND or TONE.RED). */
  tone: Uint8Array;
}

export interface MeltFrame {
  cols: number;
  rows: number;
  /** Row-major; 0 = nothing drawn, otherwise 1 + index into MELT_RAMP. */
  glyph: Uint8Array;
  /** Row-major ink level 0..MELT_LEVELS-1 (0 exactly when glyph is 0). */
  level: Uint8Array;
  /** Row-major TONE value. */
  tone: Uint8Array;
  /** Row-major downward displacement, in rows. */
  drop: Float32Array;
  /** Sheet fraction (0..1) the scan line has reached; cells at or below it are still the picture. */
  scan: number;
}

export interface ChipState {
  /** 0 before the chip starts, 1 once fully resolved. Drives the frame being drawn around the text. */
  progress: number;
  /** One entry per character of the text: " " not yet shown, a ramp glyph while scrambling, else the real char. */
  chars: string[];
  /** Per character: true once it shows its real letter. */
  resolved: boolean[];
}

/** 32-bit integer hash of up to four integers (stable across platforms). */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function unit(a: number, b: number, c: number, d: number): number {
  return hash4(a, b, c, d) / 4294967296;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Progress clamped to [0, 1]; NaN and infinities become 0 or 1 rather than poisoning the frame. */
export function clampProgress(p: number): number {
  if (Number.isNaN(p)) return 0;
  return clamp01(p);
}

/** Reject timelines whose acts are out of order or outside [0, 1]. */
export function validateTimeline(tl: MeltTimeline): void {
  const values = Object.values(tl);
  if (!values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new RangeError("timeline values must be in [0, 1]");
  if (!(tl.scanStart < tl.scanEnd)) throw new RangeError("scanStart must be before scanEnd");
  if (!(tl.chipStart < tl.chipEnd)) throw new RangeError("chipStart must be before chipEnd");
  if (!(tl.fallDuration > 0)) throw new RangeError("fallDuration must be > 0");
}

/** How far down the sheet (0..1) the scan line is at progress p. Linear: a scan moves at constant speed. */
export function scanPosition(p: number, tl: MeltTimeline = MELT_TIMELINE): number {
  return clamp01((clampProgress(p) - tl.scanStart) / (tl.scanEnd - tl.scanStart));
}

/** Which of the three captions is current: 0 reading the sheet, 1 checking the limit, 2 the answer. */
export function captionIndex(p: number, tl: MeltTimeline = MELT_TIMELINE): 0 | 1 | 2 {
  const q = clampProgress(p);
  if (q < tl.meltStart) return 0;
  if (q < tl.chipStart) return 1;
  return 2;
}

/** Integer grid for a sheet box at a target cell width, keeping the cell aspect, clamped to the ceilings. */
export function meltGrid(sheetWidth: number, sheetHeight: number, cellWidth: number, cellAspect: number): { cols: number; rows: number } {
  if (![sheetWidth, sheetHeight, cellWidth, cellAspect].every((n) => Number.isFinite(n) && n > 0)) return { cols: 0, rows: 0 };
  const cols = Math.max(1, Math.min(MELT_MAX_COLS, Math.round(sheetWidth / cellWidth)));
  const cellHeight = (sheetWidth / cols) * cellAspect;
  const rows = Math.max(1, Math.min(MELT_MAX_ROWS, Math.round(sheetHeight / cellHeight)));
  return { cols, rows };
}

/**
 * Average an RGBA bitmap into a cols×rows grid of darkness and colour family. `rgba` is row-major RGBA
 * bytes (ImageData.data). Transparent pixels count as paper.
 */
export function sampleSheet(rgba: ArrayLike<number>, width: number, height: number, cols: number, rows: number): SheetSample {
  const c = Math.max(0, Math.min(MELT_MAX_COLS, Math.floor(cols)));
  const r = Math.max(0, Math.min(MELT_MAX_ROWS, Math.floor(rows)));
  const ink = new Float32Array(c * r);
  const tone = new Uint8Array(c * r);
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (c === 0 || r === 0 || w <= 0 || h <= 0) return { cols: c, rows: r, ink, tone };
  if (rgba.length < w * h * 4) throw new RangeError("bitmap is smaller than width × height");

  for (let gy = 0; gy < r; gy++) {
    const y0 = Math.floor((gy * h) / r);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / r));
    for (let gx = 0; gx < c; gx++) {
      const x0 = Math.floor((gx * w) / c);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / c));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          const a = rgba[i + 3] / 255;
          // Composite over white so transparent regions read as paper.
          sr += rgba[i] * a + 255 * (1 - a);
          sg += rgba[i + 1] * a + 255 * (1 - a);
          sb += rgba[i + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const R = sr / n / 255;
      const G = sg / n / 255;
      const B = sb / n / 255;
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const darkness = clamp01((PAPER_LUMINANCE - lum) / (PAPER_LUMINANCE - 0.06));
      const k = gy * c + gx;
      // A mild gamma lifts mid-tones (hatching) so engraved areas read as texture, not blanks.
      ink[k] = Math.pow(darkness, 0.75);
      if (R - G > 0.14 && R - B > 0.14) tone[k] = TONE.RED;
      else if (B - R > 0.06 && G - R > 0.04) tone[k] = TONE.BRAND;
      else tone[k] = TONE.INK;
    }
  }
  return { cols: c, rows: r, ink, tone };
}

/** An empty frame matching a sample (reuse it every render to avoid per-frame allocation). */
export function createMeltFrame(sample: Pick<SheetSample, "cols" | "rows">): MeltFrame {
  const n = sample.cols * sample.rows;
  return { cols: sample.cols, rows: sample.rows, glyph: new Uint8Array(n), level: new Uint8Array(n), tone: new Uint8Array(n), drop: new Float32Array(n), scan: 0 };
}

const RAMP_LAST = MELT_RAMP.length - 1;

/** Smooth 1-D value noise over column index, so neighbouring columns tend to let go together (drips clump). */
function columnNoise(seed: number, c: number, scale: number): number {
  const x = c / scale;
  const i = Math.floor(x);
  const f = x - i;
  const a = unit(seed, i, 101, 0);
  const b = unit(seed, i + 1, 101, 0);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Clear one cell of a frame. */
function blank(frame: MeltFrame, k: number): void {
  frame.glyph[k] = 0;
  frame.level[k] = 0;
  frame.tone[k] = TONE.INK;
  frame.drop[k] = 0;
}

/**
 * Fill `frame` with the centerpiece at progress `p`. Deterministic for identical inputs.
 * `sample` and `frame` must have the same dimensions.
 *
 * The melt treats each glyph column as something viscous hanging from its top: once a column lets go it
 * slides down and stretches (lower cells travel farther, so the gaps between glyphs grow), and it sheds
 * whole runs of glyphs as it goes, which leaves streaks rather than an even dust. Neighbouring columns let
 * go at similar moments, so the drips come in clumps.
 */
export function renderMelt(sample: SheetSample, frame: MeltFrame, p: number, seed = 25, tl: MeltTimeline = MELT_TIMELINE): MeltFrame {
  validateTimeline(tl);
  if (sample.cols !== frame.cols || sample.rows !== frame.rows) throw new RangeError("frame does not match sample size");
  const { cols, rows } = sample;
  const q = clampProgress(p);
  const scan = scanPosition(q, tl);
  frame.scan = scan;
  if (cols === 0 || rows === 0) return frame;
  const s = Math.trunc(seed);
  // Scrambled glyphs in the hot band re-roll as the page scrolls, not on a timer.
  const scrambleTick = Math.floor(q * 900);

  for (let c = 0; c < cols; c++) {
    // Pushed toward the extremes so some stretches of the sheet hold while others have already run.
    const lag = 0.8 * smoothstep(0.15, 0.85, columnNoise(s, c, 7)) + 0.2 * unit(s, c, 3, 0);
    // A whole column lets go as one (so its glyphs never overtake each other), and never before the scan
    // line has left the sheet.
    const colStart = Math.max(tl.scanEnd + 0.01, tl.meltStart + tl.meltSpread * lag);
    // Columns slide at different speeds (clumped too); a few run noticeably faster.
    const speed = 0.55 + 0.8 * columnNoise(s + 1, c, 3) + 0.6 * Math.pow(unit(s, c, 9, 0), 5);
    // Length of the runs a column sheds as a unit: short runs read as dust, long ones as streaks.
    const run = 3 + Math.floor(unit(s, c, 11, 0) * 10);
    for (let r = 0; r < rows; r++) {
      const k = r * cols + c;
      const y = rows === 1 ? 0 : r / (rows - 1);
      if (y >= scan) {
        blank(frame, k);
        continue;
      }
      const ink = sample.ink[k];
      // Base glyph from the cell's shading, with a little per-cell variety so flat areas do not tile.
      let idx: number;
      let level: number;
      if (ink < PAPER_THRESHOLD) {
        if (unit(s, c, r, 13) >= PAPER_DOT_RATE) {
          blank(frame, k);
          continue;
        }
        idx = RAMP_LAST - Math.floor(unit(s, c, r, 19) * PAPER_GLYPHS);
        level = PAPER_LEVEL;
      } else {
        // A strong gamma pushes mid-tones toward the dense end: the sheet stays dark while it is glyphs.
        const t = Math.pow(clamp01((ink - PAPER_THRESHOLD) / INK_FULL), 0.55);
        const jitter = (unit(s, c, r, 17) - 0.5) * 2;
        idx = Math.round((1 - t) * (RAMP_LAST - PAPER_GLYPHS) + jitter);
        level = Math.round(INK_MIN_LEVEL + t * (MELT_LEVELS - 1 - INK_MIN_LEVEL));
      }
      let tone: number = sample.tone[k];

      const m = clamp01((q - colStart) / tl.fallDuration);

      let drop = 0;
      if (m > 0) {
        // Gravity: slow to let go, then accelerating.
        const e = 0.25 * m + 0.75 * m * m;
        const stretch = 1.9 * speed * e;
        const slide = rows * 0.9 * speed * e;
        drop = stretch * r + slide;
        // Hold together first, then shed whole runs, then single glyphs; everything is gone shortly before m
        // reaches 1. Glyphs keep most of their weight while they fall, so the drip reads as ink, not dust.
        const thin = smoothstep(0.32, 0.95, m);
        if (unit(s, c, Math.floor(r / run), 41) < thin || unit(s, c, r, 43) < smoothstep(0.7, 0.985, m)) {
          blank(frame, k);
          continue;
        }
        idx += Math.floor(m * 3);
        level = Math.max(1, Math.round(level * (1 - 0.18 * m)));
      }

      // Just-scanned cells glow in the scan colour and show scrambled glyphs, then settle.
      if (scan - y < HOT_BAND && scan < 1) {
        tone = TONE.HOT;
        idx = hash4(s, c * 131 + r, scrambleTick, 7) % MELT_RAMP.length;
        level = Math.max(level, MELT_LEVELS - 2);
      }

      frame.glyph[k] = 1 + Math.max(0, Math.min(RAMP_LAST, idx));
      frame.level[k] = Math.max(1, Math.min(MELT_LEVELS - 1, level));
      frame.tone[k] = tone;
      frame.drop[k] = drop;
    }
  }
  return frame;
}

/** True once every cell has fallen away (or before anything was scanned): nothing left to draw. */
export function isFrameEmpty(frame: MeltFrame): boolean {
  for (let i = 0; i < frame.glyph.length; i++) if (frame.glyph[i] !== 0) return false;
  return true;
}

/**
 * The result chip at progress p: characters appear left to right as scrambled glyphs, then each locks
 * into its real letter. Separators and spaces resolve immediately once shown.
 */
export function chipState(p: number, text: string = RESULT_TEXT, seed = 25, tl: MeltTimeline = MELT_TIMELINE): ChipState {
  validateTimeline(tl);
  const q = clampProgress(p);
  const span = tl.chipEnd - tl.chipStart;
  const letters = Array.from(text);
  const n = Math.max(1, letters.length);
  const scrambleTick = Math.floor(q * 700);
  const chars: string[] = [];
  const resolved: boolean[] = [];
  letters.forEach((ch, i) => {
    const appear = tl.chipStart + span * 0.5 * (i / n);
    const lock = appear + span * (0.2 + 0.3 * unit(seed, i, 61, 0));
    if (q < appear) {
      chars.push(" ");
      resolved.push(false);
    } else if (q >= lock || ch.trim() === "" || ch === "·") {
      chars.push(ch);
      resolved.push(true);
    } else {
      chars.push(MELT_RAMP[hash4(seed, i, scrambleTick, 3) % MELT_RAMP.length]);
      resolved.push(false);
    }
  });
  return { progress: clamp01((q - tl.chipStart) / span), chars, resolved };
}

/** The frame as text lines with drops applied (rounded to whole rows). For tests and debugging. */
export function meltToLines(frame: MeltFrame, extraRows = 0): string[] {
  const height = frame.rows + Math.max(0, Math.floor(extraRows));
  const grid: string[][] = Array.from({ length: height }, () => Array.from({ length: frame.cols }, () => " "));
  for (let r = 0; r < frame.rows; r++) {
    for (let c = 0; c < frame.cols; c++) {
      const k = r * frame.cols + c;
      const g = frame.glyph[k];
      if (g === 0) continue;
      const y = r + Math.round(frame.drop[k]);
      if (y >= 0 && y < height) grid[y][c] = MELT_RAMP[g - 1];
    }
  }
  return grid.map((row) => row.join(""));
}
