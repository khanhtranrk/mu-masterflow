import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const authorize = (request: Request) => {
  const secret = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.MASTERFLOW_HOOK_TOKEN;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const options = httpAction(async () => new Response(null, { status: 204, headers: {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
} }));

http.route({ path: "/hooks/units/heartbeat", method: "OPTIONS", handler: options });
http.route({ path: "/hooks/requests/claim", method: "OPTIONS", handler: options });
http.route({ path: "/hooks/requests/update", method: "OPTIONS", handler: options });
http.route({ pathPrefix: "/hooks/specs/", method: "OPTIONS", handler: options });

http.route({ path: "/hooks/units/heartbeat", method: "POST", handler: httpAction(async (ctx, request) => {
  if (!authorize(request)) return json({ error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" }, 401);
  try {
    const body = await request.json() as Record<string, any>;
    if (typeof body.unitId !== "string" || !body.unitId) throw new Error("unitId is required");
    if (body.devices !== undefined && !Array.isArray(body.devices)) throw new Error("devices must be an array");
    const devices = body.devices ?? [];
    for (const device of devices) {
      if (typeof device?.family !== "string" || typeof device?.index !== "number" || typeof device?.maxUnits !== "number") {
        throw new Error("each device needs family, index, and maxUnits");
      }
    }
    return json(await ctx.runMutation(internal.units.heartbeat, {
      unitId: body.unitId,
      unitType: typeof body.unitType === "string" ? body.unitType : "unknown",
      workingDir: typeof body.workingDir === "string" ? body.workingDir : "",
      status: typeof body.status === "string" ? body.status : "online",
      specSlugs: Array.isArray(body.specSlugs) ? body.specSlugs : [],
      workloads: Array.isArray(body.workloads) ? body.workloads : [],
      devices,
      metadata: body.metadata ?? {},
    }));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
}) });

http.route({ path: "/hooks/requests/claim", method: "POST", handler: httpAction(async (ctx, request) => {
  if (!authorize(request)) return json({ error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" }, 401);
  try {
    const body = await request.json() as Record<string, any>;
    if (typeof body.unitId !== "string" || typeof body.specSlug !== "string") throw new Error("unitId and specSlug are required");
    if (body.status !== undefined && body.status !== "waiting") throw new Error("claim status must be 'waiting'");
    const maxCount = body.maxCount ?? 1;
    if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100) throw new Error("maxCount must be an integer from 1 to 100");
    return json(await ctx.runMutation(internal.units.claim, { unitId: body.unitId, specSlug: body.specSlug, maxCount }));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
}) });

http.route({ path: "/hooks/requests/update", method: "POST", handler: httpAction(async (ctx, request) => {
  if (!authorize(request)) return json({ error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" }, 401);
  try {
    const body = await request.json() as Record<string, any>;
    if (typeof body.id !== "string") throw new Error("id is required");
    if (body.plan !== undefined) {
      if (!Array.isArray(body.plan)) throw new Error("plan must be an array");
      for (const node of body.plan) {
        if (typeof node?.nodeName !== "string" || !["queue", "running", "failed", "succeeded"].includes(node.status)) {
          throw new Error("each plan item needs nodeName and a valid node status");
        }
        if (node.device !== undefined && (typeof node.device.family !== "string" || typeof node.device.index !== "number")) {
          throw new Error("plan device needs family and index");
        }
      }
    }
    const { id, ...patch } = body;
    await ctx.runMutation(internal.requests.updateFromWorker, { id: id as never, ...patch });
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
}) });

http.route({ pathPrefix: "/hooks/specs/", method: "GET", handler: httpAction(async (ctx, request) => {
  if (!authorize(request)) return json({ error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" }, 401);
  try {
    const pathname = new URL(request.url).pathname;
    const encodedSlug = pathname.slice("/hooks/specs/".length);
    if (!encodedSlug || encodedSlug.includes("/")) return json({ error: "specSlug is required" }, 400);
    const specSlug = decodeURIComponent(encodedSlug);
    const yaml = await ctx.runQuery(internal.specs.getYaml, { slug: specSlug });
    if (yaml === null) return json({ error: "Spec not found" }, 404);
    return new Response(yaml, { status: 200, headers: {
      "content-type": "application/yaml; charset=utf-8",
      "content-disposition": `inline; filename="${specSlug}.yaml"`,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    } });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
}) });

export default http;
