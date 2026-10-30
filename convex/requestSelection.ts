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
  byPipeline: v.optional(v.union(v.string(), v.array(v.string()))),
  byStatus: v.optional(v.union(v.string(), v.array(v.string()))),
  byUnitId: v.optional(v.string()),
};

type Selection = {
  specSlug: string;
  maxCount: number;
  byPipeline?: string | string[];
  byStatus?: string | string[];
  byUnitId?: string;
};

// Each combination uses an equality index, so filtering happens before the limit.
async function selectOne(ctx: Pick<QueryCtx, "db">, args: Omit<Selection, "byPipeline" | "byStatus"> & { byPipeline?: string; byStatus?: string }) {
  const { specSlug, maxCount, byPipeline, byStatus, byUnitId } = args;
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 100) {
    throw new Error("maxCount must be an integer from 1 to 100");
  }
  if (byStatus !== undefined && byPipeline !== undefined && byUnitId !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_pipeline_unit", q => q.eq("specSlug", specSlug).eq("status", byStatus).eq("pipelineName", byPipeline).eq("unitId", byUnitId))
      .order("asc").take(maxCount);
  }
  if (byStatus !== undefined && byPipeline !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_pipeline", q => q.eq("specSlug", specSlug).eq("status", byStatus).eq("pipelineName", byPipeline))
      .order("asc").take(maxCount);
  }
  if (byStatus !== undefined && byUnitId !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_status_unit", q => q.eq("specSlug", specSlug).eq("status", byStatus).eq("unitId", byUnitId))
      .order("asc").take(maxCount);
  }
  if (byPipeline !== undefined && byUnitId !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_pipeline_unit", q => q.eq("specSlug", specSlug).eq("pipelineName", byPipeline).eq("unitId", byUnitId))
      .order("asc").take(maxCount);
  }
  if (byStatus !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_slug_and_status", q => q.eq("specSlug", specSlug).eq("status", byStatus))
      .order("asc").take(maxCount);
  }
  if (byPipeline !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_pipeline", q => q.eq("specSlug", specSlug).eq("pipelineName", byPipeline))
      .order("asc").take(maxCount);
  }
  if (byUnitId !== undefined) {
    return ctx.db.query("requests")
      .withIndex("by_spec_unit", q => q.eq("specSlug", specSlug).eq("unitId", byUnitId))
      .order("asc").take(maxCount);
  }
  return ctx.db.query("requests")
    .withIndex("by_spec_slug", q => q.eq("specSlug", specSlug))
    .order("asc").take(maxCount);
}


// Each branch reads at most maxCount through its equality index. Merge before
// taking the global limit; the caller claims the result in the same transaction.
export async function selectRequests(ctx: Pick<QueryCtx, "db">, args: Selection) {
  function values(value: string | string[] | undefined, name: string): (string | undefined)[] {
    if (value === undefined) return [undefined];
    const items = Array.isArray(value) ? [...new Set(value)] : [value];
    if (!items.length || items.length > 100 || items.some(item => !item.trim())) {
      throw new Error(`${name} must contain 1–100 non-empty strings`);
    }
    return items;
  }
  const pipelines = values(args.byPipeline, "byPipeline");
  const statuses = values(args.byStatus, "byStatus");
  if (pipelines.length * statuses.length > 100) {
    throw new Error("At most 100 pipeline/status filter combinations are supported");
  }
  const branches = [];
  for (const byPipeline of pipelines) {
    for (const byStatus of statuses) {
      branches.push(await selectOne(ctx, { ...args, byPipeline, byStatus }));
    }
  }
  const unique = new Map(branches.flat().map(request => [request._id, request]));
  return [...unique.values()]
    .sort((a, b) => a._creationTime - b._creationTime || a._id.localeCompare(b._id))
    .slice(0, args.maxCount);
}
