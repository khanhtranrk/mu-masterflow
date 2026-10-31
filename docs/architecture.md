# Architecture and data model

## Runtime

```text
Tauri desktop window
  └─ React + Vite UI (src/)
       └─ Connection controller
            ├─ saved Convex server profiles
            └─ Convex React client for the selected profile
                 ├─ public queries/mutations for specs and requests
                 └─ reactive updates from worker HTTP hooks

Mu workers
  └─ Convex HTTP routes (convex/http.ts)
       └─ internal mutations/queries (units, requests, specs)
```

The app is a Tauri v2 desktop shell around a web frontend. Convex is the shared persistence and realtime layer. The desktop UI uses Convex queries and mutations; workers use HTTP hooks authenticated with a bearer token.

The connection controller loads server profiles and the saved appearance preference before mounting the Convex Auth provider. Tauri stores profile names, endpoint URLs, remembered account emails, and the dark-mode flag in its app config directory; browser preview uses local storage. A profile stores separate client/API and HTTP site URLs. Signing out of a user account preserves the selected server; disconnecting clears only the active selection, keeps all profiles, and leaves the Settings workspace visible so another server can be selected. Removing a profile is a separate action. The app does not store a Convex admin key. Account, appearance, server, and Unit-token management are grouped in the Settings page. The login screen uses its own server-selection dialog, while Settings uses an inline server panel.

The desktop supports email/password sign-in and registration of the first account on a deployment. Public app queries and mutations call a shared authentication guard; calls without a Convex Auth user are rejected. The `createOrUpdateUser` mutation callback checks for an existing user and atomically rejects subsequent account creation, while a public status query only controls whether the UI offers registration. Remembered account emails belong to a local server profile, while passwords are never saved. Convex Auth session tokens are namespaced by deployment URL. The single account has access to all application data; there is no per-user ownership model. Worker HTTP hooks retain their separate bearer-token authorization. The sidebar displays the selected server name in a status-colored badge.

## Tables

The desktop connects to the Convex client/API URL for realtime data. Worker hooks connect to the Convex HTTP actions/site URL. These URLs are different on a self-hosted installation.

### `specs`

One document per spec. Fields are `slug`, display `name`, `description`, raw `yaml`, `enabled`, and optional `deletedAt`. `slug` has the `by_slug` index and is a stable identifier shared with workers and requests. Rename changes `name` only. Archived specs are hidden from the normal list; their requests are retained.

The YAML string is authoritative. Do not denormalize pipeline params or nodes into other spec fields. This preserves arbitrary sections and node options. There is no separate `spaces` table.

### `requests`

One document per submitted run/request. Fields are `specSlug`, `pipelineName`, `status`, arbitrary `payload`, optional `nodeStates`, optional `artifacts`, optional `unitId`, optional `claimedAt`, and optional `deletedAt`. The UI submits the pipeline parameter values as `payload`; node runtime information is keyed by node name in `nodeStates`.

Request selection uses compound indexes for `specSlug` and each supported combination of status, pipeline, and unit filters, with `deletedAt` as the final indexed field. List, inspection, and atomic claim queries require `deletedAt` to be absent before applying their limits. The standalone `by_status` index is also retained.

### `units`

One document per worker `unitId`, including `unitType`, `status` (`online` or `offline`), `workingDir`, `devices` (`family` and `index`), and `lastSeen`. Indexes include `by_unit_id` and `by_status`.

### `unitTokens`

Stores token `name`, `tokenHash`, `createdAt`, optional `lastUsedAt`, `expiresAt`, and `deletedAt`. The UI generates token plaintext in the browser, hashes it with SHA-256, and stores only the hash. Worker requests are authorized against the stored hash. Token management uses public Convex queries and mutations.

### `notifications`

