import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  specs: defineTable({
    slug: v.string(), name: v.string(), description: v.string(), yaml: v.string(),
    enabled: v.boolean(),
  }).index("by_slug", ["slug"]),
  spaces: defineTable({ specSlug: v.string(), name: v.string() }).index("by_spec_slug", ["specSlug"]),
  requests: defineTable({
    specSlug: v.string(), pipelineName: v.optional(v.string()), title: v.string(), status: v.string(), params: v.any(),
    technical: v.any(), plan: v.optional(v.any()), nodeStates: v.optional(v.any()), currentNode: v.optional(v.string()),
    unitId: v.optional(v.string()), progress: v.number(),
  }).index("by_spec_slug", ["specSlug"]).index("by_spec_slug_and_status", ["specSlug", "status"]).index("by_status", ["status"]).index("by_unit_id", ["unitId"]),
  units: defineTable({
    unitId: v.string(), status: v.string(), lastSeen: v.number(), specSlugs: v.array(v.string()),
    workloads: v.array(v.string()), unitType: v.optional(v.string()), workingDir: v.optional(v.string()), devices: v.optional(v.array(v.any())), device: v.optional(v.any()), metadata: v.any(),
    currentRequestIds: v.optional(v.array(v.id("requests"))), currentRequestId: v.optional(v.id("requests")),
  }).index("by_unit_id", ["unitId"]).index("by_status", ["status"]),
});
