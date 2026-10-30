# Worker HTTP API

This reference describes worker integration with MasterFlow, based on the router in [`convex/http.ts`](../convex/http.ts) and its underlying queries and mutations.

Worker routes use the **`/api/`** prefix. The previous `/hooks/` prefix has been replaced without compatibility aliases. Update worker URLs when deploying this backend version. Convex Auth routes remain unchanged.

## 1. Connection and authentication

### Base URL

Use the selected server profile's **Convex HTTP site URL**.

| Environment | Example HTTP site URL | Convex client/API URL (not for worker requests) |
| --- | --- | --- |
| Default self-hosted Docker | `http://127.0.0.1:3211` | `http://127.0.0.1:3210` |
| Convex Cloud | `https://<deployment>.convex.site` | `https://<deployment>.convex.cloud` |

Use `127.0.0.1` only when the worker shares the backend's host/network namespace. Remote workers need a reachable HTTP site address. `VITE_CONVEX_SITE_URL` can bootstrap the server profile during development.

The examples use `Host: localhost:3211`. Replace the host, `<UNIT_TOKEN>`, `<REQUEST_ID>`, and `<NOTIFICATION_ID>` with actual values. Transport headers such as `Content-Length` are calculated by the HTTP client/server and omitted here.

### Unit token

Create a token in **Settings → Unit tokens** in the desktop app. After Convex Auth sign-in, the desktop calls `unitTokens.list`, `unitTokens.create`, `unitTokens.update`, and `unitTokens.revoke` through the Convex client. There is no worker HTTP endpoint for token management, and workers do not need an admin key.

The browser generates a random 256-bit token, sends its SHA-256 hash to the backend, and displays the plaintext once. Keep the plaintext in the worker's secret configuration; never put it in source code, logs, or documentation. Authenticated deployment users share token management access.

Every `GET` and `POST` in this reference requires:

```http
Authorization: Bearer <UNIT_TOKEN>
```

The `Bearer ` prefix must match this format. Tokens must exist, be unrevoked, and be unexpired. Tokens are not bound to a specific `unitId`, spec, or request; the API does not verify request ownership by worker. The backend updates `lastUsedAt` at most approximately once per minute during valid token use.

For `POST`, send a JSON body with:

```http
Content-Type: application/json
Accept: application/json
```

`Accept` is recommended but not required by the router. For spec retrieval, use `Accept: application/yaml`; no request body or request `Content-Type` is needed. The router parses POST bodies with `request.json()`, so setting a header alone does not make an invalid body valid JSON.

### Endpoint overview

| Method | Path | Purpose | Successful response |
| --- | --- | --- | --- |
| `POST` | `/api/units/heartbeat` | Register or update a unit | `200`, JSON `{ "ok": true }` |
| `POST` | `/api/requests/claim` | Claim matching requests | `200`, JSON array |
| `GET` | `/api/specs/{specSlug}` | Retrieve the original YAML | `200`, YAML |
| `POST` | `/api/requests/report` | Update request and node state | `200`, JSON `{ "ok": true }` |
| `POST` | `/api/notifications/send` | Create a desktop notification | `200`, JSON with notification ID |
| `POST` | `/api/requests/create` | Create a waiting request only | `201`, JSON with request ID |
| `GET` | `/api/requests` | Inspect matching requests without updating them | `200`, JSON array |
| `OPTIONS` | The paths above | CORS preflight | `204`, no body |

Integration flow: register the unit with a heartbeat → claim work → fetch YAML using `specSlug` and select the returned `pipelineName` → execute the DAG → report progress/results. Send additional heartbeats to update presence and notifications as needed. The API does not prescribe a heartbeat or polling interval.

## 2. Register or update a unit — `POST /api/units/heartbeat`

Creates a unit if `unitId` is new, or updates the existing unit. Each successful call sets `lastSeen` to the server time in Unix milliseconds.

### Body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `unitId` | string | Yes | Must not be empty or whitespace-only; stable worker identifier. |
| `status` | string | Yes | `online` or `offline`. |
| `unitType` | string | No | Defaults to `"unknown"`. |
| `workingDir` | string | No | Defaults to `""`. |
| `devices` | array of objects | No | Defaults to `[]`; each item requires `family` (string) and `index` (number). |

