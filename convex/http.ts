import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { isArtifactArray, type NodeUpdate } from "./artifactModel";
import type { Id } from "./_generated/dataModel";

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function selectionFilter(value: unknown, name: string): string | string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return requiredString(value, name);
  if (!value.length || value.length > 100) {
    throw new Error(`${name} must contain 1–100 non-empty strings`);
  }
  return [...new Set(value.map(item => requiredString(item, name)))];
}

function parseSelection(data: Record<string, unknown>) {
  const specSlug = requiredString(data.specSlug, "specSlug");
  const maxCount = data.maxCount ?? 1;
  if (!Number.isInteger(maxCount) || Number(maxCount) < 1 || Number(maxCount) > 100) {
    throw new Error("maxCount must be an integer from 1 to 100");
  }
  const byPipeline = selectionFilter(data.byPipeline, "byPipeline");
  const byUnitId = data.byUnitId === undefined
    ? undefined : requiredString(data.byUnitId, "byUnitId");
  const byStatus = selectionFilter(data.byStatus, "byStatus");
  return {
    specSlug,
    maxCount: maxCount as number,
    ...(byPipeline !== undefined ? { byPipeline } : {}),
    ...(byUnitId !== undefined ? { byUnitId } : {}),
    ...(byStatus !== undefined ? { byStatus } : {}),
  };
}

const http = httpRouter();
auth.addHttpRoutes(http);
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: jsonHeaders });
const options = httpAction(async () => new Response(null, { status: 204, headers: {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
} }));

// Public liveness probe: no authentication or database access required.
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true })),
});
http.route({ path: "/api/health", method: "OPTIONS", handler: options });

const authorize = async (
  ctx: ActionCtx,
  request: Request,
): Promise<Id<"unitTokens"> | null> => {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length);

  if (!token) {
    return null;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  const tokenHash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

  const unitToken = await ctx.runQuery(
    internal.unitTokens.getByHash,
    { tokenHash },
  );

  const valid = Boolean(
    unitToken &&
    unitToken.deletedAt === undefined &&
    (
      unitToken.expiresAt === undefined ||
      unitToken.expiresAt > Date.now()
    ),
  );
  if (
    valid &&
    unitToken &&
    (unitToken.lastUsedAt === undefined || Date.now() - unitToken.lastUsedAt >= 60_000)
  ) {
    await ctx.runMutation(internal.unitTokens.markUsed, {
      id: unitToken._id,
      usedAt: Date.now(),
    });
  }
  return valid && unitToken ? unitToken._id : null;
};

// Artifact registration is separate from byte upload. Native Convex upload URLs
// are bearer capabilities; worker tokens are only sent to our own API routes.
for (const path of ["upload-url", "complete", "download-url", "download"]) {
  http.route({ path: `/api/requests/artifacts/${path}`, method: "OPTIONS", handler: options });
}
for (const operation of ["upload-url", "complete"] as const) {
  http.route({
    path: `/api/requests/artifacts/${operation}`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      const tokenId = await authorize(ctx, request);
      if (!tokenId) return json({ error: "Unauthorized: provide an active unit token" }, 401);
      try {
        const body = objectBody(await request.json());
        const requestId = requiredString(body.requestId, "requestId") as Id<"requests">;
        if (operation === "upload-url") {
          const artifactId = requiredString(body.artifactId, "artifactId");
          const sha256 = requiredString(body.sha256, "sha256");
          // Command action stdout is text; accept canonical decimal byte counts.
          const size = typeof body.size === "string" && /^(0|[1-9][0-9]*)$/.test(body.size) ? Number(body.size) : body.size;
          if (typeof size !== "number") throw new Error("size is required and must be a number or decimal byte count");
          return json(await ctx.runMutation(internal.requestArtifacts.startFromWorker, {
            requestId, artifactId, sha256, size, tokenId,
          }));
        }
        const uploadId = requiredString(body.uploadId, "uploadId") as Id<"artifactUploads">;
        const storageId = requiredString(body.storageId, "storageId") as Id<"_storage">;
        const name = requiredString(body.name, "name");
        const nodeName = body.nodeName === undefined ? undefined : requiredString(body.nodeName, "nodeName");
        const label = body.label === undefined ? undefined : requiredString(body.label, "label");
        const artifact = await ctx.runMutation(internal.requestArtifacts.completeFromWorker, {
          requestId, uploadId, storageId, name, tokenId,
          ...(nodeName !== undefined ? { nodeName } : {}),
          ...(label !== undefined ? { label } : {}),
        });
        return json({ artifact });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid artifact request" }, 400);
      }
    }),
  });
}
for (const operation of ["download-url", "download"] as const) {
  http.route({
    path: `/api/requests/artifacts/${operation}`, method: "GET",
    handler: httpAction(async (ctx, request) => {
      if (!(await authorize(ctx, request))) return json({ error: "Unauthorized: provide an active unit token" }, 401);
      try {
        const params = new URL(request.url).searchParams;
        const requestId = requiredString(params.get("requestId"), "requestId") as Id<"requests">;
        const artifactId = requiredString(params.get("artifactId"), "artifactId");
        const artifact = await ctx.runQuery(internal.requestArtifacts.getForWorker, { requestId, artifactId });
        if (!artifact) return json({ error: "Artifact not found" }, 404);
        if (operation === "download-url") {
          const url = await ctx.storage.getUrl(artifact.storageId);
          if (!url) return json({ error: "File not found" }, 404);
          return json({ url, name: artifact.name, contentType: artifact.contentType, size: artifact.size });
        }
        if (artifact.size > 100 * 1024 * 1024) return json({ error: "File exceeds 100 MiB; use download-url" }, 413);
        const blob = await ctx.storage.get(artifact.storageId);
        if (!blob) return json({ error: "File not found" }, 404);
        return new Response(blob, { headers: {
          "content-type": artifact.contentType,
          "content-disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(artifact.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
          "access-control-allow-origin": "*", "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        } });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid artifact request" }, 400);
      }
    }),
  });
}

http.route({ path: "/api/notifications/send", method: "OPTIONS", handler: options });
http.route({ path: "/api/units/heartbeat", method: "OPTIONS", handler: options });
http.route({ path: "/api/requests/claim", method: "OPTIONS", handler: options });
http.route({ path: "/api/requests/create", method: "OPTIONS", handler: options });
http.route({ path: "/api/requests", method: "OPTIONS", handler: options });
http.route({ path: "/api/requests/report", method: "OPTIONS", handler: options });
http.route({ pathPrefix: "/api/specs/", method: "OPTIONS", handler: options });

http.route({
  path: "/api/notifications/send",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: provide an active unit token" },
        401,
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

      if (typeof data.title !== "string" || !data.title.trim()) {
        throw new Error("title is required");
      }

      if (typeof data.message !== "string" || !data.message.trim()) {
        throw new Error("message is required");
      }

      if (
        data.tags !== undefined &&
        (
          !Array.isArray(data.tags) ||
          !data.tags.every((tag) => typeof tag === "string")
        )
      ) {
        throw new Error("tags must be an array of strings");
      }

      const notificationId = await ctx.runMutation(
        internal.notifications.create,
        {
          title: data.title,
          message: data.message,
          ...(data.tags !== undefined
            ? { tags: data.tags as string[] }
            : {}),
        },
      );

      return json({ success: true, notificationId }, 200);
    } catch (error) {
      return json(
        {
          error: error instanceof Error
            ? error.message
            : "Invalid notification request",
        },
        400,
      );
    }
  }),
});

