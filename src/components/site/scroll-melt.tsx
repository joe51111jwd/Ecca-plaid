"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { buildGlyphAtlas, cappedDpr, drawGlyph, type GlyphAtlas, SITE_MONO_FONT, whenMonoFontReady } from "./glyph-atlas";
import {
  captionIndex,
  chipState,
  createMeltFrame,
  MELT_LEVELS,
  MELT_RAMP,
  MELT_STILL_PROGRESS,
  MELT_TIMELINE,
  type MeltFrame,
  meltGrid,
  renderMelt,
  RESULT_TEXT,
  sampleSheet,
  type SheetSample,
} from "./melt-core";
import { useReducedMotion } from "./use-reduced-motion";

/** The authored sheet (an original, clearly fictional sample). Its intrinsic size is 850 × 1100. */
export const SHEET_SRC = "/site/paperwork.svg";
const SHEET_ASPECT = 1100 / 850;

/** Glyph colours per tone (INK, BRAND, RED, HOT) and the scan/chip colours. Mirrors the tokens in site.css. */
const COLORS = {
  ink: "#121719",
  brand: "#174F60",
  red: "#A3271E",
  signal: "#FF4A1C",
  paper: "#F3F1EC",
} as const;

/** Cell width in CSS px, and height-to-width ratio of a cell. */
const CELL_WIDTH_DESKTOP = 6.4;
const CELL_WIDTH_MOBILE = 5;
const CELL_ASPECT = 1.62;

/** How quickly the drawn progress catches up with the scroll position (per second). Higher is stiffer. */
const FOLLOW_RATE = 9;

export interface ScrollMeltProps {
  /** Small mono label above the heading. */
  label: string;
  /** The section heading (rendered as an h2). */
  heading: ReactNode;
  /** Three captions, current one highlighted as the scan progresses. */
  captions: readonly [string, string, string];
  /** id for the heading, used for aria-labelledby. */
  headingId: string;
}

interface Geometry {
  width: number;
  height: number;
  dpr: number;
  sheetX: number;
  sheetY: number;
  sheetW: number;
  sheetH: number;
  cellW: number;
  cellH: number;
}

interface Prepared {
  geometry: Geometry;
  sheet: HTMLCanvasElement;
  sample: SheetSample;
  frame: MeltFrame;
  atlas: GlyphAtlas;
}

function computeGeometry(width: number, height: number, dpr: number): Geometry {
  const mobile = width < 560;
  const maxSheetH = height * (mobile ? 0.8 : 0.74);
  const maxSheetW = width * (mobile ? 0.94 : 0.86);
  let sheetW = Math.min(maxSheetW, maxSheetH / SHEET_ASPECT);
  let sheetH = sheetW * SHEET_ASPECT;
  sheetW = Math.max(1, Math.round(sheetW));
  sheetH = Math.max(1, Math.round(sheetH));
  const grid = meltGrid(sheetW, sheetH, mobile ? CELL_WIDTH_MOBILE : CELL_WIDTH_DESKTOP, CELL_ASPECT);
  return {
    width,
    height,
    dpr,
    sheetW,
    sheetH,
    sheetX: Math.round((width - sheetW) / 2),
    sheetY: Math.round(height * (mobile ? 0.03 : 0.06)),
    cellW: sheetW / Math.max(1, grid.cols),
    cellH: sheetH / Math.max(1, grid.rows),
  };
}

function prepare(image: HTMLImageElement, width: number, height: number): Prepared | null {
  const dpr = cappedDpr();
  const geometry = computeGeometry(width, height, dpr);
  const sheet = document.createElement("canvas");
  sheet.width = Math.round(geometry.sheetW * dpr);
  sheet.height = Math.round(geometry.sheetH * dpr);
  const sctx = sheet.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(image, 0, 0, sheet.width, sheet.height);
  const grid = meltGrid(geometry.sheetW, geometry.sheetH, geometry.cellW, CELL_ASPECT);
  const pixels = sctx.getImageData(0, 0, sheet.width, sheet.height);
  const sample = sampleSheet(pixels.data, sheet.width, sheet.height, grid.cols, grid.rows);
  const fontSize = geometry.cellH * 0.86;
  const atlas = buildGlyphAtlas({
    glyphs: MELT_RAMP,
    levels: MELT_LEVELS,
    colors: [COLORS.ink, COLORS.brand, COLORS.red, COLORS.signal],
    opacity: (level) => 0.18 + 0.82 * Math.pow(level / (MELT_LEVELS - 1), 1.1),
    cellWidth: geometry.cellW,
    cellHeight: geometry.cellH,
    fontSize,
    fontFamily: SITE_MONO_FONT,
    fontWeight: 500,
    dpr,
  });
  return { geometry, sheet, sample, frame: createMeltFrame(sample), atlas };
}

