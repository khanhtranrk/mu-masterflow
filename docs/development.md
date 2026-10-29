# Development and desktop app

## Requirements

- Bun 1.4.3 or later.
- Rust toolchain and platform dependencies required by Tauri v2 for a native build.
- Convex CLI/backend for persistent data and worker HTTP hooks.

## Environment

Create `.env.local` in the project root:

```dotenv
VITE_CONVEX_URL=<Convex deployment URL used by the app>
VITE_CONVEX_SITE_URL=<Convex HTTP site URL used by workers>
```

The UI defaults to `http://127.0.0.1:3210` if `VITE_CONVEX_URL` is absent. Keep secrets such as `MASTERFLOW_HOOK_TOKEN` in the Convex environment, never in Vite variables or committed files.

## Run locally

```sh
bun install
bunx --bun convex dev
bun run dev
```

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

For the configured development deployment:

```sh
bunx --bun convex dev
bunx --bun convex run specs:list '{}' --push
```

`convex run ... --push` syncs functions and runs the target. Check that the intended development deployment is configured first. Do not run migrations or delete real specs to smoke-test a function; use a disposable spec and clean it up.

## Useful commands

```sh
bunx --bun tsc --noEmit
bunx --bun vite build --configLoader runner
bunx --bun convex run specs:list '{}' --push
bunx --bun convex run requests:list '{"specSlug":"song-with-cover"}' --push
```

## Troubleshooting

- **UI says connecting to Convex:** check `VITE_CONVEX_URL` and ensure that backend is running/reachable from the desktop webview.
- **Worker hook returns 401:** verify `MASTERFLOW_HOOK_TOKEN` is configured in the same Convex deployment serving the routes and the request uses `Authorization: Bearer ...`.
- **Claim fails authorization:** register that slug in the unit heartbeat's `specSlugs` array.
- **Claim returns `[]`:** verify the request is `waiting`, the slug matches, and the unit is registered for it.
- **Build cannot write `.vite-temp`:** use `bunx --bun vite build --configLoader runner` or a writable checkout.
- **Migration questions:** `specs.migrateExecutionContract` is defined for legacy request/unit docs. Inspect deployed data before running it; do not assume it already ran.
