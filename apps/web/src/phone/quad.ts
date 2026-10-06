// Laying a flat page over a screen seen in perspective: the CSS transform that takes an element's
// w × h box onto four corners on screen (a homography, as a matrix3d), so the page lies exactly over
// the 3D phone's glass and stays the real, clickable page (the browser hit-tests through the same
// transform). Plain numbers: see quad.test.ts.

/** Four corners on screen, CSS pixels: top left, top right, bottom right, bottom left. */
export type Quad = [number, number][];

/** The 3×3 homography taking the unit square ((0,0) (1,0) (1,1) (0,1)) onto q, as [a b c; d e f; g h 1]. */
export function squareToQuad(q: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  // A parallelogram: no perspective at all.
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/** Where the homography m takes the point (u, v). */
export function mapPoint(m: number[], u: number, v: number): [number, number] {
  const w = m[6]! * u + m[7]! * v + m[8]!;
  return [(m[0]! * u + m[1]! * v + m[2]!) / w, (m[3]! * u + m[4]! * v + m[5]!) / w];
}

/**
 * The matrix3d that takes an element's w × h box (transform-origin at its top left) onto q. z passes through
 * untouched, so the matrix stays invertible and the browser can hit-test the page where it's drawn.
 */
export function quadMatrix(w: number, h: number, q: Quad): number[] {
  const [a, b, c, d, e, f, g, k] = squareToQuad(q) as [number, number, number, number, number, number, number, number];
  // Column-major, as matrix3d() takes it: x' = (a x/w + b y/h + c) / (g x/w + k y/h + 1), and so on.
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, c, f, 0, 1];
}

export const cssMatrix = (m: number[]) => `matrix3d(${m.map((x) => +x.toFixed(9)).join(",")})`;

/** Each corner a share t of the way from a to b. */
export function lerpQuad(a: Quad, b: Quad, t: number): Quad {
  return a.map(([x, y], i) => [x + (b[i]![0] - x) * t, y + (b[i]![1] - y) * t]);
}

/** A rectangle (centre and size) as corners. */
export function rectQuad(r: { x: number; y: number; w: number; h: number }): Quad {
  const l = r.x - r.w / 2, t = r.y - r.h / 2;
  return [[l, t], [l + r.w, t], [l + r.w, t + r.h], [l, t + r.h]];
}

/**
 * How big to lay a page out (CSS zoom) so it's drawn at the resolution it's seen at: `scale` CSS pixels on screen per
 * pixel of the page, on a screen of `dpr` device pixels per CSS pixel. In quarter steps (each step lays it out again),
 * never below 1.
 */
export function sharpZoom(scale: number, dpr: number): number {
  return Math.max(1, Math.round(scale * dpr * 4) / 4);
}

/** Every corner a finite number, and the quad not folded over itself (convex, either way round). */
export function drawable(q: Quad): boolean {
  if (q.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i]!, [bx, by] = q[(i + 1) % 4]!, [cx, cy] = q[(i + 2) % 4]!;
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}
