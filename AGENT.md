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
- `src/components/`: spec sidebar/workspace sections, graph, YAML editors, request views, unit-token manager, and dialogs.
- `src/components/NotificationsView.tsx`: reactive notifications list and read/dismiss actions.
- `src/systemNotifications.ts`: Tauri/browser notification permission and delivery helpers.
- `src/specUtils.ts`, `src/types.ts`: shared YAML/graph helpers and frontend data types.
- `src/App.css`, `src/graph.css`, `src/space-actions.css`, `src/request-details.css`, `src/unit-tokens.css`, `src/notifications.css`, `src/connections.css`, `src/settings.css`, `src/sidebar-connection.css`: UI styles.
- `src/main.tsx`: React root and dynamic Convex connection provider.
- `src/connectionSettings.ts`: server profile types, URL validation, and native/browser persistence bridge.
- `src/components/ConnectionController.tsx`: server profile loading, Convex client lifecycle, and first-run connection gate.
- `src/components/ServerSettingsPanel.tsx`: inline server profile management from Settings.
- `src/components/LoginServerDialog.tsx`: login-specific server selection and editing dialog.
- `src/components/DisconnectedRoot.tsx`: persistent workspace/settings shell for choosing a server while disconnected.
- `src/components/SettingsView.tsx`: appearance, server management, and account sign-out settings.
- `src/components/AuthenticatedRoot.tsx`: auth gate, sign-in/sign-up, and remembered-account UI.
- `convex/schema.ts`: Convex tables and indexes.
- `convex/specs.ts`: spec queries and mutations, YAML retrieval, archive handling.
- `convex/requests.ts`: request creation/list/update and request/node status validators.
- `convex/requestArtifacts.ts`: request artifact upload receipts, completion verification, desktop URLs and worker file lookup.
- `src/components/RequestArtifacts.tsx`: request artifact list, desktop upload and download actions.
- `convex/units.ts`: unit heartbeat and atomic request claiming.
- `convex/http.ts`: bearer-authenticated worker HTTP endpoints.
- `convex/unitTokens.ts`: internal unit-token lookup, creation, updates, revocation, and last-used tracking.
- `convex/notifications.ts`: notification query, read/dismiss mutations, and internal creation.
- `convex/auth.ts`, `convex/auth.config.ts`: Convex Auth password provider, first-account-only registration, and JWT issuer configuration.
- `convex/authz.ts`: shared guard used by public application queries and mutations.
- `src-tauri/`: Tauri v2 desktop wrapper and window config.
- `README.md`: repository entry point.

## Data model and invariants