All fields above are written on every heartbeat. Omitting `unitType`, `workingDir`, or `devices` writes the defaults, even for an existing unit. The code also treats `devices: null` as the default; prefer an array or omit the field. Device `index` is checked as a number, without a nonnegative-integer restriction.

### Example request

```http
POST /api/units/heartbeat HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "unitId": "mu-karen",
  "status": "online",
  "unitType": "Karen",
  "workingDir": "/worker/path",
  "devices": [
    { "family": "cuda", "index": 0 },
    { "family": "cuda", "index": 1 }
  ]
}
```

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"ok":true}
```

The response does not include the unit record or `lastSeen`. To mark the unit offline, call the same endpoint with `status: "offline"` and the unit details you want to retain.

### Errors

`401`: see [shared authentication errors](#7-errors-and-response-handling). `400`: invalid JSON/body, missing `unitId`, invalid status, or incorrect field types. Example:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"Invalid unit status"}
```

Other validation messages: `Request body must be an object`, `unitId is required`, `unitType must be a string`, `workingDir must be a string`, `devices must be an array`, `devices[0] must be an object`, and `devices[0] requires family and index` (the index identifies the affected item).

## 3. Claim work — `POST /api/requests/claim`

The unit must already be registered through a heartbeat. The mutation selects matching requests for `specSlug`, oldest first, changes their status to `possessed`, and records `unitId` and `claimedAt` in the same transaction. Selection and assignment are atomic. With `byStatus: "waiting"`, competing workers cannot claim the same waiting request. Broader filters may intentionally match and reassign a request after an earlier claim commits. A successful claim also updates the unit's `lastSeen`.

### Body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `unitId` | string | Yes | Must not be empty or whitespace-only; identifies a registered unit. |
| `specSlug` | string | Yes | Must not be empty or whitespace-only; identifies the spec. |
| `maxCount` | integer | No | From `1` to `100`; defaults to `1` when omitted or `null`. |

Claim selects requests by slug and the optional filters below. Omitted filters impose no restriction: **there is no default status filter**. Without `byStatus`, requests in any state can be claimed, including previously claimed or completed requests. All matches are changed to `possessed` and assigned to the receiving `unitId`.

| Optional body field | Type | Match |
| --- | --- | --- |
| `byPipeline` | non-empty string or string[] | Match any listed `pipelineName`. |
| `byStatus` | non-empty string or string[] | Match any listed status, including custom values. |
| `byUnitId` | non-empty string | Exact currently assigned `unitId`, before claim overwrites it. |

Claim accepts a string or a non-empty array (up to 100 non-empty strings) for
`byPipeline` and `byStatus`; duplicate values are ignored. Values combine with OR
within a filter, AND between filters. At most 100 distinct pipeline/status
combinations are allowed. Each combination uses its compound index; candidates
are merged oldest-first before the global `maxCount` limit, then claimed in the
same atomic mutation. Existing string callers retain their behavior.

Filters combine with AND and run through matching compound indexes before `maxCount` is applied. Omit a filter to disable it; `null`, empty strings, and whitespace-only strings are rejected. `unitId` is the receiving worker, while `byUnitId` filters the previous assignment. Requests without an assigned unit do not match a supplied `byUnitId`.

Claim does not filter by unit online status or spec enabled/archive flags. If no request matches, it returns `[]` rather than `404`. To claim only waiting work, explicitly send `"byStatus": "waiting"`.

### Example request

```http
POST /api/requests/claim HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "unitId": "mu-karen",
  "specSlug": "song-with-cover",
  "maxCount": 5,
  "byPipeline": "song-with-cover",
  "byStatus": "waiting"
}
```

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

[
  {
    "requestId": "<REQUEST_ID>",
    "payload": { "name": "Demo", "lyrics": "Example lyrics" },
    "specSlug": "song-with-cover",
    "pipelineName": "song-with-cover"
  }
]
```

| Field in each item | Meaning |
| --- | --- |
| `requestId` | Actual Convex request ID; use it as `id` when reporting. |
| `payload` | Original request input; may be any JSON value. |
| `specSlug` | Spec containing the execution configuration. |
| `pipelineName` | Pipeline to execute within the YAML; do not assume it equals the slug. |

The result may contain fewer than `maxCount` items. The response does not include `status`, `unitId`, or `claimedAt`, although these fields have been saved. With no matching work:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

[]
```

