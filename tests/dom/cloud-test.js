/* =========================================================================
 * Browser-level cloud sync test (optional, needs jsdom — see dom-test.js).
 * Run:  NODE_PATH=/tmp/tbs-dom/node_modules node tests/dom/cloud-test.js
 *
 * Starts the real server on a random port with a temporary database, loads
 * index.html in jsdom and drives the real cloud client through its buttons:
 * account creation, the Pro gate, a stale-write conflict resolved by merge,
 * the empty-league guard, offline queueing, dismissing a dialog, and pull.
 * ========================================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-cloud-'));
process.env.DATA_DIR = TMP;
process.env.BILLING_WEBHOOK_SECRET = 'cloud-test-secret';
const { createServer } = require('../../server/index');

const ROOT = path.resolve(__dirname, '..', '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+\.js)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '<script>/*' + src + '*/\n' + code.replace(/<\/script/g, '<\\/script') + '\n</script>';
});
const sample = fs.readFileSync(path.join(ROOT, 'sample-data.json'), 'utf8');
const SAMPLE = JSON.parse(sample);

const errors = [];
const navigations = [];
const captured = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const t = String(e && e.stack || e); if (/Not implemented: navigation/.test(t)) navigations.push(t); else errors.push(t); });
vc.on('error', e => errors.push('console.error: ' + (e && e.stack || e)));

let base = '';
let server = null;
let jar = '';

