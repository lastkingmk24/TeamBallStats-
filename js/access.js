/* =========================================================================
 * access.js — Data tab → "Access & roles".
 *
 * League management gets a league-wide stats directory. It deliberately does
 * not list team usernames, password hashes, or password-reset controls.
 * Each account owns its own credentials; only the signed-in user can change
 * their password through the account dialog.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const qs = ui.qs;

  function auth() { return TBS.auth; }

  function rowsHtml(state) {
    return (state.teams || []).map(t => {
      const record = TBS.stats.teamRecord(state.games, t.id);
      const players = state.players.filter(p => p.teamId === t.id).length;
      return '<tr>' +
        '<td><span class="team-identity">' + ui.teamLogo(t, 'sm') +
          '<span class="team-identity-text"><strong>' + ui.esc(t.name) + '</strong>' +
          '<small>' + ui.esc(t.short || '—') + '</small></span></span></td>' +
        '<td class="align-right">' + players + '</td>' +
        '<td class="align-right">' + record.gp + '</td>' +
        '<td class="align-right">' + record.w + '–' + record.l + '</td>' +
        '<td class="align-right">' + (record.gp ? ui.fmt1(record.pfPerGame) : '—') + '</td>' +
        '<td class="align-right">' + (record.gp ? ui.fmt1(record.paPerGame) : '—') + '</td>' +
        '<td>' + ui.badge('Private account', 'final') + '</td>' +
        '<td class="align-right"><div class="row-actions">' +
          '<button type="button" class="btn btn-mini" data-access-stats="' + ui.esc(t.id) + '">Player stats</button>' +
          '<button type="button" class="btn btn-mini" data-access-roster="' + ui.esc(t.id) + '">Roster stats</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function render(state) {
    const host = qs('#access-panel');
    if (!host) return;
    const a = auth();
    if (!a || !a.isAdmin()) {
      host.innerHTML =
        '<div class="access-locked">' +
          '<span class="access-lock-icon" aria-hidden="true">' + ui.icon('lock') + '</span>' +
          '<div><h3>Access &amp; roles</h3>' +
          '<p class="muted">This directory is for league management. Team accounts can still view every club’s statistics from Players, Standings and Box Scores.</p></div>' +
        '</div>';
      return;
    }

    host.innerHTML =
      '<div class="panel-head">' +
        '<div><h3>Access &amp; roles</h3>' +
          '<p class="panel-note">League-wide statistics, without access to other accounts.</p></div>' +
        ui.badge('Stats access', 'live') +
      '</div>' +
      '<div class="panel-grid two access-grid">' +
        '<div class="access-card">' +
          '<h4><span class="access-dot" aria-hidden="true"></span>Your management account</h4>' +
          '<p class="muted small">Signed in as <strong>' + ui.esc(a.myUsername()) + '</strong>. ' +
            'You can view every team’s stats and manage league settings.</p>' +
          '<div class="form-actions"><button type="button" class="btn btn-primary" id="access-own-password">Change your password</button></div>' +
        '</div>' +
        '<div class="access-card">' +
          '<h4><span class="access-dot team" aria-hidden="true"></span>Team accounts stay private</h4>' +
          '<p class="muted small">Team usernames and passwords are not shown here. League management cannot reset or change another account’s password. ' +
            'Each team creates its own username and password from the sign-in screen.</p>' +
          '<p class="footnote">Accounts are local to this browser and device.</p>' +
        '</div>' +
      '</div>' +
      '<div class="table-scroll access-table">' +
        '<table class="data-table">' +
          '<caption>Team statistics directory</caption>' +
          '<thead><tr><th scope="col">Team</th><th scope="col" class="align-right">Players</th>' +
            '<th scope="col" class="align-right">GP</th><th scope="col" class="align-right">Record</th>' +
            '<th scope="col" class="align-right">PPG</th><th scope="col" class="align-right">OPP</th>' +
            '<th scope="col">Account</th><th scope="col" class="align-right">Statistics</th></tr></thead>' +
          '<tbody>' + (state.teams.length ? rowsHtml(state)
            : '<tr><td colspan="8" class="empty-cell">No teams yet — add one in Teams &amp; Roster.</td></tr>') +
          '</tbody>' +
        '</table>' +
      '</div>';
  }

  function init() {
    const host = qs('#access-panel');
    if (!host) return;
    host.addEventListener('click', e => {
      const a = auth();
      if (!a || !a.isAdmin()) return;
      if (e.target.closest('#access-own-password')) { a.openPasswordDialog(); return; }
      const stats = e.target.closest('[data-access-stats]');
      if (stats) {
        if (!a.canViewTeamStats(stats.dataset.accessStats)) return;
        if (TBS.leaders && TBS.leaders.showTeam) TBS.leaders.showTeam(stats.dataset.accessStats);
        return;
      }
      const roster = e.target.closest('[data-access-roster]');
      if (roster) {
        if (!a.canViewTeamStats(roster.dataset.accessRoster)) return;
        if (TBS.teams && TBS.teams.showTeamStats) TBS.teams.showTeamStats(roster.dataset.accessRoster);
      }
    });
  }

  TBS.access = { render: render, init: init };
})(window.TBS = window.TBS || {});
