/* =========================================================================
 * Zero-dependency smoke tests (Node built-ins only — no npm install needed).
 * Run:  node tests/smoke.js
 *
 * Covers the data model, the non-destructive v1 → v2 → v3 migration, theme
 * resolution/persistence, photo defaults, the pure stats helpers and the
 * advanced analytics by evaluating the exact browser source files in a
 * minimal vm context.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { webcrypto } = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DB_KEY = 'bball_tm_v1';
const BACKUP_KEY = 'bball_tm_v1_pre_v2_backup';
const THEME_KEY = 'bball_tm_theme';
const SCHEMA_VERSION = 3;

function memoryStore(seed) {
  const store = {};
  Object.keys(seed || {}).forEach(k => { store[k] = String(seed[k]); });
  return {
    store: store,
    localStorage: {
      get length() { return Object.keys(store).length; },
      key: i => Object.keys(store)[i] || null,
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
}

function context(seed, files) {
  const mem = memoryStore(seed);
  const sandbox = { console: console, localStorage: mem.localStorage };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  (files || ['js/storage.js', 'js/stats.js', 'js/analytics.js']).forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  return { sandbox: sandbox, store: mem.store, TBS: sandbox.TBS };
}

/* Theme sandbox: needs a document/documentElement + matchMedia stub. */
function themeContext(seed, opts) {
  const options = opts || {};
  const mem = memoryStore(seed);
  const documentElement = {
    setAttribute: (name, value) => {
      /* mirror <html data-theme="…"> the way the browser exposes it */
      documentElement.dataset[name.replace(/^data-/, '').replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    },
    dataset: {},
    style: {}
  };
  const document = {
    documentElement: documentElement,
    querySelector: () => null,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const sandbox = {
    console: console,
    localStorage: mem.localStorage,
    document: document,
    matchMedia: query => ({
      matches: query.indexOf('dark') >= 0 ? !!options.systemDark : false,
      addEventListener: () => {},
      removeEventListener: () => {}
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/theme.js'), 'utf8'), sandbox, { filename: 'js/theme.js' });
  return { sandbox: sandbox, store: mem.store, documentElement: documentElement, TBS: sandbox.TBS };
}

/* Objects created inside the vm realm have different prototypes, so compare
 * their plain-JSON form instead of using structural identity. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

let passed = 0;
const pendingChecks = [];
function check(name, fn) {
  const result = fn();
  if (result && typeof result.then === 'function') {
    pendingChecks.push(result.then(() => { passed++; console.log('  ✓ ' + name); }));
  } else {
    passed++;
    console.log('  ✓ ' + name);
  }
}

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const v1 = {
  players: [
    { id: 'p1', name: 'Jordan Smith', number: 23, position: 'SG' },
    { id: 'p2', name: 'Alex Rivera', number: 11, position: 'PG' }
  ],
  games: [
    { id: 'g1', opponent: 'Lakeside Lions', date: '2026-01-10', teamScore: 68, oppScore: 61,
      stats: [{ playerId: 'p1', pts: 22, reb: 6, ast: 4, stl: 2, blk: 1, tov: 3, fgm: 8, fga: 16 }] },
    { id: 'g2', opponent: 'Lakeside Lions', date: '2026-01-17', teamScore: 74, oppScore: 80,
      stats: [{ playerId: 'p1', pts: 30, reb: 8, ast: 2, stl: 1, blk: 0, tov: 2, fgm: 11, fga: 20 }] }
  ],
  schedule: [{ id: 's1', opponent: 'Hilltop Bears', date: '2026-02-01T18:30', location: 'Main gym' }]
};

/* A minimal v2 document: no photo, no team colour, no league theme, no lineup
 * and no shot data — exactly what an older install looks like. */
const v2 = {
  version: 2,
  league: {
    name: 'Old League', season: '2025-26', primaryTeamId: 't1',
    quarters: 4, quarterMinutes: 8
  },
  teams: [
    { id: 't1', name: 'Riverside', short: 'RIV', primary: true },
    { id: 't2', name: 'Hilltop', short: 'HIL', primary: false }
  ],
  players: [
    { id: 'a1', teamId: 't1', name: 'Casey Nguyen', number: 34, position: 'C', active: true },
    { id: 'b1', teamId: 't2', name: 'Jamie Ortiz', number: 8, position: 'PG', active: true }
  ],
  games: [{
    id: 'old-g1', date: '2025-12-01', time: '19:00', location: 'Main gym',
    status: 'final', homeTeamId: 't1', awayTeamId: 't2',
    homeScore: 60, awayScore: 55, quarter: 4, clockSeconds: 0, clockRunningSince: null,
    stats: [
      { playerId: 'a1', teamId: 't1', pts: 18, reb: 9, ast: 2, stl: 1, blk: 2, tov: 1,
        fgm: 7, fga: 12, tpm: 1, tpa: 3, ftm: 3, fta: 4, pf: 3, min: 30 }
    ],
    events: [{
      id: 'old-e1', type: 'fg2_make', label: 'Casey Nguyen — 2PT made', teamId: 't1',
      playerId: 'a1', statDeltas: { fgm: 1, fga: 1, pts: 2 }, scoreDelta: 2,
      quarter: 1, clockSeconds: 400, ts: 1700000000000
    }],
    notes: 'Season opener', createdAt: '2025-12-01T10:00:00.000Z',
    customScouting: { pressBreak: 'high' }
  }],
  schedule: [{
    id: 'ev1', date: '2025-12-08T18:00', time: '18:00', title: 'Practice',
    type: 'practice', location: 'Main gym', gameId: null, notes: ''
  }],
  meta: { createdAt: '2025-11-01T00:00:00.000Z', migratedFrom: null, migratedAt: null, legacyCounts: null }
};

console.log('TeamBallStats smoke tests\n');

/* ----------------------------- v1 migration ----------------------------- */

const { store, TBS } = context({ [DB_KEY]: JSON.stringify(v1) });
const data = TBS.storage.loadData();

check('loads under the unchanged localStorage key', () => {
  assert.strictEqual(TBS.storage.DB_KEY, DB_KEY);
  assert.strictEqual(TBS.storage.THEME_KEY, THEME_KEY);
  assert.ok(store[DB_KEY]);
});

check('migrates v1 straight to schema v3 and persists the upgraded shape', () => {
  assert.strictEqual(TBS.storage.SCHEMA_VERSION, SCHEMA_VERSION);
  assert.strictEqual(data.version, 3);
  assert.strictEqual(JSON.parse(store[DB_KEY]).version, 3);
  assert.strictEqual(data.meta.migratedFrom, 'v1');
  assert.strictEqual(data.meta.migratedTo, 'v3');
});

check('records both migration steps (v1→v2→v3)', () => {
  const steps = data.meta.upgrades.map(s => s.from + '->' + s.to);
  assert.deepStrictEqual(plain(steps), ['1->2', '2->3']);
});

check('keeps a raw pre-upgrade backup, one time only', () => {
  const backup = JSON.parse(store[BACKUP_KEY]);
  assert.strictEqual(backup.games.length, 2);
  assert.strictEqual(backup.players[0].name, 'Jordan Smith');
  TBS.storage.loadData();
  assert.strictEqual(JSON.parse(store[BACKUP_KEY]).games[0].teamScore, 68);
  assert.ok(!store['bball_tm_v1_pre_v3_backup'], 'no extra backup key is created');
});

check('preserves players, jersey numbers, positions and adds photo=""', () => {
  assert.strictEqual(data.players.length, 2);
  assert.strictEqual(data.players[0].number, 23);
  assert.strictEqual(data.players[0].teamId, data.league.primaryTeamId);
  assert.strictEqual(data.players[0].photo, '');
});

check('preserves games, scores and expands stat lines to 16 fields', () => {
  assert.strictEqual(data.games.length, 2);
  assert.strictEqual(data.games[0].homeScore, 68);
  assert.strictEqual(data.games[0].awayScore, 61);
  assert.strictEqual(data.games[0].status, 'final');
  assert.strictEqual(data.games[0].stats[0].pts, 22);
  assert.strictEqual(data.games[0].stats[0].tpa, 0);
  assert.strictEqual(Object.keys(data.games[0].stats[0]).length, 18); // playerId + teamId + 16 stats (incl. oreb/dreb)
});

check('adds safe v3 defaults: lineup, empty events, empty season', () => {
  assert.deepStrictEqual(plain(data.games[0].lineup), { home: [], away: [] });
  assert.deepStrictEqual(plain(data.games[0].events), []);
  assert.strictEqual(data.games[0].season, '');
});

check('deduplicates opponent names into real teams', () => {
  assert.strictEqual(data.teams.length, 2);
  assert.strictEqual(data.teams.filter(t => t.name === 'Lakeside Lions').length, 1);
  assert.strictEqual(data.teams[1].color, '');
});

check('preserves legacy schedule items as calendar events', () => {
  assert.strictEqual(data.schedule[0].title, 'vs Hilltop Bears');
  assert.strictEqual(data.schedule[0].location, 'Main gym');
  assert.ok(data.schedule[0].date.indexOf('T18:30') > 0);
});

/* ----------------------------- v2 migration ----------------------------- */

const v2ctx = context({ [DB_KEY]: JSON.stringify(v2) });
const upgraded = v2ctx.TBS.storage.loadData();

check('v2 backups upgrade to v3 without losing anything', () => {
  assert.strictEqual(upgraded.version, 3);
  assert.strictEqual(upgraded.teams.length, 2);
  assert.strictEqual(upgraded.players.length, 2);
  assert.strictEqual(upgraded.games.length, 1);
  assert.strictEqual(upgraded.games[0].stats[0].pts, 18);
  assert.strictEqual(upgraded.games[0].homeScore, 60);
  assert.strictEqual(upgraded.games[0].notes, 'Season opener');
  assert.strictEqual(upgraded.games[0].events.length, 1);
  assert.strictEqual(upgraded.games[0].events[0].scoreDelta, 2);
  assert.strictEqual(upgraded.schedule.length, 1);
  assert.strictEqual(upgraded.league.quarters, 4);
  assert.strictEqual(upgraded.league.quarterMinutes, 8);
});

check('v3 defaults are applied to old records (photo, colour, theme, lineup, shot)', () => {
  assert.strictEqual(upgraded.players[0].photo, '');
  assert.strictEqual(upgraded.teams[0].color, '');
  assert.strictEqual(upgraded.league.theme, 'system');
  assert.deepStrictEqual(plain(upgraded.games[0].lineup), { home: [], away: [] });
  assert.strictEqual(upgraded.games[0].events[0].shot, null);
  assert.strictEqual(upgraded.games[0].events[0].quarter, 1);
});

check('unknown fields survive the upgrade (non-destructive round-trip)', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(upgraded.games[0].customScouting)),
    { pressBreak: 'high' });
  assert.strictEqual(upgraded.meta.createdAt, '2025-11-01T00:00:00.000Z');
});

check('a v2 document records exactly one upgrade step', () => {
  const steps = upgraded.meta.upgrades.map(s => s.from + '->' + s.to);
  assert.deepStrictEqual(plain(steps), ['2->3']);
});

check('coerce() is idempotent for v3 documents', () => {
  const once = v2ctx.TBS.storage.coerce(upgraded);
  const twice = v2ctx.TBS.storage.coerce(once);
  assert.strictEqual(twice.version, 3);
  assert.strictEqual(twice.meta.upgrades.length, 1);
  assert.strictEqual(JSON.stringify(once), JSON.stringify(twice));
});

check('coerce() repairs sparse documents with v3 defaults', () => {
  const sparse = v2ctx.TBS.storage.coerce({ version: 3, teams: [], players: [], games: [], schedule: [] });
  assert.strictEqual(sparse.teams.length, 1);
  assert.strictEqual(sparse.league.quarters, 4);
  assert.strictEqual(sparse.league.theme, 'system');
  assert.strictEqual(sparse.teams[0].color, '');
});

check('junk and null entries are ignored, not turned into placeholder records', () => {
  const messy = {
    players: [null, { id: 'x', name: 'Real Player', number: '7' }, { id: 'y' }, 'junk', []],
    games: [null, 'junk', { id: 'g1', opponent: 'Rivals', teamScore: 50, stats: [null, { playerId: 'x', pts: 9 }] }],
    schedule: [null, { id: 's1', opponent: 'Rivals', date: '2026-01-02' }]
  };
  const clean = v2ctx.TBS.storage.coerce(messy);
  assert.strictEqual(clean.players.length, 2);
  assert.strictEqual(clean.players[0].name, 'Real Player');
  assert.strictEqual(clean.players[1].name, 'Unnamed player');
  assert.strictEqual(clean.players[0].number, 7);
  assert.strictEqual(clean.games.length, 1);
  assert.strictEqual(clean.games[0].stats.length, 1);
  assert.strictEqual(clean.games[0].stats[0].pts, 9);
  assert.strictEqual(clean.schedule.length, 1);
  assert.strictEqual(v2ctx.TBS.storage.preservesEverything(messy, clean), true);
});

check('the write guard still blocks a real loss', () => {
  const before = { players: [{ name: 'A' }, { name: 'B' }], teams: [], games: [], schedule: [] };
  const after = v2ctx.TBS.storage.coerce({ version: 3, teams: [], players: [{ name: 'A' }], games: [], schedule: [] });
  assert.strictEqual(v2ctx.TBS.storage.preservesEverything(before, after), false);
});

check('the write guard refuses lossy upgrades', () => {
  const before = { players: [1, 2, 3], teams: [1], games: [{ stats: [1, 2], events: [] }], schedule: [] };
  const after = v2ctx.TBS.storage.coerce({ version: 3, teams: [], players: [], games: [], schedule: [] });
  assert.strictEqual(v2ctx.TBS.storage.preservesEverything(before, after), false);
  assert.strictEqual(v2ctx.TBS.storage.preservesEverything(before, before), true);
});

/* ------------------------- photos, theme, shots ------------------------- */

check('photo values are validated: inline data URLs only', () => {
  const s = v2ctx.TBS.storage;
  assert.strictEqual(s.normalizePhoto(PHOTO), PHOTO);
  assert.strictEqual(s.normalizePhoto('https://example.com/me.png'), '');
  assert.strictEqual(s.normalizePhoto('javascript:alert(1)'), '');
  assert.strictEqual(s.normalizePhoto('blob:abc'), '');
  assert.strictEqual(s.normalizePhoto(undefined), '');
});

check('team colours accept only hex values', () => {
  const s = v2ctx.TBS.storage;
  assert.strictEqual(s.normalizeColor('#C8102E'), '#c8102e');
  assert.strictEqual(s.normalizeColor('#abc'), '#aabbcc');
  assert.strictEqual(s.normalizeColor('red'), '');
  assert.strictEqual(s.normalizeColor(''), '');
});

check('shot coordinates are clamped and invalid shots dropped', () => {
  const s = v2ctx.TBS.storage;
  assert.deepStrictEqual(plain(s.normalizeShot({ x: 1.4, y: -0.2 })), { x: 1, y: 0 });
  assert.deepStrictEqual(plain(s.normalizeShot({ x: 0.4, y: 0.6 })), { x: 0.4, y: 0.6 });
  assert.strictEqual(s.normalizeShot('court'), null);
  assert.strictEqual(s.normalizeShot({ x: 'a', y: 0.5 }), null);
});

check('photos and colours round-trip through export/import', () => {
  const doc = v2ctx.TBS.storage.coerce(upgraded);
  doc.players[0].photo = PHOTO;
  doc.teams[0].color = '#123456';
  doc.league.theme = 'dark';
  const roundTripped = v2ctx.TBS.storage.coerce(JSON.parse(JSON.stringify(doc)));
  assert.strictEqual(roundTripped.players[0].photo, PHOTO);
  assert.strictEqual(roundTripped.teams[0].color, '#123456');
  assert.strictEqual(roundTripped.league.theme, 'dark');
  assert.strictEqual(roundTripped.games[0].stats[0].pts, 18);
});

/* -------------------------------- theme --------------------------------- */

check('theme resolver: explicit choice > league default > OS preference', () => {
  const t = themeContext({}).TBS.theme;
  assert.strictEqual(t.resolve('dark', 'light', false), 'dark');
  assert.strictEqual(t.resolve(null, 'light', true), 'light');
  assert.strictEqual(t.resolve(null, 'system', true), 'dark');
  assert.strictEqual(t.resolve(null, 'system', false), 'light');
  assert.strictEqual(t.resolve(undefined, undefined, true), 'dark');
  assert.strictEqual(t.resolve('purple', 'system', false), 'light');
});

check('theme choice persists under bball_tm_theme and never touches league data', () => {
  const seed = { [DB_KEY]: JSON.stringify(v2) };
  const ctx = themeContext(seed);
  const before = ctx.store[DB_KEY];
  ctx.TBS.theme.set('dark');
  assert.strictEqual(ctx.store[THEME_KEY], 'dark');
  assert.strictEqual(ctx.store[DB_KEY], before);
  assert.strictEqual(ctx.documentElement.dataset.theme, 'dark');
  ctx.TBS.theme.set('light');
  assert.strictEqual(ctx.store[THEME_KEY], 'light');
  assert.strictEqual(ctx.store[DB_KEY], before);
  assert.strictEqual(ctx.documentElement.dataset.theme, 'light');
});

check('first visit follows the OS theme, then honours the explicit choice', () => {
  const osDark = themeContext({}, { systemDark: true });
  osDark.TBS.theme.init('system');
  assert.strictEqual(osDark.TBS.theme.current(), 'dark');
  assert.strictEqual(osDark.store[THEME_KEY], undefined, 'no key is written on first visit');

  const chosen = themeContext({ [THEME_KEY]: 'light' }, { systemDark: true });
  chosen.TBS.theme.init('system');
  assert.strictEqual(chosen.TBS.theme.current(), 'light');

  const leagueDefault = themeContext({}, { systemDark: false });
  leagueDefault.TBS.theme.init('dark');
  assert.strictEqual(leagueDefault.TBS.theme.current(), 'dark');
});

check('writeStored("system") clears the explicit choice', () => {
  const ctx = themeContext({ [THEME_KEY]: 'dark' }, { systemDark: false });
  assert.strictEqual(ctx.TBS.theme.readStored(), 'dark');
  ctx.TBS.theme.writeStored('system');
  assert.strictEqual(ctx.store[THEME_KEY], undefined);
  ctx.TBS.theme.init('system');
  assert.strictEqual(ctx.TBS.theme.current(), 'light');
});

check('toggle flips the mode and writes the device key', () => {
  const ctx = themeContext({}, { systemDark: false });
  ctx.TBS.theme.init('system');
  ctx.TBS.theme.toggle();
  assert.strictEqual(ctx.store[THEME_KEY], 'dark');
  assert.strictEqual(ctx.documentElement.dataset.theme, 'dark');
  ctx.TBS.theme.toggle();
  assert.strictEqual(ctx.store[THEME_KEY], 'light');
});

/* ------------------------------ statistics ------------------------------ */

check('teamRecord / standings compute W-L, pct, GB and differential', () => {
  const rec = TBS.stats.teamRecord(data.games, data.league.primaryTeamId);
  assert.strictEqual(rec.w, 1);
  assert.strictEqual(rec.l, 1);
  assert.strictEqual(rec.pf, 142);
  assert.strictEqual(rec.pa, 141);
  const rows = TBS.stats.standings(data.teams, data.games, data.league.primaryTeamId);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].pct > 0);
});

