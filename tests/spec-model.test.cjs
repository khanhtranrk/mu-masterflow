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

test('starter and current entry/pipeline/workload fields match the frontend contract', () => {
  assert.deepEqual(specIssues(parse(starterYaml)), []);
  assert.deepEqual(specIssues({entries: {master_flow: {initialization: [], finalization: []}}, workloads: {demo: {target: 'python', args: ['--version'], units: 0}}, pipeline: {main: {prepare: [], params: {width: {type: 'number', default: 1024}}, context: {}, nodes: [{name: 'demo', run: {workload: 'demo', args: {}}}]}}}), []);
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

test('cycles, unknown dependencies, duplicate names and action runs are rejected', () => {
  for (const nodes of [
    [{ name: 'a', depends_on: ['b'] }, { name: 'b', depends_on: ['a'] }],
    [{ name: 'a', depends_on: ['missing'] }],
    [{ name: 'a' }, { name: 'a' }],
    [{ name: 'a', run: [{ type: 'create_dir', path: '/tmp/demo' }] }],
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
