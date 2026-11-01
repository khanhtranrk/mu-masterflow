# Request artifacts and storage connections

Artifacts use private Supabase Storage or Cloudflare R2 buckets through the same S3-compatible handler. Convex authorizes operations, stores metadata and signs URLs. File bytes never pass through Convex HTTP actions. Existing Convex files remain readable through a transitional `convex-legacy` handler.

## Data model

The authoritative `artifacts` table stores `artifactId`, `requestId`, `handler`, and handler-specific `metadata`. `(requestId, artifactId)` is unique through an indexed transactional lookup. The same artifactId may occur in different requests. Metadata includes the stable connection ID and object key for S3, or storageId for legacy files, plus filename, MIME type, byte count, creation time, optional node/label and run generation. No signed URLs are stored.

Requests and node states retain compatibility projections for the existing graph, reports and CLI. These snapshots are updated transactionally with the canonical artifact record; they are not independent storage configuration. The desktop artifact disclosure queries the canonical table, falling back to existing legacy snapshots during migration. A future wire-version migration can reduce node snapshots to IDs without changing storage handlers.

`storageConnections` records have a unique immutable `connectionId` such as `r2-1` or `supabase-1`. Provider, endpoint, region, bucket and prefix cannot be repointed under an existing ID. Create a new connection for a different location; credentials and display name can be updated under the same ID. Connections are disabled rather than removed or reused. Changing the default only changes future upload sessions.

`storageSettings` contains the application owner's Clerk subject and the default connection ID. `storageUploads` records bind each upload to its request, artifactId, connection, caller, request reset version, worker assignment version, server-generated keys, expected size, declared checksum and expiry. Deletion tombstones are retained to prevent an old completion/report from restoring a deleted record. There is a limit of 100 logical artifact IDs (including tombstones) per request and 20 simultaneously pending uploads per request.

## Authorization

- A valid Clerk identity must also pass the deployment whitelist.
- Only the configured application owner can manage connections, worker tokens, or remove artifact records.
- Worker tokens are bound to an immutable `unitId` and owner-configured `specSlugs`. Existing tokens without these settings cannot bootstrap or claim work until the owner updates them.
- Heartbeat must use the token's unit ID. Tokens cannot take over another active token's unit. Revoke the old token before rotation to another token for the same unit.
- Claim only selects `waiting` requests from allowed specs. Assignment stores the actual token ID and increments `assignmentVersion` atomically.
- Upload, completion, download and report require the assigned token and current assignment generation. Workers cannot replace an artifact from the same run, delete records, manage storage, create requests or inspect arbitrary requests. A rerun may publish the same logical artifact ID for a new request reset generation; old bytes are retained.
- Heartbeat, fetching explicitly allowed specs and worker notifications remain bootstrap/telemetry capabilities needed by the worker lifecycle.
- Soft-deleted requests deny new artifact access, while reports from their already assigned worker remain accepted. Reset/reassignment invalidates old uploads and reports.

## Direct transfer protocol

Worker calls below use `Authorization: Bearer <UNIT_TOKEN>`. Request-specific artifact calls and reports also send `X-Mu-Assignment-Version: <assignmentVersion from claim>`. The updated Mu runtime supplies that header automatically for action requests to its configured MasterFlow origin.

`POST /api/requests/artifacts/upload-url` accepts:

```json
{"requestId":"<id>","artifactId":"audio","connectionId":"r2-1","size":123,"sha256":"<64 lowercase hex characters>","contentType":"audio/wav"}
```

`connectionId` and `contentType` are optional; the backend default and `application/octet-stream` apply. The backend returns:

```json
{"uploadId":"<id>","uploadUrl":"<presigned URL>","method":"PUT","headers":{"Content-Type":"audio/wav"},"expiresAt":1234567890000}
```

Upload raw bytes using exactly the method and headers. Do not send a Clerk JWT or unit token to storage. Browser fetch supplies Content-Length from its File/Blob; Mu sets it from the local file. Size and content type are signed into the PUT. The storage PUT response is not expected to contain JSON or a Convex storageId.

