import { test, expect, beforeEach } from "bun:test";
import { convexTest } from "convex-test";
import { readdirSync } from "node:fs";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { createHash } from "node:crypto";
import { encrypt, decrypt } from "../convex/s3";
import { retryDownloadQuery } from "../convex/transientQuery";

const modules: Record<string, () => Promise<unknown>> = {};
for (const f of readdirSync(new URL("../convex", import.meta.url))) if (f.endsWith(".ts") && !f.endsWith(".d.ts")) modules[`../convex/${f}`] = () => import(`../convex/${f}`);
modules["../convex/_generated/server.js"] = () => import("../convex/_generated/server.js");
const issuer = "https://test.clerk.accounts.dev";
beforeEach(() => {
  process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
  process.env.AUTH_ALLOWED_USER_IDS = '["user_owner","user_reader"]';
  process.env.AUTH_ALLOWED_EMAILS = '[]';
  process.env.STORAGE_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
});
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    await ctx.db.insert("storageSettings", { ownerId: "user_owner", defaultConnectionId: "r2-1" });
    await ctx.db.insert("storageConnections", { connectionId: "r2-1", name: "First", provider: "r2", endpoint: "https://example.r2.cloudflarestorage.com", region: "auto", bucket: "private", prefix: "mu", encryptedCredentials: encrypt({ accessKeyId: "test-key", secretAccessKey: "test-secret" }, "r2-1"), enabled: true, createdAt: 1 });
    const tokenId = await ctx.db.insert("unitTokens", { name: "worker", tokenHash: createHash("sha256").update("worker-token").digest("hex"), unitId: "unit-a", specSlugs: ["demo"], createdAt: 1 });
    const otherTokenId = await ctx.db.insert("unitTokens", { name: "other", tokenHash: createHash("sha256").update("other-token").digest("hex"), unitId: "unit-b", specSlugs: ["demo"], createdAt: 1 });
    await ctx.db.insert("units", { unitId: "unit-a", tokenId, unitType: "test", status: "online", workingDir: ".", devices: [], lastSeen: 1 });
    const requestId = await ctx.db.insert("requests", { specSlug: "demo", pipelineName: "main", payload: {}, status: "possessed", unitId: "unit-a", assignedTokenId: tokenId, assignmentVersion: 1 });
    await ctx.db.insert("specs", { slug: "demo", name: "Demo", description: "", enabled: true, yaml: "pipeline:\n  main:\n    nodes: []" });
    return { requestId, tokenId, otherTokenId };
  });
  return { t, owner: t.withIdentity({ issuer, subject: "user_owner" }), reader: t.withIdentity({ issuer, subject: "user_reader" }), ...ids };
}
const sha256 = "a".repeat(64);

test("download query retries transient failures, stays bounded and never retries authorization failures", async () => {
  let attempts = 0; const delays: number[] = [];
  const result = await retryDownloadQuery(async () => {
    if (++attempts < 3) throw new Error("Transient error while running query");
    return "resolved";
  }, async ms => { delays.push(ms); });
  expect(result).toBe("resolved"); expect(attempts).toBe(3); expect(delays).toEqual([200, 500]);
  attempts = 0;
  await expect(retryDownloadQuery(async () => { attempts++; throw new Error("Transient error while running query"); }, async () => {})).rejects.toThrow("server is temporarily unavailable");
  expect(attempts).toBe(3);
  for (const message of ["Unauthenticated", "Artifact not found", "Stale assignment", "Storage connection unavailable"]) {
    attempts = 0;
    await expect(retryDownloadQuery(async () => { attempts++; throw new Error(message); }, async () => {})).rejects.toThrow(message);
    expect(attempts).toBe(1);
  }
});

test("credentials use authenticated encryption bound to stable connection ID", () => {
  const c = { accessKeyId: "key", secretAccessKey: "secret" };
  const box = encrypt(c, "r2-1");
  expect(box).not.toContain('secret'); expect(decrypt(box, "r2-1")).toEqual(c);
  expect(() => decrypt(box, "r2-2")).toThrow();
  const changed = JSON.parse(box); changed.tag = Buffer.alloc(16).toString("base64");
  expect(() => decrypt(JSON.stringify(changed), "r2-1")).toThrow();
});

