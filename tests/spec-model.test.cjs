const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(require, exports);
  return exports;
}
const { specIssues, nextName, renameNode, requestPayload } = load('specModel.ts');
const { nodeDependencyNames, starterYaml } = load('specUtils.ts');
const { parse } = require('yaml');

test('HTTP headers accept mappings and whole-value templates used by signed artifact uploads', () => {
  const spec = header => ({ routines: { upload_artifact: { actions: [
    { type: 'send_http_request', url: '{actions[upload][body][uploadUrl]}', method: '{actions[upload][body][method]}', header, body_file: 'result.json' },
  ] } } });
  for (const header of [{ 'Content-Type': 'application/json' }, {}, '{actions[upload][body][headers]}', '{params[headers]}']) {
    assert.deepEqual(specIssues(spec(header)), []);
  }
  for (const header of [null, [], 123, '', 'Content-Type: application/json', 'prefix {actions[upload][body][headers]}']) {
    assert.ok(specIssues(spec(header)).some(issue => issue.startsWith('routines.upload_artifact.actions[0].header:')));
  }
});

test('starter and current entry/pipeline/workload fields match the frontend contract', () => {
  assert.deepEqual(specIssues(parse(starterYaml)), []);
  assert.deepEqual(specIssues({entries: {master_flow: {initialization: [], finalization: []}}, workloads: {demo: {target: 'python', args: ['--version'], units: 0}}, pipeline: {main: {prepare: [], params: {width: {type: 'number', default: 1024}}, context: {}, nodes: [{name: 'demo', run: [{type: 'execute_workload', workload: 'demo', args: {}}]}]}}}), []);
});

test('legacy fields and dependency conditions are actionable errors', () => {
  const issues = specIssues({ prepare: [], 'master-flow': {}, pipeline: { p: { nodes: [
    { name: 'first' }, { name: 'second', depends_on: [{ node: 'first', condition: {} }] },
  ] } } });
  assert.ok(issues.some(issue => issue.startsWith('prepare:')));
  assert.ok(issues.some(issue => issue.startsWith('master-flow:')));
  assert.ok(issues.some(issue => issue.includes('dependency objects/conditions')));
  assert.deepEqual(nodeDependencyNames({ name: 'second', depends_on: ['first', { node: 'legacy' }] }), ['first']);
});

test('cycles, unknown dependencies, duplicate names and legacy workload mappings are rejected', () => {
  for (const nodes of [
    [{ name: 'a', depends_on: ['b'] }, { name: 'b', depends_on: ['a'] }],
    [{ name: 'a', depends_on: ['missing'] }],
    [{ name: 'a' }, { name: 'a' }],
    [{ name: 'a', run: {workload: 'demo'} }],
  ]) assert.ok(specIssues({ pipeline: { p: { nodes } } }).length);
});

test('renaming nodes updates dependencies and preserves arbitrary fields', () => {
  const original = [ { name: 'a', custom: { retain: true } }, { name: 'b', depends_on: ['a'], finally: [], custom: 123 } ];
  const result = renameNode(original, 'a', { ...original[0], name: 'renamed' });
  assert.deepEqual(result[1].depends_on, ['renamed']);
  assert.deepEqual(result[0].custom, { retain: true });
  assert.equal(result[1].custom, 123);
  assert.deepEqual(original[1].depends_on, ['a']);
  assert.throws(() => renameNode(original, 'a', { name: 'b' }), /already exists/);
  assert.equal(nextName('node', ['node_1', 'node_3']), 'node_2');
});

test('request form converts only numbers and leaves defaults to the worker', () => {
  const schema = { title: { type: 'string' }, width: { type: 'number' }, quality: { type: 'number', default: 4 }, notes: { type: 'string', default: 'default' } };
  const form = new FormData(); form.set('param:title', '001'); form.set('param:width', '12.5');
  assert.deepEqual(requestPayload(schema, form), { title: '001', width: 12.5 });
  form.set('param:notes', '');
  assert.equal(requestPayload(schema, form).notes, '');
  form.set('param:width', '');
  assert.throws(() => requestPayload(schema, form), /finite number/);
  form.set('param:width', 'NaN');
  assert.throws(() => requestPayload(schema, form), /finite number/);
});

