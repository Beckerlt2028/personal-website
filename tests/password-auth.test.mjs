import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.mjs';
import { localDb } from '../scripts/local-db.mjs';

const email = 'you@example.test';
function environment() {
  return { AUTH_MODE: 'firebase', FIREBASE_API_KEY: 'test-api-key-1234567890123456', FIREBASE_PROJECT_ID: 'test-project',
    SESSION_ENCRYPTION_KEY: 'ab'.repeat(32), ACCESS_ALLOWED_EMAILS: `${email},partner@example.test`, US_DB: localDb(),
    ASSETS: { fetch: async () => new Response('page') } };
}
function request(action, data = {}, cookie = '', origin = 'https://example.com') {
  return new Request(`https://example.com/us/auth/${action}`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'CF-Connecting-IP': '192.0.2.1' }, body: JSON.stringify(data) });
}
const login = (env, remember = true) => worker.fetch(request('login', { email, password: 'sample password only', remember }), env);
const cookie = response => response.headers.get('set-cookie')?.split(';')[0];
const read = (env, value, path = '/us/api/me') => worker.fetch(new Request(`https://example.com${path}`, { headers: { cookie: value || '' } }), env);
function provider(options = {}) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const action = new URL(url).pathname.split(':').pop(); calls.push(action);
    if (options.unavailable) return new Response('', { status: 503 });
    if (action === 'signInWithPassword' || action === 'signUp') {
      if (options.invalid) return Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 });
      return Response.json({ idToken: 'server-issued-token', refreshToken: 'server-refresh-secret', localId: 'uid-one', email, expiresIn: '3600' });
    }
    if (action === 'lookup') return Response.json({ users: [{ localId: 'uid-one', email, emailVerified: true, validSince: '1', ...options.user }] });
    if (action === '/v1/token') return Response.json({ id_token: 'refreshed-token', refresh_token: 'refreshed-secret', user_id: 'uid-one', expires_in: '3600' });
    if (action === 'sendOobCode') return Response.json({ email });
    throw new Error(`Unexpected provider call: ${url}`);
  } };
}
async function scenario(run, options = {}) {
  const env = environment(), original = globalThis.fetch, stub = provider(options); globalThis.fetch = stub.fetch;
  try { await run(env, stub, options); } finally { globalThis.fetch = original; env.US_DB.close(); }
}

test('password login creates an encrypted, opaque 30-day cookie; logout revokes it', async () => scenario(async env => {
  const response = await login(env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /__Host-us_session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000/);
  assert.deepEqual(await response.json(), { ok: true });
  const row = await env.US_DB.prepare('SELECT * FROM password_sessions').first();
  assert.ok(!row.tokens.includes('server-')); assert.ok(!cookie(response).includes(row.id_hash));
  assert.equal(row.expires_at - row.created_at, 2592000);
  const identity = await read(env, cookie(response)); assert.equal(identity.status, 200);
  assert.equal((await identity.json()).me, email);
  assert.equal((await worker.fetch(request('logout', {}, cookie(response), 'https://evil.test'), env)).status, 403);
  const out = await worker.fetch(request('logout', {}, cookie(response)), env);
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await read(env, cookie(response))).status, 401);
}));

test('unchecked remember uses a session cookie; refresh keeps the original absolute expiry', async () => scenario(async (env, stub) => {
  const response = await login(env, false); assert.equal(response.status, 200);
  assert.ok(!response.headers.get('set-cookie').includes('Max-Age'));
  const before = await env.US_DB.prepare('SELECT * FROM password_sessions').first();
  assert.equal(before.expires_at - before.created_at, 86400);
  await env.US_DB.prepare('UPDATE password_sessions SET token_expires_at = 1').run();
  assert.equal((await read(env, cookie(response))).status, 200);
  assert.ok(stub.calls.includes('/v1/token'));
  const after = await env.US_DB.prepare('SELECT * FROM password_sessions').first();
  assert.equal(after.expires_at, before.expires_at); assert.notEqual(after.tokens, before.tokens);
  await env.US_DB.prepare('UPDATE password_sessions SET expires_at = 1').run();
  assert.equal((await read(env, cookie(response))).status, 401);
}));

test('unverified users cannot read private content; setup sends verification without a session', async () => scenario(async env => {
  const response = await login(env); assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await response.json()).needsVerification, true);
  const signup = await worker.fetch(request('register', { email, password: 'a long sample password' }), env);
  assert.equal(signup.status, 200); assert.equal(signup.headers.get('set-cookie'), null);
  assert.equal((await env.US_DB.prepare('SELECT count(*) AS total FROM password_sessions').first()).total, 0);
}, { user: { emailVerified: false } }));

test('outsiders and cross-origin requests cannot sign in or trigger account emails', async () => scenario(async (env, stub) => {
  assert.equal((await worker.fetch(request('login', { email, password: 'x' }, '', 'https://evil.test'), env)).status, 403);
  assert.equal((await worker.fetch(request('login', { email: 'outsider@example.test', password: 'x' }), env)).status, 401);
  assert.equal((await worker.fetch(request('reset', { email: 'outsider@example.test' }), env)).status, 200);
  assert.deepEqual(stub.calls, []);
  assert.equal((await read(env, '__Host-us_session=' + 'a'.repeat(64))).status, 401);
}));

test('disabled accounts, changed emails, and password revocation invalidate existing sessions', async () => {
  for (const user of [{ disabled: true }, { email: 'other@example.test' }, { validSince: String(Math.floor(Date.now() / 1000) + 60) }]) {
    await scenario(async (env, stub, options) => {
      const response = await login(env); assert.equal(response.status, 200);
      options.user = user;
      assert.equal((await read(env, cookie(response))).status, 401);
      assert.equal((await env.US_DB.prepare('SELECT count(*) AS total FROM password_sessions').first()).total, 0);
    });
  }
});

test('temporary provider outage preserves the session but denies access', async () => scenario(async (env, stub, options) => {
  const response = await login(env); options.unavailable = true;
  assert.equal((await read(env, cookie(response))).status, 503);
  assert.equal((await env.US_DB.prepare('SELECT count(*) AS total FROM password_sessions').first()).total, 1);
  options.unavailable = false; assert.equal((await read(env, cookie(response))).status, 200);
}));

test('failed login attempts are limited across requests', async () => scenario(async env => {
  for (let attempt = 0; attempt < 12; attempt++) assert.equal((await login(env)).status, 401);
  assert.equal((await login(env)).status, 429);
}, { invalid: true }));

test('only login page is public; APIs fail closed and configuration errors do not fall back to Access', async () => scenario(async env => {
  const canonical = await worker.fetch(new Request('https://www.lukastbecker.com/us/'), env);
  assert.equal(canonical.status, 308); assert.equal(canonical.headers.get('location'), 'https://lukastbecker.com/us/');
  assert.equal((await read(env, '', '/us/login/')).status, 200);
  const page = await read(env, '', '/us/'); assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/us/login/');
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.equal((await read(env, '', '/us/api/letters')).status, 401);
  env.SESSION_ENCRYPTION_KEY = '';
  assert.equal((await read(env, '', '/us/api/letters')).status, 503);
}));