test("only owner manages connections; credentials are never listed and locations cannot be repointed", async () => {
  const { t, owner, reader } = await fixture();
  const listed = await reader.query(api.storage.list, {});
  expect(listed.isOwner).toBe(false); expect(JSON.stringify(listed)).not.toContain("encryptedCredentials"); expect(JSON.stringify(listed)).not.toContain("test-secret");
  await expect(reader.mutation(api.storage.configure, { connectionId: "r2-1", enabled: false })).rejects.toThrow("owner");
  await expect(t.query(api.storage.list, {})).rejects.toThrow();
  await expect(owner.mutation(internal.storage.save, { connectionId: "r2-1", name: "Other", provider: "r2", endpoint: "https://other.r2.cloudflarestorage.com", region: "auto", bucket: "private", prefix: "mu", encryptedCredentials: "x" })).rejects.toThrow("new connection");
  await owner.mutation(api.storage.configure, { connectionId: "r2-1", enabled: false });
  expect((await owner.query(api.storage.list, {})).defaultConnectionId).toBeUndefined();
});

test("worker upload/download/report checks actual assignment, token status and assignment generation", async () => {
  const { t, requestId, tokenId, otherTokenId } = await fixture();
  const begin = { requestId, artifactId: "output", size: 3, sha256, contentType: "text/plain", nonce: "nonce", tokenId, assignmentVersion: 1 };
  await expect(t.mutation(internal.artifactStore.begin, { ...begin, tokenId: otherTokenId })).rejects.toThrow("assigned");
  await expect(t.mutation(internal.artifactStore.begin, { ...begin, assignmentVersion: 0 })).rejects.toThrow("Stale");
  const u = await t.mutation(internal.artifactStore.begin, begin);
  expect(u.connectionId).toBe("r2-1"); expect(u.finalKey).not.toBe(u.stagingKey);
  await expect(t.mutation(internal.requests.report, { id: requestId, tokenId: otherTokenId, assignmentVersion: 1, status: "processing" })).rejects.toThrow("assigned");
  await t.mutation(internal.requests.report, { id: requestId, tokenId, assignmentVersion: 1, status: "processing" });
  await t.run(ctx => ctx.db.patch(requestId, { assignmentVersion: 2 }));
  await expect(t.query(internal.artifactStore.session, { uploadId: u.uploadId, tokenId, assignmentVersion: 1 })).rejects.toThrow();
  await expect(t.mutation(internal.requests.report, { id: requestId, tokenId, assignmentVersion: 1, status: "succeeded" })).rejects.toThrow("Stale");
  await t.run(ctx => ctx.db.patch(tokenId, { deletedAt: Date.now() }));
  await expect(t.query(internal.artifactStore.resolve, { requestId, artifactId: "output", tokenId, assignmentVersion: 2 })).rejects.toThrow("active");
});

test("completion is idempotent, deletion is owner-only, leaves bytes and blocks resurrection", async () => {
  const { t, owner, reader, requestId, tokenId } = await fixture();
  const u = await t.mutation(internal.artifactStore.begin, { requestId, artifactId: "output", size: 3, sha256, contentType: "text/plain", nonce: "nonce", tokenId, assignmentVersion: 1 });
  const args = { uploadId: u.uploadId, tokenId, assignmentVersion: 1 };
  await t.mutation(internal.artifactStore.reserve, { ...args, etag: '"etag"', name: "out.txt", nodeName: "render" });
  const a = await t.mutation(internal.artifactStore.finish, args);
  expect(await t.mutation(internal.artifactStore.finish, args)).toEqual(a);
  const rows = await owner.query(api.artifactStore.list, { requestId }); expect(rows).toHaveLength(1);
  await expect(reader.mutation(api.artifactStore.remove, { requestId, artifactId: "output" })).rejects.toThrow("owner");
  await owner.mutation(api.artifactStore.remove, { requestId, artifactId: "output" });
  expect(await owner.query(api.artifactStore.list, { requestId })).toEqual([]);
  await expect(t.mutation(internal.artifactStore.finish, args)).rejects.toThrow("deleted");
  await expect(t.mutation(internal.artifactStore.begin, { requestId, artifactId: "output", size: 3, sha256, contentType: "text/plain", nonce: "new", tokenId, assignmentVersion: 1 })).rejects.toThrow("deleted");
  // Metadata-only deletion does not call storage or any provider action.
  const record = await t.run(ctx => ctx.db.query("artifacts").first()); expect(record!.metadata.objectKey).toBe(u.finalKey);
});

