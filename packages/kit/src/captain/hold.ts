// Holding the phone up to read it, in first person. The interface draws the phone's screens itself
// (real, clickable pages) and lies them over the 3D phone's glass; it says where on screen it wants
// them (the same place and size as its own overlay), and the hands hold the phone so its screens
// land there. Plain numbers in and out, so the maths is testable without a renderer.

/** A rectangle on screen: its centre and size, CSS pixels. */
export interface ScreenRect { x: number; y: number; w: number; h: number }

/** The window (CSS pixels) and the camera's vertical field of view (degrees). */
export interface ViewSize { w: number; h: number; fov: number }

/** Where the interface wants the phone's screens, and the window it measured them in. */
export interface HoldWant {
  view: { w: number; h: number };
  /** The cover screen, folded. */
  cover: ScreenRect;
  /** The inside screen, unfolded (both halves and the hinge). */
  open: ScreenRect;
}

/** Pixels per metre at one metre in front of the camera: the focal length. */
export function focal(view: ViewSize): number {
  return view.h / 2 / Math.tan((view.fov * Math.PI) / 360);
}

/**
 * Where to put the middle of a screen `size` metres across, square to the view, so that it fills
 * `rect` on screen: camera space (x right, y up, z toward you, so in front is -z). It fits inside the
 * rect, keeping its own shape.
 */
export function holdAt(rect: ScreenRect, size: { w: number; h: number }, view: ViewSize): { x: number; y: number; z: number } {
  const f = focal(view);
  const d = f * Math.max(size.w / rect.w, size.h / rect.h);
  return { x: ((rect.x - view.w / 2) * d) / f, y: (-(rect.y - view.h / 2) * d) / f, z: -d };
}

/** A camera-space point on screen, CSS pixels (the inverse of holdAt, for one point). */
export function toScreen(p: { x: number; y: number; z: number }, view: ViewSize): { x: number; y: number } {
  const f = focal(view);
  return { x: view.w / 2 + (p.x * f) / -p.z, y: view.h / 2 - (p.y * f) / -p.z };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** How far up the phone is, from u (0 in the pocket … 1 up, linear in time): eased out going up, in coming down. */
export function raised(u: number, rising: boolean): number {
  const t = clamp01(u);
  return rising ? 1 - Math.pow(1 - t, 3) : t * t * (3 - 2 * t);
}

/** Seconds to raise the phone, and to put it away. */
export const RAISE = { up: 0.38, down: 0.26 } as const;

/**
 * The phone's small life while you hold it up, at time t (seconds): breathing and a little drift, as
 * offsets (metres, radians) to add to the pose. `amount` scales it (0: perfectly still, while typing);
 * `walk` (0..1) adds a light bob in step with the stride, at `stride` (radians of the step cycle).
 */
export function sway(t: number, amount: number, walk = 0, stride = 0): { x: number; y: number; rx: number; rz: number } {
  const breathe = Math.sin(t * 1.35);
  return {
    x: amount * 0.00022 * Math.sin(t * 0.61 + 0.8),
    y: amount * 0.00032 * breathe + walk * 0.0005 * Math.abs(Math.cos(stride)),
    rx: amount * 0.004 * breathe,
    rz: amount * 0.0035 * Math.sin(t * 0.47),
  };
}