### Errors

`401`: shared token error. `400`: invalid JSON/body, missing `unitId` or `specSlug`, invalid filters or `maxCount`, or an unregistered unit. Example of direct validation:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"maxCount must be an integer from 1 to 100"}
```

Missing identifiers produce `unitId is required` or `specSlug is required`. Invalid filters produce `<field> is required`. An unregistered unit causes the mutation to report `Register this unit with a heartbeat before claiming work`; the returned `error` may include Convex error context.

Claim changes stored data: calling it again re-evaluates the filters. With `byStatus: "waiting"`, it claims additional waiting requests; without a status filter it may return and reassign previously claimed requests. If a response is lost after the transaction commits, the API has no idempotency or automatic reclaim mechanism to return the same batch.

## 4. Retrieve configuration — `GET /api/specs/{specSlug}`

Returns the exact YAML string stored in `specs.yaml`, preserving its configuration and formatting.

### Path and example request

`specSlug` is required and must be URL-encoded as one path segment, for example with `encodeURIComponent(specSlug)`. Do not append a trailing `/` or extra path segments. The endpoint does not process query parameters or accept a request body.

```http
GET /api/specs/song-with-cover HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Accept: application/yaml
```

### Successful response

The following body illustrates stored YAML; the actual response contains the requested spec's YAML.

```http
HTTP/1.1 200 OK
Content-Type: application/yaml; charset=utf-8
Content-Disposition: inline; filename="song-with-cover.yaml"
Access-Control-Allow-Origin: *
Cache-Control: no-store

pipeline:
  song-with-cover:
    params:
      name: { type: string }
      lyrics: { type: string }
    nodes:
      - name: generate-song
        run:
          workload: yue2
      - name: generate-cover
        run:
          workload: qwen-image
```

A pipeline is a DAG. Follow its actual `depends_on` configuration rather than treating node order as mandatory execution order. See [Spec YAML](spec-yaml.md).

The query looks up the slug without excluding archived or disabled specs. An archived spec whose record still exists can be retrieved through this API.

### Errors

`401`: shared token error (JSON). `400`: missing slug, extra path segments, invalid URL encoding, or retrieval errors. `404`: no spec record exists for the slug.

```http
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"Spec not found"}
```

Path errors return `400` with `{"error":"specSlug is required"}` or `{"error":"Invalid specSlug encoding"}` and the same JSON headers above. Check the HTTP status before parsing YAML because error responses are JSON.

## 5. Report execution — `POST /api/requests/report`

Updates overall status and/or per-node state for an existing request. The HTTP field is **`node_states`**; the backend stores it as `requests.nodeStates`.

### Body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | string | Yes | Convex request ID from claim's `requestId`; must be valid and refer to an existing request. |
| `status` | string | No | One of the request statuses below; omit to retain the existing value. |
| `node_states` | object | No | Map of node names to state updates; omit to retain existing states. |

Accepted request statuses:

| Value | Intended meaning |
| --- | --- |
| `waiting` | Waiting for a worker to claim it. |
| `possessed` | Claimed by a worker. |
| `processing` | Execution in progress. |
| `process_failed` | Execution failed. |
| `artifact_available` | An artifact is available for retrieval. |
| `retrieve_artifact_failed` | Artifact retrieval failed. |
| `succeeded` | Completed successfully. |

The router validates status values but does not enforce a transition order. A report containing only a valid `id` is accepted. Reports do not update the unit heartbeat.

Each `node_states[<nodeName>]` entry accepts:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `status` | string | When creating a new state | `queue`, `running`, `failed`, or `succeeded`; omit for an existing state to retain its status. |
| `device` | object | No | Requires `family` (string) and `index` (number). |
| `artifacts` | object | No | String-to-string map, such as output name → path or URL. |
| `logs` | string[] | No | New log lines to append. |

Use YAML node names so the desktop can display states correctly; the API does not validate names against the DAG. Unreported nodes retain their states. For reported nodes, omitted fields retain existing values; supplied `device` and `artifacts` replace those fields entirely, while `logs` are **appended**. Do not use `null` to clear fields. Reporting only stores artifact string metadata; it does not upload or download artifacts.

### Example request: progress and node state

```http
POST /api/requests/report HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "id": "<REQUEST_ID>",
  "status": "processing",
  "node_states": {
    "generate-song": {
      "status": "running",
      "device": { "family": "cuda", "index": 0 },
      "artifacts": { "output": "/worker/output/song.wav" },
      "logs": ["Started"]
    },
    "generate-cover": {
      "status": "queue"
    }
  }
}
```

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"ok":true}
```

