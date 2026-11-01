import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireAuthenticated, requireOwner } from "./authz";
import { assignedRequest } from "./workerAccess";
import { artifactFields, uploadFields } from "./storageModel";
import { artifact } from "./artifactModel";

const actor = { tokenId: v.optional(v.id("unitTokens")), assignmentVersion: v.optional(v.number()) };
async function access(ctx: QueryCtx | MutationCtx, requestId: Id<"requests">, tokenId?: Id<"unitTokens">) {
  if (tokenId) { const r = await assignedRequest(ctx, requestId, tokenId); return { request: r, owner: `token:${tokenId}` }; }
  const user = await requireAuthenticated(ctx);
  const request = await ctx.db.get(requestId);
  if (!request || request.deletedAt !== undefined) throw new Error("Request not found");
  return { request, owner: `user:${user}` };
}
export function projection(row: Pick<Doc<"artifacts">, "artifactId" | "metadata" | "handler">) {
  const { resetVersion, ...m } = row.metadata;
  return { id: row.artifactId, ...m, ...(row.handler === "s3" ? { handler: "s3" as const } : {}) };
}
export const list = query({ args: { requestId: v.id("requests") }, returns: v.array(artifact), handler: async (ctx, args) => {
  const { request } = await access(ctx, args.requestId);
  const rows = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId)).take(101);
  const seen = new Set(rows.map(r => r.artifactId));
  return [...rows.filter(r => r.deletedAt === undefined && (r.metadata.resetVersion ?? 0) === (request.resetVersion ?? 0)).map(projection), ...(request.artifacts ?? []).filter(a => !seen.has(a.id))];
} });
export const remove = mutation({ args: { requestId: v.id("requests"), artifactId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  await requireOwner(ctx);
  const request = await ctx.db.get(args.requestId); if (!request) throw new Error("Request not found");
  const row = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId).eq("artifactId", args.artifactId)).unique();
  if (row) await ctx.db.patch(row._id, { deletedAt: Date.now() });
  else {
    const old = request.artifacts?.find(a => a.id === args.artifactId);
    if (!old) throw new Error("Artifact not found");
    const { id, ...metadata } = old;
    await ctx.db.insert("artifacts", { requestId: args.requestId, artifactId: id, handler: "convex-legacy", metadata, deletedAt: Date.now() });
  }
  const nodeStates = Object.fromEntries(Object.entries(request.nodeStates ?? {}).map(([name, node]) => [name, { ...node, artifacts: node.artifacts?.filter(a => a.id !== args.artifactId) }]));
  await ctx.db.patch(request._id, { artifacts: request.artifacts?.filter(a => a.id !== args.artifactId), ...(request.nodeStates ? { nodeStates } : {}) });
  return null; // Never delete storage objects; tombstone blocks old completion/report resurrection.
} });
export const begin = internalMutation({ args: { ...actor, requestId: v.id("requests"), artifactId: v.string(), connectionId: v.optional(v.string()), size: v.number(), sha256: v.string(), contentType: v.string(), nonce: v.string() }, returns: v.object({ ...uploadFields, uploadId: v.id("storageUploads") }), handler: async (ctx, args) => {
  const { request, owner } = await access(ctx, args.requestId, args.tokenId);
  if (args.tokenId && args.assignmentVersion !== request.assignmentVersion) throw new Error("Stale assignment");
  if (!args.artifactId.trim() || args.artifactId.length > 128 || !Number.isSafeInteger(args.size) || args.size < 0 || args.size > 5 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(args.sha256)) throw new Error("Invalid artifact ID, size or checksum; single uploads are limited to 5 GiB.");
  const row = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId).eq("artifactId", args.artifactId)).unique();
  if (row?.deletedAt !== undefined) throw new Error("Artifact was deleted by the owner");
  if (args.tokenId && ((row && (row.metadata.resetVersion ?? 0) === (request.resetVersion ?? 0)) || (!row && (request.resetVersion ?? 0) === 0 && request.artifacts?.some(a => a.id === args.artifactId)))) throw new Error("Worker cannot replace an existing artifact. Use a new artifactId.");
  const settings = await ctx.db.query("storageSettings").first();
  const connectionId = args.connectionId ?? settings?.defaultConnectionId;
  if (!connectionId) throw new Error("Choose a default storage connection first.");
  const c = await ctx.db.query("storageConnections").withIndex("by_connection", q => q.eq("connectionId", connectionId)).unique();
  if (!c?.enabled) throw new Error("Storage connection is disabled or missing");
  const count = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId)).take(101);
  const logicalIds = new Set([...count.map(a => a.artifactId), ...(request.artifacts ?? []).map(a => a.id)]);
  if (logicalIds.size >= 100 && !logicalIds.has(args.artifactId)) throw new Error("Artifact limit reached");
  const pending = await ctx.db.query("storageUploads").withIndex("by_request_pending", q => q.eq("requestId", args.requestId).eq("completed", undefined).gt("expiresAt", Date.now())).take(20);
  if (pending.length >= 20) throw new Error("Too many pending uploads; retry after existing sessions expire.");
  const prefix = c.prefix.replace(/\/$/, "");
  const suffix = `${args.requestId}/${args.nonce}`;
  const upload = { requestId: args.requestId, artifactId: args.artifactId, connectionId, owner, size: args.size, sha256: args.sha256, contentType: args.contentType,
    stagingKey: [prefix, "staging", suffix].filter(Boolean).join("/"), finalKey: [prefix, "objects", suffix].filter(Boolean).join("/"), resetVersion: request.resetVersion ?? 0, assignmentVersion: request.assignmentVersion ?? 0, expiresAt: Date.now() + 15 * 60_000 };
  const uploadId = await ctx.db.insert("storageUploads", upload);
  return { ...upload, uploadId };
} });
export const session = internalQuery({ args: { ...actor, uploadId: v.id("storageUploads") }, returns: v.object({ ...uploadFields, _id: v.id("storageUploads"), _creationTime: v.number() }), handler: async (ctx, args) => {
  const upload = await ctx.db.get(args.uploadId); if (!upload) throw new Error("Upload not found");
  const { request, owner } = await access(ctx, upload.requestId, args.tokenId);
  if (args.tokenId && args.assignmentVersion !== request.assignmentVersion) throw new Error("Stale assignment");
  if (owner !== upload.owner || (request.resetVersion ?? 0) !== upload.resetVersion || (args.tokenId && (request.assignmentVersion ?? 0) !== upload.assignmentVersion)) throw new Error("Upload belongs to another caller or assignment");
  if (!upload.completed && upload.expiresAt <= Date.now()) throw new Error("Upload session expired");
  return upload;
} });
export const reserve = internalMutation({ args: { ...actor, uploadId: v.id("storageUploads"), etag: v.string(), name: v.string(), nodeName: v.optional(v.string()), label: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const u = await ctx.db.get(args.uploadId); if (!u) throw new Error("Upload not found");
  const { request, owner } = await access(ctx, u.requestId, args.tokenId);
  if (args.tokenId && args.assignmentVersion !== request.assignmentVersion) throw new Error("Stale assignment");
  if (owner !== u.owner || u.expiresAt <= Date.now() || (request.resetVersion ?? 0) !== u.resetVersion || (args.tokenId && (request.assignmentVersion ?? 0) !== u.assignmentVersion)) throw new Error("Stale upload");
  if (!args.name.trim() || args.name.length > 255 || /[\x00-\x1f/\\]/.test(args.name)) throw new Error("Invalid filename");
  if (u.sourceEtag && (u.sourceEtag !== args.etag || u.name !== args.name || u.nodeName !== args.nodeName || u.label !== args.label)) throw new Error("Upload completion details changed");
  await ctx.db.patch(u._id, { sourceEtag: args.etag, name: args.name, ...(args.nodeName !== undefined ? { nodeName: args.nodeName } : {}), ...(args.label !== undefined ? { label: args.label } : {}) }); return null;
} });
export const finish = internalMutation({ args: { ...actor, uploadId: v.id("storageUploads") }, returns: artifact, handler: async (ctx, args) => {
  const u = await ctx.db.get(args.uploadId); if (!u?.sourceEtag || !u.name) throw new Error("Upload not reserved");
  const { request, owner } = await access(ctx, u.requestId, args.tokenId);
  if (args.tokenId && args.assignmentVersion !== request.assignmentVersion) throw new Error("Stale assignment");
  if (owner !== u.owner || (request.resetVersion ?? 0) !== u.resetVersion || (args.tokenId && (request.assignmentVersion ?? 0) !== u.assignmentVersion)) throw new Error("Stale upload");
  const existing = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", u.requestId).eq("artifactId", u.artifactId)).unique();
  if (existing?.deletedAt !== undefined) throw new Error("Artifact was deleted");
  if (u.completed) {
    if (existing?.metadata.objectKey !== u.finalKey) throw new Error("Artifact was replaced");
    return projection(existing);
  }
  if (u.expiresAt <= Date.now()) throw new Error("Upload expired");
  if (args.tokenId && existing && (existing.metadata.resetVersion ?? 0) === u.resetVersion) throw new Error("Worker cannot replace an artifact");
  const records = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", u.requestId)).take(100);
  const logicalIds = new Set([...records.map(a => a.artifactId), ...(request.artifacts ?? []).map(a => a.id)]);
  if (!logicalIds.has(u.artifactId) && logicalIds.size >= 100) throw new Error("Artifact limit reached");
  const record = { artifactId: u.artifactId, requestId: u.requestId, handler: "s3" as const,
    metadata: { resetVersion: u.resetVersion, connectionId: u.connectionId, objectKey: u.finalKey, name: u.name, contentType: u.contentType, size: u.size, createdAt: Date.now(), ...(u.nodeName ? { nodeName: u.nodeName } : {}), ...(u.label ? { label: u.label } : {}) } };
  if (existing) await ctx.db.patch(existing._id, record); else await ctx.db.insert("artifacts", record);
  const saved = projection(record);
  const artifacts = [...(request.artifacts ?? []).filter(a => a.id !== saved.id), saved];
  const nodeStates = Object.fromEntries(Object.entries(request.nodeStates ?? {}).map(([name, node]) => [name, { ...node, artifacts: artifacts.filter(a => a.nodeName === name || (a.nodeName === undefined && node.artifacts?.some(r => r.id === a.id))) }]));
  await ctx.db.patch(request._id, { artifacts, ...(request.nodeStates ? { nodeStates } : {}) });
  await ctx.db.patch(u._id, { completed: true }); return saved;
} });
export async function resolveArtifact(ctx: QueryCtx | MutationCtx, args: { requestId: Id<"requests">; artifactId: string; tokenId?: Id<"unitTokens">; assignmentVersion?: number }) {
  const { request } = await access(ctx, args.requestId, args.tokenId);
  if (args.tokenId && args.assignmentVersion !== request.assignmentVersion) throw new Error("Stale assignment");
  const row = await ctx.db.query("artifacts").withIndex("by_request_artifact", q => q.eq("requestId", args.requestId).eq("artifactId", args.artifactId)).unique();
  if (row) { if (row.deletedAt !== undefined || (row.metadata.resetVersion ?? 0) !== (request.resetVersion ?? 0)) throw new Error("Artifact not found"); return { artifactId: row.artifactId, requestId: row.requestId, handler: row.handler, metadata: row.metadata }; }
  const legacy = request.artifacts?.find(a => a.id === args.artifactId);
  if (!legacy?.storageId) throw new Error("Artifact not found");
  const { id, ...metadata } = legacy;
  return { requestId: args.requestId, artifactId: id, handler: "convex-legacy" as const, metadata };
}
export const resolve = internalQuery({ args: { ...actor, requestId: v.id("requests"), artifactId: v.string() }, returns: v.object(artifactFields), handler: resolveArtifact });
