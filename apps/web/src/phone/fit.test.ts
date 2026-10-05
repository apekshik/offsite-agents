import { describe, expect, it } from "vitest";
import { FILL, OPEN, fillScale, phoneScale, shrinkToFit } from "./fit.ts";

const DESKTOPS: [number, number][] = [[1280, 800], [1440, 900], [1920, 1080], [2560, 1440]];

describe("phoneScale", () => {
  it("fills most of a desktop window, keeping the deck in view round it", () => {
    for (const [w, h] of DESKTOPS) {
      const { open } = phoneScale(w, h);
      const bw = OPEN.w * open, bh = OPEN.h * open;
      // About 86% of the height (or 92% of the width), whichever binds, and never more.
      expect(bw).toBeLessThanOrEqual(FILL.w * w + 1e-6);
      expect(bh).toBeLessThanOrEqual(FILL.h * h + 1e-6);
      expect(bh / h).toBeGreaterThan(0.82);
    }
  });

  it("grows past life size on big screens", () => {
    expect(phoneScale(1920, 1080).open).toBeGreaterThan(1.2);
    expect(phoneScale(2560, 1440).open).toBeGreaterThan(1.6);
  });

  it("keeps its top clear of the walk chip and its hint bar on screen", () => {
    for (const [w, h] of [...DESKTOPS, [390, 844], [1366, 640]] as [number, number][]) {
      const { open } = phoneScale(w, h);
      const top = h / 2 + 10 - ((OPEN.h + 40) * open) / 2;
      expect(top).toBeGreaterThanOrEqual(46 - 1e-6);
      expect(h / 2 + 10 + ((OPEN.h + 40) * open) / 2).toBeLessThanOrEqual(h);
    }
  });

  it("fills a phone's width", () => {
    const { open } = phoneScale(390, 844);
    expect(OPEN.w * open).toBeCloseTo(0.92 * 390, 3);
  });

  it("folded, grows less than unfolded, and never shrinks below its old size on a big screen", () => {
    for (const [w, h] of DESKTOPS) {
      const { open, cover } = phoneScale(w, h);
      expect(cover).toBeLessThanOrEqual(open);
      const old = shrinkToFit(OPEN.w, OPEN.h + 30, w, h, 28);
      if (open > old) expect(cover).toBeGreaterThan(old);
    }
    const big = phoneScale(2560, 1440);
    expect(big.cover).toBeLessThan(big.open - 0.2);
  });
});

describe("fillScale", () => {
  it("keeps the shape: one scale for both sides, set by the side that binds", () => {
    expect(fillScale(1600, 900, 2560, 1440)).toBeCloseTo((0.86 * 1440) / 900, 6);
    expect(fillScale(1000, 100, 1000, 1000)).toBeCloseTo(0.92, 6);
  });
});
