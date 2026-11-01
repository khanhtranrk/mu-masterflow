const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

// Run application handlers with an isolated in-memory database, without a deployment.
function setup() {
  const rows = [];
  const uploads = [];
  const files = new Map();
  const units = [{ _id: 'unit-record', unitId: 'receiver', tokenId: 'token', lastSeen: 1 }];
  const specs = [{ slug: 'demo', yaml: 'pipeline:\n  main:\n    nodes: []\n' }];
  const routes = [];
  const cache = new Map();
  const refs = new Proxy({}, { get: (_, module) => new Proxy({}, {
    get: (_, name) => `${module}.${name}`,
  }) });
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const result = {};
    cache.set(name, result);
    const source = fs.readFileSync(path.join(__dirname, '../convex', `${name}.ts`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const localRequire = id => {
      if (id === './_generated/server') return new Proxy({}, { get: () => value => value });
      if (id === './_generated/api') return { internal: refs };
      if (id === './workerAccess') return { workerIdentity: async () => ({ _id: 'token', unitId: 'receiver', specSlugs: ['demo'] }), assignedRequest: async (ctx, id) => { const r = await ctx.db.get(id); if (!r) throw new Error('Request not found'); return { ...r, assignmentVersion: r.assignmentVersion ?? 1 }; } };
      if (id === './authz') return { requireAuthenticated(ctx) { if (ctx.authenticated === false) throw new Error('Unauthenticated'); return 'test-user'; } };
      if (id === 'convex/server') return { httpRouter: () => ({ route: r => routes.push(r) }) };
      if (id.startsWith('./')) return load(id.slice(2));
      return require(id);
    };
    new Function('require', 'exports', 'crypto', compiled)(localRequire, result, webcrypto);
    return result;
  }
  const db = {
    async get(id) { return [...rows, ...uploads].find(row => row._id === id) ?? null; },
    system: { async get(table, id) { assert.equal(table, '_storage'); return files.get(id)?.metadata ?? null; } },
    query(table) {
      let candidates = table === 'units' ? units : table === 'specs'
        ? specs : table === 'artifactUploads' ? uploads : rows;
      return {
        withIndex(index, build) {
          const schema = fs.readFileSync(path.join(__dirname, '../convex/schema.ts'), 'utf8');
          assert.ok(schema.includes(`.index("${index}"`), `Missing index: ${index}`);
          const range = { eq(field, value) {
            candidates = candidates.filter(row => row[field] === value);
            return range;
          } };
          build(range);
          return this;
        },
        order() { return this; },
        async take(n) { return candidates.slice(0, n).map(row => ({ ...row })); },
        async first() { return candidates[0] ?? null; },
      };
    },
    async insert(table, value) {
      assert.ok(['requests', 'artifactUploads'].includes(table));
      const target = table === 'requests' ? rows : uploads;
      const id = `${table === 'requests' ? 'request' : 'upload'}-${target.length}`;
      target.push({ _id: id, ...(table === 'artifactUploads' ? { _creationTime: Date.now() } : {}), ...value });
      return id;
    },
    async patch(id, patch) {
      const row = [...rows, ...units, ...uploads].find(row => row._id === id);
      assert.ok(row);
      Object.assign(row, patch);
    },
  };
  const ctx = {
    db,
    storage: {
      async generateUploadUrl() { return 'https://storage.invalid/upload'; },
      async getUrl(id) { return files.has(id) ? `https://storage.invalid/${id}` : null; },
      async get(id) { return files.get(id)?.blob ?? null; },
      async delete(id) { files.delete(id); },
    },
    async runQuery(ref, args) {
      if (ref === 'unitTokens.getByHash') return { _id: 'token', lastUsedAt: Date.now() };
      const [module, name] = ref.split('.');
      return load(module)[name].handler(ctx, args);
    },
    async runMutation(ref, args) {
      const [module, name] = ref.split('.');
      return load(module)[name].handler(ctx, args);
    },
  };
  load('http');
  async function http(method, url, body, authenticated = true) {
    const route = routes.find(r => r.path === new URL(url, 'http://localhost').pathname && r.method === method);
    assert.ok(route, `${method} ${url}`);
    return route.handler(ctx, new Request(new URL(url, 'http://localhost'), {
      method, headers: { ...(authenticated ? { Authorization: 'Bearer test-token' } : {}),
        'Content-Type': 'application/json', 'X-Mu-Assignment-Version': '1' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
  }
  return { rows, units, specs, uploads, files, ctx, load, http, remove: args => load("requests").remove.handler(ctx, args), list: args => load("requests").list.handler(ctx, args), edit: args => load("requests").editPayload.handler(ctx, args) };
}

test('request editor updates waiting payload atomically and rejects stale, claimed or invalid input', async () => {
  const { rows, specs, edit } = setup();
  specs[0].yaml = 'pipeline:\n  main:\n    params:\n      name: {type: string}\n      width: {type: number, default: 1280}\n    nodes: []\n';
  const original = {name: 'Original', width: 1280};
  rows.push({_id: 'editable', specSlug: 'demo', pipelineName: 'main', payload: original, status: 'waiting', nodeStates: {one: {status: 'queue'}}});
  await assert.rejects(edit({id: 'editable', payload: {name: 'bad', width: '1024'}, expectedPayload: original}), /finite number/);
  await assert.rejects(edit({id: 'editable', payload: {}, expectedPayload: original}), /required/);
  await assert.rejects(edit({id: 'editable', payload: {name: 'bad', extra: true}, expectedPayload: original}), /not declared/);
  await assert.rejects(edit({id: 'editable', payload: {name: 'new'}, expectedPayload: {name: 'stale'}}), /changed elsewhere/);
  assert.equal(await edit({id: 'editable', payload: {name: 'Updated'}, expectedPayload: {width: 1280, name: 'Original'}}), 'editable');
  assert.deepEqual(rows[0].payload, {name: 'Updated'});
  assert.equal(rows[0].status, 'waiting');
  assert.deepEqual(rows[0].nodeStates, {one: {status: 'queue'}});
  rows[0].status = 'possessed';
  await assert.rejects(edit({id: 'editable', payload: {name: 'Too late'}, expectedPayload: {name: 'Updated'}}), /left the waiting queue/);
  assert.deepEqual(rows[0].payload, {name: 'Updated'});
});


test('soft deletion preserves data and excludes deleted requests before selection limits', async () => {
  const { rows, http, remove, list, edit } = setup();
  rows.push(
    { _id: 'deleted', _creationTime: 1, specSlug: 'demo', pipelineName: 'main', status: 'waiting', payload: { prompt: 'keep' } },
    { _id: 'active', _creationTime: 2, specSlug: 'demo', pipelineName: 'main', status: 'waiting', payload: {} },
  );
  await remove({ id: 'deleted' });
  const deletedAt = rows[0].deletedAt;
  assert.equal(typeof deletedAt, 'number');
  await remove({ id: 'deleted' });
  assert.equal(rows[0].deletedAt, deletedAt);
  assert.deepEqual(rows[0].payload, { prompt: 'keep' });
  assert.deepEqual((await list({ specSlug: 'demo' })).map(row => row._id), ['active']);
  await assert.rejects(edit({ id: 'deleted', payload: {}, expectedPayload: { prompt: 'keep' } }), /not found/);
  const inspected = await http('GET', '/api/requests?specSlug=demo&maxCount=1');
  assert.equal(inspected.status, 403);
  const claimed = await http('POST', '/api/requests/claim', { specSlug: 'demo', unitId: 'receiver', maxCount: 1, byStatus: 'waiting' });
  assert.equal(claimed.status, 200);
  assert.equal(rows[0].status, 'waiting');
  assert.equal(rows[1].status, 'possessed');
});


test('node artifact reports only reference registered metadata and keep request updates atomic', async () => {
  const { rows, http, ctx, load, edit, remove } = setup();
  const artifact = { id: 'audio', name: 'song.wav', nodeName: 'render', storageId: 'file-a', contentType: 'audio/wav', size: 42, createdAt: 1 };
  rows.push({ _id: 'run', specSlug: 'demo', pipelineName: 'main', payload: {}, status: 'waiting', artifacts: [artifact],
    nodeStates: { render: { status: 'running', logs: ['started'], artifacts: [artifact] } } });
  const report = node => http('POST', '/api/requests/report', { id: 'run', node_states: { render: node } });
  const before = JSON.stringify(rows[0]);
  for (const artifacts of [{ output: '/worker/song.wav' }, [artifact, artifact], [{ ...artifact, storageId: 'unregistered' }],
    [{ ...artifact, size: 900 }], [{ ...artifact, id: 'other' }], [{ ...artifact, extra: true }]]) {
    assert.equal((await report({ artifacts })).status, 400);
    assert.equal(JSON.stringify(rows[0]), before);
  }
  assert.equal((await http('POST', '/api/requests/report', { id: 'run', artifacts: [artifact] })).status, 400);
  assert.equal((await http('POST', '/api/requests/report', { id: 'run', node_states: { other: { status: 'running', artifacts: [artifact] } } })).status, 400);
  assert.equal((await http('POST', '/api/requests/report', { id: 'run', node_states: { new: { artifacts: [] } } })).status, 400);
  await assert.rejects(load('requests').report.handler(ctx, { id: 'run', tokenId: 'token', assignmentVersion: 1, nodeStates: {render: {artifacts: [{...artifact, size: 900}]}} }), /registered/);
  assert.equal((await report({ artifacts: [artifact], logs: ['finished'], status: 'succeeded' })).status, 200);
  assert.deepEqual(rows[0].nodeStates.render.logs, ['started', 'finished']);
  assert.deepEqual(rows[0].nodeStates.render.artifacts, [artifact]);
  assert.equal((await report({ logs: ['retained'] })).status, 200);
  assert.deepEqual(rows[0].nodeStates.render.artifacts, [artifact]);
  assert.equal((await report({ artifacts: [] })).status, 200);
  assert.deepEqual(rows[0].nodeStates.render.artifacts, []);
  assert.deepEqual(rows[0].artifacts, [artifact]);
  await edit({ id: 'run', payload: {}, expectedPayload: {} });
  await load('requests').update.handler(ctx, { id: 'run', payload: {}, status: 'processing' });
  assert.deepEqual(rows[0].artifacts, [artifact]);
  assert.deepEqual(rows[0].nodeStates.render.artifacts, []);
  const claimed = await http('POST', '/api/requests/claim', { specSlug: 'demo', unitId: 'receiver' });
  assert.equal(claimed.status, 200);
  assert.deepEqual(await claimed.json(), []);
  assert.deepEqual(rows[0].nodeStates.render.artifacts, []);
  await remove({ id: 'run' });
  assert.equal((await report({ artifacts: [artifact] })).status, 200);
  assert.deepEqual(rows[0].artifacts, [artifact]);
  assert.ok(rows[0].deletedAt);
});

test('worker and desktop creation reject archived specs', async () => {
  const { specs, http, ctx, load } = setup();
  specs[0].deletedAt = Date.now();
  assert.equal((await http('POST', '/api/requests/create', {specSlug: 'demo', pipelineName: 'main', payload: {}})).status, 403);
  await assert.rejects(load('requests').create.handler(ctx, {specSlug: 'demo', pipelineName: 'main', payload: {}}), /Spec not found/);
});


test('failed requests reset in place, clear runtime state, and can be claimed again', async () => {
  for (const status of ['process_failed', 'retrieve_artifact_failed', 'failed']) {
    const {rows,ctx,load,http}=setup();
    const payload={lyrics:'Keep these inputs',seed:42};
    rows.push({_id:'retry',_creationTime:123,specSlug:'demo',pipelineName:'main',status,payload,unitId:'old-worker',claimedAt:99,nodeStates:{render:{status:'failed',logs:['old error']}},artifacts:[{id:'old',storageId:'old-file'}]});
    assert.equal(await load('requests').reset.handler(ctx,{id:'retry'}),'retry');
    assert.equal(rows.length,1);
    assert.equal(rows[0]._creationTime,123);
    assert.deepEqual(rows[0].payload,payload);
    assert.equal(rows[0].pipelineName,'main');
    assert.equal(rows[0].specSlug,'demo');
    assert.equal(rows[0].status,'waiting');
    for (const field of ['unitId','claimedAt','nodeStates','artifacts']) assert.equal(rows[0][field],undefined,field);
    assert.equal(rows[0].resetVersion,1);
    await assert.rejects(load('requests').reset.handler(ctx,{id:'retry'}),/Only failed/);
    const response=await http('POST','/api/requests/claim',{specSlug:'demo',unitId:'receiver',byStatus:'waiting'});
    assert.equal(response.status,200);
    assert.equal((await response.json())[0].requestId,'retry');
    assert.equal(rows[0].status,'possessed');
    assert.equal(rows[0].unitId,'receiver');
    assert.equal(rows[0].nodeStates,undefined);
  }
});

test('reset rejects non-failures, deleted/missing requests, unavailable pipelines and unauthenticated callers', async()=>{
  for(const status of ['waiting','possessed','processing','artifact_available','succeeded','queue','unknown']){
    const {rows,ctx,load}=setup();
    rows.push({_id:'run',specSlug:'demo',pipelineName:'main',status,payload:{keep:true}});
    const before=JSON.stringify(rows);
    await assert.rejects(load('requests').reset.handler(ctx,{id:'run'}),/Only failed/);
    assert.equal(JSON.stringify(rows),before);
  }
  const {rows,ctx,specs,load}=setup();
  const reset=()=>load('requests').reset.handler(ctx,{id:'run'});
  await assert.rejects(reset(),/not found/);
  rows.push({_id:'run',specSlug:'demo',pipelineName:'main',status:'process_failed',payload:{},deletedAt:1});
  await assert.rejects(reset(),/not found/);
  delete rows[0].deletedAt;
  ctx.authenticated=false;
  await assert.rejects(reset(),/Unauthenticated/);
  ctx.authenticated=true;
  specs[0].deletedAt=1;
  await assert.rejects(reset(),/spec is no longer/);
  delete specs[0].deletedAt;
  rows[0].pipelineName='missing';
  await assert.rejects(reset(),/pipeline no longer/);
  assert.equal(rows[0].status,'process_failed');
});

test('scheduler node reasons are validated, stored and cleared on legacy state transitions', async () => {
 const {rows,http} = setup();
 rows.push({_id:'lifecycle',specSlug:'demo',pipelineName:'main',status:'possessed',payload:{}});
 const report = node => http('POST','/api/requests/report',{id:'lifecycle',node_states:{render:node}});
 assert.equal((await report({status:'queue',reason:'Waiting for GPU resources'})).status,200);
 assert.equal(rows[0].nodeStates.render.reason,'Waiting for GPU resources');
 assert.equal((await report({status:'running',reason:''})).status,200);
 assert.equal(rows[0].nodeStates.render.reason,'');
 assert.equal((await report({status:'failed',reason:'upload failed'})).status,200);
 assert.equal((await report({reason:123})).status,400);
 assert.equal(rows[0].nodeStates.render.reason,'upload failed');
 assert.equal((await report({status:'succeeded'})).status,200);
 assert.equal(rows[0].nodeStates.render.reason,'');
});

test('activity spans specs, excludes deleted and inactive requests, and follows status changes', async () => {
  const { rows, ctx, load } = setup();
  rows.push(
    { _id: 'a', specSlug: 'one', status: 'possessed', unitId: 'receiver', claimedAt: 42 },
    { _id: 'b', specSlug: 'two', status: 'processing', nodeStates: {
      first: { status: 'running', logs: ['private runtime detail'] },
      second: { status: 'running' },
    } },
    { _id: 'deleted', status: 'processing', deletedAt: 1 },
    ...['waiting', 'succeeded', 'process_failed', 'artifact_available', 'retrieve_artifact_failed'].map(status => ({ _id: status, status })),
  );
  const query = load('requests').listActive;
  const before = JSON.stringify(rows);
  const result = await query.handler(ctx, {});
  assert.equal(result.truncated, false);
  assert.deepEqual(result.requests, [
    { _id: 'a', status: 'possessed', unitId: 'receiver', claimedAt: 42, nodes: [] },
    { _id: 'b', status: 'processing', nodes: [{ name: 'first', status: 'running' }, { name: 'second', status: 'running' }] },
  ]);
  assert.equal(JSON.stringify(rows), before);
  rows[0].status = 'succeeded';
  rows[1].status = 'process_failed';
  assert.deepEqual((await query.handler(ctx, {})).requests, []);
  ctx.authenticated = false;
  await assert.rejects(() => query.handler(ctx, {}), /Unauthenticated/);
});

test('activity reports truncation and excludes deleted requests before applying its limit', async () => {
  const { rows, ctx, load } = setup();
  for (let n = 0; n < 502; n++) rows.push({ _id: `deleted-${n}`, status: 'processing', deletedAt: 1 });
  for (let n = 0; n < 501; n++) rows.push({ _id: `active-${n}`, status: 'processing' });
  const result = await load('requests').listActive.handler(ctx, {});
  assert.equal(result.truncated, true);
  assert.equal(result.requests.length, 500);
  assert.equal(result.requests[0]._id, 'active-0');
});

test('worker tokens cannot create or inspect arbitrary requests', async () => {
 const {http}=setup();
 assert.equal((await http('POST','/api/requests/create',{},false)).status,401);
 assert.equal((await http('POST','/api/requests/create',{})).status,403);
 assert.equal((await http('GET','/api/requests?specSlug=demo')).status,403);
});
