import { useConvexAuth } from "convex/react";

// Signed out → sign in. Signed in without a ship → make one. Otherwise → aboard (the game under
// the overlay). Wired to the backend (users.me, offices.list) once it lands.
export function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <p style={{ padding: 24 }}>Sign in to Offsite.</p>;
  return <p style={{ padding: 24 }}>Signed in.</p>;
}
