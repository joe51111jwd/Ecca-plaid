import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./position";

const viewport = { width: 390, height: 844 };
const popover = { width: 288, height: 120 };

describe("computePopoverPosition", () => {
  it("places below and centred when there is room", () => {
    const anchor = { top: 100, left: 150, width: 90, height: 20 };
    expect(computePopoverPosition(anchor, popover, viewport, "bottom")).toEqual({ top: 128, left: 51, side: "bottom" });
  });

  it("places above when asked and there is room", () => {
    const anchor = { top: 400, left: 150, width: 90, height: 20 };
    expect(computePopoverPosition(anchor, popover, viewport, "top")).toEqual({ top: 272, left: 51, side: "top" });
  });

  it("flips to the other side when the preferred side does not fit", () => {
    const nearBottom = { top: 800, left: 150, width: 90, height: 20 };
    expect(computePopoverPosition(nearBottom, popover, viewport, "bottom").side).toBe("top");
    const nearTop = { top: 10, left: 150, width: 90, height: 20 };
    expect(computePopoverPosition(nearTop, popover, viewport, "top").side).toBe("bottom");
  });

  it("stays on the preferred side when neither fits but it has more room", () => {
    const short = { width: 390, height: 200 };
    const anchor = { top: 60, left: 100, width: 80, height: 20 };
    expect(computePopoverPosition(anchor, popover, short, "bottom").side).toBe("bottom");
  });

  it("never leaves the viewport horizontally", () => {
    const atLeftEdge = { top: 100, left: 0, width: 40, height: 20 };
    expect(computePopoverPosition(atLeftEdge, popover, viewport, "bottom").left).toBe(8);
    const atRightEdge = { top: 100, left: 360, width: 30, height: 20 };
    const position = computePopoverPosition(atRightEdge, popover, viewport, "bottom");
    expect(position.left + popover.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("aligns to the anchor's start or end", () => {
    const anchor = { top: 100, left: 60, width: 100, height: 32 };
    expect(computePopoverPosition(anchor, { width: 200, height: 100 }, { width: 1440, height: 900 }, "bottom-start").left).toBe(60);
    const wide = { top: 100, left: 1200, width: 100, height: 32 };
    expect(computePopoverPosition(wide, { width: 200, height: 100 }, { width: 1440, height: 900 }, "bottom-end").left).toBe(1100);
  });

  it("pins a popover larger than the viewport to the margin instead of a negative offset", () => {
    const anchor = { top: 100, left: 100, width: 40, height: 20 };
    const position = computePopoverPosition(anchor, { width: 600, height: 2000 }, viewport, "bottom");
    expect(position.left).toBe(8);
    expect(position.top).toBe(8);
  });

  it("respects custom gap and margin", () => {
    const anchor = { top: 100, left: 150, width: 90, height: 20 };
    expect(computePopoverPosition(anchor, popover, viewport, "bottom", 0, 0).top).toBe(120);
    const atLeftEdge = { top: 100, left: 0, width: 40, height: 20 };
    expect(computePopoverPosition(atLeftEdge, popover, viewport, "bottom", 8, 24).left).toBe(24);
  });

  it("returns whole pixels", () => {
    const anchor = { top: 100.4, left: 150.3, width: 91.7, height: 20.2 };
    const position = computePopoverPosition(anchor, { width: 287.5, height: 120 }, viewport, "bottom");
    expect(Number.isInteger(position.top)).toBe(true);
    expect(Number.isInteger(position.left)).toBe(true);
  });
});
