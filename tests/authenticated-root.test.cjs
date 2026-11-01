const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function render({ signedIn = true, authenticated = true, loading = false, access = 'allowed', realQueries = false } = {}) {
  const exports = {};
  const source = fs.readFileSync('src/components/AuthenticatedRoot.tsx', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function('require', 'exports', compiled)(id => {
    if (id === '@clerk/react') return {
      useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
      useClerk: () => ({ signOut() {} }),
      SignIn: props => React.createElement('div', null, `Clerk sign-in ${props.routing}`),
    };
    if (id === 'convex/react') return {
      useConvexAuth: () => ({ isLoading: loading, isAuthenticated: authenticated }),
      useQueries: queries => {
        if (realQueries) {
          const result = require('convex/react').useQueries(queries);
          const [rendered, setRendered] = React.useState(false);
          if (!rendered) setRendered(true);
          return result;
        }
        assert.equal(Boolean(queries.access), authenticated);
        return { access: authenticated ? access : undefined };
      },
    };
    if (id === '../../convex/_generated/api') return { api: { auth: { access: 'auth:access' } } };
    if (id === '../App') return { __esModule: true, default: () => React.createElement('div', null, 'BUSINESS WORKSPACE') };
    return require(id);
  }, exports);
  const view = React.createElement(exports.AuthenticatedRoot, {
    serverProfile: { name: 'Test server' }, darkMode: false, onManageServers() {},
  });
  return renderToStaticMarkup(realQueries
    ? React.createElement(require('convex/react').ConvexProvider, { client: { watchQuery: () => ({ localQueryResult: () => access }) } }, view)
    : view);
}

test('business workspace requires verified Convex authentication and backend allowance', () => {
  assert.match(render(), /BUSINESS WORKSPACE/);
  for (const state of [{ loading: true }, { access: null }, { access: 'denied' },
    { access: 'unauthenticated' }, { authenticated: false },
    { signedIn: false, authenticated: false }, { access: new Error('Server offline') }]) {
    assert.doesNotMatch(render(state), /BUSINESS WORKSPACE/);
  }
});

test('signed-out, denied and failed verification have actionable distinct UI', () => {
  assert.match(render({ signedIn: false, authenticated: false }), /Clerk sign-in hash/);
  assert.match(render({ access: 'denied' }), /not been granted access/);
  assert.match(render({ authenticated: false }), /could not be verified/);
  assert.match(render({ access: new Error('offline') }), /Could not check access/);
});

test('real Convex subscriptions remain stable on subsequent auth-gate renders', () => {
  assert.match(render({ realQueries: true }), /BUSINESS WORKSPACE/);
  assert.match(render({ realQueries: true, authenticated: false, signedIn: false }), /Clerk sign-in/);
});
