/* =========================================================================
 * reports.js — printable, PDF-style reports using only window.print().
 * No jsPDF, no CDN, no external library: the browser's own print dialog
 * supplies "Save as PDF". The printable sheet is a normal DOM node styled
 * by @media print in css/style.css.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const qs = ui.qs;

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function head(title, subtitle, state) {
    return '<div class="report-head">' +
      '<div><div class="report-brand">' + ui.esc(state.league.name) + ' · Season ' +
        ui.esc(state.league.season) + '</div>' +
        '<h2>' + ui.esc(title) + '</h2>' +
        (subtitle ? '<div class="report-center" style="text-align:left;margin:0">' + ui.esc(subtitle) + '</div>' : '') +
      '</div>' +
      '<div class="report-date">TeamBallStats<br />' + ui.fmtDate(TBS.storage.todayISO()) + '</div>' +
      '</div>';
  }

  function foot(text) {
    return '<div class="report-foot"><span>' + ui.esc(text) + '</span>' +
      '<span>Generated locally · no data leaves your browser</span></div>';
  }

  function boxTable(side) {
    const cols = ['#', 'Player', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TOV', 'PF'];
    const splits = (m, a) => ui.fmtInt(m) + '/' + ui.fmtInt(a);
    const line = r => '<tr><td>' + ui.esc(r.player.number) + '</td><td>' + ui.esc(r.player.name) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.min) + '</td>' +
      '<td class="align-right"><strong>' + ui.fmtInt(r.stats.pts) + '</strong></td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.reb) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.ast) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.stl) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.blk) + '</td>' +
      '<td class="align-right">' + splits(r.stats.fgm, r.stats.fga) + '</td>' +
      '<td class="align-right">' + splits(r.stats.tpm, r.stats.tpa) + '</td>' +
      '<td class="align-right">' + splits(r.stats.ftm, r.stats.fta) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.tov) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(r.stats.pf) + '</td></tr>';
    const t = side.totals;
    const totalRow = '<tr><td></td><td><strong>TOTALS</strong></td>' +
      '<td class="align-right">' + ui.fmtInt(t.min) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.pts) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.reb) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.ast) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.stl) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.blk) + '</td>' +
      '<td class="align-right">' + splits(t.fgm, t.fga) + '</td>' +
      '<td class="align-right">' + splits(t.tpm, t.tpa) + '</td>' +
      '<td class="align-right">' + splits(t.ftm, t.fta) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.tov) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(t.pf) + '</td></tr>';
    return '<div class="report-section"><h3>' + ui.esc(side.team.name) + ' — ' + ui.fmtInt(side.score) +
      ' points</h3><table><thead><tr>' +
      cols.map((c, i) => '<th' + (i > 1 ? ' class="align-right"' : '') + '>' + c + '</th>').join('') +
      '</tr></thead><tbody>' +
      (side.rows.length ? side.rows.map(line).join('') :
        '<tr><td colspan="13">No player lines recorded.</td></tr>') +
      '</tbody><tfoot>' + totalRow + '</tfoot></table></div>';
  }

  function quarterHtml(game, state) {
    const q = st.quarterScores(game, state.league);
    if (!q.tracked.some(Boolean)) return '';
    const labels = ['Team'].concat(Array.from({ length: q.count }, (_, i) => 'Q' + (i + 1))).concat(['Final']);
    const rows = [
      { name: teamName(state, game.homeTeamId), values: q.home, total: game.homeScore },
      { name: teamName(state, game.awayTeamId), values: q.away, total: game.awayScore }
    ];
    return '<div class="report-section"><h3>Scoring by quarter</h3><table><thead><tr>' +
      labels.map((l, i) => '<th' + (i ? ' class="align-right"' : '') + '>' + l + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr><td>' + ui.esc(r.name) + '</td>' +
        r.values.map((v, i) => '<td class="align-right">' + (q.tracked[i] ? ui.fmtInt(v) : '—') + '</td>').join('') +
        '<td class="align-right"><strong>' + ui.fmtInt(r.total) + '</strong></td></tr>').join('') +
      '</tbody></table></div>';
  }

  function boxScoreHtml(state, game, withHeader) {
    const box = st.gameBox(game, state.players, state.teams, state.league);
    const meta = ui.fmtDate(game.date) + (game.time ? ' · ' + ui.fmtTime(game.time) : '') +
      (game.location ? ' · ' + game.location : '') + ' · ' + game.status.toUpperCase();
    return (withHeader ? head('Official Box Score', meta, state) : '') +
      '<div class="report-section">' +
        '<div class="report-score"><span>' + ui.esc(box.away.team.name) + '</span>' +
          '<span class="final">' + ui.fmtInt(box.home.score) + ' – ' + ui.fmtInt(box.away.score) + '</span>' +
          '<span>' + ui.esc(box.home.team.name) + '</span></div>' +
        '<div class="report-center">' + ui.esc(meta) + ' · Home score listed first' +
          (game.notes ? ' · ' + game.notes : '') + '</div>' +
      '</div>' +
      boxTable(box.home) + boxTable(box.away) + quarterHtml(game, state) +
      '<div class="report-center">FG / 3PT / FT shown as makes–attempts. ' +
        'Team totals include ' + game.stats.length + ' player lines.</div>';
  }

  function standingsHtml(state, withHeader) {
    const rows = st.standings(state.teams, state.games, state.league.primaryTeamId);
    const cols = ['#', 'Team', 'GP', 'W', 'L', 'PCT', 'GB', 'PF', 'PA', 'DIFF', 'PPG', 'OPP', 'Home', 'Away', 'Streak'];
    const body = rows.map((r, i) => '<tr><td>' + (i + 1) + '</td><td><strong>' +
      ui.esc(r.team.name) + '</strong>' + (r.primary ? ' *' : '') + '</td>' +
      '<td class="align-right">' + r.gp + '</td><td class="align-right">' + r.w + '</td>' +
      '<td class="align-right">' + r.l + '</td><td class="align-right">' +
      (r.gp ? (r.pct * 100).toFixed(1) + '%' : '—') + '</td>' +
      '<td class="align-right">' + ui.esc(r.gb) + '</td><td class="align-right">' + r.pf + '</td>' +
      '<td class="align-right">' + r.pa + '</td><td class="align-right">' +
      (r.diff > 0 ? '+' : '') + r.diff + '</td>' +
      '<td class="align-right">' + (r.gp ? ui.fmt1(r.pfPerGame) : '—') + '</td>' +
      '<td class="align-right">' + (r.gp ? ui.fmt1(r.paPerGame) : '—') + '</td>' +
      '<td class="align-right">' + r.home.w + '–' + r.home.l + '</td>' +
      '<td class="align-right">' + r.away.w + '–' + r.away.l + '</td>' +
      '<td class="align-right">' + ui.esc(r.streak) + '</td></tr>').join('');
    return (withHeader ? head('League Standings',
      'Season ' + state.league.season + ' · final games only', state) : '') +
      '<div class="report-section"><table><thead><tr>' +
      cols.map((c, i) => '<th' + (i > 1 ? ' class="align-right"' : '') + '>' + c + '</th>').join('') +
      '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="report-center" style="text-align:left">* marks your team. ' +
      'PCT = (wins + ½ ties) / games. GB = games behind the leader. ' +
      state.games.filter(g => g.status === 'final').length + ' final games included.</div></div>';
  }

  function rosterHtml(state) {
    const players = state.players.slice().sort((a, b) =>
      String(teamName(state, a.teamId)).localeCompare(String(teamName(state, b.teamId))) ||
      (Number(a.number) || 999) - (Number(b.number) || 999));
    return '<div class="report-section"><h3>League rosters</h3>' +
      '<div class="report-two-col">' + state.teams.map(t => {
        const list = players.filter(p => p.teamId === t.id);
        return '<div><h4>' + ui.esc(t.name) + '</h4><table><thead><tr><th>#</th><th>Player</th><th>Pos</th></tr></thead>' +
          '<tbody>' + (list.length ? list.map(p => '<tr><td>' + ui.esc(p.number) + '</td><td>' +
            ui.esc(p.name) + '</td><td>' + ui.esc(p.position || '—') + '</td></tr>').join('') :
            '<tr><td colspan="3">No players listed.</td></tr>') + '</tbody></table></div>';
      }).join('') + '</div></div>';
  }

  function build(state) {
    const type = qs('#report-type').value;
    const gameId = qs('#report-game-select').value;
    const game = state.games.find(g => g.id === gameId) ||
      state.games.filter(g => g.status === 'final').slice(-1)[0] ||
      state.games[state.games.length - 1];
    const sheet = qs('#report-sheet');
    const meta = qs('#report-meta');

    if (type === 'boxscore') {
      sheet.innerHTML = game
        ? boxScoreHtml(state, game, true) + foot('Box score · 1 game')
        : ui.emptyState('No game selected', 'Create a game in the Schedule tab first.');
      meta.textContent = game
        ? 'Box score for ' + teamName(state, game.awayTeamId) + ' @ ' + teamName(state, game.homeTeamId) +
          ' · ' + game.stats.length + ' player lines.'
        : 'No games available.';
    } else if (type === 'standings') {
      sheet.innerHTML = head('League Report', 'Standings, records and rosters', state) +
        standingsHtml(state, false) + rosterHtml(state) +
        foot('Standings · ' + state.teams.length + ' teams · ' + state.players.length + ' players');
      meta.textContent = 'Standings + rosters · ' + state.teams.length + ' teams · ' +
        state.games.filter(g => g.status === 'final').length + ' final games.';
    } else {
      const finals = state.games.filter(g => g.status === 'final').sort((a, b) =>
        String(a.date).localeCompare(String(b.date)));
      const boxes = finals.length
        ? finals.map((g, i) => '<div class="' + (i ? 'page-break' : '') + '">' +
            boxScoreHtml(state, g, true) + foot('Full season report · game ' + (i + 1) + ' of ' + finals.length) +
          '</div>').join('')
        : ui.emptyState('No final games', 'Finalize a game in the Live Console to include its box score here.');
      sheet.innerHTML = head('Full Season Report',
        'Standings and every official box score · Season ' + state.league.season, state) +
        standingsHtml(state, false) + rosterHtml(state) +
        '<div class="page-break"></div>' + boxes;
      meta.textContent = 'Full season report · ' + finals.length + ' box scores · ' +
        state.teams.length + ' teams. Long reports print across multiple pages.';
    }
  }

  function render(state) {
    const select = qs('#report-game-select');
    const previous = select.value;
    const sorted = state.games.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time)));
    select.innerHTML = ui.gameOptions(sorted, state.teams, previous, '');
    if (previous && Array.from(select.options).some(o => o.value === previous)) select.value = previous;
    qs('#report-game-wrap').hidden = qs('#report-type').value !== 'boxscore';
    build(state);
  }

  function printBoxScore(gameId) {
    TBS.app.go('reports');
    qs('#report-type').value = 'boxscore';
    const select = qs('#report-game-select');
    if (gameId && Array.from(select.options).some(o => o.value === gameId)) select.value = gameId;
    build(TBS.app.getState());
    setTimeout(() => window.print(), 120);
  }

  function printStandings() {
    TBS.app.go('reports');
    qs('#report-type').value = 'standings';
    build(TBS.app.getState());
    setTimeout(() => window.print(), 120);
  }

  function init() {
    qs('#report-type').addEventListener('change', () => render(TBS.app.getState()));
    qs('#report-game-select').addEventListener('change', () => render(TBS.app.getState()));
    qs('#report-build-btn').addEventListener('click', () => {
      render(TBS.app.getState());
      ui.toast('Report rebuilt from current data.', 'success');
    });
    qs('#report-print-btn').addEventListener('click', () => window.print());
  }

  TBS.reports = {
    render: render, init: init, build: build,
    printBoxScore: printBoxScore, printStandings: printStandings,
    boxScoreHtml: boxScoreHtml, standingsHtml: standingsHtml
  };
})(window.TBS = window.TBS || {});
