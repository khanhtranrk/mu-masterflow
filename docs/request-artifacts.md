# Request artifacts

Artifacts belong to a request in `requests.artifacts[]`. File bytes live in Convex File Storage; the request stores metadata and a `storageId`, never a persisted download URL. No separate application file table is needed. `artifactUploads` holds upload receipts, not the artifact list.

## Stored shape

```json
{
  "artifacts": [{
    "id": "render:output",
    "nodeName": "render",
    "name": "song.wav",
    "label": "Generated song",
    "storageId": "<STORAGE_ID>",
    "contentType": "audio/wav",
    "size": 8451230,
    "createdAt": 1793422800000
  }]
}
```

`id` is stable within a request and identifies one logical output; choose a different ID to retain multiple versions. `nodeName` and `label` are optional. Node names are annotations, not validated against the current YAML, so later spec edits do not hide historical outputs. Names must be file basenames without slashes. Text fields reject control characters and exceed neither 255 characters nor 128 for the artifact ID. `contentType`, byte `size` and Unix-millisecond `createdAt` come from the backend. Missing `artifacts` means an empty list, preserving old requests. At most 100 artifacts are allowed per request to keep the document bounded; request payload/logs still share Convex's document-size limit.

Only uploaded, completed files appear here. Uploading a file does not change request or node execution status. Workers should report status separately. Duplicating a request copies its input payload, not its artifacts. Desktop uploads attach to the whole request with a new random artifact ID; worker uploads can specify a node and stable ID.

## Upload: three requests

All application worker endpoints below use the HTTP **site** URL and an active `Authorization: Bearer <UNIT_TOKEN>`. Worker tokens have the same deployment-wide access as the existing worker API; they are not scoped to units or individual requests. An upload receipt, however, can only be completed using the same token that created it. Desktop receipts are bound to the authenticated user and cannot be completed through worker endpoints.

Before starting, calculate the file's SHA-256 and byte size. Keep the file unchanged during the flow.

1. `POST /api/requests/artifacts/upload-url`:

   ```json
   {"requestId":"<REQUEST_ID>","artifactId":"render:output","sha256":"<64_LOWERCASE_HEX_CHARACTERS>","size":8451230}
   ```

   `size` accepts a nonnegative safe integer or a canonical decimal string such as `"8451230"` (convenient for Mu command stdout). No fractional, signed, whitespace or exponential string formats. The response is `200`:

   ```json
   {"uploadId":"<UPLOAD_ID>","uploadUrl":"<NATIVE_CONVEX_UPLOAD_URL>","expiresAt":1793426400000}
   ```

2. `POST` raw file bytes to the returned `uploadUrl`, with the actual file MIME type in `Content-Type` (or `application/octet-stream`). **Do not send the worker token or desktop session to this URL.** It is a bearer upload capability, not an application API endpoint. Convex returns `{"storageId":"<STORAGE_ID>"}`. Use the returned URL unchanged: its host/port may differ from the HTTP site URL. Both worker and desktop must be able to reach it.
3. `POST /api/requests/artifacts/complete`:

   ```json
   {"requestId":"<REQUEST_ID>","uploadId":"<UPLOAD_ID>","storageId":"<STORAGE_ID>","name":"song.wav","nodeName":"render","label":"Generated song"}
   ```

   Response: `200`, `{"artifact":{...}}` using the stored shape above. `nodeName` and `label` may be omitted.

The upload URL and receipt expire after one hour. Native upload has no application file-size cap, but Convex documents a two-minute upload POST timeout; increasing Mu's timeout does not override server/proxy deadlines. Completion checks caller, request, expiry, file existence, file creation time (no older than the receipt), expected SHA-256 and size, and an exclusive storage binding. These checks attest to the declared content; the native upload capability itself is not bound to a particular request by Convex. Other known storage IDs cannot be attached unless they satisfy the content/time checks and are unbound.

Completion atomically upserts one artifact by its logical `id`, preserving siblings when concurrent nodes complete. Completing the same receipt/storage ID again returns the saved artifact without changes, even after expiry. A completed receipt cannot be reused for another file or replayed over a later replacement. When a new receipt replaces an existing artifact ID, last successful completion wins and the old file is deleted in the same mutation. Never reuse a storage ID across artifacts; copy/reupload bytes instead.

If byte upload fails, retry it while the receipt is valid. If completion's response is lost, retry **completion with the same IDs**, not byte upload. If the receipt expires before completion, start a new flow. A new upload may produce a new file even for identical content.

## Download

Two worker endpoints accept URL-encoded `requestId` and `artifactId` query parameters:

- `GET /api/requests/artifacts/download?requestId=<REQUEST_ID>&artifactId=render%3Aoutput` checks the unit token on every request and returns file bytes with attachment disposition, original filename, MIME type, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Files over 100 MiB return `413`; use the URL endpoint for those.
- `GET /api/requests/artifacts/download-url?requestId=<REQUEST_ID>&artifactId=render%3Aoutput` returns `200`, `{"url":"<DOWNLOAD_URL>","name":"song.wav","contentType":"audio/wav","size":8451230}`. Fetch the returned URL without the worker token.

**Direct storage download URLs are bearer links without automatic app-level expiry.** Anyone holding one can download without logging in; token revocation or soft-deleting a request does not invalidate an already shared link. Deleting/replacing the stored file invalidates its old link. Use the authenticated byte endpoint when each access must be checked; do not expose direct URLs for that use case. A deployment's network/reverse-proxy limits may be stricter than Convex's limits.