check('playerAggregate returns averages and shooting efficiency', () => {
  const a = TBS.stats.playerAggregate('p1', data.games);
  assert.strictEqual(a.gp, 2);
  assert.strictEqual(a.totals.pts, 52);
  assert.ok(Math.abs(a.ppg - 26) < 1e-9);
  assert.ok(a.fgPct > 52 && a.fgPct < 53);
  assert.ok(a.efgPct > 0 && a.tsPct > 0);
});

check('quarterScores ignores non-scoring events', () => {
  const game = {
    homeTeamId: 'h', awayTeamId: 'a',
    events: [
      { scoreDelta: 3, teamId: 'h', quarter: 1 },
      { scoreDelta: 0, teamId: 'h', quarter: 2 },
      { scoreDelta: 2, teamId: 'a', quarter: 3 }
    ]
  };
  const q = TBS.stats.quarterScores(game, { quarters: 4 });
  assert.deepStrictEqual(plain(q.home), [3, 0, 0, 0]);
  assert.deepStrictEqual(plain(q.away), [0, 0, 2, 0]);
  assert.deepStrictEqual(plain(q.tracked), [true, false, true, false]);
});

check('toCSV escapes commas and quotes and never contains photos', () => {
  const players = [{
    id: 'x', name: 'Smith, "Ace"', number: 1, position: '', teamId: 'h', photo: PHOTO
  }];
  const csv = TBS.stats.toCSV(players, [], [{ id: 'h', name: 'Home' }]);
  assert.ok(csv.includes('"Smith, ""Ace"""'));
  assert.ok(csv.includes('eFG%'));
  assert.ok(csv.indexOf('data:image') < 0);
});

