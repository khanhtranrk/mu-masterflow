# Worker HTTP hooks

Worker hook requests require a bearer token issued by the `authTokens` service. The Auth tokens management routes use the separate `AUTH_TOKENS_ADMIN_KEY` secret.

```http
Authorization: Bearer <worker-auth-token>
Content-Type: application/json
```

Worker tokens are stored as hashes; plaintext is only returned at creation time. Never commit or log either kind of secret. Paths below are relative to the Convex HTTP site URL (`VITE_CONVEX_SITE_URL` locally).

## Auth token management

Set `AUTH_TOKENS_ADMIN_KEY` in the Convex deployment environment to a unique random secret of at least 32 bytes. The management endpoints return `503` until configured and require it in the bearer authorization header.

- `GET /hooks/auth-tokens?includeRevoked=true|false`: list token metadata; revoked tokens are excluded by default.
- `POST /hooks/auth-tokens/create`: create with `{ "name": "...", "expiresAt": 123 }`; `expiresAt` is optional and is a millisecond timestamp. The response includes the plaintext token exactly once.
- `POST /hooks/auth-tokens/update`: update with `{ "id": "...", "name": "...", "expiresAt": 123 }`; use `null` to remove expiration.
- `POST /hooks/auth-tokens/revoke`: revoke with `{ "id": "..." }`.

The desktop token manager keeps the admin key in memory only while the page is open. Do not place it in Vite environment variables or client source.

The UI calls `GET /hooks/auth-tokens` and `POST` on the create, update, and revoke child paths. Both the exact `/hooks/auth-tokens` path and `/hooks/auth-tokens/…` child paths answer `OPTIONS`, as browsers preflight requests carrying an Authorization header. An unmatched preflight route results in a browser “Failed to fetch” error before the admin key is checked.

## `POST /hooks/units/heartbeat`

Register or refresh a unit. `unitId` and `status` (`online` or `offline`) are required. `unitType`, `workingDir`, and `devices` are optional; each device has a `family` and numeric `index`.

```json
{
  "unitId": "mu-karen",
  "status": "online",
  "unitType": "Karen",
  "workingDir": "/worker/path",
  "devices": [
    {"family": "cuda", "index": 0},
    {"family": "cuda", "index": 1}
  ]
}
```

Response: `{"ok":true}`. The unit record stores `unitId`, `unitType`, `status`, `workingDir`, `devices`, and `lastSeen`.

## `POST /hooks/requests/claim`

Request:

```json
{"unitId":"mu-karen","specSlug":"song-with-cover","maxCount":5}
```

`unitId` and `specSlug` are required. `maxCount` defaults to 1 and must be an integer from 1 to 100.

The Convex mutation uses `by_spec_slug_and_status` and changes selected records from `waiting` to `possessed` atomically before returning, so competing workers cannot claim the same request through this path.

Response is an array, empty when nothing is waiting:

```json
[
  {
    "requestId": "<Convex request ID>",
    "payload": {"name": "Demo"},
    "specSlug": "song-with-cover",
    "pipelineName": "song-with-cover"
  }
]
```

The claim mutation changes the stored request status to `possessed`.

## `POST /hooks/requests/report`

Example:

```json
{
  "id": "<requestId returned by claim>",
  "status": "processing",
  "node_states": {
    "node1": {
      "status": "running",
      "device": { "family": "cuda", "index": 0 },
      "artifacts": {"output": "/path/to/output"},
      "logs": ["Started"]
    },
    "node2": {
      "status": "running",
      "device": { "family": "cuda", "index": 0 }
    }
  }
}
```

Request statuses: `waiting`, `possessed`, `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`.

Node statuses in `node_states`: `queue`, `running`, `failed`, `succeeded`. A new state entry requires `status`; existing entries may omit it when updating device, artifacts, or logs. Optional `device` requires `family` and numeric `index`. Artifacts are a string-to-string map; logs are strings appended to the node's existing log history.

Success response: `{"ok":true}`.

## `GET /hooks/specs/{specSlug}`

Returns the exact stored YAML as `application/yaml; charset=utf-8`.

- `200`: YAML body.
- `401`: token missing, invalid, expired, or revoked.
- `404`: no spec with that slug.

## CORS and errors

Routes answer `OPTIONS` for browser/worker clients. The `/hooks/auth-tokens` root path and its child paths each have matching preflight routes. JSON errors have an `error` string and a 4xx status. Never include a configured secret in errors.
