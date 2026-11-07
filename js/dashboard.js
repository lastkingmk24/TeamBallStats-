/* =========================================================================
 * dashboard.js — overview: live banner, KPI cards, "last game" recap,
 * fixtures, recent results and team leaders. Read-only: every action routes
 * through TBS.app / TBS.live / TBS.boxscores.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;
  const qs = ui.qs;

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  function shortScore(g) {
    return ui.fmtInt(g.homeScore) + '–' + ui.fmtInt(g.awayScore);
  }

  /* Compact "last game" recap: score, result, top performers, quarter line
   * and a four-stat comparison between the two teams in that game. */
  function recapHtml(state) {
    const primaryId = state.league.primaryTeamId;
    const finals = st.sortByDateDesc(state.games.filter(g => g.status === 'final'));
    const mine = finals.filter(g => g.homeTeamId === primaryId || g.awayTeamId === primaryId);
    const game = mine[0] || finals[0];
    if (!game) {
      return ui.emptyState('No final game yet',
        'Finalize a game in the Live Console and the recap appears here.',
        '<button type="button" class="btn btn-primary" data-action="go-live">Open Live Console</button>');
    }

    const involved = game.homeTeamId === primaryId || game.awayTeamId === primaryId;
    const mySideId = involved ? primaryId : game.homeTeamId;
    const oppId = mySideId === game.homeTeamId ? game.awayTeamId : game.homeTeamId;
    const myTeam = teamOf(state, mySideId);
    const oppTeam = teamOf(state, oppId);
    const result = st.resultFor(game, mySideId);
    const mineTotals = an.teamTotals(game, mySideId);
    const oppTotals = an.teamTotals(game, oppId);
    const quarters = st.quarterScores(game, state.league);

    const performers = (game.stats || [])
      .filter(line => line.teamId === mySideId)
      .map(line => ({
        line: line,
        player: state.players.find(p => p.id === line.playerId)
      }))
      .filter(item => item.player)
      .sort((a, b) => b.line.pts - a.line.pts)
      .slice(0, 3);

    const compareRow = (label, mineValue, oppValue) =>
      '<div class="compare-row"><span>' + ui.esc(mineValue) + '</span>' +
      '<span class="compare-label">' + ui.esc(label) + '</span>' +
      '<span>' + ui.esc(oppValue) + '</span></div>';

    return '<div class="recap">' +
      '<div class="recap-head">' +
        '<div class="recap-score">' +
          '<span class="recap-team">' + (myTeam ? ui.esc(myTeam.name) : 'My team') + '</span>' +
          '<span class="recap-result">' + ui.resultBadge(result) + '</span>' +
          '<span class="recap-numbers">' + ui.fmtInt(game.homeScore) + '–' + ui.fmtInt(game.awayScore) + '</span>' +
          '<span class="recap-team">' + (oppTeam ? ui.esc(oppTeam.name) : 'Opponent') + '</span>' +
        '</div>' +
        '<div class="recap-meta">' + ui.fmtDate(game.date) +
          (game.location ? ' · ' + ui.esc(game.location) : '') +
          ' · home listed first</div>' +
      '</div>' +
      '<div class="recap-body">' +
        '<div class="recap-performers">' +
          '<h4>Top performers</h4>' +
          (performers.length
            ? '<div class="performer-list">' + performers.map(item =>
                '<div class="performer">' +
                  ui.playerCell(item.player, { team: teamOf(state, item.line.teamId), size: 'sm' }) +
                  '<span class="performer-line">' + ui.fmtInt(item.line.pts) + ' PTS · ' +
                    ui.fmtInt(item.line.reb) + ' REB · ' + ui.fmtInt(item.line.ast) + ' AST</span>' +
                '</div>').join('') + '</div>'
            : '<p class="muted small">No player lines recorded for this game.</p>') +
        '</div>' +
        '<div class="recap-compare">' +
          '<h4>Game comparison</h4>' +
          '<div class="compare-head"><span>' + (myTeam ? ui.esc(myTeam.short || myTeam.name) : 'MINE') +
            '</span><span></span><span>' + (oppTeam ? ui.esc(oppTeam.short || oppTeam.name) : 'OPP') + '</span></div>' +
          compareRow('FG%', ui.fmtPct(mineTotals.fgPct), ui.fmtPct(oppTotals.fgPct)) +
          compareRow('3P%', ui.fmtPct(mineTotals.tpPct), ui.fmtPct(oppTotals.tpPct)) +
          compareRow('REB', ui.fmtInt(mineTotals.reb), ui.fmtInt(oppTotals.reb)) +
          compareRow('TOV', ui.fmtInt(mineTotals.tov), ui.fmtInt(oppTotals.tov)) +
          (quarters.tracked.some(Boolean)
            ? '<div class="recap-quarters">' +
                quarters.home.map((value, i) => '<span class="quarter-pill">Q' + (i + 1) + ' ' +
                  (quarters.tracked[i] ? ui.fmtInt(value) + '–' + ui.fmtInt(quarters.away[i]) : '—') +
                  '</span>').join('') + '</div>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="recap-actions">' +
        '<button type="button" class="btn btn-mini" data-action="recap-box" data-id="' +
          ui.esc(game.id) + '">Open box score →</button>' +
        '<button type="button" class="btn btn-mini" data-action="go-boxscores">All box scores</button>' +
      '</div>' +
      '</div>';
  }

  function render(state) {
    const primaryId = state.league.primaryTeamId;
    const rec = st.teamRecord(state.games, primaryId);
    const finals = state.games.filter(g => g.status === 'final');
    const scheduled = state.games.filter(g => g.status === 'scheduled');
    const liveGames = state.games.filter(g => g.status === 'live');

    qs('#dashboard-season').textContent =
      state.league.name + ' · Season ' + (state.league.season || '—');

    /* Live banner */
    const liveHost = qs('#dashboard-live');
    if (liveGames.length) {
      const g = liveGames[0];
      const team = teamOf(state, g.homeTeamId);
      liveHost.innerHTML = '<div class="live-banner"' +
        (team && team.color ? ' style="--banner-accent:' + ui.esc(team.color) + '"' : '') + '>' +
        '<div class="live-banner-text"><span class="live-dot" aria-hidden="true"></span>' +
        '<strong>Game in progress</strong> — ' + ui.esc(teamName(state, g.awayTeamId)) +
        ' @ ' + ui.esc(teamName(state, g.homeTeamId)) + ' · ' +
        ui.fmtInt(g.homeScore) + '–' + ui.fmtInt(g.awayScore) + ' · Q' + g.quarter + '</div>' +
        '<button type="button" class="btn" data-action="go-live" data-game-id="' +
          ui.esc(g.id) + '">Open live console →</button>' +
        '</div>';
    } else {
      liveHost.innerHTML = '';
    }

    /* KPI cards */
    const pctText = rec.gp ? (rec.pct * 100).toFixed(1) + '% win rate' : 'No final games yet';
    const myPlayers = state.players.filter(p => p.teamId === primaryId);
    qs('#dashboard-cards').innerHTML = [
      { label: 'My record', value: rec.w + '–' + rec.l, detail: pctText + ' · ' + rec.streak + ' streak', accent: true },
      { label: 'Points for / against', value: ui.fmt1(rec.pfPerGame) + ' / ' + ui.fmt1(rec.paPerGame), detail: 'Per game · diff ' + ui.fmtSigned(rec.diff) },
      { label: 'Roster / teams', value: myPlayers.length + ' / ' + state.teams.length, detail: state.players.length + ' players league-wide' },
      { label: 'Games', value: String(finals.length), detail: scheduled.length + ' scheduled · ' + liveGames.length + ' live' }
    ].map(c => '<div class="card stat-card' + (c.accent ? ' accent' : '') + '">' +
      '<div class="label">' + ui.esc(c.label) + '</div>' +
      '<div class="value">' + ui.esc(c.value) + '</div>' +
      '<div class="detail">' + ui.esc(c.detail) + '</div></div>').join('');

    const recap = qs('#dashboard-recap');
    if (recap) recap.innerHTML = recapHtml(state);

    /* Next fixtures */
    const today = TBS.storage.todayISO();
    const upcoming = state.games
      .filter(g => g.status !== 'final' && (g.date || '') >= today)
      .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))
      .slice(0, 4);
    qs('#dashboard-next').innerHTML = upcoming.length
      ? '<div class="mini-list">' + upcoming.map(g =>
          '<div class="mini-item"><div><strong>' + ui.esc(teamName(state, g.awayTeamId)) +
          ' @ ' + ui.esc(teamName(state, g.homeTeamId)) + '</strong>' +
          '<div class="mini-meta">' + ui.fmtDate(g.date) + (g.time ? ' · ' + ui.fmtTime(g.time) : '') +
          (ui.relativeDate(g.date) ? ' · ' + ui.relativeDate(g.date) : '') + '</div></div>' +
          ui.statusBadge(g.status) + '</div>').join('') + '</div>' +
        '<button type="button" class="btn btn-mini" data-action="go-schedule" style="margin-top:.75rem">Open schedule →</button>'
      : ui.emptyState('No upcoming games', 'Add a fixture on the Schedule tab.',
          '<button type="button" class="btn btn-primary" data-action="go-schedule">Go to Schedule</button>');

    /* Recent results */
    const recent = st.sortByDateDesc(finals).slice(0, 5);
    qs('#dashboard-recent').innerHTML = recent.length
      ? '<div class="mini-list">' + recent.map(g => {
          const involved = g.homeTeamId === primaryId || g.awayTeamId === primaryId;
          const r = involved ? st.resultFor(g, primaryId) : '';
          return '<div class="mini-item"><div><strong>' +
            ui.esc(teamName(state, g.awayTeamId)) + ' @ ' + ui.esc(teamName(state, g.homeTeamId)) +
            '</strong><div class="mini-meta">' + ui.fmtDate(g.date) + '</div></div>' +
            '<div class="mini-score">' + (r ? ui.resultBadge(r) + ' ' : '') +
            '<strong>' + shortScore(g) + '</strong></div></div>';
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-mini" data-action="go-boxscores" style="margin-top:.75rem">View box scores →</button>'
      : ui.emptyState('No final games', 'Log a game or finish one in the Live Console.',
          '<button type="button" class="btn btn-primary" data-action="go-live">Open Live Console</button>');

    /* Leaders (my team) with avatars */
    const board = st.leaderboard(myPlayers, state.games);
    const first = key => board[key][0];
    const rows = [
      { label: 'PPG', item: first('ppg'), fmt: v => ui.fmt1(v) },
      { label: 'RPG', item: first('rpg'), fmt: v => ui.fmt1(v) },
      { label: 'APG', item: first('apg'), fmt: v => ui.fmt1(v) },
      { label: 'FG%', item: first('fgPct'), fmt: v => ui.fmtPct(v) }
    ];
    qs('#dashboard-leaders').innerHTML = myPlayers.length
      ? '<div class="mini-list">' + rows.map(r =>
          '<div class="leader-line">' +
          '<span class="leader-label">' + r.label + '</span>' +
          (r.item
            ? ui.playerCell(r.item.player, { team: teamOf(state, r.item.player.teamId), size: 'sm' })
            : '<span class="muted">—</span>') +
          '<span class="leader-value">' + (r.item ? ui.esc(r.fmt(r.item.value)) : '—') + '</span></div>'
        ).join('') + '</div>' +
        '<button type="button" class="btn btn-mini" data-action="go-stats" style="margin-top:.75rem">Full player stats →</button>'
      : ui.emptyState('No players yet', 'Build your roster to see leaders.',
          '<button type="button" class="btn btn-primary" data-action="go-teams">Add players</button>');
  }

  function init() {
    qs('#dashboard').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'go-teams') TBS.app.go('teams');
      else if (action === 'go-schedule') TBS.app.go('schedule');
      else if (action === 'go-stats') TBS.app.go('stats');
      else if (action === 'go-standings') TBS.app.go('standings');
      else if (action === 'go-boxscores') TBS.app.go('boxscores');
      else if (action === 'recap-box') {
        if (btn.dataset.id) TBS.boxscores.openGame(btn.dataset.id);
        TBS.app.go('boxscores');
      } else if (action === 'go-live') {
        if (btn.dataset.gameId) TBS.live.openGame(btn.dataset.gameId);
        TBS.app.go('live');
      }
    });
  }

  TBS.dashboard = { render: render, init: init, recapHtml: recapHtml };
})(window.TBS = window.TBS || {});