check('season filters work with games that have no season tag', () => {
  assert.strictEqual(TBS.stats.gamesForSeason(data.games, 'all', '2026-27').length, 2);
  assert.strictEqual(TBS.stats.gamesForSeason(data.games, '2026-27', '2026-27').length, 2);
  assert.strictEqual(TBS.stats.gamesForSeason(data.games, '2024-25', '2026-27').length, 0);
});

/* ------------------------------- analytics ------------------------------ */

check('per36 scales production to 36 minutes', () => {
  const agg = { totals: { min: 18, pts: 9, reb: 4, ast: 2, stl: 1, blk: 0, tov: 1, pf: 2,
    fga: 8, tpa: 2, fta: 2 } };
  const per = TBS.analytics.per36(agg);
  assert.strictEqual(per.qualified, true);
  assert.strictEqual(per.pts, 18);
  assert.strictEqual(per.reb, 8);
  assert.strictEqual(per.ast, 4);
  assert.strictEqual(TBS.analytics.per36({ totals: {} }).qualified, false);
});

check('plusMinus credits and debits everyone on court', () => {
  const game = {
    homeTeamId: 'h', awayTeamId: 'a',
    stats: [
      { playerId: 'p1', teamId: 'h' },
      { playerId: 'p2', teamId: 'a' }
    ],
    events: [
      { type: 'fg2_make', teamId: 'h', playerId: 'p1', scoreDelta: 2 },
      { type: 'fg3_make', teamId: 'a', playerId: 'p2', scoreDelta: 3 },
      { type: 'reb', teamId: 'h', playerId: 'p1', scoreDelta: 0 }
    ]
  };
  const pm = TBS.analytics.plusMinus(game);
  assert.strictEqual(pm.tracked, true);
  assert.strictEqual(pm.byPlayer.p1, -1); // +2 then −3
  assert.strictEqual(pm.byPlayer.p2, 1);  // −2 then +3
  assert.strictEqual(pm.events, 2);
});

