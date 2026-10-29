# Worker HTTP hooks

Every hook request requires:

```http
Authorization: Bearer <MASTERFLOW_HOOK_TOKEN>
Content-Type: application/json
```

Configure `MASTERFLOW_HOOK_TOKEN` in the Convex deployment environment. Never put it in frontend source or commit it. Paths below are relative to the Convex HTTP site URL (`VITE_CONVEX_SITE_URL` locally).

## `POST /hooks/units/heartbeat`

Register or refresh a unit. `unitId` is required. `status`, `unitType`, `workingDir`, `devices`, and `specSlugs` are accepted; `workloads` and `metadata` are optional extension fields. `specSlugs` lists spaces this unit may claim. Omitted `specSlugs` defaults to `[]`, so the unit cannot claim until it registers the target slug.

```json
{
  "unitId": "mu-karen",
  "status": "online",
  "unitType": "Karen",
  "workingDir": "/worker/path",
  "specSlugs": ["song-with-cover"],
  "devices": [
    {"family": "cuda", "index": 0, "maxUnits": 4},
    {"family": "cuda", "index": 1, "maxUnits": 2}
  ],
  "workloads": ["yue2"],
  "metadata": {"workerVersion": "1.0.0"}
}
```

Response: `{"ok":true}`. If a unit has active requests, its stored status remains `busy` even if heartbeat says `online`.

## `POST /hooks/requests/claim`

Request:

```json
{"unitId":"mu-karen","specSlug":"song-with-cover","maxCount":5,"status":"waiting"}
```

`unitId` and `specSlug` are required. `maxCount` defaults to 1 and must be an integer from 1 to 100. `status` is optional and, when supplied, must be `waiting`. The unit must have registered the slug in heartbeat.

The Convex mutation uses `by_spec_slug_and_status` and changes selected records from `waiting` to `possessed` atomically before returning, so competing workers cannot claim the same request through this path.

Response is an array, empty when nothing is waiting:

```json
[
  {
    "requestId": "<Convex request ID>",
    "params": {"name": "Demo"},
    "specSlug": "song-with-cover",
    "pipelineName": "song-with-cover",
    "status": "received",
    "plan": []
  }
]
```

Compatibility distinction: the stored request status is `possessed`; the claim response says `received` to match the worker response contract.

## `PUT /hooks/requests/update`

Example:

```json
{
  "id": "<requestId returned by claim>",
  "status": "processing",
  "node_states": {
    "node1": {
      "status": "running",
      "device": { "family": "cuda", "index": 0 }
    },
    "node2": {
      "status": "running",
      "device": { "family": "cuda", "index": 0 }
    }
  }
}
```

Request statuses: `waiting`, `possessed`, `processing`, `process_failed`, `artifact_available`, `retrieve_artifact_failed`, `succeeded`.

Node statuses in `node_states`: `queue`, `running`, `failed`, `succeeded`. Each state entry requires `status`. Optional `device` currently requires `family` and numeric `index` at the HTTP boundary.

Success response: `{"ok":true}`. Terminal request states `process_failed`, `retrieve_artifact_failed`, and `succeeded` clear the request from the unit's active request IDs. `artifact_available` is nonterminal because artifact retrieval may still be in progress.

## `GET /hooks/specs/{specSlug}`

Returns the exact stored YAML as `application/yaml; charset=utf-8`.

- `200`: YAML body.
- `401`: token missing/invalid or `MASTERFLOW_HOOK_TOKEN` is not configured.
- `404`: no spec with that slug.

## CORS and errors

Routes answer `OPTIONS` for browser/worker clients. JSON errors have an `error` string and a 4xx status. Never include the configured token in errors.
