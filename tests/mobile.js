/* Mobile app shell contract: run with node tests/mobile.js. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const scope = 'https://example.test/league/';
const handlers = {};
let precached = [];
const deleted = [];
const cache = {
  addAll: async assets => { precached = Array.from(assets); },
  match: async url => precached.some(asset => new URL(asset, scope).href === url) ? 'cached:' + url : undefined
};
const context = {
  URL, Set, Promise,
  self: { registration: { scope }, addEventListener: (name, fn) => { handlers[name] = fn; } },
  caches: {
    open: async () => cache,
    keys: async () => ['teamballstats-shell-v0', 'teamballstats-shell-v2', 'unrelated'],
    delete: async key => { deleted.push(key); }
  },
  fetch: async request => 'network:' + request.url
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
async function lifecycle(name) {
  let promise;
  handlers[name]({ waitUntil: value => { promise = value; } });
  await promise;
}
async function request(url, method) {
  let response;
  handlers.fetch({ request: { url, method: method || 'GET' }, respondWith: value => { response = value; } });
  return response && await response;
}
(async () => {
  await lifecycle('install');
  assert(precached.length > 20);
  for (const asset of precached) {
    const file = asset === './' ? 'index.html' : asset;
    assert(fs.existsSync(path.join(root, file)), 'Missing cached asset: ' + asset);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
    assert(precached.includes(match[1]), 'Missing shell asset: ' + match[1]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.strictEqual(manifest.scope, './');
  for (const icon of manifest.icons) assert(precached.includes(icon.src));
  assert.strictEqual(await request(scope), 'cached:' + scope);
  assert.strictEqual(await request(scope + 'index.html?source=home'), 'cached:' + scope + 'index.html');
  assert.strictEqual(await request(scope + 'js/app.js'), 'cached:' + scope + 'js/app.js');
  assert.strictEqual(await request(scope + 'api/league'), undefined);
  assert.strictEqual(await request(scope + 'js/app.js', 'POST'), undefined);
  assert.strictEqual(await request('https://other.test/league/js/app.js'), undefined);
  await lifecycle('activate');
  assert.deepStrictEqual(deleted, ['teamballstats-shell-v0']);
  console.log('Mobile shell tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
