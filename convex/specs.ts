import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => ctx.db.query("specs").order("desc").take(100),
});

export const getYaml = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { slug }) => {
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", slug)).first();
    return spec?.yaml ?? null;
  },
});

// Temporary one-time backfill before the execution schema drops legacy fields.
export const migrateExecutionContract = mutation({
  args: {},
  returns: v.object({ requests: v.number(), units: v.number() }),
  handler: async (ctx) => {
    const requests = await ctx.db.query("requests").take(501);
    const units = await ctx.db.query("units").take(501);
    if (requests.length > 500 || units.length > 500) throw new Error("Migration is limited to 500 requests and units per table");
    const requestStatus = (status: string) => ({
      queued: "waiting", waiting: "waiting", received: "possessed", possessed: "possessed",
      running: "processing", processing: "processing", success: "succeeded", complete: "succeeded",
      completed: "succeeded", succeeded: "succeeded", failed: "process_failed", process_failed: "process_failed",
      artifact_available: "artifact_available", retrieve_artifact_failed: "retrieve_artifact_failed",
    }[status] ?? "waiting");
    const nodeStatus = (status: string) => ({ queued: "queue", queue: "queue", running: "running", failed: "failed", success: "succeeded", succeeded: "succeeded" }[status] ?? "queue");
    for (const request of requests) {
      const states = request.nodeStates && typeof request.nodeStates === "object" ? request.nodeStates as Record<string, any> : {};
      const legacyPlan = Object.entries(states).map(([nodeName, state]) => ({
        nodeName, status: nodeStatus(String(state?.status ?? "queue")),
        ...(state?.device ? { device: state.device } : {}),
      }));
      const plan = Array.isArray(request.plan) && request.plan.length ? request.plan : legacyPlan;
      const technical = { ...(request.technical ?? {}), ...(Object.keys(states).length ? { legacyNodeStates: states } : {}) };
      await ctx.db.replace(request._id, {
        specSlug: request.specSlug, ...(request.pipelineName ? { pipelineName: request.pipelineName } : {}),
        title: request.title, status: requestStatus(request.status), params: request.params,
        technical, plan, ...(request.currentNode ? { currentNode: request.currentNode } : {}),
        ...(request.unitId ? { unitId: request.unitId } : {}), progress: request.progress ?? 0,
      });
    }
    for (const unit of units) {
      const metadata = unit.metadata && typeof unit.metadata === "object" ? unit.metadata as Record<string, any> : {};
      const devices = unit.devices ?? (unit.device?.family ? [unit.device] : []);
      const currentRequestIds = unit.currentRequestIds ?? (unit.currentRequestId ? [unit.currentRequestId] : []);
      await ctx.db.replace(unit._id, {
        unitId: unit.unitId, status: unit.status, lastSeen: unit.lastSeen,
        specSlugs: unit.specSlugs ?? [], workloads: unit.workloads ?? [],
        unitType: unit.unitType ?? metadata.unitType ?? "unknown",
        workingDir: unit.workingDir ?? metadata.workingDir ?? "", devices, metadata,
        currentRequestIds,
      });
    }
    return { requests: requests.length, units: units.length };
  },
});

export const create = mutation({
  args: { slug: v.string(), name: v.string(), description: v.string(), yaml: v.string() },
  returns: v.id("specs"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", args.slug)).first();
    if (existing) throw new Error("A spec with this slug already exists");
    const id = await ctx.db.insert("specs", { ...args, enabled: true });
    await ctx.db.insert("spaces", { specSlug: args.slug, name: args.name });
    return id;
  },
});

export const update = mutation({
  args: { id: v.id("specs"), name: v.string(), description: v.string(), yaml: v.string() },
  returns: v.id("specs"),
  handler: async (ctx, { id, ...patch }) => {
    const spec = await ctx.db.get(id);
    if (!spec) throw new Error("Spec not found");
    await ctx.db.patch(id, patch);
    const space = await ctx.db.query("spaces").withIndex("by_spec_slug", q => q.eq("specSlug", spec.slug)).first();
    if (space && space.name !== patch.name) await ctx.db.patch(space._id, { name: patch.name });
    return id;
  },
});