check('substitutions change who is credited', () => {
  const game = {
    homeTeamId: 'h', awayTeamId: 'a',
    stats: [{ playerId: 'p1', teamId: 'h' }, { playerId: 'p2', teamId: 'h' }],
    events: [
      { type: 'sub_out', teamId: 'h', playerId: 'p1', scoreDelta: 0, quarter: 1, clockSeconds: 600 },
      { type: 'fg2_make', teamId: 'h', playerId: 'p2', scoreDelta: 2, quarter: 1, clockSeconds: 500 }
    ]
  };
  const pm = TBS.analytics.plusMinus(game);
  assert.strictEqual(pm.byPlayer.p2, 2);
  assert.strictEqual(pm.byPlayer.p1, undefined);
});

check('minutesFromLineup measures on-court seconds', () => {
  const game = {
    homeTeamId: 'h', awayTeamId: 'a', stats: [], events: [
      { type: 'sub_in', teamId: 'h', playerId: 'p1', quarter: 1, clockSeconds: 600 },
      { type: 'sub_out', teamId: 'h', playerId: 'p1', quarter: 2, clockSeconds: 300 },
      { type: 'sub_in', teamId: 'h', playerId: 'p2', quarter: 3, clockSeconds: 600 }
    ]
  };
  const minutes = TBS.analytics.minutesFromLineup(game, { quarters: 4, quarterMinutes: 10 });
  assert.strictEqual(minutes.byPlayer.p1, 900);  // Q1 start → Q2 5:00 = 15 min
  assert.strictEqual(minutes.byPlayer.p2, 1200); // Q3 start → end of Q4 = 20 min
});

