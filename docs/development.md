# Development and desktop app

## Requirements

- Bun 1.4.3 or later.
- Rust toolchain and platform dependencies required by Tauri v2 for a native build.
- Convex CLI/backend for persistent data and worker HTTP hooks.

## Environment

For desktop use, add one or more Convex server profiles from the app's first-launch screen, the dedicated server dialog on the sign-in screen, or **Settings → Manage servers**. Each profile has a client/API URL and an HTTP site URL. The native app stores these non-secret values in the Tauri app config directory. Signing out of an account preserves the selected server; **Disconnect** clears the current selection without removing saved profiles. The browser development preview stores profiles in browser local storage.

Open **Settings** in the sidebar to manage saved Convex servers, Unit tokens, sign out, or switch between light and dark appearance. Server profiles are managed inline in Settings; the sign-in screen uses a separate server-selection dialog. Disconnecting keeps the workspace and Settings visible, clears only the active connection, and leaves saved profiles available to connect again. The selected server name and connection state appear in a badge beside the sidebar logo. The appearance preference is persisted alongside the local connection settings (Tauri app config on desktop, browser local storage in preview).

Convex Auth is enabled separately on every Convex deployment. Configure `JWT_PRIVATE_KEY` and `JWKS` on each deployment using securely generated RS256 keys; never commit these values or put them in the desktop app. The deployment's `CONVEX_SITE_URL` is used as the JWT issuer. After syncing the Convex code, the first account can register with email and password; each deployment rejects registration once an account exists. The backend enforces the limit in the user-creation mutation, including concurrent registration attempts. There is no password-reset flow yet, so protect the single account's credentials and plan an administrator recovery procedure.

The app remembers account email addresses per server profile in the app settings, allowing users to select a previous account after signing out or when a session expires. These email addresses are local profile metadata; passwords are never stored. Convex Auth persists session tokens using its client storage scoped to the deployment URL; signing out clears the active auth session without disconnecting the saved server.

Existing local setups can optionally bootstrap the first profile from `.env.local`:

```dotenv
VITE_CONVEX_URL=<optional initial Convex client/API URL>
VITE_CONVEX_SITE_URL=<optional initial Convex HTTP site URL>
CONVEX_SELF_HOSTED_URL=<self-hosted Convex API URL used by the CLI>
CONVEX_SELF_HOSTED_ADMIN_KEY=<self-hosted Convex CLI admin key>
```

For the standard self-hosted Docker setup, the backend API/client URL is `http://127.0.0.1:3210`, while the HTTP actions/site URL is `http://127.0.0.1:3211`. Do not point `VITE_CONVEX_SITE_URL` at port 3210. The CLI uses `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` to connect to the self-hosted instance.

Keep `.env.local` out of source control. `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` are for the Convex CLI only; MasterFlow does not ask for or store an admin key. App queries and mutations require an authenticated Convex Auth session. Worker HTTP hooks remain separately protected by worker bearer tokens; the authenticated desktop manages token metadata through the Convex client API. The UI generates a random bearer token in the browser, stores only its SHA-256 hash in Convex, and shows the plaintext once. Store each plaintext token in the corresponding worker's secret configuration.

## Run locally

```sh
bun install
bunx --bun convex dev --once --typecheck enable --tail-logs disable
bun run dev
```

`convex dev` must target the same self-hosted deployment as the desktop app. Confirm its printed deployment URL before syncing functions. For a one-time sync, use `--once`; omit it to watch and sync code changes while developing.

Vite uses port `1420` for Tauri development (`strictPort: true`). For a browser-only preview, use another port if `1420` is busy:

```sh
bunx --bun vite --configLoader runner --host 127.0.0.1 --port 4174
```

Start the native desktop shell with:

```sh
bun run tauri -- dev
```

Tauri's `beforeDevCommand` starts Vite on the expected port. Tauri may need operating-system build libraries that are not needed for a frontend-only preview.
The desktop uses Tauri's notification plugin for system notifications. Grant permission from the Notifications page; new updates then use in-app toasts while the window is focused and system notifications while it is not.

## Build and typecheck

```sh
bunx --bun tsc --noEmit
bunx --bun vite build --configLoader runner
```

`--configLoader runner` avoids writing Vite's temporary bundled config under `node_modules/.vite-temp`, useful in restricted/read-only environments. In a normal writable checkout, `bun run build` runs TypeScript and Vite build together.

## Sync/test Convex functions

For the configured self-hosted deployment:

```sh
bunx --bun convex dev --once --typecheck enable --tail-logs disable
bunx --bun convex run specs:list '{}' --push
```

Check that the CLI reports the expected self-hosted URL before syncing or running functions. Do not migrate or delete real specs to smoke-test a function; use a disposable spec and clean it up.

## Useful commands

```sh
bunx --bun tsc --noEmit
bunx --bun vite build --configLoader runner
bunx --bun convex env list --names-only
bunx --bun convex run specs:list '{}' --push
bunx --bun convex run requests:list '{"specSlug":"song-with-cover"}' --push
```

## Troubleshooting

- **UI says connecting to Convex:** open **Settings → Manage servers**, verify the selected profile's client/API URL, and ensure the backend is running and reachable from the desktop webview.
- **Unit token manager cannot load tokens:** check that the desktop is connected to the expected Convex deployment and that the `unitTokens.list` query is available in the synced functions.
- **Authentication fails:** confirm Convex Auth has been synced to that server, `JWT_PRIVATE_KEY` and `JWKS` are configured there, and use the exact email/password for the single account on that deployment. A deployment with an existing user cannot register another account.
- **Worker hook returns `401`:** verify the worker bearer token is active, unexpired, and sent as a bearer token in the `Authorization` header.
- **Claim returns `[]`:** verify the request is `waiting` and the spec slug matches.
- **Build cannot write `.vite-temp`:** use `bunx --bun vite build --configLoader runner` or a writable checkout.


## File storage operations

Request artifact metadata and upload receipts are additive schema changes; existing requests can omit `artifacts`. Sync the backend before running an updated desktop or Mu artifact spec. Native upload/download URLs use the backend's configured API origin, not necessarily the HTTP site origin: remote workers must reach both. Preserve file-storage volumes/buckets together with database backups. The default Docker volume is `/convex/data`; use the actual deployment storage configuration when designing backups. Unfinished native uploads are not garbage-collected by this application. See [Request artifacts](request-artifacts.md) for retention and bearer URL behavior.

### Spec format validation checks

`src/specModel.ts` is the shared structural validator used by spec upload/save
and YAML diagnostics; changes to Mu's action schema must update it together with
graph workload labels and editor help. Node `run` is an action list, and
`execute_workload` is allowed only in `before_run`, `run` and `after_run`.
The validator does not execute commands, resolve templates, contact artifact
storage, or reserve GPUs. Unknown unrelated YAML fields remain preserved.

Run focused regressions with:

```sh
node --test tests/spec-model.test.cjs tests/yaml-diagnostics.test.cjs
bunx --bun tsc --noEmit
bunx --bun vite build --configLoader runner
```

When both repositories are checked out, also parse Mu's current
`examples/song-with-cover/spec.yaml` and `examples/master-flow-artifacts/spec.yaml`
through `specIssues` as compatibility checks. Do not execute those examples to
validate the editor: media execution may download models/use GPUs, and artifact
execution writes to a server. This frontend-only validation change needs no
Convex schema migration or deployment.
