/* =========================================================================
 * standings.js — league table computed purely from final games.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const qs = ui.qs;

  function formBadges(list) {
    if (!list || !list.length) return '<span class="muted">—</span>';
    return list.map(r => '<span class="badge badge-' + r.toLowerCase() + '">' + r + '</span>').join(' ');
  }

  function render(state) {
    const rows = st.standings(state.teams, state.games, state.league.primaryTeamId);
    const finals = state.games.filter(g => g.status === 'final');
    const bestOffense = rows.slice().filter(r => r.gp > 0).sort((a, b) => b.pfPerGame - a.pfPerGame)[0];
    const bestDefense = rows.slice().filter(r => r.gp > 0).sort((a, b) => a.paPerGame - b.paPerGame)[0];

    qs('#standings-updated').innerHTML =
      '<div class="card-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
        '<div class="card stat-card"><div class="label">Final games</div><div class="value">' + finals.length +
          '</div><div class="detail">' + state.teams.length + ' teams · ' + state.league.season + '</div></div>' +
        '<div class="card stat-card"><div class="label">Best offense</div><div class="value">' +
          (bestOffense ? ui.fmt1(bestOffense.pfPerGame) : '—') + '</div><div class="detail">' +
          (bestOffense ? ui.esc(bestOffense.team.name) + ' points per game' : 'No final games yet') + '</div></div>' +
        '<div class="card stat-card"><div class="label">Best defense</div><div class="value">' +
          (bestDefense ? ui.fmt1(bestDefense.paPerGame) : '—') + '</div><div class="detail">' +
          (bestDefense ? ui.esc(bestDefense.team.name) + ' points allowed' : 'No final games yet') + '</div></div>' +
      '</div>';

    const columns = [
      { label: '#', align: 'right', render: (r, i) => String(i + 1) },
      { label: 'Team', render: r => '<strong>' + ui.esc(r.team.name) + '</strong>' +
          (r.primary ? ' <span class="badge badge-live">My team</span>' : '') },
      { label: 'GP', key: 'gp', align: 'right' },
      { label: 'W', key: 'w', align: 'right' },
      { label: 'L', key: 'l', align: 'right' },
      { label: 'PCT', render: r => r.gp ? (r.pct * 100).toFixed(1) + '%' : '—', align: 'right' },
      { label: 'GB', key: 'gb', align: 'right' },
      { label: 'PF', key: 'pf', align: 'right' },
      { label: 'PA', key: 'pa', align: 'right' },
      { label: 'DIFF', render: r => (r.diff > 0 ? '+' : '') + ui.fmtInt(r.diff), align: 'right' },
      { label: 'PPG', render: r => r.gp ? ui.fmt1(r.pfPerGame) : '—', align: 'right' },
      { label: 'OPP', render: r => r.gp ? ui.fmt1(r.paPerGame) : '—', align: 'right' },
      { label: 'Home', render: r => r.home.w + '–' + r.home.l, align: 'right' },
      { label: 'Away', render: r => r.away.w + '–' + r.away.l, align: 'right' },
      { label: 'Streak', key: 'streak', align: 'right' },
      { label: 'Last 5', render: r => formBadges(r.lastFive), align: 'right' }
    ];
    qs('#standings-content').innerHTML =
      (finals.length ? '' : '<div class="empty-state" style="margin-bottom:1rem">' +
        '<div class="empty-icon" aria-hidden="true">📊</div><h3>No final games yet</h3>' +
        '<p>Standings fill in as soon as a game is finalized in the Live Console.</p></div>') +
      ui.table(columns, rows, {
        empty: 'Add a team in Teams & Roster to see standings.',
        rowClass: r => r.primary ? 'row-primary' : ''
      });

    qs('#standings-note').textContent =
      'Only final games count. Win % = (wins + ½ ties) / games; GB is measured against the first-place team; ' +
      'ties are sorted by point differential, then points for. Generated locally on ' + ui.fmtDate(TBS.storage.todayISO()) + '.';
  }

  function init() {
    qs('#standings-print-btn').addEventListener('click', () => TBS.reports.printStandings());
  }

  TBS.standings = { render: render, init: init };
})(window.TBS = window.TBS || {});
