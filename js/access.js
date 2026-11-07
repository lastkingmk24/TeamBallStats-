/* =========================================================================
 * access.js — Data tab → "Access & roles".
 *
 * League management can set a custom passcode for the management account and
 * for any team account. Passcodes are stored as salted hashes inside the
 * league document (league.access), so a JSON backup never contains a readable
 * passcode and no extra localStorage key is created.
 *
 * Visible to league management only; team accounts see a locked panel.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const auth = TBS.auth;
  const qs = ui.qs;

  function statusPill(custom) {
    return custom
      ? '<span class="badge badge-final">Custom passcode</span>'
      : '<span class="badge badge-scheduled">Demo passcode</span>';
  }

  function rowsHtml(state) {
    const teams = state.teams || [];
    return teams.map(t => {
      const custom = auth.hasCustomPasscode(state, 'team', t.id);
      const record = TBS.stats.teamRecord(state.games, t.id);
      return '<tr>' +
        '<td>' +
          '<span class="team-identity">' + ui.teamLogo(t, 'sm') +
            '<span class="team-identity-text"><strong>' + ui.esc(t.name) + '</strong>' +
            '<small>' + ui.esc(t.short || '—') + ' · ' + record.w + '–' + record.l + '</small></span>' +
          '</span>' +
        '</td>' +
        '<td>' + (t.primary ? ui.badge('My team', 'live') : '<span class="muted">Opponent</span>') + '</td>' +
        '<td>' + statusPill(custom) + '</td>' +
        '<td class="align-right">' +
          '<button type="button" class="btn btn-mini" data-access-set="' + ui.esc(t.id) + '">Set passcode</button> ' +
          '<button type="button" class="btn btn-mini" data-access-reset="' + ui.esc(t.id) + '"' +
            (custom ? '' : ' disabled') + '>Reset to demo</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function render(state) {
    const host = qs('#access-panel');
    if (!host) return;

    if (!auth.isAdmin()) {
      host.innerHTML =
        '<div class="access-locked">' +
          '<span class="access-lock-icon" aria-hidden="true">' + ui.icon('lock') + '</span>' +
          '<div><h3>Access &amp; roles</h3>' +
          '<p class="muted">Only a league management account can view or change passcodes. ' +
            'You are signed in as <strong>' + ui.esc(auth.displayName(state)) + '</strong> (' +
            ui.esc(auth.roleLabel()) + ').</p></div>' +
        '</div>';
      return;
    }

    const adminCustom = auth.hasCustomPasscode(state, 'commissioner', '');
    host.innerHTML =
      '<div class="panel-head">' +
        '<div><h3>Access &amp; roles</h3>' +
          '<p class="panel-note">Passcodes are stored as salted hashes on this device — ' +
            'they are never shown or exported in plain text.</p></div>' +
        statusPill(adminCustom) +
      '</div>' +
      '<div class="panel-grid two access-grid">' +
        '<form class="access-card" id="access-admin-form">' +
          '<h4><span class="access-dot" aria-hidden="true"></span>League management</h4>' +
          '<p class="muted small">Full control: every team, every game, settings, backups and passcodes.</p>' +
          '<div class="field-row">' +
            '<div class="field"><label for="access-admin-code">New passcode</label>' +
              '<input type="password" id="access-admin-code" autocomplete="new-password" placeholder="At least 4 characters" /></div>' +
            '<div class="field"><label for="access-admin-code2">Repeat</label>' +
              '<input type="password" id="access-admin-code2" autocomplete="new-password" placeholder="Repeat passcode" /></div>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button type="submit" class="btn btn-primary">Save management passcode</button>' +
            '<button type="button" class="btn btn-ghost" id="access-admin-reset"' +
              (adminCustom ? '' : ' disabled') + '>Reset to demo</button>' +
          '</div>' +
          '<p class="footnote">Demo passcode: <code>' + ui.esc(auth.ADMIN_DEFAULT) + '</code></p>' +
        '</form>' +
        '<div class="access-card">' +
          '<h4><span class="access-dot team" aria-hidden="true"></span>Team accounts</h4>' +
          '<p class="muted small">A team account signs in for one club and manages its roster, ' +
            'fixtures and games. Everything else is read-only for them.</p>' +
          '<div class="access-summary">' +
            '<span><strong>' + state.teams.length + '</strong> team accounts</span>' +
            '<span><strong>' + (state.teams.filter(t => auth.hasCustomPasscode(state, 'team', t.id)).length) +
              '</strong> with a custom passcode</span>' +
          '</div>' +
          '<p class="footnote">Demo passcode for every team: <code>' + ui.esc(auth.TEAM_DEFAULT) + '</code></p>' +
        '</div>' +
      '</div>' +
      '<div class="table-scroll access-table">' +
        '<table class="data-table">' +
          '<caption>Per-team sign-in</caption>' +
          '<thead><tr><th scope="col">Team</th><th scope="col">Role in league</th>' +
            '<th scope="col">Passcode</th><th scope="col" class="align-right">Actions</th></tr></thead>' +
          '<tbody>' + (state.teams.length ? rowsHtml(state) :
            '<tr><td colspan="4" class="empty-cell">No teams yet — add one in Teams &amp; Roster.</td></tr>') +
          '</tbody>' +
        '</table>' +
      '</div>';
  }

  function promptPasscode(state, role, teamId) {
    const team = state.teams.find(t => t.id === teamId);
    const label = role === 'commissioner' ? 'league management' : (team ? team.name : 'this team');
    ui.openModal({
      title: 'Set a passcode',
      submitLabel: 'Save passcode',
      fields: [
        { name: 'code', label: 'New passcode', type: 'password', required: true,
          placeholder: 'At least 4 characters', autocomplete: 'new-password',
          help: 'Sign-in for ' + label + '.' },
        { name: 'code2', label: 'Repeat passcode', type: 'password', required: true,
          placeholder: 'Repeat passcode', autocomplete: 'new-password' }
      ],
      onSubmit: (values, close) => {
        const code = String(values.code || '');
        if (code.length < 4) { ui.toast('Use at least 4 characters.', 'error'); return; }
        if (code !== String(values.code2 || '')) { ui.toast('The two passcodes do not match.', 'error'); return; }
        TBS.app.commit(d => { auth.setPasscode(d, role, teamId, code); });
        close();
        ui.toast('Passcode updated for ' + label + '.', 'success');
      }
    });
  }

  function resetPasscode(state, role, teamId) {
    const team = state.teams.find(t => t.id === teamId);
    const label = role === 'commissioner' ? 'league management' : (team ? team.name : 'this team');
    if (!ui.confirmDanger('Reset the passcode for ' + label + ' to the demo passcode "' +
      (role === 'commissioner' ? auth.ADMIN_DEFAULT : auth.TEAM_DEFAULT) + '"?')) return;
    TBS.app.commit(d => {
      const league = d.league = d.league || {};
      const access = league.access = (league.access && typeof league.access === 'object') ? league.access : {};
      if (role === 'commissioner') delete access.admin;
      else if (access.teams && typeof access.teams === 'object') delete access.teams[teamId];
    });
    ui.toast('Passcode reset to the demo value.', 'success');
  }

  function init() {
    const host = qs('#access-panel');
    if (!host) return;

    host.addEventListener('submit', e => {
      const form = e.target.closest('#access-admin-form');
      if (!form) return;
      e.preventDefault();
      const state = TBS.app.getState();
      const code = (qs('#access-admin-code') || {}).value || '';
      const again = (qs('#access-admin-code2') || {}).value || '';
      if (code.length < 4) { ui.toast('Use at least 4 characters.', 'error'); return; }
      if (code !== again) { ui.toast('The two passcodes do not match.', 'error'); return; }
      TBS.app.commit(d => { auth.setPasscode(d, 'commissioner', '', code); });
      form.reset();
      ui.toast('League management passcode saved.', 'success');
    });

    host.addEventListener('click', e => {
      const state = TBS.app.getState();
      const setBtn = e.target.closest('[data-access-set]');
      if (setBtn) { promptPasscode(state, 'team', setBtn.dataset.accessSet); return; }
      const resetBtn = e.target.closest('[data-access-reset]');
      if (resetBtn) { resetPasscode(state, 'team', resetBtn.dataset.accessReset); return; }
      if (e.target.closest('#access-admin-reset')) { resetPasscode(state, 'commissioner', ''); }
    });
  }

  TBS.access = { render: render, init: init };
})(window.TBS = window.TBS || {});
