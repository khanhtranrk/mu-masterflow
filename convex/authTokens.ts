
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";

const tokenInfo = v.object({
  _id: v.id("authTokens"),
  _creationTime: v.number(),
  name: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
});


export const getByHash = internalQuery({
  args: {
    tokenHash: v.string(),
  },
  returns: v.union(
    v.object({
      deletedAt: v.optional(v.number()),
      expiresAt: v.optional(v.number()),
    }),
    v.null(),
  ),

  handler: async (ctx, { tokenHash }) => {
    const token = await ctx.db
      .query("authTokens")
      .withIndex("by_token_hash", (q) =>
        q.eq("tokenHash", tokenHash),
      )
      .first();

    if (!token) {
      return null;
    }

    return {
      deletedAt: token.deletedAt,
      expiresAt: token.expiresAt,
    };
  },
});

export const list = internalQuery({
  args: {
    includeRevoked: v.optional(v.boolean()),
  },
  returns: v.array(tokenInfo),

  handler: async (ctx, { includeRevoked }) => {
    const tokens = await ctx.db
      .query("authTokens")
      .withIndex("by_deleted_at", (q) =>
        q.eq("deletedAt", undefined),
      )
      .order("desc")
      .take(100);

    if (!includeRevoked) {
      return tokens;
    }

    const revoked = await ctx.db
      .query("authTokens")
      .withIndex("by_deleted_at", (q) =>
        q.gt("deletedAt", 0),
      )
      .order("desc")
      .take(100);

    return [...tokens, ...revoked]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  },
});

export const get = internalQuery({
  args: {
    id: v.id("authTokens"),
  },
  returns: v.union(tokenInfo, v.null()),

  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);

    if (!token) {
      return null;
    }

    return token;
  },
});

export const create = internalMutation({
  args: {
    name: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({
    id: v.id("authTokens"),
    token: v.string(),
  }),

  handler: async (ctx, { name, expiresAt }) => {
    if (!name.trim()) {
      throw new Error("Token name is required");
    }

    if (
      expiresAt !== undefined &&
      expiresAt <= Date.now()
    ) {
      throw new Error("expiresAt must be in the future");
    }

    // Generate a cryptographically random 256-bit token.
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );

    const tokenHash = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");

    const id = await ctx.db.insert("authTokens", {
      name: name.trim(),
      tokenHash,
      createdAt: Date.now(),
      ...(expiresAt !== undefined && { expiresAt }),
    });

    // The plaintext token is returned only once.
    return { id, token };
  },
});

export const update = internalMutation({
  args: {
    id: v.id("authTokens"),
    name: v.optional(v.string()),
    expiresAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),

  handler: async (ctx, { id, name, expiresAt }) => {
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

export const revoke = internalMutation({
  args: {
    id: v.id("authTokens"),
  },
  returns: v.null(),

  handler: async (ctx, { id }) => {
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
