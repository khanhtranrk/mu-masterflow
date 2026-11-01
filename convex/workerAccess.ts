import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export async function workerIdentity(ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">, tokenId: Id<"unitTokens">) {
  const token = await ctx.db.get(tokenId);
  if (!token || token.deletedAt !== undefined || (token.expiresAt !== undefined && token.expiresAt <= Date.now()) || !token.unitId) {
    throw new Error("Worker token must be active and bound to a unit by the owner.");
  }
  return token;
}
export async function assignedRequest(ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">, requestId: Id<"requests">, tokenId: Id<"unitTokens">, allowDeleted = false) {
  const token = await workerIdentity(ctx, tokenId);
  const request = await ctx.db.get(requestId);
  if (!request || (!allowDeleted && request.deletedAt !== undefined) || request.assignedTokenId !== tokenId || request.unitId !== token.unitId) {
    throw new Error("This request is not assigned to this worker.");
  }
  if (!token.specSlugs?.includes(request.specSlug)) throw new Error("Worker token does not allow this spec");
  return request;
}

export const bootstrap = internalQuery({ args: { tokenId: v.id("unitTokens"), specSlug: v.optional(v.string()) }, returns: v.boolean(), handler: async (ctx, args) => {
  const token = await workerIdentity(ctx, args.tokenId);
  if (args.specSlug && !token.specSlugs?.includes(args.specSlug)) throw new Error("Worker token does not allow this spec");
  return true;
} });