function drawScanLine(ctx: CanvasRenderingContext2D, g: Geometry, scan: number): void {
  if (scan <= 0 || scan >= 1) return;
  const d = g.dpr;
  const y = (g.sheetY + scan * g.sheetH) * d;
  const x0 = (g.sheetX - 14) * d;
  const w = (g.sheetW + 28) * d;
  const glow = ctx.createLinearGradient(0, y - 56 * d, 0, y);
  glow.addColorStop(0, "rgba(255, 74, 28, 0)");
  glow.addColorStop(1, "rgba(255, 74, 28, 0.28)");
  ctx.fillStyle = glow;
  ctx.fillRect(x0, y - 56 * d, w, 56 * d);
  ctx.fillStyle = COLORS.signal;
  ctx.fillRect(x0, y - 3 * d, w, 6 * d);
  ctx.fillStyle = "rgba(255, 236, 214, 0.9)";
  ctx.fillRect(x0, y - 0.5 * d, w, 1 * d);
}

function drawChip(ctx: CanvasRenderingContext2D, g: Geometry, p: number, forceResolved: boolean): void {
  const state = chipState(forceResolved ? 1 : p);
  if (state.progress <= 0) return;
  const d = g.dpr;
  const fontSize = Math.max(12, Math.min(19, g.sheetW / 24));
  ctx.font = `600 ${fontSize * d}px ${SITE_MONO_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const advance = ctx.measureText("M").width + fontSize * 0.16 * d;
  const n = state.chars.length;
  const padX = fontSize * 1.4 * d;
  const dot = fontSize * 0.9 * d;
  const boxW = n * advance + padX * 2 + dot * 1.6;
  const boxH = fontSize * 3 * d;
  const cx = (g.sheetX + g.sheetW / 2) * d;
  const cy = (g.sheetY + g.sheetH * 0.46) * d;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;
  const appear = Math.min(1, state.progress * 2.2);

  ctx.globalAlpha = appear;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.globalAlpha = 1;
  // The frame draws itself around the chip as it resolves.
  const perimeter = 2 * (boxW + boxH);
  ctx.save();
  ctx.lineWidth = 1.5 * d;
  ctx.strokeStyle = COLORS.ink;
  ctx.setLineDash([perimeter * state.progress, perimeter]);
  ctx.strokeRect(x, y, boxW, boxH);
  ctx.restore();

  ctx.globalAlpha = appear;
  ctx.fillStyle = COLORS.brand;
  ctx.fillRect(x + padX * 0.7, cy - dot / 2, dot, dot);
  ctx.globalAlpha = 1;
  const textX = x + padX * 0.7 + dot * 1.6 + advance / 2 + padX * 0.3;
  state.chars.forEach((ch, i) => {
    if (ch === " ") return;
    ctx.fillStyle = state.resolved[i] ? COLORS.ink : COLORS.signal;
    ctx.fillText(ch, textX + i * advance, cy);
  });
}

function drawFrame(ctx: CanvasRenderingContext2D, prepared: Prepared, p: number, still: boolean): void {
  const { geometry: g, sheet, sample, frame, atlas } = prepared;
  const d = g.dpr;
  renderMelt(sample, frame, p);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // The part of the sheet the scan line has not reached is still the picture.
  const scanPx = Math.round(frame.scan * sheet.height);
  if (scanPx < sheet.height) {
    ctx.drawImage(sheet, 0, scanPx, sheet.width, sheet.height - scanPx, Math.round(g.sheetX * d), Math.round(g.sheetY * d) + scanPx, sheet.width, sheet.height - scanPx);
  }

  const ox = g.sheetX * d;
  const oy = g.sheetY * d;
  const cw = g.cellW * d;
  const ch = g.cellH * d;
  const bottom = ctx.canvas.height;
  for (let r = 0; r < frame.rows; r++) {
    for (let c = 0; c < frame.cols; c++) {
      const k = r * frame.cols + c;
      const glyph = frame.glyph[k];
      if (glyph === 0) continue;
      const y = Math.round(oy + (r + frame.drop[k]) * ch);
      if (y > bottom) continue;
      drawGlyph(ctx, atlas, glyph, frame.level[k], frame.tone[k], Math.round(ox + c * cw), y);
    }
  }

  drawScanLine(ctx, g, frame.scan);
  drawChip(ctx, g, p, still);
}

/** Scroll progress through a tall section whose child is sticky: 0 when the child pins, 1 when it unpins. */
function sectionProgress(section: HTMLElement, pin: HTMLElement): number {
  const rect = section.getBoundingClientRect();
  const pinTop = Number.parseFloat(getComputedStyle(pin).top) || 0;
  const travel = rect.height - pin.offsetHeight;
  if (travel <= 0) return rect.top <= pinTop ? 1 : 0;
  return Math.min(1, Math.max(0, (pinTop - rect.top) / travel));
}

/**
 * The centerpiece: a sheet of paperwork pinned on screen while its tall section scrolls past. A scan line
 * turns it into glyphs, the glyphs drip away, and a single result chip resolves. Under reduced motion the
 * section is one screen tall and shows a single composed still.
 */
export function ScrollMelt({ label, heading, captions, headingId }: ScrollMeltProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [caption, setCaption] = useState<0 | 1 | 2>(0);
  const [progressPct, setProgressPct] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const pin = pinRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!section || !pin || !stage || !canvas || !ctx) return;
    let disposed = false;
    let raf = 0;
    let visible = false;
    let prepared: Prepared | null = null;
    let image: HTMLImageElement | null = null;
    let shown = reduced ? MELT_STILL_PROGRESS : sectionProgress(section, pin);
    let drawnAt = -1;
    let lastTime = 0;
    let lastCaption = -1;
    let lastPct = -1;

    const publish = (p: number) => {
      const idx = reduced ? 2 : captionIndex(p, MELT_TIMELINE);
      if (idx !== lastCaption) {
        lastCaption = idx;
        setCaption(idx);
      }
      const pct = reduced ? 100 : Math.round(p * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        setProgressPct(pct);
      }
    };

    const paint = (p: number) => {
      if (!prepared) return;
      drawFrame(ctx, prepared, p, reduced);
      drawnAt = p;
      publish(p);
    };

    const layout = () => {
      if (!image) return;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width < 2 || height < 2) return;
      const next = prepare(image, width, height);
      if (!next) return;
      prepared = next;
      canvas.width = Math.round(width * next.geometry.dpr);
      canvas.height = Math.round(height * next.geometry.dpr);
      paint(shown);
    };

    const tick = (now: number) => {
      raf = 0;
      if (disposed || !visible) return;
      const target = sectionProgress(section, pin);
      const dt = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;
      const follow = 1 - Math.exp(-FOLLOW_RATE * dt);
      shown += (target - shown) * follow;
      if (Math.abs(target - shown) < 0.0004) shown = target;
      if (shown !== drawnAt) paint(shown);
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible && !reduced && !raf) {
        lastTime = 0;
        raf = requestAnimationFrame(tick);
      }
    });
    const resize = new ResizeObserver(() => layout());

    const img = new Image();
    img.decoding = "async";
    img.src = SHEET_SRC;
    void Promise.all([img.decode(), whenMonoFontReady()])
      .then(() => {
        if (disposed) return;
        image = img;
        layout();
        resize.observe(stage);
        if (!reduced) io.observe(section);
        canvas.dataset.ready = "true";
      })
      .catch(() => {
        // The sheet failed to load: the section still reads correctly without the picture.
        canvas.dataset.ready = "error";
      });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      resize.disconnect();
    };
  }, [reduced]);

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="site-melt" data-still={reduced ? "true" : undefined}>
      <div ref={pinRef} className="site-melt__pin">
        <div className="site-melt__text">
          <p className="site-label">{label}</p>
          <h2 id={headingId} className="site-h2">
            {heading}
          </h2>
          <ol className="site-melt__steps">
            {captions.map((text, i) => (
              <li key={text} className="site-melt__step" data-active={i === caption ? "true" : undefined} aria-current={i === caption ? "step" : undefined}>
                <span className="site-melt__step-no" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {text}
              </li>
            ))}
          </ol>
          <div className="site-melt__meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${progressPct / 100})` }} />
          </div>
        </div>
        <div ref={stageRef} className="site-melt__stage">
          <canvas ref={canvasRef} aria-hidden="true" className="site-melt__canvas" />
          <p className="site-sr-only">
            A sample sheet of paperwork is scanned and dissolves into a single result: {RESULT_TEXT.replace(" · ", ", ").toLowerCase()}.
          </p>
        </div>
      </div>
    </section>
  );
}
