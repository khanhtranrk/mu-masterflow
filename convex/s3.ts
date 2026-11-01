"use node";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { configArgs } from "./storageModel";

type Credentials = { accessKeyId: string; secretAccessKey: string };
function key() {
  const bytes = Buffer.from(process.env.STORAGE_ENCRYPTION_KEY ?? "", "base64");
  if (bytes.length !== 32) throw new Error("Storage encryption key is not configured.");
  return bytes;
}
export function encrypt(value: Credentials, id: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
export function decrypt(value: string, id: string): Credentials {
  const box = JSON.parse(value); if (box.version !== 1) throw new Error("Unsupported credentials version");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(box.iv, "base64"));
  decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
}
export function client(c: { connectionId: string; endpoint: string; region: string; encryptedCredentials: string }) {
  return new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: true,
    credentials: decrypt(c.encryptedCredentials, c.connectionId), requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}
export const saveConnection = action({ args: { ...configArgs, accessKeyId: v.string(), secretAccessKey: v.string() }, returns: v.null(),
  handler: async (ctx, { accessKeyId, secretAccessKey, ...args }) => {
    await ctx.runQuery(internal.storage.owner, {});
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(args.connectionId)) throw new Error("Use a stable lowercase connection ID.");
    const url = new URL(args.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Storage endpoint must be HTTPS without credentials or query parameters.");
    // Only supported provider endpoints; avoid turning credentials checks into arbitrary network requests.
    if (args.provider === "r2" && url.pathname !== "/") throw new Error("Enter the R2 endpoint without the bucket path; use the separate bucket field.");
    const host = url.hostname;
    if (args.provider === "r2" ? !host.endsWith(".r2.cloudflarestorage.com") : !url.pathname.replace(/\/$/, "").endsWith("/storage/v1/s3")) throw new Error("Use the provider's S3 API endpoint.");
    if (!args.bucket.trim() || !args.region.trim() || !args.name.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) throw new Error("Complete all storage fields.");
    if (args.prefix.startsWith("/") || args.prefix.includes("..")) throw new Error("Invalid object prefix.");
    const encryptedCredentials = encrypt({ accessKeyId, secretAccessKey }, args.connectionId);
    const s3 = client({ ...args, encryptedCredentials });
    try { await s3.send(new HeadBucketCommand({ Bucket: args.bucket })); }
    catch { throw new Error("Storage connection failed. Check endpoint, bucket, region and credentials."); }
    finally { s3.destroy(); }
    await ctx.runMutation(internal.storage.save, { ...args, encryptedCredentials }); return null;
  },
});
