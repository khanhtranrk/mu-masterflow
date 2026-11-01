import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAccess } from "./authz";

// Exposes only the current caller's decision, never the whitelist itself.
export const access = query({
  args: {},
  returns: v.union(v.literal("allowed"), v.literal("denied"), v.literal("unauthenticated")),
  handler: async (ctx) => (await getAccess(ctx)).status,
});
