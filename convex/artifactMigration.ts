import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query, mutation } from "./_generated/server";
import { artifactFields } from "./storageModel";
import { requireOwner } from "./authz";

// Metadata backfill only: original Convex files are never deleted.
export const backfill = internalMutation({ args: { cursor: v.union(v.string(), v.null()) }, returns: v.object({ cursor: v.string(), done: v.boolean(), inserted: v.number() }), handler: async (ctx, { cursor }) => {
  const page = await ctx.db.query("requests").paginate({ cursor, numItems: 25 });
  let inserted = 0;
  for (const request of page.page) for (const a of request.artifacts ?? []) {
    if (!a.storageId || a.handler === "s3") continue;
    const existing = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", request._id).eq("artifactId", a.id)).unique();
    if (existing) continue;
    await ctx.db.insert("artifacts", { artifactId: a.id, requestId: request._id, handler: "convex-legacy", metadata: {
      storageId: a.storageId, name: a.name, contentType: a.contentType, size: a.size, createdAt: a.createdAt, resetVersion: request.resetVersion ?? 0,
      ...(a.nodeName ? { nodeName: a.nodeName } : {}), ...(a.label ? { label: a.label } : {}),
    } }); inserted++;
  }
  return { cursor: page.continueCursor, done: page.isDone, inserted };
} });
export const legacy = query({ args: { paginationOpts: paginationOptsValidator }, returns: v.object({ page: v.array(v.object({ ...artifactFields, _id: v.id("artifacts"), _creationTime: v.number(), deletedAt: v.optional(v.number()) })), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())) }), handler: async (ctx, { paginationOpts }) => {
  await requireOwner(ctx);
  const page = await ctx.db.query("artifacts").withIndex("by_handler", q => q.eq("handler", "convex-legacy").eq("deletedAt", undefined)).paginate(paginationOpts);
  const rows = await Promise.all(page.page.map(async a => {
    const request = await ctx.db.get(a.requestId);
    return request && request.deletedAt === undefined && (request.resetVersion ?? 0) === (a.metadata.resetVersion ?? 0) ? a : null;
  }));
  return { ...page, page: rows.filter(a => a !== null) };
} });

// Owner-only optimistic update for recognized storage-protocol YAML migrations.
export const updateSpec = mutation({ args: { id: v.id("specs"), expectedYaml: v.string(), yaml: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  await requireOwner(ctx);
  const spec = await ctx.db.get(args.id);
  if (!spec || spec.deletedAt !== undefined || spec.yaml !== args.expectedYaml) throw new Error("Spec changed; preview and retry migration.");
  await ctx.db.patch(spec._id, { yaml: args.yaml }); return null;
} });
