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

The desktop uses Clerk for sign-in and session management. Convex verifies JWTs using the configured Clerk issuer with audience `convex`. Every public application query/mutation uses `requireAuthenticated`, which checks the issuer and deployment whitelist: exact Clerk User ID OR exact verified primary email. Empty/malformed policy denies access. All allowed accounts share the existing application data; no per-user ownership is introduced. `auth.access` reports only the caller's access status for the frontend gate. Worker HTTP hooks retain their separate bearer-token authorization. Saved server profiles remain unchanged. See [Clerk authentication](clerk-auth.md).

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

### Activity

The sidebar's Activity page is a read-only, reactive view across all specs and pipelines. Units reuse `units.list` (the latest 200 registered units), with online units displayed first and status, devices, and last-seen time shown as stored. There is no presence timeout or inferred connectivity.

`requests.listActive` uses the `by_status_deleted_at` index to fetch non-deleted `possessed` and `processing` requests globally. It returns only IDs, status, assigned unit, claim time, and node names/statuses; payloads, logs, and artifacts are omitted. Reads are bounded to 500 requests per status, with an explicit notice when truncated. Requests leave the view when their stored status changes out of the active set. The UI subscribes through Convex without polling or execution controls. Query errors appear within the affected section; missing backend functions show a synchronization hint rather than unmounting the desktop shell. Deploy the backend query and index to the connected server before using the new page.

## Frontend map

- `src/App.tsx`: spec navigation/actions, spec editor, pipeline editor and graph, request list/details, runtime node-state overlay.
- `src/components/ActivityView.tsx` and `src/activity.css`: unit and active-request monitoring.
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
- `src/components/AuthenticatedRoot.tsx`: Clerk sign-in and backend access-status gate.

## Backend map

- `convex/schema.ts`: table validators and indexes.
- `convex/specs.ts`: spec CRUD and internal YAML query.
- `convex/requests.ts`: request creation/list/update and node-state reporting.
- `convex/units.ts`: heartbeat and atomic claim.
- `convex/http.ts`: bearer auth, CORS/preflight, and worker hooks.
- `convex/unitTokens.ts`: public token-management queries/mutations and internal Unit-token lookup.
- `convex/notifications.ts`: notification listing, read marking, dismissal, and internal creation.

The desktop calls `unitTokens.list`, `unitTokens.create`, `unitTokens.update`, and `unitTokens.revoke` through Convex's normal reactive client API after signing in. The browser generates the random token and sends only its SHA-256 hash to Convex; plaintext is shown once and is never available to list/get operations.

Within Settings, the token manager stays mounted while collapsed, so its subscription and form/filter state survive reopening. It preloads metadata when Settings opens, displays a static loading placeholder instead of a false zero count, and retains the last metadata list with an Updating indicator while filter results load. That transient snapshot is scoped to the selected server and is replaced by reactive results. Closing the panel clears the one-time plaintext reveal; token plaintext is not cached or persisted.

Tauri commands `load_connection_settings` and `save_connection_settings` persist profile metadata under the platform app config directory. They store endpoint URLs only; CLI admin credentials remain in the developer's environment and are not part of desktop settings.

