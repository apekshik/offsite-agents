// Dev sign-in: on your own machine, sign in as anyone without WorkOS, so you (or an agent
// testing the app) can open Offsite as a throwaway captain:
//
//   http://localhost:5180/?dev=alice      signed in as "alice"
//
// Three locks keep it out of production:
//   1. Tokens are signed by the Vite dev server (apps/web/vite.config.ts, `vite` only: never in a
//      build), with a private key that lives in .env.local on this machine.
//   2. Convex only accepts them where DEV_AUTH_JWKS is set (convex/auth.config.ts), and this
//      script refuses to set it anywhere but a dev deployment.
//   3. The browser's half is behind import.meta.env.DEV, so a production build lacks it.
//
// Set up once per machine (writes the key, sets the dev deployment's JWKS):
//
//   node scripts/devauth.mjs
//
// Adapted from Ready Player One.

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEV_ISSUER = "http://localhost/offsite-dev"; // convex/auth.config.ts accepts this issuer
const AUDIENCE = "offsite-dev";
const KID = "offsite-dev-1";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A token for `user`, an hour long, signed with the key from .env.local (base64 of the PEM). */
export function devToken(privateKeyB64, user) {
  const key = createPrivateKey(Buffer.from(privateKeyB64, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID }));
  const body = b64url(JSON.stringify({ iss: DEV_ISSUER, aud: AUDIENCE, sub: `dev|${user}`, name: user, iat: now, exp: now + 3600 }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const ENV = ".env.local";
  const env = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const deployment = env.match(/^CONVEX_DEPLOYMENT=([^\s#]*)/m)?.[1] ?? "";
  if (!/^(dev|anonymous|local):/.test(deployment)) {
    console.error(`Refusing: dev sign-in is only for a dev or local Convex deployment (CONVEX_DEPLOYMENT=${deployment || "?"}).`);
    process.exit(1);
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwk = { ...createPublicKey(privateKey).export({ format: "jwk" }), kid: KID, alg: "ES256", use: "sig" };
  const jwks = `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64")}`;
  const line = `DEV_AUTH_PRIVATE_KEY=${Buffer.from(pem).toString("base64")}`;
  writeFileSync(ENV, /^DEV_AUTH_PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^DEV_AUTH_PRIVATE_KEY=.*$/m, line) : `${env.replace(/\n?$/, "\n")}${line}\n`);
  execFileSync("npx", ["convex", "env", "set", "DEV_AUTH_JWKS", jwks], { stdio: "inherit", shell: process.platform === "win32" });
  console.log("Dev sign-in ready: restart `pnpm dev`, then open http://localhost:5180/?dev=yourname");
}
