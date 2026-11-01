const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function render(name, isOwner) {
 const out = {};
 const source = fs.readFileSync(`src/components/${name}.tsx`, 'utf8');
 const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
 const refs = { storage: { list: 'storage:list', configure: 'storage:configure' }, s3: { saveConnection: 's3:save' }, unitTokens: { list: 'tokens:list', create: 'tokens:create', update: 'tokens:update', revoke: 'tokens:revoke' } };
 new Function('require','exports', compiled)(id => {
  if (id === 'convex/react') return { useAction: () => async () => {}, useMutation: () => async () => {}, useQuery: ref => ref === 'storage:list' ? { isOwner, connections: [{ connectionId: 'r2-1', name: 'Media', provider: 'r2', bucket: 'private', enabled: true }] } : [] };
  if (id === '../../convex/_generated/api') return { api: refs };
  if (id === './ui/Input') return { Input: props => React.createElement('input',props) };
  if (id === './ui/SelectField') return { SelectField: props => React.createElement('button', { role: 'combobox', 'aria-label': props.label }, props.value) };
  if (id === './ui/ActionMenu') return { ActionMenu: props => props.trigger };
  if (id.endsWith('.css')) return {};
  return require(id);
 },out);
 return renderToStaticMarkup(React.createElement(out[name]));
}
test('storage settings show stable connections and credential inputs only to owner', () => {
 const owner = render('StorageConnectionsView',true);
 assert.match(owner,/r2-1/); assert.match(owner,/S3 secret access key/); assert.match(owner,/type="password"/); assert.match(owner,/Test and save connection/);
 const reader = render('StorageConnectionsView',false);
 assert.match(reader,/managed by the application owner/); assert.doesNotMatch(reader,/type="password"|Test and save connection/);
});
test('worker-token settings expose unit and spec scope fields to owner', () => {
 const owner = render('UnitTokensView',true);
 assert.match(owner,/Worker unit ID/); assert.match(owner,/Allowed spec slugs/);
 assert.match(render('UnitTokensView',false),/Only the owner/);
});