http.route({
  path: "/api/units/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: provide an active unit token" },
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
  path: "/api/requests/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: provide an active unit token" },
        401
      );
    }

    try {
      const body = objectBody(await request.json());
      const unitId = requiredString(body.unitId, "unitId");
      const selection = parseSelection(body);
      const claimed = await ctx.runMutation(internal.units.claim, {
        unitId,
        ...selection,
      });

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
  path: "/api/requests/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json({ error: "Unauthorized: provide an active unit token" }, 401);
    }
    try {
      const body = objectBody(await request.json());
      const specSlug = requiredString(body.specSlug, "specSlug");
      const pipelineName = requiredString(body.pipelineName, "pipelineName");
      if (!Object.prototype.hasOwnProperty.call(body, "payload")) {
        throw new Error("payload is required");
      }
      const requestId = await ctx.runMutation(internal.requests.createFromWorker, {
        specSlug, pipelineName, payload: body.payload,
      });
      return json({ requestId }, 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/api/requests",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json({ error: "Unauthorized: provide an active unit token" }, 401);
    }
    try {
      const params = new URL(request.url).searchParams;
      const data: Record<string, unknown> = {};
      for (const key of ["specSlug", "maxCount", "byPipeline", "byStatus", "byUnitId"]) {
        const values = params.getAll(key);
        if (values.length > 1) throw new Error(`${key} must occur only once`);
        if (values.length) data[key] = values[0];
      }
      if (data.maxCount !== undefined) {
        if (!/^\d+$/.test(data.maxCount as string)) {
          throw new Error("maxCount must be an integer from 1 to 100");
        }
        data.maxCount = Number(data.maxCount);
      }
      const result = await ctx.runQuery(internal.requests.inspect, parseSelection(data));
      return json(result);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/api/requests/report",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: provide an active unit token" },
        401
      );
    }

    try {
      const body = objectBody(await request.json());
      if (body.artifacts !== undefined) throw new Error("Register request artifacts through /api/requests/artifacts/complete");

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
        !validStatuses.includes(body.status as string)
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
        (body.node_states ?? {}) as Record<string, unknown>
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

        if (node.artifacts !== undefined && !isArtifactArray(node.artifacts)) {
          throw new Error(`Node "${nodeName}" requires an artifact metadata array with unique IDs; legacy path maps are no longer accepted`);
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
            status: body.status as "waiting" | "possessed" | "processing" | "process_failed" | "artifact_available" | "retrieve_artifact_failed" | "succeeded",
          }),
          ...(body.node_states !== undefined && {
            nodeStates: body.node_states as Record<string, NodeUpdate>,
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
  pathPrefix: "/api/specs/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(ctx, request))) {
      return json(
        { error: "Unauthorized: provide an active unit token" },
        401
      );
    }

    const pathname = new URL(request.url).pathname;
    const encodedSlug = pathname.slice("/api/specs/".length);

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
