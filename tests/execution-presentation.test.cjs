const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ex = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/executionPresentation.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(ex);
const {nodePresentation,requestExecutionSummary} = ex;
const nodes = [{name:'song'}, {name:'cover'}];
const request = (status,nodeStates={}) => ({status,nodeStates});
test('queued nodes explain resources and dependencies, blocked nodes remain failures', () => {
 assert.equal(nodePresentation({status:'queue',reason:'Waiting for GPU resources'}).label,'Waiting for GPU resources');
 assert.equal(nodePresentation({status:'queue',reason:'Waiting for dependencies'}).status,'queue');
 assert.equal(nodePresentation({status:'failed',reason:'Blocked: dependency song failed'}).label,'Blocked');
});
test('terminal request cannot display stale running or queued nodes as active', () => {
 for (const status of ['process_failed','succeeded','retrieve_artifact_failed','artifact_available']) {
  assert.equal(nodePresentation({status:'running'},status).status,'unconfirmed');
  const summary=requestExecutionSummary(request(status,{song:{status:'running'},cover:{status:'queue'}}),nodes);
  assert.ok(summary.includes('Final state not reported'));
  assert.ok(!summary.includes('Running:'));
 }
 assert.equal(nodePresentation({status:'failed'},'process_failed').status,'failed');
 assert.equal(nodePresentation({status:'succeeded'},'succeeded').status,'succeeded');
});
test('request item uses only selected pipeline nodes and distinguishes worker queue', () => {
 assert.equal(requestExecutionSummary(request('possessed'),nodes),'Queued on worker; no node running');
 assert.equal(requestExecutionSummary(request('waiting'),nodes),'Waiting for worker');
 assert.equal(requestExecutionSummary(request('processing',{removed:{status:'running'}}),nodes),'No node currently running');
 assert.equal(requestExecutionSummary(request('processing',{song:{status:'running'}}),nodes),'Running: song');
});
