// What this visitor's screen gets behind the landing page: the live yacht, the poster drifting
// slowly, or the poster held still. Pure, so the rules are easy to read and test; Backdrop.tsx
// gathers the facts from the browser.

export type BackdropMode = "live" | "drift" | "still";

export interface DeviceFacts {
  /** prefers-reduced-motion: reduce. */
  reducedMotion: boolean;
  /** CSS pixels across. */
  width: number;
  /** A mouse or trackpad (hover: hover and pointer: fine): a laptop or desktop, not a phone. */
  finePointer: boolean;
  /** The browser asked to save data (navigator.connection.saveData). */
  saveData: boolean;
  /** WebGL 2 on a real GPU, in software only, or not at all. */
  webgl: "hardware" | "software" | "none";
  /** navigator.deviceMemory, GB, where the browser says. */
  memoryGb?: number | undefined;
}

/** The live scene only where it will run well: a real GPU, a wide screen with a mouse, motion welcome. */
export function backdropMode(f: DeviceFacts): BackdropMode {
  if (f.reducedMotion) return "still";
  if (f.webgl !== "hardware") return "drift";
  if (f.saveData) return "drift";
  if (f.width < 760 || !f.finePointer) return "drift";
  if (f.memoryGb !== undefined && f.memoryGb < 4) return "drift";
  return "live";
}

/** Reads the facts from the browser. */
export function deviceFacts(): DeviceFacts {
  const mq = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return {
    reducedMotion: mq("(prefers-reduced-motion: reduce)"),
    width: innerWidth,
    finePointer: mq("(hover: hover) and (pointer: fine)"),
    saveData: !!nav.connection?.saveData,
    webgl: probeWebGL(),
    memoryGb: nav.deviceMemory,
  };
}

function probeWebGL(): DeviceFacts["webgl"] {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "none";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) ? "software" : "hardware";
  } catch {
    return "none";
  }
}
