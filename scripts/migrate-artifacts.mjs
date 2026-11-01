// Owner-run transfer. File bytes pass through this process, never through Convex.
// MU_CONVEX_URL=... MU_CLERK_JWT=... node scripts/migrate-artifacts.mjs r2-1
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const connectionId = process.argv[2];
if (!connectionId || !process.env.MU_CLERK_JWT || !process.env.MU_CONVEX_URL) throw new Error('Set MU_CONVEX_URL, MU_CLERK_JWT and pass the destination connection ID.');
const client = new ConvexHttpClient(process.env.MU_CONVEX_URL);
client.setAuth(process.env.MU_CLERK_JWT);
async function digest(stream) { const hash = createHash('sha256'); let size = 0; for await (const chunk of stream) { size += chunk.length; hash.update(chunk); } return { sha256: hash.digest('hex'), size }; }
let cursor = null;
do {
  const page = await client.query(api.artifactMigration.legacy, { paginationOpts: { cursor, numItems: 10 } });
  for (const a of page.page) {
    const directory = await mkdtemp(join(tmpdir(), 'mu-artifact-'));
    try {
      const source = await client.action(api.artifactTransfers.downloadUrl, { requestId: a.requestId, artifactId: a.artifactId });
      const response = await fetch(source.url);
      if (!response.ok || !response.body) throw new Error('Could not read source artifact');
      const path = join(directory, 'file');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
      const file = await digest(createReadStream(path));
      if (file.size !== a.metadata.size) throw new Error('Source artifact size mismatch');
      const upload = await client.action(api.artifactTransfers.startUpload, { requestId: a.requestId, artifactId: a.artifactId, connectionId, ...file, contentType: a.metadata.contentType });
      const put = await fetch(upload.uploadUrl, { method: upload.method, headers: { ...upload.headers, 'Content-Length': String(file.size) }, body: createReadStream(path), duplex: 'half' });
      if (!put.ok) throw new Error('Destination upload failed');
      const verifyUrl = await client.action(api.artifactTransfers.verifyUploadUrl, { uploadId: upload.uploadId });
      const verify = await fetch(verifyUrl);
      if (!verify.ok || !verify.body) throw new Error('Destination verification failed');
      const copied = await digest(Readable.fromWeb(verify.body));
      if (copied.sha256 !== file.sha256 || copied.size !== file.size) throw new Error('Destination checksum mismatch; metadata was not changed');
      await client.action(api.artifactTransfers.completeUpload, { requestId: a.requestId, uploadId: upload.uploadId, name: a.metadata.name, ...(a.metadata.nodeName ? { nodeName: a.metadata.nodeName } : {}), ...(a.metadata.label ? { label: a.metadata.label } : {}) });
      console.log(`Migrated ${a.requestId}/${a.artifactId} to ${connectionId}; original file retained.`);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  cursor = page.isDone ? null : page.continueCursor;
} while (cursor);
