import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { parse } from "yaml";

const requestStatus = v.union(
  v.literal("waiting"), v.literal("possessed"), v.literal("processing"),
  v.literal("process_failed"), v.literal("artifact_available"),
  v.literal("retrieve_artifact_failed"), v.literal("succeeded"),
);
export const list = query({
  args: { specSlug: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { specSlug }) => ctx.db.query("requests").withIndex("by_spec_slug", q => q.eq("specSlug", specSlug)).order("desc").take(100),
});

export const create = mutation({
  args: {
    specSlug: v.string(),
    pipelineName: v.string(),
    payload: v.any(),
  },
  returns: v.id("requests"),
  handler: async (ctx, args) => {
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", args.specSlug)).first();
    if (!spec) throw new Error("Spec not found");

    const document = parse(spec.yaml) as Record<string, any> | null;

    const pipelines = document && typeof document.pipeline === "object" && !Array.isArray(document.pipeline) ? document.pipeline : {};
    const pipelineName = args.pipelineName ?? Object.keys(pipelines)[0];
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
