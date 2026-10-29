# Worker HTTP hooks

Worker hook requests require a Unit token created in the desktop Unit tokens page. Token management uses the normal Convex client API; worker hook endpoints remain HTTP actions.

```http
Authorization: Bearer <worker-auth-token>
Content-Type: application/json
```

Worker tokens are stored as hashes; plaintext is generated in the browser and shown only at creation time. Never commit or log plaintext tokens. Paths below are relative to the HTTP site URL of the currently selected Convex server profile (`VITE_CONVEX_SITE_URL` can optionally bootstrap this profile for local development).

## Unit token management

The desktop calls the public Convex functions `unitTokens.list`, `unitTokens.create`, `unitTokens.update`, and `unitTokens.revoke` directly after Convex Auth sign-in. No admin key or token-management HTTP route is required. Any authenticated user on the deployment can manage Unit tokens, so use this setup only where shared access is acceptable.

The browser generates a cryptographically random 256-bit token, computes its SHA-256 hash, and sends only the hash to `unitTokens.create`. The plaintext is shown once and cannot be recovered from the token list. Store it in the Unit's secret configuration.

## `POST /hooks/notifications/send`

Create a notification that is delivered reactively to the desktop app. The request requires an active worker bearer token and a JSON body with non-empty `title` and `message` strings. `tags` is optional and must be an array of strings.

```json
{
  "title": "Job complete",
  "message": "The export finished successfully.",
  "tags": ["export", "success"]
}
```

Success response (`200`):

```json
{"success":true,"notificationId":"<Convex notification ID>"}
```

An invalid body returns `400` with an `error` string. Missing, invalid, expired, or revoked bearer tokens return `401`. The desktop displays new notifications in-app while focused and uses a system notification while unfocused if the user has granted notification permission. The Notifications page lists the most recent 100 active notifications; users can mark them read or dismiss them.

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

Worker hook routes answer `OPTIONS` for browser/worker clients. JSON errors have an `error` string and a 4xx status.
