/* =========================================================================
 * Server integration tests (Node built-ins only, no npm install).
 * Run:  node tests/server.js
 *
 * Starts the real HTTP server on a random port against a temporary SQLite
 * file, then checks the rules that must hold on the server: accounts and
 * sessions, optimistic-concurrency writes, empty-overwrite protection,
 * revision history, the Pro gate, the signed billing webhook, the operator
 * CLI, and static-file safety.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-server-'));
process.env.DATA_DIR = TMP;
process.env.BILLING_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.LOGIN_MAX_ATTEMPTS = '10';

const config = require('../server/config');
const { createServer } = require('../server/index');
const cli = require('../server/cli');

const SAMPLE = JSON.parse(fs.readFileSync(path.join(config.ROOT, 'sample-data.json'), 'utf8'));

let passed = 0;
const pending = [];
function check(name, fn) {
  pending.push(async () => { await fn(); passed++; console.log('  ✓ ' + name); });
}

let base, server, cookie = '';

async function call(method, url, body, opts) {
  const headers = Object.assign({}, opts && opts.headers);
  if (cookie && !(opts && opts.noCookie)) headers.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(base + url, { method: method, headers: headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json: json, text: text, headers: res.headers, setCookie: setCookie };
}

function cookieFrom(setCookie) {
  return setCookie ? setCookie.split(';')[0] : '';
}

function sign(body) {
  return 'sha256=' + crypto.createHmac('sha256', config.BILLING_WEBHOOK_SECRET).update(body).digest('hex');
}

check('health reports the version and that checkout is not configured', async () => {
  const r = await call('GET', '/api/health', undefined, { noCookie: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.billing.checkout, 'not_configured');
  assert.strictEqual(r.json.billing.webhook, 'configured');
});

check('static files: app is served; server code, tests, data and traversal are not', async () => {
  assert.strictEqual((await call('GET', '/', undefined, { noCookie: true })).status, 200);
  const js = await call('GET', '/js/app.js', undefined, { noCookie: true });
  assert.strictEqual(js.status, 200);
  assert.ok(/javascript/.test(js.headers.get('content-type')));
  for (const u of ['/server/config.js', '/server/api.js', '/tests/server.js', '/data/teamballstats.db',
    '/.git/config', '/%2e%2e/package.json', '/js/../server/config.js', '/README.md.bak']) {
    const r = await call('GET', u, undefined, { noCookie: true });
    assert.strictEqual(r.status, 404, u + ' should be 404, got ' + r.status);
  }
});

check('registration validates input and sets an HttpOnly session cookie', async () => {
  let r = await call('POST', '/api/auth/register', { username: 'al', password: 'longenough' }, { noCookie: true });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/auth/register', { username: 'alice', password: 'short' }, { noCookie: true });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/auth/register', 'not json', { noCookie: true, headers: { 'Content-Type': 'text/plain' } });
  assert.strictEqual(r.status, 415);
  r = await call('POST', '/api/auth/register', { username: 'Alice', password: 'correct-horse-1' }, { noCookie: true });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.user.username, 'alice', 'usernames are normalised');
  assert.ok(/HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie));
  cookie = cookieFrom(r.setCookie);
  r = await call('POST', '/api/auth/register', { username: 'alice', password: 'correct-horse-1' }, { noCookie: true });
  assert.strictEqual(r.status, 409);
});

check('the database stores a password hash and only a hash of the session token', async () => {
  const row = server.database.prepare("SELECT password_hash FROM users WHERE username = 'alice'").get();
  assert.ok(row.password_hash.indexOf('scrypt$') === 0);
  assert.ok(row.password_hash.indexOf('correct-horse-1') < 0);
  const token = decodeURIComponent(cookie.split('=')[1]);
  const direct = server.database.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(token);
  assert.strictEqual(direct, undefined, 'raw token is not stored');
  const hashed = server.database.prepare('SELECT token_hash FROM sessions WHERE token_hash = ?').get(crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(hashed, 'sha256 of the token is stored');
});

check('me requires a session; without one the API says sign in', async () => {
  let r = await call('GET', '/api/auth/me', undefined, { noCookie: true });
  assert.strictEqual(r.status, 401);
  r = await call('GET', '/api/auth/me');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.username, 'alice');
  assert.strictEqual(r.json.entitlement.plan, 'free');
});

check('a new account has no cloud copy yet (revision 0)', async () => {
  const r = await call('GET', '/api/league');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.revision, 0);
  assert.strictEqual(r.json.document, null);
});

check('first write with baseRevision 0 creates revision 1 and stores normalised data', async () => {
  const r = await call('PUT', '/api/league', { baseRevision: 0, document: SAMPLE });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.revision, 1);
  assert.strictEqual(r.json.summary.games, 3);
  const g = await call('GET', '/api/league');
  assert.strictEqual(g.json.document.teams.length, 4);
});

check('a stale write gets 409 with the server copy and does not overwrite anything', async () => {
  const modified = JSON.parse(JSON.stringify(SAMPLE));
  modified.games.forEach(x => { x.notes = 'stale device'; });
  const r = await call('PUT', '/api/league', { baseRevision: 0, document: modified });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.error, 'conflict');
  assert.strictEqual(r.json.revision, 1);
  assert.ok(r.json.document && r.json.document.games.length === 3, 'server copy is returned for merging');
  const g = await call('GET', '/api/league');
  assert.strictEqual(g.json.revision, 1);
  assert.ok(!g.json.document.games.some(x => x.notes === 'stale device'), 'stale data was not written');
});

check('an empty league cannot replace data unless the client explicitly allows it', async () => {
  const empty = { teams: [], players: [], games: [], league: SAMPLE.league };
  let r = await call('PUT', '/api/league', { baseRevision: 1, document: empty });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.error, 'empty_overwrite');
  r = await call('GET', '/api/league');
  assert.strictEqual(r.json.revision, 1, 'still revision 1');
  r = await call('PUT', '/api/league', { baseRevision: 1, document: empty, allowEmpty: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.revision, 2);
  r = await call('PUT', '/api/league', { baseRevision: 2, document: SAMPLE });
  assert.strictEqual(r.json.revision, 3);
});

check('invalid uploads are rejected with a clear error and nothing is written', async () => {
  let r = await call('PUT', '/api/league', { baseRevision: 3, document: { hello: 'world' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.error, 'invalid_document');
  r = await call('PUT', '/api/league', { document: SAMPLE });
  assert.strictEqual(r.status, 400, 'baseRevision is required');
  r = await call('PUT', '/api/league', { baseRevision: -1, document: SAMPLE });
  assert.strictEqual(r.status, 400);
  r = await call('PUT', '/api/league', '[1,2]', { headers: { 'Content-Type': 'application/json' } });
  assert.strictEqual(r.status, 400);
  r = await call('GET', '/api/league');
  assert.strictEqual(r.json.revision, 3);
});

check('revision history keeps every accepted write and can be read back', async () => {
  const list = await call('GET', '/api/league/revisions');
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual(list.json.revisions.map(r => r.revision), [3, 2, 1]);
  const old = await call('GET', '/api/league/revisions/1');
  assert.strictEqual(old.status, 200);
  assert.strictEqual(old.json.document.games.length, 3);
  assert.strictEqual((await call('GET', '/api/league/revisions/99')).status, 404);
  assert.strictEqual((await call('GET', '/api/league/revisions/abc')).status, 404);
});

check('insight endpoints allow every account but protect cloud data with sign-in', async () => {
  let r = await call('POST', '/api/pro/recap', { gameId: 'game-1' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.measured);
  r = await call('POST', '/api/pro/lineups', {});
  assert.strictEqual(r.status, 200);
  r = await call('POST', '/api/pro/recap', { gameId: 'game-1' }, { noCookie: true });
  assert.strictEqual(r.status, 401, 'signed-out users get 401, not a Pro answer');
});

check('checkout is not faked: 501 payments_not_configured', async () => {
  const r = await call('POST', '/api/billing/checkout', {});
  assert.strictEqual(r.status, 501);
  assert.strictEqual(r.json.error, 'payments_not_configured');
  const s = await call('GET', '/api/billing/status');
  assert.strictEqual(s.json.checkout, 'not_configured');
  assert.strictEqual(s.json.entitlement.active, false);
});

check('the billing webhook rejects missing or wrong signatures', async () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'entitlement.activated', data: { username: 'alice' } });
  let r = await call('POST', '/api/billing/webhook', body, { noCookie: true });
  assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/billing/webhook', body, { noCookie: true, headers: { 'Content-Type': 'application/json', 'X-TBS-Signature': 'sha256=' + '0'.repeat(64) } });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(server.database.prepare("SELECT COUNT(*) AS n FROM entitlements").get().n, 0, 'no entitlement was granted');
});

check('a signed activation grants Pro; a duplicate event id is ignored', async () => {
  const body = JSON.stringify({ id: 'evt_2', type: 'entitlement.activated', data: { username: 'alice', periodEnd: new Date(Date.now() + 86400e3).toISOString() } });
  const hdr = { 'Content-Type': 'application/json', 'X-TBS-Signature': sign(body) };
  let r = await call('POST', '/api/billing/webhook', body, { noCookie: true, headers: hdr });
  assert.strictEqual(r.status, 200);
  r = await call('POST', '/api/billing/webhook', body, { noCookie: true, headers: hdr });
  assert.strictEqual(r.json.duplicate, true);
  const me = await call('GET', '/api/auth/me');
  assert.strictEqual(me.json.entitlement.active, true);
  assert.strictEqual(me.json.entitlement.source, 'webhook');
});

check('Pro recap and lineups run on the server for an entitled account', async () => {
  let r = await call('POST', '/api/pro/recap', { gameId: 'game-1' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.measured && r.json.measured.score, 'recap has measured figures');
  assert.ok(Array.isArray(r.json.analysis) && r.json.analysis.length > 0, 'recap has analysis items');
  assert.ok(r.json.analysis.every(a => a.basis), 'every analysis item states its basis');
  assert.ok(/not a language-model/.test(r.json.labels.analysis), 'analysis is labelled as rule-based, not AI');
  r = await call('POST', '/api/pro/recap', { gameId: 'no-such-game' });
  assert.strictEqual(r.status, 404);
  r = await call('POST', '/api/pro/lineups', {});
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json.rankings), 'lineup rankings returned');
  assert.ok(typeof r.json.note === 'string', 'explains when there is no substitution data');
});

check('a webhook for an unknown user is refused and leaves no billing event behind', async () => {
  const body = JSON.stringify({ id: 'evt_3', type: 'entitlement.activated', data: { username: 'nobody' } });
  const r = await call('POST', '/api/billing/webhook', body, { noCookie: true, headers: { 'Content-Type': 'application/json', 'X-TBS-Signature': sign(body) } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(server.database.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE event_id = 'evt_3'").get().n, 0, 'transaction rolled back');
});

check('a legacy cancellation webhook does not gate insights', async () => {
  const body = JSON.stringify({ id: 'evt_4', type: 'entitlement.canceled', data: { username: 'alice' } });
  const r = await call('POST', '/api/billing/webhook', body, { noCookie: true, headers: { 'Content-Type': 'application/json', 'X-TBS-Signature': sign(body) } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await call('POST', '/api/pro/recap', { gameId: 'game-1' })).status, 200);
});

check('operator CLI grants and revokes a manual Pro entitlement, with an audit entry', async () => {
  assert.strictEqual(cli.main(['grant-pro', 'alice', '--days', '5']), 0);
  const me = await call('GET', '/api/auth/me');
  assert.strictEqual(me.json.entitlement.active, true);
  assert.strictEqual(me.json.entitlement.source, 'manual');
  assert.strictEqual((await call('POST', '/api/pro/recap', { gameId: 'game-1' })).status, 200);
  assert.strictEqual(cli.main(['revoke-pro', 'alice']), 0);
  assert.strictEqual((await call('POST', '/api/pro/recap', { gameId: 'game-1' })).status, 200);
  assert.strictEqual(cli.main(['grant-pro', 'alice', '--days', '0']), 1, 'bad --days refused');
  assert.strictEqual(cli.main(['grant-pro', 'ghost']), 1, 'unknown user refused');
  const audit = server.database.prepare("SELECT action FROM audit_log WHERE actor = 'cli' ORDER BY id").all().map(r => r.action);
  assert.deepStrictEqual(audit, ['entitlement.manual_grant', 'entitlement.manual_revoke']);
});

check('expired legacy entitlements do not gate insights', async () => {
  server.database.prepare("UPDATE entitlements SET period_end = ? WHERE user_id = (SELECT id FROM users WHERE username = 'alice')")
    .run(new Date(Date.now() - 1000).toISOString());
  assert.strictEqual(cli.main(['grant-pro', 'alice', '--days', '1']), 0);
  server.database.prepare("UPDATE entitlements SET period_end = ? WHERE user_id = (SELECT id FROM users WHERE username = 'alice')")
    .run(new Date(Date.now() - 1000).toISOString());
  assert.strictEqual((await call('POST', '/api/pro/recap', { gameId: 'game-1' })).status, 200);
});

check('logout clears the cookie and invalidates the session', async () => {
  const old = cookie;
  const r = await call('POST', '/api/auth/logout', {});
  assert.strictEqual(r.status, 200);
  assert.ok(/Max-Age=0/.test(r.setCookie));
  assert.strictEqual((await call('GET', '/api/league')).status, 401);
  cookie = old;
  assert.strictEqual((await call('GET', '/api/league')).status, 401, 'old token is dead on the server');
});

check('sign-in: wrong password is refused generically; repeated failures are throttled', async () => {
  await call('POST', '/api/auth/register', { username: 'bob', password: 'correct-horse-1' }, { noCookie: true });
  let r = await call('POST', '/api/auth/login', { username: 'bob', password: 'wrong-password' }, { noCookie: true });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.error, 'invalid_credentials');
  for (let i = 0; i < 9; i++) await call('POST', '/api/auth/login', { username: 'bob', password: 'nope-nope' }, { noCookie: true });
  r = await call('POST', '/api/auth/login', { username: 'bob', password: 'correct-horse-1' }, { noCookie: true });
  assert.strictEqual(r.status, 429, 'correct password is also blocked during the lockout');
});

check('sign-in with the right password works and returns a session', async () => {
  const r = await call('POST', '/api/auth/login', { username: 'alice', password: 'correct-horse-1' }, { noCookie: true });
  assert.strictEqual(r.status, 200);
  cookie = cookieFrom(r.setCookie);
  assert.strictEqual((await call('GET', '/api/auth/me')).status, 200);
});

check('a body over the size limit is refused with 413', async () => {
  const big = 'x'.repeat(config.MAX_BODY_BYTES + 10);
  const r = await call('PUT', '/api/league', '{"baseRevision":3,"document":"' + big + '"}');
  assert.strictEqual(r.status, 413);
});

check('unknown API routes and wrong methods get JSON errors', async () => {
  assert.strictEqual((await call('GET', '/api/nope')).json.error, 'not_found');
  assert.strictEqual((await call('DELETE', '/api/league')).status, 405);
});

(async () => {
  server = createServer({ dbFile: path.join(TMP, 'teamballstats.db') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('Server on ' + base + ' (temporary database in ' + TMP + ')');
  let failed = null;
  for (const run of pending) {
    try { await run(); } catch (err) { failed = err; break; }
  }
  server.close();
  server.database.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  if (failed) {
    console.error('\n✗ FAILED after ' + passed + ' checks:', failed && failed.stack || failed);
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ ' + passed + ' server tests passed.');
})();
