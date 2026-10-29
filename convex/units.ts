import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireAuthenticated } from "./authz";

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireAuthenticated(ctx);
    return ctx.db.query("units").order("desc").take(200);
  },
});

export const heartbeat = internalMutation({
  args: {
    unitId: v.string(),
    unitType: v.string(),
    workingDir: v.string(),
    status: v.union(
      v.literal("online"),
      v.literal("offline")
    ),
    devices: v.array(
      v.object({
        family: v.string(),
        index: v.number(),
      })
    ),
  },

  returns: v.object({
    ok: v.boolean(),
  }),

  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("units")
      .withIndex(
        "by_unit_id",
        q => q.eq("unitId", args.unitId)
      )
      .first();

    const lastSeen = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastSeen,
      });
    } else {
      await ctx.db.insert("units", {
        ...args,
        lastSeen,
      });
    }

    return { ok: true };
  },
});

export const claim = internalMutation({
  args: {
    unitId: v.string(),
    specSlug: v.string(),
    maxCount: v.number(),
  },

  returns: v.array(v.object({
    requestId: v.id("requests"),
    payload: v.any(),
    specSlug: v.string(),
    pipelineName: v.string(),
  })),

  handler: async (ctx, { unitId, specSlug, maxCount }) => {
    const unit = await ctx.db
      .query("units")
      .withIndex("by_unit_id", q => q.eq("unitId", unitId))
      .first();

    if (!unit) {
      throw new Error(
        "Register this unit with a heartbeat before claiming work"
      );
    }

    const waiting = await ctx.db
      .query("requests")
      .withIndex(
        "by_spec_slug_and_status",
        q => q.eq("specSlug", specSlug).eq("status", "waiting")
      )
      .order("asc")
      .take(maxCount);

    const claimed = [];

    for (const request of waiting) {
      await ctx.db.patch(request._id, {
        status: "possessed",
        unitId,
        claimedAt: Date.now(),
      });

      claimed.push({
        requestId: request._id,
        payload: request.payload,
        specSlug,
        pipelineName: request.pipelineName,
      });
    }

    await ctx.db.patch(unit._id, {
      lastSeen: Date.now(),
    });

    return claimed;
  },
});
