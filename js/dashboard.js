/* =========================================================================
 * dashboard.js — overview cards, live banner, next fixtures, recent results,
 * team leaders. Read-only view; all actions route through TBS.app.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const qs = ui.qs;

  function teamName(state, id) {
    const t = state.teams.find(x => x.id === id);
    return t ? t.name : 'Unknown team';
  }

  function shortScore(g) {
    return ui.fmtInt(g.homeScore) + '–' + ui.fmtInt(g.awayScore);
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
      liveHost.innerHTML = '<div class="live-banner">' +
        '<div><strong>🔴 Game in progress</strong> — ' + ui.esc(teamName(state, g.awayTeamId)) +
        ' @ ' + ui.esc(teamName(state, g.homeTeamId)) + ' · ' +
        ui.fmtInt(g.homeScore) + '–' + ui.fmtInt(g.awayScore) + ' · Q' + g.quarter + '</div>' +
        '<button type="button" class="btn" data-action="go-live" data-game-id="' + ui.esc(g.id) + '">Open live console →</button>' +
        '</div>';
    } else {
      liveHost.innerHTML = '';
    }

    /* KPI cards */
    const pctText = rec.gp ? (rec.pct * 100).toFixed(1) + '% win rate' : 'No final games yet';
    const myPlayers = state.players.filter(p => p.teamId === primaryId);
    qs('#dashboard-cards').innerHTML = [
      { label: 'My record', value: rec.w + '–' + rec.l, detail: pctText + ' · ' + rec.streak + ' streak', accent: true },
      { label: 'Points for / against', value: ui.fmt1(rec.pfPerGame) + ' / ' + ui.fmt1(rec.paPerGame), detail: 'Per game · diff ' + (rec.diff >= 0 ? '+' : '') + rec.diff },
      { label: 'Roster / teams', value: myPlayers.length + ' / ' + state.teams.length, detail: state.players.length + ' players league-wide' },
      { label: 'Games', value: String(finals.length), detail: scheduled.length + ' scheduled · ' + liveGames.length + ' live' }
    ].map(c => '<div class="card stat-card' + (c.accent ? ' accent' : '') + '">' +
      '<div class="label">' + ui.esc(c.label) + '</div>' +
      '<div class="value">' + ui.esc(c.value) + '</div>' +
      '<div class="detail">' + ui.esc(c.detail) + '</div></div>').join('');

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
    const recent = finals.slice().sort((a, b) =>
      String(b.date + b.time).localeCompare(String(a.date + a.time))
    ).slice(0, 5);
    qs('#dashboard-recent').innerHTML = recent.length
      ? '<div class="mini-list">' + recent.map(g => {
          const involved = g.homeTeamId === primaryId || g.awayTeamId === primaryId;
          const r = involved ? st.resultFor(g, primaryId) : '';
          return '<div class="mini-item"><div><strong>' +
            ui.esc(teamName(state, g.awayTeamId)) + ' @ ' + ui.esc(teamName(state, g.homeTeamId)) +
            '</strong><div class="mini-meta">' + ui.fmtDate(g.date) + '</div></div>' +
            '<div style="text-align:right">' + (r ? '<span class="badge badge-' + r.toLowerCase() + '">' + r + '</span> ' : '') +
            '<strong>' + shortScore(g) + '</strong></div></div>';
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-mini" data-action="go-boxscores" style="margin-top:.75rem">View box scores →</button>'
      : ui.emptyState('No final games', 'Log a game or finish one in the Live Console.',
          '<button type="button" class="btn btn-primary" data-action="go-live">Open Live Console</button>');

    /* Leaders (my team) */
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
          '<div class="leader-line"><span>' + r.label + ' · ' +
          (r.item ? ui.esc(r.item.player.name) : '—') + '</span>' +
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
      else if (action === 'go-live') {
        if (btn.dataset.gameId) TBS.live.openGame(btn.dataset.gameId);
        TBS.app.go('live');
      }
    });
  }

  TBS.dashboard = { render: render, init: init };
})(window.TBS = window.TBS || {});
