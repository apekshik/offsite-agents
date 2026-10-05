import { ConvexProviderWithAuth, useConvexAuth } from "convex/react";
import { convex } from "./convex.ts";
import { useOffsiteAuth } from "./auth.ts";
import { Gate } from "./screens/Gate.tsx";
import { Pair } from "./screens/Pair.tsx";

// Offsite: the 3D world (src/game) under the interface (src/overlay, src/screens, src/ui).
// They meet only in src/bridge.ts.
export function App() {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useOffsiteAuth}>
      <Routes />
    </ConvexProviderWithAuth>
  );
}

/**
 * /pair?code= approves a machine (from the runner, RUNNER_COMMAND); everything else is the way aboard. Coming back from
 * sign-in, the address is /callback until auth settles and puts back where sign-in started, so this reads it again then.
 */
function Routes() {
  useConvexAuth();
  return location.pathname === "/pair" ? <Pair /> : <Gate />;
}
