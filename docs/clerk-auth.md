# Clerk authentication and migration

## Trust and access policy

Clerk authenticates people. Convex verifies the JWT signature, expiry, issuer and audience using its built-in auth provider. Public application functions call `requireAuthenticated` before accessing data. The guard consumes only `ctx.auth.getUserIdentity()` and allows an exact Clerk subject match OR an exact verified primary-email match. It also checks the configured issuer. Email matching trims and lowercases; User IDs are case-sensitive. Missing identity, missing issuer, empty policy or malformed JSON policy deny access. No wildcard/domain rules, client-provided identity, metadata-based permissions or first-account registration exist.

Allowed users share all existing application data. Whitelisting adds no roles or ownership model. A User ID match does not require an email. An email match requires `emailVerified === true`; missing or string-valued verification is refused. Only the primary email in the signed claim is considered. Changing/removing a whitelist entry takes effect on subsequent backend evaluations; email changes become visible when Clerk refreshes the token. Clerk logout/revocation does not invalidate a previously issued JWT earlier than its validity permits.

Worker tokens, hashes, expiry/revocation checks, HTTP payloads, atomic request claiming and worker permissions are unchanged. Desktop worker-token management still requires whitelist access. Existing direct storage URLs remain bearer links; see [artifact security](request-artifacts.md).

## Configure Clerk

Use one Clerk application for this frontend and all its server profiles. Configure email sign-in (email codes are recommended initially). Enable the Convex integration with audience `convex`. Add these signed claims to the token used by Convex:

```json
{
  "aud": "convex",
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.email_verified}}"
}
```

Use either the native Convex integration/session-token customization, or a JWT template named `convex`. The installed Convex provider selects the session token when it has audience `convex`, otherwise it requests the `convex` template. Configure email claims on whichever token path is used; a template alone does not modify native session claims. Never derive verification from user-editable metadata. Inspect a real signed-in token to verify the primary email and boolean verification claim before allowing email-based access. No Clerk secret key or user-sync webhook is needed.

Official references: [Convex + Clerk](https://docs.convex.dev/auth/clerk), [Clerk JWT templates](https://clerk.com/docs/guides/sessions/jwt-templates).

## Configure the app and each backend

Frontend `.env.local` (public key only):

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_<your_key>
```

Restart Vite or rebuild the desktop after changing the key. Each backend deployment needs these environment variables, separate from frontend build variables:

```dotenv
CLERK_JWT_ISSUER_DOMAIN=https://<your-instance>.clerk.accounts.dev
AUTH_ALLOWED_USER_IDS=["user_<allowed_id>"]
AUTH_ALLOWED_EMAILS=["allowed@example.com"]
```

Use the issuer origin, not the `/.well-known/jwks.json` URL. Either list may be omitted or `[]`; at least one must match. Malformed lists refuse access even if the other list would match. Only administrators with deployment configuration access can edit these lists. Do not put the whitelist or a Clerk secret key in `VITE_*` variables. Production and development Clerk instances have different IDs, keys and issuers; configure deliberately.

The backend auth config has no providers when the issuer is missing, so it fails closed instead of accepting old Convex Auth sessions. Configure the issuer and an initial allowed user before syncing this migration to a deployment in use.

## Verification and cleanup

1. Preserve a database backup and the previous backend/frontend revision. Finish desktop uploads before cutover. Existing data and worker tokens need no migration.
2. Configure Clerk and backend policy on a confirmed development deployment; sync backend and run the updated frontend together. Older desktop builds use removed auth endpoints and need updating.
3. Verify an allowed ID, a verified allowed email, an unverified email, an account outside both lists, and empty/malformed policy. Direct backend calls must enforce the same rules as the UI. Check expired, wrong-issuer and wrong-audience JWTs against the actual deployment, not mocked identities.
4. Verify sign-out, token refresh, switching server profiles (including a server denying the same account), restart/session persistence, and backend reconnection. Backend access status gates rendering of business data.
5. Verify worker authentication, notifications, request create/claim/report and artifact roundtrip with an existing worker token. Desktop upload receipts use Clerk subject for ownership: receipts started with old Convex user IDs cannot be completed by the new identity and must be restarted; completed files stay available.
6. Test both browser and a packaged Tauri app. SignIn uses hash routing for the desktop shell. Production webview origin/session behavior is a separate release gate; a working Vite login is not evidence of a working packaged app. Configure supported origins for the actual deployment and verify the chosen sign-in method before enabling social redirects. Clerk points Tauri users to a community integration; do not assume React webview behavior alone covers every native platform.
7. After confirming real Clerk/Convex access, remove the old auth runtime, `authTables` declarations and `@convex-dev/auth` dependency (completed on the development deployment). The development cleanup subsequently deleted the old auth tables and unused auth deployment variables at the user’s request. Removing schema declarations is not a data-erasure procedure. Packaged Tauri testing remains a separate desktop release gate.

Rollback: the old auth tables, account records and signing variables have been permanently removed from development. Restoring code alone cannot restore old accounts or sessions. Prefer fixing Clerk configuration; returning to Convex Auth requires new signing keys and account setup (or a separately available backup). Do not roll back business-data writes or worker-token changes. Passwords were not migrated into Clerk.

## Local checks

```sh
bunx --bun tsc --noEmit
bunx --bun tsc --noEmit -p convex/tsconfig.json
bunx --bun vite build --configLoader runner
node --test tests/authz.test.cjs tests/authenticated-root.test.cjs tests/worker-api.test.cjs
```

These checks verify policy logic, UI gating and worker regressions. They do not prove JWT cryptography, Clerk configuration, live deployment behavior or packaged Tauri authentication.

## Development verification (2026-11-01)

The configured self-hosted development backend accepted Clerk login after the Convex integration was enabled in Clerk. The user confirmed that specs appeared. Backend logs independently showed successful `auth:access`, `specs:list`, `requests:list`, `notifications:list`, `unitTokens:list`, `units:list` and `requests:listActive` executions from the running frontend.

Deployed policy probes via CLI-injected identities allowed the whitelisted ID and verified email; rejected unverified email, an unknown subject and a wrong issuer; and rejected a direct business query for a non-whitelisted caller. These policy probes bypass JWT verification and are not cryptographic tests. Unauthenticated business access was refused, `/api/health` returned 200 and a worker endpoint without its token returned 401. Automated worker regression tests cover valid worker tokens and artifact behavior.

Packaged Tauri sign-in, real expired/wrong-audience JWTs, and a full manual multi-account/sign-out/server-switch exercise have not been verified. Email-only access was tested with injected identities; verify the configured Clerk email claims with a real email-only account before relying on that path operationally. The current user's ID match works independently of email claims.

## Removal of development auth residue (2026-11-01)

Deleted obsolete tables: `users`, `authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits`.

Removed deployment variables: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `AUTH_TOKENS_ADMIN_KEY`. The last variable belonged to the retired HTTP token-administration API, not worker bearer authentication. Clerk issuer and whitelist variables remain. Convex platform origins, CLI admin credentials and frontend endpoint/key configuration remain necessary.

The backend was found serving older Convex Auth modules despite the current checkout using Clerk. The current Clerk implementation was synchronized before deleting tables, because the old deployed schema prevented their removal. Application tables, worker tokens and file-storage metadata were compared before/after the deletion.
