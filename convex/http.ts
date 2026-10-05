import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Device-code pairing for `offsite login`. The runner has no browser session, so it talks plain
// HTTP here; the captain approves the code in the app.

const http = httpRouter();
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

http.route({ path: "/device/start", method: "OPTIONS", handler: preflight });
http.route({ path: "/device/poll", method: "OPTIONS", handler: preflight });

http.route({
  path: "/device/start",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; hostname?: unknown };
    const name = typeof body.name === "string" ? body.name : "My machine";
    const hostname = typeof body.hostname === "string" ? body.hostname : "";
    const { deviceCode, userCode, expiresIn } = await ctx.runMutation(internal.machines.startCode, { name, hostname });
    const site = process.env["SITE_URL"] ?? "http://localhost:5180";
    return json({ deviceCode, userCode, verifyUrl: `${site}/?connect=${userCode}`, interval: 2.5, expiresIn });
  }),
});

http.route({
  path: "/device/poll",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { deviceCode?: unknown };
    if (typeof body.deviceCode !== "string") return json({ error: "deviceCode required" }, 400);
    return json(await ctx.runMutation(internal.machines.pollCode, { deviceCode: body.deviceCode }));
  }),
});

export default http;
