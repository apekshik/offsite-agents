import { beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { focal, holdAt, raised, sway, toScreen, type ViewSize } from "./hold.ts";
import { FirstPersonHands, READ_SCALE } from "./hands.ts";
import { PHONE_GLASS } from "../avatar/props.ts";

const VIEWS: ViewSize[] = [{ w: 1280, h: 800, fov: 60 }, { w: 1920, h: 1080, fov: 60 }, { w: 1024, h: 768, fov: 60 }];

describe("holdAt", () => {
  it("puts a screen square to the view exactly over the rectangle asked for", () => {
    for (const view of VIEWS) {
      const rect = { x: view.w / 2, y: view.h * 0.52, w: view.w * 0.74, h: view.w * 0.74 * (726 / 1022) };
      const size = { w: 0.27, h: 0.27 * (726 / 1022) };
      const c = holdAt(rect, size, view);
      const tl = toScreen({ x: c.x - size.w / 2, y: c.y + size.h / 2, z: c.z }, view);
      const br = toScreen({ x: c.x + size.w / 2, y: c.y - size.h / 2, z: c.z }, view);
      expect(tl.x).toBeCloseTo(rect.x - rect.w / 2, 6);
      expect(tl.y).toBeCloseTo(rect.y - rect.h / 2, 6);
      expect(br.x).toBeCloseTo(rect.x + rect.w / 2, 6);
      expect(br.y).toBeCloseTo(rect.y + rect.h / 2, 6);
    }
  });

  it("fits inside a rectangle of another shape, keeping its own", () => {
    const view = VIEWS[0]!;
    const c = holdAt({ x: 640, y: 400, w: 400, h: 100 }, { w: 0.1, h: 0.1 }, view);
    const top = toScreen({ x: c.x, y: c.y + 0.05, z: c.z }, view), bottom = toScreen({ x: c.x, y: c.y - 0.05, z: c.z }, view);
    expect(bottom.y - top.y).toBeCloseTo(100, 6);
  });

  it("holds it further away the smaller it should look, and in front of the eye", () => {
    const view = VIEWS[0]!;
    const big = holdAt({ x: 640, y: 400, w: 900, h: 600 }, { w: 0.2, h: 0.13 }, view);
    const small = holdAt({ x: 640, y: 400, w: 450, h: 300 }, { w: 0.2, h: 0.13 }, view);
    expect(big.z).toBeLessThan(0);
    expect(small.z).toBeCloseTo(big.z * 2, 9);
    expect(focal(view)).toBeCloseTo(400 / Math.tan(Math.PI / 6), 9);
  });
});

describe("raising and lowering", () => {
  it("eases from the pocket to up and back, without overshooting", () => {
    for (const rising of [true, false]) {
      expect(raised(0, rising)).toBe(0);
      expect(raised(1, rising)).toBe(1);
      let was = 0;
      for (let u = 0.05; u <= 1; u += 0.05) {
        const e = raised(u, rising);
        expect(e).toBeGreaterThanOrEqual(was);
        expect(e).toBeLessThanOrEqual(1);
        was = e;
      }
    }
    // Comes up quickly and settles; goes down gently from rest.
    expect(raised(0.3, true)).toBeGreaterThan(0.6);
    expect(raised(0.1, false)).toBeLessThan(0.05);
  });

  it("sways only a little, and not at all while kept still", () => {
    for (let t = 0; t < 20; t += 0.37) {
      const s = sway(t, 1, 1, t * 7);
      expect(Math.abs(s.x)).toBeLessThan(0.0005);
      expect(Math.abs(s.y)).toBeLessThan(0.001);
      expect(Math.abs(s.rx) + Math.abs(s.rz)).toBeLessThan(0.01);
      expect(Object.values(sway(t, 0, 0, t * 7)).every((v) => v === 0)).toBe(true);
    }
  });
});

describe("the hands holding the phone up to read", () => {
  // No DOM here: the phone paints its own screens on canvases, which only need to take the calls.
  beforeAll(() => {
    const nothing: unknown = new Proxy(() => nothing, { get: () => nothing, apply: () => nothing });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => nothing }) });
  });
  const setup = (view = VIEWS[0]!) => {
    const camera = new THREE.PerspectiveCamera(view.fov, view.w / view.h, 0.1, 100);
    const hands = new FirstPersonHands();
    camera.add(hands.object);
    const open = { x: view.w / 2, y: view.h * 0.52, w: view.h * 1.19, h: view.h * 0.845 };
    const cover = { x: view.w / 2, y: view.h * 0.52, w: open.h * (497 / 726), h: open.h };
    hands.setHold({ view, cover, open });
    hands.setOpen(true);
    hands.setOut(true, true);
    camera.updateMatrixWorld(true);
    return { camera, hands, open, cover };
  };

  it("lands the open phone's screen on the place asked for, a comfortable way off", () => {
    const view = VIEWS[1]!;
    const { camera, hands, open } = setup(view);
    hands.still = true;
    for (let i = 0; i < 60; i++) hands.update(1 / 60, i / 60);
    const s = hands.screens(camera, view.w, view.h);
    expect(s.open).toBe(1);
    expect(s.spread.front).toBe(true);
    const [tl, tr, br, bl] = s.spread.corners as [[number, number], [number, number], [number, number], [number, number]];
    // Leaning back a touch: the top a little narrower than the bottom, the middle where it was asked for.
    expect(tr[0] - tl[0]).toBeLessThan(br[0] - bl[0]);
    expect((tl[0] + tr[0] + br[0] + bl[0]) / 4).toBeCloseTo(open.x, 0);
    expect(Math.abs((tl[1] + bl[1]) / 2 - open.y)).toBeLessThan(open.h * 0.02);
    expect(Math.abs(bl[1] - tl[1] - open.h)).toBeLessThan(open.h * 0.02);
    // Bigger than life, about 20 cm from the eye.
    const at = new THREE.Vector3();
    hands.phone.faces.spread.object.getWorldPosition(at);
    expect(-at.z).toBeGreaterThan(0.15);
    expect(-at.z).toBeLessThan(0.3);
    expect(hands.phone.object.scale.x).toBe(READ_SCALE);
  });

  it("shows the cover folded, then neither inner page from behind while it swings", () => {
    const { camera, hands } = setup();
    hands.setOpen(false);
    for (let i = 0; i < 90; i++) hands.update(1 / 60, i / 60);
    let s = hands.screens(camera, 1280, 800);
    expect(s.open).toBe(0);
    expect(s.cover.front).toBe(true);
    expect(s.left.front).toBe(false);
    hands.setOpen(true);
    for (let i = 0; i < 90; i++) hands.update(1 / 60, i / 60);
    s = hands.screens(camera, 1280, 800);
    expect(s.open).toBe(1);
    expect(s.cover.front).toBe(false);
    expect(s.left.front).toBe(true);
  });

  it("keeps the glass plain while the interface draws on it", () => {
    const { hands } = setup();
    const mat = (hands.phone.faces.cover.object as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeNull();
    hands.setHold(null);
    expect(((hands.phone.faces.cover.object as THREE.Mesh).material as THREE.MeshBasicMaterial).map).not.toBeNull();
    expect(PHONE_GLASS.spread.w / PHONE_GLASS.spread.h).toBeCloseTo(1022 / 726, 9);
  });
});