Clerk verification uses `CLERK_JWT_ISSUER_DOMAIN`; backend policy uses `AUTH_ALLOWED_USER_IDS` and `AUTH_ALLOWED_EMAILS` (JSON arrays). The frontend contains only `VITE_CLERK_PUBLISHABLE_KEY`, never a secret/admin key. Legacy Convex Auth code, schema declarations and dependencies have been removed; old database records and signing variables remain for rollback. See [migration cleanup](clerk-auth.md#verification-and-cleanup).

## Runtime node states

Each `requests.nodeStates` entry is keyed by node name and may contain `status`, `device`, `artifacts`, and `logs`. The UI overlays these states on the graph defined in the spec YAML and exposes the selected node's reported details.

Requests can be deleted from the request details with confirmation. Deletion sets optional `requests.deletedAt` (Unix milliseconds) and preserves the record. It leaves the existing `status` unchanged; `deleted` is not a request status. Visibility and claim eligibility depend on `deletedAt`, independently of execution status. Deleted requests are excluded through indexes before list/inspection/claim limits and cannot be edited. Deletion is idempotent and does not cancel an already running worker; its reports remain accepted without clearing `deletedAt`.


### Request artifact storage

`requests.artifacts[]` owns completed file metadata; bytes live in Convex `_storage`. Optional node names annotate the producing node. `artifactUploads` records request, logical artifact ID, caller, expected digest/size, expiry and optional bound storage ID, indexed by storage ID. Completion validates the receipt and storage metadata, then atomically upserts one artifact without overwriting siblings. Replacement deletes the previous file. Soft deletion retains bytes; failed native uploads and receipts currently require deliberate cleanup. See [Request artifacts](request-artifacts.md) for the full contract and bearer URL access model.

`convex/requestArtifacts.ts` owns public desktop and internal worker storage functions. `src/components/RequestArtifacts.tsx` renders request files and performs desktop uploads. Worker inspection/claims include artifact metadata. Node artifact arrays share the request artifact shape and reference verified files on the same request; reports validate exact metadata and node assignment. Completion refreshes node references atomically when a file is replaced. Legacy node string maps are no longer accepted; see the rollout notes in the artifact contract.

## Responsive workspace layout

Navigation stays horizontal. Content uses its available container width: Settings
has one column below 900 px and two above. Expanded server and unit-token
management sections both span the full row.
Unit-token cards use one column below 700 px and at most two above; the token
being edited spans both internal columns. Forms
stack when their own container is narrow. No layout animation is used.

Overview keeps graph and node configuration side by side when its container is
wide enough, with responsive entry/workload grids. Notifications remain a
chronological list; message text is limited to 80 characters' width while time
and actions stay on the right when space allows. Content order is preserved
without dense grid packing.

## Dropdown controls

`src/components/ui/SelectField.tsx` wraps Radix Select for request status, request
pipeline selection. Clerk manages sign-in account selection. `ActionMenu.tsx` wraps Radix
Dropdown Menu for request and spec actions. Shared styles in `src/dropdowns.css`
use application theme variables, not the OS dropdown palette. Content portals
into the nearest themed app shell, stays outside scroll-clipped cards, and
positions against viewport edges. Keyboard navigation, disabled options,
selection indicators, Escape and focus restoration are handled by the primitives.
Escape in a nested dropdown closes it without closing the request editor.
Menus intentionally have no animation.

## Shared input controls

`src/components/ui/Input.tsx` provides Input and Textarea across forms, search,
authentication, token management and section editors. Styling in `src/inputs.css`
uses application theme colors and explicit focus/disabled/error states. Checkboxes
have a custom visual appearance while preserving native labels, keyboard events,
form semantics and ref support. Hidden file inputs retain the system file chooser.

Token expiration uses a lazy-loaded DateTimePicker with React DayPicker and a
Radix Popover. Calendar month/year and hour/minute choices use the shared Select.
Apply commits a local `YYYY-MM-DDTHH:mm` value; Cancel/outside dismissal leaves the
saved draft unchanged, and Clear removes expiration. Minimum date/time checks and
strict local date parsing prevent invalid values or silent UTC conversion.

### Failed request retry lifecycle

Authenticated `requests.reset` atomically requeues a failed request in place,
clearing runtime fields and artifact references while preserving ID and inputs.
The optional numeric `requests.resetVersion` increments each reset; the optional
`artifactUploads.resetVersion` captures the request version at upload start.
Missing versions mean zero for existing documents. Completion rejects receipts
whose version differs from the request, including previously completed receipts,
so old uploads cannot repopulate a cleared artifact list. Reset never deletes
physical storage files. No worker HTTP payload shape changes are required.

Node execution reports include optional `reason` (string) for scheduler waits and
errors. The backend preserves explicit node outcomes independently of request
status; the desktop marks stale nonterminal nodes as unconfirmed after request
completion. See [lifecycle reporting](worker-hooks.md#automatic-mu-lifecycle-reporting).
