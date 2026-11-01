"use node";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v, type Infer } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { client } from "./s3";
import { retryDownloadQuery } from "./transientQuery";
import { artifact, type Artifact } from "./artifactModel";
const startArgs = { requestId: v.id("requests"), artifactId: v.string(), connectionId: v.optional(v.string()), size: v.number(), sha256: v.string(), contentType: v.optional(v.string()) };
const uploadResult = v.object({ uploadId: v.id("storageUploads"), uploadUrl: v.string(), method: v.literal("PUT"), headers: v.record(v.string(), v.string()), expiresAt: v.number() });
const completeArgs = { requestId: v.id("requests"), uploadId: v.id("storageUploads"), name: v.string(), nodeName: v.optional(v.string()), label: v.optional(v.string()) };
const downloadArgs = { requestId: v.id("requests"), artifactId: v.string() };
const downloadResult = v.object({ url: v.string(), expiresAt: v.union(v.number(), v.null()), name: v.string(), contentType: v.string(), size: v.number(), legacy: v.boolean() });
type Start = { requestId: Id<"requests">; artifactId: string; connectionId?: string; size: number; sha256: string; contentType?: string; tokenId?: Id<"unitTokens">; assignmentVersion?: number };
async function start(ctx: ActionCtx, args: Start): Promise<Infer<typeof uploadResult>> {
  const contentType = args.contentType || "application/octet-stream";
  if (contentType.length > 255 || /[\r\n]/.test(contentType)) throw new Error("Invalid content type");
  const u = await ctx.runMutation(internal.artifactStore.begin, { ...args, contentType, nonce: randomUUID() });
  const c = await ctx.runQuery(internal.storage.get, { connectionId: u.connectionId });
  if (!c?.enabled) throw new Error("Storage connection unavailable");
  const s3 = client(c);
  try {
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: c.bucket, Key: u.stagingKey, ContentType: contentType, ContentLength: u.size }), { expiresIn: 900, signableHeaders: new Set(["content-type", "content-length"]) });
    return { uploadId: u.uploadId, uploadUrl, method: "PUT" as const, headers: { "Content-Type": contentType }, expiresAt: u.expiresAt };
  } finally { s3.destroy(); }
}
async function complete(ctx: ActionCtx, args: { requestId: Id<"requests">; uploadId: Id<"storageUploads">; name: string; nodeName?: string; label?: string; tokenId?: Id<"unitTokens">; assignmentVersion?: number }): Promise<Artifact> {
  const { requestId, uploadId, tokenId, assignmentVersion, ...details } = args;
  const u = await ctx.runQuery(internal.artifactStore.session, { uploadId, ...(tokenId ? { tokenId, assignmentVersion } : {}) });
  if (u.requestId !== requestId) throw new Error("Upload belongs to another request");
  if (u.completed) {
    if (u.name !== details.name || u.nodeName !== details.nodeName || u.label !== details.label) throw new Error("Upload completion details changed");
    return await ctx.runMutation(internal.artifactStore.finish, { uploadId, ...(tokenId ? { tokenId, assignmentVersion } : {}) });
  }
  const c = await ctx.runQuery(internal.storage.get, { connectionId: u.connectionId });
  if (!c?.enabled) throw new Error("Storage connection unavailable");
  const s3 = client(c);
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: u.stagingKey }));
    if (head.ContentLength !== u.size || !head.ETag) throw new Error("Uploaded object size does not match");
    await ctx.runMutation(internal.artifactStore.reserve, { uploadId, etag: head.ETag, ...details, ...(tokenId ? { tokenId, assignmentVersion } : {}) });
    await s3.send(new CopyObjectCommand({ Bucket: c.bucket, Key: u.finalKey, CopySource: `${encodeURIComponent(c.bucket)}/${u.stagingKey.split("/").map(encodeURIComponent).join("/")}`, CopySourceIfMatch: head.ETag }));
    const final = await s3.send(new HeadObjectCommand({ Bucket: c.bucket, Key: u.finalKey }));
    if (final.ContentLength !== u.size) throw new Error("Final object size does not match");
    return await ctx.runMutation(internal.artifactStore.finish, { uploadId, ...(tokenId ? { tokenId, assignmentVersion } : {}) });
  } catch (error) {
    // Avoid SDK errors containing credential-bearing request URLs.
    if (error instanceof Error && /size does not match|Stale upload|deleted|changed|expired|another|replace|filename/.test(error.message)) throw error;
    throw new Error("Could not complete upload. Check the storage connection or retry.");
  } finally { s3.destroy(); }
}
async function download(ctx: ActionCtx, args: { requestId: Id<"requests">; artifactId: string; tokenId?: Id<"unitTokens">; assignmentVersion?: number }): Promise<Infer<typeof downloadResult>> {
  const a = await retryDownloadQuery(() => ctx.runQuery(internal.artifactStore.resolve, args));
  const m = a.metadata;
  if (a.handler === "convex-legacy") {
    const url = await ctx.storage.getUrl(m.storageId!);
    if (!url) throw new Error("Legacy file unavailable");
    return { url, expiresAt: null, name: m.name, contentType: m.contentType, size: m.size, legacy: true };
  }
  const c = await retryDownloadQuery(() => ctx.runQuery(internal.storage.get, { connectionId: m.connectionId! }));
  if (!c?.enabled) throw new Error("Storage connection unavailable");
  const s3 = client(c);
  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: c.bucket, Key: m.objectKey, ResponseCacheControl: "private, no-store", ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(m.name)}` }), { expiresIn: 300 });
    return { url, expiresAt: Date.now() + 300_000, name: m.name, contentType: m.contentType, size: m.size, legacy: false };
  } finally { s3.destroy(); }
}
export const startUpload = action({ args: startArgs, returns: uploadResult, handler: start });
export const completeUpload = action({ args: completeArgs, returns: artifact, handler: complete });
export const downloadUrl = action({ args: downloadArgs, returns: downloadResult, handler: download });
export const startWorker = internalAction({ args: { ...startArgs, tokenId: v.id("unitTokens"), assignmentVersion: v.number() }, returns: uploadResult, handler: start });
export const completeWorker = internalAction({ args: { ...completeArgs, tokenId: v.id("unitTokens"), assignmentVersion: v.number() }, returns: artifact, handler: complete });
export const downloadWorker = internalAction({ args: { ...downloadArgs, tokenId: v.id("unitTokens"), assignmentVersion: v.number() }, returns: downloadResult, handler: download });

// Owner migration tooling may verify staged bytes directly before committing metadata.
export const verifyUploadUrl = action({ args: { uploadId: v.id("storageUploads") }, returns: v.string(), handler: async (ctx, args): Promise<string> => {
  await ctx.runQuery(internal.storage.owner, {});
  const u = await ctx.runQuery(internal.artifactStore.session, args);
  const c = await ctx.runQuery(internal.storage.get, { connectionId: u.connectionId });
  if (!c?.enabled) throw new Error("Storage connection unavailable");
  const s3 = client(c);
  try { return await getSignedUrl(s3, new GetObjectCommand({ Bucket: c.bucket, Key: u.stagingKey }), { expiresIn: 300 }); }
  finally { s3.destroy(); }
} });
