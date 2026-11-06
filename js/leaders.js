/* =========================================================================
 * leaders.js — Player Statistics tab: season averages, efficiency, leaders,
 * full table and CSV export.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const qs = ui.qs;
  let filterTeam = 'all';

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function render(state) {
    const select = qs('#stats-team-filter');
    const previous = select.value;
    select.innerHTML = '<option value="all">All teams</option>' +
      ui.teamOptions(state.teams, filterTeam);
    select.value = (previous && Array.from(select.options).some(o => o.value === previous)) ? previous : filterTeam;
    filterTeam = select.value;

    const players = state.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);
    const primaryId = state.league.primaryTeamId;
    const rec = st.teamRecord(state.games, primaryId);
    const board = st.leaderboard(players, state.games);
    const topScorer = board.ppg[0];
    const totalPoints = players.reduce((a, p) => a + st.playerAggregate(p.id, state.games).totals.pts, 0);

    qs('#stats-summary').innerHTML = [
      { label: 'Players', value: players.length, detail: state.teams.length + ' teams in league' },
      { label: 'My team record', value: rec.w + '–' + rec.l, detail: rec.gp + ' final games · ' + rec.streak + ' streak', accent: true },
      { label: 'Total points', value: ui.fmtInt(totalPoints), detail: 'Across all filtered players' },
      { label: 'Leading scorer', value: topScorer ? ui.fmt1(topScorer.value) : '—', detail: topScorer ? topScorer.player.name + ' PPG' : 'No final games yet' }
    ].map(c => '<div class="card stat-card' + (c.accent ? ' accent' : '') + '">' +
      '<div class="label">' + ui.esc(c.label) + '</div>' +
      '<div class="value">' + ui.esc(c.value) + '</div>' +
      '<div class="detail">' + ui.esc(c.detail) + '</div></div>').join('');

    const cards = [
      { key: 'ppg', title: 'Points per game', fmt: v => ui.fmt1(v) },
      { key: 'rpg', title: 'Rebounds per game', fmt: v => ui.fmt1(v) },
      { key: 'apg', title: 'Assists per game', fmt: v => ui.fmt1(v) },
      { key: 'spg', title: 'Steals per game', fmt: v => ui.fmt1(v) },
      { key: 'bpg', title: 'Blocks per game', fmt: v => ui.fmt1(v) },
      { key: 'fgPct', title: 'FG% (min 10 FGA)', fmt: v => ui.fmtPct(v) }
    ];
    qs('#stats-leaders').innerHTML = cards.map(c => {
      const list = board[c.key];
      return '<div class="leader-card"><h4>' + ui.esc(c.title) + '</h4><ol>' +
        (list.length ? list.map(x =>
          '<li><span>' + ui.esc(x.player.name) + '</span><span>' + ui.esc(c.fmt(x.value)) + '</span></li>'
        ).join('') : '<li><span class="muted">No qualified players</span><span>—</span></li>') +
        '</ol></div>';
    }).join('');

    const rows = players.map(p => ({ p: p, a: st.playerAggregate(p.id, state.games) }))
      .sort((x, y) => y.a.ppg - x.a.ppg ||
        (Number(x.p.number) || 999) - (Number(y.p.number) || 999));
    qs('#stats-table').innerHTML = players.length
      ? ui.table([
          { label: '#', render: r => ui.esc(r.p.number), align: 'right' },
          { label: 'Player', render: r => '<strong>' + ui.esc(r.p.name) + '</strong>' },
          { label: 'Team', render: r => ui.esc(teamName(state, r.p.teamId)) },
          { label: 'Pos', render: r => ui.esc(r.p.position || '—') },
          { label: 'GP', render: r => ui.fmtInt(r.a.gp), align: 'right' },
          { label: 'MIN', render: r => ui.fmtInt(r.a.totals.min), align: 'right' },
          { label: 'PTS', render: r => ui.fmtInt(r.a.totals.pts), align: 'right' },
          { label: 'PPG', render: r => '<strong>' + ui.fmt1(r.a.ppg) + '</strong>', align: 'right' },
          { label: 'RPG', render: r => ui.fmt1(r.a.rpg), align: 'right' },
          { label: 'APG', render: r => ui.fmt1(r.a.apg), align: 'right' },
          { label: 'SPG', render: r => ui.fmt1(r.a.spg), align: 'right' },
          { label: 'BPG', render: r => ui.fmt1(r.a.bpg), align: 'right' },
          { label: 'TOV', render: r => ui.fmtInt(r.a.totals.tov), align: 'right' },
          { label: 'FG%', render: r => ui.fmtPct(r.a.fgPct), align: 'right' },
          { label: '3P%', render: r => ui.fmtPct(r.a.tpPct), align: 'right' },
          { label: 'FT%', render: r => ui.fmtPct(r.a.ftPct), align: 'right' },
          { label: 'eFG%', render: r => ui.fmtPct(r.a.efgPct), align: 'right' },
          { label: 'TS%', render: r => ui.fmtPct(r.a.tsPct), align: 'right' },
          { label: 'PF', render: r => ui.fmtInt(r.a.totals.pf), align: 'right' }
        ], rows, { empty: 'No players yet.' })
      : ui.emptyState('No players to show', 'Add players in Teams & Roster, then log games.',
          '<button type="button" class="btn btn-primary" data-action="go-teams">Add players</button>');
  }

  function init() {
    qs('#stats-team-filter').addEventListener('change', e => {
      filterTeam = e.target.value;
      render(TBS.app.getState());
    });
    qs('#export-csv').addEventListener('click', () => {
      const state = TBS.app.getState();
      const players = state.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);
      if (!players.length) { ui.toast('No players to export.', 'error'); return; }
      const csv = st.toCSV(players, state.games, state.teams);
      if (ui.download('teamballstats-player-stats-' + TBS.storage.todayISO() + '.csv', csv, 'text/csv;charset=utf-8')) {
        ui.toast('CSV exported (' + players.length + ' players).', 'success');
      }
    });
    qs('#stats-table').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn && btn.dataset.action === 'go-teams') TBS.app.go('teams');
    });
  }

  TBS.leaders = { render: render, init: init };
})(window.TBS = window.TBS || {});