### Example request: completing existing nodes

```http
POST /api/requests/report HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "id": "<REQUEST_ID>",
  "status": "succeeded",
  "node_states": {
    "generate-song": {
      "status": "succeeded",
      "logs": ["Finished"]
    },
    "generate-cover": {
      "status": "succeeded",
      "artifacts": { "output": "/worker/output/cover.png" }
    }
  }
}
```

The response is again `200` with the same headers and `{"ok":true}` shown above. After both reports, `generate-song` has logs `["Started", "Finished"]`; its device and artifacts remain unchanged. For an existing node, you may send only `logs` to append lines without changing its status.

### Errors

`401`: shared token error. `400`: invalid JSON/body, invalid or nonexistent request ID, invalid status, malformed node state, or missing status for a new state. The current handler does not return a separate `404` for nonexistent requests.

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"Node \"generate-song\" has an invalid status"}
```

Other direct validation errors: `id is required`, `Invalid status: <value>`, `node_states must be an object`, `Node "<name>" has an invalid structure`, `Node "<name>" has an invalid device`, `Node "<name>" has invalid artifacts`, and `Node "<name>" has invalid logs`. The mutation may report `Request not found` or `Node "<name>" requires a status when created`, with Convex context.

Resending a report with the same `logs` appends duplicate lines. Account for this when automatically retrying after a timeout.

## 6. Send a notification — `POST /api/notifications/send`

Creates a notification delivered to the desktop through its Convex subscription. New notifications use an in-app toast while the window is visible and focused; when unfocused, the app uses system notifications if permission has been granted. The Notifications page shows the newest 100 active notifications and supports marking them read or dismissing them.

### Body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `title` | string | Yes | Must not be empty or whitespace-only. |
| `message` | string | Yes | Must not be empty or whitespace-only. |
| `tags` | string[] | No | May be omitted or `[]`; must not be `null`. |

`title` and `message` are checked with `trim()` but stored as originally supplied. The backend adds `createdAt` using server time.

### Example request

```http
POST /api/notifications/send HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "title": "Job complete",
  "message": "The export finished successfully.",
  "tags": ["export", "success"]
}
```

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"success":true,"notificationId":"<NOTIFICATION_ID>"}
```

`notificationId` is the newly created notification's Convex ID. The response confirms record creation, not that the desktop or OS displayed it. Repeating the call creates another notification; there is no idempotency key.

### Errors

`401`: shared token error. `400`: invalid JSON, a non-object body, missing title/message, or incorrect tags. Example:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"title is required"}
```

Other validation messages: `Request body must be an object`, `message is required`, and `tags must be an array of strings`.

## 7. Errors and response handling

JSON responses created by worker handlers include:

```http
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store
```

Error bodies use `{ "error": "<message>" }`. GET/POST handlers validate the token before processing the body or path. All token errors use this response:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"Unauthorized: provide an active unit token"}
```

| Status | Condition | Recommended handling |
| --- | --- | --- |
| `201` | Request created successfully. | Read the returned `requestId`. |
| `200` | Endpoint completed successfully. | Parse JSON or YAML according to the endpoint and `Content-Type`. |
| `204` | Successful OPTIONS preflight. | Do not parse a body. |
| `400` | Invalid JSON/validation or an error caught by the handler. | Inspect `error` and correct the cause before retrying. |
| `401` | Missing, invalid, expired, or revoked token. | Check the header and token; replace the token if necessary. |
| `404` | GET spec could not find the slug. | Check the slug; do not parse the response as YAML. |

