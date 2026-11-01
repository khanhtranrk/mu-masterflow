import type { AuthConfig } from "convex/server";
import { env as deploymentEnv } from "./_generated/server";

const env = deploymentEnv as unknown as Record<string, string | undefined>;

export default {
  providers: env.CLERK_JWT_ISSUER_DOMAIN ? [{
    domain: env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  }] : [],
} satisfies AuthConfig;
