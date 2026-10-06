import { describe, expect, it } from "vitest";
import { drawable, lerpQuad, mapPoint, quadMatrix, rectQuad, sharpZoom, squareToQuad, type Quad } from "./quad.ts";

/** Where a matrix3d (column-major, as quadMatrix returns it) takes a point of the page, the way the browser does it. */
function css(m: number[], x: number, y: number): [number, number] {
  const X = m[0]! * x + m[4]! * y + m[12]!, Y = m[1]! * x + m[5]! * y + m[13]!, W = m[3]! * x + m[7]! * y + m[15]!;
  return [X / W, Y / W];
}

// A screen held up and leaning back a touch: the top narrower than the bottom.
const KEYSTONE: Quad = [[212, 101], [1068, 99], [1092, 744], [188, 746]];
const close = (a: [number, number], b: [number, number], d = 1e-6) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(d));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(d));
};

describe("squareToQuad", () => {
  it("takes the unit square's corners onto the quad's, in order", () => {
    const m = squareToQuad(KEYSTONE);
    close(mapPoint(m, 0, 0), KEYSTONE[0] as [number, number]);
    close(mapPoint(m, 1, 0), KEYSTONE[1] as [number, number]);
    close(mapPoint(m, 1, 1), KEYSTONE[2] as [number, number]);
    close(mapPoint(m, 0, 1), KEYSTONE[3] as [number, number]);
  });

  it("is plain scale and shift for a rectangle (no perspective to blur the page)", () => {
    const m = squareToQuad(rectQuad({ x: 640, y: 400, w: 950, h: 675 }));
    expect(m[6]).toBe(0);
    expect(m[7]).toBe(0);
    close(mapPoint(m, 0.5, 0.5), [640, 400]);
  });

  it("keeps straight lines straight: the middle of an edge lands on that edge", () => {
    const m = squareToQuad(KEYSTONE);
    const [x, y] = mapPoint(m, 0.5, 0);
    const [[x0, y0], [x1, y1]] = KEYSTONE as [[number, number], [number, number]];
    // On the line through the top corners.
    expect((x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)).toBeCloseTo(0, 6);
  });
});

describe("quadMatrix", () => {
  it("lays a page's corners exactly on the screen's corners", () => {
    const m = quadMatrix(1022, 726, KEYSTONE);
    close(css(m, 0, 0), KEYSTONE[0] as [number, number]);
    close(css(m, 1022, 0), KEYSTONE[1] as [number, number]);
    close(css(m, 1022, 726), KEYSTONE[2] as [number, number]);
    close(css(m, 0, 726), KEYSTONE[3] as [number, number]);
  });

  it("puts every point of the page where the screen shows it (the hinge's middle line, say)", () => {
    const m = quadMatrix(1022, 726, KEYSTONE);
    const at = squareToQuad(KEYSTONE);
    for (const [u, v] of [[0.5, 0], [0.5, 1], [0.25, 0.75], [0.9, 0.1]] as const) close(css(m, u * 1022, v * 726), mapPoint(at, u, v));
  });

  it("leaves depth alone, so the browser can still invert it to hit-test", () => {
    const m = quadMatrix(497, 726, KEYSTONE);
    expect([m[2], m[6], m[8], m[9], m[10], m[11], m[14]]).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });
});

describe("the rest", () => {
  it("lerps corners", () => {
    const a = rectQuad({ x: 100, y: 100, w: 100, h: 50 }), b = rectQuad({ x: 300, y: 100, w: 100, h: 50 });
    expect(lerpQuad(a, b, 0.5)).toEqual(rectQuad({ x: 200, y: 100, w: 100, h: 50 }));
  });

  it("only draws a quad that hasn't folded over itself", () => {
    expect(drawable(KEYSTONE)).toBe(true);
    expect(drawable([...KEYSTONE].reverse())).toBe(true);
    expect(drawable([[0, 0], [100, 0], [0, 100], [100, 100]])).toBe(false);
    expect(drawable([[0, 0], [NaN, 0], [100, 100], [0, 100]])).toBe(false);
  });

  it("lays a page out as big as it's seen: on a Retina screen twice over, in quarter steps, never shrunk", () => {
    expect(sharpZoom(0.93, 1)).toBe(1);
    expect(sharpZoom(1.255, 1)).toBe(1.25);
    expect(sharpZoom(1.04, 2)).toBe(2);
    expect(sharpZoom(0.4, 1)).toBe(1);
  });
});
