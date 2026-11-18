/**
 * Pre-rendered glyph tiles for the two ASCII canvases. Drawing thousands of `fillText` calls per frame is
 * slow; copying a tile from an atlas with `drawImage` is cheap. Browser-only (uses a canvas element).
 */

export interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  /** Tile size in device pixels. */
  tileWidth: number;
  tileHeight: number;
  /** Number of ink levels per tone (level 0 is never drawn but keeps indexing simple). */
  levels: number;
}

export interface GlyphAtlasOptions {
  /** Glyphs in table order; glyph code 1 is glyphs[0]. */
  glyphs: string;
  levels: number;
  /** One CSS colour per tone. */
  colors: readonly string[];
  /** Opacity for an ink level 1..levels-1. */
  opacity: (level: number) => number;
  /** Cell size in CSS pixels. */
  cellWidth: number;
  cellHeight: number;
  /** Font size in CSS pixels. */
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  /** Device pixel ratio (already capped by the caller). */
  dpr: number;
}

/** Monospace stack used by both canvases; the variable font is loaded by the site shell. */
export const SITE_MONO_FONT = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "DejaVu Sans Mono", monospace';

export function buildGlyphAtlas(options: GlyphAtlasOptions): GlyphAtlas {
  const { glyphs, levels, colors, opacity, cellWidth, cellHeight, fontSize, fontFamily, dpr } = options;
  const tileWidth = Math.max(1, Math.ceil(cellWidth * dpr));
  const tileHeight = Math.max(1, Math.ceil(cellHeight * dpr));
  const glyphList = Array.from(glyphs);
  const canvas = document.createElement("canvas");
  canvas.width = tileWidth * Math.max(1, glyphList.length);
  canvas.height = tileHeight * Math.max(1, colors.length * levels);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, tileWidth, tileHeight, levels };
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${options.fontWeight ?? 400} ${fontSize * dpr}px ${fontFamily}`;
  colors.forEach((color, tone) => {
    ctx.fillStyle = color;
    for (let level = 1; level < levels; level++) {
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity(level)));
      const y = (tone * levels + level) * tileHeight + tileHeight / 2;
      glyphList.forEach((glyph, g) => {
        ctx.fillText(glyph, g * tileWidth + tileWidth / 2, y);
      });
    }
  });
  ctx.globalAlpha = 1;
  return { canvas, tileWidth, tileHeight, levels };
}

/** Copy one tile to (x, y) in device pixels. `glyph` is a 1-based code; 0 draws nothing. */
export function drawGlyph(ctx: CanvasRenderingContext2D, atlas: GlyphAtlas, glyph: number, level: number, tone: number, x: number, y: number): void {
  if (glyph === 0 || level === 0) return;
  const { tileWidth: w, tileHeight: h } = atlas;
  ctx.drawImage(atlas.canvas, (glyph - 1) * w, (tone * atlas.levels + level) * h, w, h, x, y, w, h);
}

/** Device pixel ratio, capped so a 3× phone does not triple the canvas work. */
export function cappedDpr(max = 2): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.max(1, Math.min(max, dpr));
}

/** Wait for the mono font so the atlas is not drawn in a fallback face; never blocks longer than `timeoutMs`. */
export async function whenMonoFontReady(timeoutMs = 1500): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const load = document.fonts.load(`400 16px "JetBrains Mono Variable"`, "$§%25F").then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([load.catch(() => undefined), timeout]);
}
