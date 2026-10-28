# MasterFlow agent guide

Read this file before changing the app. It is the durable handoff for agents continuing work in this repository. `AGENTS.md` points here so both common agent instruction conventions and the requested `AGENT.md` entry point work.

## Product intent

MasterFlow is the desktop control surface for Mu workers. A user creates or uploads a complete `spec.yaml`; that spec becomes a space. Within a space, the user edits any supported spec sections, defines one or more pipelines as dependency graphs, and creates requests for a chosen pipeline. Workers communicate through authenticated Convex HTTP hooks. MasterFlow shows worker and request state reactively.

Keep the app calm and focused: persistent left sidebar for spaces, selected space content on the right, simple light/dark appearance, and visible request execution graph. Do not bring back a complex dashboard or a wizard-heavy workflow without a direct request.

## Read these docs for detail

- [Architecture and data model](docs/architecture.md)
- [Spec YAML and graph model](docs/spec-yaml.md)
- [Worker hooks and payloads](docs/worker-hooks.md)
- [Development and Tauri](docs/development.md)

## Code map

- `src/App.tsx`: main UI, YAML editing, spec CRUD actions, request list and request execution graph.
- `src/App.css`, `src/graph.css`, `src/space-actions.css`: UI styles and graph/action-menu presentation.
- `src/main.tsx`: React root and Convex client provider.
- `convex/schema.ts`: Convex tables and indexes.
- `convex/specs.ts`: spec/space queries and mutations, YAML retrieval, legacy execution-contract migration.
- `convex/requests.ts`: request creation/list/update and request/node status validators.
- `convex/units.ts`: unit heartbeat and atomic request claiming.
- `convex/http.ts`: bearer-authenticated worker HTTP endpoints.
- `src-tauri/`: Tauri v2 desktop wrapper and window config.
- `README.md`: repository entry point.

## Data model and invariants

1. **The complete YAML is authoritative.** Store it as `specs.yaml`. Do not recreate parallel `params` or `nodes` fields on `specs`; the YAML can contain arbitrary sections and node configuration.
2. **A spec is a space.** Its stable `slug` is used by requests and workers. A display rename changes `name` only and must keep `slug` stable.
3. **A request belongs to one spec and one pipeline.** Store each request as a separate `requests` document with `specSlug`, `pipelineName`, user `params`, execution `status`, and worker `plan`.
4. **A pipeline is a DAG.** `depends_on` determines edges. Do not flatten pipeline execution into a single ordered step list. Unknown YAML fields and node configuration must survive UI edits.
5. **The worker plan is runtime state, not the spec graph.** `plan` reports each node's current state and optional device; the UI overlays those states on the graph defined by the spec.
6. **Claiming must stay atomic.** `units.claim` selects requests through `by_spec_slug_and_status` and changes `waiting` to `possessed` in the same Convex mutation.
7. **Preserve worker authorization.** A unit must have heartbeat-registered the requested `specSlug` before claiming from it. Heartbeat accepts optional `specSlugs`, but an omitted list means that unit cannot claim any spec.
8. **Deletion owns its dependent records.** Deleting a spec removes its matching space records and request records and clears deleted active request IDs from units. The UI confirms first. The current delete mutation caps a single space at 500 requests and returns an error above that limit.
9. **Use Convex indexes.** Do not scan whole tables with `.collect()` or filter database queries in memory. Add/adjust indexes when adding lookup paths.
10. **Avoid hard-coded assumptions about pipeline names or workload types.** Specs can define arbitrary pipelines and workloads.

## Current API/status contract

- Request statuses: `waiting`, `possessed`, `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`.
- Node plan statuses: `queue`, `running`, `failed`, `succeeded`.
- Claim persists `possessed` but returns `status: "received"` for compatibility with the worker response example.
- Worker update may merge additional runtime/technical information under `technical`; keep extensibility there instead of adding rigid one-off fields.
- Hook routes and exact JSON contracts are in [docs/worker-hooks.md](docs/worker-hooks.md).

## Compatibility note

`requests.nodeStates` and several old unit fields are still optional in `convex/schema.ts` for older data. New execution state must use `requests.plan` and the new unit fields. `specs.migrateExecutionContract` is a one-time backfill; do not remove the legacy schema fields or run a destructive migration until current Convex data has been inspected and the backfill is confirmed complete.

## Working safely

- Before editing any file in `convex/`, consult the Convex skill and preserve the object-form function syntax, argument validators, return validators, index use, and internal/public boundaries.
- Keep UI state changes and mutations reactive through `useQuery`/`useMutation`; do not copy server state into a disconnected local store.
- Do not expose the worker bearer token in frontend code, logs, docs, or committed env files.
- Do not delete or rename a user space as part of a test. Use a disposable spec and clean it up.
- If changing request status shapes or stored fields, update validators, migration/backfill logic, HTTP validation, frontend status labels, and docs together.
- Run `npx tsc --noEmit` and `npx vite build --configLoader runner` after relevant changes. If Convex is available, use `npx convex run <module:function> '<json args>' --push` to sync and verify development functions. Do not claim a Convex deployment test if the backend was unavailable.

## Local environment

`.env.local` is local configuration and must not be committed. The current project uses a local anonymous Convex development deployment. `VITE_CONVEX_URL` connects the desktop UI; `VITE_CONVEX_SITE_URL` is the HTTP site origin for worker hooks. See [docs/development.md](docs/development.md).
