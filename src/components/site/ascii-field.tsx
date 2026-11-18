"use client";

import { useEffect, useRef } from "react";
import { createFrame, DEFAULT_FIELD_OPTIONS, FIELD_GLYPHS, FIELD_LEVELS, type FieldOptions, gridFor, renderField } from "./ascii-field-core";
import { buildGlyphAtlas, cappedDpr, drawGlyph, SITE_MONO_FONT, whenMonoFontReady } from "./glyph-atlas";
import { useReducedMotion } from "./use-reduced-motion";

export interface AsciiFieldProps {
  className?: string;
  /** Glyph colour (any CSS colour). Opacity comes from each cell's ink level. */
  color?: string;
  /** Opacity of the most strongly inked glyph; keeps the field quiet behind headlines. */
  maxOpacity?: number;
  options?: Partial<FieldOptions>;
}

/** Frames per second for the drift; the motion is slow, so a low rate looks identical and costs less. */
const FIELD_FPS = 24;

/**
 * Decorative animated field of ASCII glyphs that fills its positioned parent. Paused while off-screen or
 * in a background tab; drawn once and left still under prefers-reduced-motion. Hidden from assistive tech.
 */
export function AsciiField({ className, color = "#11181a", maxOpacity = 0.5, options }: AsciiFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const drift = options?.drift;
  const fadeStart = options?.fadeStart;
  const fadeEnd = options?.fadeEnd;
  const flicker = options?.flicker;
  const seed = options?.seed;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const opts: FieldOptions = {
      ...DEFAULT_FIELD_OPTIONS,
      ...(drift === undefined ? {} : { drift }),
      ...(fadeStart === undefined ? {} : { fadeStart }),
      ...(fadeEnd === undefined ? {} : { fadeEnd }),
      ...(flicker === undefined ? {} : { flicker }),
      ...(seed === undefined ? {} : { seed }),
    };
    let disposed = false;
    let raf = 0;
    let visible = true;
    let last = 0;
    const started = performance.now();
    let state: { frame: ReturnType<typeof createFrame>; atlas: ReturnType<typeof buildGlyphAtlas>; cellW: number; cellH: number; dpr: number } | null = null;

    const layout = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      const dpr = cappedDpr();
      const fontSize = width < 640 ? 10 : 12;
      const cellW = Math.round(fontSize * 0.75 * dpr) / dpr;
      const cellH = Math.round(fontSize * 1.32 * dpr) / dpr;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const frame = createFrame(gridFor(width, height, cellW, cellH));
      const atlas = buildGlyphAtlas({
        glyphs: FIELD_GLYPHS,
        levels: FIELD_LEVELS,
        colors: [color],
        opacity: (level) => (level / (FIELD_LEVELS - 1)) * maxOpacity,
        cellWidth: cellW,
        cellHeight: cellH,
        fontSize,
        fontFamily: SITE_MONO_FONT,
        dpr,
      });
      state = { frame, atlas, cellW, cellH, dpr };
    };

    const draw = (seconds: number) => {
      if (!state) return;
      const { frame, atlas, cellW, cellH, dpr } = state;
      renderField(frame, seconds, opts);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < frame.rows; r++) {
        const y = Math.round(r * cellH * dpr);
        for (let c = 0; c < frame.cols; c++) {
          const i = r * frame.cols + c;
          const g = frame.glyphs[i];
          if (g !== 0) drawGlyph(ctx, atlas, g, frame.levels[i], 0, Math.round(c * cellW * dpr), y);
        }
      }
    };

    const tick = (now: number) => {
      raf = 0;
      if (disposed || !visible || document.hidden) return;
      if (now - last >= 1000 / FIELD_FPS) {
        last = now;
        draw((now - started) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (reduced) {
        draw(0);
        return;
      }
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick);
    };

    const resize = new ResizeObserver(() => {
      layout();
      draw(reduced ? 0 : (performance.now() - started) / 1000);
    });
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      start();
    });
    const onVisibility = () => start();

    void whenMonoFontReady().then(() => {
      if (disposed) return;
      layout();
      draw(0);
      if (canvas.parentElement) resize.observe(canvas.parentElement);
      io.observe(canvas);
      document.addEventListener("visibilitychange", onVisibility);
      canvas.dataset.ready = "true";
      start();
    });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      resize.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, color, maxOpacity, drift, fadeStart, fadeEnd, flicker, seed]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
