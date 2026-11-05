/* =========================================================================
 * live.js — live scoring console.
 * Clock, quarters, one-tap player stats, manual score adjustments,
 * play-by-play with undo, live box score and game finalization.
 * All changes are persisted to localStorage on every play.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const storage = TBS.storage;
  const qs = ui.qs;

  let selectedGameId = null;
  let selectedTeamId = null;
  let selectedPlayerId = null;
  let timer = null;

  /* Play definitions: statDeltas are also used to undo a play exactly. */
  const PLAYS = {
    ft_make:  { label: 'FT made',    stats: { ftm: 1, fta: 1, pts: 1 }, score: 1, needsPlayer: true, group: 'scoring' },
    fg2_make: { label: '2PT made',   stats: { fgm: 1, fga: 1, pts: 2 }, score: 2, needsPlayer: true, group: 'scoring' },
    fg3_make: { label: '3PT made',   stats: { fgm: 1, fga: 1, tpm: 1, tpa: 1, pts: 3 }, score: 3, needsPlayer: true, group: 'scoring' },
    ft_miss:  { label: 'FT missed',  stats: { fta: 1 }, score: 0, needsPlayer: true, group: 'misses' },
    fg2_miss: { label: '2PT missed', stats: { fga: 1 }, score: 0, needsPlayer: true, group: 'misses' },
    fg3_miss: { label: '3PT missed', stats: { fga: 1, tpa: 1 }, score: 0, needsPlayer: true, group: 'misses' },
    reb:      { label: 'Rebound',    stats: { reb: 1 }, score: 0, needsPlayer: true, group: 'other' },
    ast:      { label: 'Assist',     stats: { ast: 1 }, score: 0, needsPlayer: true, group: 'other' },
    stl:      { label: 'Steal',      stats: { stl: 1 }, score: 0, needsPlayer: true, group: 'other' },
    blk:      { label: 'Block',      stats: { blk: 1 }, score: 0, needsPlayer: true, group: 'other' },
    tov:      { label: 'Turnover',   stats: { tov: 1 }, score: 0, needsPlayer: true, group: 'other' },
    pf:       { label: 'Foul',       stats: { pf: 1 }, score: 0, needsPlayer: true, group: 'other' },
    min:      { label: 'Minute',     stats: { min: 1 }, score: 0, needsPlayer: true, group: 'other' }
  };

  const PLAY_BUTTONS = [
    ['ft_make', 'FT', '+1 pt'],
    ['fg2_make', '2PT', '+2 pts'],
    ['fg3_make', '3PT', '+3 pts'],
    ['ft_miss', 'FT miss', '0 pts'],
    ['fg2_miss', '2PT miss', '0 pts'],
    ['fg3_miss', '3PT miss', '0 pts'],
    ['reb', 'REB', 'rebound'],
    ['ast', 'AST', 'assist'],
    ['stl', 'STL', 'steal'],
    ['blk', 'BLK', 'block'],
    ['tov', 'TOV', 'turnover'],
    ['pf', 'PF', 'foul'],
    ['min', 'MIN', 'minute played']
  ];

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function activeGame(state) {
    let game = state.games.find(g => g.id === selectedGameId);
    if (!game) {
      game = state.games.find(g => g.status === 'live') ||
        state.games.find(g => g.status === 'scheduled') ||
        state.games.slice().reverse().find(g => g.status === 'final') || null;
      selectedGameId = game ? game.id : null;
    }
    if (game && (!selectedTeamId || (game.homeTeamId !== selectedTeamId && game.awayTeamId !== selectedTeamId))) {
      selectedTeamId = game.homeTeamId;
      selectedPlayerId = null;
    }
    return game;
  }

  function remainingSeconds(game, now) {
    const base = Number(game.clockSeconds) || 0;
    if (!game.clockRunningSince) return base;
    return Math.max(0, base - ((now || Date.now()) - Number(game.clockRunningSince)) / 1000);
  }

  function ensureTimer(state) {
    const running = (state.games || []).some(g => g.status === 'live' && g.clockRunningSince);
    if (running && !timer) timer = setInterval(tick, 250);
    if (!running && timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    const state = TBS.app.getState();
    const game = state.games.find(g => g.status === 'live' && g.clockRunningSince);
    if (!game) { ensureTimer(state); return; }
    const left = remainingSeconds(game);
    const el = qs('#live-clock');
    if (el) el.textContent = ui.fmtClock(left);
    if (left <= 0) {
      TBS.app.commit(d => {
        const g = d.games.find(x => x.id === game.id);
        if (g) { g.clockSeconds = 0; g.clockRunningSince = null; }
      });
      ui.toast('Quarter clock reached 0:00. Advance to the next quarter.', 'info');
      ensureTimer(TBS.app.getState());
    }
  }

  function toggleClock(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.clockRunningSince) {
        g.clockSeconds = Math.ceil(remainingSeconds(g));
        g.clockRunningSince = null;
      } else {
        if (g.clockSeconds <= 0) { ui.toast('Clock is at 0:00 — advance the quarter first.', 'error'); return; }
        g.clockRunningSince = Date.now();
      }
    });
  }

  function nextQuarter(gameId, leagueQuarters) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.quarter >= d.league.quarters) {
        ui.toast('Already in the final quarter — finalize the game instead.', 'error');
        return;
      }
      g.quarter += 1;
      g.clockSeconds = d.league.quarterMinutes * 60;
      g.clockRunningSince = null;
    });
  }

  function resetClock(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      g.clockSeconds = d.league.quarterMinutes * 60;
      g.clockRunningSince = null;
    });
  }

  function setStatus(gameId, status) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.clockRunningSince) {
        g.clockSeconds = Math.ceil(remainingSeconds(g));
        g.clockRunningSince = null;
      }
      g.status = status;
      if (status === 'final') g.clockSeconds = 0;
      if (status === 'live' && g.quarter < 1) g.quarter = 1;
      if (status === 'scheduled') {
        g.quarter = 1;
        g.clockSeconds = d.league.quarterMinutes * 60;
      }
    });
  }

  function manualScore(gameId, teamId, delta) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      const key = teamId === g.homeTeamId ? 'homeScore' : (teamId === g.awayTeamId ? 'awayScore' : null);
      if (!key) return;
      g[key] = Math.max(0, (Number(g[key]) || 0) + delta);
      g.events.push({
        id: storage.uid('event'), type: 'manual',
        label: (delta > 0 ? '+' : '') + delta + ' ' + teamName(d, teamId) + ' (manual)',
        teamId: teamId, playerId: '', statDeltas: {}, scoreDelta: delta,
        quarter: g.quarter, clockSeconds: Math.ceil(remainingSeconds(g)),
        ts: Date.now()
      });
    });
  }

  function applyPlay(gameId, playKey, teamId, playerId) {
    const def = PLAYS[playKey];
    if (!def) return;
    if (def.needsPlayer && !playerId) {
      ui.toast('Select a player first (tap a name in the roster strip).', 'error');
      return;
    }
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      let line = g.stats.find(s => s.playerId === playerId);
      if (!line) {
        line = storage.blankStats(playerId, teamId);
        g.stats.push(line);
      }
      if (line.teamId !== teamId) line.teamId = teamId;
      Object.keys(def.stats).forEach(k => {
        line[k] = Math.max(0, (Number(line[k]) || 0) + def.stats[k]);
      });
      if (def.score) {
        const key = teamId === g.homeTeamId ? 'homeScore' : (teamId === g.awayTeamId ? 'awayScore' : null);
        if (key) g[key] = Math.max(0, (Number(g[key]) || 0) + def.score);
      }
      const player = d.players.find(p => p.id === playerId);
      g.events.push({
        id: storage.uid('event'), type: playKey,
        label: (player ? player.name : 'Player') + ' — ' + def.label,
        teamId: teamId, playerId: playerId,
        statDeltas: Object.assign({}, def.stats),
        scoreDelta: def.score || 0,
        quarter: g.quarter, clockSeconds: Math.ceil(remainingSeconds(g)),
        ts: Date.now()
      });
    });
  }

  function undoLast(gameId) {
    const state = TBS.app.getState();
    const game = state.games.find(g => g.id === gameId);
    if (!game || !game.events.length) { ui.toast('Nothing to undo.', 'error'); return; }
    const last = game.events[game.events.length - 1];
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g || !g.events.length) return;
      const e = g.events.pop();
      if (e.playerId) {
        const line = g.stats.find(s => s.playerId === e.playerId);
        if (line) {
          Object.keys(e.statDeltas || {}).forEach(k => {
            line[k] = Math.max(0, (Number(line[k]) || 0) - Number(e.statDeltas[k] || 0));
          });
        }
      }
      if (e.scoreDelta) {
        const key = e.teamId === g.homeTeamId ? 'homeScore' : (e.teamId === g.awayTeamId ? 'awayScore' : null);
        if (key) g[key] = Math.max(0, (Number(g[key]) || 0) - Number(e.scoreDelta));
      }
    });
    ui.toast('Undid: ' + last.label, 'success');
  }

  function compactBox(game, state) {
    const box = st.gameBox(game, state.players, state.teams, state.league);
    const cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TOV'];
    function row(r) {
      const s = r.stats;
      return '<tr><td>' + ui.esc(r.player.number) + ' ' + ui.esc(r.player.name) + '</td>' +
        '<td class="align-right">' + s.pts + '</td><td class="align-right">' + s.reb + '</td>' +
        '<td class="align-right">' + s.ast + '</td><td class="align-right">' + s.stl + '</td>' +
        '<td class="align-right">' + s.blk + '</td><td class="align-right">' + s.fgm + '/' + s.fga + '</td>' +
        '<td class="align-right">' + s.tpm + '/' + s.tpa + '</td><td class="align-right">' + s.ftm + '/' + s.fta + '</td>' +
        '<td class="align-right">' + s.tov + '</td></tr>';
    }
    function side(s) {
      const t = s.totals;
      const foot = '<tfoot><tr><td><strong>Totals</strong></td>' +
        '<td class="align-right">' + t.pts + '</td><td class="align-right">' + t.reb + '</td>' +
        '<td class="align-right">' + t.ast + '</td><td class="align-right">' + t.stl + '</td>' +
        '<td class="align-right">' + t.blk + '</td><td class="align-right">' + t.fgm + '/' + t.fga + '</td>' +
        '<td class="align-right">' + t.tpm + '/' + t.tpa + '</td><td class="align-right">' + t.ftm + '/' + t.fta + '</td>' +
        '<td class="align-right">' + t.tov + '</td></tr></tfoot>';
      return '<div class="box-section-title"><h3>' + ui.esc(s.team.name) + '</h3>' +
        '<span class="score-tag">' + s.score + '</span></div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Player</th>' +
        cols.map(c => '<th class="align-right">' + c + '</th>').join('') +
        '</tr></thead><tbody>' +
        (s.rows.length ? s.rows.map(row).join('') :
          '<tr><td class="empty-cell" colspan="10">No plays recorded for this team yet.</td></tr>') +
        '</tbody>' + foot + '</table></div>';
    }
    return '<div class="live-box">' + side(box.home) + side(box.away) + '</div>';
  }

  function render(state) {
    const select = qs('#live-game-select');
    const sorted = state.games.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time))
    );
    select.innerHTML = ui.gameOptions(sorted, state.teams, selectedGameId,
      state.games.length ? '' : '— no games yet —');
    const game = activeGame(state);
    if (selectedGameId) select.value = selectedGameId;
    ensureTimer(state);

    const host = qs('#live-console');
    if (!game) {
      host.innerHTML = ui.emptyState('No games yet',
        'Create a fixture in the Schedule tab or add a quick game here, then score it live.',
        '<button type="button" class="btn btn-primary" data-action="new-game">+ Create a game</button> ' +
        '<button type="button" class="btn btn-ghost" data-action="go-schedule">Go to Schedule</button>');
      return;
    }

    const canScore = game.status === 'live';
    const running = !!game.clockRunningSince;
    const left = remainingSeconds(game);
    const homeName = teamName(state, game.homeTeamId);
    const awayName = teamName(state, game.awayTeamId);
    const roster = state.players
      .filter(p => p.teamId === selectedTeamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
    if (selectedPlayerId && !roster.some(p => p.id === selectedPlayerId)) selectedPlayerId = null;

    const scoreCard = (teamId, name, score, side) =>
      '<div class="score-team' + (teamId === selectedTeamId ? ' selected' : '') +
        '" data-action="select-team" data-team="' + ui.esc(teamId) + '" role="button" tabindex="0">' +
        '<div class="team-label">' + side + '</div><div class="team-name">' + ui.esc(name) + '</div>' +
        '<div class="score-value">' + ui.fmtInt(score) + '</div>' +
        '<div class="score-adjust">' +
          [1, 2, 3, -1].map(d =>
            '<button type="button" class="btn btn-mini" data-action="manual-score" data-team="' +
            ui.esc(teamId) + '" data-delta="' + d + '">' + (d > 0 ? '+' : '') + d + '</button>').join('') +
        '</div></div>';

    const playButtons = PLAY_BUTTONS.map(([key, label, hint]) =>
      '<button type="button" class="stat-btn' + (PLAYS[key].score ? ' score' : '') +
        '" data-action="play" data-play="' + key + '"' + (canScore ? '' : ' disabled') + '>' +
        ui.esc(label) + '<small>' + ui.esc(hint) + '</small></button>').join('');

    const log = game.events.slice(-12).reverse().map(e =>
      '<div class="play-item"><span>' + ui.esc(e.label) + '</span>' +
      '<span class="play-time">Q' + e.quarter + ' ' + ui.fmtClock(e.clockSeconds) + '</span></div>').join('');

    host.innerHTML =
      '<div class="box-header">' +
        '<div class="box-meta">' + ui.statusBadge(game.status) +
          ' · ' + ui.fmtDate(game.date) + (game.time ? ' ' + ui.fmtTime(game.time) : '') +
          (game.location ? ' · ' + ui.esc(game.location) : '') +
          (game.notes ? ' · ' + ui.esc(game.notes) : '') + '</div>' +
        '<div class="matchup"><span class="side">' + ui.esc(awayName) + '</span>' +
          '<span class="final-score">' + ui.fmtInt(game.homeScore) + '–' + ui.fmtInt(game.awayScore) + '</span>' +
          '<span class="side">' + ui.esc(homeName) + '</span></div>' +
        '<div class="box-meta">Home score shown first · ' +
          (game.status === 'final' ? 'Final — reopen to keep editing' :
            game.status === 'scheduled' ? 'Not started yet' : 'Live scoring in progress') + '</div>' +
      '</div>' +

      '<div class="scoreboard">' +
        scoreCard(game.homeTeamId, homeName, game.homeScore, 'HOME') +
        '<div class="clock-box">' +
          '<div class="quarter" id="live-clock-quarter">Quarter ' + game.quarter + ' / ' + state.league.quarters + '</div>' +
          '<div class="clock' + (running ? ' running' : '') + '" id="live-clock">' + ui.fmtClock(left) + '</div>' +
          '<div class="clock-actions">' +
            '<button type="button" class="btn btn-mini" data-action="toggle-clock"' + (canScore ? '' : ' disabled') + '>' +
              (running ? '⏸ Pause' : '▶ Start') + ' clock</button>' +
            '<button type="button" class="btn btn-mini" data-action="next-quarter"' + (canScore ? '' : ' disabled') + '>Next Q</button>' +
            '<button type="button" class="btn btn-mini" data-action="reset-clock"' + (canScore ? '' : ' disabled') + '>Reset</button>' +
          '</div>' +
        '</div>' +
        scoreCard(game.awayTeamId, awayName, game.awayScore, 'AWAY') +
      '</div>' +

      '<div class="console-grid">' +
        '<div class="console-panel">' +
          '<h3>Record a play</h3>' +
          '<p class="panel-note">Scoring for: <strong>' + ui.esc(teamName(state, selectedTeamId)) + '</strong>' +
            ' — click a team score above to switch sides.</p>' +
          '<div class="roster-strip">' +
            (roster.length ? roster.map(p =>
              '<button type="button" class="roster-chip' + (p.id === selectedPlayerId ? ' selected' : '') +
                '" data-action="select-player" data-id="' + ui.esc(p.id) + '">#' + ui.esc(p.number) + ' ' +
                ui.esc(p.name) + '</button>').join('') :
              '<span class="muted">No active players on this team — add them in Teams &amp; Roster.</span>') +
          '</div>' +
          '<div class="stat-grid">' + playButtons + '</div>' +
          '<div class="console-actions">' +
            '<button type="button" class="btn btn-ghost" data-action="undo"' +
              (canScore && game.events.length ? '' : ' disabled') + '>↶ Undo last play</button>' +
            (game.status === 'scheduled'
              ? '<button type="button" class="btn btn-primary" data-action="start-game">Start game</button>'
              : '') +
            (game.status === 'live'
              ? '<button type="button" class="btn btn-primary" data-action="finalize">Finalize game</button>'
              : '') +
            (game.status === 'final'
              ? '<button type="button" class="btn btn-ghost" data-action="reopen">Reopen for edits</button>'
              : '') +
            '<button type="button" class="btn btn-ghost" data-action="edit-box">Edit box score</button>' +
          '</div>' +
          '<p class="console-status">' +
            (canScore ? 'Every tap is saved instantly. ' + game.events.length + ' plays logged.' :
              game.status === 'scheduled' ? 'Start the game to enable scoring.' :
                'This game is final. Reopen it to add plays, or edit the box score directly.') +
          '</p>' +
        '</div>' +
        '<div class="console-panel">' +
          '<h3>Play-by-play</h3><p class="panel-note">Most recent first · undo reverses stats and score exactly.</p>' +
          '<div class="play-log">' + (log || '<p class="muted">No plays recorded yet.</p>') + '</div>' +
        '</div>' +
      '</div>' +
      compactBox(game, state);
  }

  function newGameModal(state) {
    const primaryId = state.league.primaryTeamId;
    const others = state.teams.filter(t => t.id !== primaryId);
    const awayOptions = state.teams.map(t => ({ value: t.id, label: t.name }));
    if (!others.length) awayOptions.unshift({ value: '', label: '— create a new opponent below —' });
    ui.openModal({
      title: 'Quick create a game',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: storage.todayISO(), required: true },
        { name: 'time', label: 'Time', type: 'time', value: '' },
        { name: 'homeTeamId', label: 'Home team', type: 'select', value: primaryId,
          options: state.teams.map(t => ({ value: t.id, label: t.name })) },
        { name: 'awayTeamId', label: 'Away team', type: 'select', value: others.length ? others[0].id : '',
          options: awayOptions },
        { name: 'newOpponent', label: 'New opponent name', type: 'text', value: '',
          placeholder: 'e.g. Lakeside Lions',
          help: others.length
            ? 'Optional: type a name to create a new opponent instead of choosing one.'
            : 'You only have one team — type a name to create an opponent automatically.' },
        { name: 'location', label: 'Location', type: 'text', value: '' }
      ],
      onSubmit: (values, close) => {
        let awayTeamId = values.awayTeamId;
        let newTeam = null;
        if (!awayTeamId || awayTeamId === values.homeTeamId) {
          const name = String(values.newOpponent || '').trim();
          if (!name) {
            ui.toast('Pick two different teams, or type a new opponent name.', 'error');
            return;
          }
          const existing = state.teams.find(t =>
            t.name.trim().toLowerCase() === name.toLowerCase() && t.id !== values.homeTeamId);
          if (existing) {
            awayTeamId = existing.id;
          } else {
            newTeam = {
              id: storage.uid('team'), name: name,
              short: name.slice(0, 3).toUpperCase(), primary: false
            };
            awayTeamId = newTeam.id;
          }
        }
        const id = storage.uid('game');
        TBS.app.commit(d => {
          if (newTeam && !d.teams.some(t => t.id === newTeam.id)) d.teams.push(newTeam);
          d.games.push({
            id: id, date: values.date, time: values.time,
            location: values.location.trim(), status: 'scheduled',
            homeTeamId: values.homeTeamId, awayTeamId: awayTeamId,
            homeScore: 0, awayScore: 0, quarter: 1,
            clockSeconds: d.league.quarterMinutes * 60, clockRunningSince: null,
            stats: [], events: [], notes: '', createdAt: new Date().toISOString()
          });
        });
        openGame(id);
        close();
        ui.toast('Game created. Press “Start game” when ready.', 'success');
      }
    });
  }

  function openGame(id) {
    selectedGameId = id;
    selectedTeamId = null;
    selectedPlayerId = null;
    const select = qs('#live-game-select');
    if (select && Array.from(select.options).some(o => o.value === id)) select.value = id;
    if (TBS.app.activeTab && TBS.app.activeTab() === 'live') render(TBS.app.getState());
  }

  function init() {
    qs('#live-game-select').addEventListener('change', e => {
      openGame(e.target.value);
      render(TBS.app.getState());
    });
    qs('#live-add-game').addEventListener('click', () => newGameModal(TBS.app.getState()));
    qs('#live-console').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const state = TBS.app.getState();
      const game = activeGame(state);
      const action = btn.dataset.action;

      if (action === 'new-game') { newGameModal(state); return; }
      if (action === 'go-schedule') { TBS.app.go('schedule'); return; }
      if (!game) return;

      switch (action) {
        case 'select-team':
          if (btn.dataset.team !== selectedTeamId) {
            selectedTeamId = btn.dataset.team;
            selectedPlayerId = null;
            render(state);
          }
          break;
        case 'select-player':
          selectedPlayerId = btn.dataset.id;
          render(state);
          break;
        case 'manual-score':
          if (game.status !== 'live') { ui.toast('Start or reopen the game first.', 'error'); return; }
          manualScore(game.id, btn.dataset.team, Number(btn.dataset.delta));
          break;
        case 'play':
          if (game.status !== 'live') { ui.toast('Start or reopen the game first.', 'error'); return; }
          applyPlay(game.id, btn.dataset.play, selectedTeamId, selectedPlayerId);
          break;
        case 'toggle-clock': toggleClock(game.id); break;
        case 'next-quarter': nextQuarter(game.id, state.league.quarters); break;
        case 'reset-clock': resetClock(game.id); break;
        case 'undo': undoLast(game.id); break;
        case 'start-game':
          setStatus(game.id, 'scheduled');
          setStatus(game.id, 'live');
          ui.toast('Game is live. Start the clock when play begins.', 'success');
          break;
        case 'finalize':
          setStatus(game.id, 'final');
          ui.toast('Game finalized — it now counts in standings and stats.', 'success');
          break;
        case 'reopen': setStatus(game.id, 'live'); break;
        case 'edit-box':
          TBS.boxscores.openGame(game.id);
          TBS.app.go('boxscores');
          break;
      }
    });
  }

  TBS.live = { render: render, init: init, openGame: openGame };
})(window.TBS = window.TBS || {});
