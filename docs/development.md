# Development and desktop app

## Requirements

- Bun 1.4.3 or later.
- Rust toolchain and platform dependencies required by Tauri v2 for a native build.
- Convex CLI/backend for persistent data and worker HTTP hooks.

## Environment

Create `.env.local` in the project root:

```dotenv
VITE_CONVEX_URL=<Convex client/API URL used by the app>
VITE_CONVEX_SITE_URL=<Convex HTTP site URL used by the UI and workers>
CONVEX_SELF_HOSTED_URL=<self-hosted Convex API URL used by the CLI>
CONVEX_SELF_HOSTED_ADMIN_KEY=<self-hosted Convex CLI admin key>
```

For the standard self-hosted Docker setup, the backend API/client URL is `http://127.0.0.1:3210`, while the HTTP actions/site URL is `http://127.0.0.1:3211`. Do not point `VITE_CONVEX_SITE_URL` at port 3210. The CLI uses `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` to connect to the self-hosted instance.

Keep `.env.local` out of source control. Set `AUTH_TOKENS_ADMIN_KEY` as an environment variable on the Convex deployment, not as a `VITE_*` variable. Generate a unique random value of at least 32 bytes and pipe it into the CLI to avoid putting the secret in shell history:

```sh
openssl rand -hex 32 | bunx --bun convex env set AUTH_TOKENS_ADMIN_KEY
bunx --bun convex env list --names-only
```

The second command verifies the variable name is configured without printing its value. To use the value in the desktop token manager, retrieve it directly in a trusted terminal with `bunx --bun convex env get AUTH_TOKENS_ADMIN_KEY`; do not paste it into source, `.env.local`, chat, logs, or screenshots. The UI keeps the key in memory only while the token manager is open. Create worker bearer tokens in that page and store them in the worker's secret configuration.

## Run locally

```sh
bun install
bunx --bun convex dev --once --typecheck enable --tail-logs disable
bun run dev
```

`convex dev` must target the same self-hosted deployment where `AUTH_TOKENS_ADMIN_KEY` was set. Confirm its printed deployment URL before syncing functions. For a one-time sync, use `--once`; omit it to watch and sync code changes while developing.

Vite uses port `1420` for Tauri development (`strictPort: true`). For a browser-only preview, use another port if `1420` is busy:

```sh
bunx --bun vite --configLoader runner --host 127.0.0.1 --port 4174
```

Start the native desktop shell with:

```sh
bun run tauri -- dev
```

Tauri's `beforeDevCommand` starts Vite on the expected port. Tauri may need operating-system build libraries that are not needed for a frontend-only preview.

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

- **UI says connecting to Convex:** check `VITE_CONVEX_URL` and ensure the self-hosted backend API is running and reachable from the desktop webview.
- **Token manager shows “Failed to fetch”:** check that `VITE_CONVEX_SITE_URL` points to the HTTP actions service (port `3211` in the standard Docker setup), that the UI origin can reach it, and that the deployment has been synced with the `/hooks/auth-tokens` OPTIONS routes.
- **Token manager shows “Unauthorized”:** verify the admin key was copied from the same deployment as the HTTP endpoint. An incorrect key returns `401`; a browser CORS/network problem typically reports “Failed to fetch”.
- **Token manager returns `503`:** set `AUTH_TOKENS_ADMIN_KEY` in the Convex deployment environment; the value must contain at least 32 bytes.
- **Worker hook returns `401`:** verify the worker bearer token is active, unexpired, and sent as a bearer token in the `Authorization` header.
- **Claim returns `[]`:** verify the request is `waiting` and the spec slug matches.
- **Build cannot write `.vite-temp`:** use `bunx --bun vite build --configLoader runner` or a writable checkout.
