import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";

export const requestStatus = v.union(
  v.literal("waiting"), v.literal("possessed"), v.literal("processing"),
  v.literal("process_failed"), v.literal("artifact_available"),
  v.literal("retrieve_artifact_failed"), v.literal("succeeded"),
);

export const selectionArgs = {
  specSlug: v.string(),
  maxCount: v.number(),
  by_pipeline: v.optional(v.string()),
  by_status: v.optional(v.string()),
  by_unit_id: v.optional(v.string()),
};

type Selection = {
  specSlug: string;
  maxCount: number;
  by_pipeline?: string;
  by_status?: string;
  by_unit_id?: string;
};

// Each combination uses an equality index, so filtering happens before the limit.
export async function selectRequests(ctx: Pick<QueryCtx, "db">, args: Selection) {
  const { specSlug, maxCount, by_pipeline, by_status, by_unit_id } = args;
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100) {
    throw new Error("maxCount must be an integer from 1 to 100");
  }
  if (by_status !== undefined && by_pipeline !== undefined && by_unit_id !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_pipeline_unit", q => q.eq("specSlug", specSlug).eq("status", by_status).eq("pipelineName", by_pipeline).eq("unitId", by_unit_id))
      .order("asc").take(maxCount);
  }
  if (by_status !== undefined && by_pipeline !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_pipeline", q => q.eq("specSlug", specSlug).eq("status", by_status).eq("pipelineName", by_pipeline))
      .order("asc").take(maxCount);
  }
  if (by_status !== undefined && by_unit_id !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_unit", q => q.eq("specSlug", specSlug).eq("status", by_status).eq("unitId", by_unit_id))
      .order("asc").take(maxCount);
  }
  if (by_pipeline !== undefined && by_unit_id !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_pipeline_unit", q => q.eq("specSlug", specSlug).eq("pipelineName", by_pipeline).eq("unitId", by_unit_id))
      .order("asc").take(maxCount);
  }
  if (by_status !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_slug_and_status", q => q.eq("specSlug", specSlug).eq("status", by_status))
      .order("asc").take(maxCount);
  }
  if (by_pipeline !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_pipeline", q => q.eq("specSlug", specSlug).eq("pipelineName", by_pipeline))
      .order("asc").take(maxCount);
  }
  if (by_unit_id !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_unit", q => q.eq("specSlug", specSlug).eq("unitId", by_unit_id))
      .order("asc").take(maxCount);
  }
  return ctx.db.query("requests")
    .withIndex("by_spec_slug", q => q.eq("specSlug", specSlug))
    .order("asc").take(maxCount);
}
