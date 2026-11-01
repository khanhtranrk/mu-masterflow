import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { artifact } from "./artifactModel";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  notifications: defineTable({
    title: v.string(),
    message: v.string(),
    tags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
  .index("by_created_at", ["createdAt"])
  .index("by_deleted_at", ["deletedAt"]),

  unitTokens: defineTable({
    name: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
  .index("by_token_hash", ["tokenHash"])
  .index("by_deleted_at", ["deletedAt"]),

  specs: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    yaml: v.string(),
    enabled: v.boolean(),
    deletedAt: v.optional(v.number()),
  }).index("by_slug", ["slug"])
  .index("by_deleted_at", ["deletedAt"]),

  artifactUploads: defineTable({
    requestId: v.id("requests"),
    artifactId: v.string(),
    resetVersion: v.optional(v.number()),
    owner: v.string(),
    sha256: v.string(),
    size: v.number(),
    expiresAt: v.number(),
    storageId: v.optional(v.id("_storage")),
  }).index("by_storage", ["storageId"])
  .index("by_request", ["requestId"]),

  requests: defineTable({
    specSlug: v.string(),
    pipelineName: v.string(),
    resetVersion: v.optional(v.number()),
    status: v.string(),
    payload: v.any(),
    artifacts: v.optional(v.array(artifact)),
    nodeStates: v.optional(v.record(
      v.string(),
      v.object({
        status: v.string(),
        reason: v.optional(v.string()),
        device: v.optional(v.object({
          family: v.string(),
          index: v.number(),
        })),
        artifacts: v.optional(v.array(artifact)),
        logs: v.optional(v.array(v.string()))
      }),
    )),
    unitId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  }).index("by_spec_slug", ["specSlug", "deletedAt"])
  .index("by_spec_slug_and_status", ["specSlug", "status", "deletedAt"])
  .index("by_spec_pipeline", ["specSlug", "pipelineName", "deletedAt"])
  .index("by_spec_unit", ["specSlug", "unitId", "deletedAt"])
  .index("by_spec_status_pipeline", ["specSlug", "status", "pipelineName", "deletedAt"])
  .index("by_spec_status_unit", ["specSlug", "status", "unitId", "deletedAt"])
  .index("by_spec_pipeline_unit", ["specSlug", "pipelineName", "unitId", "deletedAt"])
  .index("by_spec_status_pipeline_unit", ["specSlug", "status", "pipelineName", "unitId", "deletedAt"])
  .index("by_status", ["status"])
  .index("by_status_deleted_at", ["status", "deletedAt"]),

  units: defineTable({
    unitId: v.string(),
    unitType: v.string(),
    status: v.union(v.literal("online"), v.literal("offline")),
    workingDir: v.string(),
    devices: v.array(
      v.object({
        family: v.string(),
        index: v.number(),
      }),
    ),
    lastSeen: v.number()
  }).index("by_unit_id", ["unitId"])
  .index("by_status", ["status"]),
});
