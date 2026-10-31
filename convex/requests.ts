import { artifact, isArtifactArray, nodeUpdate } from "./artifactModel";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { parse } from "yaml";
import { requireAuthenticated } from "./authz";
import type { MutationCtx } from "./_generated/server";
import { requestStatus, selectionArgs, selectRequests } from "./requestSelection";

export const list = query({
  args: { specSlug: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { specSlug }) => {
    await requireAuthenticated(ctx);
    return ctx.db.query("requests").withIndex("by_spec_slug", q => q.eq("specSlug", specSlug).eq("deletedAt", undefined)).order("desc").take(100);
  },
});

// Idempotent soft deletion preserves payload and execution history.
export const remove = mutation({
  args: { id: v.id("requests") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAuthenticated(ctx);
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Request not found.");
    if (request.deletedAt === undefined) await ctx.db.patch(id, { deletedAt: Date.now() });
    return null;
  },
});

// Requeue the same failed request; the transaction rechecks its latest status.
export const reset = mutation({
  args: { id: v.id("requests") },
  returns: v.id("requests"),
  handler: async (ctx, { id }) => {
    await requireAuthenticated(ctx);
    const request = await ctx.db.get(id);
    if (!request || request.deletedAt !== undefined) throw new Error("Request not found.");
    if (request.status !== "process_failed" && request.status !== "retrieve_artifact_failed" && request.status !== "failed") {
      throw new Error("Only failed requests can be reset.");
    }
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", request.specSlug)).first();
    if (!spec || spec.deletedAt !== undefined) throw new Error("The saved spec is no longer available.");
    const pipeline = parse(spec.yaml)?.pipeline?.[request.pipelineName];
    if (!pipeline || typeof pipeline !== "object" || Array.isArray(pipeline)) {
      throw new Error("This pipeline no longer exists in the saved spec.");
    }
    await ctx.db.patch(id, {
      status: "waiting",
      unitId: undefined,
      claimedAt: undefined,
      nodeStates: undefined,
      artifacts: undefined,
      resetVersion: (request.resetVersion ?? 0) + 1,
    });
    return id;
  },
});

export const create = mutation({
  args: {
    specSlug: v.string(),
    pipelineName: v.string(),
    payload: v.any(),
  },
  returns: v.id("requests"),
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);
    return createRequest(ctx, args);
  },
});

export const update = mutation({
  args: {
    id: v.id("requests"),
    payload: v.any(),
    status: v.optional(requestStatus),
  },
  returns: v.id("requests"),
  handler: async (ctx, args) => {
    await requireAuthenticated(ctx);
    const { id, ...patch } = args;
    const request = await ctx.db.get(id);
    if (!request || request.deletedAt !== undefined)
      throw new Error("Request not found");
    await ctx.db.patch(id, {...patch});
    return id;
  },
});

function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPayload(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateEditorPayload(payload: unknown, schema: Record<string, any>) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Request inputs must be an object.");
  const supplied = payload as Record<string, unknown>;
  for (const [name, raw] of Object.entries(schema)) {
    const definition = raw && typeof raw === "object" ? raw : {};
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) {
      if (!("default" in definition)) throw new Error(`Input ${name} is required by the saved pipeline.`);
      continue;
    }
    if (definition.type === "string" && typeof supplied[name] !== "string") throw new Error(`Input ${name} must be text.`);
    if (definition.type === "number" && (typeof supplied[name] !== "number" || !Number.isFinite(supplied[name]))) throw new Error(`Input ${name} must be a finite number.`);
  }
  for (const name of Object.keys(supplied)) if (!Object.prototype.hasOwnProperty.call(schema, name)) throw new Error(`Input ${name} is not declared in the saved pipeline.`);
}

export const editPayload = mutation({
  args: { id: v.id("requests"), payload: v.any(), expectedPayload: v.any() },
  returns: v.id("requests"),
  handler: async (ctx, { id, payload, expectedPayload }) => {
    await requireAuthenticated(ctx);
    const request = await ctx.db.get(id);
    if (!request || request.deletedAt !== undefined) throw new Error("Request not found.");
    if (request.status !== "waiting") throw new Error("This request has already left the waiting queue. Duplicate it to create a new run.");
    if (canonicalPayload(request.payload) !== canonicalPayload(expectedPayload)) throw new Error("This request was changed elsewhere. Close and reopen the editor to load its latest inputs.");
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", request.specSlug)).first();
    if (!spec || spec.deletedAt !== undefined) throw new Error("The saved spec is no longer available.");
    const document = parse(spec.yaml);
    const pipeline = document?.pipeline?.[request.pipelineName];
    if (!pipeline || typeof pipeline !== "object" || Array.isArray(pipeline)) throw new Error("This pipeline no longer exists in the saved spec.");
    validateEditorPayload(payload, pipeline.params ?? {});
    await ctx.db.patch(id, { payload });
    return id;
  },
});

