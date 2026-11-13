/* =========================================================================
 * live.js — live scoring console.
 *
 * Two entry modes (device preference, bball_tm_entry_v1):
 *   • Two-tap (default): TAP 1 pick a stat (+1/+2/+3, misses, rebounds,
 *     assists, steals, blocks, turnovers, fouls), TAP 2 pick the jersey
 *     number. The play is recorded instantly. Opponent entries are team
 *     aggregates, so only one target is shown for them.
 *   • Classic: player first, then the stat (the original flow).
 *
 * Clock + quarters, halftime, team fouls, manual score corrections, shot
 * spots, on-court lineup, play-by-play filters, exact undo and finalize.
 * Every change goes through TBS.plays (js/plays.js) and is persisted with
 * TBS.app.commit, so classic, two-tap and shortcuts behave identically.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;
  const pl = TBS.plays;
  const storage = TBS.storage;
  const qs = ui.qs;

  const MODE_KEY = 'bball_tm_entry_v1';

  let selectedGameId = null;
  let selectedTeamId = null;
  let selectedPlayerId = null;
  let pendingShot = null;
  let pendingStat = null;   /* two-tap: the stat waiting for a jersey tap */
  let lastRecorded = '';    /* two-tap: confirmation line for screen readers */
  let pbpFilter = 'all';
  let pbpLimit = '25';
  let timer = null;

  /* Two-tap stat palette (step 1). `key` is a play in TBS.plays.PLAYS. */
  const TWO_TAP = [
    { key: 'ft_make', label: '+1', hint: 'FT made', tone: 'score' },
    { key: 'fg2_make', label: '+2', hint: '2PT made', tone: 'score' },
    { key: 'fg3_make', label: '+3', hint: '3PT made', tone: 'score' },
    { key: 'ft_miss', label: 'Miss FT', hint: '', tone: 'miss' },
    { key: 'fg2_miss', label: 'Miss 2', hint: '', tone: 'miss' },
    { key: 'fg3_miss', label: 'Miss 3', hint: '', tone: 'miss' },
    { key: 'oreb', label: 'OREB', hint: 'offensive', tone: 'other' },
    { key: 'dreb', label: 'DREB', hint: 'defensive', tone: 'other' },
    { key: 'ast', label: 'AST', hint: 'assist', tone: 'other' },
    { key: 'stl', label: 'STL', hint: 'steal', tone: 'other' },
    { key: 'blk', label: 'BLK', hint: 'block', tone: 'other' },
    { key: 'tov', label: 'TOV', hint: 'turnover', tone: 'other' },
    { key: 'pf', label: 'FOUL', hint: 'personal', tone: 'other' }
  ];

  /* Classic stat buttons (player first). */
  const PLAY_BUTTONS = [
    ['ft_make', 'FT', 'FT made'],
    ['fg2_make', '2PT', '2PT made'],
    ['fg3_make', '3PT', '3PT made'],
    ['ft_miss', 'FT miss', 'attempt'],
    ['fg2_miss', '2PT miss', 'attempt'],
    ['fg3_miss', '3PT miss', 'attempt'],
    ['oreb', 'OREB', 'offensive reb'],
    ['dreb', 'DREB', 'defensive reb'],
    ['ast', 'AST', 'assist'],
    ['stl', 'STL', 'steal'],
    ['blk', 'BLK', 'block'],
    ['tov', 'TOV', 'turnover'],
    ['pf', 'PF', 'foul'],
    ['min', 'MIN', 'minute']
  ];

  const PBP_FILTERS = [
    { value: 'all', label: 'All plays' },
    { value: 'scoring', label: 'Scoring plays' },
    { value: 'misses', label: 'Missed shots' },
    { value: 'other', label: 'Rebounds, fouls & other' },
    { value: 'home', label: 'Home team only' },
    { value: 'away', label: 'Away team only' }
  ];

  const PHASE_LABEL = { pregame: 'PRE-GAME', live: 'LIVE', halftime: 'HALFTIME', final: 'FINAL' };

  function entryMode() {
    try {
      return localStorage.getItem(MODE_KEY) === 'classic' ? 'classic' : 'twotap';
    } catch (_) { return 'twotap'; }
  }

  function setEntryMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode === 'classic' ? 'classic' : 'twotap'); } catch (_) { /* private mode */ }
    pendingStat = null;
  }

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  /* The "our team" side: a team account's club, else the league's primary
   * team when it plays in this game, else the home side. */
  function ourTeamId(state, game) {
    if (!game) return null;
    const mine = TBS.auth && TBS.auth.role && TBS.auth.role() === 'team' ? TBS.auth.myTeamId() : null;
    if (mine && (mine === game.homeTeamId || mine === game.awayTeamId)) return mine;
    const primary = state.league.primaryTeamId;
    if (primary && (primary === game.homeTeamId || primary === game.awayTeamId)) return primary;
    return game.homeTeamId;
  }

  function activeGame(state) {
    let game = scopedGames(state).find(g => g.id === selectedGameId);
    if (!game) {
      game = state.games.find(g => g.status === 'live') ||
        state.games.find(g => g.status === 'scheduled') ||
        st.sortByDateDesc(state.games.filter(g => g.status === 'final'))[0] || null;
      selectedGameId = game ? game.id : null;
    }
    if (game && (!selectedTeamId || (game.homeTeamId !== selectedTeamId && game.awayTeamId !== selectedTeamId))) {
      selectedTeamId = ourTeamId(state, game);
      selectedPlayerId = null;
    }
    return game;
  }

  function sideOf(game, teamId) {
    return pl.sideOf(game, teamId);
  }

  function remainingSeconds(game, now) {
    const base = Number(game.clockSeconds) || 0;
    if (!game.clockRunningSince) return base;
    return Math.max(0, base - ((now || Date.now()) - Number(game.clockRunningSince)) / 1000);
  }

  function ensureTimer(state) {
    const running = (state.games || []).some(g => g.status === 'live' && !g.halftime && g.clockRunningSince);
    if (running && !timer) timer = setInterval(tick, 250);
    if (!running && timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    const state = TBS.app.getState();
    const game = state.games.find(g => g.status === 'live' && !g.halftime && g.clockRunningSince);
    if (!game) { ensureTimer(state); return; }
    const left = remainingSeconds(game);
    const el = qs('#live-clock');
    if (el) el.textContent = ui.fmtClock(left);
    const shotLeft = TBS.plays.shotRemaining(game, TBS.app.getState().league);
    const shotEl = qs('#live-shot-clock');
    if (shotEl && shotLeft !== null) shotEl.textContent = String(Math.ceil(shotLeft));
    if (shotLeft !== null && shotLeft <= 0 && game.shotRunningSince) {
      TBS.app.commit(d => {
        const g = d.games.find(x => x.id === game.id);
        if (g) TBS.plays.freezeShot(g, d.league);
      });
      ui.toast('Shot clock expired. Reset it when possession changes.', 'error');
    }
    if (left <= 0) {
      TBS.app.commit(d => {
        const g = d.games.find(x => x.id === game.id);
        if (g) { TBS.plays.freezeShot(g, d.league); g.clockSeconds = 0; g.clockRunningSince = null; }
      });
      ui.toast('Quarter clock reached 0:00. Advance to the next quarter.', 'info');
      ensureTimer(TBS.app.getState());
    }
  }

  function toggleClock(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.halftime) { ui.toast('Resume the second half before starting the clock.', 'error'); return; }
      if (g.clockRunningSince) {
        g.clockSeconds = Math.ceil(remainingSeconds(g));
        TBS.plays.freezeShot(g, d.league);
        g.clockRunningSince = null;
      } else {
        if (g.clockSeconds <= 0) { ui.toast('Clock is at 0:00 — advance the quarter first.', 'error'); return; }
        g.clockRunningSince = Date.now();
        if (TBS.plays.shotFull(d.league) && TBS.plays.shotRemaining(g, d.league) > 0) g.shotRunningSince = g.clockRunningSince;
      }
    });
  }

  function nextQuarter(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.quarter >= d.league.quarters) {
        ui.toast('Already in the final quarter — finalize the game instead.', 'error');
        return;
      }
      g.quarter += 1;
      g.halftime = false;
      g.clockSeconds = d.league.quarterMinutes * 60;
      TBS.plays.freezeShot(g, d.league);
      g.clockRunningSince = null;
      TBS.plays.resetShot(g, d.league, null, false);
    });
  }

  function resetShotClock(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g || !TBS.plays.shotFull(d.league)) return;
      TBS.plays.freezeShot(g, d.league);
      TBS.plays.resetShot(g, d.league, Date.now(), !!g.clockRunningSince);
    });
  }

  function resetClock(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      g.clockSeconds = d.league.quarterMinutes * 60;
      TBS.plays.freezeShot(g, d.league);
      g.clockRunningSince = null;
    });
  }

  /* Halftime pauses the clock and scoring. Resuming starts the next quarter
   * with a full clock (or stays on the current quarter at the last one). */
  function startHalftime(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g || g.status !== 'live') return;
      if (g.clockRunningSince) {
        g.clockSeconds = Math.ceil(remainingSeconds(g));
        TBS.plays.freezeShot(g, d.league);
        g.clockRunningSince = null;
      }
      g.halftime = true;
    });
    ui.toast('Halftime. Scoring is paused until you resume.', 'info');
  }

  function resumeFromHalftime(gameId) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g || !g.halftime) return;
      g.halftime = false;
      if (g.quarter < d.league.quarters) g.quarter += 1;
      g.clockSeconds = d.league.quarterMinutes * 60;
      TBS.plays.freezeShot(g, d.league);
      g.clockRunningSince = null;
      TBS.plays.resetShot(g, d.league, null, false);
    });
    ui.toast('Back on the floor. Start the clock when play resumes.', 'success');
  }

  function setStatus(gameId, status) {
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      if (g.clockRunningSince) {
        g.clockSeconds = Math.ceil(remainingSeconds(g));
        TBS.plays.freezeShot(g, d.league);
        g.clockRunningSince = null;
      }
      g.status = status;
      g.halftime = false;
      if (status === 'final') g.clockSeconds = 0;
      if (status === 'live' && g.quarter < 1) g.quarter = 1;
      if (status === 'scheduled') {
        g.quarter = 1;
        g.clockSeconds = d.league.quarterMinutes * 60;
      }
    });
  }

  function manualScore(gameId, teamId, delta) {
    const state = TBS.app.getState();
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      pl.manualScore(g, teamId, delta, {
        teamName: teamName(state, teamId),
        clockSeconds: remainingSeconds(g)
      });
    });
  }

  /* One recorded play. playerId '' + opponent team = aggregate entry. */
  function applyPlay(gameId, playKey, teamId, playerId) {
    const def = pl.PLAYS[playKey];
    if (!def) return false;
    const state = TBS.app.getState();
    const game = state.games.find(g => g.id === gameId);
    if (!game) return false;
    const ours = teamId === ourTeamId(state, game);
    if (!playerId && ours) {
      ui.toast('Pick a jersey number first — the play needs a player on your team.', 'error');
      return false;
    }
    const shot = pl.SHOT_PLAYS[playKey] && pendingShot ? Object.assign({}, pendingShot) : null;
    let label = '';
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      const event = pl.applyPlay(g, {
        playKey: playKey,
        teamId: teamId,
        playerId: playerId,
        shot: shot,
        players: d.players,
        teams: d.teams,
        clockSeconds: remainingSeconds(g)
      });
      if (event) label = event.label;
    });
    if (shot) pendingShot = null;
    lastRecorded = label;
    return !!label;
  }

  /* Substitute a player in or out; the lineup is stored on the game and the
   * event powers lineup-based minutes and the +/− calculation. */
  function toggleOnCourt(gameId, playerId) {
    const state = TBS.app.getState();
    const game = state.games.find(g => g.id === gameId);
    const player = state.players.find(p => p.id === playerId);
    if (!game || !player) return;
    const side = sideOf(game, player.teamId);
    if (!side) { ui.toast('That player’s team is not in this game.', 'error'); return; }
    const list = (game.lineup && game.lineup[side]) || [];
    const onCourt = list.indexOf(playerId) >= 0;
    if (!onCourt && list.length >= 5 &&
      !ui.confirmDanger('You already have five players on court. Add a sixth anyway?')) return;
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      pl.setOnCourt(g, player.teamId, playerId, !onCourt, {
        player: player,
        clockSeconds: remainingSeconds(g)
      });
    });
  }

  function undoLast(gameId) {
    const state = TBS.app.getState();
    const game = state.games.find(g => g.id === gameId);
    if (!game || !game.events.length) { ui.toast('Nothing to undo.', 'error'); return; }
    let removed = null;
    TBS.app.commit(d => {
      const g = d.games.find(x => x.id === gameId);
      if (!g) return;
      removed = pl.undoLast(g);
    });
    if (removed) ui.toast('Undid: ' + removed.label, 'success');
  }

  function compactBox(game, state) {
    const box = st.gameBox(game, state.players, state.teams, state.league);
    const cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3PT', 'FT', 'TOV'];
    function row(r) {
      const s = r.stats;
      const team = teamOf(state, r.player.teamId);
      return '<tr><td>' + ui.playerCell(r.player, { team: team, size: 'sm' }) + '</td>' +
        '<td class="align-right">' + s.pts + '</td><td class="align-right">' + s.reb + '</td>' +
        '<td class="align-right">' + s.ast + '</td><td class="align-right">' + s.stl + '</td>' +
        '<td class="align-right">' + s.blk + '</td><td class="align-right">' + s.fgm + '/' + s.fga + '</td>' +
        '<td class="align-right">' + s.tpm + '/' + s.tpa + '</td><td class="align-right">' + s.ftm + '/' + s.fta + '</td>' +
        '<td class="align-right">' + s.tov + '</td></tr>';
    }
    function aggRow(a) {
      return '<tr class="aggregate-row"><td><em>Team totals (no roster)</em></td>' +
        '<td class="align-right">' + a.pts + '</td><td class="align-right">' + a.reb + '</td>' +
        '<td class="align-right">' + a.ast + '</td><td class="align-right">' + a.stl + '</td>' +
        '<td class="align-right">' + a.blk + '</td><td class="align-right">' + a.fgm + '/' + a.fga + '</td>' +
        '<td class="align-right">' + a.tpm + '/' + a.tpa + '</td><td class="align-right">' + a.ftm + '/' + a.fta + '</td>' +
        '<td class="align-right">' + a.tov + '</td></tr>';
    }
    function side(s) {
      const t = s.totals;
      const foot = '<tfoot><tr><td><strong>Totals</strong></td>' +
        '<td class="align-right">' + t.pts + '</td><td class="align-right">' + t.reb + '</td>' +
        '<td class="align-right">' + t.ast + '</td><td class="align-right">' + t.stl + '</td>' +
        '<td class="align-right">' + t.blk + '</td><td class="align-right">' + t.fgm + '/' + t.fga + '</td>' +
        '<td class="align-right">' + t.tpm + '/' + t.tpa + '</td><td class="align-right">' + t.ftm + '/' + t.fta + '</td>' +
        '<td class="align-right">' + t.tov + '</td></tr></tfoot>';
      const body = (s.rows.length ? s.rows.map(row).join('') :
        (s.aggregate ? '' : '<tr><td class="empty-cell" colspan="10">No plays recorded for this team yet.</td></tr>')) +
        (s.aggregate ? aggRow(s.aggregate) : '');
      return '<div class="box-section-title"><h3>' + ui.esc(s.team.name) + '</h3>' +
        '<span class="score-tag">' + s.score + '</span></div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Player</th>' +
        cols.map(c => '<th class="align-right">' + c + '</th>').join('') +
        '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
    }
    return '<div class="live-box">' + side(box.home) + side(box.away) + '</div>';
  }

  /* Filter + trim the play-by-play log. */
  function filteredEvents(game) {
    const list = (game.events || []).slice().reverse();
    const filtered = list.filter(e => {
      if (pbpFilter === 'all') return true;
      if (pbpFilter === 'scoring') return Number(e.scoreDelta) > 0;
      if (pbpFilter === 'misses') return /_miss$/.test(String(e.type || ''));
      if (pbpFilter === 'other') return !Number(e.scoreDelta) && !/_miss$/.test(String(e.type || ''));
      if (pbpFilter === 'home') return e.teamId === game.homeTeamId;
      if (pbpFilter === 'away') return e.teamId === game.awayTeamId;
      return true;
    });
    return pbpLimit === 'all' ? filtered : filtered.slice(0, Number(pbpLimit) || 25);
  }

  function pbpHtml(game, state) {
    const events = filteredEvents(game);
    if (!events.length) {
      return '<p class="muted">' + (game.events.length
        ? 'No plays match this filter.'
        : 'No plays recorded yet. Tap a stat to start the log.') + '</p>';
    }
    return events.map(e => {
      const player = e.playerId ? state.players.find(p => p.id === e.playerId) : null;
      const team = teamOf(state, e.teamId);
      const sub = e.type === 'sub_in' || e.type === 'sub_out';
      return '<div class="play-item' + (sub ? ' play-sub' : '') + (Number(e.scoreDelta) > 0 ? ' play-score' : '') + '">' +
        (player ? ui.avatar(player, { size: 'sm', team: team, showNumber: false }) : '') +
        '<span class="play-label">' + ui.esc(e.label) + '</span>' +
        '<span class="play-time">Q' + e.quarter + ' ' + ui.fmtClock(e.clockSeconds) +
          (e.shot ? ' · 📍' : '') + '</span>' +
        '</div>';
    }).join('');
  }

  function drawShotSpot(game) {
    const canvas = qs('#shot-spot');
    if (!canvas || !TBS.shotchart) return;
    const team = teamOf(TBS.app.getState(), selectedTeamId);
    const shots = pendingShot ? [{ x: pendingShot.x, y: pendingShot.y, made: true }] : [];
    TBS.shotchart.drawShots(canvas, shots, { color: (team && team.color) || '#d4a017' });
    const label = qs('#shot-spot-label');
    if (label) {
      if (!pendingShot) label.textContent = 'None — tap the court to mark the next shot.';
      else {
        const zone = an.zoneOf(pendingShot, false);
        const dist = an.shotDistanceFt(pendingShot);
        label.textContent = zone + ' · ' + Math.round(dist) + ' ft from the rim (cleared after the next shot play).';
      }
    }
    const clear = qs('#shot-clear');
    if (clear) clear.disabled = !pendingShot;
  }

  /* Team accounts only score their own games. */
  function scopedGames(state) {
    const a = TBS.auth;
    if (!a || a.canManageLeague()) return state.games;
    const myId = a.myTeamId();
    return state.games.filter(g => g.homeTeamId === myId || g.awayTeamId === myId);
  }

  function teamFoulBadge(game, teamId) {
    const f = pl.teamFoulSummary(game, teamId);
    return '<div class="team-fouls' + (f.bonus ? ' is-bonus' : '') + '">' +
      'Team fouls Q' + f.quarter + ': <strong>' + f.inQuarter + '</strong>' +
      ' · game ' + f.total +
      (f.bonus ? ' <span class="bonus-pill">BONUS</span>' : '') + '</div>';
  }

  function phaseLabel(game) {
    const phase = pl.phaseOf(game);
    if (phase === 'live') return 'LIVE · Q' + game.quarter;
    return PHASE_LABEL[phase];
  }

  function rosterOf(state, teamId) {
    return state.players
      .filter(p => p.teamId === teamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
  }

  function render(state) {
    const select = qs('#live-game-select');
    if (!select) return;
    const visible = scopedGames(state);
    const sorted = st.sortByDateDesc(visible);
    select.innerHTML = ui.gameOptions(sorted, state.teams, selectedGameId,
      visible.length ? '' : '— no games yet —');
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

    const phase = pl.phaseOf(game);
    const canScore = phase === 'live';
    const running = !!game.clockRunningSince && !game.halftime;
    const left = remainingSeconds(game);
    const shotLeft = TBS.plays.shotRemaining(game, state.league);
    const ours = ourTeamId(state, game);
    const oppId = ours === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const homeTeam = teamOf(state, game.homeTeamId);
    const awayTeam = teamOf(state, game.awayTeamId);
    const homeName = homeTeam ? homeTeam.name : 'Unknown team';
    const awayName = awayTeam ? awayTeam.name : 'Unknown team';
    const selIsOurs = selectedTeamId === ours;
    const side = sideOf(game, selectedTeamId) || 'home';
    const lineup = (game.lineup && game.lineup[side]) || [];
    const roster = rosterOf(state, selectedTeamId);
    if (selectedPlayerId && !roster.some(p => p.id === selectedPlayerId)) selectedPlayerId = null;
    const lineupMinutes = an.minutesFromLineup(game, state.league);
    const mode = entryMode();
    const teamLabel = ui.esc(teamName(state, selectedTeamId));

    const scoreCard = (team, teamId, score, label) =>
      '<div class="score-team' + (teamId === selectedTeamId ? ' selected' : '') + '"' +
        (team && team.color ? ' style="--team-color:' + ui.esc(team.color) + '"' : '') +
        ' data-action="select-team" data-team="' + ui.esc(teamId) + '" role="button" tabindex="0">' +
        '<div class="team-label">' + label + (teamId === ours ? ' · OUR TEAM' : ' · OPPONENT') + '</div>' +
        '<div class="team-name">' + ui.esc(team ? team.name : 'Unknown team') + '</div>' +
        '<div class="score-value">' + ui.fmtInt(score) + '</div>' +
        teamFoulBadge(game, teamId) +
        '<div class="score-adjust">' +
          [1, 2, 3, -1].map(d =>
            '<button type="button" class="btn btn-mini" data-action="manual-score" data-team="' +
            ui.esc(teamId) + '" data-delta="' + d + '"' + (phase === 'live' ? '' : ' disabled') + '>' +
            (d > 0 ? '+' : '') + d + '</button>').join('') +
        '</div></div>';

    /* ---------- two-tap panel ---------- */
    const targetHtml = (function () {
      if (!pendingStat) {
        return '<p class="tt-hint">Step 1 — tap a stat above. Step 2 — tap the jersey number. ' +
          'It is recorded on the spot.</p>';
      }
      const def = pl.PLAYS[pendingStat];
      const stat = TWO_TAP.find(t => t.key === pendingStat);
      const head = '<p class="tt-hint tt-armed"><strong>' + ui.esc(stat ? stat.label + ' ' + stat.hint : def.label) +
        '</strong> for <strong>' + teamLabel + '</strong> — now tap ' +
        (selIsOurs ? 'a jersey number.' : 'the opponent total.') + '</p>';
      if (!selIsOurs) {
        return head + '<button type="button" class="tt-target tt-team-total" data-action="tt-target" ' +
          'data-id="" aria-label="Record for ' + teamLabel + ' team total">' +
          '<span class="tt-target-no">TEAM</span><span class="tt-target-name">Team total</span></button>';
      }
      if (!roster.length) {
        return head + '<p class="muted">No active players on your roster — add them in Teams &amp; Roster.</p>';
      }
      return head + '<div class="tt-jerseys">' + roster.map(p =>
        '<button type="button" class="tt-target' + (lineup.indexOf(p.id) >= 0 ? ' on-court' : '') +
        '" data-action="tt-target" data-id="' + ui.esc(p.id) + '" aria-label="#' + ui.esc(p.number) + ' ' +
        ui.esc(p.name) + '">' +
        '<span class="tt-target-no">' + ui.esc(p.number) + '</span>' +
        '<span class="tt-target-name">' + ui.esc(p.name) + '</span></button>').join('') + '</div>';
    })();

    const twoTapPanel =
      '<div class="tt-stats" role="group" aria-label="Step 1: choose a stat">' +
        TWO_TAP.map(t =>
          '<button type="button" class="tt-stat tone-' + t.tone + (pendingStat === t.key ? ' is-armed' : '') +
          '" data-action="tt-stat" data-play="' + t.key + '" aria-pressed="' + (pendingStat === t.key) + '"' +
          (canScore ? '' : ' disabled') + '>' +
          '<span class="tt-stat-label">' + ui.esc(t.label) + '</span>' +
          (t.hint ? '<small>' + ui.esc(t.hint) + '</small>' : '') + '</button>').join('') +
      '</div>' +
      '<div class="tt-target-area" aria-live="polite">' + (canScore ? targetHtml :
        '<p class="tt-hint">' + (phase === 'pregame' ? 'Start the game to enable scoring.' :
          phase === 'halftime' ? 'Halftime — resume the second half to keep scoring.' :
          'This game is final. Reopen it to add plays.') + '</p>') + '</div>' +
      '<p class="tt-last" aria-live="polite">' + (lastRecorded ? 'Last recorded: ' + ui.esc(lastRecorded) : '') + '</p>';

    /* ---------- classic panel ---------- */
    const chips = selIsOurs
      ? (roster.length ? roster.map(p =>
          '<button type="button" class="roster-chip' + (p.id === selectedPlayerId ? ' selected' : '') +
            (lineup.indexOf(p.id) >= 0 ? ' on-court' : '') + '" data-action="select-player" data-id="' +
            ui.esc(p.id) + '" title="' + ui.esc(p.name) + (lineup.indexOf(p.id) >= 0 ? ' — on court' : '') + '">' +
            ui.avatar(p, { size: 'sm', team: teamOf(state, p.teamId), showNumber: true }) +
            '<span class="chip-text">#' + ui.esc(p.number) + ' ' + ui.esc(p.name) + '</span>' +
            (lineup.indexOf(p.id) >= 0 ? '<span class="on-court-dot" aria-label="on court"></span>' : '') +
          '</button>').join('')
        : '<span class="muted">No active players on this team — add them in Teams &amp; Roster.</span>')
      : '<button type="button" class="roster-chip team-total-chip' + (!selectedPlayerId ? ' selected' : '') +
        '" data-action="select-player" data-id=""><span class="chip-text">Team total (opponent)</span></button>';

    const lineupButtons = roster.length
      ? roster.map(p =>
          '<button type="button" class="lineup-toggle' + (lineup.indexOf(p.id) >= 0 ? ' is-on' : '') +
            '" data-action="toggle-court" data-id="' + ui.esc(p.id) + '" aria-pressed="' +
            (lineup.indexOf(p.id) >= 0 ? 'true' : 'false') + '">' +
            '#' + ui.esc(p.number) + ' ' + ui.esc(p.name) +
          '</button>').join('')
      : '';

    const playButtons = PLAY_BUTTONS.map(([key, label, hint]) =>
      '<button type="button" class="stat-btn' + (pl.PLAYS[key].score ? ' score' : '') +
        '" data-action="play" data-play="' + key + '"' + (canScore ? '' : ' disabled') + '>' +
        ui.esc(label) + '<small>' + ui.esc(hint) + '</small></button>').join('');

    const classicPanel =
      '<div class="roster-strip">' + chips + '</div>' +
      (selIsOurs && roster.length ?
        '<details class="lineup-panel"><summary>On court (' + lineup.length + '/5) · ' +
        (lineupMinutes.players ? 'lineup clock tracked' : 'optional lineup tracking') + '</summary>' +
        '<div class="lineup-toggles">' + lineupButtons + '</div>' +
        '<p class="footnote">Toggling a player records a substitution and starts/stops their ' +
        'lineup minutes. Leave it alone to keep the classic stat-line minutes.</p></details>' : '') +
      '<div class="stat-grid">' + playButtons + '</div>';

    const shotSpot =
      '<div class="shot-spot-wrap">' +
        '<h4 class="shot-spot-title">Shot spot <span class="muted small">(optional — attaches to the next shot)</span></h4>' +
        '<canvas id="shot-spot" class="chart-canvas shot-canvas" role="img" ' +
          'aria-label="Tap the court to mark where the next shot was taken"></canvas>' +
        '<div class="shot-spot-bar"><span id="shot-spot-label" class="small muted"></span>' +
          '<button type="button" class="btn btn-mini" id="shot-clear" data-action="clear-shot">Clear spot</button></div>' +
      '</div>';

    const statusButtons =
      (game.status === 'scheduled'
        ? '<button type="button" class="btn btn-primary" data-action="start-game">Start game</button>' : '') +
      (phase === 'live'
        ? '<button type="button" class="btn btn-ghost" data-action="halftime">Halftime</button>' +
          '<button type="button" class="btn btn-primary" data-action="finalize">Finalize game</button>' : '') +
      (phase === 'halftime'
        ? '<button type="button" class="btn btn-primary" data-action="resume">Resume · ' +
          (game.quarter < state.league.quarters ? 'start Q' + (game.quarter + 1) : 'back on court') + '</button>' +
          '<button type="button" class="btn btn-primary" data-action="finalize">Finalize game</button>' : '') +
      (game.status === 'final'
        ? '<button type="button" class="btn btn-ghost" data-action="reopen">Reopen for edits</button>' : '');

    host.innerHTML =
      '<div class="box-header">' +
        '<div class="box-meta">' + ui.statusBadge(game.status, game.halftime) +
          ' <span class="phase-pill phase-' + phase + '">' + ui.esc(phaseLabel(game)) + '</span> · ' +
          ui.fmtDate(game.date) + (game.time ? ' ' + ui.fmtTime(game.time) : '') +
          (game.location ? ' · ' + ui.esc(game.location) : '') +
          (game.notes ? ' · ' + ui.esc(game.notes) : '') + '</div>' +
        '<div class="matchup">' +
          '<span class="side">' + ui.esc(awayName) + '</span>' +
          '<span class="final-score">' + ui.fmtInt(game.homeScore) + '–' + ui.fmtInt(game.awayScore) + '</span>' +
          '<span class="side">' + ui.esc(homeName) + '</span>' +
        '</div>' +
        '<div class="box-meta">Home score shown first · ' +
          (phase === 'final' ? 'Final — reopen to keep editing' :
            phase === 'pregame' ? 'Pre-game — not started yet' :
            phase === 'halftime' ? 'Halftime — clock and scoring paused' : 'Live scoring in progress') + '</div>' +
      '</div>' +

      '<div class="scoreboard">' +
        scoreCard(homeTeam, game.homeTeamId, game.homeScore, 'HOME') +
        '<div class="clock-box">' +
          '<div class="quarter">' + (phase === 'halftime' ? 'Halftime' : 'Quarter ' + game.quarter + ' / ' + state.league.quarters) + '</div>' +
          '<div class="clock' + (running ? ' running' : '') + '" id="live-clock">' +
            (phase === 'halftime' ? 'HT' : ui.fmtClock(left)) + '</div>' +
          (TBS.plays.shotFull(state.league) ?
            '<div class="shot-clock' + (shotLeft !== null && shotLeft <= 0 ? ' expired' : '') + '">' +
              'Shot clock <strong id="live-shot-clock">' + (shotLeft === null ? '' : Math.ceil(shotLeft)) + '</strong>' +
              ' <button type="button" class="btn btn-mini" data-action="reset-shot"' + (canScore ? '' : ' disabled') + '>Reset to ' + TBS.plays.shotFull(state.league) + '</button>' +
            '</div>' : '') +
          '<div class="clock-actions">' +
            '<button type="button" class="btn btn-mini" data-action="toggle-clock"' + (canScore ? '' : ' disabled') + '>' +
              (running ? '⏸ Pause' : '▶ Start') + ' clock</button>' +
            '<button type="button" class="btn btn-mini" data-action="next-quarter"' + (canScore ? '' : ' disabled') + '>Next Q</button>' +
            '<button type="button" class="btn btn-mini" data-action="reset-clock"' + (canScore ? '' : ' disabled') + '>Reset</button>' +
          '</div>' +
        '</div>' +
        scoreCard(awayTeam, game.awayTeamId, game.awayScore, 'AWAY') +
      '</div>' +

      '<div class="console-grid">' +
        '<div class="console-panel">' +
          '<div class="console-head">' +
            '<div><h3>Record a play</h3>' +
              '<p class="panel-note">Recording for <strong>' + teamLabel + '</strong>' +
                (selIsOurs ? '' : ' (opponent — team totals, no roster needed)') +
                ' — tap the other score to switch sides.</p></div>' +
            '<button type="button" class="btn btn-mini" data-action="show-shortcuts">' +
              ui.icon('keyboard') + ' Shortcuts</button>' +
          '</div>' +
          '<div class="entry-mode" role="group" aria-label="Entry mode">' +
            '<button type="button" class="mode-btn' + (mode === 'twotap' ? ' is-on' : '') +
              '" data-action="set-mode" data-mode="twotap" aria-pressed="' + (mode === 'twotap') + '">Two-tap</button>' +
            '<button type="button" class="mode-btn' + (mode === 'classic' ? ' is-on' : '') +
              '" data-action="set-mode" data-mode="classic" aria-pressed="' + (mode === 'classic') + '">Classic (player first)</button>' +
          '</div>' +
          (mode === 'twotap' ? twoTapPanel : classicPanel) +
          shotSpot +
          '<div class="console-actions">' +
            '<button type="button" class="btn btn-ghost" data-action="undo"' +
              (game.events.length ? '' : ' disabled') + '>' + ui.icon('undo') + ' Undo last play</button>' +
            statusButtons +
            '<button type="button" class="btn btn-ghost" data-action="edit-box">Edit box score</button>' +
          '</div>' +
          '<p class="console-status">' +
            (canScore ? 'Every tap is saved instantly. ' + game.events.length + ' plays logged.' :
              phase === 'pregame' ? 'Start the game to enable scoring.' :
                phase === 'halftime' ? 'Halftime: resume the second half to keep scoring.' :
                  'This game is final. Reopen it to add plays, or edit the box score directly.') +
          '</p>' +
        '</div>' +
        '<div class="console-panel">' +
          '<h3>Play-by-play</h3>' +
          '<p class="panel-note">Most recent first · undo reverses stats, score and substitutions exactly.</p>' +
          '<div class="pbp-filters">' +
            '<label class="field field-inline"><span>Show</span>' +
              '<select id="pbp-filter" aria-label="Filter play-by-play">' +
                ui.options(PBP_FILTERS, pbpFilter) + '</select></label>' +
            '<label class="field field-inline"><span>Limit</span>' +
              '<select id="pbp-limit" aria-label="Number of plays to show">' +
                ui.options([{ value: '12', label: '12 plays' }, { value: '25', label: '25 plays' },
                  { value: '50', label: '50 plays' }, { value: 'all', label: 'All plays' }], pbpLimit) +
              '</select></label>' +
          '</div>' +
          '<div class="play-log">' + pbpHtml(game, state) + '</div>' +
        '</div>' +
      '</div>' +
      compactBox(game, state);

    drawShotSpot(game);
  }

  function newGameModal(state) {
    const scoped = !!(TBS.auth && TBS.auth.role() === 'team');
    const primaryId = scoped ? TBS.auth.myTeamId() : state.league.primaryTeamId;
    const others = state.teams.filter(t => t.id !== primaryId);
    const homeTeams = scoped ? state.teams.filter(t => t.id === primaryId) : state.teams;
    const awayOptions = state.teams.map(t => ({ value: t.id, label: t.name }));
    if (!others.length) awayOptions.unshift({ value: '', label: '— create a new opponent below —' });
    ui.openModal({
      title: 'Quick create a game',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: storage.todayISO(), required: true },
        { name: 'time', label: 'Time', type: 'time', value: '' },
        { name: 'homeTeamId', label: 'Home team', type: 'select', value: primaryId,
          options: (homeTeams.length ? homeTeams : state.teams).map(t => ({ value: t.id, label: t.name })),
          help: scoped ? 'Team accounts schedule their own home games.' : undefined },
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
              short: name.slice(0, 3).toUpperCase(), color: '', primary: false
            };
            awayTeamId = newTeam.id;
          }
        }
        const id = storage.uid('game');
        TBS.app.commit(d => {
          if (newTeam && !d.teams.some(t => t.id === newTeam.id)) d.teams.push(newTeam);
          d.games.push({
            id: id, date: values.date, time: values.time,
            location: String(values.location || '').trim(),
            season: d.league.season,
            status: 'scheduled', halftime: false,
            homeTeamId: values.homeTeamId, awayTeamId: awayTeamId,
            homeScore: 0, awayScore: 0, quarter: 1,
            clockSeconds: d.league.quarterMinutes * 60, clockRunningSince: null,
            lineup: storage.blankLineup(),
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
    const state = TBS.app.getState();
    if (state && TBS.auth && !TBS.auth.canScoreGame(state.games.find(g => g.id === id))) {
      const mine = scopedGames(state)[0];
      id = mine ? mine.id : null;
    }
    selectedGameId = id;
    selectedTeamId = null;
    selectedPlayerId = null;
    pendingShot = null;
    pendingStat = null;
    lastRecorded = '';
    const select = qs('#live-game-select');
    if (select && Array.from(select.options).some(o => o.value === id)) select.value = id;
    if (TBS.app.activeTab && TBS.app.activeTab() === 'live') render(TBS.app.getState());
  }

  function selectPlayer(delta) {
    const state = TBS.app.getState();
    const game = activeGame(state);
    if (!game) return;
    const roster = rosterOf(state, selectedTeamId);
    if (!roster.length) { ui.toast('No active players on this team.', 'error'); return; }
    let index = roster.findIndex(p => p.id === selectedPlayerId);
    if (index < 0) index = delta > 0 ? -1 : 0;
    index = (index + delta + roster.length) % roster.length;
    selectedPlayerId = roster[index].id;
    render(state);
  }

  /* Two-tap step 2: a jersey (or the opponent team total) completes a play. */
  function completeTwoTap(game, playerId) {
    if (!pendingStat) { ui.toast('Tap a stat first, then the jersey number.', 'info'); return; }
    if (applyPlay(game.id, pendingStat, selectedTeamId, playerId || '')) {
      pendingStat = null;
      /* Remember the jersey so keyboard shortcuts (R, O, ...) act on the same player. */
      if (playerId) selectedPlayerId = playerId;
    }
  }

  function requireLive(game) {
    if (pl.phaseOf(game) === 'live') return true;
    ui.toast(pl.phaseOf(game) === 'halftime' ? 'Halftime — resume the second half first.'
      : 'Start or reopen the game first.', 'error');
    return false;
  }

  function init() {
    qs('#live-game-select').addEventListener('change', e => {
      openGame(e.target.value);
      render(TBS.app.getState());
    });
    qs('#live-add-game').addEventListener('click', () => newGameModal(TBS.app.getState()));

    const host = qs('#live-console');
    host.addEventListener('change', e => {
      if (e.target.id === 'pbp-filter') { pbpFilter = e.target.value; render(TBS.app.getState()); }
      else if (e.target.id === 'pbp-limit') { pbpLimit = e.target.value; render(TBS.app.getState()); }
    });

    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      const state = TBS.app.getState();
      const game = activeGame(state);
      const action = btn.dataset.action;

      if (action === 'new-game') { newGameModal(state); return; }
      if (action === 'go-schedule') { TBS.app.go('schedule'); return; }
      if (!game) return;

      switch (action) {
        case 'set-mode':
          setEntryMode(btn.dataset.mode);
          render(state);
          break;
        case 'select-team':
          if (btn.dataset.team !== selectedTeamId) {
            selectedTeamId = btn.dataset.team;
            selectedPlayerId = null;
            pendingShot = null;
            render(state);
          }
          break;
        case 'tt-stat':
          if (!requireLive(game)) return;
          pendingStat = pendingStat === btn.dataset.play ? null : btn.dataset.play;
          render(state);
          break;
        case 'tt-target':
          if (!requireLive(game)) return;
          completeTwoTap(game, btn.dataset.id);
          render(TBS.app.getState());
          break;
        case 'select-player':
          selectedPlayerId = btn.dataset.id || null;
          render(state);
          break;
        case 'toggle-court':
          toggleOnCourt(game.id, btn.dataset.id);
          break;
        case 'manual-score':
          if (!requireLive(game)) return;
          manualScore(game.id, btn.dataset.team, Number(btn.dataset.delta));
          break;
        case 'play':
          if (!requireLive(game)) return;
          applyPlay(game.id, btn.dataset.play, selectedTeamId, selectedPlayerId || '');
          break;
        case 'toggle-clock': toggleClock(game.id); break;
        case 'next-quarter': nextQuarter(game.id); break;
        case 'reset-clock': resetClock(game.id); break;
        case 'reset-shot': resetShotClock(game.id); break;
        case 'halftime': startHalftime(game.id); break;
        case 'resume': resumeFromHalftime(game.id); break;
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
        case 'clear-shot':
          pendingShot = null;
          drawShotSpot(game);
          break;
      }
    });

    /* Shot spot: tap/drag on the mini court to set the next shot location. */
    host.addEventListener('pointerdown', e => {
      const canvas = e.target.closest && e.target.closest('#shot-spot');
      if (!canvas) return;
      const game = activeGame(TBS.app.getState());
      if (!game) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      pendingShot = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      drawShotSpot(game);
    });

    /* Score cards are also keyboard activatable. */
    host.addEventListener('keydown', e => {
      const card = e.target.closest && e.target.closest('[data-action="select-team"]');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        card.click();
      }
    });
  }

  /* ---------------------- shortcuts API (see shortcuts.js) ---------------- */

  function shortcutGame() {
    return activeGame(TBS.app.getState());
  }

  TBS.live = {
    render: render,
    init: init,
    openGame: openGame,
    hasGame: function () { return !!shortcutGame(); },
    shortcutPlay: function (playKey) {
      const state = TBS.app.getState();
      const game = shortcutGame();
      if (!game) return;
      if (!requireLive(game)) return;
      applyPlay(game.id, playKey, selectedTeamId, selectedPlayerId || '');
      render(state);
    },
    shortcutUndo: function () {
      const game = shortcutGame();
      if (game) undoLast(game.id);
    },
    shortcutClock: function () {
      const game = shortcutGame();
      if (!game) return;
      if (pl.phaseOf(game) !== 'live') { ui.toast('Start the game first.', 'error'); return; }
      toggleClock(game.id);
    },
    shortcutNextQuarter: function () {
      const game = shortcutGame();
      if (!game) return;
      if (pl.phaseOf(game) !== 'live') { ui.toast('Start the game first.', 'error'); return; }
      nextQuarter(game.id);
    },
    cyclePlayer: selectPlayer,
    selected: function () {
      return { gameId: selectedGameId, teamId: selectedTeamId, playerId: selectedPlayerId, pendingStat: pendingStat };
    },
    entryMode: entryMode,
    setEntryMode: setEntryMode
  };
})(window.TBS = window.TBS || {});