Desktop queries/mutations `requestArtifacts.startUpload`, `completeUpload` and `urls` require a verified Clerk identity and backend whitelist access. Each expanded request contains a separate **Artifacts** disclosure, collapsed initially, showing the total file count. Expanding it shows the common artifact list, filename, size and optional node. Nodes display a clickable artifact count instead of duplicating file details. Clicking a graph count or the selected node's count opens the common list, selects that node, pauses execution following, scrolls to the first matching file and highlights every referenced artifact while keeping other files visible. **Clear highlight** removes the emphasis. Highlights remain attached to the chosen node during reactive updates; counts include registered files only. The disclosure and highlight state are independent per expanded request. **Upload file** performs the same three steps; the desktop hashes the selected file in memory, so use Mu for very large files. **Download** opens a direct storage bearer link. Sensitive deployments should account for this explicit sharing model.

`GET /api/requests` and `POST /api/requests/claim` include optional `artifacts` metadata with each request. They do not include download URLs. Old requests may omit this field. Mu makes claimed metadata available in `request`, so an artifact ID can be selected from `request.artifacts`; newly completed artifacts are delivered reactively to the desktop, not written back into an already-running Mu context. Use the known artifact ID for subsequent API calls.

## Errors, retention and compatibility

Application endpoints return `401` for missing/revoked/expired tokens; registration returns `400` for invalid/mismatched/expired receipts, absent or soft-deleted requests, invalid metadata, or a full artifact list. Download returns `404` for missing/soft-deleted requests, absent artifacts or missing storage bytes, and `400` for malformed arguments. All four routes support `OPTIONS` with `204`. Native upload errors come from Convex Storage and can differ from application JSON errors.

Soft deletion of a request retains its artifacts and bytes. It blocks new upload receipts, completion and new download lookups, including authenticated byte downloads; it does not revoke previously issued bearer links. Spec archival also retains requests and files. Artifact receipts are retained for exclusive binding and idempotency; there is no automatic retention or garbage-collection job in this version. Failed/abandoned direct uploads can leave unreferenced files, and incomplete receipts remain in the database. Review those through the Convex dashboard and delete only files proven unreferenced. Do not bulk-delete storage merely because a file has no receipt: another feature might use it. A future permanent request purge must delete its files and receipts deliberately.

`nodeStates.<node>.artifacts` is retained as an optional array using **the same artifact validator and metadata shape** as `requests.artifacts[]`. It references registered request files; it does not own another storage object. Legacy string maps are no longer accepted by the schema or report API. Local data was checked before this rollout and had no such maps. Other deployments with old maps must migrate them before applying the strict schema: preserve old paths separately, upload the actual files through a compatible intermediate deployment, and replace each map with registered metadata arrays. A local path/URL cannot be converted into a valid storage ID without uploading its bytes. Never silently discard historical maps or invent storage IDs.

`POST /api/requests/report` accepts `node_states.<name>.artifacts: [...]`. Each entry must exactly match an artifact already registered on that request, including ID, storage ID, name, MIME type, size, timestamp and optional label/node name. If the registered artifact declares `nodeName`, it must match the reported node. Duplicate IDs, unregistered storage IDs, forged metadata and legacy maps are rejected atomically. The same validation runs in `requests.report` even when called internally. Reports cannot register new files or overwrite top-level `requests.artifacts`; a top-level `artifacts` report property is rejected with instructions to use completion.

For an existing node, omitting `artifacts` retains its array; supplying an array replaces its node references. `[]` clears node references without deleting the request artifact or file. A newly reported node must include a valid status; when its artifacts are omitted, it inherits request artifacts whose `nodeName` matches. Upload completion refreshes/adds references on already-reported matching nodes, preserves all other node fields, and never creates a new runtime status. Replacing a file updates existing node references before deleting old bytes; moving an artifact to a different node removes its old node reference. Unassigned artifacts may be referenced by multiple nodes in the same request. Repeat completion returns the previous result and does not undo later node report choices.

`requests.update` still changes only payload/status, `editPayload` only validated waiting payload, `units.claim` only assignment/status, and `requests.remove` only soft-deletion time: all preserve request and node artifact arrays. `requests.report` appends logs, retains omitted device/status fields and keeps accepting in-flight reports for soft-deleted requests. Desktop and worker creation reject archived specs.

For self-hosting, persist and back up both database data and file storage. Configure the backend's advertised API origin and reverse proxy so native upload/download URLs are reachable from remote workers. See [development](development.md) and the [official Convex storage guide](https://docs.convex.dev/file-storage).

## Mu integration

`send_http_request` uses `body_file` for raw streaming upload, `response_file` for atomic streaming download, and optional positive `timeout` in seconds (default 30). JSON `body` and `body_file` are mutually exclusive. File paths are relative to the worker working directory unless absolute. A download keeps `body: null` and saves `response_file` and `size` in its action result; HTTP errors keep their JSON/text error body and never replace the destination.

The companion Mu repository includes a CPU-only executable example at `examples/master-flow-artifacts/spec.yaml`, plus its action contract in `docs/spec-format/04-actions.md`. It creates a tiny JSON artifact, calculates its digest and size, uploads it, completes registration, downloads the same bytes through the authenticated endpoint, and compares the files. Configure credentials outside the spec. Never run this example against a request you do not intend to modify.
