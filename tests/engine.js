/* =========================================================================
 * Engine tests — play engine (js/plays.js), two-tap / aggregate entries,
 * undo, team fouls, game phases, and box-score aggregation.
 * Run:  node tests/engine.js   (Node built-ins only)
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['js/storage.js', 'js/stats.js', 'js/analytics.js', 'js/plays.js'];

function load() {
  const store = {};
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
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
  return sandbox.TBS;
}

const TBS = load();
const plain = v => JSON.parse(JSON.stringify(v));

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    throw err;
  }
}

/* A small league: our team (home) and an opponent (away) with one roster player. */
function fixture(status) {
  const league = { name: 'T', season: '2026-27', primaryTeamId: 'us', quarters: 4, quarterMinutes: 10, theme: 'system' };
  const teams = [
    { id: 'us', name: 'Hawks', short: 'HAW', color: '', primary: true },
    { id: 'opp', name: 'Lions', short: 'LIO', color: '', primary: false }
  ];
  const players = [
    { id: 'p1', teamId: 'us', name: 'Ann', number: 24, position: 'G', active: true, photo: '' },
    { id: 'p2', teamId: 'us', name: 'Bo', number: 10, position: 'F', active: true, photo: '' },
    { id: 'p3', teamId: 'us', name: 'Cy', number: 7, position: 'C', active: true, photo: '' }
  ];
  const game = {
    id: 'g1', date: '2026-11-01', time: '', location: '', season: '2026-27',
    status: status || 'live', halftime: false,
    homeTeamId: 'us', awayTeamId: 'opp', homeScore: 0, awayScore: 0,
    quarter: 1, clockSeconds: 600, clockRunningSince: null,
    lineup: { home: [], away: [] }, stats: [], events: [], notes: '', createdAt: ''
  };
  return { league, teams, players, game };
}

function normalized(fx) {
  return TBS.storage.coerce({
    version: 3, league: fx.league, teams: fx.teams, players: fx.players, games: [fx.game], schedule: []
  }).games[0];
}

const T = (value) => ({ clockSeconds: 300, ts: 1, teams: undefined, players: undefined, ...value });

console.log('Engine tests\n');

check('two-tap: a 3PT make updates shooting, points and the home score', () => {
  const fx = fixture();
  const ev = TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'us', playerId: 'p1',
    players: fx.players, teams: fx.teams, clockSeconds: 300, ts: 1 });
  const line = fx.game.stats.find(s => s.playerId === 'p1');
  assert.strictEqual(line.pts, 3);
  assert.strictEqual(line.fgm, 1); assert.strictEqual(line.fga, 1);
  assert.strictEqual(line.tpm, 1); assert.strictEqual(line.tpa, 1);
  assert.strictEqual(fx.game.homeScore, 3);
  assert.strictEqual(ev.label, 'Ann — 3PT made');
  assert.strictEqual(ev.aggregate, false);
  assert.strictEqual(ev.quarter, 1);
  assert.strictEqual(ev.clockSeconds, 300);
});

check('two-tap: 1 / 2 / 3 point makes map to FT, 2PT and 3PT correctly', () => {
  const fx = fixture();
  ['ft_make', 'fg2_make', 'fg3_make'].forEach(k =>
    TBS.plays.applyPlay(fx.game, { playKey: k, teamId: 'us', playerId: 'p2', players: fx.players, teams: fx.teams }));
  assert.strictEqual(fx.game.homeScore, 6);
  const line = fx.game.stats.find(s => s.playerId === 'p2');
  assert.strictEqual(line.ftm, 1); assert.strictEqual(line.fta, 1);
  assert.strictEqual(line.fgm, 2); assert.strictEqual(line.fga, 2);
  assert.strictEqual(line.tpm, 1); assert.strictEqual(line.tpa, 1);
});

check('offensive and defensive rebounds count toward total rebounds', () => {
  const fx = fixture();
  TBS.plays.applyPlay(fx.game, { playKey: 'oreb', teamId: 'us', playerId: 'p3', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'dreb', teamId: 'us', playerId: 'p3', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'dreb', teamId: 'us', playerId: 'p3', players: fx.players, teams: fx.teams });
  const line = fx.game.stats.find(s => s.playerId === 'p3');
  assert.strictEqual(line.oreb, 1);
  assert.strictEqual(line.dreb, 2);
  assert.strictEqual(line.reb, 3);
});