check('streaks detect hot and cold form', () => {
  const games = [10, 12, 8, 10, 30, 28, 32, 29, 31].map((pts, i) => ({
    status: 'final', date: '2026-01-0' + (i + 1), time: '',
    stats: [{ playerId: 'hot', pts: pts }, { playerId: 'cold', pts: 40 - pts }]
  }));
  const hot = TBS.analytics.streaks('hot', games);
  assert.strictEqual(hot.label, 'hot');
  const cold = TBS.analytics.streaks('cold', games);
  assert.strictEqual(cold.label, 'cold');
  assert.strictEqual(hot.series.length, 9);
  assert.strictEqual(hot.last5.length, 5);
});

check('gameFlow accumulates the margin', () => {
  const game = {
    homeTeamId: 'h', awayTeamId: 'a',
    events: [
      { scoreDelta: 3, teamId: 'h', quarter: 1, clockSeconds: 500 },
      { scoreDelta: 2, teamId: 'a', quarter: 1, clockSeconds: 400 },
      { scoreDelta: 2, teamId: 'h', quarter: 2, clockSeconds: 300 }
    ]
  };
  const flow = TBS.analytics.gameFlow(game);
  assert.strictEqual(flow.points.length, 3);
  assert.deepStrictEqual(plain(flow.points.map(p => p.margin)), [3, 1, 3]);
  assert.strictEqual(flow.maxAbs, 3);
  assert.strictEqual(flow.home, 5);
  assert.strictEqual(flow.away, 2);
});

