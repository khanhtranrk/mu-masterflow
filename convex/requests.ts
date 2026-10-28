import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { parse } from "yaml";

const requestStatus = v.union(
  v.literal("waiting"), v.literal("possessed"), v.literal("processing"),
  v.literal("process_failed"), v.literal("artifact_available"),
  v.literal("retrieve_artifact_failed"), v.literal("succeeded"),
);
const nodePlanStatus = v.union(v.literal("queue"), v.literal("running"), v.literal("failed"), v.literal("succeeded"));
const nodePlanEntry = v.object({ nodeName: v.string(), status: nodePlanStatus, device: v.optional(v.any()) });
const updateArgs = {
  id: v.id("requests"), status: v.optional(requestStatus), currentNode: v.optional(v.string()),
  progress: v.optional(v.number()), plan: v.optional(v.array(nodePlanEntry)),
  technical: v.optional(v.any()), unitId: v.optional(v.string()),
};

export const list = query({
  args: { specSlug: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { specSlug }) => ctx.db.query("requests").withIndex("by_spec_slug", q => q.eq("specSlug", specSlug)).order("desc").take(100),
});

export const create = mutation({
  args: { specSlug: v.string(), pipelineName: v.optional(v.string()), title: v.string(), params: v.any(), status: requestStatus },
  returns: v.id("requests"),
  handler: async (ctx, args) => {
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", args.specSlug)).first();
    if (!spec) throw new Error("Spec not found");
    const document = parse(spec.yaml) as Record<string, any> | null;
    const pipelines = document && typeof document.pipeline === "object" && !Array.isArray(document.pipeline) ? document.pipeline : {};
    const pipelineName = args.pipelineName ?? Object.keys(pipelines)[0];
    const pipeline = pipelineName ? pipelines[pipelineName] : undefined;
    if (args.pipelineName && !pipeline) throw new Error(`Pipeline '${args.pipelineName}' is not defined in this spec`);
    const requestArgs = { specSlug: args.specSlug, title: args.title, params: args.params, status: args.status };
    return ctx.db.insert("requests", {
      ...requestArgs,
      ...(pipelineName ? { pipelineName } : {}),
      technical: {}, plan: [], progress: 0,
    });
  },
});

async function applyRequestUpdate(ctx: MutationCtx, args: {
  id: Id<"requests">;
  status?: "waiting" | "possessed" | "processing" | "process_failed" | "artifact_available" | "retrieve_artifact_failed" | "succeeded";
  currentNode?: string;
  progress?: number;
  plan?: Array<{ nodeName: string; status: "queue" | "running" | "failed" | "succeeded"; device?: unknown }>;
  technical?: Record<string, unknown>;
  unitId?: string;
}) {
  const { id, ...patch } = args;
  const request = await ctx.db.get(id);
  if (!request) throw new Error("Request not found");
  await ctx.db.patch(id, {
    ...patch,
    technical: patch.technical ? { ...request.technical, ...patch.technical } : request.technical,
  });

  const terminal = ["process_failed", "retrieve_artifact_failed", "succeeded"].includes(args.status ?? "");
  if (terminal && request.unitId) {
    const unit = await ctx.db.query("units").withIndex("by_unit_id", q => q.eq("unitId", request.unitId!)).first();
    if (unit) {
      const active = (unit.currentRequestIds ?? (unit.currentRequestId ? [unit.currentRequestId] : [])).filter((requestId) => requestId !== id);
      await ctx.db.patch(unit._id, { currentRequestIds: active, status: active.length ? "busy" : "online", lastSeen: Date.now() });
    }
  }
  return id;
}

export const update = mutation({
  args: updateArgs,
  returns: v.id("requests"),
  handler: applyRequestUpdate,
});

export const updateFromWorker = internalMutation({
  args: updateArgs,
  returns: v.id("requests"),
  handler: applyRequestUpdate,
});
