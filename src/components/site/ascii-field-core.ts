/**
 * Pure model of the hero's ASCII field: which glyph sits in each cell of a character grid, and how
 * strongly it is inked, at a given moment. No DOM and no clock — the canvas renderer (ascii-field.tsx)
 * passes in the grid and the elapsed time, so every frame is reproducible and testable.
 *
 * The picture: horizontal bands of glyphs whose edges ripple as slow sine waves, dense at the top and
 * thinning to nothing toward the bottom, where the headline sits. The glyphs are drawn from the subject
 * matter — dollar and section signs, percent, the digits and letter of "25F", brackets.
 */

/** Glyph families from the top band to the bottom band. Repeats weight the pick toward a character. */
export const FIELD_BANDS: readonly string[] = [
  "$$$$$$§$0",
  "$$$/%$§%8",
  "%/25F/%09",
  "[]{}25F1/",
  "[]{}<>+7-",
  "-+<>~.:",
  "$.:~-",
] as const;

/** Every glyph that can appear, deduplicated. Frame cells store `index + 1` into this table (0 = blank). */
export const FIELD_GLYPHS: string = Array.from(new Set(FIELD_BANDS.join(""))).join("");

/** Number of ink levels a frame uses. Level 0 is "not drawn"; the renderer maps 1..N-1 to opacities. */
export const FIELD_LEVELS = 8;

/** Hard ceiling on grid size so a huge or bogus measurement cannot allocate an unbounded frame. */
export const FIELD_MAX_COLS = 400;
export const FIELD_MAX_ROWS = 200;

export interface FieldGrid {
  cols: number;
  rows: number;
}

export interface FieldOptions {
  /** Changes the layout of the field; the same seed always draws the same field. */
  seed: number;
  /** Fraction of the height (0..1) where the fade toward blank begins. */
  fadeStart: number;
  /** Fraction of the height (0..1) at and below which nothing is drawn. */
  fadeEnd: number;
  /** How fast the band edges drift, in radians of wave phase per second. */
  drift: number;
  /** How often an individual cell swaps its glyph, in swaps per second (on average). */
  flicker: number;
}

export const DEFAULT_FIELD_OPTIONS: FieldOptions = {
  seed: 25,
  fadeStart: 0.42,
  fadeEnd: 0.97,
  drift: 0.22,
  flicker: 0.35,
};

export interface FieldFrame {
  cols: number;
  rows: number;
  /** Row-major; 0 = blank, otherwise 1 + index into FIELD_GLYPHS. */
  glyphs: Uint8Array;
  /** Row-major ink level, 0..FIELD_LEVELS-1 (0 exactly when the glyph is blank). */
  levels: Uint8Array;
}

/** Integer grid that fits a box, clamped to the frame ceiling. Non-finite or non-positive input gives 0×0. */
export function gridFor(width: number, height: number, cellWidth: number, cellHeight: number): FieldGrid {
  if (![width, height, cellWidth, cellHeight].every((n) => Number.isFinite(n) && n > 0)) return { cols: 0, rows: 0 };
  return {
    cols: Math.min(FIELD_MAX_COLS, Math.ceil(width / cellWidth)),
    rows: Math.min(FIELD_MAX_ROWS, Math.ceil(height / cellHeight)),
  };
}