check('shotZones classifies makes, misses and court zones', () => {
  const game = {
    events: [
      { type: 'fg2_make', playerId: 'p1', teamId: 'h', scoreDelta: 2, shot: { x: 0.5, y: 0.1 } },
      { type: 'fg3_make', playerId: 'p1', teamId: 'h', scoreDelta: 3, shot: { x: 0.5, y: 0.9 } },
      { type: 'fg3_miss', playerId: 'p1', teamId: 'h', scoreDelta: 0, shot: { x: 0.04, y: 0.1 } },
      { type: 'reb', playerId: 'p1', teamId: 'h', scoreDelta: 0, shot: null }
    ]
  };
  const zones = TBS.analytics.shotZones(game);
  assert.strictEqual(zones.total, 3);
  assert.strictEqual(zones.made, 2);
  assert.strictEqual(zones.pct, 66.7);
  const names = zones.zones.map(z => z.zone);
  assert.ok(names.includes('Paint'));
  assert.ok(names.includes('Top 3'));
  assert.ok(names.includes('Corner 3'));
  assert.strictEqual(TBS.analytics.zoneOf({ x: 0.5, y: 0.9 }, true), 'Top 3');
});

/* ---------------------------- access & roles ---------------------------- */

/* auth.js only needs window + localStorage + sessionStorage to decide who may
 * do what; the gate painting is browser-only and is covered by the jsdom
 * harness. Here we check hashing, roles and permissions. */
function authContext(seed) {
  const mem = memoryStore(seed);
  const sessionStore = {};
  const sandbox = { console: console, localStorage: mem.localStorage, crypto: webcrypto, TextEncoder: TextEncoder };
  sandbox.sessionStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(sessionStore, k) ? sessionStore[k] : null),
    setItem: (k, v) => { sessionStore[k] = String(v); },
    removeItem: k => { delete sessionStore[k]; }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['js/storage.js', 'js/stats.js', 'js/auth.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  return { TBS: sandbox.TBS, store: mem.store, sessionStore: sessionStore };
}

function legacyHashForTest(code) {
  const text = 'tbs::gate::v4::' + code;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = (h2 + Math.imul(c, i + 7)) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  const hex = n => ('00000000' + n.toString(16)).slice(-8);
  return 'h1$' + hex(h1) + hex(h2);
}

check('auth: teams and league management create username/password accounts and sign in', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  const teamId = state.league.primaryTeamId;

  const team = await auth.register(state, {
    role: 'team', teamId, username: 'Hawks_23', password: 'correct horse', confirmPassword: 'correct horse', remember: false
  });
  assert.strictEqual(team.ok, true);
  assert.strictEqual(auth.role(), 'team');
  assert.strictEqual(auth.myTeamId(), teamId);
  assert.strictEqual(auth.myUsername(), 'hawks_23');
  assert.strictEqual(auth.canManageLeague(), false);
  assert.strictEqual(auth.canManageTeam(teamId), true);
  assert.strictEqual(auth.canManageTeam('team-other'), false);
  assert.strictEqual(auth.canViewTeamStats('team-other'), true);
  assert.strictEqual(auth.canScoreGame({ homeTeamId: teamId, awayTeamId: 'x' }), true);
  assert.strictEqual(auth.canScoreGame({ homeTeamId: 'a', awayTeamId: 'b' }), false);
  assert.strictEqual(auth.canDeleteGame(), false);
  assert.strictEqual(auth.canResetData(), false);

  auth.signOut({ silent: true });
  const bad = await auth.signIn(state, { username: 'hawks_23', password: 'wrong password' });
  assert.strictEqual(bad.ok, false);
  assert.ok(/incorrect/i.test(bad.error));
  assert.strictEqual(auth.isSignedIn(), false);
  const good = await auth.signIn(state, { username: 'HAWKS_23', password: 'correct horse', role: 'commissioner' });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(auth.role(), 'team', 'a supplied role cannot elevate a username sign-in');

  const duplicate = await auth.register(state, {
    role: 'team', teamId, username: 'hawks_23', password: 'another password', confirmPassword: 'another password'
  });
  assert.strictEqual(duplicate.ok, false);
  const duplicateClub = await auth.register(state, {
    role: 'team', teamId, username: 'other_hawks', password: 'another password', confirmPassword: 'another password'
  });
  assert.strictEqual(duplicateClub.ok, false);

  auth.signOut({ silent: true });
  const admin = await auth.register(state, {
    role: 'commissioner', username: 'league.office', password: 'league password', confirmPassword: 'league password'
  });
  assert.strictEqual(admin.ok, true);
  assert.strictEqual(auth.isAdmin(), true);
  assert.strictEqual(auth.canManageLeague(), true);
  assert.strictEqual(auth.canViewTeamStats(teamId), true);
  assert.strictEqual(auth.canDeleteGame(), true);
  assert.strictEqual(auth.canResetData(), true);
  const registry = JSON.parse(ctx.store[auth.ACCOUNTS_KEY]);
  const teamAccount = registry.accounts.find(a => a.role === 'team');
  assert.strictEqual(auth.canManageAccount(teamAccount.id), false, 'league management cannot manage a team account');
  assert.strictEqual(auth.canManageAccount(registry.accounts.find(a => a.role === 'commissioner').id), true);
  const duplicateAdmin = await auth.register(state, {
    role: 'commissioner', username: 'league.second', password: 'league password', confirmPassword: 'league password'
  });
  assert.strictEqual(duplicateAdmin.ok, false);
});

