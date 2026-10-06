// Keyboard and mouse for the captain. Keys are by position (KeyboardEvent.code), so WASD works on
// any layout. While the interface owns the keyboard (`suspended`: the phone or the helm console
// is open) nothing here reacts but the wheel over the world (zoom, and with it the view), held keys
// are let go and the pointer is released. F and Escape
// belong to the interface: they are never bound or swallowed here.

import * as THREE from "three";

export interface InputOptions {
  /** Where mouse look and clicks come from: the game's canvas. */
  element: HTMLElement;
  /** True while the interface owns the keyboard. */
  suspended?: () => boolean;
}

/** Codes the game uses; their default (page scrolling) is prevented. */
const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "KeyE", "KeyV"]);

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
};

type Fn<A extends unknown[]> = (...a: A) => void;

export class Input {
  readonly element: HTMLElement;
  readonly keys = new Set<string>();
  /** Clicking the canvas grabs the pointer (first person); otherwise dragging looks and clicking picks. */
  lockOnClick = false;
  private suspended: () => boolean;
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private drag: { x: number; y: number; moved: number; grab: boolean } | null = null;
  private pressFns = new Set<Fn<[string]>>();
  private clickFns = new Set<Fn<[THREE.Vector2, number]>>();
  private lockFns = new Set<Fn<[boolean]>>();
  private off: (() => void)[] = [];
  private wasSuspended = false;

  constructor({ element, suspended = () => false }: InputOptions) {
    this.element = element;
    this.suspended = suspended;
    const on = <K extends keyof WindowEventMap>(t: Window | HTMLElement | Document, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      if (this.suspended() || editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) for (const fn of this.pressFns) fn(e.code);
      this.keys.add(e.code);
    });
    on(window, "keyup", (e: KeyboardEvent) => { this.keys.delete(e.code); });
    on(window, "blur", () => this.keys.clear());
    on(element, "contextmenu", (e: MouseEvent) => e.preventDefault());
    on(element, "pointerdown", (e: PointerEvent) => {
      if (this.suspended()) return;
      const grab = !this.locked && this.lockOnClick && e.button === 0;
      if (grab) this.lock();
      this.drag = { x: e.clientX, y: e.clientY, moved: 0, grab };
      if (!this.locked) element.setPointerCapture?.(e.pointerId);
    });
    on(element, "pointermove", (e: PointerEvent) => {
      if (this.suspended()) return;
      if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; if (this.drag) this.drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); return; }
      if (!this.drag) return;
      const mx = e.clientX - this.drag.x, my = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(mx) + Math.abs(my);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      // Dragging looks around (scaled up: a drag is slower than a locked mouse).
      this.dx += mx * 1.6;
      this.dy += my * 1.6;
    });
    on(element, "pointerup", (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.grab || d.moved > 6 || this.suspended()) return;
      const ndc = new THREE.Vector2(0, 0); // the crosshair, while locked
      if (!this.locked) {
        const r = element.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      for (const fn of this.clickFns) fn(ndc, e.button);
    });
    // The wheel zooms even while the interface has the keyboard: it only reaches the canvas over the world itself.
    on(element, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    on(document, "pointerlockchange", () => { for (const fn of this.lockFns) fn(this.locked); });
  }

  get locked() { return document.pointerLockElement === this.element; }

  lock() {
    if (this.locked || this.suspended()) return;
    try { (this.element.requestPointerLock() as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* some embeds refuse: dragging still looks */ }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  /** Call once a frame: lets go of everything while the interface has the keyboard. */
  update() {
    const s = this.suspended();
    if (s && !this.wasSuspended) { this.keys.clear(); this.unlock(); this.drag = null; this.dx = this.dy = this.wheel = 0; }
    this.wasSuspended = s;
  }

  get isSuspended() { return this.suspended(); }
  down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  /** Movement intent: x to the right, z forward, each -1..1. */
  move() {
    if (this.suspended()) return { x: 0, z: 0 };
    return {
      x: (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0),
      z: (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0),
    };
  }
  get sprint() { return this.down("ShiftLeft", "ShiftRight"); }
  get jump() { return this.down("Space"); }

  /** Mouse movement (pixels) and wheel notches since the last call. */
  takeLook() {
    const out = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = this.dy = this.wheel = 0;
    return out;
  }

  /** A key went down (not a repeat). Returns a function that unsubscribes. */
  onPress(fn: (code: string) => void) { this.pressFns.add(fn); return () => this.pressFns.delete(fn); }
  /** A click that wasn't a drag: where (NDC; the crosshair while locked) and which button. */
  onClick(fn: (ndc: THREE.Vector2, button: number) => void) { this.clickFns.add(fn); return () => this.clickFns.delete(fn); }
  onLockChange(fn: (locked: boolean) => void) { this.lockFns.add(fn); return () => this.lockFns.delete(fn); }

  dispose() {
    this.unlock();
    for (const f of this.off) f();
    this.off = [];
  }
}
