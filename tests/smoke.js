/* =========================================================================
 * Zero-dependency smoke tests (Node built-ins only — no npm install needed).
 * Run:  node tests/smoke.js
 * Covers the data model, v1 -> v2 migration and the pure stats helpers by
 * evaluating the exact browser source files in a minimal vm context.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const DB_KEY = 'bball_tm_v1';
const BACKUP_KEY = 'bball_tm_v1_pre_v2_backup';

function context(seed) {
  const store = {};
  if (seed !== undefined) store[DB_KEY] = JSON.stringify(seed);
  const sandbox = {
    console: console,
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['js/storage.js', 'js/stats.js'].forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  });
  return { sandbox: sandbox, store: store, TBS: sandbox.TBS };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

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

console.log('TeamBallStats smoke tests\n');

const { store, TBS } = context(v1);
const data = TBS.storage.loadData();

check('loads under the unchanged localStorage key', () => {
  assert.strictEqual(TBS.storage.DB_KEY, DB_KEY);
  assert.ok(store[DB_KEY]);
});

check('migrates v1 to schema v2 and persists the upgraded shape', () => {
  assert.strictEqual(data.version, 2);
  assert.strictEqual(JSON.parse(store[DB_KEY]).version, 2);
  assert.strictEqual(data.meta.migratedFrom, 'v1');
});

check('keeps a raw pre-upgrade backup, one time only', () => {
  const backup = JSON.parse(store[BACKUP_KEY]);
  assert.strictEqual(backup.games.length, 2);
  assert.strictEqual(backup.players[0].name, 'Jordan Smith');
  TBS.storage.loadData();
  assert.strictEqual(JSON.parse(store[BACKUP_KEY]).games[0].teamScore, 68);
});

check('preserves players, jersey numbers and positions', () => {
  assert.strictEqual(data.players.length, 2);
  assert.strictEqual(data.players[0].number, 23);
  assert.strictEqual(data.players[0].teamId, data.league.primaryTeamId);
});

check('preserves games, scores and expands stat lines to 14 fields', () => {
  assert.strictEqual(data.games.length, 2);
  assert.strictEqual(data.games[0].homeScore, 68);
  assert.strictEqual(data.games[0].awayScore, 61);
  assert.strictEqual(data.games[0].status, 'final');
  assert.strictEqual(data.games[0].stats[0].pts, 22);
  assert.strictEqual(data.games[0].stats[0].tpa, 0);
  assert.strictEqual(Object.keys(data.games[0].stats[0]).length, 16); // playerId + teamId + 14 stats
});

check('deduplicates opponent names into real teams', () => {
  assert.strictEqual(data.teams.length, 2);
  assert.strictEqual(data.teams.filter(t => t.name === 'Lakeside Lions').length, 1);
});

check('preserves legacy schedule items as calendar events', () => {
  assert.strictEqual(data.schedule[0].title, 'vs Hilltop Bears');
  assert.strictEqual(data.schedule[0].location, 'Main gym');
  assert.ok(data.schedule[0].date.indexOf('T18:30') > 0);
});

check('coerce() accepts v2 documents and repairs missing fields', () => {
  const again = TBS.storage.coerce(data);
  assert.strictEqual(again.version, 2);
  assert.strictEqual(again.games.length, 2);
  const sparse = TBS.storage.coerce({ version: 2, teams: [], players: [], games: [], schedule: [] });
  assert.strictEqual(sparse.teams.length, 1);
  assert.strictEqual(sparse.league.quarters, 4);
});

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
  assert.deepStrictEqual(Array.from(q.home), [3, 0, 0, 0]);
  assert.deepStrictEqual(Array.from(q.away), [0, 0, 2, 0]);
  assert.deepStrictEqual(Array.from(q.tracked), [true, false, true, false]);
});

check('toCSV escapes commas and quotes in player names', () => {
  const players = [{ id: 'x', name: 'Smith, "Ace"', number: 1, position: '', teamId: 'h' }];
  const csv = TBS.stats.toCSV(players, [], [{ id: 'h', name: 'Home' }]);
  assert.ok(csv.includes('"Smith, ""Ace"""'));
  assert.ok(csv.includes('eFG%'));
});

check('sample-data.json is a valid v2 backup with consistent box scores', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data.json'), 'utf8'));
  const s = TBS.storage.coerce(sample);
  assert.strictEqual(s.version, 2);
  assert.strictEqual(s.games.filter(g => g.status === 'final').length, 2);
  s.games.filter(g => g.status === 'final').forEach(g => {
    const home = g.stats.filter(x => x.teamId === g.homeTeamId).reduce((a, x) => a + x.pts, 0);
    const away = g.stats.filter(x => x.teamId === g.awayTeamId).reduce((a, x) => a + x.pts, 0);
    assert.strictEqual(home, g.homeScore);
    assert.strictEqual(away, g.awayScore);
  });
});

console.log('\n✅ ' + passed + ' smoke tests passed (Node built-ins only).');