test('sequential actions and workload calls validate in the three node phases', () => {
  const call = {type: 'execute_workload', workload: 'demo', args: {input: '{params[input]}'}, skip_if: {operator: 'file_exists', path: 'done'}};
  for (const phase of ['before_run', 'run', 'after_run']) {
    const spec = {workloads: {demo: {target: 'python', units: 3}}, pipeline: {p: {nodes: [{name: 'n', [phase]: [call, {type: 'write_json', path: 'result.json'}]}]}}};
    assert.deepEqual(specIssues(spec), []);
    for (const [field, value] of [['workload', 'missing'], ['workload', '{params[name]}'], ['args', []], ['save_state', 'result']]) {
      const invalid = structuredClone(spec); invalid.pipeline.p.nodes[0][phase][0][field] = value;
      assert.ok(specIssues(invalid).some(issue => issue.includes(`${phase}[0].${field}`)), `${phase}.${field}`);
    }
  }
  assert.deepEqual(specIssues({pipeline: {p: {nodes: [{name: 'n', run: [{type: 'create_dir', path: 'out'}]}, {name: 'empty', run: []}]}}}), []);
});

test('workload execution is rejected outside scheduled node phases', () => {
  const call = {type: 'execute_workload', workload: 'demo'};
  for (const spec of [
    {entries: {master_flow: {initialization: [call], finalization: [call]}}},
    {pipeline: {p: {prepare: [call], nodes: [{name: 'n', finally: [call]}]}}},
  ]) assert.ok(specIssues(spec).some(issue => issue.includes('only supported in node')));
  const invalid = {pipeline: {p: {nodes: [{name: 'n', run: {workload: 'demo'}}]}}};
  assert.ok(specIssues(invalid).some(issue => issue.includes('type: execute_workload')));
});

test('routines validate calls, cycles, typed params and utility results', () => {
  const spec = {routines: {inspect: {params: {logs: {type: 'array', default: []}}, actions: [{type: 'inspect_file', target: 'output.json', save_state: 'file'}], returns: '{actions[file]}'}}, entries: {direct_flow: {initialization: [{type: 'execute_routine', routine: 'inspect', save_state: 'result'}]}}};
  assert.deepEqual(specIssues(spec), []);
  const invalid = structuredClone(spec);
  invalid.routines.inspect.actions = [{type: 'execute_routine', routine: 'inspect'}];
  assert.ok(specIssues(invalid).some(issue => issue.includes('cycle')));
  invalid.routines.inspect.actions = [{type: 'execute_workload', workload: 'gpu'}];
  assert.ok(specIssues(invalid).some(issue => issue.includes('only supported')));
  invalid.routines.inspect.actions = [{type: 'execute_routine', routine: 'missing'}];
  assert.ok(specIssues(invalid).some(issue => issue.includes('undefined routine')));
});

test('lifecycle events validate scopes, action restrictions and routine references', () => {
  const hook = { on: 'node_finished', do: [{ type: 'execute_routine', routine: 'report' }] };
  const spec = { routines: { report: { actions: [] } }, events: [hook], pipeline: { p: { events: [hook], nodes: [{ name: 'a', events: [hook] }] } } };
  assert.deepEqual(specIssues(spec), []);
  for (const events of [null, {}, [{ on: 'unknown', do: [] }], [{ on: 'node_finished' }], [{ on: 'node_finished', do: [{ type: 'execute_workload', workload: 'x' }] }], [{ on: 'node_started', do: [{ type: 'execute_routine', routine: 'missing' }] }]]) {
    assert.ok(specIssues({ events }).some(issue => issue.startsWith('events')));
  }
  assert.ok(specIssues({ pipeline: { p: { nodes: [{ name: 'a', events: [{ on: 'pipeline_finished', do: [] }] }] } } }).some(issue => issue.includes('.events[0].on')));
});
