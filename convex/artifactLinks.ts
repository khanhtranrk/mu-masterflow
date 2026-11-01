import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./authz";
import { artifact } from "./artifactModel";
import { projection, resolveArtifact } from "./artifactStore";

const candidate = v.object({ requestId: v.id("requests"), specSlug: v.string(), pipelineName: v.string(), artifact });
export const browse = query({
  args: { search: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(candidate),
  handler: async (ctx, { search, paginationOpts }) => {
    await requireOwner(ctx);
    paginationOpts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 50) };
    const term = search.trim();
    const requestId = term ? ctx.db.normalizeId("requests", term) : null;
    const page = requestId
      ? await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", requestId)).paginate(paginationOpts)
      : term
        ? await ctx.db.query("artifacts").withSearchIndex("search_name", q => q.search("metadata.name", term).eq("deletedAt", undefined)).paginate(paginationOpts)
        : await ctx.db.query("artifacts").order("desc").paginate(paginationOpts);
    const rows = await Promise.all(page.page.map(async row => {
      if (row.deletedAt !== undefined) return null;
      const request = await ctx.db.get(row.requestId);
      if (!request || request.deletedAt !== undefined || (row.metadata.resetVersion ?? 0) !== (request.resetVersion ?? 0)) return null;
      return { requestId: row.requestId, specSlug: request.specSlug, pipelineName: request.pipelineName, artifact: projection(row) };
    }));
    return { ...page, page: rows.filter(row => row !== null) };
  },
});

export const link = mutation({
  args: {
    sourceRequestId: v.id("requests"), sourceArtifactId: v.string(), expectedSourceCreatedAt: v.number(), requestId: v.id("requests"), artifactId: v.string(),
    name: v.optional(v.string()), label: v.optional(v.string()), nodeName: v.optional(v.string()),
  },
  returns: artifact,
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.deletedAt !== undefined) throw new Error("Target request not found");
    if (!args.artifactId.trim() || args.artifactId.length > 128) throw new Error("Artifact ID must contain 1–128 characters");
    const source = await resolveArtifact(ctx, { requestId: args.sourceRequestId, artifactId: args.sourceArtifactId });
    if (source.metadata.createdAt !== args.expectedSourceCreatedAt) throw new Error("Source artifact changed. Select it again before linking.");
    if (source.handler === "s3") {
      if (!source.metadata.connectionId || !source.metadata.objectKey) throw new Error("Invalid source storage reference");
      const connection = await ctx.db.query("storageConnections").withIndex("by_connection", q => q.eq("connectionId", source.metadata.connectionId!)).unique();
      if (!connection?.enabled) throw new Error("Source storage connection is disabled or missing");
    } else if (!source.metadata.storageId) throw new Error("Invalid legacy source reference");
    const existing = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId).eq("artifactId", args.artifactId)).unique();
    if (existing || request.artifacts?.some(a => a.id === args.artifactId)) throw new Error("Artifact ID already exists or was deleted. Choose a new ID.");
    const records = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId)).take(100);
    if (new Set([...records.map(a => a.artifactId), ...(request.artifacts ?? []).map(a => a.id)]).size >= 100) throw new Error("Artifact limit reached");
    const name = args.name ?? source.metadata.name;
    if (!name.trim() || name.length > 255 || /[\x00-\x1f/\\]/.test(name)) throw new Error("Invalid filename");
    if ((args.label?.length ?? 0) > 255 || (args.nodeName?.length ?? 0) > 255) throw new Error("Label or node name is too long");
    // Snapshot the actual source coordinates, never an alias to the source record.
    const record = { requestId: request._id, artifactId: args.artifactId, handler: source.handler, metadata: {
      ...(source.handler === "s3" ? { connectionId: source.metadata.connectionId, objectKey: source.metadata.objectKey } : { storageId: source.metadata.storageId }),
      name, contentType: source.metadata.contentType, size: source.metadata.size, createdAt: Date.now(), resetVersion: request.resetVersion ?? 0,
      ...(args.label ? { label: args.label } : {}), ...(args.nodeName ? { nodeName: args.nodeName } : {}),
    } };
    await ctx.db.insert("artifacts", record);
    const saved = projection(record);
    const artifacts = [...(request.artifacts ?? []), saved];
    const nodeStates = { ...request.nodeStates };
    if (args.nodeName && nodeStates[args.nodeName]) nodeStates[args.nodeName] = { ...nodeStates[args.nodeName], artifacts: [...(nodeStates[args.nodeName].artifacts ?? []), saved] };
    await ctx.db.patch(request._id, { artifacts, ...(request.nodeStates ? { nodeStates } : {}) });
    return saved;
  },
});
