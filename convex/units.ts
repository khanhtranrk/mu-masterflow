import { artifact } from "./artifactModel";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { workerIdentity } from "./workerAccess";
import { requireAuthenticated } from "./authz";
import { selectionArgs, selectRequests } from "./requestSelection";

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
    tokenId: v.id("unitTokens"),
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
    const token = await workerIdentity(ctx, args.tokenId);
    if (token.unitId !== args.unitId) throw new Error("Token belongs to another unit");
    const existing = await ctx.db
      .query("units")
      .withIndex(
        "by_unit_id",
        q => q.eq("unitId", args.unitId)
      )
      .first();

    if (existing?.tokenId && existing.tokenId !== args.tokenId) {
      const old = await ctx.db.get(existing.tokenId);
      if (old && old.deletedAt === undefined && (old.expiresAt === undefined || old.expiresAt > Date.now())) throw new Error("Unit already belongs to another active token");
    }
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
    tokenId: v.id("unitTokens"),
    ...selectionArgs,
  },

  returns: v.array(v.object({
    requestId: v.id("requests"),
    assignmentVersion: v.number(),
    artifacts: v.optional(v.array(artifact)),
    payload: v.any(),
    specSlug: v.string(),
    pipelineName: v.string(),
  })),

  handler: async (ctx, { unitId, tokenId, ...selection }) => {
    const token = await workerIdentity(ctx, tokenId);
    if (token.unitId !== unitId) throw new Error("Token belongs to another unit");
    if (selection.byStatus !== undefined && selection.byStatus !== "waiting" && !(Array.isArray(selection.byStatus) && selection.byStatus.length === 1 && selection.byStatus[0] === "waiting")) throw new Error("Workers may only claim waiting requests");
    selection.byStatus = "waiting";
    const { specSlug } = selection;
    if (!token.specSlugs?.includes(specSlug)) throw new Error("Worker token does not allow this spec");
    const unit = await ctx.db
      .query("units")
      .withIndex("by_unit_id", q => q.eq("unitId", unitId))
      .first();

    if (!unit || unit.tokenId !== tokenId) {
      throw new Error(
        "Register this unit with a heartbeat before claiming work"
      );
    }

    const matching = await selectRequests(ctx, selection);

    const claimed = [];

    for (const request of matching) {
      await ctx.db.patch(request._id, {
        status: "possessed",
        unitId,
        claimedAt: Date.now(),
        assignedTokenId: tokenId,
        assignmentVersion: (request.assignmentVersion ?? 0) + 1,
      });

      claimed.push({
        requestId: request._id,
        assignmentVersion: (request.assignmentVersion ?? 0) + 1,
        ...(request.artifacts !== undefined ? { artifacts: request.artifacts } : {}),
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