export const report = internalMutation({
  args: {
    id: v.id("requests"),
    nodeStates: v.optional(v.record(v.string(), nodeUpdate)),
    status: v.optional(requestStatus),
  },
  returns: v.id("requests"),

  handler: async (ctx, args) => {
    const { id, nodeStates: incomingNodes, ...patch } = args;
    const request = await ctx.db.get(id);

    if (!request) {
      throw new Error("Request not found");
    }

    const nodeStates = { ...request.nodeStates };

    for (const [name, incoming] of Object.entries(incomingNodes ?? {})) {
      const previous = nodeStates[name];

      if (!previous && incoming.status === undefined) {
        throw new Error(`Node "${name}" requires a status when created`);
      }

      if (incoming.artifacts !== undefined) {
        if (!isArtifactArray(incoming.artifacts)) throw new Error(`Node "${name}" requires an artifact metadata array with unique IDs`);
        for (const entry of incoming.artifacts) {
          const registered = request.artifacts?.find(a => a.id === entry.id);
          if (!registered || canonicalPayload(registered) !== canonicalPayload(entry)) {
            throw new Error(`Node "${name}" artifact "${entry.id}" must match a registered request artifact`);
          }
          if (registered.nodeName !== undefined && registered.nodeName !== name) {
            throw new Error(`Artifact "${entry.id}" belongs to node "${registered.nodeName}"`);
          }
        }
      }
      nodeStates[name] = {
        ...previous,
        ...incoming,
        status: incoming.status ?? previous?.status!,
        ...(incoming.reason !== undefined ? { reason: incoming.reason }
          : incoming.status !== undefined && incoming.status !== previous?.status ? { reason: "" } : {}),
        artifacts: incoming.artifacts ?? previous?.artifacts ?? (request.artifacts ?? []).filter(a => a.nodeName === name),
        logs: [
          ...(previous?.logs ?? []),
          ...(incoming.logs ?? []),
        ],
      };
    }

    await ctx.db.patch(id, {
      ...patch,
      ...(incomingNodes ? { nodeStates } : {}),
    });

    return id;
  },
});

const createArgs = { specSlug: v.string(), pipelineName: v.string(), payload: v.any() };

async function createRequest(
  ctx: MutationCtx,
  args: { specSlug: string; pipelineName: string; payload: unknown },
) {
  const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", args.specSlug)).first();
  if (!spec || spec.deletedAt !== undefined) throw new Error("Spec not found");

  const document = parse(spec.yaml) as Record<string, any> | null;

  const pipelines = document && typeof document.pipeline === "object" && !Array.isArray(document.pipeline) ? document.pipeline : {};
  const pipelineName = args.pipelineName;
  const pipeline = pipelineName ? pipelines[pipelineName] : undefined;

  if (args.pipelineName && !pipeline)
    throw new Error(`Pipeline '${args.pipelineName}' is not defined in this spec`);

  const requestArgs = {
    specSlug: args.specSlug,
    payload: args.payload,
  };

  return ctx.db.insert("requests", {
    ...requestArgs,
    pipelineName,
    status: "waiting"
  });
}

// Worker creation only inserts a waiting request; it never claims or executes it.
export const createFromWorker = internalMutation({
  args: createArgs,
  returns: v.id("requests"),
  handler: createRequest,
});

export const inspect = internalQuery({
  args: selectionArgs,
  returns: v.array(v.object({
    requestId: v.id("requests"),
    artifacts: v.optional(v.array(artifact)),
    payload: v.any(),
    specSlug: v.string(),
    pipelineName: v.string(),
    status: v.string(),
    unitId: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const requests = await selectRequests(ctx, args);
    return requests.map(request => ({
      requestId: request._id,
      ...(request.artifacts !== undefined ? { artifacts: request.artifacts } : {}),
      payload: request.payload,
      specSlug: request.specSlug,
      pipelineName: request.pipelineName,
      status: request.status,
      ...(request.unitId !== undefined ? { unitId: request.unitId } : {}),
    }));
  },
});
