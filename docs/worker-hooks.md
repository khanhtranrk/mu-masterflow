# Worker HTTP hooks

Workers use the Convex HTTP **site** origin, normally port 3211 in self-hosted development; the Convex client/API origin normally uses 3210. All business routes below require `Authorization: Bearer <UNIT_TOKEN>`. `/api/health` and preflight OPTIONS are public. Responses use JSON except spec YAML; errors use `{error: "..."}`.

## Worker identity and permissions

The application owner creates/manages tokens through the Clerk-authenticated desktop. Token plaintext is shown once; Convex stores only its SHA-256 hash. Each token must be bound to one immutable `unitId` and explicit allowed `specSlugs`. Existing unbound tokens must be updated in Settings → Unit tokens. Expired or revoked tokens are refused.

Workers can heartbeat, read explicitly allowed specs, claim waiting requests, report assigned requests, transfer artifacts for those assignments and send lifecycle notifications. They cannot create requests, inspect arbitrary requests, delete artifact records or manage storage connections. `POST /api/requests/create` and `GET /api/requests` return 403 for authenticated workers; use the Clerk-authenticated application for these operations.

Claim stores the actual token ID on the request and returns `assignmentVersion`. Request report and artifact operations require `X-Mu-Assignment-Version` with that exact value. Reset/reassignment increments the generation and invalidates old calls. The updated CLI automatically adds the header to request-context actions sent to its configured MasterFlow origin. No identity in a request body overrides token identity.

## Heartbeat — POST /api/units/heartbeat

Send `unitId`, `status` (`online` or `offline`), optional `unitType`, `workingDir`, and `devices` (objects with `family` and numeric `index`). The ID must match the token binding. A unit already bound to another active token cannot be taken over; revoke the previous token when rotating workers. Returns `{ok:true}`. Heartbeat is required before claiming work.

## Spec — GET /api/specs/<url-encoded-slug>

Returns authoritative YAML only for a slug in the token's allowed list. There is no artifact or request data enumeration through this route. Remote workers need network access to the HTTP site and the storage provider endpoints.

## Claim — POST /api/requests/claim

Body: `unitId`, `specSlug`, optional `maxCount` (default 1, range 1–100), `byPipeline`, `byStatus`, `byUnitId`.

Only waiting requests can be claimed. Omit `byStatus` or provide `waiting` / `["waiting"]`; other statuses are rejected. Pipeline filters accept a nonempty string or array, with OR within the group. Filters combine with AND, candidates are selected through indexes and merged oldest-first before the global limit. The spec must be allowed for this token; the unit ID must match the token and registered unit.

Selection and assignment are atomic. Matching requests become `possessed`, with token ID, unit ID, claim time and incremented assignment generation. Each returned item contains `requestId`, `assignmentVersion`, `specSlug`, `pipelineName`, `payload` and optional compatibility artifact metadata. An empty array means no work. Do not try to reclaim processing/completed requests; use desktop reset for failed work.

## Report — POST /api/requests/report

Send `id` (request ID), optional `status` and/or `node_states`. Include `X-Mu-Assignment-Version` from claim. Assignment, active token and allowed spec are rechecked in the mutation.

Worker-reportable statuses: `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`. Workers cannot report `waiting` or `possessed` to requeue/reassign work.

Node entries are keyed by node name and may contain `status` (`queue`, `running`, `failed`, `succeeded`), `reason`, `device` (`family`, `index`), `artifacts` and `logs`. New nodes require a status. Logs append; omitted fields preserve state. A status change without a reason clears the old reason. Artifact metadata must exactly match an already registered request artifact and its declared node; reports cannot register files. Top-level `artifacts` and legacy string maps are refused. `artifacts: []` clears node references, not files or artifact records. In-flight reports remain accepted after soft request deletion for the assigned worker, without removing `deletedAt`.

## Artifacts

See [the canonical artifact protocol](request-artifacts.md#direct-transfer-protocol). Upload is now presigned PUT, completion uses uploadId without storageId, and downloads return a fresh URL for a separate unauthenticated storage request. Convex never proxies bytes. Both `/download-url` and the transitional `/download` path return URL JSON.

Use exactly the returned upload method/headers. Never send unit tokens to a storage URL. Single files are limited to 5 GiB and any lower provider limits; multipart is not implemented. Private buckets and CORS must be configured by the owner.

## Notifications — POST /api/notifications/send

A bound active worker token can send lifecycle telemetry with string `title`, string `message` and optional string-array `tags`. This remains usable in entry initialization/finalization before or after request execution. It does not grant access to notification management, request creation or storage configuration.

## Desktop lifecycle and compatibility

Request soft deletion preserves payload, status and physical files. Deleted requests are excluded before list/claim limits. Failed requests can be reset through the desktop: reset clears runtime state and current artifact projections, invalidates assignment/upload generations and retains physical files. Archived specs retain dependent requests but cannot accept new requests or serve new work.

Update backend, CLI and YAML upload routines together. Existing examples under `mu-cli/examples/` demonstrate method/header negotiation and URL download. Old unscoped tokens and old in-flight clients cannot be silently upgraded into trusted assignments; finish/requeue them deliberately during cutover. Do not run GPU/media examples as smoke tests.
