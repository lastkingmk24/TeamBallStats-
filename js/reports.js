/* =========================================================================
 * reports.js — printable, PDF-style reports using only window.print().
 *
 * No jsPDF, no CDN, no font or image request: the browser's own print dialog
 * supplies "Save as PDF". The printable sheet is a normal DOM node styled by
 * @media print in css/style.css, which also forces the LIGHT palette so dark
 * mode never produces unreadable reports.
 *
 * Report types: box score, standings + rosters, full season, player profile.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;
  const qs = ui.qs;

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  function head(title, subtitle, state) {
    return '<div class="report-head">' +
      '<div><div class="report-brand">' + ui.esc(state.league.name) + ' · Season ' +
        ui.esc(state.league.season) + '</div>' +
        '<h2>' + ui.esc(title) + '</h2>' +
        (subtitle ? '<div class="report-center report-subtitle">' + ui.esc(subtitle) + '</div>' : '') +
      '</div>' +
      '<div class="report-date">TeamBallStats<br />' + ui.fmtDate(TBS.storage.todayISO()) + '</div>' +
      '</div>';
  }

  function foot(text) {
    return '<div class="report-foot"><span>' + ui.esc(text) + '</span>' +
      '<span>Generated locally · no data leaves your browser</span></div>';
  }

  function boxTable(side, state) {
    const cols = ['#', 'Player', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TOV', 'PF'];
    const splits = (m, a) => ui.fmtInt(m) + '/' + ui.fmtInt(a);
    const line = r => '<tr>' +
      '<td>' + ui.esc(r.player.number) + '</td>' +
      '<td class="player-print-cell">' + ui.avatar(r.player, {
        size: 'sm', team: teamOf(state, r.player.teamId), showNumber: false }) +
        ' <span>' + ui.esc(r.player.name) + '</span></td>' +
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
      (game.location ? ' · ' + game.location : '') + ' · ' + String(game.status).toUpperCase();
    return (withHeader ? head('Official Box Score', meta, state) : '') +
      '<div class="report-section">' +
        '<div class="report-score"><span>' + ui.esc(box.away.team.name) + '</span>' +
          '<span class="final">' + ui.fmtInt(box.home.score) + ' – ' + ui.fmtInt(box.away.score) + '</span>' +
          '<span>' + ui.esc(box.home.team.name) + '</span></div>' +
        '<div class="report-center">' + ui.esc(meta) + ' · Home score listed first' +
          (game.notes ? ' · ' + game.notes : '') + '</div>' +
      '</div>' +
      boxTable(box.home, state) + boxTable(box.away, state) + quarterHtml(game, state) +
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
      ui.fmtSigned(r.diff) + '</td>' +
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
      '<div class="report-center report-left">* marks your team. ' +
      'PCT = (wins + ½ ties) / games. GB = games behind the leader. ' +
      state.games.filter(g => g.status === 'final').length + ' final games included.</div></div>';
  }

  function rosterHtml(state) {
    return '<div class="report-section"><h3>League rosters</h3>' +
      '<div class="report-two-col">' + state.teams.map(t => {
        const list = state.players.filter(p => p.teamId === t.id)
          .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
        return '<div><h4>' + ui.esc(t.name) + '</h4>' +
          '<table><thead><tr><th>#</th><th>Player</th><th>Pos</th></tr></thead>' +
          '<tbody>' + (list.length ? list.map(p =>
            '<tr><td>' + ui.esc(p.number) + '</td>' +
            '<td class="player-print-cell">' + ui.avatar(p, { size: 'sm', team: t, showNumber: false }) +
              ' <span>' + ui.esc(p.name) + '</span></td>' +
            '<td>' + ui.esc(p.position || '—') + '</td></tr>').join('') :
            '<tr><td colspan="3">No players listed.</td></tr>') + '</tbody></table></div>';
      }).join('') + '</div></div>';
  }

  /* Printable player profile: photo, averages, splits, game log, zones. */
  function playerHtml(state, player) {
    const team = teamOf(state, player.teamId);
    const agg = st.playerAggregate(player.id, state.games);
    const per = an.per36(agg);
    const splits = st.shooting(agg.totals);
    const streak = an.streaks(player.id, state.games);
    const log = TBS.profiles.gameLog(state, player);
    const shots = TBS.profiles.allShots(state, player.id);
    const pm = TBS.profiles.totalPlusMinus(state, player.id);

    const avgRows = [
      ['Games played', ui.fmtInt(agg.gp)],
      ['Minutes', ui.fmtInt(agg.totals.min) + ' (' + ui.fmt1(agg.mpg) + ' MPG)'],
      ['Points', ui.fmtInt(agg.totals.pts) + ' (' + ui.fmt1(agg.ppg) + ' PPG)'],
      ['Rebounds', ui.fmtInt(agg.totals.reb) + ' (' + ui.fmt1(agg.rpg) + ' RPG)'],
      ['Assists', ui.fmtInt(agg.totals.ast) + ' (' + ui.fmt1(agg.apg) + ' APG)'],
      ['Steals / Blocks', ui.fmtInt(agg.totals.stl) + ' / ' + ui.fmtInt(agg.totals.blk)],
      ['Turnovers', ui.fmtInt(agg.totals.tov)],
      ['FG / 3PT / FT', ui.fmtPct(splits.fgPct) + ' · ' + ui.fmtPct(splits.tpPct) + ' · ' + ui.fmtPct(splits.ftPct)],
      ['eFG% / TS%', ui.fmtPct(splits.efgPct) + ' / ' + ui.fmtPct(splits.tsPct)],
      ['Per 36 minutes', ui.fmt1(per.pts) + ' PTS · ' + ui.fmt1(per.reb) + ' REB · ' + ui.fmt1(per.ast) + ' AST'],
      ['Form', streak.label + ' · last five ' + ui.fmt1(streak.recentAvg) + ' PPG'],
      ['+/−', pm.games ? ui.fmtSigned(pm.total) + ' across ' + pm.games + ' tracked games' : '—']
    ];

    return head('Player Report', player.name + ' · ' + (team ? team.name : 'No team') +
      ' · Season ' + state.league.season, state) +
      '<div class="report-section report-profile-head">' +
        '<div class="report-profile-photo">' + ui.avatar(player, { size: 'xl', team: team }) + '</div>' +
        '<div>' +
          '<h3 class="report-profile-name">' + ui.esc(player.name) +
            ' <span class="report-profile-number">#' + ui.esc(player.number) + '</span></h3>' +
          '<div class="report-center report-left">' +
            ui.esc(team ? team.name : 'No team') + ' · ' + ui.esc(player.position || 'No position') +
            ' · ' + (player.active === false ? 'Inactive' : 'Active') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="report-section"><h3>Season summary</h3><table><tbody>' +
        avgRows.map(row => '<tr><td><strong>' + ui.esc(row[0]) + '</strong></td>' +
          '<td class="align-right">' + ui.esc(row[1]) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (log.length ? '<div class="report-section"><h3>Game log</h3><table><thead><tr>' +
        '<th>Date</th><th>Opponent</th><th>Res</th><th class="align-right">MIN</th>' +
        '<th class="align-right">PTS</th><th class="align-right">REB</th>' +
        '<th class="align-right">AST</th><th class="align-right">STL</th>' +
        '<th class="align-right">BLK</th><th class="align-right">TOV</th>' +
        '<th class="align-right">FG</th><th class="align-right">3PT</th>' +
        '<th class="align-right">FT</th><th class="align-right">+/−</th></tr></thead><tbody>' +
        log.map(row => '<tr><td>' + ui.fmtDate(row.game.date) + '</td>' +
          '<td>' + (row.home ? 'vs ' : '@ ') + ui.esc(row.opponent) + '</td>' +
          '<td>' + row.result + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.min) + '</td>' +
          '<td class="align-right"><strong>' + ui.fmtInt(row.line.pts) + '</strong></td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.reb) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.ast) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.stl) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.blk) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.tov) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.fgm) + '/' + ui.fmtInt(row.line.fga) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.tpm) + '/' + ui.fmtInt(row.line.tpa) + '</td>' +
          '<td class="align-right">' + ui.fmtInt(row.line.ftm) + '/' + ui.fmtInt(row.line.fta) + '</td>' +
          '<td class="align-right">' + (an.plusMinus(row.game).tracked
            ? ui.fmtSigned(row.plusMinus) : '—') + '</td></tr>').join('') +
        '</tbody></table></div>'
        : '<div class="report-section"><h3>Game log</h3><p>No final games recorded yet.</p></div>') +
      (shots.zones.length ? '<div class="report-section"><h3>Shot zones</h3><table><thead><tr>' +
        '<th>Zone</th><th class="align-right">Make</th><th class="align-right">Att</th>' +
        '<th class="align-right">%</th></tr></thead><tbody>' +
        shots.zones.map(z => '<tr><td>' + ui.esc(z.zone) + '</td>' +
          '<td class="align-right">' + z.made + '</td>' +
          '<td class="align-right">' + z.attempts + '</td>' +
          '<td class="align-right">' + ui.fmtPct(z.pct) + '</td></tr>').join('') +
        '</tbody></table></div>' : '') +
      foot('Player report · ' + player.name);
  }

  function currentGame(state) {
    const gameId = qs('#report-game-select').value;
    return state.games.find(g => g.id === gameId) ||
      st.sortByDateDesc(state.games.filter(g => g.status === 'final'))[0] ||
      st.sortByDateDesc(state.games)[0] || null;
  }

  function build(state) {
    const type = qs('#report-type').value;
    const sheet = qs('#report-sheet');
    const meta = qs('#report-meta');
    const game = currentGame(state);

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
    } else if (type === 'player') {
      const playerId = qs('#report-player-select') ? qs('#report-player-select').value : '';
      const player = state.players.find(p => p.id === playerId) || state.players[0];
      sheet.innerHTML = player
        ? playerHtml(state, player)
        : ui.emptyState('No players yet', 'Add a player in Teams & Roster first.');
      meta.textContent = player
        ? 'Player report · ' + player.name + ' · ' + st.playerAggregate(player.id, state.games).gp +
          ' final games.'
        : 'No players available.';
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
    const sorted = st.sortByDateDesc(state.games);
    select.innerHTML = ui.gameOptions(sorted, state.teams, previous, '');
    if (previous && Array.from(select.options).some(o => o.value === previous)) select.value = previous;

    const playerSelect = qs('#report-player-select');
    if (playerSelect) {
      const previousPlayer = playerSelect.value;
      const players = state.players.slice().sort((a, b) =>
        String(teamName(state, a.teamId)).localeCompare(String(teamName(state, b.teamId))) ||
        (Number(a.number) || 999) - (Number(b.number) || 999));
      playerSelect.innerHTML = ui.options(players.map(p => ({
        value: p.id, label: '#' + p.number + ' ' + p.name + ' · ' + teamName(state, p.teamId)
      })), previousPlayer);
      if (previousPlayer && Array.from(playerSelect.options).some(o => o.value === previousPlayer)) {
        playerSelect.value = previousPlayer;
      }
    }

    const type = qs('#report-type').value;
    qs('#report-game-wrap').hidden = type !== 'boxscore';
    const playerWrap = qs('#report-player-wrap');
    if (playerWrap) playerWrap.hidden = type !== 'player';
    build(state);
  }

  function printBoxScore(gameId) {
    TBS.app.go('reports');
    qs('#report-type').value = 'boxscore';
    const select = qs('#report-game-select');
    if (gameId && Array.from(select.options).some(o => o.value === gameId)) select.value = gameId;
    render(TBS.app.getState());
    setTimeout(() => window.print(), 120);
  }

  function printStandings() {
    TBS.app.go('reports');
    qs('#report-type').value = 'standings';
    render(TBS.app.getState());
    setTimeout(() => window.print(), 120);
  }

  function printPlayer(playerId) {
    TBS.app.go('reports');
    qs('#report-type').value = 'player';
    const select = qs('#report-player-select');
    if (select && Array.from(select.options).some(o => o.value === playerId)) select.value = playerId;
    render(TBS.app.getState());
    setTimeout(() => window.print(), 120);
  }

  function init() {
    qs('#report-type').addEventListener('change', () => render(TBS.app.getState()));
    qs('#report-game-select').addEventListener('change', () => render(TBS.app.getState()));
    const playerSelect = qs('#report-player-select');
    if (playerSelect) playerSelect.addEventListener('change', () => render(TBS.app.getState()));
    qs('#report-build-btn').addEventListener('click', () => {
      render(TBS.app.getState());
      ui.toast('Report rebuilt from current data.', 'success');
    });
    qs('#report-print-btn').addEventListener('click', () => window.print());
  }

  TBS.reports = {
    render: render, init: init, build: build,
    printBoxScore: printBoxScore, printStandings: printStandings, printPlayer: printPlayer,
    boxScoreHtml: boxScoreHtml, standingsHtml: standingsHtml, playerHtml: playerHtml
  };
})(window.TBS = window.TBS || {});
