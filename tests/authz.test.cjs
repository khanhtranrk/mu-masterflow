const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { ConvexError } = require('convex/values');
const source = fs.readFileSync('convex/authz.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const authz = {};
new Function('require', 'exports', compiled)(id => id === './_generated/server' ? { env: process.env } : require(id), authz);
const issuer = 'https://example.clerk.accounts.dev';
const identity = { issuer, subject: 'user_allowed', tokenIdentifier: `${issuer}|user_allowed` };
const config = { issuer, userIds: '["user_allowed"]', emails: '["allowed@example.com"]' };

test('requires trusted issuer and identity; empty or malformed policy fails closed', () => {
  assert.equal(authz.accessDecision(null, config), 'unauthenticated');
  for (const policy of [{}, { issuer }, { ...config, issuer: undefined },
    { ...config, emails: '{broken' }, { ...config, userIds: '[1]' },
    { ...config, emails: '[""]' }, { ...config, userIds: '{}' }]) {
    assert.equal(authz.accessDecision(identity, policy), 'denied');
  }
  assert.equal(authz.accessDecision({ ...identity, issuer: 'https://old-auth.example' }, config), 'denied');
  assert.equal(authz.accessDecision({ ...identity, subject: '' }, config), 'denied');
});

test('ID or verified primary email grants access without changing shared permissions', () => {
  assert.equal(authz.accessDecision(identity, config), 'allowed');
  const other = { ...identity, subject: 'user_other', email: ' Allowed@Example.COM ' };
  assert.equal(authz.accessDecision({ ...other, emailVerified: true }, config), 'allowed');
  for (const verified of [undefined, false, 'true', 1]) {
    assert.equal(authz.accessDecision({ ...other, emailVerified: verified }, config), 'denied');
  }
  assert.equal(authz.accessDecision({ ...other, emailVerified: true, email: 'xallowed@example.com' }, config), 'denied');
  assert.equal(authz.accessDecision({ ...identity, subject: 'USER_ALLOWED' }, config), 'denied');
  assert.equal(authz.accessDecision({ ...other, emailVerified: false, unsafeMetadata: { allowed: true } }, config), 'denied');
});

test('backend guard enforces current policy on every call and returns stable Clerk subject', async () => {
  const keys = ['CLERK_JWT_ISSUER_DOMAIN', 'AUTH_ALLOWED_USER_IDS', 'AUTH_ALLOWED_EMAILS'];
  const before = keys.map(key => process.env[key]);
  try {
    process.env.CLERK_JWT_ISSUER_DOMAIN = issuer;
    process.env.AUTH_ALLOWED_USER_IDS = config.userIds;
    process.env.AUTH_ALLOWED_EMAILS = '[]';
    const ctx = { auth: { getUserIdentity: async () => identity } };
    assert.equal(await authz.requireAuthenticated(ctx), 'user_allowed');
    process.env.AUTH_ALLOWED_USER_IDS = '[]';
    await assert.rejects(() => authz.requireAuthenticated(ctx), e => e instanceof ConvexError && e.data.code === 'ACCESS_DENIED');
    await assert.rejects(() => authz.requireAuthenticated({ auth: { getUserIdentity: async () => null } }),
      e => e instanceof ConvexError && e.data.code === 'UNAUTHENTICATED');
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
  }
});
