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

The desktop connects to the Convex client/API URL for realtime data. Worker hooks and the auth-token manager connect to the Convex HTTP actions/site URL. These URLs are different on a self-hosted installation.

### `specs`

One document per spec. Fields are `slug`, display `name`, `description`, raw `yaml`, `enabled`, and optional `deletedAt`. `slug` has the `by_slug` index and is a stable identifier shared with workers and requests. Rename changes `name` only. Archived specs are hidden from the normal list; their requests are retained.

The YAML string is authoritative. Do not denormalize pipeline params or nodes into other spec fields. This preserves arbitrary sections and node options. There is no separate `spaces` table.

### `requests`

One document per submitted run/request. Fields are `specSlug`, `pipelineName`, `status`, arbitrary `payload`, optional `nodeStates`, optional `unitId`, and optional `claimedAt`. The UI submits the pipeline parameter values as `payload`; node runtime information is keyed by node name in `nodeStates`.

Indexes: `by_spec_slug`, `by_spec_slug_and_status`, and `by_status`. Claim uses `by_spec_slug_and_status` to select waiting requests atomically.

### `units`

One document per worker `unitId`, including `unitType`, `status` (`online` or `offline`), `workingDir`, `devices` (`family` and `index`), and `lastSeen`. Indexes include `by_unit_id` and `by_status`.

### `authTokens`

Stores token `name`, `tokenHash`, `createdAt`, optional `lastUsedAt`, `expiresAt`, and `deletedAt`. Plaintext is returned only when a token is created; worker requests are authorized against the stored hash. Management HTTP routes require the separate server-side `AUTH_TOKENS_ADMIN_KEY`.

## Main flows

### Create a spec

The desktop accepts a complete YAML document, validates that its root is a mapping, derives a slug from the display name, then calls `specs.create`. Convex stores raw YAML in the `specs` table.

### Edit a spec

The desktop edits a YAML draft. Pipeline editing changes only the selected pipeline portion of the parsed document and serializes the full document back to YAML, preserving unrelated sections. Saving calls `specs.update` with YAML, description, and name.

### Rename a spec

`specs.rename` patches `specs.name`. It intentionally does not change slug, YAML, or requests.

### Archive a spec

`specs.remove` sets `deletedAt`; it does not delete associated requests. The UI confirms before archiving.

### Create and run requests

The UI creates a request with a chosen `pipelineName` and parameter `payload`. A worker heartbeat registers its current unit fields. `units.claim` atomically marks waiting requests `possessed`; the worker reports request and per-node states through the hook, persisted as `status` and `nodeStates`. Convex queries update the UI reactively.

## Frontend map

- `src/App.tsx`: spec navigation/actions, spec editor, pipeline editor and graph, request list/details, runtime node-state overlay.
- `src/App.css`: base design and light/dark styling.
- `src/graph.css`: dependency graph and per-node execution styles.
- `src/space-actions.css`: sidebar spec actions.
- `src/request-details.css`: request node-state, artifact, log, and unit details.
- `src/auth-tokens.css`: auth-token administration UI.
- `src/main.tsx`: Convex client initialization and provider.

## Backend map

- `convex/schema.ts`: table validators and indexes.
- `convex/specs.ts`: spec CRUD and internal YAML query.
- `convex/requests.ts`: request creation/list/update and node-state reporting.
- `convex/units.ts`: heartbeat and atomic claim.
- `convex/http.ts`: bearer auth, CORS/preflight, worker hooks, and admin-key-protected token-management HTTP routes.
- `convex/authTokens.ts`: internal token lookup and management functions.

Auth-token CRUD functions remain internal. The desktop calls the HTTP actions under `/hooks/auth-tokens`; those routes require the server-side `AUTH_TOKENS_ADMIN_KEY`. Worker requests use tokens stored as hashes in `authTokens`. The plaintext token is returned once at creation and is never available to list/get operations.

## Runtime node states

Each `requests.nodeStates` entry is keyed by node name and may contain `status`, `device`, `artifacts`, and `logs`. The UI overlays these states on the graph defined in the spec YAML and exposes the selected node's reported details.
