
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAuthenticated } from "./authz";

const tokenInfo = v.object({
  _id: v.id("unitTokens"),
  _creationTime: v.number(),
  name: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
});

const toTokenInfo = ({
  _id,
  _creationTime,
  name,
  createdAt,
  lastUsedAt,
  expiresAt,
  deletedAt,
}: Doc<"unitTokens">) => ({
  _id,
  _creationTime,
  name,
  createdAt,
  ...(lastUsedAt !== undefined && { lastUsedAt }),
  ...(expiresAt !== undefined && { expiresAt }),
  ...(deletedAt !== undefined && { deletedAt }),
});


export const getByHash = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("unitTokens"),
      lastUsedAt: v.optional(v.number()),
      deletedAt: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
    }),
    v.null(),
  ),

  handler: async (ctx, { tokenHash }) => {
    const token = await ctx.db
      .query("unitTokens")
      .withIndex("by_token_hash", (q) =>
        q.eq("tokenHash", tokenHash),
      )
      .first();

    if (!token) {
      return null;
    }

    return {
      _id: token._id,
      lastUsedAt: token.lastUsedAt,
      deletedAt: token.deletedAt,
      expiresAt: token.expiresAt,
    };
  },
});

export const markUsed = internalMutation({
  args: {
    id: v.id("unitTokens"),
    usedAt: v.number(),
  },
  returns: v.null(),

  handler: async (ctx, { id, usedAt }) => {
    const token = await ctx.db.get(id);
    if (!token || token.deletedAt !== undefined) return null;
    await ctx.db.patch(id, { lastUsedAt: usedAt });
    return null;
  },
});

export const list = query({
  args: {
    includeRevoked: v.optional(v.boolean()),
  },
  returns: v.array(tokenInfo),

  handler: async (ctx, { includeRevoked }) => {
    await requireAuthenticated(ctx);
    const tokens = await ctx.db
      .query("unitTokens")
      .withIndex("by_deleted_at", (q) =>
        q.eq("deletedAt", undefined),
      )
      .order("desc")
      .take(100);

    if (!includeRevoked) return tokens.map(toTokenInfo);

    const revoked = await ctx.db
      .query("unitTokens")
      .withIndex("by_deleted_at", (q) =>
        q.gt("deletedAt", 0),
      )
      .order("desc")
      .take(100);

    return [...tokens, ...revoked]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map(toTokenInfo);
  },
});

export const get = internalQuery({
  args: {
    id: v.id("unitTokens"),
  },
  returns: v.union(tokenInfo, v.null()),

  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);

    if (!token) {
      return null;
    }

    return toTokenInfo(token);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    tokenHash: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("unitTokens"),

  handler: async (ctx, { name, tokenHash, expiresAt }) => {
    await requireAuthenticated(ctx);
    if (!name.trim()) {
      throw new Error("Token name is required");
    }

    if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
      throw new Error("tokenHash must be a SHA-256 hex digest");
    }

    if (
      expiresAt !== undefined &&
      expiresAt <= Date.now()
    ) {
      throw new Error("expiresAt must be in the future");
    }

    const id = await ctx.db.insert("unitTokens", {
      name: name.trim(),
      tokenHash,
      createdAt: Date.now(),
      ...(expiresAt !== undefined && { expiresAt }),
    });

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("unitTokens"),
    name: v.optional(v.string()),
    expiresAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),

  handler: async (ctx, { id, name, expiresAt }) => {
    await requireAuthenticated(ctx);
    const token = await ctx.db.get(id);

    if (!token || token.deletedAt !== undefined) {
      throw new Error("Active token not found");
    }

    if (name !== undefined && !name.trim()) {
      throw new Error("Token name is required");
    }

    if (expiresAt !== null && expiresAt <= Date.now()) {
      throw new Error("expiresAt must be in the future");
    }

    await ctx.db.patch(id, {
      ...(name !== undefined && { name: name.trim() }),
      expiresAt: expiresAt === null ? undefined : expiresAt,
    });

    return null;
  },
});

export const revoke = mutation({
  args: {
    id: v.id("unitTokens"),
  },
  returns: v.null(),

  handler: async (ctx, { id }) => {
    await requireAuthenticated(ctx);
    const token = await ctx.db.get(id);

    if (!token || token.deletedAt !== undefined) {
      throw new Error("Active token not found");
    }

    await ctx.db.patch(id, {
      deletedAt: Date.now(),
    });

    return null;
  },
});
