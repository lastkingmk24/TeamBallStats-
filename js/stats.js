/* =========================================================================
 * stats.js — pure calculation helpers (no DOM, no storage writes)
 * Everything here is deterministic and independently testable.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const FIELDS = ['pts', 'reb', 'ast', 'stl', 'blk', 'tov',
    'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pf', 'min'];

  const isFinal = g => g && g.status === 'final';
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

  function sumLines(lines) {
    const totals = {};
    FIELDS.forEach(f => { totals[f] = 0; });
    (lines || []).forEach(line => {
      FIELDS.forEach(f => { totals[f] += num(line[f]); });
    });
    return totals;
  }

  function pct(made, attempted) {
    const a = num(attempted);
    return a > 0 ? (num(made) / a) * 100 : null;
  }

  function avg(total, count) {
    return count > 0 ? total / count : 0;
  }

  /* Per-player season averages + shooting splits. */
  function playerAggregate(playerId, games) {
    const played = (games || []).filter(g =>
      isFinal(g) && (g.stats || []).some(s => s.playerId === playerId)
    );
    const lines = played.map(g => (g.stats || []).find(s => s.playerId === playerId));
    const totals = sumLines(lines);
    const gp = played.length;
    const fga = totals.fga;
    const tpa = totals.tpa;
    const fta = totals.fta;
    const tsDenominator = 2 * (fga + 0.44 * fta);

    return {
      gp: gp,
      totals: totals,
      ppg: avg(totals.pts, gp),
      rpg: avg(totals.reb, gp),
      apg: avg(totals.ast, gp),
      spg: avg(totals.stl, gp),
      bpg: avg(totals.blk, gp),
      topg: avg(totals.tov, gp),
      mpg: avg(totals.min, gp),
      fgPct: pct(totals.fgm, fga),
      tpPct: pct(totals.tpm, tpa),
      ftPct: pct(totals.ftm, fta),
      efgPct: pct(totals.fgm + 0.5 * totals.tpm, fga),
      tsPct: tsDenominator > 0 ? (totals.pts / tsDenominator) * 100 : null
    };
  }

  function resultFor(game, teamId) {
    const isHome = game.homeTeamId === teamId;
    const us = isHome ? num(game.homeScore) : num(game.awayScore);
    const them = isHome ? num(game.awayScore) : num(game.homeScore);
    if (us > them) return 'W';
    if (us < them) return 'L';
    return 'T';
  }

  function teamGames(teamId, games) {
    return (games || []).filter(g =>
      isFinal(g) && (g.homeTeamId === teamId || g.awayTeamId === teamId)
    );
  }

  function streakOf(gameList, teamId) {
    if (!gameList.length) return '—';
    const ordered = gameList.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time))
    );
    const letter = resultFor(ordered[0], teamId);
    if (letter === 'T') return 'T1';
    let count = 0;
    for (const g of ordered) {
      if (resultFor(g, teamId) !== letter) break;
      count++;
    }
    return letter + count;
  }

  /* Record, points for/against, splits and form for one team. */
  function teamRecord(games, teamId) {
    const id = teamId || ((games || [])[0] && (games || [])[0].homeTeamId) || '';
    const list = teamGames(id, games);
    const rec = {
      w: 0, l: 0, t: 0, gp: list.length, pf: 0, pa: 0, diff: 0, pct: 0,
      home: { w: 0, l: 0, t: 0 }, away: { w: 0, l: 0, t: 0 },
      streak: '—', lastFive: [],
      pfPerGame: 0, paPerGame: 0
    };

    list.forEach(g => {
      const home = g.homeTeamId === id;
      const us = home ? num(g.homeScore) : num(g.awayScore);
      const them = home ? num(g.awayScore) : num(g.homeScore);
      const r = resultFor(g, id);
      rec.pf += us;
      rec.pa += them;
      const side = home ? rec.home : rec.away;
      if (r === 'W') { rec.w++; side.w++; }
      else if (r === 'L') { rec.l++; side.l++; }
      else { rec.t++; side.t++; }
    });

    rec.diff = rec.pf - rec.pa;
    rec.pct = rec.gp > 0 ? (rec.w + 0.5 * rec.t) / rec.gp : 0;
    rec.pfPerGame = avg(rec.pf, rec.gp);
    rec.paPerGame = avg(rec.pa, rec.gp);
    rec.streak = streakOf(list, id);
    rec.lastFive = list.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time))
    ).slice(0, 5).map(g => resultFor(g, id));
    return rec;
  }

  function formatGB(value) {
    if (value === 0) return '—';
    return (Math.round(value * 10) / 10).toString();
  }

  /* Full league table. Only FINAL games count. */
  function standings(teams, games, primaryTeamId) {
    const rows = (teams || []).map(team => {
      const rec = teamRecord(games, team.id);
      return {
        team: team,
        primary: team.id === primaryTeamId,
        gp: rec.gp, w: rec.w, l: rec.l, t: rec.t,
        pct: rec.pct, pf: rec.pf, pa: rec.pa, diff: rec.diff,
        pfPerGame: rec.pfPerGame, paPerGame: rec.paPerGame,
        home: rec.home, away: rec.away,
        streak: rec.streak, lastFive: rec.lastFive
      };
    });
    rows.sort((a, b) =>
      b.pct - a.pct || b.diff - a.diff || b.pf - a.pf ||
      String(a.team.name).localeCompare(String(b.team.name))
    );
    const leader = rows[0];
    rows.forEach(row => {
      const gb = leader ? ((leader.w - row.w) + (row.l - leader.l)) / 2 : 0;
      row.gb = formatGB(gb);
    });
    return rows;
  }

  function quarterScores(game, league) {
    const count = Math.max(1, Math.min(8, (league && league.quarters) || 4));
    const home = new Array(count).fill(0);
    const away = new Array(count).fill(0);
    const tracked = new Array(count).fill(false);
    (game.events || []).forEach(e => {
      if (!num(e.scoreDelta)) return;
      const idx = Math.min(count, Math.max(1, num(e.quarter) || 1)) - 1;
      if (e.teamId === game.homeTeamId) home[idx] += num(e.scoreDelta);
      else if (e.teamId === game.awayTeamId) away[idx] += num(e.scoreDelta);
      else return;
      tracked[idx] = true;
    });
    return { count: count, home: home, away: away, tracked: tracked };
  }

  /* Two-team box score with player rows, team totals and quarter breakdown. */
  function gameBox(game, players, teams, league) {
    function side(teamId, score) {
      const team = (teams || []).find(t => t.id === teamId) ||
        { id: teamId, name: 'Unknown Team', short: 'UNK' };
      const rows = (game.stats || []).filter(s => s.teamId === teamId).map(line => {
        const player = (players || []).find(p => p.id === line.playerId);
        const stats = {};
        FIELDS.forEach(f => { stats[f] = num(line[f]); });
        return {
          playerId: line.playerId,
          player: player || { name: 'Former player', number: '—', position: '' },
          stats: stats
        };
      });
      rows.sort((a, b) =>
        (Number(a.player.number) || 999) - (Number(b.player.number) || 999) ||
        String(a.player.name).localeCompare(String(b.player.name))
      );
      return {
        team: team,
        score: num(score),
        rows: rows,
        totals: sumLines((game.stats || []).filter(s => s.teamId === teamId)),
        computedScore: sumLines((game.stats || []).filter(s => s.teamId === teamId)).pts
      };
    }
    return {
      home: side(game.homeTeamId, game.homeScore),
      away: side(game.awayTeamId, game.awayScore),
      quarters: quarterScores(game, league),
      result: resultFor(game, game.homeTeamId)
    };
  }

  function leaderboard(players, games, minAttempts) {
    const minFGA = minAttempts === undefined ? 10 : minAttempts;
    const all = (players || []).map(player => ({
      player: player,
      agg: playerAggregate(player.id, games)
    })).filter(x => x.agg.gp > 0);

    function top(key, getter) {
      return all.slice().sort((a, b) => getter(b) - getter(a))
        .slice(0, 5).map(x => ({
          player: x.player,
          value: getter(x),
          gp: x.agg.gp
        }));
    }
    return {
      ppg: top('ppg', x => x.agg.ppg),
      rpg: top('rpg', x => x.agg.rpg),
      apg: top('apg', x => x.agg.apg),
      spg: top('spg', x => x.agg.spg),
      bpg: top('bpg', x => x.agg.bpg),
      fgPct: all.filter(x => x.agg.totals.fga >= minFGA)
        .sort((a, b) => b.agg.fgPct - a.agg.fgPct)
        .slice(0, 5).map(x => ({
          player: x.player, value: x.agg.fgPct, gp: x.agg.gp
        }))
    };
  }

  function csvCell(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* Full player-statistics CSV (properly escaped: names may contain commas). */
  function toCSV(players, games, teams) {
    const header = [
      'Player', '#', 'Position', 'Team', 'GP', 'MIN', 'PTS', 'PPG', 'REB', 'RPG',
      'AST', 'APG', 'STL', 'SPG', 'BLK', 'BPG', 'TOV',
      'FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%',
      'eFG%', 'TS%', 'PF'
    ];
    const round1 = v => (Math.round(v * 10) / 10).toFixed(1);
    const pctCell = v => (v === null ? '' : round1(v));
    const rows = (players || []).map(p => {
      const a = playerAggregate(p.id, games);
      const team = (teams || []).find(t => t.id === p.teamId);
      return [
        p.name, p.number, p.position || '', team ? team.name : '',
        a.gp, a.totals.min, a.totals.pts, round1(a.ppg),
        a.totals.reb, round1(a.rpg), a.totals.ast, round1(a.apg),
        a.totals.stl, round1(a.spg), a.totals.blk, round1(a.bpg),
        a.totals.tov, a.totals.fgm, a.totals.fga, pctCell(a.fgPct),
        a.totals.tpm, a.totals.tpa, pctCell(a.tpPct),
        a.totals.ftm, a.totals.fta, pctCell(a.ftPct),
        pctCell(a.efgPct), pctCell(a.tsPct), a.totals.pf
      ];
    });
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  TBS.stats = {
    FIELDS: FIELDS,
    sumLines: sumLines,
    pct: pct,
    avg: avg,
    isFinal: isFinal,
    resultFor: resultFor,
    playerAggregate: playerAggregate,
    teamRecord: teamRecord,
    standings: standings,
    quarterScores: quarterScores,
    gameBox: gameBox,
    leaderboard: leaderboard,
    toCSV: toCSV,
    csvCell: csvCell
  };
})(window.TBS = window.TBS || {});
