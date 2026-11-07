/* =========================================================================
 * analytics.js — PURE advanced analytics (no DOM, no storage, no canvas).
 *
 *   per36        per-36-minute rates from a stats.playerAggregate() result
 *   plusMinus    +/− derived from the live play-by-play and the lineup
 *   minutesFromLineup  on-court seconds tracked from substitution events
 *   streaks      hot/cold form vs. season average
 *   gameFlow     cumulative margin series for the game-flow chart
 *   shotZones    approximate court zones / zone shooting splits
 *
 * Everything is deterministic so tests/smoke.js can verify it in Node.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const round = (v, places) => {
    const p = Math.pow(10, places === undefined ? 1 : places);
    return Math.round(v * p) / p;
  };

  function quarterCount(league) {
    return Math.max(1, Math.min(8, (league && league.quarters) || 4));
  }

  function quarterMinutes(league) {
    return Math.max(1, Math.min(60, (league && league.quarterMinutes) || 10));
  }

  /* Seconds elapsed in the game at a given quarter / clock reading. */
  function elapsedSeconds(league, quarter, clockSeconds) {
    const qm = quarterMinutes(league) * 60;
    const q = Math.max(1, Math.min(quarterCount(league), Math.round(num(quarter) || 1)));
    const clock = Math.min(qm, Math.max(0, num(clockSeconds)));
    return (q - 1) * qm + (qm - clock);
  }

  function gameLengthSeconds(league, game) {
    const base = quarterCount(league) * quarterMinutes(league) * 60;
    if (!game || !Array.isArray(game.events) || !game.events.length) return base;
    /* Accommodate overtime or a shortened game: never shorter than the last play. */
    const last = game.events.reduce((max, e) =>
      Math.max(max, elapsedSeconds(league, e.quarter, e.clockSeconds)), 0);
    return Math.max(base, last);
  }

  /* Per-36-minute production. */
  function per36(agg) {
    const totals = (agg && agg.totals) || {};
    const minutes = num(totals.min);
    if (minutes <= 0) {
      return {
        minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
        fga: 0, tpa: 0, fta: 0, qualified: false
      };
    }
    const factor = 36 / minutes;
    const scale = key => round(num(totals[key]) * factor);
    return {
      minutes: minutes,
      pts: scale('pts'),
      reb: scale('reb'),
      ast: scale('ast'),
      stl: scale('stl'),
      blk: scale('blk'),
      tov: scale('tov'),
      pf: scale('pf'),
      fga: scale('fga'),
      tpa: scale('tpa'),
      fta: scale('fta'),
      qualified: true
    };
  }

  /* Players who appear in the game's box score are the default "on court"
   * set for both teams; substitution events then move players on and off.
   * Without substitution data this yields a team-differential +/− — a
   * documented approximation, never an invented number. */
  function starterSets(game) {
    const sets = { home: [], away: [] };
    const seen = {};
    ((game && game.stats) || []).forEach(line => {
      if (!line.playerId || seen[line.playerId]) return;
      seen[line.playerId] = true;
      if (line.teamId === game.homeTeamId) sets.home.push(line.playerId);
      else if (line.teamId === game.awayTeamId) sets.away.push(line.playerId);
    });
    const lineup = (game && game.lineup) || {};
    ['home', 'away'].forEach(side => {
      (Array.isArray(lineup[side]) ? lineup[side] : []).forEach(id => {
        if (id && sets[side].indexOf(id) < 0) sets[side].push(id);
      });
    });
    return sets;
  }

  /* +/− per player, derived from score deltas in the play-by-play. */
  function plusMinus(game) {
    const result = {
      byPlayer: {},
      home: 0,
      away: 0,
      events: 0,
      tracked: false
    };
    if (!game) return result;
    const sets = starterSets(game);
    const add = (playerId, value) => {
      if (!playerId) return;
      result.byPlayer[playerId] = round(num(result.byPlayer[playerId]) + value, 0);
    };
    const sub = (side, playerId, on) => {
      const list = sets[side];
      const at = list.indexOf(playerId);
      if (on && at < 0) list.push(playerId);
      if (!on && at >= 0) list.splice(at, 1);
    };

    ((game.events || [])).forEach(e => {
      if (!e) return;
      const side = e.teamId === game.homeTeamId ? 'home'
        : (e.teamId === game.awayTeamId ? 'away' : null);
      if (e.type === 'sub_in' && side) { sub(side, e.playerId, true); return; }
      if (e.type === 'sub_out' && side) { sub(side, e.playerId, false); return; }
      const delta = num(e.scoreDelta);
      if (!delta || !side) return;
      result.events++;
      if (side === 'home') result.home += delta;
      else result.away += delta;
      sets[side].forEach(id => add(id, delta));
      sets[side === 'home' ? 'away' : 'home'].forEach(id => add(id, -delta));
    });
    result.tracked = result.events > 0;
    return result;
  }

  /* On-court seconds per player, built from sub_in / sub_out events.
   * Only players with substitution data are returned. */
  function minutesFromLineup(game, league) {
    const out = { byPlayer: {}, players: 0 };
    if (!game || !Array.isArray(game.events)) return out;
    const end = gameLengthSeconds(league, game);
    const open = {};
    const seconds = {};

    game.events.forEach(e => {
      if (!e || !e.playerId) return;
      const at = elapsedSeconds(league, e.quarter, e.clockSeconds);
      if (e.type === 'sub_in') {
        if (open[e.playerId] === undefined) open[e.playerId] = at;
      } else if (e.type === 'sub_out') {
        if (open[e.playerId] !== undefined) {
          seconds[e.playerId] = num(seconds[e.playerId]) + Math.max(0, at - open[e.playerId]);
          delete open[e.playerId];
        }
      }
    });
    Object.keys(open).forEach(id => {
      seconds[id] = num(seconds[id]) + Math.max(0, end - open[id]);
    });
    Object.keys(seconds).forEach(id => {
      out.byPlayer[id] = Math.max(0, seconds[id]);
    });
    out.players = Object.keys(out.byPlayer).length;
    return out;
  }

  /* Hot / cold form: last five scoring games vs the season average. */
  function streaks(playerId, games) {
    const finals = (games || []).filter(g => g && g.status === 'final' &&
      (g.stats || []).some(s => s.playerId === playerId))
      .slice()
      .sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
    const points = finals.map(g => {
      const line = (g.stats || []).find(s => s.playerId === playerId);
      return num(line && line.pts);
    });
    const last5 = points.slice(-5);
    const season = points.length ? points.reduce((a, b) => a + b, 0) / points.length : 0;
    const recent = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
    const ratio = season > 0 ? recent / season : 0;
    let label = 'neutral';
    if (last5.length >= 2 && season > 0) {
      if (ratio >= 1.15) label = 'hot';
      else if (ratio <= 0.85) label = 'cold';
    }
    return {
      label: label,
      seasonAvg: round(season),
      recentAvg: round(recent),
      ratio: round(ratio, 2),
      diff: round(recent - season),
      last5: last5,
      series: points
    };
  }

  /* Cumulative margin series for the game-flow chart. */
  function gameFlow(game) {
    const points = [];
    let home = 0;
    let away = 0;
    ((game && game.events) || []).forEach(e => {
      const delta = num(e && e.scoreDelta);
      if (!delta || !e) return;
      if (e.teamId === game.homeTeamId) home += delta;
      else if (e.teamId === game.awayTeamId) away += delta;
      else return;
      points.push({
        home: home,
        away: away,
        margin: home - away,
        quarter: Math.max(1, Math.round(num(e.quarter) || 1)),
        clockSeconds: Math.max(0, num(e.clockSeconds)),
        label: e.label || 'Score',
        teamId: e.teamId
      });
    });
    let maxAbs = 1;
    points.forEach(p => { maxAbs = Math.max(maxAbs, Math.abs(p.margin)); });
    return {
      points: points,
      maxAbs: maxAbs,
      home: home,
      away: away,
      empty: points.length === 0
    };
  }

  /* Court geometry helpers. Coordinates are normalised 0..1 on a half court:
   * x = 0 (left sideline) .. 1 (right sideline)
   * y = 0 (baseline)      .. 1 (half-court line)
   * The basket sits at x = 0.5, y ≈ 0.11. Distances are converted to feet so
   * the standard 23.75 ft arc and 4 ft restricted area can be applied. */
  const COURT = {
    widthFt: 50,
    halfLengthFt: 47,
    hoopX: 0.5,
    hoopY: 0.11,
    arcFt: 23.75,
    paintFt: 4
  };

  function shotDistanceFt(shot) {
    if (!shot) return null;
    const dx = (num(shot.x) - COURT.hoopX) * COURT.widthFt;
    const dy = (num(shot.y) - COURT.hoopY) * COURT.halfLengthFt;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function zoneOf(shot, isThree) {
    const dist = shotDistanceFt(shot);
    if (dist === null) return 'Unknown';
    if (dist <= COURT.paintFt) return 'Paint';
    const three = isThree === undefined ? dist >= COURT.arcFt : !!isThree;
    if (three) {
      const dx = Math.abs(num(shot.x) - COURT.hoopX) * COURT.widthFt;
      if (dx >= 20) return 'Corner 3';
      if (dx >= 11) return 'Wing 3';
      return 'Top 3';
    }
    return dist > 14 ? 'Long mid' : 'Mid-range';
  }

  const THREE_EVENT = { fg3_make: true, fg3_miss: true };

  /* Shot chart data + zone splits from the play-by-play. */
  function shotZones(game) {
    const zones = {};
    const shots = [];
    ((game && game.events) || []).forEach(e => {
      if (!e || !e.shot) return;
      const made = /_make$/.test(String(e.type || '')) || num(e.scoreDelta) > 0;
      const isThree = THREE_EVENT[e.type] === true || (num(e.scoreDelta) === 3);
      const zone = zoneOf(e.shot, isThree);
      const entry = {
        playerId: e.playerId || '',
        teamId: e.teamId || '',
        x: num(e.shot.x),
        y: num(e.shot.y),
        made: made,
        three: isThree,
        zone: zone,
        quarter: Math.max(1, Math.round(num(e.quarter) || 1)),
        clockSeconds: Math.max(0, num(e.clockSeconds))
      };
      shots.push(entry);
      if (!zones[zone]) zones[zone] = { zone: zone, made: 0, attempts: 0, pct: null };
      zones[zone].attempts += 1;
      if (made) zones[zone].made += 1;
    });
    Object.keys(zones).forEach(key => {
      const z = zones[key];
      z.pct = z.attempts ? round((z.made / z.attempts) * 100) : null;
    });
    const order = ['Paint', 'Mid-range', 'Long mid', 'Top 3', 'Wing 3', 'Corner 3', 'Unknown'];
    const rows = order.filter(z => zones[z]).map(z => zones[z]);
    const total = shots.length;
    const made = shots.filter(s => s.made).length;
    return {
      shots: shots,
      zones: rows,
      total: total,
      made: made,
      pct: total ? round((made / total) * 100) : null
    };
  }

  /* Team totals for one game side (used by recaps and analysis panels). */
  function teamTotals(game, teamId) {
    const lines = ((game && game.stats) || []).filter(s => s.teamId === teamId);
    const totals = TBS.stats.sumLines(lines);
    return Object.assign({}, totals, TBS.stats.shooting(totals), { players: lines.length });
  }

  /* Simple offensive/defensive rating helper: points per 100 possessions
   * estimated from the game clock (fallback: per 40 minutes of game time). */
  function gamePace(game, league) {
    const seconds = gameLengthSeconds(league, game);
    const minutes = seconds / 60;
    return {
      seconds: seconds,
      minutes: minutes,
      pointsPerMinute: minutes > 0
        ? round((num(game && game.homeScore) + num(game && game.awayScore)) / minutes)
        : 0
    };
  }

  TBS.analytics = {
    elapsedSeconds: elapsedSeconds,
    gameLengthSeconds: gameLengthSeconds,
    per36: per36,
    plusMinus: plusMinus,
    minutesFromLineup: minutesFromLineup,
    streaks: streaks,
    gameFlow: gameFlow,
    starterSets: starterSets,
    shotDistanceFt: shotDistanceFt,
    zoneOf: zoneOf,
    shotZones: shotZones,
    teamTotals: teamTotals,
    gamePace: gamePace,
    COURT: COURT,
    round: round
  };
})(window.TBS = window.TBS || {});
