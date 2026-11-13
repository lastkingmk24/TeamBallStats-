/* =========================================================================
 * plays.js — PURE play engine shared by every way of recording stats.
 *
 * Classic entry (player first), two-tap entry (stat first, then jersey),
 * keyboard shortcuts and undo all call these functions, so a play always
 * changes the box score, the score and the play-by-play in exactly one way.
 *
 *   applyPlay(game, opts)   record a stat for a roster player OR an opponent
 *                           aggregate (playerId '' + aggregate: true)
 *   undoLast(game)          reverse the most recent event exactly
 *   setOnCourt(game, ...)   substitution in/out (lineup + sub event)
 *   manualScore(game, ...)  score correction event
 *   teamFouls(...)          team fouls per quarter / game (bonus rule below)
 *   phaseOf(game)           'pregame' | 'live' | 'halftime' | 'final'
 *
 * No DOM, no storage writes: callers persist the mutated draft.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

  /* Team fouls per quarter at which the team is in the bonus (NBA / FIBA
   * style: the 5th team foul of a quarter). Change here to adjust the rule. */
  const BONUS_FOULS = 5;

  /* Play definitions. statDeltas are the exact amounts added to the line and
   * are also what undo subtracts again, so keep them integral. */
  const PLAYS = {
    ft_make:  { label: 'FT made',    stats: { ftm: 1, fta: 1, pts: 1 }, score: 1, group: 'scoring' },
    fg2_make: { label: '2PT made',   stats: { fgm: 1, fga: 1, pts: 2 }, score: 2, group: 'scoring' },
    fg3_make: { label: '3PT made',   stats: { fgm: 1, fga: 1, tpm: 1, tpa: 1, pts: 3 }, score: 3, group: 'scoring' },
    ft_miss:  { label: 'FT missed',  stats: { fta: 1 }, score: 0, group: 'misses' },
    fg2_miss: { label: '2PT missed', stats: { fga: 1 }, score: 0, group: 'misses' },
    fg3_miss: { label: '3PT missed', stats: { fga: 1, tpa: 1 }, score: 0, group: 'misses' },
    reb:      { label: 'Rebound',    stats: { reb: 1 }, score: 0, group: 'other' },
    oreb:     { label: 'Offensive rebound', stats: { reb: 1, oreb: 1 }, score: 0, group: 'other' },
    dreb:     { label: 'Defensive rebound', stats: { reb: 1, dreb: 1 }, score: 0, group: 'other' },
    ast:      { label: 'Assist',     stats: { ast: 1 }, score: 0, group: 'other' },
    stl:      { label: 'Steal',      stats: { stl: 1 }, score: 0, group: 'other' },
    blk:      { label: 'Block',      stats: { blk: 1 }, score: 0, group: 'other' },
    tov:      { label: 'Turnover',   stats: { tov: 1 }, score: 0, group: 'other' },
    pf:       { label: 'Foul',       stats: { pf: 1 }, score: 0, group: 'other' },
    min:      { label: 'Minute',     stats: { min: 1 }, score: 0, group: 'other' }
  };

  /* Plays that can carry an optional shot location. */
  const SHOT_PLAYS = { ft_make: false, ft_miss: false, fg2_make: true, fg2_miss: true, fg3_make: true, fg3_miss: true };

  function sideOf(game, teamId) {
    if (!game || !teamId) return null;
    if (teamId === game.homeTeamId) return 'home';
    if (teamId === game.awayTeamId) return 'away';
    return null;
  }

  function isAggregate(line) {
    return !!line && (line.aggregate === true || !line.playerId);
  }

  /* Find the stat line a play should change. Player lines are matched by
   * playerId; aggregate lines by teamId (there is one per team). */
  function findLine(game, teamId, playerId) {
    return (game.stats || []).find(s => (playerId
      ? s.playerId === playerId
      : (isAggregate(s) && s.teamId === teamId))) || null;
  }

  function ensureLine(game, teamId, playerId) {
    let line = findLine(game, teamId, playerId);
    if (!line) {
      line = playerId
        ? TBS.storage.blankStats(playerId, teamId)
        : TBS.storage.blankAggregate(teamId);
      game.stats = game.stats || [];
      game.stats.push(line);
    }
    if (line.teamId !== teamId) line.teamId = teamId;
    return line;
  }

  function nameOf(list, id, fallback) {
    const hit = (list || []).find(x => x.id === id);
    return hit ? hit.name : fallback;
  }

  /* opts: { playKey, teamId, playerId, shot, quarter, clockSeconds, ts,
   *         players, teams, id }
   * playerId '' with a teamId records an opponent aggregate play. */
  function applyPlay(game, opts) {
    const def = PLAYS[opts.playKey];
    if (!def) return null;
    const teamId = opts.teamId;
    const side = sideOf(game, teamId);
    if (!side) return null;
    const playerId = opts.playerId || '';
    const line = ensureLine(game, teamId, playerId);
    Object.keys(def.stats).forEach(k => {
      line[k] = Math.max(0, num(line[k]) + def.stats[k]);
    });
    if (def.score) {
      game[side + 'Score'] = Math.max(0, num(game[side + 'Score']) + def.score);
    }
    const shot = SHOT_PLAYS[opts.playKey] && opts.shot ? Object.assign({}, opts.shot) : null;
    const who = playerId
      ? nameOf(opts.players, playerId, 'Player')
      : nameOf(opts.teams, teamId, 'Opponent') + ' (team)';
    const event = {
      id: opts.id || TBS.storage.uid('event'),
      type: opts.playKey,
      label: who + ' — ' + def.label,
      teamId: teamId,
      playerId: playerId,
      aggregate: !playerId,
      statDeltas: Object.assign({}, def.stats),
      scoreDelta: def.score || 0,
      shot: shot,
      quarter: game.quarter,
      clockSeconds: Math.ceil(num(opts.clockSeconds)),
      ts: opts.ts || Date.now()
    };
    game.events = game.events || [];
    game.events.push(event);
    return event;
  }

  /* Substitution. Returns the event, or null when nothing changed. */
  function setOnCourt(game, teamId, playerId, onCourt, opts) {
    const side = sideOf(game, teamId);
    if (!side || !playerId) return null;
    game.lineup = game.lineup || { home: [], away: [] };
    const ids = game.lineup[side] || [];
    const currently = ids.indexOf(playerId) >= 0;
    if (currently === !!onCourt) return null;
    game.lineup[side] = onCourt ? ids.concat(playerId) : ids.filter(id => id !== playerId);
    const player = (opts && opts.player) || null;
    const event = {
      id: TBS.storage.uid('event'),
      type: onCourt ? 'sub_in' : 'sub_out',
      label: (onCourt ? 'Sub in — ' : 'Sub out — ') + (player ? player.name : 'Player'),
      teamId: teamId, playerId: playerId,
      statDeltas: {}, scoreDelta: 0, shot: null,
      quarter: game.quarter,
      clockSeconds: Math.ceil(num(opts && opts.clockSeconds)),
      ts: (opts && opts.ts) || Date.now()
    };
    game.events.push(event);
    return event;
  }

  /* Manual score correction (+/- points). */
  function manualScore(game, teamId, delta, opts) {
    const side = sideOf(game, teamId);
    if (!side) return null;
    game[side + 'Score'] = Math.max(0, num(game[side + 'Score']) + delta);
    const event = {
      id: TBS.storage.uid('event'), type: 'manual',
      label: (delta > 0 ? '+' : '') + delta + ' ' + ((opts && opts.teamName) || 'team') + ' (manual)',
      teamId: teamId, playerId: '', statDeltas: {}, scoreDelta: delta, shot: null,
      quarter: game.quarter, clockSeconds: Math.ceil(num(opts && opts.clockSeconds)),
      ts: (opts && opts.ts) || Date.now()
    };
    game.events = game.events || [];
    game.events.push(event);
    return event;
  }

  /* Reverse the last event exactly. Returns the removed event or null. */
  function undoLast(game) {
    const events = game.events || [];
    if (!events.length) return null;
    const e = events.pop();
    const deltas = e.statDeltas || {};
    if (Object.keys(deltas).length) {
      const line = findLine(game, e.teamId, e.playerId || '');
      if (line) {
        Object.keys(deltas).forEach(k => {
          line[k] = Math.max(0, num(line[k]) - num(deltas[k]));
        });
      }
    }
    if (e.scoreDelta) {
      const side = sideOf(game, e.teamId);
      if (side) game[side + 'Score'] = Math.max(0, num(game[side + 'Score']) - num(e.scoreDelta));
    }
    if (e.type === 'sub_in' || e.type === 'sub_out') {
      const side = sideOf(game, e.teamId);
      if (side) {
        game.lineup = game.lineup || { home: [], away: [] };
        const ids = game.lineup[side] || [];
        if (e.type === 'sub_in') game.lineup[side] = ids.filter(id => id !== e.playerId);
        else if (ids.indexOf(e.playerId) < 0) game.lineup[side] = ids.concat(e.playerId);
      }
    }
    return e;
  }

  /* Personal + team fouls. Team fouls come from the team's pf events (player
   * fouls and opponent aggregate fouls alike). */
  function teamFouls(game, teamId, quarter) {
    return (game.events || []).reduce((n, e) => {
      if (e.teamId !== teamId) return n;
      if (quarter !== undefined && quarter !== null && num(e.quarter) !== num(quarter)) return n;
      return n + num(e.statDeltas && e.statDeltas.pf);
    }, 0);
  }

  function teamFoulSummary(game, teamId) {
    const q = num(game.quarter) || 1;
    const inQuarter = teamFouls(game, teamId, q);
    return {
      quarter: q,
      inQuarter: inQuarter,
      total: teamFouls(game, teamId),
      bonus: inQuarter >= BONUS_FOULS,
      bonusAt: BONUS_FOULS
    };
  }

  /* Game phase used by the console, scoreboard and status badges. */
  function phaseOf(game) {
    if (!game) return 'pregame';
    if (game.status === 'final') return 'final';
    if (game.status === 'live') return game.halftime ? 'halftime' : 'live';
    return 'pregame';
  }

  TBS.plays = {
    PLAYS: PLAYS,
    SHOT_PLAYS: SHOT_PLAYS,
    BONUS_FOULS: BONUS_FOULS,
    sideOf: sideOf,
    isAggregate: isAggregate,
    findLine: findLine,
    applyPlay: applyPlay,
    setOnCourt: setOnCourt,
    manualScore: manualScore,
    undoLast: undoLast,
    teamFouls: teamFouls,
    teamFoulSummary: teamFoulSummary,
    phaseOf: phaseOf
  };
})(window.TBS = window.TBS || {});
