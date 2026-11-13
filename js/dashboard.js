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

  /* ------------------------------ hero card -------------------------------- */
  /* Big "featured game" card in the shape of a broadcast hero: score line,
   * two-line headline, WATCH / BOX SCORE actions and related content. */

  function relatedLines(game, state) {
    const events = (game.events || []).filter(e => e.scoreDelta > 0 || e.type === 'fg3_make');
    const lines = [];
    const topLine = (game.stats || []).slice().sort((a, b) => b.pts - a.pts)[0];
    if (topLine) {
      const player = state.players.find(p => p.id === topLine.playerId);
      if (player) {
        lines.push(player.name + ' leads the way with ' + ui.fmtInt(topLine.pts) + ' points');
      }
    }
    const threes = events.filter(e => e.type === 'fg3_make');
    if (threes.length) {
      const shooter = state.players.find(p => p.id === threes[0].playerId);
      lines.push((shooter ? shooter.name : 'A shooter') + ' connects from deep · ' +
        threes.length + ' made three' + (threes.length === 1 ? '' : 's'));
    }
    if (game.events && game.events.length) {
      lines.push(game.events.length + ' plays logged in the live console');
    }
    if (game.location) lines.push('Played at ' + game.location);
    return lines.slice(0, 3);
  }

  function heroScoreTeam(team, score, isWinner) {
    return '<div class="hero-team' + (isWinner ? ' is-winner' : '') + '">' +
      ui.teamLogo(team, 'lg') +
      '<div class="hero-team-text">' +
        '<span class="hero-team-city">' + ui.esc(team.short || '') + '</span>' +
        '<span class="hero-team-name">' + ui.esc(team.name) + '</span>' +
      '</div>' +
      '<span class="hero-team-score">' + ui.fmtInt(score) + '</span>' +
    '</div>';
  }

  function heroHtml(state) {
    if (!state.games.length) {
      return ui.emptyState('No games yet',
        'Add a fixture and it becomes the featured game here — with a box score, recap and shot chart.',
        '<button type="button" class="btn btn-primary" data-action="go-schedule">+ Create a fixture</button>');
    }

    const liveGame = state.games.find(g => g.status === 'live');
    const finals = st.sortByDateDesc(state.games.filter(g => g.status === 'final'));
    const scheduled = state.games.filter(g => g.status === 'scheduled')
      .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
    const game = liveGame || finals[0] || scheduled[0];
    if (!game) return '';

    const home = teamOf(state, game.homeTeamId) || { name: 'Unknown team', short: 'UNK' };
    const away = teamOf(state, game.awayTeamId) || { name: 'Unknown team', short: 'UNK' };
    const accentTeam = (game.homeTeamId === state.league.primaryTeamId ? home : away);
    const accent = (accentTeam && accentTeam.color) || '#1d428a';

    const homeWon = Number(game.homeScore) > Number(game.awayScore);
    const final = game.status === 'final';
    const title = liveGame
      ? 'LIVE NOW: ' + (away.short || away.name) + ' AT ' + (home.short || home.name)
      : final
        ? ((homeWon ? home : away).name + (/(s)$/i.test((homeWon ? home : away).name) ? ' TOP ' : ' TAKES DOWN ') +
            (homeWon ? away : home).name).toUpperCase()
        : ('UP NEXT: ' + (away.short || away.name) + ' AT ' + (home.short || home.name)).toUpperCase();

    const topPerformers = (game.stats || [])
      .filter(line => line.pts > 0)
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 3)
      .map(line => {
        const player = state.players.find(p => p.id === line.playerId);
        if (!player) return '';
        return '<span class="hero-performer">' + ui.avatar(player, {
          size: 'sm', team: teamOf(state, player.teamId), showNumber: false
        }) + '<strong>' + ui.esc(player.name) + '</strong> ' + ui.fmtInt(line.pts) + ' PTS</span>';
      }).filter(Boolean).join('');

    const related = relatedLines(game, state);

    return '<article class="hero" style="--hero-accent:' + ui.esc(accent) + '" data-game="' + ui.esc(game.id) + '">' +
      '<div class="hero-banner">' +
        '<span class="hero-banner-text">STREAM LIKE YOU’RE COURTSIDE</span>' +
        '<span class="hero-banner-brand">' + ui.icon('trophy') + ' League Pass</span>' +
        '<button type="button" class="hero-banner-btn" data-action="go-schedule">SIGN UP NOW</button>' +
      '</div>' +
      '<div class="hero-body">' +
        '<div class="hero-scene" aria-hidden="true">' +
          '<span class="hero-glow"></span>' +
          '<svg class="hero-arc" viewBox="0 0 400 400" focusable="false">' +
            '<circle cx="200" cy="330" r="240" fill="none" stroke="currentColor" stroke-width="2"/>' +
            '<circle cx="200" cy="330" r="150" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="6 10"/>' +
            '<path d="M-40 330h480" stroke="currentColor" stroke-width="1.4"/>' +
          '</svg>' +
          '<span class="hero-ball">' + ui.icon('basketball') + '</span>' +
        '</div>' +
        '<div class="hero-copy">' +
          '<div class="hero-topline">' +
            (liveGame ? '<span class="strip-live"><span class="live-dot" aria-hidden="true"></span>LIVE</span>'
              : '<span class="hero-badge">' + ui.esc(final ? 'FINAL' : ui.fmtDate(game.date)) + '</span>') +
            '<span class="hero-sep" aria-hidden="true">·</span>' +
            '<span class="hero-meta">' + ui.esc(ui.fmtDate(game.date)) +
              (game.time ? ' · ' + ui.esc(ui.fmtTime(game.time)) : '') +
              (game.location ? ' · ' + ui.esc(game.location) : '') + '</span>' +
          '</div>' +
          '<div class="hero-score">' +
            heroScoreTeam(away, game.awayScore, final && !homeWon) +
            '<span class="hero-score-dash" aria-hidden="true">–</span>' +
            heroScoreTeam(home, game.homeScore, final && homeWon) +
          '</div>' +
          '<h2 class="hero-title">' + ui.esc(title) + '</h2>' +
          (topPerformers ? '<div class="hero-performers">' + topPerformers + '</div>' : '') +
          '<div class="hero-actions">' +
            (liveGame
              ? '<button type="button" class="btn hero-btn-primary" data-action="hero-live" data-id="' + ui.esc(game.id) + '">' +
                ui.icon('play') + ' WATCH</button>'
              : '<button type="button" class="btn hero-btn-primary" data-action="hero-box" data-id="' + ui.esc(game.id) + '">' +
                ui.icon('play') + ' WATCH</button>') +
            '<button type="button" class="btn hero-btn-ghost" data-action="hero-box" data-id="' + ui.esc(game.id) + '">BOX SCORE</button>' +
          '</div>' +
          (related.length
            ? '<div class="hero-related"><h4>RELATED CONTENT</h4>' +
                related.map(line => '<button type="button" class="hero-related-item" data-action="hero-box" data-id="' +
                  ui.esc(game.id) + '">' + ui.icon('play') + '<span>' + ui.esc(line) + '</span></button>').join('') +
              '</div>'
            : '') +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ------------------------------- headlines ------------------------------- */

  /* A live editorial feed generated from the league itself — no network. */
  function headlineItems(state) {
    const items = [];
    const finals = st.sortByDateDesc(state.games.filter(g => g.status === 'final'));

    finals.slice(0, 4).forEach(g => {
      const home = teamOf(state, g.homeTeamId);
      const away = teamOf(state, g.awayTeamId);
      if (!home || !away) return;
      const winner = Number(g.homeScore) >= Number(g.awayScore) ? home : away;
      const loser = winner.id === home.id ? away : home;
      const winScore = winner.id === home.id ? g.homeScore : g.awayScore;
      const loseScore = winner.id === home.id ? g.awayScore : g.homeScore;
      const top = (g.stats || []).slice().sort((a, b) => b.pts - a.pts)[0];
      const player = top ? state.players.find(p => p.id === top.playerId) : null;
      items.push({
        tag: 'Recap',
        text: player
          ? player.name + ' drops ' + ui.fmtInt(top.pts) + ' as ' + winner.name + ' beat ' + loser.name +
            ' ' + ui.fmtInt(winScore) + '–' + ui.fmtInt(loseScore)
          : winner.name + ' hold off ' + loser.name + ' ' + ui.fmtInt(winScore) + '–' + ui.fmtInt(loseScore),
        gameId: g.id
      });
    });

    const table = st.standings(state.teams, state.games);
    if (table && table.length) {
      const leader = table[0];
      if (leader.team) {
        items.push({
          tag: 'Standings',
          text: leader.team.name + ' lead the table at ' + leader.w + '–' + leader.l +
            ' (' + ui.fmt1(leader.pct * 100) + '% win rate)',
          target: 'standings'
        });
      }
      const streak = table.slice().sort((a, b) => Math.abs(b.streak) - Math.abs(a.streak))[0];
      if (streak && streak.team && Math.abs(streak.streak) > 1) {
        items.push({
          tag: 'Form',
          text: streak.team.name + ' ride a ' + Math.abs(streak.streak) + '-game ' +
            (streak.streak > 0 ? 'winning' : 'losing') + ' streak',
          target: 'standings'
        });
      }
    }

    const board = st.leaderboard(state.players, state.games);
    const scorer = board.ppg && board.ppg[0];
    if (scorer && scorer.value > 0) {
      items.push({
        tag: 'Scoring',
        text: scorer.player.name + ' tops the league at ' + ui.fmt1(scorer.value) + ' points per game',
        target: 'stats'
      });
    }
    const rebounder = board.rpg && board.rpg[0];
    if (rebounder && rebounder.value > 0) {
      items.push({
        tag: 'Boards',
        text: rebounder.player.name + ' leads the glass with ' + ui.fmt1(rebounder.value) + ' rebounds a night',
        target: 'stats'
      });
    }

    const today = TBS.storage.todayISO();
    const next = state.games.filter(g => g.status === 'scheduled' && (g.date || '') >= today)
      .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))[0];
    if (next) {
      const home = teamOf(state, next.homeTeamId);
      const away = teamOf(state, next.awayTeamId);
      items.push({
        tag: 'Up next',
        text: (away ? away.name : 'TBD') + ' at ' + (home ? home.name : 'TBD') + ' on ' + ui.fmtDate(next.date) +
          (next.time ? ', ' + ui.fmtTime(next.time) : ''),
        gameId: next.id
      });
    }

    return items.slice(0, 8);
  }

  function headlinesHtml(state) {
    const items = headlineItems(state);
    if (!items.length) {
      return '<div class="headlines-head"><h2>HEADLINES</h2></div>' +
        '<p class="muted small headlines-empty">Finalize a game and the league writes its own headlines here.</p>';
    }
    return '<div class="headlines-head"><h2>HEADLINES</h2>' +
        '<button type="button" class="headlines-more" data-action="go-standings">See more</button></div>' +
      '<ol class="headlines-list">' +
        items.map(item =>
          '<li><button type="button" class="headline" data-action="' +
            (item.gameId ? 'headline-game' : 'headline-tab') + '"' +
            (item.gameId ? ' data-id="' + ui.esc(item.gameId) + '"' : '') +
            (item.target ? ' data-target="' + ui.esc(item.target) + '"' : '') + '>' +
            '<span class="headline-tag">' + ui.esc(item.tag) + '</span>' +
            '<span class="headline-text">' + ui.esc(item.text) + '</span>' +
          '</button></li>').join('') +
      '</ol>' +
      '<div class="headlines-promo">' +
        '<span class="headlines-promo-icon" aria-hidden="true">' + ui.icon('trophy') + '</span>' +
        '<div><strong>' + ui.esc(state.league.name) + ' Cup</strong>' +
        '<small>Season ' + ui.esc(state.league.season || '—') + ' · live scores, box scores and standings</small></div>' +
      '</div>';
  }

  function render(state) {
    const primaryId = state.league.primaryTeamId;
    const rec = st.teamRecord(state.games, primaryId);
    const finals = state.games.filter(g => g.status === 'final');
    const scheduled = state.games.filter(g => g.status === 'scheduled');
    const liveGames = state.games.filter(g => g.status === 'live');

    const who = TBS.auth && TBS.auth.isSignedIn() ? TBS.auth.displayName(state) : '';
    qs('#dashboard-season').textContent =
      state.league.name + ' · Season ' + (state.league.season || '—') +
      (who ? ' · signed in as ' + who : '');
    const kicker = qs('#dashboard-kicker');
    if (kicker) {
      kicker.textContent = TBS.auth && TBS.auth.role() === 'team'
        ? 'MY CLUB · TEAM ACCOUNT' : 'LEAGUE OVERVIEW · LEAGUE MANAGEMENT';
    }

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

    /* Featured game + editorial feed (broadcast-style hero block). */
    const heroHost = qs('#dashboard-hero');
    if (heroHost) heroHost.innerHTML = heroHtml(state);
    const newsHost = qs('#dashboard-headlines');
    if (newsHost) newsHost.innerHTML = headlinesHtml(state);

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
          ui.statusBadge(g.status, g.halftime) + '</div>').join('') + '</div>' +
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
      else if (action === 'hero-box') {
        if (btn.dataset.id) TBS.boxscores.openGame(btn.dataset.id);
        TBS.app.go('boxscores');
      } else if (action === 'hero-live') {
        if (btn.dataset.id) TBS.live.openGame(btn.dataset.id);
        TBS.app.go('live');
      } else if (action === 'headline-game') {
        if (btn.dataset.id) TBS.boxscores.openGame(btn.dataset.id);
        TBS.app.go('boxscores');
      } else if (action === 'headline-tab') {
        TBS.app.go(btn.dataset.target || 'standings');
      } else if (action === 'recap-box') {
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
