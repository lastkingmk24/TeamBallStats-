/* =========================================================================
 * live.js — live scoring console.
 *
 * Clock + quarters, one-tap stats, manual score adjustments, shot locations,
 * on-court lineup tracking, play-by-play filters, exact undo, live box score
 * and finalization. Every tap is persisted immediately through TBS.app.commit,
 * and keyboard shortcuts are routed via the small API at the bottom of this
 * module (see js/shortcuts.js for the key map).
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;
  const storage = TBS.storage;
  const qs = ui.qs;

  let selectedGameId = null;
  let selectedTeamId = null;
  let selectedPlayerId = null;
  let pendingShot = null;
  let pbpFilter = 'all';
  let pbpLimit = '25';
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
    ['ft_make', 'FT', 'FT made'],
    ['fg2_make', '2PT', '2PT made'],
    ['fg3_make', '3PT', '3PT made'],
    ['ft_miss', 'FT miss', 'attempt'],
    ['fg2_miss', '2PT miss', 'attempt'],
    ['fg3_miss', '3PT miss', 'attempt'],
    ['reb', 'REB', 'rebound'],
    ['ast', 'AST', 'assist'],
    ['stl', 'STL', 'steal'],
    ['blk', 'BLK', 'block'],
    ['tov', 'TOV', 'turnover'],
    ['pf', 'PF', 'foul'],
    ['min', 'MIN', 'minute']
  ];

  const SHOT_PLAYS = { ft_make: false, ft_miss: false, fg2_make: true, fg2_miss: true, fg3_make: true, fg3_miss: true };

  const PBP_FILTERS = [
    { value: 'all', label: 'All plays' },
    { value: 'scoring', label: 'Scoring plays' },
    { value: 'misses', label: 'Missed shots' },
    { value: 'other', label: 'Rebounds, fouls & other' },
    { value: 'home', label: 'Home team only' },
    { value: 'away', label: 'Away team only' }
  ];

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
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
      selectedTeamId = game.homeTeamId;
      selectedPlayerId = null;
    }
    return game;
  }

  function sideOf(game, teamId) {
    return teamId === game.homeTeamId ? 'home' : (teamId === game.awayTeamId ? 'away' : null);
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

  function nextQuarter(gameId) {
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
      const key = sideOf(g, teamId);
      if (!key) return;
      g[key + 'Score'] = Math.max(0, (Number(g[key + 'Score']) || 0) + delta);
      g.events.push({
        id: storage.uid('event'), type: 'manual',
        label: (delta > 0 ? '+' : '') + delta + ' ' + teamName(d, teamId) + ' (manual)',
        teamId: teamId, playerId: '', statDeltas: {}, scoreDelta: delta,
        shot: null,
        quarter: g.quarter, clockSeconds: Math.ceil(remainingSeconds(g)),
        ts: Date.now()
      });
    });
  }

  function applyPlay(gameId, playKey, teamId, playerId) {
    const def = PLAYS[playKey];
    if (!def) return;
    if (def.needsPlayer && !playerId) {
      ui.toast('Select a player first — tap a name in the roster strip, or use ↑ / ↓.', 'error');
      return;
    }
    const shot = SHOT_PLAYS[playKey] && pendingShot ? Object.assign({}, pendingShot) : null;
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
        const key = sideOf(g, teamId);
        if (key) g[key + 'Score'] = Math.max(0, (Number(g[key + 'Score']) || 0) + def.score);
      }
      const player = d.players.find(p => p.id === playerId);
      g.events.push({
        id: storage.uid('event'), type: playKey,
        label: (player ? player.name : 'Player') + ' — ' + def.label,
        teamId: teamId, playerId: playerId,
        statDeltas: Object.assign({}, def.stats),
        scoreDelta: def.score || 0,
        shot: shot,
        quarter: g.quarter, clockSeconds: Math.ceil(remainingSeconds(g)),
        ts: Date.now()
      });
    });
    if (shot) {
      pendingShot = null;
      ui.toast('Shot location logged with the play.', 'info');
    }
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
      g.lineup = g.lineup || { home: [], away: [] };
      const ids = g.lineup[side] || [];
      if (onCourt) g.lineup[side] = ids.filter(id => id !== playerId);
      else if (ids.indexOf(playerId) < 0) g.lineup[side] = ids.concat(playerId);
      g.events.push({
        id: storage.uid('event'),
        type: onCourt ? 'sub_out' : 'sub_in',
        label: (onCourt ? 'Sub out — ' : 'Sub in — ') + player.name,
        teamId: player.teamId, playerId: playerId,
        statDeltas: {}, scoreDelta: 0, shot: null,
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
      if (e.playerId && e.statDeltas) {
        const line = g.stats.find(s => s.playerId === e.playerId);
        if (line) {
          Object.keys(e.statDeltas).forEach(k => {
            line[k] = Math.max(0, (Number(line[k]) || 0) - Number(e.statDeltas[k] || 0));
          });
        }
      }
      if (e.scoreDelta) {
        const key = sideOf(g, e.teamId);
        if (key) g[key + 'Score'] = Math.max(0, (Number(g[key + 'Score']) || 0) - Number(e.scoreDelta));
      }
      if (e.type === 'sub_in' || e.type === 'sub_out') {
        const side = sideOf(g, e.teamId);
        if (side) {
          g.lineup = g.lineup || { home: [], away: [] };
          const ids = g.lineup[side] || [];
          if (e.type === 'sub_in') g.lineup[side] = ids.filter(id => id !== e.playerId);
          else if (ids.indexOf(e.playerId) < 0) g.lineup[side] = ids.concat(e.playerId);
        }
      }
    });
    ui.toast('Undid: ' + last.label, 'success');
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
        : 'No plays recorded yet. Tap a stat button to start the log.') + '</p>';
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

    const canScore = game.status === 'live';
    const running = !!game.clockRunningSince;
    const left = remainingSeconds(game);
    const homeTeam = teamOf(state, game.homeTeamId);
    const awayTeam = teamOf(state, game.awayTeamId);
    const homeName = homeTeam ? homeTeam.name : 'Unknown team';
    const awayName = awayTeam ? awayTeam.name : 'Unknown team';
    const side = sideOf(game, selectedTeamId) || 'home';
    const lineup = (game.lineup && game.lineup[side]) || [];
    const roster = state.players
      .filter(p => p.teamId === selectedTeamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
    if (selectedPlayerId && !roster.some(p => p.id === selectedPlayerId)) selectedPlayerId = null;
    const lineupMinutes = an.minutesFromLineup(game, state.league);

    const scoreCard = (team, teamId, score, label) =>
      '<div class="score-team' + (teamId === selectedTeamId ? ' selected' : '') + '"' +
        (team && team.color ? ' style="--team-color:' + ui.esc(team.color) + '"' : '') +
        ' data-action="select-team" data-team="' + ui.esc(teamId) + '" role="button" tabindex="0">' +
        '<div class="team-label">' + label + '</div>' +
        '<div class="team-name">' + ui.esc(team ? team.name : 'Unknown team') + '</div>' +
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

    const chips = roster.length
      ? roster.map(p =>
          '<button type="button" class="roster-chip' + (p.id === selectedPlayerId ? ' selected' : '') +
            (lineup.indexOf(p.id) >= 0 ? ' on-court' : '') + '" data-action="select-player" data-id="' +
            ui.esc(p.id) + '" title="' + ui.esc(p.name) + (lineup.indexOf(p.id) >= 0 ? ' — on court' : '') + '">' +
            ui.avatar(p, { size: 'sm', team: teamOf(state, p.teamId), showNumber: true }) +
            '<span class="chip-text">#' + ui.esc(p.number) + ' ' + ui.esc(p.name) + '</span>' +
            (lineup.indexOf(p.id) >= 0 ? '<span class="on-court-dot" aria-label="on court"></span>' : '') +
          '</button>').join('')
      : '<span class="muted">No active players on this team — add them in Teams &amp; Roster.</span>';

    const lineupButtons = roster.length
      ? roster.map(p =>
          '<button type="button" class="lineup-toggle' + (lineup.indexOf(p.id) >= 0 ? ' is-on' : '') +
            '" data-action="toggle-court" data-id="' + ui.esc(p.id) + '" aria-pressed="' +
            (lineup.indexOf(p.id) >= 0 ? 'true' : 'false') + '">' +
            '#' + ui.esc(p.number) + ' ' + ui.esc(p.name) +
          '</button>').join('')
      : '';

    host.innerHTML =
      '<div class="box-header">' +
        '<div class="box-meta">' + ui.statusBadge(game.status) +
          ' · ' + ui.fmtDate(game.date) + (game.time ? ' ' + ui.fmtTime(game.time) : '') +
          (game.location ? ' · ' + ui.esc(game.location) : '') +
          (game.notes ? ' · ' + ui.esc(game.notes) : '') + '</div>' +
        '<div class="matchup">' +
          '<span class="side">' + ui.esc(awayName) + '</span>' +
          '<span class="final-score">' + ui.fmtInt(game.homeScore) + '–' + ui.fmtInt(game.awayScore) + '</span>' +
          '<span class="side">' + ui.esc(homeName) + '</span>' +
        '</div>' +
        '<div class="box-meta">Home score shown first · ' +
          (game.status === 'final' ? 'Final — reopen to keep editing' :
            game.status === 'scheduled' ? 'Not started yet' : 'Live scoring in progress') + '</div>' +
      '</div>' +

      '<div class="scoreboard">' +
        scoreCard(homeTeam, game.homeTeamId, game.homeScore, 'HOME') +
        '<div class="clock-box">' +
          '<div class="quarter">Quarter ' + game.quarter + ' / ' + state.league.quarters + '</div>' +
          '<div class="clock' + (running ? ' running' : '') + '" id="live-clock">' + ui.fmtClock(left) + '</div>' +
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
              '<p class="panel-note">Scoring for <strong>' +
                ui.esc(teamName(state, selectedTeamId)) + '</strong> — click the other score to switch sides.</p></div>' +
            '<button type="button" class="btn btn-mini" data-action="show-shortcuts">' +
              ui.icon('keyboard') + ' Shortcuts</button>' +
          '</div>' +
          '<div class="roster-strip">' + chips + '</div>' +
          (roster.length ?
            '<details class="lineup-panel"><summary>On court (' + lineup.length + '/5) · ' +
              (lineupMinutes.players ? 'lineup clock tracked' : 'optional lineup tracking') + '</summary>' +
              '<div class="lineup-toggles">' + lineupButtons + '</div>' +
              '<p class="footnote">Toggling a player records a substitution and starts/stops their ' +
                'lineup minutes. Leave it alone to keep the classic stat-line minutes.</p></details>' : '') +
          '<div class="stat-grid">' + playButtons + '</div>' +
          '<div class="shot-spot-wrap">' +
            '<h4 class="shot-spot-title">Shot spot <span class="muted small">(optional — attaches to the next shot)</span></h4>' +
            '<canvas id="shot-spot" class="chart-canvas shot-canvas" role="img" ' +
              'aria-label="Tap the court to mark where the next shot was taken"></canvas>' +
            '<div class="shot-spot-bar"><span id="shot-spot-label" class="small muted"></span>' +
              '<button type="button" class="btn btn-mini" id="shot-clear" data-action="clear-shot">Clear spot</button></div>' +
          '</div>' +
          '<div class="console-actions">' +
            '<button type="button" class="btn btn-ghost" data-action="undo"' +
              (canScore && game.events.length ? '' : ' disabled') + '>' + ui.icon('undo') + ' Undo last play</button>' +
            (game.status === 'scheduled'
              ? '<button type="button" class="btn btn-primary" data-action="start-game">Start game</button>' : '') +
            (game.status === 'live'
              ? '<button type="button" class="btn btn-primary" data-action="finalize">Finalize game</button>' : '') +
            (game.status === 'final'
              ? '<button type="button" class="btn btn-ghost" data-action="reopen">Reopen for edits</button>' : '') +
            '<button type="button" class="btn btn-ghost" data-action="edit-box">Edit box score</button>' +
            '<button type="button" class="btn btn-mini" data-action="show-shortcuts">' +
              'Press ? for keys</button>' +
          '</div>' +
          '<p class="console-status">' +
            (canScore ? 'Every tap is saved instantly. ' + game.events.length + ' plays logged.' :
              game.status === 'scheduled' ? 'Start the game to enable scoring.' :
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
            status: 'scheduled',
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
    const select = qs('#live-game-select');
    if (select && Array.from(select.options).some(o => o.value === id)) select.value = id;
    if (TBS.app.activeTab && TBS.app.activeTab() === 'live') render(TBS.app.getState());
  }

  function selectPlayer(delta) {
    const state = TBS.app.getState();
    const game = activeGame(state);
    if (!game) return;
    const roster = state.players
      .filter(p => p.teamId === selectedTeamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
    if (!roster.length) { ui.toast('No active players on this team.', 'error'); return; }
    let index = roster.findIndex(p => p.id === selectedPlayerId);
    if (index < 0) index = delta > 0 ? -1 : 0;
    index = (index + delta + roster.length) % roster.length;
    selectedPlayerId = roster[index].id;
    render(state);
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
            pendingShot = null;
            render(state);
          }
          break;
        case 'select-player':
          if (btn.dataset.id !== selectedPlayerId) {
            selectedPlayerId = btn.dataset.id;
            render(state);
          }
          break;
        case 'toggle-court':
          toggleOnCourt(game.id, btn.dataset.id);
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
        case 'next-quarter': nextQuarter(game.id); break;
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
      if (game.status !== 'live') { ui.toast('Start or reopen the game first.', 'error'); return; }
      applyPlay(game.id, playKey, selectedTeamId, selectedPlayerId);
      render(state);
    },
    shortcutUndo: function () {
      const game = shortcutGame();
      if (game) undoLast(game.id);
    },
    shortcutClock: function () {
      const game = shortcutGame();
      if (!game) return;
      if (game.status !== 'live') { ui.toast('Start the game first.', 'error'); return; }
      toggleClock(game.id);
    },
    shortcutNextQuarter: function () {
      const game = shortcutGame();
      if (!game) return;
      if (game.status !== 'live') { ui.toast('Start the game first.', 'error'); return; }
      nextQuarter(game.id);
    },
    cyclePlayer: selectPlayer,
    selected: function () {
      return { gameId: selectedGameId, teamId: selectedTeamId, playerId: selectedPlayerId };
    }
  };
})(window.TBS = window.TBS || {});