test("claim only waiting requests; heartbeat and unit IDs cannot impersonate another worker", async () => {
  const { t, tokenId, otherTokenId } = await fixture();
  await expect(t.mutation(internal.units.heartbeat, { tokenId: otherTokenId, unitId: "unit-a", unitType: "test", workingDir: ".", status: "online", devices: [] })).rejects.toThrow("another unit");
  await t.run(async ctx => { for (const pipelineName of ["other", "main", "main"]) await ctx.db.insert("requests", { specSlug: "demo", pipelineName, payload: {}, status: "waiting" }); });
  const claim = { unitId: "unit-a", tokenId, specSlug: "demo", byPipeline: "main", maxCount: 1 };
  const result = await t.mutation(internal.units.claim, claim);
  expect(result).toHaveLength(1); expect(result[0].assignmentVersion).toBe(1);
  const row = await t.run(ctx => ctx.db.get(result[0].requestId)); expect(row!.assignedTokenId).toBe(tokenId);
  await expect(t.mutation(internal.units.claim, { ...claim, byStatus: "processing" })).rejects.toThrow("waiting");
});

test("S3 transfer actions upload directly, finalize by server-side copy, and issue expiring download URLs", async () => {
  const objects = new Map<string, Uint8Array>();
  const requests: string[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url); const key = decodeURIComponent(url.pathname);
    requests.push(`${req.method} ${key}`);
    if (req.method === "PUT" && req.headers.has("x-amz-copy-source")) {
      const source = decodeURIComponent(req.headers.get("x-amz-copy-source")!);
      const bytes = objects.get('/' + source.replace(/^\//, ''));
      if (!bytes || req.headers.get("x-amz-copy-source-if-match") !== '"etag"') return new Response("", { status: 412 });
      objects.set(key, bytes.slice());
      return new Response('<CopyObjectResult><ETag>"etag"</ETag></CopyObjectResult>', { headers: { "Content-Type": "application/xml" } });
    }
    if (req.method === "PUT") { objects.set(key, new Uint8Array(await req.arrayBuffer())); return new Response(null); }
    const bytes = objects.get(key);
    if (!bytes) return new Response(null, { status: 404 });
    if (req.method === "HEAD") return new Response(null, { headers: { "Content-Length": String(bytes.length), ETag: '"etag"' } });
    if (!url.searchParams.has("X-Amz-Signature")) return new Response(null, { status: 403 });
    return new Response(bytes);
  } });
  try {
    const { t, owner, requestId, tokenId } = await fixture();
    await t.run(async ctx => { const c = await ctx.db.query("storageConnections").first(); await ctx.db.patch(c!._id, { endpoint: server.url.origin }); });
    const start = await t.action(internal.artifactTransfers.startWorker, { requestId, artifactId: "file", size: 3, sha256, tokenId, assignmentVersion: 1 });
    expect(start.method).toBe("PUT"); expect(new URL(start.uploadUrl).searchParams.get("X-Amz-Expires")).toBe("900");
    const response = await fetch(start.uploadUrl, { method: start.method, headers: start.headers, body: "abc" }); expect(response.status).toBe(200);
    const done = await t.action(internal.artifactTransfers.completeWorker, { requestId, uploadId: start.uploadId, tokenId, assignmentVersion: 1, name: "a.txt" });
    expect(done.handler).toBe("s3");
    await fetch(start.uploadUrl, { method: start.method, headers: start.headers, body: "xyz" });
    const download = await owner.action(api.artifactTransfers.downloadUrl, { requestId, artifactId: "file" });
    expect(new URL(download.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(await (await fetch(download.url)).text()).toBe("abc");
    expect(requests.some(r => r.startsWith("PUT") && r.includes("/objects/"))).toBe(true);
    const before = objects.size;
    await owner.mutation(api.artifactStore.remove, { requestId, artifactId: "file" });
    expect(objects.size).toBe(before);
    await expect(owner.action(api.artifactTransfers.downloadUrl, { requestId, artifactId: "file" })).rejects.toThrow("not found");
  } finally { server.stop(true); }
});

test("legacy backfill is idempotent and record deletion retains the original stored file", async () => {
  const { t, owner, requestId } = await fixture();
  const storageId = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['old-file']));
    await ctx.db.patch(requestId, { artifacts: [{ id: 'old', storageId, name: 'old.txt', size: 8, contentType: 'text/plain', createdAt: 1 }] });
    return storageId;
  });
  expect((await t.mutation(internal.artifactMigration.backfill, { cursor: null })).inserted).toBe(1);
  expect((await t.mutation(internal.artifactMigration.backfill, { cursor: null })).inserted).toBe(0);
  const result = await owner.action(api.artifactTransfers.downloadUrl, { requestId, artifactId: 'old' });
  expect(result.legacy).toBe(true); expect(result.expiresAt).toBeNull();
  await owner.mutation(api.artifactStore.remove, { requestId, artifactId: 'old' });
  expect(await t.run(async ctx => (await ctx.storage.get(storageId)) !== null)).toBe(true);
});

