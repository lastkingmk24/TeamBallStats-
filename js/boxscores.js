/* =========================================================================
 * boxscores.js — full two-team box scores, manual editing, quarter scoring.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const storage = TBS.storage;
  const qs = ui.qs;

  let selectedGameId = null;
  let editMode = false;
  let draft = null;

  const EDIT_FIELDS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov',
    'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pf'];

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function activeGame(state) {
    let game = state.games.find(g => g.id === selectedGameId);
    if (!game) {
      const finals = state.games.filter(g => g.status === 'final');
      const live = state.games.filter(g => g.status === 'live');
      game = finals[finals.length - 1] || live[0] || state.games[state.games.length - 1] || null;
      selectedGameId = game ? game.id : null;
    }
    return game;
  }

  function openGame(id) {
    selectedGameId = id;
    editMode = false;
    draft = null;
    const select = qs('#box-game-select');
    if (select && Array.from(select.options).some(o => o.value === id)) select.value = id;
    if (TBS.app.activeTab && TBS.app.activeTab() === 'boxscores') render(TBS.app.getState());
  }

  function makeDraft(game) {
    return {
      status: game.status,
      homeScore: Number(game.homeScore) || 0,
      awayScore: Number(game.awayScore) || 0,
      notes: game.notes || '',
      stats: JSON.parse(JSON.stringify(game.stats || []))
    };
  }

  function shooting(made, attempted) {
    const p = st.pct(made, attempted);
    return ui.fmtInt(made) + '/' + ui.fmtInt(attempted) +
      (p === null ? '' : ' <span class="muted">(' + ui.fmtPct(p) + ')</span>');
  }

  function sideTable(side, state) {
    const columns = [
      { label: '#', render: r => ui.esc(r.player.number) },
      { label: 'Player', render: r => '<strong>' + ui.esc(r.player.name) + '</strong>' +
          (r.player.position ? ' <span class="muted">' + ui.esc(r.player.position) + '</span>' : '') },
      { label: 'MIN', render: r => ui.fmtInt(r.stats.min), align: 'right' },
      { label: 'PTS', render: r => '<strong>' + ui.fmtInt(r.stats.pts) + '</strong>', align: 'right' },
      { label: 'REB', render: r => ui.fmtInt(r.stats.reb), align: 'right' },
      { label: 'AST', render: r => ui.fmtInt(r.stats.ast), align: 'right' },
      { label: 'STL', render: r => ui.fmtInt(r.stats.stl), align: 'right' },
      { label: 'BLK', render: r => ui.fmtInt(r.stats.blk), align: 'right' },
      { label: 'TOV', render: r => ui.fmtInt(r.stats.tov), align: 'right' },
      { label: 'FG', render: r => shooting(r.stats.fgm, r.stats.fga), align: 'right' },
      { label: '3PT', render: r => shooting(r.stats.tpm, r.stats.tpa), align: 'right' },
      { label: 'FT', render: r => shooting(r.stats.ftm, r.stats.fta), align: 'right' },
      { label: 'PF', render: r => ui.fmtInt(r.stats.pf), align: 'right' }
    ];
    const t = side.totals;
    const foot = [
      '<strong>TOTALS</strong>', '', ui.fmtInt(t.min), ui.fmtInt(t.pts), ui.fmtInt(t.reb),
      ui.fmtInt(t.ast), ui.fmtInt(t.stl), ui.fmtInt(t.blk), ui.fmtInt(t.tov),
      shooting(t.fgm, t.fga), shooting(t.tpm, t.tpa), shooting(t.ftm, t.fta), ui.fmtInt(t.pf)
    ];
    return '<div class="box-section-title"><h3>' + ui.esc(side.team.name) + '</h3>' +
      '<span class="score-tag">' + ui.fmtInt(side.score) + '</span></div>' +
      ui.table(columns, side.rows, {
        empty: 'No player lines for this team. Use “Edit box score” to add them.',
        foot: foot,
        caption: ui.fmtPct(st.pct(t.fgm, t.fga)) + ' FG · ' +
          ui.fmtPct(st.pct(t.tpm, t.tpa)) + ' 3PT · ' +
          ui.fmtPct(st.pct(t.ftm, t.fta)) + ' FT'
      });
  }

  function quarterTable(game, state) {
    const q = st.quarterScores(game, state.league);
    if (!q.tracked.some(Boolean)) return '';
    const cols = [{ label: 'Team' }].concat(
      Array.from({ length: q.count }, (_, i) => ({ label: 'Q' + (i + 1), align: 'right' }))
    ).concat([{ label: 'Final', align: 'right' }]);
    const rows = [
      { name: teamName(state, game.homeTeamId), values: q.home, total: game.homeScore },
      { name: teamName(state, game.awayTeamId), values: q.away, total: game.awayScore }
    ];
    cols.forEach((c, i) => {
      if (i === 0) c.render = r => '<strong>' + ui.esc(r.name) + '</strong>';
      else if (i === cols.length - 1) c.render = r => '<strong>' + ui.fmtInt(r.total) + '</strong>';
      else c.render = r => q.tracked[i - 1] ? ui.fmtInt(r.values[i - 1]) : '—';
    });
    return '<h3 class="subhead">Scoring by quarter</h3>' +
      '<div class="quarter-table">' + ui.table(cols, rows) + '</div>' +
      '<p class="footnote">Quarter totals come from live-console plays. Manual score adjustments are included; box-score edits are not.</p>';
  }

  function editorTable(state, teamId, title) {
    const lines = draft.stats.filter(s => s.teamId === teamId);
    const players = state.players.filter(p => p.teamId === teamId);
    const nameOf = id => {
      const p = players.find(x => x.id === id);
      return p ? '#' + p.number + ' ' + p.name : 'Former player';
    };
    const head = '<thead><tr><th>Player</th>' +
      EDIT_FIELDS.map(f => '<th class="align-right">' + f.toUpperCase() + '</th>').join('') +
      '<th></th></tr></thead>';
    const body = lines.length ? lines.map(line =>
      '<tr><td>' + ui.esc(nameOf(line.playerId)) + '</td>' +
      EDIT_FIELDS.map(f =>
        '<td class="align-right"><input type="number" min="0" step="1" value="' +
        ui.esc(storage.num(line[f], 0)) + '" data-edit-stat="' + f +
        '" data-player-id="' + ui.esc(line.playerId) + '" data-team-id="' + ui.esc(teamId) +
        '" aria-label="' + f.toUpperCase() + ' for ' + ui.esc(nameOf(line.playerId)) + '" /></td>').join('') +
      '<td><button type="button" class="btn btn-mini" data-action="remove-line" data-player-id="' +
        ui.esc(line.playerId) + '" data-team-id="' + ui.esc(teamId) + '">×</button></td></tr>').join('')
      : '<tr><td class="empty-cell" colspan="' + (EDIT_FIELDS.length + 2) + '">No lines yet — add a player below.</td></tr>';
    const addRow = '<div class="toolbar" style="margin:.6rem 0 0">' +
      '<select data-add-select="' + ui.esc(teamId) + '">' +
      ui.options(players.filter(p => !lines.some(l => l.playerId === p.id))
        .map(p => ({ value: p.id, label: '#' + p.number + ' ' + p.name })), '', '— add player —') +
      '</select>' +
      '<button type="button" class="btn btn-mini" data-action="add-line" data-team-id="' +
      ui.esc(teamId) + '">Add line</button></div>';

    return '<div class="box-section-title"><h3>' + ui.esc(title) + '</h3></div>' +
      '<div class="box-editor"><div class="table-scroll"><table class="data-table">' +
      head + '<tbody>' + body + '</tbody></table></div></div>' + addRow;
  }

  function render(state) {
    const select = qs('#box-game-select');
    const sorted = state.games.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time))
    );
    select.innerHTML = ui.gameOptions(sorted, state.teams, selectedGameId, '');
    const game = activeGame(state);
    if (selectedGameId) select.value = selectedGameId;

    const editBtn = qs('#box-edit-btn');
    const printBtn = qs('#box-print-btn');
    const deleteBtn = qs('#box-delete-btn');
    editBtn.disabled = !game;
    printBtn.disabled = !game;
    deleteBtn.disabled = !game;
    editBtn.textContent = editMode ? 'Cancel editing' : 'Edit box score';

    const host = qs('#box-content');
    if (!game) {
      host.innerHTML = ui.emptyState('No games to show',
        'Schedule a game or log one in the Live Console first.',
        '<button type="button" class="btn btn-primary" data-action="go-schedule">Go to Schedule</button>');
      return;
    }

    if (editMode) {
      if (!draft) draft = makeDraft(game);
      host.innerHTML =
        '<div class="box-header">' +
          '<h3 style="text-align:center">Editing box score — ' + ui.esc(teamName(state, game.awayTeamId)) +
            ' @ ' + ui.esc(teamName(state, game.homeTeamId)) + '</h3>' +
          '<div class="toolbar" style="justify-content:center;margin:1rem 0 0">' +
            '<label class="field field-inline"><span>Home score</span><input type="number" min="0" id="edit-home-score" value="' +
              ui.esc(draft.homeScore) + '" style="width:90px" /></label>' +
            '<label class="field field-inline"><span>Away score</span><input type="number" min="0" id="edit-away-score" value="' +
              ui.esc(draft.awayScore) + '" style="width:90px" /></label>' +
            '<label class="field field-inline"><span>Status</span><select id="edit-status">' +
              ui.options(storage.STATUSES.map(s => ({ value: s, label: s })), draft.status) + '</select></label>' +
          '</div>' +
          '<label class="field" style="margin-top:1rem;max-width:520px;margin-inline:auto"><span>Notes</span>' +
            '<input type="text" id="edit-notes" value="' + ui.esc(draft.notes) + '" /></label>' +
        '</div>' +
        editorTable(state, game.homeTeamId, teamName(state, game.homeTeamId) + ' (home)') +
        editorTable(state, game.awayTeamId, teamName(state, game.awayTeamId) + ' (away)') +
        '<div class="box-editor-actions">' +
          '<button type="button" class="btn btn-primary" data-action="save-box">Save box score</button>' +
          '<button type="button" class="btn btn-ghost" data-action="cancel-box">Cancel</button>' +
          '<span class="muted small">Edits replace player lines; live play-by-play history is kept.</span>' +
        '</div>';
      return;
    }

    const box = st.gameBox(game, state.players, state.teams, state.league);
    const resultText = game.status === 'final'
      ? (box.result === 'T' ? 'Tie' : (box.home.score > box.away.score ? box.home.team.name : box.away.team.name) + ' won')
      : (game.status === 'live' ? 'In progress' : 'Not started');
    host.innerHTML =
      '<div class="box-header">' +
        '<div class="matchup">' +
          '<span class="side">' + ui.esc(box.away.team.name) + '</span>' +
          '<span class="final-score">' + ui.fmtInt(box.home.score) + '–' + ui.fmtInt(box.away.score) + '</span>' +
          '<span class="side">' + ui.esc(box.home.team.name) + '</span>' +
        '</div>' +
        '<div class="box-meta">' + ui.statusBadge(game.status) + ' · ' + ui.fmtDate(game.date) +
          (game.time ? ' ' + ui.fmtTime(game.time) : '') +
          (game.location ? ' · ' + ui.esc(game.location) : '') +
          ' · ' + ui.esc(resultText) +
          (game.notes ? ' · ' + ui.esc(game.notes) : '') + '</div>' +
      '</div>' +
      sideTable(box.away, state) + sideTable(box.home, state) +
      quarterTable(game, state) +
      '<p class="footnote">Box score shows ' + game.stats.length + ' player lines and ' +
        game.events.length + ' logged plays. Tip: edit any line manually with “Edit box score”.</p>';
  }

  function init() {
    qs('#box-game-select').addEventListener('change', e => {
      selectedGameId = e.target.value;
      editMode = false;
      draft = null;
      render(TBS.app.getState());
    });

    qs('#box-edit-btn').addEventListener('click', () => {
      if (editMode) { editMode = false; draft = null; }
      else { editMode = true; draft = makeDraft(activeGame(TBS.app.getState())); }
      render(TBS.app.getState());
    });

    qs('#box-print-btn').addEventListener('click', () => {
      const game = activeGame(TBS.app.getState());
      if (game) TBS.reports.printBoxScore(game.id);
    });

    qs('#box-delete-btn').addEventListener('click', () => {
      const game = activeGame(TBS.app.getState());
      if (!game) return;
      if (!ui.confirmDanger('Delete this game and its entire box score? This cannot be undone.')) return;
      selectedGameId = null;
      editMode = false;
      draft = null;
      TBS.app.commit(d => { d.games = d.games.filter(g => g.id !== game.id); });
      ui.toast('Game deleted.', 'success');
    });

    const host = qs('#box-content');
    host.addEventListener('input', e => {
      if (!editMode || !draft) return;
      const input = e.target;
      if (input.dataset.editStat) {
        const line = draft.stats.find(s => s.playerId === input.dataset.playerId && s.teamId === input.dataset.teamId);
        if (line) line[input.dataset.editStat] = Math.max(0, storage.num(input.value, 0));
      } else if (input.id === 'edit-home-score') draft.homeScore = Math.max(0, storage.num(input.value, 0));
      else if (input.id === 'edit-away-score') draft.awayScore = Math.max(0, storage.num(input.value, 0));
      else if (input.id === 'edit-status') draft.status = input.value;
      else if (input.id === 'edit-notes') draft.notes = input.value;
    });

    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const state = TBS.app.getState();
      const game = activeGame(state);
      const action = btn.dataset.action;
      if (action === 'go-schedule') { TBS.app.go('schedule'); return; }
      if (!game) return;

      if (action === 'add-line') {
        const teamId = btn.dataset.teamId;
        const sel = ui.qsa('[data-add-select]', host)
          .find(el => el.dataset.addSelect === teamId);
        const playerId = sel ? sel.value : '';
        if (!playerId) { ui.toast('Choose a player to add.', 'error'); return; }
        draft.stats.push(storage.blankStats(playerId, teamId));
        render(state);
      } else if (action === 'remove-line') {
        draft.stats = draft.stats.filter(s =>
          !(s.playerId === btn.dataset.playerId && s.teamId === btn.dataset.teamId));
        render(state);
      } else if (action === 'cancel-box') {
        editMode = false;
        draft = null;
        render(state);
      } else if (action === 'save-box') {
        const status = storage.STATUSES.indexOf(draft.status) >= 0 ? draft.status : game.status;
        /* Leave edit mode BEFORE commit: commit() re-renders every view. */
        editMode = false;
        TBS.app.commit(d => {
          const g = d.games.find(x => x.id === game.id);
          if (!g) return;
          g.stats = draft.stats.map(s => {
            const line = storage.blankStats(s.playerId, s.teamId);
            EDIT_FIELDS.forEach(f => { line[f] = Math.max(0, storage.num(s[f], 0)); });
            return line;
          });
          g.homeScore = draft.homeScore;
          g.awayScore = draft.awayScore;
          g.notes = draft.notes;
          g.status = status;
          if (status !== 'live') g.clockRunningSince = null;
        });
        draft = null;
        ui.toast('Box score saved.', 'success');
      }
    });
  }

  TBS.boxscores = { render: render, init: init, openGame: openGame };
})(window.TBS = window.TBS || {});
