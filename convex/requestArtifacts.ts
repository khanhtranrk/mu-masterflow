// Transitional URL lookup for legacy desktop builds. New S3 downloads use actions.
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthenticated } from "./authz";
export const urls = query({
  args: { requestId: v.id("requests") }, returns: v.array(v.object({ id: v.string(), url: v.union(v.string(), v.null()) })),
  handler: async (ctx, { requestId }) => {
    await requireAuthenticated(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt !== undefined) return [];
    return Promise.all((request.artifacts ?? []).map(async a => ({ id: a.id, url: a.storageId ? await ctx.storage.getUrl(a.storageId) : null })));
  },
});
