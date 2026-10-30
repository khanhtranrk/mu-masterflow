const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

// Run application handlers with an isolated in-memory database, without a deployment.
function setup() {
  const rows = [];
  const units = [{ _id: 'unit-record', unitId: 'receiver', lastSeen: 1 }];
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
      if (id === './auth') return { auth: { addHttpRoutes() {} } };
      if (id === './authz') return { requireAuthenticated() {} };
      if (id === 'convex/server') return { httpRouter: () => ({ route: r => routes.push(r) }) };
      if (id.startsWith('./')) return load(id.slice(2));
      return require(id);
    };
    new Function('require', 'exports', 'crypto', compiled)(localRequire, result, webcrypto);
    return result;
  }
  const db = {
    async get(id) { return rows.find(row => row._id === id) ?? null; },
    query(table) {
      let candidates = table === 'units' ? units : table === 'specs'
        ? specs : rows;
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
      assert.equal(table, 'requests');
      const id = `request-${rows.length}`;
      rows.push({ _id: id, ...value });
      return id;
    },
    async patch(id, patch) {
      const row = [...rows, ...units].find(row => row._id === id);
      assert.ok(row);
      Object.assign(row, patch);
    },
  };
  const ctx = {
    db,
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
        'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
  }
  return { rows, units, specs, http, remove: args => load("requests").remove.handler(ctx, args), list: args => load("requests").list.handler(ctx, args), edit: args => load("requests").editPayload.handler(ctx, args) };
}

test('creation only inserts a waiting request and validates input/authentication', async () => {
  const { rows, units, http } = setup();
  const body = { specSlug: 'demo', pipelineName: 'main', payload: { prompt: 'Hello' } };
  assert.equal((await http('POST', '/api/requests/create', body, false)).status, 401);
  assert.equal((await http('POST', '/api/requests/create', { ...body, pipelineName: 'missing' })).status, 400);
  const { payload, ...missingPayload } = body;
  assert.equal((await http('POST', '/api/requests/create', missingPayload)).status, 400);
  assert.equal(rows.length, 0);
  const response = await http('POST', '/api/requests/create', body);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { requestId: 'request-0' });
  assert.deepEqual(rows, [{ _id: 'request-0', ...body, status: 'waiting' }]);
  assert.equal(units[0].lastSeen, 1);
});

test('inspection and claim apply all eight filter combinations before limiting', async () => {
  for (let mask = 0; mask < 8; mask++) {
    const { rows, units, http } = setup();
    for (let n = 0; n < 8; n++) rows.push({
      _id: `request-${n}`, specSlug: 'demo', payload: n,
      pipelineName: n & 1 ? 'main' : 'other',
      status: n & 2 ? 'custom-state' : 'waiting',
      ...(n & 4 ? { unitId: 'previous' } : {}),
    });
    rows.unshift({ ...rows[7], _id: 'different-spec', specSlug: 'other' });
    const filters = {
      ...(mask & 1 ? { byPipeline: 'main' } : {}),
      ...(mask & 2 ? { byStatus: 'custom-state' } : {}),
      ...(mask & 4 ? { byUnitId: 'previous' } : {}),
    };
    const expected = rows.filter(r => r.specSlug === 'demo'
      && (!(mask & 1) || r.pipelineName === 'main')
      && (!(mask & 2) || r.status === 'custom-state')
      && (!(mask & 4) || r.unitId === 'previous')).slice(0, 2);
    const before = JSON.stringify(rows);
    const query = new URLSearchParams({ specSlug: 'demo', maxCount: '2', ...filters });
    const viewed = await http('GET', `/api/requests?${query}`);
    assert.equal(viewed.status, 200);
    assert.deepEqual((await viewed.json()).map(r => r.requestId), expected.map(r => r._id));
    assert.equal(JSON.stringify(rows), before);
    assert.equal(units[0].lastSeen, 1);
    const claimed = await http('POST', '/api/requests/claim', {
      specSlug: 'demo', unitId: 'receiver', maxCount: 2, ...filters,
    });
    assert.equal(claimed.status, 200);
    assert.deepEqual((await claimed.json()).map(r => r.requestId), expected.map(r => r._id));
    for (const row of expected) {
      assert.equal(row.status, 'possessed');
      assert.equal(row.unitId, 'receiver');
      assert.equal(typeof row.claimedAt, 'number');
    }
  }
});

test('GET and claim reject invalid filters and limits and return empty matches', async () => {
  const { http } = setup();
  for (const query of ['specSlug=demo&maxCount=0', 'specSlug=demo&maxCount=1.5',
    'specSlug=demo&maxCount=', 'specSlug=demo&byPipeline=',
    'specSlug=demo&byStatus=a&byStatus=b', 'maxCount=1']) {
    assert.equal((await http('GET', `/api/requests?${query}`)).status, 400);
  }
  assert.equal((await http('GET', '/api/requests?specSlug=demo', undefined, false)).status, 401);
  assert.deepEqual(await (await http('GET', '/api/requests?specSlug=demo')).json(), []);
  for (const extra of [{ byStatus: 7 }, { byUnitId: null }, { maxCount: 101 }]) {
    assert.equal((await http('POST', '/api/requests/claim', {
      specSlug: 'demo', unitId: 'receiver', ...extra,
    })).status, 400);
  }
  assert.equal((await http('POST', '/api/requests/claim', {
    specSlug: 'demo', unitId: 'unregistered',
  })).status, 400);
  for (const route of ['/api/requests', '/api/requests/create']) {
    assert.equal((await http('OPTIONS', route, undefined, false)).status, 204);
  }
});

test('array claim filters merge oldest candidates with one global limit', async () => {
  const { rows, http } = setup();
  rows.push(
    { _id: 'old', _creationTime: 1, specSlug: 'demo', pipelineName: 'b', status: 'waiting', payload: {} },
    { _id: 'middle', _creationTime: 2, specSlug: 'demo', pipelineName: 'a', status: 'custom', payload: {} },
    { _id: 'new', _creationTime: 3, specSlug: 'demo', pipelineName: 'a', status: 'waiting', payload: {} },
    { _id: 'excluded', _creationTime: 0, specSlug: 'demo', pipelineName: 'c', status: 'waiting', payload: {} },
  );
  const response = await http('POST', '/api/requests/claim', {
    unitId: 'receiver', specSlug: 'demo', maxCount: 2,
    byPipeline: ['a', 'b', 'a'], byStatus: ['waiting', 'custom'],
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(r => r.requestId), ['old', 'middle']);
  assert.equal(rows[2].status, 'waiting');
  assert.equal(rows[3].status, 'waiting');
  for (const byPipeline of [[], [''], ['a', null]]) {
    assert.equal((await http('POST', '/api/requests/claim', {
      unitId: 'receiver', specSlug: 'demo', byPipeline,
    })).status, 400);
  }
  const empty = await http('POST', '/api/requests/claim', {
    unitId: 'receiver', specSlug: 'demo', byPipeline: ['a', 'b'], byStatus: ['never'],
  });
  assert.deepEqual(await empty.json(), []);
});


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
  assert.equal(inspected.status, 200);
  assert.ok(!JSON.stringify(await inspected.json()).includes('deleted'));
  const claimed = await http('POST', '/api/requests/claim', { specSlug: 'demo', unitId: 'receiver', maxCount: 1, byStatus: 'waiting' });
  assert.equal(claimed.status, 200);
  assert.equal(rows[0].status, 'waiting');
  assert.equal(rows[1].status, 'possessed');
});
