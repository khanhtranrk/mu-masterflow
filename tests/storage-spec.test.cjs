const { test } = require('node:test');
const assert = require('node:assert/strict');
test('legacy upload/download YAML is upgraded without changing unknown sections and is idempotent', async () => {
 const { upgradeStorageSpec } = await import('../scripts/storage-spec.mjs');
 const { parse } = await import('yaml');
 const yaml = `# Keep this comment\ncustom: {keep: true}\nroutines:\n  upload:\n    actions:\n      - type: send_http_request\n        url: '{session[server]}/api/requests/artifacts/upload-url'\n        save_state: issue\n        body: {requestId: '{request[requestId]}'}\n      - type: send_http_request\n        url: '{actions[issue][body][uploadUrl]}'\n        method: post\n        header: {Content-Type: audio/wav}\n        body_file: output.wav\n      - type: send_http_request\n        url: '{session[server]}/api/requests/artifacts/complete'\n        body: {uploadId: '{actions[issue][body][uploadId]}', storageId: '{actions[stored][body][storageId]}'}\n      - type: send_http_request\n        url: '{session[server]}/api/requests/artifacts/download?requestId=x&artifactId=y'\n        header: {Authorization: 'Bearer {session[token]}'}\n        response_file: file.wav\n        save_state: fetched\n`;
 const result = upgradeStorageSpec(yaml); const parsed = parse(result.yaml);
 assert.ok(result.changes > 0); assert.match(result.yaml, /Keep this comment/); assert.deepEqual(parsed.custom,{keep:true});
 const actions=parsed.routines.upload.actions;
 assert.equal(actions[0].body.contentType,'audio/wav'); assert.equal(actions[1].method,'{actions[issue][body][method]}');
 assert.equal(actions[2].body.storageId,undefined); assert.match(actions[3].url,/download-url/);
 assert.equal(actions[4].header,undefined); assert.equal(actions[4].save_state,'fetched'); assert.equal(actions[4].response_file,'file.wav');
 assert.equal(upgradeStorageSpec(result.yaml).changes,0);
});
