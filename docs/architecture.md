# Architecture and data model

## Runtime

```text
Tauri desktop window
  └─ React + Vite UI (src/)
       └─ Convex React client
            ├─ public queries/mutations for specs and requests
            └─ reactive updates from worker HTTP hooks

Mu workers
  └─ Convex HTTP routes (convex/http.ts)
       └─ internal mutations/queries (units, requests, specs)
```

The app is a Tauri v2 desktop shell around a web frontend. Convex is the shared persistence and realtime layer. The desktop UI uses Convex queries and mutations; workers use HTTP hooks authenticated with a bearer token.

## Tables

### `specs`

One document per spec/space. Fields are `slug`, display `name`, `description`, raw `yaml`, and `enabled`. `slug` has the `by_slug` index and is a stable identifier shared with workers and requests. Rename changes `name` only.

The YAML string is authoritative. Do not denormalize pipeline params or nodes into other spec fields. This preserves arbitrary sections and node options.

### `spaces`

Display-space records with `specSlug` and `name`, indexed by `by_spec_slug`. Normally one record exists per spec. `specs.create` creates it, `specs.rename` keeps it synchronized, and `specs.remove` deletes it.

### `requests`

One document per submitted run/request. Main fields include `specSlug`, optional `pipelineName`, `title`, `status`, arbitrary `params`, merged `technical` metadata, `plan`, optional `currentNode` and `unitId`, and `progress`.

Indexes: `by_spec_slug`, `by_spec_slug_and_status`, `by_status`, `by_unit_id`. Claim uses `by_spec_slug_and_status` to select waiting requests atomically.

### `units`

One document per worker `unitId`, including `status`, `lastSeen`, allowed `specSlugs`, workloads, `unitType`, `workingDir`, `devices`, metadata, and active `currentRequestIds`. Indexes include `by_unit_id` and `by_status`.

## Main flows

### Create a space

The desktop accepts a complete YAML document, validates that its root is a mapping, derives a slug from the display name, then calls `specs.create`. Convex stores raw YAML and creates the corresponding `spaces` record.

### Edit a space

`src/App.tsx` edits a YAML draft. Pipeline editing changes only the selected pipeline portion of the parsed document and serializes the full document back to YAML, preserving unrelated sections. Saving calls `specs.update` with YAML, description, and name.

### Rename a space

`specs.rename` patches `specs.name` and synchronizes all `spaces` records for that stable slug. It intentionally does not change slug, YAML, or requests.

### Delete a space

`specs.remove` deletes up to 500 associated request docs in one mutation, clears those request IDs from registered units, deletes space docs, then deletes the spec. More than 500 requests causes an error without partial deletion. The UI confirms first.

### Create and run requests

The UI creates a request with `status: "waiting"`, chosen `pipelineName`, and params. A worker heartbeat registers the unit and allowed spec slugs. `units.claim` atomically marks requests `possessed`; `requests.updateFromWorker` updates request status and node `plan`. Convex queries update the UI reactively.

## Frontend map

- `src/App.tsx`: space navigation/actions, spec editor, pipeline editor and graph, request list/details, runtime plan overlay.
- `src/App.css`: base design and light/dark styling.
- `src/graph.css`: dependency graph and per-node execution styles.
- `src/space-actions.css`: sidebar kebab menu and rename/delete actions.
- `src/main.tsx`: Convex client initialization and provider.

## Backend map

- `convex/schema.ts`: table validators and indexes.
- `convex/specs.ts`: spec/space CRUD, internal YAML query, compatibility migration.
- `convex/requests.ts`: request creation/list/update validators and terminal-unit cleanup.
- `convex/units.ts`: heartbeat and atomic claim.
- `convex/http.ts`: bearer auth, CORS, hook payload validation, HTTP responses.

## Compatibility debt

The schema still accepts legacy `requests.nodeStates`, `units.device`, and `units.currentRequestId` for older documents. New worker/frontend writes should use `plan`, `devices`, and `currentRequestIds`. `specs.migrateExecutionContract` is defined but should only be run after inspecting deployed data and confirming it is appropriate. Keep old fields until backfill completion is verified.
