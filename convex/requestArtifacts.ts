import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthenticated } from "./authz";

import { artifact } from "./artifactModel";

const startArgs = {
  requestId: v.id("requests"), artifactId: v.string(), sha256: v.string(), size: v.number(),
};
const startResult = v.object({
  uploadId: v.id("artifactUploads"), uploadUrl: v.string(), expiresAt: v.number(),
});
const completeArgs = {
  requestId: v.id("requests"), uploadId: v.id("artifactUploads"),
  storageId: v.id("_storage"), name: v.string(),
  nodeName: v.optional(v.string()), label: v.optional(v.string()),
};

function text(value: string, field: string, max = 255) {
  if (!value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${field} must be non-empty text of at most ${max} characters without control characters`);
  }
}

// Hosted/self-hosted versions may expose storage digests as base64, while
// workers send conventional hexadecimal SHA-256. Compare the bytes, not encoding.
function digestHex(digest: string) {
  if (/^[a-f0-9]{64}$/i.test(digest)) return digest.toLowerCase();
  return Array.from(atob(digest), byte => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

async function start(ctx: MutationCtx, args: {
  requestId: Id<"requests">; artifactId: string; sha256: string; size: number;
}, owner: string) {
  text(args.artifactId, "artifactId", 128);
  if (!/^[a-f0-9]{64}$/.test(args.sha256)) throw new Error("sha256 must be a lowercase hexadecimal SHA-256 digest");
  if (!Number.isSafeInteger(args.size) || args.size < 0) throw new Error("size must be a non-negative safe integer");
  const request = await ctx.db.get(args.requestId);
  if (!request || request.deletedAt !== undefined) throw new Error("Request not found");
  if ((request.artifacts?.length ?? 0) >= 100 && !request.artifacts?.some(a => a.id === args.artifactId)) {
    throw new Error("A request supports at most 100 artifacts");
  }
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const uploadId = await ctx.db.insert("artifactUploads", { ...args, owner, expiresAt, resetVersion: request.resetVersion ?? 0 });
  return { uploadId, uploadUrl: await ctx.storage.generateUploadUrl(), expiresAt };
}

async function complete(ctx: MutationCtx, args: {
  requestId: Id<"requests">; uploadId: Id<"artifactUploads">; storageId: Id<"_storage">;
  name: string; nodeName?: string; label?: string;
}, owner: string) {
  text(args.name, "name");
  if (/[\\/]/.test(args.name) || args.name === "." || args.name === "..") throw new Error("name must be a file name without directories");
  if (args.nodeName !== undefined) text(args.nodeName, "nodeName");
  if (args.label !== undefined) text(args.label, "label");
  const request = await ctx.db.get(args.requestId);
  if (!request || request.deletedAt !== undefined) throw new Error("Request not found");
  const upload = await ctx.db.get(args.uploadId);
  if (!upload || upload.owner !== owner || upload.requestId !== args.requestId) throw new Error("Upload does not belong to this caller and request");
  if ((upload.resetVersion ?? 0) !== (request.resetVersion ?? 0)) throw new Error("Request was reset; start a new upload for the current run.");
  const artifacts = request.artifacts ?? [];
  // Same completed receipt is safe to retry, even after its expiry. Never replay
  // an older receipt over a newer replacement of the same logical artifact.
  if (upload.storageId !== undefined) {
    const previous = artifacts.find(a => a.id === upload.artifactId);
    if (upload.storageId === args.storageId && previous?.storageId === args.storageId) return previous;
    throw new Error("Upload already completed or superseded");
  }
  if (upload.expiresAt <= Date.now()) throw new Error("Upload expired; start a new upload");
  const metadata = await ctx.db.system.get("_storage", args.storageId);
  if (!metadata || metadata._creationTime < upload._creationTime || metadata.size !== upload.size || digestHex(metadata.sha256) !== upload.sha256) {
    throw new Error("Uploaded file does not match this upload's creation time, size and SHA-256");
  }
  const binding = await ctx.db.query("artifactUploads").withIndex("by_storage", q => q.eq("storageId", args.storageId)).first();
  if (binding) throw new Error("File already belongs to another upload");
  const previous = artifacts.find(a => a.id === upload.artifactId);
  if (!previous && artifacts.length >= 100) throw new Error("A request supports at most 100 artifacts");
  const saved = {
    id: upload.artifactId, name: args.name, storageId: args.storageId,
    contentType: metadata.contentType || "application/octet-stream", size: metadata.size,
    createdAt: Date.now(),
    ...(args.nodeName !== undefined ? { nodeName: args.nodeName } : {}),
    ...(args.label !== undefined ? { label: args.label } : {}),
  };
  const nodeStates = { ...request.nodeStates };
  // Keep existing node references fresh before deleting the replaced bytes.
  // Upload completion never invents a runtime status for an unreported node.
  for (const [name, node] of Object.entries(nodeStates)) {
    const refs = (node.artifacts ?? []).flatMap(a => a.id !== saved.id ? [a]
      : saved.nodeName === undefined || saved.nodeName === name ? [saved] : []);
    const referenced = node.artifacts?.some(a => a.id === saved.id);
    if (saved.nodeName === name && !refs.some(a => a.id === saved.id)) refs.push(saved);
    if (referenced || saved.nodeName === name) nodeStates[name] = { ...node, artifacts: refs };
  }
  await ctx.db.patch(args.requestId, {
    artifacts: previous ? artifacts.map(a => a.id === saved.id ? saved : a) : [...artifacts, saved],
    ...(request.nodeStates !== undefined ? { nodeStates } : {}),
  });
  await ctx.db.patch(args.uploadId, { storageId: args.storageId });
  // A storage ID is exclusively bound to one receipt; replacing it is safe.
  if (previous) await ctx.storage.delete(previous.storageId);
  return saved;
}

export const startUpload = mutation({
  args: startArgs, returns: startResult,
  handler: async (ctx, args) => start(ctx, args, `user:${await requireAuthenticated(ctx)}`),
});
export const completeUpload = mutation({
  args: completeArgs, returns: artifact,
  handler: async (ctx, args) => complete(ctx, args, `user:${await requireAuthenticated(ctx)}`),
});
export const startFromWorker = internalMutation({
  args: { ...startArgs, tokenId: v.id("unitTokens") }, returns: startResult,
  handler: async (ctx, { tokenId, ...args }) => start(ctx, args, `token:${tokenId}`),
});
export const completeFromWorker = internalMutation({
  args: { ...completeArgs, tokenId: v.id("unitTokens") }, returns: artifact,
  handler: async (ctx, { tokenId, ...args }) => complete(ctx, args, `token:${tokenId}`),
});

export const getForWorker = internalQuery({
  args: { requestId: v.id("requests"), artifactId: v.string() },
  returns: v.union(artifact, v.null()),
  handler: async (ctx, { requestId, artifactId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt !== undefined) return null;
    return request.artifacts?.find(a => a.id === artifactId) ?? null;
  },
});

// Only authenticated desktop users receive bearer download URLs.
export const urls = query({
  args: { requestId: v.id("requests") },
  returns: v.array(v.object({ id: v.string(), url: v.union(v.string(), v.null()) })),
  handler: async (ctx, { requestId }) => {
    await requireAuthenticated(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt !== undefined) return [];
    return Promise.all((request.artifacts ?? []).map(async a => ({ id: a.id, url: await ctx.storage.getUrl(a.storageId) })));
  },
});
