import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const options = httpAction(async () => new Response(null, { status: 204, headers: {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
} }));

const authorize = async (
  ctx: ActionCtx,
  request: Request,
): Promise<boolean> => {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const token = authorization.slice("Bearer ".length);

  if (!token) {
    return false;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  const tokenHash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  const authToken = await ctx.runQuery(
    internal.authTokens.getByHash,
    { tokenHash },
  );

  return Boolean(
    authToken &&
    authToken.deletedAt === undefined &&
    (
      authToken.expiresAt === undefined ||
      authToken.expiresAt > Date.now()
    ),
  );
};

http.route({ path: "/hooks/units/heartbeat", method: "OPTIONS", handler: options });
http.route({ path: "/hooks/requests/claim", method: "OPTIONS", handler: options });
http.route({ path: "/hooks/requests", method: "OPTIONS", handler: options });
http.route({ pathPrefix: "/hooks/specs/", method: "OPTIONS", handler: options });

http.route({
  path: "/hooks/units/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" },
        401
      );
    }

    try {
      const body: unknown = await request.json();

      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        throw new Error("Request body must be an object");
      }

      const data = body as Record<string, unknown>;

      if (typeof data.unitId !== "string" || !data.unitId.trim()) {
        throw new Error("unitId is required");
      }

      if (
        data.status !== "online" &&
        data.status !== "offline"
      ) {
        throw new Error("Invalid unit status");
      }

      if (
        data.unitType !== undefined &&
        typeof data.unitType !== "string"
      ) {
        throw new Error("unitType must be a string");
      }

      if (
        data.workingDir !== undefined &&
        typeof data.workingDir !== "string"
      ) {
        throw new Error("workingDir must be a string");
      }

      const rawDevices = data.devices ?? [];

      if (!Array.isArray(rawDevices)) {
        throw new Error("devices must be an array");
      }

      const devices = rawDevices.map((device, index) => {
        if (
          !device ||
          typeof device !== "object" ||
          Array.isArray(device)
        ) {
          throw new Error(`devices[${index}] must be an object`);
        }

        const item = device as Record<string, unknown>;

        if (
          typeof item.family !== "string" ||
          typeof item.index !== "number"
        ) {
          throw new Error(
            `devices[${index}] requires family and index`
          );
        }

        return {
          family: item.family,
          index: item.index,
        };
      });

      const result = await ctx.runMutation(
        internal.units.heartbeat,
        {
          unitId: data.unitId,
          unitType: data.unitType ?? "unknown",
          workingDir: data.workingDir ?? "",
          status: data.status,
          devices,
        }
      );

      return json(result);
    } catch (error) {
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Invalid request",
        },
        400
      );
    }
  }),
});

http.route({
  path: "/hooks/requests/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" },
        401
      );
    }

    try {
      const body = await request.json() as Record<string, any>;

      if (
        typeof body.unitId !== "string" ||
        !body.unitId.trim() ||
        typeof body.specSlug !== "string" ||
        !body.specSlug.trim()
      ) {
        throw new Error("unitId and specSlug are required");
      }

      const maxCount = body.maxCount ?? 1;

      if (
        !Number.isInteger(maxCount) ||
        maxCount < 1 ||
        maxCount > 100
      ) {
        throw new Error("maxCount must be an integer from 1 to 100");
      }

      const claimed = await ctx.runMutation(
        internal.units.claim,
        {
          unitId: body.unitId,
          specSlug: body.specSlug,
          maxCount,
        }
      );

      return json(claimed);
    } catch (error) {
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Invalid request",
        },
        400
      );
    }
  }),
});

http.route({
  path: "/hooks/requests/report",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" },
        401
      );
    }

    try {
      const body = await request.json() as Record<string, any>;

      if (typeof body.id !== "string") {
        throw new Error("id is required");
      }

      const validStatuses = [
        "waiting",
        "possessed",
        "processing",
        "process_failed",
        "artifact_available",
        "retrieve_artifact_failed",
        "succeeded",
      ];

      if (
        body.status !== undefined &&
        !validStatuses.includes(body.status)
      ) {
        throw new Error(`Invalid status: ${body.status}`);
      }

      if (
        body.node_states !== undefined &&
        (
          !body.node_states ||
          typeof body.node_states !== "object" ||
          Array.isArray(body.node_states)
        )
      ) {
        throw new Error("node_states must be an object");
      }

      const validNodeStatuses = [
        "queue",
        "running",
        "failed",
        "succeeded",
      ];

      for (const [nodeName, rawNode] of Object.entries(
        body.node_states ?? {}
      )) {
        if (
          !rawNode ||
          typeof rawNode !== "object" ||
          Array.isArray(rawNode)
        ) {
          throw new Error(`Node "${nodeName}" has an invalid structure`);
        }

        const node = rawNode as Record<string, any>;

        if (
          node.status !== undefined &&
          (
            typeof node.status !== "string" ||
            !validNodeStatuses.includes(node.status)
          )
        ) {
          throw new Error(`Node "${nodeName}" has an invalid status`);
        }

        if (node.device !== undefined) {
          if (
            !node.device ||
            typeof node.device !== "object" ||
            Array.isArray(node.device) ||
            typeof node.device.family !== "string" ||
            typeof node.device.index !== "number"
          ) {
            throw new Error(`Node "${nodeName}" has an invalid device`);
          }
        }

        if (
          node.artifacts !== undefined &&
          (
            !node.artifacts ||
            typeof node.artifacts !== "object" ||
            Array.isArray(node.artifacts) ||
            !Object.values(node.artifacts).every(
              value => typeof value === "string"
            )
          )
        ) {
          throw new Error(`Node "${nodeName}" has invalid artifacts`);
        }

        if (
          node.logs !== undefined &&
          (
            !Array.isArray(node.logs) ||
            !node.logs.every(value => typeof value === "string")
          )
        ) {
          throw new Error(`Node "${nodeName}" has invalid logs`);
        }
      }

      await ctx.runMutation(
        internal.requests.report,
        {
          id: body.id as never,
          ...(body.status !== undefined && {
            status: body.status,
          }),
          ...(body.node_states !== undefined && {
            nodeStates: body.node_states,
          }),
        }
      );

      return json({ ok: true });
    } catch (error) {
      return json({
        error: error instanceof Error
          ? error.message
          : "Invalid request",
      }, 400);
    }
  }),
});

http.route({
  pathPrefix: "/hooks/specs/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: configure MASTERFLOW_HOOK_TOKEN" },
        401
      );
    }

    const pathname = new URL(request.url).pathname;
    const encodedSlug = pathname.slice("/hooks/specs/".length);

    if (!encodedSlug || encodedSlug.includes("/")) {
      return json({ error: "specSlug is required" }, 400);
    }

    let specSlug: string;

    try {
      specSlug = decodeURIComponent(encodedSlug);
    } catch {
      return json({ error: "Invalid specSlug encoding" }, 400);
    }

    try {
      const yaml = await ctx.runQuery(
        internal.specs.getYaml,
        { slug: specSlug }
      );

      if (yaml === null) {
        return json({ error: "Spec not found" }, 404);
      }

      return new Response(yaml, {
        status: 200,
        headers: {
          "content-type": "application/yaml; charset=utf-8",
          "content-disposition": `inline; filename="${specSlug}.yaml"`,
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Failed to retrieve spec",
        },
        400
      );
    }
  }),
});

export default http;
