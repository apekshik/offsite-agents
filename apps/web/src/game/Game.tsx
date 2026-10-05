// The 3D world: renderer, the office's world (the yacht), the captain, the crew. Owned by the
// game stream; the interface never imports from here (see src/bridge.ts).
export function Game(_: { officeId: string }) {
  return <canvas id="game" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}
