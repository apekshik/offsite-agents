import { ConvexProviderWithAuth } from "convex/react";
import { convex } from "./convex.ts";
import { useOffsiteAuth } from "./auth.ts";
import { Gate } from "./screens/Gate.tsx";

// Offsite: the 3D world (src/game) under the interface (src/overlay, src/screens, src/ui).
// They meet only in src/bridge.ts.
export function App() {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useOffsiteAuth}>
      <Gate />
    </ConvexProviderWithAuth>
  );
}