`POST /api/requests/artifacts/complete` accepts `requestId`, `uploadId`, `name`, and optional `nodeName`/`label`. It returns `{artifact: <compatibility projection>}`. The backend checks the staged object's size/ETag using HEAD, reserves completion details transactionally, performs conditional server-side CopyObject to a distinct final key, checks the destination size and commits metadata. Retry with identical details is idempotent. Reusing the staging PUT cannot modify the finalized object. SDK/provider errors are not returned with credential-bearing request details.

The declared SHA-256 is not treated as independently verified integrity: HEAD/ETag do not prove a SHA-256 digest. The migration utility explicitly downloads and hashes the staged destination before committing the switch. Do not build security decisions on worker-reported checksums.

`GET /api/requests/artifacts/download-url?requestId=<id>&artifactId=<id>` returns `url`, `expiresAt`, `name`, `contentType`, `size`, `legacy`. The old `/download` path now returns the same JSON response, not bytes. Follow the URL in a separate unauthenticated request; no proxy or credential-forwarding redirect is used.

Presigned PUTs last 15 minutes; GETs last 5 minutes. URLs are bearer capabilities reusable until expiry. Deleting a record, disabling a connection, signing out or revoking a token prevents future URL issuance, but does not revoke URLs already issued. Legacy URLs are not expiring and return `expiresAt: null, legacy: true`.

The Tauri Download button opens a native save dialog and streams storage bytes directly into a local temporary file, checking the expected byte count before replacing the selected destination. Cancellation, storage errors and successful saves are shown in the artifact panel. No system browser is required. Restart/rebuild the native app after adding this command; a frontend reload alone cannot install Rust commands. Web downloads continue opening the issued URL in a separate tab.

Each artifact has a **View** button; **Download** is in its three-dot menu, alongside owner-only record removal. View opens a modal with image, audio/video, plain-text/JSON or PDF content. HTML and SVG are displayed as escaped text, never embedded documents. Text previews show at most the first 1 MiB; PDF previews support up to 16 MiB and render pages on canvas with a lazy-loaded PDF.js viewer. Other file types and unsupported media codecs offer a download fallback. Closing the modal stops media and cancels browser fetches; Refresh preview obtains a fresh authorized URL.

Text/PDF data is fetched directly from storage in the browser, or through a bounded native client read in Tauri to avoid webview CORS restrictions. Native preview reads time out after 45 seconds. No preview bytes pass through Convex. Images and audio/video use the direct URL as a media source; playback depends on the webview's supported formats. Every preview URL uses the same backend authorization as a download.

For legacy Convex files, the desktop/web client resolves `/api/storage/…` through its selected Convex API origin. This avoids an obsolete advertised hostname when connecting to a self-hosted backend through a different address. S3 URLs are left unchanged because their signatures bind the storage hostname.

Single uploads are limited to 5 GiB, also subject to provider/project limits. Multipart/resumable upload is not implemented in this version. Server-side copy and HEAD require provider permissions in addition to object GET/PUT. The SDK uses path-style addressing and only required checksums for compatibility.

## Owner setup

1. Provision a private bucket. Disable public bucket access and public domains. R2 uses its S3 API endpoint, not a custom download domain. Supabase uses its `/storage/v1/s3` endpoint and the configured region; enable S3 in its settings.
2. Configure `STORAGE_ENCRYPTION_KEY` on the Convex deployment: a base64-encoded random 32-byte key. Keep a separate secure copy. It is never a VITE variable.
3. Initialize the application owner once using the admin-only command `bunx --bun convex run storage:initialize '{"ownerId":"user_<owner>"}'`. It refuses to overwrite an existing owner.
4. In Settings → Storage connections, enter connection details and S3 credentials. The backend tests bucket access and encrypts credentials using AES-256-GCM, a random nonce and the connection ID as authenticated data. Lists never return the ciphertext or stored keys. Edit/rotate requires re-entering credentials; location is immutable.
5. Choose the default connection. Desktop uploads can override it per file; worker specs can pass an explicit connectionId in upload-url requests.
6. In Settings → Unit tokens, bind each existing token to its exact worker unit ID and allowed spec slugs, or create a new scoped token. Update Mu CLI and YAML upload routines before restarting workers.

