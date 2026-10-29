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

Keep `.env.local` out of source control. Auth tokens are managed through regular Convex client queries and mutations; no additional admin key or token-management HTTP configuration is required. The UI generates a random bearer token in the browser, stores only its SHA-256 hash in Convex, and shows the plaintext once. Anyone with access to the Convex deployment can create, edit, list, or revoke worker tokens. Store each plaintext token in the corresponding worker's secret configuration.

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

- **UI says connecting to Convex:** check `VITE_CONVEX_URL` and ensure the self-hosted backend API is running and reachable from the desktop webview.
- **Auth token manager cannot load tokens:** check that the desktop is connected to the expected Convex deployment and that the `authTokens.list` query is available in the synced functions.
- **Worker hook returns `401`:** verify the worker bearer token is active, unexpired, and sent as a bearer token in the `Authorization` header.
- **Claim returns `[]`:** verify the request is `waiting` and the spec slug matches.
- **Build cannot write `.vite-temp`:** use `bunx --bun vite build --configLoader runner` or a writable checkout.
