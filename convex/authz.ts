import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import { env as deploymentEnv, type QueryCtx, type MutationCtx } from "./_generated/server";

// Custom deployment variables are optional; missing configuration denies access.
const env = deploymentEnv as unknown as Record<string, string | undefined>;

type AuthContext = Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">;

type AccessConfig = {
  issuer?: string;
  userIds?: string;
  emails?: string;
};

function entries(value: string | undefined): string[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error("Whitelist must be a JSON array of non-empty strings");
  }
  return parsed.map(item => item.trim());
}

// Only consume identities already verified by Convex, never caller-supplied claims.
export function accessDecision(identity: UserIdentity | null, config: AccessConfig) {
  if (!identity) return "unauthenticated" as const;
  try {
    if (!config.issuer || identity.issuer !== config.issuer || !identity.subject) {
      return "denied" as const;
    }
    const ids = entries(config.userIds);
    const emails = entries(config.emails).map(email => email.toLowerCase());
    if (ids.includes(identity.subject)) return "allowed" as const;
    if (identity.emailVerified === true && typeof identity.email === "string" &&
        emails.includes(identity.email.trim().toLowerCase())) return "allowed" as const;
    return "denied" as const;
  } catch {
    return "denied" as const;
  }
}

export async function getAccess(ctx: AuthContext) {
  const identity = await ctx.auth.getUserIdentity();
  return {
    identity,
    status: accessDecision(identity, {
      issuer: env.CLERK_JWT_ISSUER_DOMAIN,
      userIds: env.AUTH_ALLOWED_USER_IDS,
      emails: env.AUTH_ALLOWED_EMAILS,
    }),
  };
}

export async function requireAuthenticated(ctx: AuthContext) {
  const { identity, status } = await getAccess(ctx);
  if (status === "unauthenticated") {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to use MasterFlow." });
  }
  if (status !== "allowed" || !identity) {
    throw new ConvexError({ code: "ACCESS_DENIED", message: "This account is not allowed on this server." });
  }
  return identity.subject;
}

export async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const userId = await requireAuthenticated(ctx);
  const settings = await ctx.db.query("storageSettings").first();
  if (!settings || settings.ownerId !== userId) throw new ConvexError("Only the application owner can do this.");
  return userId;
}
