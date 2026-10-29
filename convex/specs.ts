import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("specs")
      .withIndex("by_deleted_at", (q) =>
        q.eq("deletedAt", undefined),
      )
      .order("desc")
      .take(100),
});

export const getYaml = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { slug }) => {
    const spec = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", slug)).first();
    return spec?.yaml ?? null;
  },
});

export const create = mutation({
  args: { slug: v.string(), name: v.string(), description: v.string(), yaml: v.string() },
  returns: v.id("specs"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("specs").withIndex("by_slug", q => q.eq("slug", args.slug)).first();
    if (existing) throw new Error("A spec with this slug already exists");
    const id = await ctx.db.insert("specs", { ...args, enabled: true });
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
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("specs") },
  handler: async (ctx, { id }) => {
    const spec = await ctx.db.get(id);
    if (!spec) throw new Error("Spec not found");
    await ctx.db.patch(id, {
      deletedAt: Date.now(),
    });
  },
});
