/* =========================================================================
 * server/engine.js — runs the SAME browser modules (storage, stats,
 * analytics, plays, pro) inside a vm sandbox. The server validates uploads
 * with the browser's own normaliser and computes Pro output with the browser's
 * own code, so both sides agree exactly.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('./config');

const FILES = ['js/storage.js', 'js/stats.js', 'js/analytics.js', 'js/plays.js', 'js/pro.js'];

function memoryLocalStorage() {
  const store = Object.create(null);
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; }
  };
}

function load() {
  const sandbox = { console: console, localStorage: memoryLocalStorage() };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  FILES.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(config.ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  return sandbox.TBS;
}

const TBS = load();

/* Accepts v1/v2/v3 documents. Throws on anything that is not a league. */
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('document must be a JSON object');
  if (!Array.isArray(raw.teams) && !Array.isArray(raw.players) && !Array.isArray(raw.games)) {
    throw new Error('document has no teams, players or games');
  }
  return TBS.storage.coerce(TBS.storage.withoutCredentials(raw));
}

function summarize(doc) {
  const s = TBS.storage.summarize(doc);
  return { teams: s.teams, players: s.players, games: (doc.games || []).length, statLines: s.statLines };
}

function gameRecap(doc, gameId) {
  return TBS.pro.gameRecap(doc, gameId);
}

function lineupRankings(doc, opts) {
  return TBS.pro.lineupRankings(doc, opts || {});
}

module.exports = { normalize, summarize, gameRecap, lineupRankings, TBS };
