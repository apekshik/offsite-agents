import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { login, pairLink } from "./login.ts";
import { configFile, readConfig, useDeployment, PRODUCTION } from "./config.ts";
import { parseLook } from "./lookPrompt.ts";
import { simLookLines } from "@offsite/harness";
import { RUNNER_COMMAND } from "@offsite/contracts";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

let server: Server | null = null;
let home: string | null = null;
afterEach(async () => { server?.close(); delete process.env["OFFSITE_HOME"]; if (home) await rm(home, { recursive: true, force: true }); });

it("pairs by device code and saves the token for this user only", async () => {
  home = await mkdtemp(join(tmpdir(), "offsite-login-"));
  process.env["OFFSITE_HOME"] = home;
  let polls = 0;
  const seen: unknown[] = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      seen.push([req.url, JSON.parse(body)]);
      res.setHeader("content-type", "application/json");
      if (req.url === "/device/start") res.end(JSON.stringify({ deviceCode: "dc", userCode: "ABCD-EFGH", verifyUrl: "http://app/?connect=ABCD-EFGH", interval: 0.001, expiresIn: 60 }));
      else res.end(JSON.stringify(++polls < 3 ? { status: "pending" } : { status: "approved", token: "ofr_secret" }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const out: string[] = [];
  const opened: string[] = [];
  const config = await login({
    convexUrl: "https://x.convex.cloud", siteUrl: `http://127.0.0.1:${port}`, name: "Mac", os: "macOS 26.4",
    open: (url) => { opened.push(url); return true; }, log: (s) => out.push(plain(s)), sleep: async () => {},
  });
  expect(config).toEqual({ convexUrl: "https://x.convex.cloud", siteUrl: `http://127.0.0.1:${port}`, token: "ofr_secret", name: "Mac" });
  expect(out.join("\n")).toContain("ABCD-EFGH");
  // The approval page, opened and printed: /pair on the app, even from a deployment that still answers ?connect=.
  expect(opened).toEqual(["http://app/pair?code=ABCD-EFGH"]);
  expect(out.join("\n")).toContain("http://app/pair?code=ABCD-EFGH");
  expect(out.at(-1)).toBe(`✓ Paired as "Mac". Run \`${RUNNER_COMMAND}\` to take on work.`);
  expect(seen[0]).toEqual(["/device/start", { name: "Mac", hostname: expect.any(String), os: "macOS 26.4" }]);
  expect(seen[1]).toEqual(["/device/poll", { deviceCode: "dc" }]);
  // Kept per deployment: another deployment's pairing never stands in for Offsite's own.
  useDeployment("https://x.convex.cloud");
  expect(await readConfig()).toEqual(config);
  expect(configFile("https://x.convex.cloud")).toBe(join(home, "runner.x.json"));
  expect((await stat(join(home, "runner.x.json"))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(home, "runner.x.json"), "utf8")).token).toBe("ofr_secret");
  useDeployment(PRODUCTION.convexUrl);
  expect(await readConfig()).toBeNull();
});

it("moves an old dev pairing out of runner.json so Offsite's own doesn't pick it up", async () => {
  home = await mkdtemp(join(tmpdir(), "offsite-login-"));
  process.env["OFFSITE_HOME"] = home;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(home, "runner.json"), JSON.stringify({ convexUrl: "https://dev-one.convex.cloud", siteUrl: "https://dev-one.convex.site", token: "ofr_dev", name: "Mac" }));
  useDeployment(PRODUCTION.convexUrl);
  expect(await readConfig()).toBeNull();
  // Moved aside already, so pairing with Offsite's own can't overwrite it.
  await expect(stat(join(home, "runner.json"))).rejects.toThrow();
  useDeployment("https://dev-one.convex.cloud");
  expect((await readConfig())?.token).toBe("ofr_dev");
  expect(JSON.parse(await readFile(join(home, "runner.dev-one.json"), "utf8")).token).toBe("ofr_dev");
  useDeployment(PRODUCTION.convexUrl);
});

it("doesn't tell `offsite start` to run itself when it pairs on the way up", async () => {
  home = await mkdtemp(join(tmpdir(), "offsite-login-"));
  process.env["OFFSITE_HOME"] = home;
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/device/start"
        ? { deviceCode: "dc", userCode: "ABCD-EFGH", verifyUrl: "http://app/?connect=ABCD-EFGH", interval: 0.001, expiresIn: 60 }
        : { status: "approved", token: "ofr_secret" }));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const out: string[] = [];
  await login({ convexUrl: "https://x.convex.cloud", siteUrl: `http://127.0.0.1:${port}`, name: "Mac", starting: true, log: (s) => out.push(plain(s)), sleep: async () => {} });
  expect(out.at(-1)).toBe('✓ Paired as "Mac".');
  expect(out.join("\n")).not.toContain("to take on work");
  // Nothing opened a browser: the link is printed to open by hand.
  expect(out.join("\n")).toContain("Approve it here:\n  http://app/pair?code=ABCD-EFGH");
});

it("links to the app's /pair page for a code", () => {
  expect(pairLink("https://offsiteagents.app/?connect=K7QD-3MPX", "K7QD-3MPX")).toBe("https://offsiteagents.app/pair?code=K7QD-3MPX");
  expect(pairLink("http://localhost:5180/pair?code=K7QD-3MPX", "K7QD-3MPX")).toBe("http://localhost:5180/pair?code=K7QD-3MPX");
  expect(pairLink("not a url", "K7QD-3MPX")).toBe("not a url");
});

it("reads a designed look from JSON Lines, and says what is wrong with a bad one", () => {
  const { rng } = { rng: (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647) };
  const good = parseLook(["Sure, here it is:", ...simLookLines(rng(3), "sun hat")].join("\n"));
  expect(good.ok && good.look.pieces.length).toBe(6);
  const bad = parseLook('{"t":"meta","name":"x"}\n{"t":"piece","bone":"tail","shape":"box","pos":[0,0,0],"size":[1,1,1],"color":"#ffffff"}');
  expect(bad).toEqual({ ok: false, error: expect.stringMatching(/^pieces\.0\.bone/) });
  expect(parseLook("no json here")).toEqual({ ok: false, error: expect.stringContaining("meta") });
});
