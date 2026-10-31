# MU MasterFlow

**A desktop control center for MU pipelines and workers.**

MasterFlow is the management side of [MU](https://github.com/khanhtranrk/mu). Create and edit pipeline specifications, submit requests, connect workers, and follow execution progress in one place. The actual workloads run through [MU CLI](https://github.com/khanhtranrk/mu-cli).

Built with **React, Vite, Tauri, and Convex**.

## What you can do

- Manage YAML pipeline specifications, view dependency graphs and inspect reusable routine action sequences.
- Create requests for different pipelines and inspect node-by-node progress.
- Monitor connected workers, execution states, and notifications.
- Upload and retrieve request artifacts through Convex File Storage.
- Connect the desktop to a Convex server and manage worker access tokens.

## Get started

**Requirements:** [Bun](https://bun.sh/), a configured Convex backend, and the prerequisites for Tauri if running the native desktop app.

```bash
git clone https://github.com/khanhtranrk/mu-masterflow.git
cd mu-masterflow
bun install
```

Configure and synchronize the Convex backend using the [development guide](docs/development.md), then start the frontend:

```bash
bun run dev
```

For the native desktop window:

```bash
bun run tauri -- dev
```

On first launch, configure a Convex server with its **client/API URL** and **HTTP site URL**. Authentication and worker tokens are managed separately. The [development guide](docs/development.md) covers self-hosted configuration, environment variables, and deployment details.

## Documentation

| Topic | Where to read |
| --- | --- |
| Architecture and data model | [Architecture](docs/architecture.md) |
| YAML specs, pipeline graph, editor behavior | [Spec YAML](docs/spec-yaml.md) |
| Worker HTTP endpoints and integration | [Worker hooks](docs/worker-hooks.md) |
| Artifact upload, download, and storage | [Request artifacts](docs/request-artifacts.md) |
| Local setup, Convex, and Tauri | [Development](docs/development.md) |
| Cross-project workspace | [MU workspace](https://github.com/khanhtranrk/mu) |

Detailed status enums, endpoint payloads, schema invariants, and compatibility rules belong in the linked technical docs.

## For coding agents and contributors

Read **[AGENTS.md](AGENTS.md)** first, then the comprehensive **[AGENT.md](AGENT.md)** guide. These explain the code map, product intent, data model invariants, API contracts, and safe development workflow. Consult the relevant technical documentation before modifying frontend or backend behavior.

For a focused frontend validation after setup:

```bash
bunx --bun tsc --noEmit
bun run build
```

Changes to worker APIs or shared YAML semantics may also require changes in MU CLI. Coordinate those in the [MU workspace](https://github.com/khanhtranrk/mu).

**MasterFlow manages the work. [MU CLI](https://github.com/khanhtranrk/mu-cli) executes it.**
