// Sign-in is WorkOS AuthKit: Convex checks the access token the browser sends against WorkOS's
// keys. Set WORKOS_CLIENT_ID on each deployment.
//
// A dev deployment may also accept dev sign-in tokens (scripts/devauth.mjs), but only when
// DEV_AUTH_JWKS is set on it. That script sets it on dev deployments only, never production.
// (Reading an env var a deployment lacks is an error while pushing, hence the try.)
// Adapted from Ready Player One.
let clientId = "";
try { clientId = process.env.WORKOS_CLIENT_ID ?? ""; } catch { clientId = ""; }
let devJwks = "";
try { devJwks = process.env.DEV_AUTH_JWKS ?? ""; } catch { devJwks = ""; }

// Must match scripts/devauth.mjs.
const DEV_ISSUER = "http://localhost/offsite-dev";
const DEV_AUDIENCE = "offsite-dev";

export default {
  providers: [
    ...(clientId
      ? [
          { type: "customJwt", issuer: "https://api.workos.com/", algorithm: "RS256", jwks: `https://api.workos.com/sso/jwks/${clientId}`, applicationID: clientId },
          { type: "customJwt", issuer: `https://api.workos.com/user_management/${clientId}`, algorithm: "RS256", jwks: `https://api.workos.com/sso/jwks/${clientId}` },
        ]
      : []),
    ...(devJwks ? [{ type: "customJwt", issuer: DEV_ISSUER, algorithm: "ES256", jwks: devJwks, applicationID: DEV_AUDIENCE }] : []),
  ],
};
