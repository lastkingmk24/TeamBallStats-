/* =========================================================================
 * summary.js — PURE export and sharing builders (no DOM, no network).
 *
 *   boxScoreCSV(...)       one tidy table, one row per player / aggregate
 *   csvFile(text)          UTF-8 BOM + text, so Excel detects UTF-8 names
 *   gameSummaryText(...)   plain-text game summary for sharing / e-mail
 *   playerSummaryText(...) plain-text player line for sharing
 *   mailtoHref(...)        mailto: link (the user's own mail client sends it)
 *   reportModel(...)       blocks for the PDF game report (pdf.js)
 *
 * Only measured stats appear here. Generated analysis lives in pro.js and
 * is labelled as such.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const st = TBS.stats;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const pct = (made, att) => (num(att) > 0 ? (num(made) / num(att) * 100).toFixed(1) : '');
  const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '');

  /* A UTF-8 BOM makes Excel open the file as UTF-8 (names with accents). */
  function csvFile(text) {
    return '\uFEFF' + String(text).replace(/^\uFEFF/, '');
  }

  function csvText(rows) {
    return rows.map(r => r.map(st.csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function teamOf(teams, id) {
    return (teams || []).find(t => t.id === id) || { id: id, name: 'Unknown team' };
  }

  function resultFor(game, teamId) {
    const mine = teamId === game.homeTeamId ? game.homeScore : game.awayScore;
    const theirs = teamId === game.homeTeamId ? game.awayScore : game.homeScore;
    if (game.status !== 'final') return '';
    return mine > theirs ? 'W' : (mine < theirs ? 'L' : 'T');
  }

  const BOX_HEADER = ['Game date', 'Season', 'Team', 'Opponent', 'Result', 'Team score', 'Opponent score',
    'Player', 'Number', 'Position', 'MIN', 'PTS', 'REB', 'OREB', 'DREB', 'AST', 'STL', 'BLK', 'TOV', 'PF',
    'FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'Line type'];

  /* One row per player line, one per team aggregate, one totals row per team. */
  function boxScoreRows(game, players, teams, league) {
    const box = st.gameBox(game, players, teams, league);
    const rows = [];
    [['home', game.homeTeamId, game.awayTeamId], ['away', game.awayTeamId, game.homeTeamId]].forEach(([side, teamId, oppId]) => {
      const s = box[side];
      const opp = teamOf(teams, oppId);
      const scoreFor = side === 'home' ? game.homeScore : game.awayScore;
      const scoreAgainst = side === 'home' ? game.awayScore : game.homeScore;
      const head = [game.date || '', game.season || (league && league.season) || '', s.team.name, opp.name,
        resultFor(game, teamId), num(scoreFor), num(scoreAgainst)];
      function line(label, number, position, x, type) {
        return head.concat([label, number, position,
          x.min, x.pts, x.reb, x.oreb, x.dreb, x.ast, x.stl, x.blk, x.tov, x.pf,
          x.fgm, x.fga, pct(x.fgm, x.fga), x.tpm, x.tpa, pct(x.tpm, x.tpa),
          x.ftm, x.fta, pct(x.ftm, x.fta), type]);
      }
      s.rows.forEach(r => rows.push(line(r.player.name, r.player.number, r.player.position || '', r.stats, 'player')));
      if (s.aggregate) rows.push(line('Team totals (no roster)', '', '', s.aggregate, 'team aggregate'));
      rows.push(line('TEAM TOTAL', '', '', s.totals, 'team total'));
    });
    return rows;
  }

  function boxScoreCSV(game, players, teams, league) {
    return csvText([BOX_HEADER].concat(boxScoreRows(game, players, teams, league)));
  }

  function topLines(box, n) {
    return box.home.rows.concat(box.away.rows)
      .map(r => ({ r: r, team: r.player.teamId === box.home.team.id ? box.home.team : box.away.team }))
      .sort((a, b) => b.r.stats.pts - a.r.stats.pts || b.r.stats.reb - a.r.stats.reb)
      .slice(0, n);
  }

  function lineText(r) {
    const s = r.r.stats;
    return r.r.player.name + ' (' + r.team.name + ') ' + s.pts + ' pts, ' + s.reb + ' reb, ' + s.ast + ' ast';
  }

  function teamLineText(team, t) {
    return team.name + ': ' + t.fgm + '/' + t.fga + ' FG (' + (pct(t.fgm, t.fga) || '0') + '%), ' +
      t.tpm + '/' + t.tpa + ' 3PT, ' + t.ftm + '/' + t.fta + ' FT, ' + t.reb + ' REB, ' +
      t.ast + ' AST, ' + t.tov + ' TOV';
  }

  /* Plain-text summary used by Share and the e-mail body. */
  function gameSummaryText(game, players, teams, league) {
    const box = st.gameBox(game, players, teams, league);
    const home = box.home.team.name;
    const away = box.away.team.name;
    const status = game.status === 'final' ? 'Final' : (game.status === 'live' ? 'Live' : 'Scheduled');
    const margin = Math.abs(game.homeScore - game.awayScore);
    const winner = game.homeScore === game.awayScore ? '' :
      (game.homeScore > game.awayScore ? home : away) + ' won by ' + margin + '.';
    const lines = [
      home + ' ' + num(game.homeScore) + ' – ' + away + ' ' + num(game.awayScore) + ' (' + status + ')',
      [game.date, game.location].filter(Boolean).join(' · '),
      winner,
      '',
      'Top performers: ' + (topLines(box, 3).map(lineText).join('; ') || 'no player lines yet') + '.',
      '',
      teamLineText(box.home.team, box.home.totals),
      teamLineText(box.away.team, box.away.totals)
    ];
    [box.home, box.away].forEach(s => {
      if (s.aggregate) {
        lines.push(s.team.name + ' team totals (no roster): ' + s.aggregate.pts + ' pts, ' +
          s.aggregate.reb + ' reb, ' + s.aggregate.ast + ' ast, ' + s.aggregate.tov + ' TOV, ' +
          s.aggregate.pf + ' PF.');
      }
    });
    lines.push('', 'Figures are measured from the recorded plays. Sent from TeamBallStats.');
    return lines.filter((x, i, a) => x !== '' || (a[i - 1] !== '')).join('\n');
  }

  /* Player line for sharing an individual's performance. */
  function playerSummaryText(player, games, teams, league) {
    const agg = st.playerAggregate(player.id, games || []);
    const team = teamOf(teams, player.teamId);
    if (!agg.gp) return player.name + ' (#' + player.number + ') — no final games yet.';
    const t = agg.totals;
    return player.name + ' (#' + player.number + ', ' + team.name + ') — ' + agg.gp + ' games' +
      (league && league.season ? ', ' + league.season : '') + '\n' +
      f1(agg.ppg) + ' PPG · ' + f1(agg.rpg) + ' RPG · ' + f1(agg.apg) + ' APG · ' + f1(agg.spg) + ' SPG · ' +
      f1(agg.bpg) + ' BPG\n' +
      'FG ' + t.fgm + '/' + t.fga + ' (' + (pct(t.fgm, t.fga) || '0') + '%) · 3PT ' + t.tpm + '/' + t.tpa +
      ' (' + (pct(t.tpm, t.tpa) || '0') + '%) · FT ' + t.ftm + '/' + t.fta + ' (' + (pct(t.ftm, t.fta) || '0') + '%)\n' +
      'Measured from recorded final games. Sent from TeamBallStats.';
  }

  /* mailto: link. Mail clients have URL length limits, so long bodies are cut
   * and the user is pointed at the PDF/CSV download instead. */
  function mailtoHref(subject, body, to) {
    const MAX = 1800;
    let text = String(body || '');
    if (text.length > MAX) {
      text = text.slice(0, MAX).replace(/\s+\S*$/, '') +
        '\n\n[Summary shortened — attach the PDF or CSV export for full figures.]';
    }
    return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(String(subject || 'Game report')) +
      '&body=' + encodeURIComponent(text);
  }

  /* Blocks for TBS.pdf.build: the printable game report (measured only). */
  function reportModel(game, players, teams, league, meta) {
    const box = st.gameBox(game, players, teams, league);
    const m = meta || {};
    const home = box.home.team.name;
    const away = box.away.team.name;
    const status = game.status === 'final' ? 'Final' : (game.status === 'live' ? 'Live' : 'Scheduled');
    const blocks = [
      { type: 'h1', text: 'Game report' },
      { type: 'h2', text: home + ' ' + num(game.homeScore) + ' – ' + num(game.awayScore) + ' ' + away },
      { type: 'p', text: status + ' · ' + [game.date, game.time, game.location].filter(Boolean).join(' · ') +
        (league && league.season ? ' · Season ' + league.season : '') },
      { type: 'p', text: game.homeScore === game.awayScore ? 'The game was tied.' :
        (game.homeScore > game.awayScore ? home : away) + ' won by ' +
        Math.abs(game.homeScore - game.awayScore) + ' points.' }
    ];
    const q = st.quarterScores(game, league);
    if (q.tracked.some(Boolean)) {
      const cols = [{ label: 'Team' }].concat(Array.from({ length: q.count }, (_, i) => ({ label: 'Q' + (i + 1), align: 'right' })))
        .concat([{ label: 'Final', align: 'right' }]);
      const rows = [
        [home].concat(q.home.map((v, i) => (q.tracked[i] ? v : '-'))).concat([game.homeScore]),
        [away].concat(q.away.map((v, i) => (q.tracked[i] ? v : '-'))).concat([game.awayScore])
      ];
      blocks.push({ type: 'h2', text: 'Scoring by quarter' }, { type: 'table', columns: cols, rows: rows });
    }
    const COLS = [
      { label: '#', align: 'right' }, { label: 'Player' }, { label: 'MIN', align: 'right' },
      { label: 'PTS', align: 'right' }, { label: 'REB', align: 'right' }, { label: 'OFF', align: 'right' },
      { label: 'DEF', align: 'right' }, { label: 'AST', align: 'right' }, { label: 'STL', align: 'right' },
      { label: 'BLK', align: 'right' }, { label: 'TOV', align: 'right' }, { label: 'PF', align: 'right' },
      { label: 'FG', align: 'right' }, { label: '3PT', align: 'right' }, { label: 'FT', align: 'right' }
    ];
    const rowOf = (num_, name, x) => [num_, name, x.min, x.pts, x.reb, x.oreb, x.dreb, x.ast, x.stl, x.blk,
      x.tov, x.pf, x.fgm + '/' + x.fga, x.tpm + '/' + x.tpa, x.ftm + '/' + x.fta];
    [box.away, box.home].forEach(s => {
      blocks.push({ type: 'h2', text: s.team.name + ' — ' + num(s.score) });
      const rows = s.rows.map(r => rowOf(r.player.number, r.player.name, r.stats));
      if (s.aggregate) rows.push(rowOf('', 'Team totals (no roster)', s.aggregate));
      rows.push(rowOf('', 'TEAM TOTAL', s.totals));
      if (!s.rows.length && !s.aggregate) {
        blocks.push({ type: 'p', text: 'No player lines recorded for this team.' });
      } else {
        blocks.push({ type: 'table', columns: COLS, rows: rows });
      }
      blocks.push({ type: 'p', text: 'Team fouls: ' + s.totals.pf + ' · Turnovers: ' + s.totals.tov +
        ' · FG ' + (pct(s.totals.fgm, s.totals.fga) || '0') + '% · 3PT ' + (pct(s.totals.tpm, s.totals.tpa) || '0') +
        '% · FT ' + (pct(s.totals.ftm, s.totals.fta) || '0') + '%' });
    });
    blocks.push({ type: 'space', size: 6 },
      { type: 'p', text: 'Every figure in this report is measured from the recorded plays and box score. ' +
        'Columns: OFF/DEF = offensive/defensive rebounds; FG, 3PT and FT show made/attempted.' });
    return {
      title: (m.title || 'Game report') + ' — ' + home + ' vs ' + away + ' (' + (game.date || '') + ')',
      footer: 'TeamBallStats' + (m.generatedAt ? ' · generated ' + m.generatedAt : ''),
      blocks: blocks
    };
  }

  TBS.summary = {
    BOX_HEADER: BOX_HEADER,
    csvFile: csvFile,
    csvText: csvText,
    boxScoreRows: boxScoreRows,
    boxScoreCSV: boxScoreCSV,
    gameSummaryText: gameSummaryText,
    playerSummaryText: playerSummaryText,
    mailtoHref: mailtoHref,
    reportModel: reportModel
  };
})(window.TBS = window.TBS || {});