check('opponent entries create one team-aggregate line (no roster player)', () => {
  const fx = fixture();
  TBS.plays.applyPlay(fx.game, { playKey: 'fg2_make', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'pf', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  const aggregates = fx.game.stats.filter(s => !s.playerId);
  assert.strictEqual(aggregates.length, 1, 'exactly one aggregate line per team');
  assert.strictEqual(aggregates[0].aggregate, true);
  assert.strictEqual(aggregates[0].pts, 5);
  assert.strictEqual(aggregates[0].fgm, 2);
  assert.strictEqual(aggregates[0].pf, 1);
  assert.strictEqual(fx.game.awayScore, 5);
  assert.strictEqual(fx.game.events[0].label, 'Lions (team) — 2PT made');
  assert.strictEqual(fx.game.events[0].aggregate, true);
});

check('aggregate lines survive a reload (coerce) and are not mistaken for players', () => {
  const fx = fixture();
  TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'fg2_make', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  const g = normalized(fx);
  const agg = g.stats.find(s => !s.playerId);
  assert.ok(agg, 'aggregate line kept');
  assert.strictEqual(agg.aggregate, true);
  assert.strictEqual(agg.pts, 3);
  assert.strictEqual(g.stats.filter(s => s.playerId).length, 1);
});

check('a stat line with no playerId and no aggregate flag is still dropped', () => {
  const fx = fixture();
  fx.game.stats = [{ playerId: '', teamId: 'opp', pts: 9 }];
  const g = normalized(fx);
  assert.strictEqual(g.stats.length, 0);
});

check('box score: aggregate totals are separate from player rows but included in totals', () => {
  const fx = fixture('final');
  TBS.plays.applyPlay(fx.game, { playKey: 'fg2_make', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'dreb', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  const box = TBS.stats.gameBox(fx.game, fx.players, fx.teams, fx.league);
  assert.strictEqual(box.away.rows.length, 0, 'no fake "Former player" row');
  assert.ok(box.away.aggregate);
  assert.strictEqual(box.away.aggregate.pts, 3);
  assert.strictEqual(box.away.totals.pts, 3);
  assert.strictEqual(box.away.totals.reb, 1);
  assert.strictEqual(box.away.totals.dreb, 1);
  assert.strictEqual(box.home.rows.length, 1);
  assert.strictEqual(box.home.totals.pts, 2);
  assert.strictEqual(box.home.aggregate, null);
});

check('undo reverses player plays, aggregate plays, score and substitutions exactly', () => {
  const fx = fixture();
  const before = plain(fx.game);
  TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'fg2_miss', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.setOnCourt(fx.game, 'us', 'p2', true, { player: fx.players[1] });
  TBS.plays.manualScore(fx.game, 'opp', 2, { teamName: 'Lions' });
  assert.strictEqual(fx.game.events.length, 4);
  assert.strictEqual(fx.game.awayScore, 2);
  assert.strictEqual(TBS.plays.undoLast(fx.game).type, 'manual');
  assert.strictEqual(fx.game.awayScore, 0);
  assert.strictEqual(TBS.plays.undoLast(fx.game).type, 'sub_in');
  assert.deepStrictEqual(fx.game.lineup.home, []);
  assert.strictEqual(TBS.plays.undoLast(fx.game).type, 'fg2_miss');
  assert.strictEqual(fx.game.stats.find(s => !s.playerId).fga, 0);
  assert.strictEqual(TBS.plays.undoLast(fx.game).type, 'fg3_make');
  assert.strictEqual(fx.game.homeScore, 0);
  assert.strictEqual(fx.game.stats.find(s => s.playerId === 'p1').pts, 0);
  assert.strictEqual(TBS.plays.undoLast(fx.game), null, 'nothing left to undo');
  assert.strictEqual(fx.game.events.length, before.events.length);
  assert.strictEqual(fx.game.homeScore, before.homeScore);
  assert.strictEqual(fx.game.awayScore, before.awayScore);
});

check('undo of an aggregate play uses the team line, not a player line with the same team', () => {
  const fx = fixture();
  TBS.plays.applyPlay(fx.game, { playKey: 'ast', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'ast', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  TBS.plays.undoLast(fx.game);
  assert.strictEqual(fx.game.stats.find(s => !s.playerId).ast, 0);
  assert.strictEqual(fx.game.stats.find(s => s.playerId === 'p1').ast, 1);
});

check('team fouls count per quarter and flag the bonus at the 5th foul', () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) {
    TBS.plays.applyPlay(fx.game, { playKey: 'pf', teamId: 'us', playerId: 'p2', players: fx.players, teams: fx.teams });
  }
  let f = TBS.plays.teamFoulSummary(fx.game, 'us');
  assert.strictEqual(f.inQuarter, 4);
  assert.strictEqual(f.bonus, false);
  fx.game.quarter = 2;
  TBS.plays.applyPlay(fx.game, { playKey: 'pf', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  assert.strictEqual(TBS.plays.teamFoulSummary(fx.game, 'us').inQuarter, 0, 'us: new quarter starts at 0');
  assert.strictEqual(TBS.plays.teamFoulSummary(fx.game, 'us').total, 4);
  assert.strictEqual(TBS.plays.teamFoulSummary(fx.game, 'opp').inQuarter, 1);
  for (let i = 0; i < 4; i++) {
    TBS.plays.applyPlay(fx.game, { playKey: 'pf', teamId: 'us', playerId: 'p3', players: fx.players, teams: fx.teams });
  }
  f = TBS.plays.teamFoulSummary(fx.game, 'us');
  assert.strictEqual(f.inQuarter, 4);
  TBS.plays.applyPlay(fx.game, { playKey: 'pf', teamId: 'us', playerId: 'p3', players: fx.players, teams: fx.teams });
  f = TBS.plays.teamFoulSummary(fx.game, 'us');
  assert.strictEqual(f.inQuarter, 5);
  assert.strictEqual(f.bonus, true);
  assert.strictEqual(f.bonusAt, TBS.plays.BONUS_FOULS);
});

check('game phases: pre-game, live, halftime and final', () => {
  const fx = fixture('scheduled');
  assert.strictEqual(TBS.plays.phaseOf(fx.game), 'pregame');
  fx.game.status = 'live';
  assert.strictEqual(TBS.plays.phaseOf(fx.game), 'live');
  fx.game.halftime = true;
  assert.strictEqual(TBS.plays.phaseOf(fx.game), 'halftime');
  fx.game.status = 'final';
  assert.strictEqual(TBS.plays.phaseOf(fx.game), 'final');
});

check('halftime is only kept on live games (normalized away otherwise)', () => {
  const fx = fixture('final');
  fx.game.halftime = true;
  assert.strictEqual(normalized(fx).halftime, false);
  fx.game.status = 'live';
  assert.strictEqual(normalized(fx).halftime, true);
});

check('substitutions are idempotent and produce one event per real change', () => {
  const fx = fixture();
  const first = TBS.plays.setOnCourt(fx.game, 'us', 'p1', true, { player: fx.players[0] });
  assert.strictEqual(first.type, 'sub_in');
  assert.strictEqual(TBS.plays.setOnCourt(fx.game, 'us', 'p1', true, { player: fx.players[0] }), null);
  assert.deepStrictEqual(fx.game.lineup.home, ['p1']);
  assert.strictEqual(TBS.plays.setOnCourt(fx.game, 'us', 'p1', false, { player: fx.players[0] }).type, 'sub_out');
  assert.strictEqual(fx.game.events.length, 2);
});

check('oreb/dreb default to 0 when loading older v3 stat lines', () => {
  const fx = fixture();
  fx.game.stats = [{ playerId: 'p1', teamId: 'us', pts: 4, reb: 2 }];
  const g = normalized(fx);
  assert.strictEqual(g.stats[0].oreb, 0);
  assert.strictEqual(g.stats[0].dreb, 0);
  assert.strictEqual(g.stats[0].reb, 2, 'total rebounds unchanged');
});

check('player aggregates include offensive and defensive rebounds', () => {
  const fx = fixture('final');
  TBS.plays.applyPlay(fx.game, { playKey: 'oreb', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  TBS.plays.applyPlay(fx.game, { playKey: 'dreb', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  const agg = TBS.stats.playerAggregate('p1', [fx.game]);
  assert.strictEqual(agg.totals.oreb, 1);
  assert.strictEqual(agg.totals.dreb, 1);
  assert.strictEqual(agg.totals.reb, 2);
});

check('manual score and undo keep team totals consistent with the event log', () => {
  const fx = fixture();
  TBS.plays.applyPlay(fx.game, { playKey: 'fg2_make', teamId: 'us', playerId: 'p1', players: fx.players, teams: fx.teams });
  TBS.plays.manualScore(fx.game, 'us', 1, { teamName: 'Hawks' });
  TBS.plays.applyPlay(fx.game, { playKey: 'fg3_make', teamId: 'opp', playerId: '', players: fx.players, teams: fx.teams });
  const sum = (side, id) => fx.game.events.filter(e => e.teamId === id)
    .reduce((a, e) => a + e.scoreDelta, 0);
  assert.strictEqual(fx.game.homeScore, sum('home', 'us'));
  assert.strictEqual(fx.game.awayScore, sum('away', 'opp'));
});

console.log('\n✅ ' + passed + ' engine tests passed.');
