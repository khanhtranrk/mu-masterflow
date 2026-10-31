const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(name => name.startsWith('./') ? load(name.slice(2)) : require(name), exports);
  return exports;
}
const { yamlProblems } = load('yamlDiagnostics');
const { starterYaml } = load('specUtils');

test('valid spec clears all problems after an invalid draft', () => {
  assert.ok(yamlProblems('pipeline: [').length);
  assert.deepEqual(yamlProblems(starterYaml), []);
});

test('syntax problems have bounded positions and exclude stale configuration issues', () => {
  const text = 'prepare: []\npipeline: [\n';
  const problems = yamlProblems(text);
  assert.ok(problems.length);
  for (const problem of problems) {
    assert.equal(problem.kind, 'syntax');
    assert.ok(problem.from >= 0 && problem.from <= text.length);
    assert.ok(problem.to >= problem.from && problem.to <= text.length);
  }
});

test('all configuration problems retain field paths without inventing line positions', () => {
  const problems = yamlProblems('prepare: []\nmaster-flow: {}\npipeline:\n  main:\n    nodes:\n      - name: task\n        depends_on: [missing]\n');
  assert.ok(problems.length >= 3);
  assert.ok(problems.some(problem => problem.message.startsWith('prepare:')));
  assert.ok(problems.some(problem => problem.message.includes('depends_on')));
  for (const problem of problems) {
    assert.equal(problem.kind, 'configuration');
    assert.equal(problem.from, undefined);
  }
});

test('root shape and alias errors are reported without crashing diagnostics', () => {
  assert.ok(yamlProblems('[]').some(problem => problem.kind === 'configuration'));
  assert.ok(yamlProblems('pipeline: *unknown').length);
});
