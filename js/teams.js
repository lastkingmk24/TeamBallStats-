/* =========================================================================
 * teams.js — team management and player roster (add / edit / remove).
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const storage = TBS.storage;
  const qs = ui.qs;
  let rosterFilter = 'all';

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function preserveSelect(selector, build) {
    const el = qs(selector);
    if (!el) return;
    const previous = el.value;
    el.innerHTML = build(previous);
    if (previous && Array.from(el.options).some(o => o.value === previous)) el.value = previous;
  }

  function render(state) {
    const primaryId = state.league.primaryTeamId;

    preserveSelect('#player-team', prev => ui.teamOptions(state.teams, prev || primaryId));
    preserveSelect('#roster-team-filter', () =>
      '<option value="all">All teams</option>' + ui.teamOptions(state.teams, rosterFilter));
    const filter = qs('#roster-team-filter');
    if (filter) filter.value = rosterFilter;

    /* Teams table */
    const teamRows = state.teams.map(t => {
      const rec = st.teamRecord(state.games, t.id);
      return {
        t: t,
        players: state.players.filter(p => p.teamId === t.id).length,
        games: rec.gp,
        record: rec.w + '–' + rec.l
      };
    });
    qs('#teams-list').innerHTML = ui.table([
      { label: 'Team', render: r => '<strong>' + ui.esc(r.t.name) + '</strong>' +
          (r.t.primary ? ' <span class="badge badge-live">My team</span>' : '') },
      { label: 'Abbrev.', render: r => ui.esc(r.t.short) },
      { label: 'Players', key: 'players', align: 'right' },
      { label: 'Games', key: 'games', align: 'right' },
      { label: 'Record', key: 'record', align: 'right' },
      { label: 'Actions', align: 'right', render: r =>
          '<button type="button" class="btn btn-mini" data-action="edit-team" data-id="' + ui.esc(r.t.id) + '">Edit</button> ' +
          (r.t.primary ? '' : '<button type="button" class="btn btn-mini" data-action="delete-team" data-id="' + ui.esc(r.t.id) + '">Delete</button>') }
    ], teamRows, { empty: 'No teams yet. Add one above.', rowClass: r => r.t.id === primaryId ? 'row-primary' : '' });

    /* Roster table */
    const players = state.players
      .filter(p => rosterFilter === 'all' || p.teamId === rosterFilter)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) ||
        String(a.name).localeCompare(String(b.name)));
    qs('#roster-content').innerHTML = state.players.length === 0
      ? ui.emptyState('Roster is empty', 'Add players with the form above — the Live Console and box scores will pick them up automatically.')
      : ui.table([
          { label: '#', render: p => ui.esc(p.number), align: 'right' },
          { label: 'Player', render: p => '<strong>' + ui.esc(p.name) + '</strong>' +
              (p.active === false ? ' <span class="badge badge-other">inactive</span>' : '') },
          { label: 'Pos.', render: p => ui.esc(p.position || '—') },
          { label: 'Team', render: p => ui.esc(teamName(state, p.teamId)) },
          { label: 'GP', render: p => ui.fmtInt(st.playerAggregate(p.id, state.games).gp), align: 'right' },
          { label: 'PPG', render: p => ui.fmt1(st.playerAggregate(p.id, state.games).ppg), align: 'right' },
          { label: 'RPG', render: p => ui.fmt1(st.playerAggregate(p.id, state.games).rpg), align: 'right' },
          { label: 'FG%', render: p => ui.fmtPct(st.playerAggregate(p.id, state.games).fgPct), align: 'right' },
          { label: 'Actions', align: 'right', render: p =>
              '<button type="button" class="btn btn-mini" data-action="edit-player" data-id="' + ui.esc(p.id) + '">Edit</button> ' +
              '<button type="button" class="btn btn-mini" data-action="toggle-player" data-id="' + ui.esc(p.id) + '">' +
              (p.active === false ? 'Activate' : 'Deactivate') + '</button> ' +
              '<button type="button" class="btn btn-mini" data-action="delete-player" data-id="' + ui.esc(p.id) + '">Remove</button>' }
        ], players, { empty: 'No players match this filter.', rowClass: p => p.teamId === primaryId ? '' : '' });
  }

  function editTeam(state, id) {
    const team = state.teams.find(t => t.id === id);
    if (!team) return;
    ui.openModal({
      title: 'Edit team',
      fields: [
        { name: 'name', label: 'Team name', type: 'text', value: team.name, required: true },
        { name: 'short', label: 'Abbreviation', type: 'text', value: team.short, maxlength: 5 }
      ],
      onSubmit: (values, close) => {
        const name = String(values.name).trim();
        if (!name) return;
        TBS.app.commit(d => {
          const t = d.teams.find(x => x.id === id);
          if (t) {
            t.name = name;
            t.short = String(values.short).trim().toUpperCase().slice(0, 5) || name.slice(0, 3).toUpperCase();
          }
        });
        close();
        ui.toast('Team updated.', 'success');
      }
    });
  }

  function deleteTeam(state, id) {
    const team = state.teams.find(t => t.id === id);
    if (!team || team.primary) return;
    const hasGames = state.games.some(g => g.homeTeamId === id || g.awayTeamId === id);
    const hasPlayers = state.players.some(p => p.teamId === id);
    if (hasGames || hasPlayers) {
      ui.toast('This team has players or games. Move/remove those first.', 'error');
      return;
    }
    if (!ui.confirmDanger('Delete team "' + team.name + '"? This cannot be undone.')) return;
    TBS.app.commit(d => { d.teams = d.teams.filter(t => t.id !== id); });
    ui.toast('Team deleted.', 'success');
  }

  function editPlayer(state, id) {
    const player = state.players.find(p => p.id === id);
    if (!player) return;
    ui.openModal({
      title: 'Edit player',
      fields: [
        { name: 'name', label: 'Name', type: 'text', value: player.name, required: true },
        { name: 'number', label: 'Jersey #', type: 'number', value: player.number, min: 0, max: 99, required: true },
        { name: 'position', label: 'Position', type: 'select', value: player.position,
          options: ['', 'PG', 'SG', 'SF', 'PF', 'C'].map(v => ({ value: v, label: v || '—' })) },
        { name: 'teamId', label: 'Team', type: 'select', value: player.teamId,
          options: state.teams.map(t => ({ value: t.id, label: t.name })) }
      ],
      onSubmit: (values, close) => {
        const name = String(values.name).trim();
        if (!name) return;
        TBS.app.commit(d => {
          const p = d.players.find(x => x.id === id);
          if (!p) return;
          p.name = name;
          p.number = storage.num(values.number, 0);
          p.position = String(values.position || '').toUpperCase();
          if (d.teams.some(t => t.id === values.teamId)) {
            p.teamId = values.teamId;
            d.games.forEach(g => {
              g.stats.forEach(s => { if (s.playerId === id) s.teamId = p.teamId; });
            });
          }
        });
        close();
        ui.toast('Player updated.', 'success');
      }
    });
  }

  function deletePlayer(state, id) {
    const player = state.players.find(p => p.id === id);
    if (!player) return;
    if (!ui.confirmDanger('Remove "' + player.name + '" and all of their box score lines? This cannot be undone.')) return;
    TBS.app.commit(d => {
      d.players = d.players.filter(p => p.id !== id);
      d.games.forEach(g => { g.stats = g.stats.filter(s => s.playerId !== id); });
    });
    ui.toast('Player removed.', 'success');
  }

  function init() {
    qs('#team-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = qs('#team-name').value.trim();
      const short = qs('#team-short').value.trim().toUpperCase();
      if (!name) return;
      TBS.app.commit(d => {
        d.teams.push({
          id: storage.uid('team'),
          name: name,
          short: short || name.slice(0, 3).toUpperCase(),
          primary: false
        });
      });
      e.target.reset();
      ui.toast('Team added.', 'success');
    });

    qs('#player-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = qs('#player-name').value.trim();
      const number = storage.num(qs('#player-number').value, 0);
      const position = qs('#player-position').value;
      const teamId = qs('#player-team').value;
      if (!name) return;
      const state = TBS.app.getState();
      if (state.players.some(p => p.teamId === teamId && Number(p.number) === number)) {
        if (!ui.confirmDanger('Another player on this team already wears #' + number + '. Add anyway?')) return;
      }
      TBS.app.commit(d => {
        d.players.push({
          id: storage.uid('player'), teamId: teamId, name: name,
          number: number, position: position.toUpperCase(), active: true
        });
      });
      e.target.reset();
      qs('#player-team').value = teamId;
      ui.toast('Player added.', 'success');
    });

    qs('#roster-team-filter').addEventListener('change', e => {
      rosterFilter = e.target.value;
      render(TBS.app.getState());
    });

    qs('#teams-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const state = TBS.app.getState();
      if (btn.dataset.action === 'edit-team') editTeam(state, btn.dataset.id);
      else if (btn.dataset.action === 'delete-team') deleteTeam(state, btn.dataset.id);
    });

    qs('#roster-content').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const state = TBS.app.getState();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit-player') editPlayer(state, id);
      else if (btn.dataset.action === 'delete-player') deletePlayer(state, id);
      else if (btn.dataset.action === 'toggle-player') {
        TBS.app.commit(d => {
          const p = d.players.find(x => x.id === id);
          if (p) p.active = p.active === false;
        });
      }
    });
  }

  TBS.teams = { render: render, init: init };
})(window.TBS = window.TBS || {});