/** 32-bit integer hash of up to four integers (a small avalanche mix; stable across platforms). */
function hash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ Math.imul(d | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Hash mapped to [0, 1). */
function unit(a: number, b: number, c: number, d: number): number {
  return hash(a, b, c, d) / 4294967296;
}

function clampUnit(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Reject options that would make the picture meaningless rather than silently drawing garbage. */
function validate(options: FieldOptions): void {
  const { fadeStart, fadeEnd, drift, flicker, seed } = options;
  if (!Number.isFinite(seed)) throw new RangeError("seed must be a finite number");
  if (!(fadeStart >= 0 && fadeStart < fadeEnd && fadeEnd <= 1)) throw new RangeError("need 0 <= fadeStart < fadeEnd <= 1");
  if (!(Number.isFinite(drift) && drift >= 0)) throw new RangeError("drift must be >= 0");
  if (!(Number.isFinite(flicker) && flicker >= 0)) throw new RangeError("flicker must be >= 0");
}

/** An empty frame of the given size (reuse it across renders to avoid per-frame allocation). */
export function createFrame(grid: FieldGrid): FieldFrame {
  const cols = Math.max(0, Math.min(FIELD_MAX_COLS, Math.floor(grid.cols)));
  const rows = Math.max(0, Math.min(FIELD_MAX_ROWS, Math.floor(grid.rows)));
  return { cols, rows, glyphs: new Uint8Array(cols * rows), levels: new Uint8Array(cols * rows) };
}

const GLYPH_INDEX: ReadonlyMap<string, number> = new Map(Array.from(FIELD_GLYPHS).map((g, i) => [g, i + 1]));
const BAND_CODES: readonly Uint8Array[] = FIELD_BANDS.map((band) => Uint8Array.from(Array.from(band), (g) => GLYPH_INDEX.get(g) ?? 0));

/**
 * Fill `frame` with the field at `timeSeconds`. Pass the same frame every tick; it is overwritten in place
 * and returned. Deterministic: identical (grid, time, options) always yields identical cells.
 */
export function renderField(frame: FieldFrame, timeSeconds: number, options: FieldOptions = DEFAULT_FIELD_OPTIONS): FieldFrame {
  validate(options);
  const { cols, rows, glyphs, levels } = frame;
  if (cols === 0 || rows === 0) return frame;
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const seed = Math.trunc(options.seed);
  const bandCount = BAND_CODES.length;
  // Seeded wave phases, so different seeds draw different ripples.
  const p1 = unit(seed, 1, 0, 0) * Math.PI * 2;
  const p2 = unit(seed, 2, 0, 0) * Math.PI * 2;
  const p3 = unit(seed, 3, 0, 0) * Math.PI * 2;
  const phase = t * options.drift;
  const span = options.fadeEnd - options.fadeStart;

  for (let c = 0; c < cols; c++) {
    // Measure x in a fixed unit (cells / 160) so the ripple keeps its shape as the canvas widens.
    const x = c / 160;
    const ripple =
      0.07 * Math.sin(x * 5.1 + phase + p1) + 0.045 * Math.sin(x * 11.3 - phase * 1.7 + p2) + 0.02 * Math.sin(x * 23.0 + phase * 0.6 + p3);
    const edgeJitter = (unit(seed, c, 7, 0) - 0.5) * 0.018;
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      const y = rows === 1 ? 0 : r / (rows - 1);
      if (y >= options.fadeEnd) {
        glyphs[i] = 0;
        levels[i] = 0;
        continue;
      }
      // How "alive" this row is: 1 above the fade, falling to 0 at fadeEnd.
      const life = y <= options.fadeStart ? 1 : 1 - (y - options.fadeStart) / span;
      // Cells thin out stochastically (seeded) as life drops, which reads as dissolving rather than dimming.
      const keep = unit(seed, c, r, 11);
      if (keep > life * life * 1.05 + 0.02) {
        glyphs[i] = 0;
        levels[i] = 0;
        continue;
      }
      const w = clampUnit(y * 1.08 + ripple + edgeJitter);
      const band = Math.min(bandCount - 1, Math.floor(w * bandCount));
      const codes = BAND_CODES[band];
      // Each cell swaps glyph on its own schedule (staggered by a per-cell offset) so the field shimmers.
      const tick = Math.floor(t * options.flicker + unit(seed, c, r, 23) * 8);
      const code = codes[hash(seed, c, r, tick) % codes.length];
      glyphs[i] = code;
      const ink = life * (0.72 + 0.28 * unit(seed, c, r, 31));
      levels[i] = code === 0 ? 0 : Math.max(1, Math.min(FIELD_LEVELS - 1, Math.round(ink * (FIELD_LEVELS - 1))));
    }
  }
  return frame;
}

/** The frame as text lines (blank cells as spaces). Used by tests and for debugging the picture. */
export function frameToLines(frame: FieldFrame): string[] {
  const lines: string[] = [];
  for (let r = 0; r < frame.rows; r++) {
    let line = "";
    for (let c = 0; c < frame.cols; c++) {
      const code = frame.glyphs[r * frame.cols + c];
      line += code === 0 ? " " : FIELD_GLYPHS[code - 1];
    }
    lines.push(line);
  }
  return lines;
}