test("reset revokes old sessions/reports and a new assigned run may publish the same logical artifact ID", async () => {
  const { t, owner, requestId, tokenId } = await fixture();
  const u = await t.mutation(internal.artifactStore.begin, { requestId, artifactId: 'output', size: 3, sha256, contentType: 'text/plain', nonce: 'old', tokenId, assignmentVersion: 1 });
  await t.mutation(internal.artifactStore.reserve, { uploadId: u.uploadId, tokenId, assignmentVersion: 1, etag: '"etag"', name: 'out.txt' });
  await t.mutation(internal.artifactStore.finish, { uploadId: u.uploadId, tokenId, assignmentVersion: 1 });
  await t.run(ctx => ctx.db.patch(requestId, { status: 'process_failed' }));
  await owner.mutation(api.requests.reset, { id: requestId });
  expect(await owner.query(api.artifactStore.list, { requestId })).toEqual([]);
  const [claimed] = await t.mutation(internal.units.claim, { tokenId, unitId: 'unit-a', specSlug: 'demo', maxCount: 1 });
  expect(claimed.assignmentVersion).toBe(3);
  await expect(t.query(internal.artifactStore.session, { uploadId: u.uploadId, tokenId, assignmentVersion: 1 })).rejects.toThrow();
  const next = await t.mutation(internal.artifactStore.begin, { requestId, artifactId: 'output', size: 3, sha256, contentType: 'text/plain', nonce: 'new', tokenId, assignmentVersion: claimed.assignmentVersion });
  expect(next.finalKey).not.toBe(u.finalKey);
});

test("HTTP hooks enforce active tokens, bound identity and the restricted request API", async () => {
  const { t, tokenId } = await fixture();
  const headers = { Authorization: 'Bearer worker-token', 'Content-Type': 'application/json' };
  expect((await t.fetch('/api/health')).status).toBe(200);
  expect((await t.fetch('/api/requests/create', { method: 'POST', body: '{}' })).status).toBe(401);
  expect((await t.fetch('/api/requests/create', { method: 'POST', headers, body: '{}' })).status).toBe(403);
  expect((await t.fetch('/api/requests?specSlug=demo', { headers })).status).toBe(403);
  expect((await t.fetch('/api/specs/demo', { headers })).status).toBe(200);
  expect((await t.fetch('/api/specs/other', { headers })).status).not.toBe(200);
  await t.run(ctx => ctx.db.patch(tokenId, { unitId: undefined }));
  expect((await t.fetch('/api/units/heartbeat', { method: 'POST', headers, body: JSON.stringify({ unitId: 'unit-a', status: 'online', devices: [] }) })).status).toBe(400);
});
