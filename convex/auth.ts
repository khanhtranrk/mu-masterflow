import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        if (typeof params.email !== "string" || !params.email.trim()) {
          throw new Error("A valid email is required.");
        }
        return { email: params.email.trim().toLowerCase() };
      },
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      if (existingUserId) return existingUserId;

      const existingUser = await ctx.db.query("users").first();
      if (existingUser) {
        throw new Error("This Convex server already has its single account. Sign in with that account.");
      }

      return ctx.db.insert("users", {
        ...(typeof profile.email === "string" ? { email: profile.email } : {}),
        ...(typeof profile.name === "string" ? { name: profile.name } : {}),
      });
    },
  },
});

export const registrationAvailable = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await ctx.db.query("users").first()) === null,
});
