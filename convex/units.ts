import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const claimedRequestValidator = v.object({
  requestId: v.id("requests"),
  params: v.any(),
  specSlug: v.string(),
  pipelineName: v.optional(v.string()),
  status: v.literal("received"),
  plan: v.array(v.any()),
});

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => ctx.db.query("units").order("desc").take(200),
});

export const heartbeat = internalMutation({
  args: {
    unitId: v.string(), unitType: v.string(), workingDir: v.string(), status: v.string(),
    specSlugs: v.array(v.string()), workloads: v.array(v.string()), devices: v.array(v.any()), metadata: v.any(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("units").withIndex("by_unit_id", q => q.eq("unitId", args.unitId)).first();
    const activeRequests = existing?.currentRequestIds ?? (existing?.currentRequestId ? [existing.currentRequestId] : []);
    const status = activeRequests.length ? "busy" : args.status;
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, status, currentRequestIds: activeRequests, lastSeen: Date.now() });
    } else {
      await ctx.db.insert("units", { ...args, status, currentRequestIds: [], lastSeen: Date.now() });
    }
    return { ok: true };
  },
});

export const claim = internalMutation({
  args: { unitId: v.string(), specSlug: v.string(), maxCount: v.number() },
  returns: v.array(claimedRequestValidator),
  handler: async (ctx, { unitId, specSlug, maxCount }) => {
    const unit = await ctx.db.query("units").withIndex("by_unit_id", q => q.eq("unitId", unitId)).first();
    if (!unit) throw new Error("Register this unit with a heartbeat before claiming work");
    if (!unit.specSlugs.includes(specSlug)) throw new Error("Unit is not subscribed to this spec space");

    const limit = Math.min(Math.max(Math.floor(maxCount), 1), 100);
    const waiting = await ctx.db.query("requests")
      .withIndex("by_spec_slug_and_status", q => q.eq("specSlug", specSlug).eq("status", "waiting"))
      .order("asc")
      .take(limit);
    const claimed = [];
    for (const request of waiting) {
      await ctx.db.patch(request._id, {
        status: "possessed", unitId,
        technical: { ...request.technical, claimedAt: Date.now() },
      });
      claimed.push({
        requestId: request._id,
        params: request.params,
        specSlug,
        ...(request.pipelineName ? { pipelineName: request.pipelineName } : {}),
        status: "received" as const,
        plan: request.plan ?? [],
      });
    }
    const activeRequests = unit.currentRequestIds ?? (unit.currentRequestId ? [unit.currentRequestId] : []);
    const claimedIds = claimed.map((request) => request.requestId);
    await ctx.db.patch(unit._id, {
      currentRequestIds: [...new Set([...activeRequests, ...claimedIds])],
      status: claimed.length ? "busy" : unit.status,
      lastSeen: Date.now(),
    });
    return claimed;
  },
});
