# MasterFlow agent guide

Read this file before changing the app. It is the durable handoff for agents continuing work in this repository. `AGENTS.md` points here so both common agent instruction conventions and the requested `AGENT.md` entry point work.

## Product intent

MasterFlow is the desktop control surface for Mu workers. A user creates or uploads a complete `spec.yaml` as a spec, edits supported sections, defines one or more pipelines as dependency graphs, and creates requests for a chosen pipeline. Workers communicate through authenticated Convex HTTP hooks. MasterFlow shows worker and per-node request state reactively.

Keep the app calm and focused: persistent left sidebar for specs, selected spec content on the right, simple light/dark appearance, and visible request execution graph. Do not bring back a complex dashboard or a wizard-heavy workflow without a direct request.

## Read these docs for detail

- [Architecture and data model](docs/architecture.md)
- [Spec YAML and graph model](docs/spec-yaml.md)
- [Worker hooks and payloads](docs/worker-hooks.md)
- [Development and Tauri](docs/development.md)

## Code map

- `src/App.tsx`: Convex queries/mutations, page state, and composition of the spec workspace.
- `src/components/`: spec sidebar/workspace sections, graph, YAML editors, request views, auth-token manager, and dialogs.
- `src/specUtils.ts`, `src/types.ts`: shared YAML/graph helpers and frontend data types.
- `src/App.css`, `src/graph.css`, `src/space-actions.css`, `src/request-details.css`, `src/auth-tokens.css`: UI styles.
- `src/main.tsx`: React root and Convex client provider.
- `convex/schema.ts`: Convex tables and indexes.
- `convex/specs.ts`: spec queries and mutations, YAML retrieval, archive handling.
- `convex/requests.ts`: request creation/list/update and request/node status validators.
- `convex/units.ts`: unit heartbeat and atomic request claiming.
- `convex/http.ts`: bearer-authenticated worker HTTP endpoints.
- `convex/authTokens.ts`: internal auth-token lookup, creation, updates, revocation, and last-used tracking.
- `src-tauri/`: Tauri v2 desktop wrapper and window config.
- `README.md`: repository entry point.

## Data model and invariants

1. **The complete YAML is authoritative.** Store it as `specs.yaml`. Do not recreate parallel `params` or `nodes` fields on `specs`; the YAML can contain arbitrary sections and node configuration.
2. **Specs are the only configuration records.** There is no `spaces` table. Their stable `slug` is used by requests and workers; rename changes `name` only.
3. **A request belongs to one spec and one pipeline.** Store each request as a separate `requests` document with `specSlug`, `pipelineName`, `payload`, execution `status`, optional `unitId`, and per-node `nodeStates`.
4. **A pipeline is a DAG.** `depends_on` determines edges. Do not flatten pipeline execution into a single ordered step list. Unknown YAML fields and node configuration must survive UI edits.
5. **Node states are runtime data, not the spec graph.** `nodeStates` is keyed by node name and may contain `status`, `device`, `artifacts`, and `logs`; the UI overlays those states on the YAML pipeline graph.
6. **Claiming must stay atomic.** `units.claim` selects requests through `by_spec_slug_and_status` and changes `waiting` to `possessed` in the same Convex mutation.
7. **Worker authorization uses auth tokens.** Worker HTTP hooks validate the bearer token against the token hash in `authTokens`. The desktop manages token metadata through public Convex queries/mutations; token plaintext is generated in the browser and shown only once.
8. **Archiving a spec retains its dependent requests.** `specs.remove` sets `deletedAt`; the UI confirms before archiving.
9. **Use Convex indexes.** Do not scan whole tables with `.collect()` or filter database queries in memory. Add/adjust indexes when adding lookup paths.
10. **Avoid hard-coded assumptions about pipeline names or workload types.** Specs can define arbitrary pipelines and workloads.

## Current API/status contract

- Request statuses: `waiting`, `possessed`, `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`.
- Node-state statuses: `queue`, `running`, `failed`, `succeeded`.
- Request creation accepts `specSlug`, `pipelineName`, and `payload`.
- Worker reports use `POST /hooks/requests/report` with the `node_states` HTTP property, which is stored as `requests.nodeStates`.
- Worker hooks use the Convex HTTP site URL, not the Convex client URL. For the default self-hosted Docker setup these are ports `3211` (HTTP site) and `3210` (Convex API).
- Auth-token management uses the Convex client API. Worker HTTP hooks remain under `/hooks/` and use bearer tokens.
- Hook routes and exact JSON contracts are in [docs/worker-hooks.md](docs/worker-hooks.md).

## Compatibility note

Request node states include optional `device`, `artifacts`, and `logs` per node. Unit documents currently store `unitId`, `unitType`, `status`, `workingDir`, `devices`, and `lastSeen`.

## Working safely

- Before editing any file in `convex/`, consult the Convex skill and preserve the object-form function syntax, argument validators, return validators, index use, and internal/public boundaries.
- Keep UI state changes and mutations reactive through `useQuery`/`useMutation`; do not copy server state into a disconnected local store.
- Do not expose worker or admin bearer secrets in source code, logs, screenshots, docs, or committed env files. The docs may describe the authorization header using placeholders only.
- Do not delete or rename a user spec as part of a test. Use a disposable spec and clean it up.
- If changing request status shapes or stored fields, update schema and function validators, HTTP validation, frontend status labels, and docs together.
- Run `bunx --bun tsc --noEmit` and `bunx --bun vite build --configLoader runner` after relevant changes. If Convex is available, use `bunx --bun convex run <module:function> '<json args>' --push` to sync and verify development functions. Do not claim a Convex deployment test if the backend was unavailable.

## Local environment

`.env.local` is local configuration and must not be committed. This checkout is configured for a self-hosted Convex deployment. `VITE_CONVEX_URL` is the client/API origin; `VITE_CONVEX_SITE_URL` is the HTTP actions origin for worker hooks. See [docs/development.md](docs/development.md).