check('auth: passwords are salted PBKDF2 hashes in a separate key, never in league backups', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  const before = JSON.stringify(state);
  const result = await auth.register(state, {
    role: 'team', teamId: state.league.primaryTeamId, username: 'private_team',
    password: 'secret password', confirmPassword: 'secret password', remember: true
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(JSON.stringify(state), before, 'registration does not rewrite league data');
  assert.strictEqual(ctx.store[DB_KEY], undefined);
  const raw = ctx.store[auth.ACCOUNTS_KEY];
  assert.strictEqual(raw.indexOf('secret password'), -1);
  const registry = JSON.parse(raw);
  const credential = registry.accounts[0].credential;
  assert.strictEqual(credential.algorithm, 'PBKDF2-SHA-256');
  assert.strictEqual(credential.iterations, auth.PBKDF2_ITERATIONS);
  assert.ok(credential.salt.length >= 20);
  assert.ok(credential.hash.length >= 40);

  const admin = await auth.register(state, {
    role: 'commissioner', username: 'private_league', password: 'secret password', confirmPassword: 'secret password'
  });
  assert.strictEqual(admin.ok, true);
  const accounts = JSON.parse(ctx.store[auth.ACCOUNTS_KEY]).accounts;
  assert.notStrictEqual(accounts[0].credential.salt, accounts[1].credential.salt);
  assert.notStrictEqual(accounts[0].credential.hash, accounts[1].credential.hash);

  state.league = state.league || {};
  state.league.access = { admin: 'h1$legacy', teams: { t1: 'h1$legacy' } };
  const backup = ctx.TBS.storage.withoutCredentials(state);
  assert.strictEqual(backup.league.access, undefined);
  assert.strictEqual(JSON.stringify(backup).indexOf('private_team'), -1);
  assert.strictEqual(JSON.stringify(backup).indexOf('secret password'), -1);
  assert.ok(state.league.access, 'the source document is not mutated by backup sanitising');
});

check('auth: username/password validation and confirmation are enforced', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  const base = { role: 'team', teamId: state.league.primaryTeamId, username: 'valid_user', password: 'long enough', confirmPassword: 'long enough' };
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { username: 'ab' }))).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { username: 'bad user' }))).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { password: 'short', confirmPassword: 'short' }))).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { confirmPassword: 'different' }))).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { password: '        ', confirmPassword: '        ' }))).ok, false);
  assert.strictEqual((await auth.register(state, base)).ok, true);
});

check('auth: only the signed-in owner can change a password, and old sessions are invalidated', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  await auth.register(state, {
    role: 'team', teamId: state.league.primaryTeamId, username: 'owner_only',
    password: 'old password', confirmPassword: 'old password', remember: true
  });
  const oldSession = ctx.store[auth.SESSION_KEY];
  assert.strictEqual((await auth.changePassword({ currentPassword: 'wrong', password: 'new password', confirmPassword: 'new password' })).ok, false);
  assert.strictEqual((await auth.changePassword({ currentPassword: 'old password', password: 'new password', confirmPassword: 'mismatch' })).ok, false);
  assert.strictEqual((await auth.changePassword({ currentPassword: 'old password', password: 'new password', confirmPassword: 'new password' })).ok, true);
  assert.strictEqual((await auth.signIn(state, { username: 'owner_only', password: 'old password' })).ok, false);
  assert.strictEqual((await auth.signIn(state, { username: 'owner_only', password: 'new password' })).ok, true);

  const again = authContext({ [auth.SESSION_KEY]: oldSession, [auth.ACCOUNTS_KEY]: ctx.store[auth.ACCOUNTS_KEY] });
  assert.strictEqual(again.TBS.auth.restore(state), null, 'a session from before the password change is rejected');
  auth.signOut({ silent: true });
  assert.strictEqual(auth.current(), null);
  assert.strictEqual(ctx.store[auth.SESSION_KEY], undefined);
  assert.strictEqual(ctx.sessionStore[auth.SESSION_KEY], undefined);
});

check('auth: a legacy custom passcode can upgrade once, then cannot sign in', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  state.league = state.league || {};
  state.league.access = { admin: legacyHashForTest('old-league-code') };
  assert.strictEqual(auth.hasLegacyPasscode(state, 'commissioner', ''), true);
  const base = { role: 'commissioner', username: 'upgraded_league', password: 'new password', confirmPassword: 'new password' };
  assert.strictEqual((await auth.register(state, base)).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { legacyPasscode: 'wrong' }))).ok, false);
  assert.strictEqual((await auth.register(state, Object.assign({}, base, { legacyPasscode: 'old-league-code' }))).ok, true);
  assert.strictEqual(auth.hasLegacyPasscode(state, 'commissioner', ''), false, 'the registered account supersedes legacy access');
  auth.signOut({ silent: true });
  assert.strictEqual((await auth.signIn(state, { username: 'upgraded_league', password: 'old-league-code' })).ok, false);
  assert.strictEqual((await auth.signIn(state, { username: 'upgraded_league', password: 'new password' })).ok, true);
});

