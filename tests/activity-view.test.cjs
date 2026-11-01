const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');

function renderActivity(results, realQueries = false) {
  const React = require('react');
  const convex = require('convex/react');
  const client = {
    watchQuery(query) {
      return { localQueryResult: () => query === 'units:list' ? results.units : results.activity };
    },
  };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const source = fs.readFileSync(path.join(__dirname, '../src/components', `${name}.tsx`), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    new Function('require', 'exports', compiled)(id => {
      if (id === 'convex/react') return { useQueries: realQueries ? queries => {
        const value = convex.useQueries(queries);
        // Force a subsequent render, as a live subscription or parent update does.
        const [rendered, setRendered] = React.useState(false);
        if (!rendered) setRendered(true);
        return value;
      } : () => results };
      if (id === '../../convex/_generated/api') return { api: { units: { list: 'units:list' }, requests: { listActive: 'requests:listActive' } } };
      if (id.endsWith('.css')) return {};
      if (id.startsWith('./')) return load(id.slice(2));
      return require(id);
    }, exports);
    return exports;
  }
  const view = React.createElement(load('ActivityView').ActivityView, { connected: true });
  return renderToStaticMarkup(realQueries ? React.createElement(convex.ConvexProvider, { client }, view) : view);
}

const unit = { _id: 'unit-record', unitId: 'unit-one', status: 'online', devices: [], lastSeen: 1000 };

test('missing backend query displays a sync hint while units remain visible', () => {
  const html = renderActivity({ units: [unit], activity: new Error("Could not find public function for 'requests:listActive'.") });
  assert.match(html, /unit-one/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Sync the backend functions/);
  assert.doesNotMatch(html, /Loading active requests|No requests are currently/);
});

test('a units query error leaves active request data visible', () => {
  const html = renderActivity({ units: new Error('Server unavailable'), activity: { requests: [
    { _id: 'request-one', status: 'processing', unitId: 'unit-one', nodes: [{ name: 'render', status: 'running' }] },
  ], truncated: false } });
  assert.match(html, /Could not load units/);
  assert.match(html, /request-one/);
  assert.match(html, /Running/);
});

test('loading, empty results, and restored query results render without errors', () => {
  const loading = renderActivity({ units: undefined, activity: undefined });
  assert.match(loading, /Loading units/);
  assert.match(loading, /Loading active requests/);
  const empty = renderActivity({ units: [], activity: { requests: [], truncated: false } });
  assert.match(empty, /No units registered/);
  assert.match(empty, /No requests are currently/);
  const restored = renderActivity({ units: [unit], activity: { requests: [], truncated: false } });
  assert.match(restored, /unit-one/);
  assert.doesNotMatch(restored, /role="alert"/);
});

test('Activity survives a subsequent render with the real Convex subscription hook', () => {
  const html = renderActivity({ units: [unit], activity: { requests: [], truncated: false } }, true);
  assert.match(html, /unit-one/);
  assert.match(html, /No requests are currently/);
});