1. **The complete YAML is authoritative.** Store it as `specs.yaml`. Do not recreate parallel `params` or `nodes` fields on `specs`; the YAML can contain arbitrary sections and node configuration.
2. **Specs are the only configuration records.** There is no `spaces` table. Their stable `slug` is used by requests and workers; rename changes `name` only.
3. **A request belongs to one spec and one pipeline.** Store each request as a separate `requests` document with `specSlug`, `pipelineName`, `payload`, execution `status`, optional `unitId`, and per-node `nodeStates`.
4. **A pipeline is a DAG.** `depends_on` determines edges. Do not flatten pipeline execution into a single ordered step list. Unknown YAML fields and node configuration must survive UI edits.
5. **Node states are runtime data, not the spec graph.** `nodeStates` is keyed by node name and may contain `status`, `device`, `artifacts`, and `logs`; the UI overlays those states on the YAML pipeline graph.
6. **Claiming must stay atomic.** `units.claim` selects requests through an index matching the supplied filters and changes matching records to `possessed` in the same Convex mutation.
7. **Unit authorization uses unit tokens.** Worker HTTP hooks validate the bearer token against the token hash in `unitTokens`. The desktop manages token metadata through public Convex queries/mutations; token plaintext is generated in the browser and shown only once.
8. **Archiving a spec retains its dependent requests.** `specs.remove` sets `deletedAt`; the UI confirms before archiving. Request deletion uses `requests.remove` to set `deletedAt` without changing `status` (`deleted` is not a status). Exclude deleted requests from lists, inspection, and claims through indexes before limiting results; retain in-flight worker reports. See [architecture](docs/architecture.md#requests).
9. **Use Convex indexes.** Do not scan whole tables with `.collect()` or filter database queries in memory. Add/adjust indexes when adding lookup paths.
10. **Avoid hard-coded assumptions about pipeline names or workload types.** Specs can define arbitrary pipelines and workloads.

## Current API/status contract

- Request statuses: `waiting`, `possessed`, `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`.
- Node-state statuses: `queue`, `running`, `failed`, `succeeded`.
- Request editing in the desktop uses `requests.editPayload`: waiting-only, expected-payload conflict detection, saved-schema type validation, and payload-only patching. Completed/claimed requests can be duplicated into a new waiting request. See [request editing](docs/spec-yaml.md#creating-and-editing-requests).
- Failed requests can be requeued in place through authenticated `requests.reset`: only `process_failed` / `retrieve_artifact_failed` (plus legacy `failed`), latest-state check in the mutation, same ID/payload/pipeline/creation time, status `waiting`, cleared `unitId`, `claimedAt`, `nodeStates` and artifact links. Optional `requests.resetVersion` increments on reset; upload receipts snapshot that version and cannot complete after a reset. Physical storage files are retained.
- Request creation accepts `specSlug`, `pipelineName`, and `payload`. Workers can create waiting requests through `POST /api/requests/create` without claiming or executing them.
- `GET /api/requests` inspects requests without modifying them. This endpoint and `POST /api/requests/claim` require `specSlug`, accept `maxCount` (default 1, range 1–100), and combine optional `byPipeline`, `byStatus`, and `byUnitId` filters with AND. Claim accepts a string or string array for pipeline/status (OR within each group, at most 100 combinations), merges indexed candidates oldest-first before the global limit, and remains atomic. GET inspection keeps single-string query parameters. Omitted filters impose no restriction, including status; claim can therefore claim requests in any state. `byStatus` accepts any non-empty string. Claim sets matches to `possessed` and assigns the receiving `unitId`.
- Stored file artifacts belong to optional `requests.artifacts[]`; completion upserts one logical ID atomically. Worker upload/download routes live under `/api/requests/artifacts/`. Node artifact arrays use the same shared validator and must reference registered request files; legacy maps are rejected; see [request artifacts](docs/request-artifacts.md).
- Worker reports use `POST /api/requests/report` with the `node_states` HTTP property, which is stored as `requests.nodeStates`.
- Worker hooks use the Convex HTTP site URL, not the Convex client URL. For the default self-hosted Docker setup these are ports `3211` (HTTP site) and `3210` (Convex API).
- The desktop stores Convex profile names, URLs, remembered account email addresses, and the dark appearance preference in the Tauri app config directory. Profiles include separate client/API and HTTP site URLs; signing out does not remove a profile. The app does not store a Convex admin key or account passwords.
- Desktop Convex queries/mutations require Convex Auth. Each deployment allows only its first account to register; the backend enforces this during the atomic user-creation mutation, and every authenticated user shares access with no per-user ownership. The client remembers account emails per local server profile but never stores passwords. Worker HTTP hooks remain bearer-token authenticated.
- Unit-token management is grouped in **Settings → Unit tokens** and uses the Convex client API. Worker HTTP hooks remain under `/api/` and use bearer tokens.
- The sidebar shows the selected Convex server and connection state in a badge by the brand. Disconnecting keeps the app shell and Settings available while clearing only the active profile selection.
- Workers create notifications with `POST /api/notifications/send`, using an active bearer token and a JSON `title`, `message`, and optional string-array `tags`. The desktop subscribes to notifications through Convex; its list is newest-first and limited to 100 in the UI.
- New notifications received while the desktop window is visible and focused use an in-app toast. Notifications received while unfocused use the Tauri system notification plugin when OS permission is granted; the Notifications page is where users request permission. The initial query is treated as existing history, not as newly arrived notifications.
- Hook routes and exact JSON contracts are in [docs/worker-hooks.md](docs/worker-hooks.md).

## Compatibility note

Request node states include optional `device`, `artifacts`, and `logs` per node. Both node and request `artifacts` use the shared `artifactModel.ts` metadata-array validator; report cannot register arbitrary storage IDs. Unit documents currently store `unitId`, `unitType`, `status`, `workingDir`, `devices`, and `lastSeen`.

## Working safely

- Before editing any file in `convex/`, consult the Convex skill and preserve the object-form function syntax, argument validators, return validators, index use, and internal/public boundaries.
- Keep UI state changes and mutations reactive through `useQuery`/`useMutation`; do not copy server state into a disconnected local store.
- Do not expose worker or admin bearer secrets in source code, logs, screenshots, docs, or committed env files. The docs may describe the authorization header using placeholders only.
- Do not delete or rename a user spec as part of a test. Use a disposable spec and clean it up.
- If changing request status shapes or stored fields, update schema and function validators, HTTP validation, frontend status labels, and docs together.
- Run `bunx --bun tsc --noEmit` and `bunx --bun vite build --configLoader runner` after relevant changes. If Convex is available, use `bunx --bun convex run <module:function> '<json args>' --push` to sync and verify development functions. Do not claim a Convex deployment test if the backend was unavailable.

## Local environment

`.env.local` is local configuration and must not be committed. This checkout is configured for a self-hosted Convex deployment. Optional `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` values bootstrap the first desktop profile; after that, profiles are managed in the app. See [docs/development.md](docs/development.md).


Request file uploads and downloads use request-level `artifacts[]` backed by Convex File Storage. See [Request artifacts](docs/request-artifacts.md) for schema, receipt validation, worker endpoints, desktop behavior, limits, retention and migration compatibility.