check('auth: the session key is separate from league data and survives a reload', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  await auth.register(state, {
    role: 'commissioner', username: 'league_user', password: 'league password', confirmPassword: 'league password', remember: true
  });
  assert.strictEqual(auth.SESSION_KEY, 'bball_tm_session_v1');
  assert.strictEqual(DB_KEY, 'bball_tm_v1');
  assert.ok(ctx.store[auth.SESSION_KEY]);
  assert.strictEqual(ctx.store[DB_KEY], undefined);
  const session = JSON.parse(ctx.store[auth.SESSION_KEY]);
  assert.strictEqual(session.v, 2);
  assert.ok(session.accountId);
  assert.strictEqual(session.password, undefined);

  const again = authContext({ [auth.SESSION_KEY]: ctx.store[auth.SESSION_KEY], [auth.ACCOUNTS_KEY]: ctx.store[auth.ACCOUNTS_KEY] });
  const restored = again.TBS.auth.restore(state);
  assert.strictEqual(restored.role, 'commissioner');
  assert.strictEqual(again.TBS.auth.isAdmin(), true);
  again.TBS.auth.signOut({ silent: true });
  assert.strictEqual(again.TBS.auth.current(), null);
});

check('auth: a team account for a deleted club cannot sign in or restore', async () => {
  const ctx = authContext();
  const auth = ctx.TBS.auth;
  const state = ctx.TBS.storage.defaultData();
  const teamId = state.league.primaryTeamId;
  await auth.register(state, {
    role: 'team', teamId, username: 'deleted_club', password: 'team password', confirmPassword: 'team password', remember: true
  });
  assert.strictEqual(auth.canManageTeam(teamId), true);
  const shrunk = ctx.TBS.storage.coerce({
    version: 3, teams: [{ id: 'team-survivor', name: 'Survivors', primary: true }], players: [], games: [], schedule: []
  });
  assert.strictEqual(auth.restore(shrunk), null);
  assert.strictEqual(auth.isSignedIn(), false);
  assert.strictEqual(auth.canManageTeam('team-survivor'), false);
  const res = await auth.signIn(shrunk, { username: 'deleted_club', password: 'team password' });
  assert.strictEqual(res.ok, false);
  assert.ok(/no longer exists/i.test(res.error));
});

/* ------------------------------ sample data ----------------------------- */

check('sample-data.json is a valid v3 backup with photos, colours and events', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data.json'), 'utf8'));
  const s = v2ctx.TBS.storage.coerce(sample);
  assert.strictEqual(s.version, 3);
  assert.strictEqual(s.league.theme, 'system');
  assert.ok(s.teams.every(t => /^#[0-9a-f]{6}$/.test(t.color)));
  assert.ok(s.players.some(p => p.photo.indexOf('data:image/png;base64,') === 0));
  assert.ok(s.players.every(p => p.photo === '' || p.photo.indexOf('data:image/') === 0));
  assert.strictEqual(s.games.filter(g => g.status === 'final').length, 2);

  s.games.filter(g => g.status === 'final').forEach(g => {
    const home = g.stats.filter(x => x.teamId === g.homeTeamId).reduce((a, x) => a + x.pts, 0);
    const away = g.stats.filter(x => x.teamId === g.awayTeamId).reduce((a, x) => a + x.pts, 0);
    assert.strictEqual(home, g.homeScore);
    assert.strictEqual(away, g.awayScore);

    const eventHome = g.events.filter(e => e.teamId === g.homeTeamId)
      .reduce((a, e) => a + e.scoreDelta, 0);
    const eventAway = g.events.filter(e => e.teamId === g.awayTeamId)
      .reduce((a, e) => a + e.scoreDelta, 0);
    assert.strictEqual(eventHome, g.homeScore);
    assert.strictEqual(eventAway, g.awayScore);

    const flow = TBS.analytics.gameFlow(g);
    assert.strictEqual(flow.points.length > 0, true);
    const zones = TBS.analytics.shotZones(g);
    assert.ok(zones.total > 0);
    zones.shots.forEach(shot => {
      assert.ok(shot.x >= 0 && shot.x <= 1 && shot.y >= 0 && shot.y <= 1);
    });
  });
});

check('summarize() reports v3 counts including photos and play events', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data.json'), 'utf8'));
  const summary = v2ctx.TBS.storage.summarize(sample);
  assert.strictEqual(summary.version, 3);
  assert.strictEqual(summary.teams, 4);
  assert.strictEqual(summary.players, 15);
  assert.strictEqual(summary.photos, 2);
  assert.ok(summary.playEvents > 100);
  assert.strictEqual(summary.statLines, 18);
});

Promise.all(pendingChecks).then(() => {
  console.log('\n✅ ' + passed + ' smoke tests passed (Node built-ins only).');
}).catch(err => { console.error(err); process.exitCode = 1; });
