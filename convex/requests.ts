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
    return ctx.db.query("requests").withIndex("by_spec_slug", q => q.eq("specSlug", specSlug)).order("desc").take(100);
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
    if (!request)
      throw new Error("Request not found");
    await ctx.db.patch(id, {...patch});
    return id;
  },
});

export const report = internalMutation({
  args: {
    id: v.id("requests"),
    nodeStates: v.optional(v.record(
      v.string(),
      v.object({
        status: v.optional(v.string()),
        device: v.optional(v.object({
          family: v.string(),
          index: v.number(),
        })),
        artifacts: v.optional(v.record(
          v.string(),
          v.string()
        )),
        logs: v.optional(v.array(v.string())),
      }),
    )),
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

      nodeStates[name] = {
        ...previous,
        ...incoming,
        status: incoming.status ?? previous?.status!,
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
  if (!spec) throw new Error("Spec not found");

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
      payload: request.payload,
      specSlug: request.specSlug,
      pipelineName: request.pipelineName,
      status: request.status,
      ...(request.unitId !== undefined ? { unitId: request.unitId } : {}),
    }));
  },
});
