# MasterFlow

MasterFlow is a small desktop app for authoring and managing `spec.yaml` files, their pipeline dependency graphs, and requests created for those pipelines. It uses React, Vite, Tauri, and Convex.

## Start here

- [Agent guide](AGENT.md): product intent, code map, invariants, and safe workflow for continuing development.
- [Architecture and data model](docs/architecture.md)
- [Spec YAML and pipeline graph](docs/spec-yaml.md)
- [Worker HTTP hooks](docs/worker-hooks.md)
- [Development and desktop app](docs/development.md)

## Quick start

Install dependencies with `bun install`. Configure `.env.local` with `VITE_CONVEX_URL` (Convex client/API URL) and `VITE_CONVEX_SITE_URL` (HTTP actions URL). For the default self-hosted Docker setup these are usually `http://127.0.0.1:3210` and `http://127.0.0.1:3211`. Configure `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` for the Convex CLI as described in [Development and desktop app](docs/development.md). Sync functions with `bunx --bun convex dev`, then start the frontend with `bun run dev`. The native Tauri window is started with `bun run tauri -- dev`.

Build the frontend with `bunx --bun vite build --configLoader runner` when the environment cannot write Vite's temporary config bundle under `node_modules/.vite-temp`; the usual `bun run build` is also available in a normal writable checkout.

## Core design

A spec is stored as one complete YAML string in Convex; there is no separate spaces table. Each request is a separate Convex document keyed by `specSlug` and associated with a `pipelineName`. Request input is stored as `payload`; per-node runtime status, device, artifacts, and logs are stored in `nodeStates`. The pipeline graph is derived from `depends_on` in the YAML. It is not a linear list of sequential steps.

Worker hooks are documented in [docs/worker-hooks.md](docs/worker-hooks.md). Workers use auth tokens managed from the sidebar through regular Convex queries and mutations. The token manager stores only token hashes; the generated plaintext is shown once when a token is created. Anyone who can access the Convex deployment can manage these tokens.
