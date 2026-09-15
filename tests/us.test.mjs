import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../server/api.mjs';
import worker from '../server/worker.mjs';
import { authenticate } from '../server/auth.mjs';
import { validSet, newGame, joinGame, takeTurn, gameView } from '../server/game.mjs';
import { localDb } from '../scripts/local-db.mjs';
const a = 'you@example.test', b = 'partner@example.test';
const env = () => ({ ACCESS_ALLOWED_EMAILS: `${a},${b}`, US_DB: localDb() });
const req = (path, body, origin = 'https://example.com') => new Request(`https://example.com/us/api/${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin }, body: body === undefined ? undefined : JSON.stringify(body),
});
test('drafts stay author-only, shared letters open, recipient cannot overwrite, stale edits fail', async () => {
  const e = env();
  const { id } = await (await api(req('letters', { title: 'you need a smile', body: '<script>private words</script>', status: 'draft' }), e, a)).json();
  assert.deepEqual((await (await api(req('letters'), e, b)).json()).letters, []);
  await assert.rejects(api(req(`letters/${id}`), e, b), { status: 404 });
  await assert.rejects(api(req('letters', { id, version: 1, title: 'stolen', body: 'x', status: 'shared' }), e, b), { status: 409 });
  await api(req('letters', { id, version: 1, title: 'you need a smile', body: '<script>private words</script>', status: 'shared' }), e, a);
  const list = await (await api(req('letters'), e, b)).json();
  assert.equal(list.letters.length, 1); assert.equal(list.letters[0].body, undefined);
  assert.equal((await (await api(req(`letters/${id}`), e, b)).json()).body, '<script>private words</script>');
  await api(req(`letters/${id}/open`, {}), e, b);
  assert.ok((await (await api(req(`letters/${id}`), e, a)).json()).opened_at);
  await assert.rejects(api(req('letters', { id, version: 1, title: 'x', body: 'x', status: 'draft' }), e, a), { status: 409 });
  await assert.rejects(api(req('letters', { title: 'x', body: 'x', status: 'draft' }, 'https://evil.example'), e, a), { status: 403 });
  e.US_DB.close();
});
test('game responses hide the opponent rack and pile; stale moves cannot overwrite a turn', async () => {
  const e = env();
  const first = await (await api(req('game', { action: 'new' }), e, a)).json();
  assert.equal(first.game.hand.length, 14); assert.equal(first.game.pile, undefined); assert.equal(first.game.hands, undefined);
  const joined = await (await api(req('game', { action: 'join', version: 1 }), e, b)).json();
  assert.equal(joined.game.hand.length, 14);
  await assert.rejects(api(req('game', { action: 'draw', version: 1 }), e, a), { status: 409 });
  await api(req('game', { action: 'draw', version: 2 }), e, a);
  await assert.rejects(api(req('game', { action: 'draw', version: 2 }), e, a), { status: 409 });
  assert.equal((await (await api(req('game'), e, a)).json()).game.hand.length, 15);
  e.US_DB.close();
});
test('tile sets reject duplicates, gaps, and invalid colors', () => {
  assert.ok(validSet(['red-10-0', 'red-11-0', 'red-12-0']));
  assert.ok(validSet(['red-8-0', 'gold-8-0', 'blue-8-0']));
  assert.ok(!validSet(['red-8-0', 'red-8-1', 'blue-8-0']));
  assert.ok(!validSet(['red-1-0', 'red-3-0', 'red-4-0']));
  assert.ok(!validSet(['red-1-0', 'red-1-0', 'red-1-0']));
});
test('first meld threshold, turn ownership, board preservation, rearrangement and winning', () => {
  let g = joinGame(newGame(a), b);
  g.hands[a] = ['red-10-0', 'red-11-0', 'red-12-0', 'blue-3-0'];
  assert.throws(() => takeTurn(g, b, 'draw'), /Wait/);
  assert.throws(() => takeTurn(g, a, 'play', [['red-10-0', 'red-11-0', 'blue-3-0']]), /Every set/);
  let n = takeTurn(g, a, 'play', [['red-10-0', 'red-11-0', 'red-12-0']]);
  assert.deepEqual(n.hands[a], ['blue-3-0']); assert.equal(n.turn, b); assert.ok(n.opened[a]);
  n.turn = a; n.hands[a] = ['red-13-0'];
  assert.throws(() => takeTurn(n, a, 'play', [['red-11-0', 'red-12-0', 'red-13-0']]), /every tile/);
  const won = takeTurn(n, a, 'play', [['red-10-0', 'red-11-0', 'red-12-0', 'red-13-0']]);
  assert.equal(won.winner, a); assert.equal(won.status, 'finished');
  g.hands[a] = ['blue-1-0', 'blue-2-0', 'blue-3-0'];
  assert.throws(() => takeTurn(g, a, 'play', [g.hands[a]]), /30 points/);
  assert.equal(gameView(g, b, 1).hands, undefined);
});
test('unconfigured or unsigned requests fail closed, including the HTML route', async () => {
  const assets = { fetch: async () => new Response('public home') };
  assert.equal((await worker.fetch(new Request('https://example.com/'), { ASSETS: assets })).status, 200);
  for (const path of ['/us', '/us/', '/us/index.html', '/us/api/letters']) {
    const response = await worker.fetch(new Request(`https://example.com${path}`), { ASSETS: assets });
    assert.equal(response.status, 503); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.ok(!(await response.text()).includes('public home'));
  }
});
test('Access verifies signature, audience, expiry and two-person membership', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key' };
  const issuer = 'https://test-team.cloudflareaccess.com';
  const e = { ...env(), ACCESS_ISSUER: issuer, ACCESS_AUD: 'test-audience' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  async function signed(claims = {}, corrupt = false) {
    const payload = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: issuer, aud: ['test-audience'], exp: Date.now() / 1000 + 600, sub: 'person', type: 'app', email: a, ...claims })}`;
    const signature = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(payload)));
    if (corrupt) signature[0] ^= 1;
    return new Request('https://example.com/us/', { headers: { 'Cf-Access-Jwt-Assertion': `${payload}.${signature.toString('base64url')}` } });
  }
  try {
    assert.equal(await authenticate(await signed(), e), a);
    const logoutRequest = await signed();
    const logout = await worker.fetch(new Request('https://example.com/us/logout', { headers: logoutRequest.headers }), e);
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get('location'), `${issuer}/cdn-cgi/access/logout`);
    assert.ok(logout.headers.getSetCookie().some(c => c.includes('Path=/us;') && c.includes('Max-Age=0')));
    assert.match(logout.headers.get('cache-control'), /no-store/);
    await assert.rejects(authenticate(await signed({}, true), e), { status: 401 });
    await assert.rejects(authenticate(await signed({ aud: ['wrong'] }), e), { status: 401 });
    await assert.rejects(authenticate(await signed({ exp: 1 }), e), { status: 401 });
    await assert.rejects(authenticate(await signed({ email: 'stranger@example.test' }), e), { status: 403 });
    await assert.rejects(authenticate(new Request('https://example.com/us/'), e), { status: 401 });
  } finally { globalThis.fetch = originalFetch; e.US_DB.close(); }
});
