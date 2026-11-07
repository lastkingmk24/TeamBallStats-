/* =========================================================================
 * teams.js — team management (name, abbreviation, custom colour) and the
 * roster (add / edit / deactivate / remove players, photo upload).
 *
 * Photos are compressed on a <canvas> by js/photos.js and stored inline in
 * players[].photo. Every avatar falls back to generated initials plus the
 * jersey number when there is no photo.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const storage = TBS.storage;
  const qs = ui.qs;

  let rosterFilter = 'all';
  let pendingPhoto = '';
  let teamColorChoice = '';

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  function preserveSelect(selector, build) {
    const el = qs(selector);
    if (!el) return;
    const previous = el.value;
    el.innerHTML = build(previous);
    if (previous && Array.from(el.options).some(o => o.value === previous)) el.value = previous;
  }

  function photoPreviewHtml(player) {
    if (!player || !player.id) {
      return '<span class="avatar avatar-lg avatar-preview-empty" aria-hidden="true">' +
        ui.icon('camera') + '</span>';
    }
    return ui.avatar(player, { size: 'lg', team: null, showNumber: false });
  }

  function syncFormPhoto() {
    const host = qs('#player-photo-preview');
    if (!host) return;
    host.innerHTML = photoPreviewHtml(pendingPhoto
      ? { id: 'new-player', name: qs('#player-name') ? qs('#player-name').value : '', photo: pendingPhoto }
      : null);
    const clear = qs('#player-photo-clear');
    if (clear) clear.disabled = !pendingPhoto;
    const hint = qs('#player-photo-hint');
    if (hint) {
      hint.textContent = pendingPhoto
        ? 'Photo ready · ' + Math.round(TBS.photos.bytesOf(pendingPhoto) / 1024) + ' KB stored'
        : 'Optional · resized to 128px and saved offline';
    }
  }

  function syncColorField() {
    const input = qs('#team-color');
    const swatch = qs('#team-color-state');
    if (!input) return;
    input.classList.toggle('is-unset', !teamColorChoice);
    if (swatch) {
      swatch.textContent = teamColorChoice ? teamColorChoice.toUpperCase() : 'No custom colour';
    }
  }

  function auth() { return TBS.auth; }
  function myTeamId() {
    const a = auth();
    return a && a.role() === 'team' ? a.myTeamId() : '';
  }
  /* Team accounts only ever see their own club in roster pickers. */
  function manageableTeams(state) {
    const mine = myTeamId();
    return mine ? state.teams.filter(t => t.id === mine) : state.teams;
  }

  function renderScope(state) {
    const host = qs('#teams-scope');
    const forms = qs('#teams-forms');
    const a = auth();
    const admin = !a || a.canManageLeague();
    if (forms) {
      const teamForm = qs('#team-form');
      if (teamForm) teamForm.hidden = !admin;
      forms.classList.toggle('single', !admin);
    }
    if (!host) return;
    if (!a || !a.isSignedIn()) { host.innerHTML = ''; return; }
    if (admin) {
      host.innerHTML = '<p class="scope-note-text"><strong>League management</strong> — you can add clubs, ' +
        'edit every roster and move a player between teams.</p>';
    } else {
      const team = teamOf(state, myTeamId());
      host.innerHTML = '<p class="scope-note-text">' + ui.teamLogo(team, 'sm') +
        '<span><strong>' + ui.esc(team ? team.name : 'Your team') + '</strong> — team account. ' +
        'You can manage this roster only; other clubs are read-only.</span></p>';
    }
  }

  function render(state) {
    const primaryId = state.league.primaryTeamId;

    renderScope(state);
    preserveSelect('#player-team', prev => {
      const teams = manageableTeams(state);
      const fallback = myTeamId() || prev || primaryId;
      return ui.teamOptions(teams, teams.some(t => t.id === fallback) ? fallback : (teams[0] || {}).id);
    });
    preserveSelect('#roster-team-filter', () =>
      '<option value="all">All teams</option>' + ui.teamOptions(state.teams, rosterFilter));
    const filter = qs('#roster-team-filter');
    if (filter) filter.value = rosterFilter;
    syncFormPhoto();
    syncColorField();

    /* Teams table */
    const teamRows = state.teams.map(t => {
      const rec = st.teamRecord(state.games, t.id);
      return {
        t: t,
        players: state.players.filter(p => p.teamId === t.id).length,
        games: rec.gp,
        record: rec.w + '–' + rec.l,
        winPct: rec.pct * 100
      };
    });
    qs('#teams-list').innerHTML = ui.table([
      { label: 'Team', key: 'name', sortValue: r => r.t.name, render: r =>
          '<span class="team-identity">' +
            '<span class="team-dot" style="--team-color:' + ui.esc(r.t.color || '#94a3b8') + '"></span>' +
            '<strong>' + ui.esc(r.t.name) + '</strong>' +
            (r.t.primary ? ' ' + ui.badge('My team', 'live') : '') +
          '</span>' },
      { label: 'Abbrev.', render: r => ui.esc(r.t.short || '—') },
      { label: 'Colour', render: r => r.t.color
          ? '<span class="colour-chip" style="--team-color:' + ui.esc(r.t.color) + '">' +
            '<span class="colour-dot"></span>' + ui.esc(r.t.color) + '</span>'
          : '<span class="muted">default</span>' },
      { label: 'Players', key: 'players', align: 'right' },
      { label: 'Games', key: 'games', align: 'right' },
      { label: 'Record', key: 'record', align: 'right' },
      { label: 'Actions', align: 'right', sortable: false, render: r => {
          const admin = !auth() || auth().canManageLeague();
          if (!admin) return '<span class="muted small">' + (myTeamId() === r.t.id ? 'Your club' : 'Read-only') + '</span>';
          return '<button type="button" class="btn btn-mini" data-action="edit-team" data-id="' + ui.esc(r.t.id) + '">Edit</button> ' +
            (r.t.primary ? '' : '<button type="button" class="btn btn-mini" data-action="delete-team" data-id="' + ui.esc(r.t.id) + '">Delete</button>');
        } }
    ], teamRows, {
      empty: 'No teams yet. Add one above.',
      rowClass: r => r.t.id === primaryId ? 'row-primary' : ''
    });

    /* Roster table (searchable + sortable) */
    const players = state.players
      .filter(p => rosterFilter === 'all' || p.teamId === rosterFilter)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999) ||
        String(a.name).localeCompare(String(b.name)));

    qs('#roster-content').innerHTML = state.players.length === 0
      ? ui.emptyState('Roster is empty',
          'Add players with the form above — the Live Console and box scores pick them up automatically.')
      : ui.smartTable({
        id: 'roster',
        searchPlaceholder: 'Search roster by name, number, position…',
        searchText: row => [row.p.name, row.p.number, row.p.position, teamName(state, row.p.teamId)].join(' '),
        rows: players.map(p => ({ p: p, agg: st.playerAggregate(p.id, state.games) })),
        sortKey: 'number',
        dir: 'asc',
        empty: 'No players match this filter.',
        columns: [
          { label: '#', key: 'number', sortValue: row => Number(row.p.number) || 999,
            align: 'right', render: row => '<span class="jnum jnum-standalone">' + ui.esc(row.p.number) + '</span>' },
          { label: 'Player', key: 'name', sortValue: row => row.p.name, render: row =>
              ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'md', showNumber: false,
                sub: row.p.active === false ? 'inactive' : (row.p.position || '') }) },
          { label: 'Team', key: 'team', sortValue: row => teamName(state, row.p.teamId),
            render: row => ui.esc(teamName(state, row.p.teamId)) },
          { label: 'Pos.', key: 'position', sortValue: row => row.p.position,
            render: row => ui.esc(row.p.position || '—') },
          { label: 'GP', key: 'gp', sortValue: row => row.agg.gp, align: 'right',
            render: row => ui.fmtInt(row.agg.gp) },
          { label: 'MIN', key: 'min', sortValue: row => row.agg.totals.min, align: 'right',
            render: row => ui.fmtInt(row.agg.totals.min) },
          { label: 'PPG', key: 'ppg', sortValue: row => row.agg.ppg, align: 'right',
            render: row => '<strong>' + ui.fmt1(row.agg.ppg) + '</strong>' },
          { label: 'RPG', key: 'rpg', sortValue: row => row.agg.rpg, align: 'right',
            render: row => ui.fmt1(row.agg.rpg) },
          { label: 'APG', key: 'apg', sortValue: row => row.agg.apg, align: 'right',
            render: row => ui.fmt1(row.agg.apg) },
          { label: 'FG%', key: 'fg', sortValue: row => row.agg.fgPct === null ? -1 : row.agg.fgPct,
            align: 'right', render: row => ui.fmtPct(row.agg.fgPct) },
          { label: 'Actions', sortable: false, align: 'right', render: row => {
              const editable = !auth() ? true : auth().canEditPlayer(row.p);
              return '<div class="row-actions">' +
              '<button type="button" class="btn btn-mini" data-profile="' + ui.esc(row.p.id) +
                '">Profile</button>' +
              (editable
                ? '<button type="button" class="btn btn-mini" data-action="edit-player" data-id="' +
                    ui.esc(row.p.id) + '">Edit</button>' +
                  '<button type="button" class="btn btn-mini" data-action="toggle-player" data-id="' +
                    ui.esc(row.p.id) + '">' + (row.p.active === false ? 'Activate' : 'Deactivate') + '</button>' +
                  '<button type="button" class="btn btn-mini" data-action="delete-player" data-id="' +
                    ui.esc(row.p.id) + '">Remove</button>'
                : '<span class="muted small">Read-only</span>') +
              '</div>';
            } }
        ]
      });
  }

  /* ---------------------------- team editing ------------------------------ */

  function editTeam(state, id) {
    const team = teamOf(state, id);
    if (!team) return;
    ui.openModal({
      title: 'Edit team',
      fields: [
        { name: 'name', label: 'Team name', type: 'text', value: team.name, required: true },
        { name: 'short', label: 'Abbreviation', type: 'text', value: team.short, maxlength: 5 },
        { name: 'color', label: 'Custom colour', type: 'color', value: team.color || '#c8102e',
          help: 'Used for avatars, badges, charts and scoreboards.' },
        { name: 'useColor', label: 'Use this colour', type: 'checkbox', value: !!team.color }
      ],
      onSubmit: (values, close) => {
        const name = String(values.name).trim();
        if (!name) return;
        TBS.app.commit(d => {
          const t = d.teams.find(x => x.id === id);
          if (!t) return;
          t.name = name;
          t.short = String(values.short || '').trim().toUpperCase().slice(0, 5) ||
            name.slice(0, 3).toUpperCase();
          t.color = values.useColor ? storage.normalizeColor(values.color) : '';
        });
        close();
        ui.toast('Team updated.', 'success');
      }
    });
  }

  function deleteTeam(state, id) {
    const team = teamOf(state, id);
    if (!team || team.primary) return;
    if (auth() && !auth().canDeleteTeam()) {
      ui.toast('Only league management can remove a club.', 'error');
      return;
    }
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

  /* --------------------------- player editing ----------------------------- */

  function openEditPlayer(id) {
    const state = TBS.app.getState();
    const player = state.players.find(p => p.id === id);
    if (!player) { ui.toast('That player no longer exists.', 'error'); return; }
    const team = teamOf(state, player.teamId);
    let photo = player.photo || '';

    function bodyHtml() {
      return '<form class="modal-form" id="edit-player-form" novalidate>' +
        '<div class="photo-editor">' +
          '<div class="photo-editor-preview" id="edit-photo-preview">' +
            ui.avatar({ id: player.id, name: player.name || 'Player', number: player.number, photo: photo },
              { size: 'xl', team: team }) +
          '</div>' +
          '<div class="photo-editor-actions">' +
            '<input type="file" id="edit-player-photo" accept="image/*" class="visually-hidden" />' +
            '<label class="btn btn-ghost btn-mini" for="edit-player-photo">' +
              ui.icon('camera') + (photo ? 'Replace photo' : 'Add photo') + '</label>' +
            '<button type="button" class="btn btn-mini" data-action="clear-photo"' +
              (photo ? '' : ' disabled') + '>Remove photo</button>' +
            '<p class="footnote" id="edit-photo-hint">' +
              (photo ? 'Stored offline · ' + Math.round(TBS.photos.bytesOf(photo) / 1024) + ' KB'
                : 'Optional · square crop to 128px on this device') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="field"><label for="edit-name">Name</label>' +
          '<input type="text" id="edit-name" name="name" value="' + ui.esc(player.name) + '" required /></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="edit-number">Jersey #</label>' +
            '<input type="number" id="edit-number" name="number" min="0" max="99" step="1" value="' +
              ui.esc(player.number) + '" required /></div>' +
          '<div class="field"><label for="edit-position">Position</label>' +
            '<select id="edit-position" name="position">' +
              ui.options(['', 'PG', 'SG', 'SF', 'PF', 'C'].map(v => ({ value: v, label: v || '—' })),
                player.position) + '</select></div>' +
        '</div>' +
        '<div class="field"><label for="edit-team">Team</label>' +
          '<select id="edit-team" name="teamId">' + ui.teamOptions(state.teams, player.teamId) + '</select></div>' +
        '<div class="field field-inline"><input type="checkbox" id="edit-active" name="active"' +
          (player.active === false ? '' : ' checked') + ' />' +
          '<label for="edit-active">Active (available in the live console)</label></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
          '<button type="submit" class="btn btn-primary">Save player</button>' +
        '</div>' +
      '</form>';
    }

    function refreshPhoto(overlay) {
      const host = overlay.querySelector('#edit-photo-preview');
      if (host) {
        host.innerHTML = ui.avatar({
          id: player.id,
          name: (overlay.querySelector('#edit-name') || {}).value || player.name,
          number: (overlay.querySelector('#edit-number') || {}).value || player.number,
          photo: photo
        }, { size: 'xl', team: team });
      }
      const disabled = overlay.querySelector('[data-action="clear-photo"]');
      if (disabled) disabled.disabled = !photo;
      const hint = overlay.querySelector('#edit-photo-hint');
      if (hint) {
        hint.textContent = photo
          ? 'Stored offline · ' + Math.round(TBS.photos.bytesOf(photo) / 1024) + ' KB'
          : 'Optional · square crop to 128px on this device';
      }
    }

    ui.openDialog({
      title: 'Edit player',
      className: 'modal-photo',
      bodyHtml: bodyHtml(),
      onMount: (overlay, close) => {
        const input = overlay.querySelector('#edit-player-photo');
        TBS.photos.bindInput(input, {
          onPhoto: dataUrl => { photo = dataUrl; refreshPhoto(overlay); },
          onError: message => ui.toast(message, 'error')
        });
        overlay.querySelector('#edit-name').addEventListener('input', () => refreshPhoto(overlay));
        overlay.querySelector('#edit-number').addEventListener('input', () => refreshPhoto(overlay));
        overlay.addEventListener('click', e => {
          const btn = e.target.closest('[data-action="clear-photo"]');
          if (btn) { photo = ''; refreshPhoto(overlay); }
        });
        overlay.querySelector('#edit-player-form').addEventListener('submit', e => {
          e.preventDefault();
          const form = e.target;
          if (!form.checkValidity()) { form.reportValidity(); return; }
          const name = form.elements.name.value.trim();
          if (!name) { ui.toast('A name is required.', 'error'); return; }
          const number = storage.num(form.elements.number.value, 0);
          const teamId = form.elements.teamId.value;
          const position = String(form.elements.position.value || '').toUpperCase();
          const active = !!form.elements.active.checked;

          if (photo) {
            const warning = TBS.photos.quotaMessage(TBS.photos.bytesOf(photo));
            if (warning && !window.confirm(warning + '\n\nSave anyway?')) return;
          }
          const ok = TBS.app.commit(d => {
            const p = d.players.find(x => x.id === id);
            if (!p) return;
            p.name = name;
            p.number = Math.max(0, Math.min(99, Math.round(number)));
            p.position = position;
            p.active = active;
            p.photo = photo;
            if (d.teams.some(t => t.id === teamId) && p.teamId !== teamId) {
              p.teamId = teamId;
              d.games.forEach(g => {
                g.stats.forEach(s => { if (s.playerId === id) s.teamId = p.teamId; });
              });
            }
          });
          if (!ok) {
            ui.toast('Save failed — browser storage is full. Try a smaller photo or remove one.', 'error');
            return;
          }
          close();
          ui.toast('Player updated.', 'success');
        });
      }
    });
  }

  function deletePlayer(state, id) {
    const player = state.players.find(p => p.id === id);
    if (!player) return;
    if (!ui.confirmDanger('Remove "' + player.name + '" and all of their box score lines? ' +
      'This cannot be undone.')) return;
    TBS.app.commit(d => {
      d.players = d.players.filter(p => p.id !== id);
      d.games.forEach(g => { g.stats = g.stats.filter(s => s.playerId !== id); });
    });
    ui.toast('Player removed.', 'success');
  }

  /* ------------------------------- wiring --------------------------------- */

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
          color: storage.normalizeColor(teamColorChoice),
          primary: false
        });
      });
      e.target.reset();
      teamColorChoice = '';
      syncColorField();
      ui.toast('Team added.', 'success');
    });

    const colorInput = qs('#team-color');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        teamColorChoice = colorInput.value;
        syncColorField();
      });
    }
    const colorClear = qs('#team-color-clear');
    if (colorClear) {
      colorClear.addEventListener('click', () => {
        teamColorChoice = '';
        syncColorField();
      });
    }

    const photoInput = qs('#player-photo');
    if (photoInput) {
      TBS.photos.bindInput(photoInput, {
        onPhoto: dataUrl => { pendingPhoto = dataUrl; syncFormPhoto(); },
        onError: message => ui.toast(message, 'error')
      });
    }
    const photoClear = qs('#player-photo-clear');
    if (photoClear) {
      photoClear.addEventListener('click', () => { pendingPhoto = ''; syncFormPhoto(); });
    }
    const nameInput = qs('#player-name');
    if (nameInput) nameInput.addEventListener('input', syncFormPhoto);

    qs('#player-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = qs('#player-name').value.trim();
      const number = storage.num(qs('#player-number').value, 0);
      const position = qs('#player-position').value;
      let teamId = qs('#player-team').value;
      if (auth() && !auth().canManageLeague()) teamId = auth().myTeamId();
      if (!name || !teamId) return;
      const state = TBS.app.getState();
      if (state.players.some(p => p.teamId === teamId && Number(p.number) === number)) {
        if (!ui.confirmDanger('Another player on this team already wears #' + number +
          '. Add anyway?')) return;
      }
      if (pendingPhoto) {
        const warning = TBS.photos.quotaMessage(TBS.photos.bytesOf(pendingPhoto));
        if (warning) { ui.toast(warning, 'error'); return; }
      }
      const ok = TBS.app.commit(d => {
        d.players.push({
          id: storage.uid('player'), teamId: teamId, name: name,
          number: Math.max(0, Math.min(99, Math.round(number))),
          position: String(position || '').toUpperCase(),
          active: true,
          photo: pendingPhoto
        });
      });
      if (!ok) {
        ui.toast('Could not save the player — browser storage is full. Remove a photo or export a backup.', 'error');
        return;
      }
      e.target.reset();
      qs('#player-team').value = teamId;
      pendingPhoto = '';
      syncFormPhoto();
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
      if (btn.dataset.action === 'edit-player') {
        if (auth() && !auth().canEditPlayer(state.players.find(p => p.id === id))) {
          ui.toast('You can only edit players on your own team.', 'error');
          return;
        }
        openEditPlayer(id);
      }
      else if (btn.dataset.action === 'delete-player') deletePlayer(state, id);
      else if (btn.dataset.action === 'toggle-player') {
        if (auth() && !auth().canEditPlayer(state.players.find(p => p.id === id))) {
          ui.toast('You can only manage players on your own team.', 'error');
          return;
        }
        TBS.app.commit(d => {
          const p = d.players.find(x => x.id === id);
          if (p) p.active = p.active === false;
        });
      }
    });
  }

  function showTeamStats(teamId) {
    const state = TBS.app.getState();
    if (!state.teams.some(t => t.id === teamId)) return;
    if (auth() && !auth().canViewTeamStats(teamId)) return;
    rosterFilter = teamId;
    render(state);
    TBS.app.go('teams');
  }

  TBS.teams = {
    render: render,
    init: init,
    openEditPlayer: openEditPlayer,
    editPlayer: openEditPlayer,
    editTeam: editTeam,
    showTeamStats: showTeamStats
  };
})(window.TBS = window.TBS || {});
