import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";

// Create notification from HTTP hooks or internal workflows.
export const create = internalMutation({
  args: {
    title: v.string(),
    message: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("notifications"),

  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// List notifications for the app.
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("notifications"),
      _creationTime: v.number(),
      title: v.string(),
      message: v.string(),
      tags: v.optional(v.array(v.string())),
      createdAt: v.number(),
      readAt: v.optional(v.number()),
      deletedAt: v.optional(v.number()),
    }),
  ),

  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_deleted_at", (q) =>
        q.eq("deletedAt", undefined),
      )
      .order("desc")
      .take(args.limit ?? 50);

    return notifications;
  },
});

// Mark notification as read.
export const markRead = mutation({
  args: {
    id: v.id("notifications"),
  },
  returns: v.null(),

  handler: async (ctx, { id }) => {
    const notification = await ctx.db.get(id);

    if (!notification || notification.deletedAt !== undefined) {
      return null;
    }

    if (notification.readAt === undefined) {
      await ctx.db.patch(id, {
        readAt: Date.now(),
      });
    }

    return null;
  },
});

// Soft-delete notification.
export const remove = mutation({
  args: {
    id: v.id("notifications"),
  },
  returns: v.null(),

  handler: async (ctx, { id }) => {
    const notification = await ctx.db.get(id);

    if (!notification || notification.deletedAt !== undefined) {
      return null;
    }

    await ctx.db.patch(id, {
      deletedAt: Date.now(),
    });

    return null;
  },
});