export const rename = mutation({
  args: { id: v.id("specs"), name: v.string() },
  returns: v.id("specs"),
  handler: async (ctx, { id, name }) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Space name cannot be empty");
    const spec = await ctx.db.get(id);
    if (!spec) throw new Error("Spec not found");
    await ctx.db.patch(id, { name: trimmedName });
    const spaces = await ctx.db.query("spaces").withIndex("by_spec_slug", q => q.eq("specSlug", spec.slug)).take(100);
    if (spaces.length) {
      for (const space of spaces) await ctx.db.patch(space._id, { name: trimmedName });
    } else {
      await ctx.db.insert("spaces", { specSlug: spec.slug, name: trimmedName });
    }
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("specs") },
  returns: v.object({ deletedRequests: v.number() }),
  handler: async (ctx, { id }) => {
    const spec = await ctx.db.get(id);
    if (!spec) throw new Error("Spec not found");
    const requests = await ctx.db.query("requests").withIndex("by_spec_slug", q => q.eq("specSlug", spec.slug)).take(501);
    if (requests.length > 500) throw new Error("This space has more than 500 requests. Delete requests in smaller batches first.");
    const unitRequestIds = new Map<string, Set<string>>();
    for (const request of requests) {
      if (request.unitId) {
        const ids = unitRequestIds.get(request.unitId) ?? new Set<string>();
        ids.add(request._id);
        unitRequestIds.set(request.unitId, ids);
      }
      await ctx.db.delete(request._id);
    }
    for (const [unitId, deletedIds] of unitRequestIds) {
      const unit = await ctx.db.query("units").withIndex("by_unit_id", q => q.eq("unitId", unitId)).first();
      if (!unit) continue;
      const current = unit.currentRequestIds ?? (unit.currentRequestId ? [unit.currentRequestId] : []);
      const active = current.filter((requestId) => !deletedIds.has(requestId));
      await ctx.db.patch(unit._id, { currentRequestIds: active, currentRequestId: undefined, status: active.length ? "busy" : "online" });
    }
    const spaces = await ctx.db.query("spaces").withIndex("by_spec_slug", q => q.eq("specSlug", spec.slug)).take(100);
    for (const space of spaces) await ctx.db.delete(space._id);
    await ctx.db.delete(id);
    return { deletedRequests: requests.length };
  },
});

export const seedExample = mutation({
  args: {},
  returns: v.id("specs"),
  handler: async (ctx) => {
    const slug = "song-with-cover";
    const existing = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", slug)).first();
    if (existing) return existing._id;
    const nodes = [
      { name: "generate-song", workload: "yue2", detail: "Create song + score", status: "queued" },
      { name: "generate-cover", workload: "qwen-image", detail: "Create cover art", status: "queued" },
      { name: "separate-vocals", workload: "demucs", detail: "Separate vocal track", status: "queued" },
      { name: "transcribe-vocals", workload: "whisperx", detail: "Transcribe vocal track", status: "queued" },
    ];
    const yaml = `master-flow:\n  requests: []\nprepare: []\nworkloads:\n  yue2:\n    params: { request: { type: string }, output: { type: string } }\n    target: "{sys[cache_dir]}/bin/yue-synth"\npipeline:\n  song-with-cover:\n    params: { name: { type: string }, style: { type: string }, lyrics: { type: string } }\n    nodes:\n${nodes.map(node => `      - name: ${node.name}\n        run:\n          workload: ${node.workload}`).join("\n")}`;
    const id = await ctx.db.insert("specs", { slug, name: "Song with cover", description: "Generate a song, create its cover, then prepare vocals and transcript.", yaml, enabled: true });
    await ctx.db.insert("spaces", { specSlug: slug, name: "Song with cover" });
    return id;
  },
});