/* fetch for jsdom: forwards to the real server and keeps the session cookie. */
async function forwardFetch(url, opts) {
  if (forwardFetch.offline) throw new TypeError('network down');
  const o = opts || {};
  const headers = Object.assign({}, o.headers || {});
  if (jar) headers.Cookie = jar;
  const res = await globalThis.fetch(new URL(url, base), { method: o.method || 'GET', headers: headers, body: o.body, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    const pair = sc.split(';')[0];
    jar = /Max-Age=0/.test(sc) ? '' : pair;
  }
  const text = await res.text();
  return { status: res.status, ok: res.ok, json: async () => JSON.parse(text || 'null'), text: async () => text };
}
forwardFetch.offline = false;

function makeDom(url) {
  return new JSDOM(html, {
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
      window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.localStorage.setItem('bball_tm_v1', sample);
      window.HTMLCanvasElement.prototype.getContext = function () {
        const ctx = { canvas: { width: 300, height: 150 } };
        ['setTransform', 'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'fill', 'stroke', 'fillText', 'strokeText', 'save', 'restore', 'translate', 'scale', 'rotate', 'setLineDash', 'clip', 'quadraticCurveTo', 'bezierCurveTo'].forEach(m => { ctx[m] = () => {}; });
        ctx.measureText = () => ({ width: 10 });
        ctx.createLinearGradient = () => ({ addColorStop() {} });
        ctx.createRadialGradient = () => ({ addColorStop() {} });
        return ctx;
      };
      window.scrollTo = () => {};
      window.URL.createObjectURL = blob => { captured.push({ blob: blob }); return 'blob:tbs/' + captured.length; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { if (this.download) captured.push({ name: this.download }); };
      window.fetch = (u, o) => forwardFetch(u, o);
    }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, label) {
  const end = Date.now() + (ms || 8000);
  let last;
  while (Date.now() < end) {
    try { last = fn(); if (last) return last; } catch (_) { /* keep waiting */ }
    await sleep(60);
  }
  throw new Error('timed out waiting for: ' + (label || fn.toString().slice(0, 80)));
}

let passed = 0;
async function step(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }

async function run() {
  server = createServer({ dbFile: path.join(TMP, 'cloud.db') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  const dom = makeDom(base);
  const { window } = dom;
  const doc = window.document;
  const T = () => window.TBS;
  const $ = s => doc.querySelector(s);
  const click = el => { assert.ok(el, 'element exists'); el.click(); };
  const state = () => T().app.getState();
  const text = s => ($(s) ? $(s).textContent : '');
  const dbUser = name => server.database.prepare('SELECT id FROM users WHERE username = ?').get(name);
  const serverRev = () => (server.database.prepare("SELECT revision FROM leagues WHERE user_id = (SELECT id FROM users WHERE username = 'coach')").get() || { revision: 0 }).revision;
  const serverDoc = () => JSON.parse(server.database.prepare("SELECT document FROM leagues WHERE user_id = (SELECT id FROM users WHERE username = 'coach')").get().document);

  await until(() => doc.readyState === 'complete', 4000);
  await sleep(60);

  /* Unlock the on-device app (same as the DOM test) so the data view is available. */
  await T().auth.register(state(), { role: 'commissioner', username: 'league', password: 'correct-horse-1', confirmPassword: 'correct-horse-1' });
  await T().auth.signIn(state(), { username: 'league', password: 'correct-horse-1' });
  T().app.go('data');
  await sleep(30);

  await step('the cloud panel detects the server and offers sign-in', async () => {
    await until(() => /Create account/.test(text('#cloud-panel')), 6000, 'sign-in form');
    assert.strictEqual($('#cloud-status-chip').textContent, 'Not signed in');
  });

  await step('creating a cloud account pushes the on-device league as revision 1', async () => {
    $('#cloud-user').value = 'coach';
    $('#cloud-pass').value = 'correct-horse-1';
    click($('[data-cloud="register"]'));
    await until(() => T().cloud.state().user && T().cloud.state().user.username === 'coach', 6000, 'signed in');
    await until(() => serverRev() === 1, 8000, 'first push');
    assert.strictEqual(serverDoc().games.length, 3);
  });

  await step('the Pro panel explains the free plan and offers no Pro output', async () => {
    T().boxscores.openGame('game-1');
    T().boxscores.render(state());
    await sleep(30);
    assert.ok(/Free plan/.test(text('#pro-panel')), 'free plan message');
    assert.ok(!$('[data-pro="recap"]'), 'no recap button for free accounts');
  });

  await step('a free account is refused by the server for Pro recap (403)', async () => {
    const r = await T().cloud.request('POST', 'pro/recap', { gameId: 'game-1', document: state() });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.json.error, 'pro_required');
  });

  await step('after an entitlement is granted, the recap is computed on the server and labelled', async () => {
    const u = dbUser('coach');
    server.database.prepare(`INSERT INTO entitlements (user_id, plan, status, source, period_end, updated_at) VALUES (?, 'pro', 'active', 'manual', NULL, ?)`)
      .run(u.id, new Date().toISOString());
    await T().cloud.refreshMe();
    T().boxscores.render(state());
    await sleep(30);
    click($('[data-pro="recap"]'));
    await until(() => /Measured/.test(text('#pro-output')) && /rule-based/.test(text('#pro-output')), 6000, 'recap rendered');
    assert.ok(/Riverside Hawks/.test(text('#pro-output')));
  });

  await step('a stale device gets a conflict dialog; merge combines one-sided edits and downloads backups', async () => {
    /* Another device saves revision 2: it edits game 1 only. */
    const other = JSON.parse(JSON.stringify(serverDoc()));
    other.games[0].notes = 'edited on the other device';
    await T().cloud.request('PUT', 'league', { baseRevision: serverRev(), document: other });
    assert.strictEqual(serverRev(), 2);
    /* This device edits game 2 only, against revision 1. */
    T().app.commit(d => { d.games[1].notes = 'edited on this device'; });
    await until(() => doc.querySelector('.modal [data-cf="merge"]'), 8000, 'conflict dialog');
    assert.ok(/Sync conflict/.test(text('.modal')), 'conflict title');
    assert.ok(/Nothing has been overwritten yet/.test(text('.modal')));
    captured.length = 0;
    click(doc.querySelector('[data-cf="merge"]'));
    await until(() => serverRev() === 3, 8000, 'merge pushed');
    const notes = serverDoc().games.map(g => g.notes);
    assert.ok(notes.indexOf('edited on this device') >= 0, 'this device edit kept');
    assert.ok(notes.indexOf('edited on the other device') >= 0, 'other device edit taken (only it changed that game)');
    assert.strictEqual(state().games[0].notes, 'edited on the other device', 'local copy shows the taken edit');
    assert.ok(captured.filter(c => c.name && /backup/.test(c.name)).length >= 2, 'backups of both copies were downloaded');
  });

  await step('when both devices changed the same game, merge keeps this device and says so', async () => {
    const other = JSON.parse(JSON.stringify(serverDoc()));
    other.games[2].notes = 'cloud version of game 3';
    await T().cloud.request('PUT', 'league', { baseRevision: serverRev(), document: other });
    assert.strictEqual(serverRev(), 4, 'other device saved revision 4');
    T().app.commit(d => { d.games[2].notes = 'device version of game 3'; });
    await until(() => doc.querySelector('.modal [data-cf="merge"]'), 8000, 'conflict dialog for both-edited game');
    click(doc.querySelector('[data-cf="merge"]'));
    await until(() => /changed on both devices/.test(doc.body.textContent), 6000, 'merge report shown');
    await until(() => serverRev() === 5, 8000, 'merge pushed as revision 5');
    assert.strictEqual(serverDoc().games[2].notes, 'device version of game 3', 'this device version kept');
    const cloudBackup = captured.filter(c => c.name && /cloud-backup/.test(c.name)).length;
    assert.ok(cloudBackup >= 1, 'the cloud version was downloaded as a backup');
  });

  await step('closing the conflict dialog with Escape pauses sync without deciding for the user', async () => {
    const other = JSON.parse(JSON.stringify(serverDoc()));
    other.games[0].notes = 'third device';
    await T().cloud.request('PUT', 'league', { baseRevision: serverRev(), document: other });
    T().app.commit(d => { d.games[2].notes = 'local while conflicted'; });
    await until(() => doc.querySelector('.modal [data-cf="later"]'), 8000, 'conflict dialog 2');
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(40);
    assert.ok(!doc.querySelector('.modal [data-cf="later"]'), 'dialog closed');
    assert.strictEqual(T().cloud.state().status, 'conflict');
    assert.ok(serverDoc().games[0].notes === 'third device', 'server copy untouched');
    /* Resolve by pulling the cloud copy explicitly. */
    click($('[data-cloud="pull"]'));
    await sleep(30);
    await until(() => doc.querySelector('.modal [data-cf="cloud"]'), 6000, 'conflict dialog 3');
    click(doc.querySelector('[data-cf="cloud"]'));
    await until(() => state().games[0].notes === 'third device', 6000, 'cloud copy applied');
    await sleep(2000);
  });

  await step('an empty league cannot replace the cloud copy; the user is asked', async () => {
    const before = serverRev();
    T().app.replace({ teams: [], players: [], games: [], league: SAMPLE.league });
    await until(() => doc.querySelector('.modal [data-cf="replace"]'), 8000, 'empty guard dialog');
    assert.strictEqual(serverRev(), before, 'server unchanged');
    click(doc.querySelector('[data-cf="later"]'));
    await sleep(40);
  });

  await step('offline changes are queued, shown as offline, and sync when the server returns', async () => {
    forwardFetch.offline = true;
    T().app.replace(JSON.parse(JSON.stringify(SAMPLE)));
    await until(() => T().cloud.state().status === 'offline', 6000, 'offline status');
    assert.ok(/Offline/.test(text('#cloud-panel')) || /Offline/.test(text('#cloud-state')), 'offline message visible');
    forwardFetch.offline = false;
    /* The retry timer will fire; pressing Sync now also works. */
    click($('[data-cloud="sync"]'));
    await until(() => serverDoc().games.length === 3 && T().cloud.state().status !== 'offline', 10000, 'queued changes synced');
  });

  await step('pull applies a newer cloud revision when this device has no unsynced changes', async () => {
    await sleep(200);
    const other = JSON.parse(JSON.stringify(serverDoc()));
    other.games[1].notes = 'pulled from the cloud';
    await T().cloud.request('PUT', 'league', { baseRevision: serverRev(), document: other });
    click($('[data-cloud="pull"]'));
    await until(() => state().games[1].notes === 'pulled from the cloud', 6000, 'pulled');
  });

  await step('signing out returns the panel to the sign-in form and keeps local data', async () => {
    const games = state().games.length;
    click($('[data-cloud="signout"]'));
    await until(() => /Create account/.test(text('#cloud-panel')), 4000, 'signed out form');
    assert.strictEqual(state().games.length, games, 'local data kept');
  });

  await step('no runtime errors were raised in the browser', async () => {
    assert.strictEqual(errors.length, 0, 'runtime errors:\n' + errors.slice(0, 3).join('\n---\n'));
  });

  server.close();
  server.database.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n✅ ' + passed + ' cloud browser checks passed.');
}

run().then(() => process.exit(0)).catch(err => {
  console.error('\n✗ FAILED after ' + passed + ' checks:', err && err.stack || err);
  if (errors.length) console.error('Runtime errors:\n' + errors.slice(0, 3).join('\n---\n'));
  try { server && server.close(); } catch (_) {}
  process.exit(1);
});
