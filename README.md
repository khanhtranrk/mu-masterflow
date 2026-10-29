# MasterFlow

MasterFlow is a small desktop app for authoring and managing `spec.yaml` files, their pipeline dependency graphs, and requests created for those pipelines. It uses React, Vite, Tauri, and Convex.

## Start here

- [Agent guide](AGENT.md): product intent, code map, invariants, and safe workflow for continuing development.
- [Architecture and data model](docs/architecture.md)
- [Spec YAML and pipeline graph](docs/spec-yaml.md)
- [Worker HTTP hooks](docs/worker-hooks.md)
- [Development and desktop app](docs/development.md)

## Quick start

Install dependencies with `bun install`. Configure the Convex development URL in `.env.local` (`VITE_CONVEX_URL`; optional `VITE_CONVEX_SITE_URL` is used by workers). Start the Convex development backend with `bunx --bun convex dev`, then start the frontend with `bun run dev`. The native Tauri window is started with `bun run tauri -- dev`.

Build the frontend with `bunx --bun vite build --configLoader runner` when the environment cannot write Vite's temporary config bundle under `node_modules/.vite-temp`; the usual `bun run build` is also available in a normal writable checkout.

## Core design

A spec is stored as one complete YAML string in Convex. Each spec maps to a space; each request is a separate Convex document keyed by `specSlug` and associated with a `pipelineName`. The pipeline graph is derived from `depends_on` in the YAML. It is not a linear list of sequential steps.

Worker hooks are documented in [docs/worker-hooks.md](docs/worker-hooks.md). They require `Authorization: Bearer <MASTERFLOW_HOOK_TOKEN>`.