Direct validation messages in the examples come from the router. JSON parser and query/mutation errors may vary by runtime or include Convex context; do not treat the complete `error` string as a stable error code. Backend/infrastructure errors outside these examples, such as failures before a `try` block or unregistered paths/methods, may use a different response format.

## 8. CORS — `OPTIONS`

Every worker endpoint in the overview has a corresponding OPTIONS handler. Specs use the `/api/specs/` prefix handler. Preflight requires neither a bearer token nor a body. Example for reporting:

```http
OPTIONS /api/requests/report HTTP/1.1
Host: localhost:3211
Origin: https://worker.example
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization,content-type
```

Response:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization,content-type
Access-Control-Allow-Methods: GET,POST,OPTIONS
```

There is no response body. The preflight handler does not set `Content-Type` or `Cache-Control`. CORS does not configure cookie credentials or `Access-Control-Expose-Headers`; reading `Content-Disposition` from browser JavaScript would require additional backend configuration to expose that header.

## 9. Quick checks with cURL

Set `CONVEX_SITE_URL` to the HTTP site URL without a trailing slash, and load `UNIT_TOKEN` into the shell environment from the worker's secret configuration. Do not put real tokens in documentation or commit scripts containing them.

```sh
export CONVEX_SITE_URL='http://127.0.0.1:3211'

curl --include --request POST "$CONVEX_SITE_URL/api/units/heartbeat" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"unitId":"mu-karen","status":"online","unitType":"Karen","workingDir":"/worker/path","devices":[{"family":"cuda","index":0}]}'

curl --include --request POST "$CONVEX_SITE_URL/api/requests/claim" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"unitId":"mu-karen","specSlug":"song-with-cover","maxCount":1,"byStatus":"waiting"}'

curl --include --request GET "$CONVEX_SITE_URL/api/specs/song-with-cover" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Accept: application/yaml'

# Replace <REQUEST_ID> with the actual requestId returned by claim.
curl --include --request POST "$CONVEX_SITE_URL/api/requests/report" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"id":"<REQUEST_ID>","status":"processing","node_states":{"generate-song":{"status":"running","logs":["Started"]}}}'

curl --include --request POST "$CONVEX_SITE_URL/api/notifications/send" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"title":"Worker ready","message":"mu-karen is ready.","tags":["worker"]}'
```

`--include` displays the HTTP status and response headers for comparison with the examples. Programs should handle HTTP errors explicitly; by default, cURL does not treat an HTTP `4xx` response as a nonzero exit code.


## 10. Create a request — `POST /api/requests/create`

Creates exactly one request in `waiting` state. It does not claim the request, assign a unit, execute a pipeline, update unit presence, or send a notification. A heartbeat is not required. As with other endpoints, token authentication may update token usage metadata.

### Body

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `specSlug` | string | Yes | Non-empty, not whitespace-only; must identify an existing spec. |
| `pipelineName` | string | Yes | Non-empty, not whitespace-only; must identify a pipeline defined in the spec YAML. |
| `payload` | any JSON value | Yes | Original request input; `null` is allowed, but omitting the field is not. |

The endpoint shares creation logic with the desktop. Existing archived/disabled specs are not excluded. Status, unit assignment, and node states cannot be supplied through this endpoint; extra fields are ignored. Each successful call creates a new request, so retries after a lost response can create duplicates.

### Example request

```http
POST /api/requests/create HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Content-Type: application/json
Accept: application/json

{
  "specSlug": "song-with-cover",
  "pipelineName": "song-with-cover",
  "payload": { "name": "Demo", "lyrics": "Example lyrics" }
}
```

### Successful response

```http
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"requestId":"<REQUEST_ID>"}
```

`requestId` is the new Convex request ID. The saved request has `status: "waiting"`, without `unitId`, `claimedAt`, or `nodeStates`.

### Errors

`401`: shared token error. `400`: malformed JSON/body, missing required fields, nonexistent spec, undefined pipeline, or invalid stored YAML. Direct field errors include `specSlug is required`, `pipelineName is required`, and `payload is required`. Mutation errors may include Convex context.

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"payload is required"}
```

