# MasterFlow

MasterFlow is a small desktop app for authoring and managing `spec.yaml` files, their pipeline dependency graphs, and requests created for those pipelines. It uses React, Vite, Tauri, and Convex.

Worker notifications are delivered in real time to the Notifications page. When the app is focused, new notifications appear in an in-app toast; when it is not focused, Tauri can show a system notification after notification permission is granted.

The desktop supports email/password sign-in and registration of the first account on the selected Convex server. Each deployment permits only one account; this is enforced by the backend, not just the UI. Public app queries and mutations reject unauthenticated calls. Remembered account emails are stored with their server profile on this device; passwords are never saved. The single account has access to all app data.

The sidebar shows the selected server name in a connection-status badge. **Settings** groups server management, Unit token management, account sign-out, and light/dark appearance. Disconnecting returns to Settings with the saved server profiles still available; it does not delete a profile or its remembered email. The selected appearance is persisted with the app's local connection settings.

## Start here

- [Agent guide](AGENT.md): product intent, code map, invariants, and safe workflow for continuing development.
- [Architecture and data model](docs/architecture.md)
- [Spec YAML and pipeline graph](docs/spec-yaml.md)
- [Worker HTTP hooks](docs/worker-hooks.md)
- [Development and desktop app](docs/development.md)

## Quick start

Install dependencies with `bun install`. On first launch, add a Convex server using its client/API URL and HTTP site URL. Server profiles are saved in the Tauri app config directory and can be managed in **Settings**; the sign-in screen has a dedicated server-selection dialog. For the default self-hosted Docker setup the URLs are usually `http://127.0.0.1:3210` and `http://127.0.0.1:3211`. Optional `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` values in `.env.local` are imported as the initial server profile for existing development setups. Configure Convex Auth on each deployment and register its first account before signing in; later registrations are rejected. Configure `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` only for the Convex CLI as described in [Development and desktop app](docs/development.md); the app does not request or store an admin key. Sync functions with `bunx --bun convex dev`, then start the frontend with `bun run dev`. The native Tauri window is started with `bun run tauri -- dev`.

Build the frontend with `bunx --bun vite build --configLoader runner` when the environment cannot write Vite's temporary config bundle under `node_modules/.vite-temp`; the usual `bun run build` is also available in a normal writable checkout.

## Core design

A spec is stored as one complete YAML string in Convex; there is no separate spaces table. Each request is a separate Convex document keyed by `specSlug` and associated with a `pipelineName`. Request input is stored as `payload`; per-node runtime status, device, artifacts, and logs are stored in `nodeStates`. The pipeline graph is derived from `depends_on` in the YAML. It is not a linear list of sequential steps.

Worker hooks are documented in [docs/worker-hooks.md](docs/worker-hooks.md). Units (Workers) use Unit tokens managed from **Settings → Unit tokens** through regular Convex queries and mutations. The token manager stores only token hashes; the generated plaintext is shown once when a token is created. Anyone who can sign in to the Convex deployment can manage these tokens.

The worker hook `POST /api/notifications/send` can create a notification for the desktop. See [Worker HTTP hooks](docs/worker-hooks.md) for its request and response contract.
