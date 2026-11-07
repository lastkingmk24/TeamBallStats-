/* =========================================================================
 * leaders.js — Player Statistics tab: season averages, shooting splits,
 * advanced rates (per-36, +/−, hot/cold form, shot zones), a searchable and
 * sortable table with team + season filters, and the CSV export.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;
  const qs = ui.qs;

  let filterTeam = 'all';
  let filterSeason = 'all';

  function teamOf(state, id) {
    return state.teams.find(x => x.id === id) || null;
  }

  function teamName(state, id) {
    const t = teamOf(state, id);
    return t ? t.name : 'Unknown team';
  }

  function gamesInScope(state) {
    return st.gamesForSeason(state.games, filterSeason, state.league.season);
  }

  function plusMinusFor(playerId, games) {
    let total = 0;
    let tracked = 0;
    games.forEach(game => {
      if (game.status !== 'final') return;
      const pm = an.plusMinus(game);
      if (!pm.tracked || pm.byPlayer[playerId] === undefined) return;
      total += pm.byPlayer[playerId];
      tracked++;
    });
    return { total: total, games: tracked };
  }



  function render(state) {
    const select = qs('#stats-team-filter');
    const previous = select.value;
    select.innerHTML = '<option value="all">All teams</option>' +
      ui.teamOptions(state.teams, filterTeam);
    select.value = (previous && Array.from(select.options).some(o => o.value === previous))
      ? previous : filterTeam;
    filterTeam = select.value;

    const seasonSelect = qs('#stats-season-filter');
    if (seasonSelect) {
      const previousSeason = seasonSelect.value;
      const seasons = st.seasonsOf(state.games, state.league.season);
      seasonSelect.innerHTML = '<option value="all">All seasons</option>' +
        ui.options(seasons.map(s => ({ value: s, label: s })), filterSeason);
      if (previousSeason && Array.from(seasonSelect.options).some(o => o.value === previousSeason)) {
        seasonSelect.value = previousSeason;
      } else if (!Array.from(seasonSelect.options).some(o => o.value === filterSeason)) {
        filterSeason = 'all';
      }
      seasonSelect.value = filterSeason;
    }

    const games = gamesInScope(state);
    const players = state.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);
    const primaryId = state.league.primaryTeamId;
    const rec = st.teamRecord(games, primaryId);
    const board = st.leaderboard(players, games);
    const topScorer = board.ppg[0];
    const totalPoints = players.reduce((a, p) => a + st.playerAggregate(p.id, games).totals.pts, 0);

    qs('#stats-summary').innerHTML = [
      { label: 'Players', value: players.length, detail: state.teams.length + ' teams in league' },
      { label: 'My team record', value: rec.w + '–' + rec.l, detail: rec.gp + ' final games · ' + rec.streak + ' streak', accent: true },
      { label: 'Total points', value: ui.fmtInt(totalPoints), detail: 'Across all filtered players' },
      { label: 'Leading scorer', value: topScorer ? ui.fmt1(topScorer.value) : '—', detail: topScorer ? topScorer.player.name + ' PPG' : 'No final games yet' }
    ].map(c => '<div class="card stat-card' + (c.accent ? ' accent' : '') + '">' +
      '<div class="label">' + ui.esc(c.label) + '</div>' +
      '<div class="value">' + ui.esc(c.value) + '</div>' +
      '<div class="detail">' + ui.esc(c.detail) + '</div></div>').join('');

    const cards = [
      { key: 'ppg', title: 'Points per game', fmt: v => ui.fmt1(v) },
      { key: 'rpg', title: 'Rebounds per game', fmt: v => ui.fmt1(v) },
      { key: 'apg', title: 'Assists per game', fmt: v => ui.fmt1(v) },
      { key: 'spg', title: 'Steals per game', fmt: v => ui.fmt1(v) },
      { key: 'bpg', title: 'Blocks per game', fmt: v => ui.fmt1(v) },
      { key: 'fgPct', title: 'FG% (min 10 FGA)', fmt: v => ui.fmtPct(v) }
    ];
    qs('#stats-leaders').innerHTML = cards.map(c => {
      const list = board[c.key];
      return '<div class="leader-card"><h4>' + ui.esc(c.title) + '</h4><ol>' +
        (list.length ? list.map(x =>
          '<li>' + ui.playerCell(x.player, { team: teamOf(state, x.player.teamId), size: 'sm' }) +
          '<span>' + ui.esc(c.fmt(x.value)) + '</span></li>'
        ).join('') : '<li><span class="muted">No qualified players</span><span>—</span></li>') +
        '</ol></div>';
    }).join('');

    /* ------------------------- advanced analytics ------------------------- */
    const rows = players.map(p => ({
      p: p,
      state: state,
      agg: st.playerAggregate(p.id, games),
      per: an.per36(st.playerAggregate(p.id, games)),
      streak: an.streaks(p.id, games),
      pm: plusMinusFor(p.id, games)
    }));
    const per36Rows = rows.filter(r => r.per.qualified);
    const hot = rows.filter(r => r.streak.label === 'hot').slice(0, 4);
    const cold = rows.filter(r => r.streak.label === 'cold').slice(0, 4);
    const pmRows = rows.filter(r => r.pm.games > 0)
      .sort((a, b) => b.pm.total - a.pm.total).slice(0, 5);
    const shots = an.shotZones({ events: games.reduce((acc, game) =>
      acc.concat((game.events || []).filter(e => e.shot)), []) });

    const host = qs('#stats-analytics');
    if (host) {
      host.innerHTML =
        '<div class="analytics-grid">' +
          '<div class="leader-card"><h4>Per-36 minutes · points</h4><ol>' +
            (per36Rows.length ? per36Rows.slice().sort((a, b) => b.per.pts - a.per.pts).slice(0, 5)
              .map(row => '<li>' + ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'sm' }) +
                '<span>' + ui.fmt1(row.per.pts) + '</span></li>').join('')
              : '<li><span class="muted">No minutes logged yet</span><span>—</span></li>') +
          '</ol></div>' +
          '<div class="leader-card"><h4>Hot hands (last five)</h4><ol>' +
            (hot.length ? hot.map(row => '<li>' +
              ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'sm' }) +
              '<span>' + ui.fmt1(row.streak.recentAvg) + ' PPG</span></li>').join('')
              : '<li><span class="muted">Nobody is on a hot streak</span><span>—</span></li>') +
          '</ol></div>' +
          '<div class="leader-card"><h4>Cold stretches</h4><ol>' +
            (cold.length ? cold.map(row => '<li>' +
              ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'sm' }) +
              '<span>' + ui.fmt1(row.streak.recentAvg) + ' PPG</span></li>').join('')
              : '<li><span class="muted">No cold stretches right now</span><span>—</span></li>') +
          '</ol></div>' +
          '<div class="leader-card"><h4>Best +/−</h4><ol>' +
            (pmRows.length ? pmRows.map(row => '<li>' +
              ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'sm' }) +
              '<span>' + ui.fmtSigned(row.pm.total) + '</span></li>').join('')
              : '<li><span class="muted">Record plays in the Live Console</span><span>—</span></li>') +
          '</ol></div>' +
          '<div class="leader-card analytics-wide"><h4>Shot chart coverage</h4>' +
            '<p class="muted small">' + (shots.total
              ? shots.total + ' located shots · ' + shots.made + ' made · ' + ui.fmtPct(shots.pct) +
                ' · zones: ' + shots.zones.map(z => z.zone + ' ' + ui.fmtPct(z.pct)).join(', ')
              : 'No shot locations yet — tap the court in the Live Console before a shot.') + '</p>' +
          '</div>' +
        '</div>';
    }

    /* ----------------------------- full table ----------------------------- */
    const tableRows = rows.slice().sort((x, y) => y.agg.ppg - x.agg.ppg ||
      (Number(x.p.number) || 999) - (Number(y.p.number) || 999));
    qs('#stats-table').innerHTML = players.length
      ? ui.smartTable({
        id: 'stats',
        searchPlaceholder: 'Search players by name, team or position…',
        searchText: row => [row.p.name, row.p.number, row.p.position,
          teamName(state, row.p.teamId)].join(' '),
        sortKey: 'ppg',
        dir: 'desc',
        rows: tableRows,
        empty: 'No players match this search.',
        columns: [
          { label: '#', key: 'number', sortValue: row => Number(row.p.number) || 999,
            align: 'right', render: row => '<span class="jnum jnum-standalone">' +
              ui.esc(row.p.number) + '</span>' },
          { label: 'Player', key: 'name', sortValue: row => row.p.name, render: row =>
              ui.playerCell(row.p, { team: teamOf(state, row.p.teamId), size: 'md',
                sub: row.p.position || '' }) },
          { label: 'Team', key: 'team', sortValue: row => teamName(state, row.p.teamId),
            render: row => ui.esc(teamName(state, row.p.teamId)) },
          { label: 'GP', key: 'gp', sortValue: row => row.agg.gp, align: 'right',
            render: row => ui.fmtInt(row.agg.gp) },
          { label: 'MIN', key: 'min', sortValue: row => row.agg.totals.min, align: 'right',
            render: row => ui.fmtInt(row.agg.totals.min) },
          { label: 'PTS', key: 'pts', sortValue: row => row.agg.totals.pts, align: 'right',
            render: row => ui.fmtInt(row.agg.totals.pts) },
          { label: 'PPG', key: 'ppg', sortValue: row => row.agg.ppg, align: 'right',
            render: row => '<strong>' + ui.fmt1(row.agg.ppg) + '</strong>' },
          { label: 'RPG', key: 'rpg', sortValue: row => row.agg.rpg, align: 'right',
            render: row => ui.fmt1(row.agg.rpg) },
          { label: 'APG', key: 'apg', sortValue: row => row.agg.apg, align: 'right',
            render: row => ui.fmt1(row.agg.apg) },
          { label: 'SPG', key: 'spg', sortValue: row => row.agg.spg, align: 'right',
            render: row => ui.fmt1(row.agg.spg) },
          { label: 'BPG', key: 'bpg', sortValue: row => row.agg.bpg, align: 'right',
            render: row => ui.fmt1(row.agg.bpg) },
          { label: 'TOV', key: 'tov', sortValue: row => row.agg.totals.tov, align: 'right',
            render: row => ui.fmtInt(row.agg.totals.tov) },
          { label: 'FG%', key: 'fg', sortValue: row => row.agg.fgPct === null ? -1 : row.agg.fgPct,
            align: 'right', render: row => ui.fmtPct(row.agg.fgPct) },
          { label: '3P%', key: 'tp', sortValue: row => row.agg.tpPct === null ? -1 : row.agg.tpPct,
            align: 'right', render: row => ui.fmtPct(row.agg.tpPct) },
          { label: 'FT%', key: 'ft', sortValue: row => row.agg.ftPct === null ? -1 : row.agg.ftPct,
            align: 'right', render: row => ui.fmtPct(row.agg.ftPct) },
          { label: 'eFG%', key: 'efg', sortValue: row => row.agg.efgPct === null ? -1 : row.agg.efgPct,
            align: 'right', render: row => ui.fmtPct(row.agg.efgPct) },
          { label: 'TS%', key: 'ts', sortValue: row => row.agg.tsPct === null ? -1 : row.agg.tsPct,
            align: 'right', render: row => ui.fmtPct(row.agg.tsPct) },
          { label: 'P36', key: 'p36', sortValue: row => row.per.pts, align: 'right',
            render: row => row.per.qualified ? ui.fmt1(row.per.pts) : '—' },
          { label: '+/−', key: 'pm', sortValue: row => row.pm.games ? row.pm.total : -999,
            align: 'right', render: row => row.pm.games ? ui.fmtSigned(row.pm.total) : '—' },
          { label: 'PF', key: 'pf', sortValue: row => row.agg.totals.pf, align: 'right',
            render: row => ui.fmtInt(row.agg.totals.pf) }
        ]
      })
      : ui.emptyState('No players to show', 'Add players in Teams & Roster, then log games.',
          '<button type="button" class="btn btn-primary" data-action="go-teams">Add players</button>');
  }

  function init() {
    qs('#stats-team-filter').addEventListener('change', e => {
      filterTeam = e.target.value;
      render(TBS.app.getState());
    });
    const seasonSelect = qs('#stats-season-filter');
    if (seasonSelect) {
      seasonSelect.addEventListener('change', e => {
        filterSeason = e.target.value;
        render(TBS.app.getState());
      });
    }
    qs('#export-csv').addEventListener('click', () => {
      const state = TBS.app.getState();
      const games = gamesInScope(state);
      const players = state.players.filter(p => filterTeam === 'all' || p.teamId === filterTeam);
      if (!players.length) { ui.toast('No players to export.', 'error'); return; }
      const csv = st.toCSV(players, games, state.teams);
      if (ui.download('teamballstats-player-stats-' + TBS.storage.todayISO() + '.csv',
          csv, 'text/csv;charset=utf-8')) {
        ui.toast('CSV exported (' + players.length + ' players).', 'success');
      }
    });
    qs('#stats-table').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn && btn.dataset.action === 'go-teams') TBS.app.go('teams');
    });
    qs('#stats-analytics').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn && btn.dataset.action === 'go-teams') TBS.app.go('teams');
    });
  }

  TBS.leaders = { render: render, init: init };
})(window.TBS = window.TBS || {});
