import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function requireAuthenticated(
  ctx: Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">,
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthenticated: sign in to use MasterFlow.");
  }
  return userId;
}
