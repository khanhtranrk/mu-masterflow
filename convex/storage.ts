import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { requireAuthenticated, requireOwner } from "./authz";

import { configArgs } from "./storageModel";
const publicConnection = v.object({ ...configArgs, enabled: v.boolean(), createdAt: v.number() });
const connection = v.object({ ...configArgs, enabled: v.boolean(), createdAt: v.number(), encryptedCredentials: v.string(), _id: v.id("storageConnections"), _creationTime: v.number() });
export const initialize = internalMutation({
  args: { ownerId: v.string() }, returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    if (!ownerId.startsWith("user_")) throw new Error("Expected Clerk user ID");
    if (await ctx.db.query("storageSettings").first()) throw new Error("Owner already configured");
    await ctx.db.insert("storageSettings", { ownerId }); return null;
  },
});
export const list = query({ args: {}, returns: v.object({ isOwner: v.boolean(), defaultConnectionId: v.optional(v.string()), connections: v.array(publicConnection) }),
  handler: async ctx => {
    const user = await requireAuthenticated(ctx);
    const settings = await ctx.db.query("storageSettings").first();
    const rows = await ctx.db.query("storageConnections").withIndex("by_connection").take(200);
    return { isOwner: settings?.ownerId === user, defaultConnectionId: settings?.defaultConnectionId,
      connections: rows.map(({ _id, _creationTime, encryptedCredentials, ...safe }) => safe) };
  },
});
export const owner = internalQuery({ args: {}, returns: v.string(), handler: ctx => requireOwner(ctx) });
export const get = internalQuery({ args: { connectionId: v.string() }, returns: v.union(connection, v.null()),
  handler: (ctx, { connectionId }) => ctx.db.query("storageConnections").withIndex("by_connection", q => q.eq("connectionId", connectionId)).unique() });
export const save = internalMutation({ args: { ...configArgs, encryptedCredentials: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const existing = await ctx.db.query("storageConnections").withIndex("by_connection", q => q.eq("connectionId", args.connectionId)).unique();
    if (existing) {
      for (const field of ["provider", "endpoint", "region", "bucket", "prefix"] as const) if (existing[field] !== args[field]) throw new Error("Create a new connection to change storage location.");
      await ctx.db.patch(existing._id, { name: args.name, encryptedCredentials: args.encryptedCredentials });
    } else {
      if ((await ctx.db.query("storageConnections").withIndex("by_connection").take(200)).length >= 200) throw new Error("Storage connection limit reached");
      await ctx.db.insert("storageConnections", { ...args, enabled: true, createdAt: Date.now() });
      const settings = await ctx.db.query("storageSettings").first();
      if (settings && !settings.defaultConnectionId) await ctx.db.patch(settings._id, { defaultConnectionId: args.connectionId });
    }
    return null;
  },
});
export const configure = mutation({ args: { connectionId: v.string(), enabled: v.optional(v.boolean()), makeDefault: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const record = await ctx.db.query("storageConnections").withIndex("by_connection", q => q.eq("connectionId", args.connectionId)).unique();
    if (!record) throw new Error("Connection not found");
    const settings = await ctx.db.query("storageSettings").first();
    if (args.enabled !== undefined) await ctx.db.patch(record._id, { enabled: args.enabled });
    if (args.makeDefault) {
      if (!(args.enabled ?? record.enabled)) throw new Error("Enable connection first");
      await ctx.db.patch(settings!._id, { defaultConnectionId: record.connectionId });
    } else if (args.enabled === false && settings?.defaultConnectionId === record.connectionId) {
      await ctx.db.patch(settings._id, { defaultConnectionId: undefined });
    }
    return null;
  },
});
