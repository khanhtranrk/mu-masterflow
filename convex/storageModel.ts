import { v } from "convex/values";

export const configArgs = {
  connectionId: v.string(), name: v.string(), provider: v.union(v.literal("r2"), v.literal("supabase")),
  endpoint: v.string(), region: v.string(), bucket: v.string(), prefix: v.string(),
};

export const artifactMetadata = v.object({
  connectionId: v.optional(v.string()), objectKey: v.optional(v.string()), storageId: v.optional(v.id("_storage")),
  resetVersion: v.optional(v.number()), name: v.string(), contentType: v.string(), size: v.number(), createdAt: v.number(),
  nodeName: v.optional(v.string()), label: v.optional(v.string()),
});
export const artifactFields = {
  artifactId: v.string(), requestId: v.id("requests"), handler: v.union(v.literal("s3"), v.literal("convex-legacy")),
  metadata: artifactMetadata,
};
export const uploadFields = {
  requestId: v.id("requests"), artifactId: v.string(), connectionId: v.string(), stagingKey: v.string(), finalKey: v.string(),
  owner: v.string(), resetVersion: v.number(), assignmentVersion: v.number(), size: v.number(), sha256: v.string(),
  contentType: v.string(), sourceEtag: v.optional(v.string()), expiresAt: v.number(), completed: v.optional(v.boolean()),
  name: v.optional(v.string()), nodeName: v.optional(v.string()), label: v.optional(v.string()),
};