Worker hooks and internal workflows create notifications with `title`, `message`, optional `tags`, and `createdAt`. The desktop subscribes reactively to recent notifications, shows unread items in its sidebar and notification view, and lets the user mark them read or dismiss them. New notifications show an in-app toast while the app is focused; when it is not focused, Tauri sends a system notification if permission has been granted.

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
- `src/unit-tokens.css`: Unit-token administration UI.
- `src/components/NotificationsView.tsx` and `src/notifications.css`: notification list, unread state, and system-notification permission UI.
- `src/main.tsx`: React root and dynamic Convex connection provider.
- `src/connectionSettings.ts`: profile types, URL validation, and browser/native persistence bridge.
- `src/components/ConnectionController.tsx`: profile loading, dynamic Convex client lifecycle, and first-run connection gate.
- `src/components/ServerSettingsPanel.tsx`: inline saved-server management in Settings.
- `src/components/LoginServerDialog.tsx`: login-specific server selection and profile editor.
- `src/components/DisconnectedRoot.tsx`: persistent workspace/settings shell for choosing a server while disconnected.
- `src/components/AuthenticatedRoot.tsx`: authenticated-state gate, saved-account chooser, and password sign-in/sign-up UI.

## Backend map

- `convex/schema.ts`: table validators and indexes.
- `convex/specs.ts`: spec CRUD and internal YAML query.
- `convex/requests.ts`: request creation/list/update and node-state reporting.
- `convex/units.ts`: heartbeat and atomic claim.
- `convex/http.ts`: bearer auth, CORS/preflight, and worker hooks.
- `convex/unitTokens.ts`: public token-management queries/mutations and internal Unit-token lookup.
- `convex/notifications.ts`: notification listing, read marking, dismissal, and internal creation.

The desktop calls `unitTokens.list`, `unitTokens.create`, `unitTokens.update`, and `unitTokens.revoke` through Convex's normal reactive client API after signing in. The browser generates the random token and sends only its SHA-256 hash to Convex; plaintext is shown once and is never available to list/get operations.

Tauri commands `load_connection_settings` and `save_connection_settings` persist profile metadata under the platform app config directory. They store endpoint URLs only; CLI admin credentials remain in the developer's environment and are not part of desktop settings.

Convex Auth requires `JWT_PRIVATE_KEY` and `JWKS` on each deployment. `auth.config.ts` validates JWTs against that deployment's `CONVEX_SITE_URL`. Do not share signing keys across independently administered deployments.

## Runtime node states

Each `requests.nodeStates` entry is keyed by node name and may contain `status`, `device`, `artifacts`, and `logs`. The UI overlays these states on the graph defined in the spec YAML and exposes the selected node's reported details.

Requests can be deleted from the request details with confirmation. Deletion sets optional `requests.deletedAt` (Unix milliseconds) and preserves the record. It leaves the existing `status` unchanged; `deleted` is not a request status. Visibility and claim eligibility depend on `deletedAt`, independently of execution status. Deleted requests are excluded through indexes before list/inspection/claim limits and cannot be edited. Deletion is idempotent and does not cancel an already running worker; its reports remain accepted without clearing `deletedAt`.


### Request artifact storage

`requests.artifacts[]` owns completed file metadata; bytes live in Convex `_storage`. Optional node names annotate the producing node. `artifactUploads` records request, logical artifact ID, caller, expected digest/size, expiry and optional bound storage ID, indexed by storage ID. Completion validates the receipt and storage metadata, then atomically upserts one artifact without overwriting siblings. Replacement deletes the previous file. Soft deletion retains bytes; failed native uploads and receipts currently require deliberate cleanup. See [Request artifacts](request-artifacts.md) for the full contract and bearer URL access model.

`convex/requestArtifacts.ts` owns public desktop and internal worker storage functions. `src/components/RequestArtifacts.tsx` renders request files and performs desktop uploads. Worker inspection/claims include artifact metadata. Node artifact arrays share the request artifact shape and reference verified files on the same request; reports validate exact metadata and node assignment. Completion refreshes node references atomically when a file is replaced. Legacy node string maps are no longer accepted; see the rollout notes in the artifact contract.
