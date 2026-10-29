import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  authTokens: defineTable({
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

  requests: defineTable({
    specSlug: v.string(),
    pipelineName: v.string(),
    status: v.string(),
    payload: v.any(),
    nodeStates: v.optional(v.record(
      v.string(),
      v.object({
        status: v.string(),
        device: v.optional(v.object({
          family: v.string(),
          index: v.number(),
        })),
        artifacts: v.optional(v.record(
          v.string(),
          v.string()
        )),
        logs: v.optional(v.array(v.string()))
      }),
    )),
    unitId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
  }).index("by_spec_slug", ["specSlug"])
  .index("by_spec_slug_and_status", ["specSlug", "status"])
  .index("by_status", ["status"]),

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
