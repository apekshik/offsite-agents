import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildAvatar } from "../avatar/avatar.ts";
import { CAPTAIN_PRESET } from "../avatar/presets.ts";
import { firstPersonEye } from "./camera.ts";
import { HAND_CLEAR, HEAD_CLEAR, OwnBody, SELF_LAYER, selfHidden, type SelfView } from "./self.ts";

const view = (o: Partial<SelfView>): SelfView => ({ view: "first", gliding: false, camToEyes: 0, phoneHands: false, handToHead: 0.67, ...o });

describe("the first-person eye", () => {
  it("sits at the face looking ahead or up", () => {
    for (const p of [-1.4, -0.5, 0, 0.3]) expect(firstPersonEye(p)).toEqual({ ahead: 0.06, drop: 0 });
  });

  it("leans out over the chest as you look down, smoothly, and stays inside the walking capsule", () => {
    let last = firstPersonEye(0);
    for (let p = 0.01; p <= 1.48; p += 0.01) {
      const e = firstPersonEye(p);
      expect(e.ahead).toBeGreaterThanOrEqual(last.ahead);
      expect(e.drop).toBeGreaterThanOrEqual(last.drop);
      // No jumps: a hundredth of a radian moves it well under a centimetre.
      expect(e.ahead - last.ahead).toBeLessThan(0.005);
      last = e;
    }
    const down = firstPersonEye(1.48);
    // Past the front of the chest (~0.1 m), so the feet show beyond it; short of the capsule's 0.3 m.
    expect(down.ahead).toBeGreaterThan(0.2);
    expect(down.ahead).toBeLessThan(0.3);
    expect(down.drop).toBeCloseTo(0.08);
  });
});

describe("what first person hides", () => {
  it("hides nothing in third person, even with the phone out", () => {
    expect(selfHidden(view({ view: "third", camToEyes: 4.2, phoneHands: true, handToHead: 0.2 }))).toEqual({ head: false, arms: false });
  });

  it("hides the head in first person, and the arms only when they'd be in the way", () => {
    expect(selfHidden(view({}))).toEqual({ head: true, arms: false });
    expect(selfHidden(view({ phoneHands: true }))).toEqual({ head: true, arms: true });
    expect(selfHidden(view({ handToHead: 0.26 }))).toEqual({ head: true, arms: true });
    expect(selfHidden(view({ handToHead: HAND_CLEAR + 0.01 }))).toEqual({ head: true, arms: false });
  });

  it("gliding between views, goes by how near the camera is to the eyes", () => {
    for (const v of ["first", "third"] as const) {
      expect(selfHidden(view({ view: v, gliding: true, camToEyes: 2 })).head).toBe(false);
      expect(selfHidden(view({ view: v, gliding: true, camToEyes: HEAD_CLEAR - 0.05 })).head).toBe(true);
      expect(selfHidden(view({ view: v, gliding: true, camToEyes: 2, phoneHands: true })).arms).toBe(false);
    }
  });

  it("flips the head once over a glide in, and once over a glide out", () => {
    // Settled in one view, V, the camera glides (a quarter second at 60 fps), settled in the other.
    const flips = (from: "first" | "third", to: "first" | "third", ds: number[]) => {
      const frames = [view({ view: from, camToEyes: ds[0]! }), ...ds.map((d) => view({ view: to, gliding: true, camToEyes: d })), view({ view: to, camToEyes: ds.at(-1)! })];
      const hs = frames.map((f) => selfHidden(f).head);
      return hs.filter((h, i) => i && h !== hs[i - 1]).length;
    };
    const glide = Array.from({ length: 17 }, (_, i) => 4.2 * (1 - i / 16));
    expect(flips("third", "first", glide)).toBe(1);
    expect(flips("first", "third", [...glide].reverse())).toBe(1);
  });
});

describe("your own body", () => {
  const avatar = buildAvatar(CAPTAIN_PRESET.spec, CAPTAIN_PRESET.look);
  const body = new OwnBody(avatar);
  const layers = (o: THREE.Object3D) => { const s = new Set<number>(); o.traverse((x) => s.add(x.layers.mask)); return s; };
  const camera = new THREE.PerspectiveCamera();
  const shadow = new THREE.OrthographicCamera();
  shadow.layers.enable(SELF_LAYER);
  const self = 1 << SELF_LAYER;

  it("takes the head, the cap and the neck off the camera's layer, and keeps them in the shadow", () => {
    body.set({ head: true, arms: false });
    const { head, chest, hips, upperArms, feet } = avatar.bones;
    expect(head.children.length).toBeGreaterThan(5); // the head, its face and hair, and the cap's pieces
    expect(layers(head)).toEqual(new Set([self]));
    expect(avatar.neck.layers.mask).toBe(self);
    head.traverse((o) => { expect(o.layers.test(camera.layers)).toBe(false); expect(o.layers.test(shadow.layers)).toBe(true); });
    for (const part of [hips, chest, upperArms[0], feet[1]]) expect(part.layers.test(camera.layers)).toBe(true);
    // The chest's own meshes (the jacket) stay; only its neck goes.
    expect(chest.children.filter((o) => o !== head && o !== avatar.neck && !upperArms.includes(o as THREE.Group)).every((o) => o.layers.mask === 1)).toBe(true);
  });

  it("takes the arms too when asked, and puts everything back", () => {
    body.set({ head: true, arms: true });
    for (const a of avatar.bones.upperArms) expect(layers(a)).toEqual(new Set([self]));
    expect(layers(avatar.bones.thighs[0])).toEqual(new Set([1]));
    body.set({ head: false, arms: false });
    expect(layers(avatar.root)).toEqual(new Set([1]));
  });
});