S3 HeadBucket does not prove that a bucket is private. Private-access configuration is an owner responsibility: verify that unsigned access to a known object is refused. Supabase project S3 keys bypass RLS and must remain server-side. R2 credentials should be limited to the intended buckets. Neither workers nor the desktop receive secret access keys; signed URLs necessarily include the access-key identifier as part of SigV4.

Allow browser/Tauri origins in bucket CORS with GET/PUT/HEAD and the signed content-type headers. Do not use CORS as authorization. Configure an explicit lifecycle rule for `<prefix>/staging/` if temporary copies should expire. The application does not automatically delete temporary or finalized files.

For the local browser at port 4175, an R2 dashboard CORS policy is:

```json
[{"AllowedOrigins":["http://127.0.0.1:4175","http://localhost:4175"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
```

Use the actual deployed browser or Tauri origin when adding other clients. A successful backend connection test does not verify browser CORS. See [Cloudflare's CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/).

## Migration and portability

Before cutover, finish old workers where possible. Old unscoped tokens and already claimed requests without a token assignment cannot bypass the new guards. Bind tokens explicitly and requeue interrupted work through the owner-controlled workflow; do not guess a token-to-worker mapping. Old clients assuming POST uploads/storageId/proxied downloads must update with the server.

For saved YAML, run the owner-only `scripts/update-storage-specs.mjs` in preview mode, then `--apply` after reviewing the affected slugs. It changes recognized native upload/completion/download actions, retains unknown sections and rejects concurrent edits.

Backfill metadata in bounded pages using admin-only `artifactMigration:backfill` with `{cursor:null}`, then the returned cursor until `done`. It is idempotent and changes neither files nor existing projections.

After configuring a target connection, the owner can transfer legacy files outside Convex:

```sh
# Obtain a fresh Clerk JWT accepted by Convex; do not commit it or log it.
# Set MU_CONVEX_URL and MU_CLERK_JWT securely in your shell.
node scripts/migrate-artifacts.mjs r2-1
```

The utility streams each source to a temporary local file, hashes it, uploads directly to the target, verifies the staged destination bytes/hash, then completes and switches metadata. It skips deleted/older-run references through the paginated owner query. Failed transfers leave the old reference intact until completion; temporary objects may remain for lifecycle cleanup. Rerunning skips migrated records. JWT/session expiry can interrupt a long run; obtain a fresh token and retry.

Original Convex files are retained. Previously distributed legacy URLs remain usable until those original files are explicitly deleted in a separate, deliberate operation. Removing an artifact record is never that operation. New S3 artifacts use private temporary URLs.

Moving Convex servers requires the database (connections, artifacts, sessions, ownership, worker hashes) and the same encryption key transferred separately, plus Clerk issuer/whitelist configuration. Stable connection IDs and object keys resolve the same external files. A database copy without the encryption key cannot decrypt credentials. Database encryption protects snapshots, not an administrator who also controls the backend/key. Rotate the master key only with a planned decrypt/re-encrypt procedure; simply replacing it makes stored credentials unreadable.

## Verification

`bun test tests/storage.test.ts` covers actual Convex handlers with mocked identities/database, authenticated credential encryption, assignment checks, owner-only deletion, waiting-only claiming and S3 transfer actions against a local protocol server. `node --test tests/worker-api.test.cjs` retains request/report/reset/activity regressions and the deliberately restricted HTTP routes. Typecheck both frontend and Convex, then build Vite.

The local S3 server is a protocol fixture, not proof of provider-side security or compatibility. Verify a real private bucket on each provider, CORS/Tauri, expiry and unsigned denial before production use. File migration is not run automatically.
