# Development and desktop app

## Requirements

- Node.js/npm compatible with pinned Vite and TypeScript versions.
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
npm install
npx convex dev
npm run dev
```

Vite uses port `1420` for Tauri development (`strictPort: true`). For a browser-only preview, use another port if `1420` is busy:

```sh
npx vite --configLoader runner --host 127.0.0.1 --port 4174
```

Start the native desktop shell with:

```sh
npm run tauri -- dev
```

Tauri's `beforeDevCommand` starts Vite on the expected port. Tauri may need operating-system build libraries that are not needed for a frontend-only preview.

## Build and typecheck

```sh
npx tsc --noEmit
npx vite build --configLoader runner
```

`--configLoader runner` avoids writing Vite's temporary bundled config under `node_modules/.vite-temp`, useful in restricted/read-only environments. In a normal writable checkout, `npm run build` runs TypeScript and Vite build together.

## Sync/test Convex functions

For the configured development deployment:

```sh
npx convex dev
npx convex run specs:list '{}' --push
```

`convex run ... --push` syncs functions and runs the target. Check that the intended development deployment is configured first. Do not run migrations or delete real specs to smoke-test a function; use a disposable spec and clean it up.

## Useful commands

```sh
npx tsc --noEmit
npx vite build --configLoader runner
npx convex run specs:list '{}' --push
npx convex run requests:list '{"specSlug":"song-with-cover"}' --push
```

## Troubleshooting

- **UI says connecting to Convex:** check `VITE_CONVEX_URL` and ensure that backend is running/reachable from the desktop webview.
- **Worker hook returns 401:** verify `MASTERFLOW_HOOK_TOKEN` is configured in the same Convex deployment serving the routes and the request uses `Authorization: Bearer ...`.
- **Claim fails authorization:** register that slug in the unit heartbeat's `specSlugs` array.
- **Claim returns `[]`:** verify the request is `waiting`, the slug matches, and the unit is registered for it.
- **Build cannot write `.vite-temp`:** use `npx vite build --configLoader runner` or a writable checkout.
- **Migration questions:** `specs.migrateExecutionContract` is defined for legacy request/unit docs. Inspect deployed data before running it; do not assume it already ran.