### cURL

```sh
curl --include --request POST "$CONVEX_SITE_URL/api/requests/create" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"specSlug":"song-with-cover","pipelineName":"song-with-cover","payload":{"name":"Demo"}}'
```

## 11. Inspect requests — `GET /api/requests`

Reads matching requests without changing request status, assignment, claim timestamps, node states, or unit presence. No heartbeat or receiving `unitId` is required. Token authentication may still update token usage metadata. Results are a snapshot; inspection does not reserve work and another worker can claim it immediately afterward.

### Query parameters

| Parameter | Type | Required | Rules |
| --- | --- | --- | --- |
| `specSlug` | string | Yes | Non-empty, not whitespace-only; exact spec slug. |
| `maxCount` | integer | No | `1`–`100`; defaults to `1`. Use decimal digits in the URL. |
| `byPipeline` | string | No | Exact pipeline name. |
| `byStatus` | string | No | Exact stored status; accepts any non-empty string. No default status filter. |
| `byUnitId` | string | No | Exact currently assigned unit ID. |

Optional filters combine with AND, and omitted filters impose no restriction. Supplied filters must be non-empty and not whitespace-only. Each recognized parameter must occur at most once; repeated parameters return `400`. Unknown query parameters are ignored. URL-encode parameter values; do not send a request body.

Results are oldest first, limited after all filters are applied through compound indexes. A nonexistent slug or no matching requests returns `200` with `[]`.

### Example request

```http
GET /api/requests?specSlug=song-with-cover&maxCount=5&byPipeline=song-with-cover&byStatus=processing&byUnitId=mu-karen HTTP/1.1
Host: localhost:3211
Authorization: Bearer <UNIT_TOKEN>
Accept: application/json
```

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

[
  {
    "requestId": "<REQUEST_ID>",
    "payload": { "name": "Demo", "lyrics": "Example lyrics" },
    "specSlug": "song-with-cover",
    "pipelineName": "song-with-cover",
    "status": "processing",
    "unitId": "mu-karen"
  }
]
```

The first four fields match the claim response. Inspection additionally returns stored `status` and optional `unitId` (omitted for unassigned requests). It does not include node states or claim timestamps. Claim's response shape remains unchanged.

With no matches:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

[]
```

### Errors

`401`: shared token error. `400`: missing slug, invalid/empty filters, invalid limits, or duplicate recognized query parameters. Filter errors use `<field> is required`; duplicate errors use `<field> must occur only once`.

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Cache-Control: no-store

{"error":"maxCount must be an integer from 1 to 100"}
```

### cURL

```sh
curl --include --get "$CONVEX_SITE_URL/api/requests" \
  --header "Authorization: Bearer $UNIT_TOKEN" \
  --header 'Accept: application/json' \
  --data-urlencode 'specSlug=song-with-cover' \
  --data-urlencode 'maxCount=5' \
  --data-urlencode 'byPipeline=song-with-cover' \
  --data-urlencode 'byStatus=processing' \
  --data-urlencode 'byUnitId=mu-karen'
```

Both new paths support the same unauthenticated OPTIONS preflight documented above. The create endpoint adds `201 Created` to the shared status conventions.


## Mu CLI integration

`mu master-flow run <spec-slug>` resolves `--server` / `--token` ahead of
`MU_MASTER_FLOW_SERVER` / `MU_MASTER_FLOW_TOKEN`. Server means HTTP site URL.
The worker heartbeats online, fetches YAML once, runs master_flow initialization,
claims and executes a batch, reports overall status, runs finalization and
heartbeats offline. `--refresh-loop` drains batches until `[]`; failed batches
stop the loop. `--batch-size` defaults to 1, maximum 100. Repeat `--by-pipeline`
and `--by-status` for OR filters. Mu defaults to `byStatus: ["waiting"]` even
though the raw HTTP API has no default status filter. `--unit-id` defaults to
hostname; `--unit-type` defaults to unknown. Claim is not automatically retried.
