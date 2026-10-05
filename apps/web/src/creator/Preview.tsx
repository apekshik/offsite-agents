import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildAvatar, type AvatarRig } from "@offsite/kit";
import type { AvatarSpec, Look } from "@offsite/contracts";

// The customizer's live 3D preview: one avatar on a small turntable, in its own little renderer.
// Drag to turn it.

class Turntable {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private rig: AvatarRig | null = null;
  private holder = new THREE.Group();
  private raf = 0;
  private clock = new THREE.Timer();
  /** Where the viewer turned it to; it sways gently around that, face toward you. */
  yaw = -0.3;
  sway = 1;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight("#dff4ff", "#3a3226", 1.6));
    const sun = new THREE.DirectionalLight("#fff3e0", 2.4);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight("#4fe3ff", 1.1);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 48), new THREE.MeshBasicMaterial({ color: "#4fe3ff", transparent: true, opacity: 0.07 }));
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc, this.holder);
    this.loop();
  }

  show(spec: AvatarSpec, look: Look | null) {
    if (this.rig) { this.holder.remove(this.rig.root); this.rig.dispose(); }
    try {
      this.rig = buildAvatar(spec, look);
    } catch (e) {
      console.warn("Could not build that look", e);
      this.rig = buildAvatar(spec, null);
    }
    this.holder.add(this.rig.root);
    const top = Math.max(1.2, this.rig.topY);
    this.camera.position.set(0, top * 0.62, top * 2.3 + 0.5);
    this.camera.lookAt(0, top * 0.52, 0);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const { canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(1, h);
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.y = this.yaw + Math.sin(this.clock.getElapsed() * 0.5) * 0.45 * this.sway;
    this.rig?.animate(dt, { speed: 0, act: null }, this.clock.getElapsed());
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.rig?.dispose();
    this.renderer.dispose();
  }
}

export function AvatarPreview({ spec, look }: { spec: AvatarSpec; look: Look | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const table = useRef<Turntable | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const t = new Turntable(canvas.current);
    table.current = t;
    return () => { t.dispose(); table.current = null; };
  }, []);
  useEffect(() => { table.current?.show(spec, look); }, [spec, look]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let drag: number | null = null;
    const down = (e: PointerEvent) => { drag = e.clientX; el.setPointerCapture(e.pointerId); if (table.current) table.current.sway = 0; };
    const move = (e: PointerEvent) => { if (drag === null || !table.current) return; table.current.yaw += (e.clientX - drag) * 0.012; drag = e.clientX; };
    const up = () => { drag = null; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
  }, []);
  return <canvas ref={canvas} className="cr-canvas" />;
}
