/* =========================================================================
 * profiles.js — the player profile view (a rich modal).
 *
 * Season averages, shooting splits, advanced rates (per-36, +/-), hot/cold
 * form, a scoring sparkline, a canvas shot chart, zone splits, lineup minutes
 * and a per-game log. Also the home of photo replace / remove, which writes
 * players[].photo through TBS.app.commit (never directly to localStorage).
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const st = TBS.stats;
  const an = TBS.analytics;

  let activeClose = null;

  function teamOf(state, id) {
    return state.teams.find(t => t.id === id) || null;
  }

  function seasonGames(state, playerId) {
    return st.sortByDateDesc(state.games.filter(g => g.status === 'final' &&
      (g.stats || []).some(s => s.playerId === playerId)));
  }

  function gameLog(state, player) {
    return seasonGames(state, player.id).map(game => {
      const line = (game.stats || []).find(s => s.playerId === player.id) || {};
      const pm = an.plusMinus(game).byPlayer[player.id] || 0;
      const opponentId = game.homeTeamId === player.teamId ? game.awayTeamId : game.homeTeamId;
      const opponent = teamOf(state, opponentId);
      return {
        game: game,
        line: line,
        plusMinus: pm,
        opponent: opponent ? opponent.name : 'Unknown',
        result: st.resultFor(game, player.teamId),
        home: game.homeTeamId === player.teamId
      };
    });
  }

  function allShots(state, playerId) {
    const events = [];
    state.games.forEach(game => {
      (game.events || []).forEach(e => {
        if (e.playerId === playerId && e.shot) {
          events.push(Object.assign({}, e, {
            teamId: e.teamId || playerId
          }));
        }
      });
    });
    return an.shotZones({ events: events });
  }

  function totalPlusMinus(state, playerId) {
    let total = 0;
    let games = 0;
    state.games.filter(g => g.status === 'final').forEach(game => {
      const has = (game.stats || []).some(s => s.playerId === playerId) ||
        (game.events || []).some(e => e.playerId === playerId);
      if (!has) return;
      const value = an.plusMinus(game).byPlayer[playerId];
      if (value === undefined || !an.plusMinus(game).tracked) return;
      total += Number(value) || 0;
      games++;
    });
    return { total: total, games: games };
  }

  function lineupMinutes(state, playerId) {
    let seconds = 0;
    let games = 0;
    state.games.forEach(game => {
      const m = an.minutesFromLineup(game, state.league);
      if (m.byPlayer[playerId] !== undefined) {
        seconds += m.byPlayer[playerId];
        games++;
      }
    });
    return { seconds: seconds, games: games, minutes: Math.round(seconds / 60) };
  }

  function statTile(label, value, detail) {
    return '<div class="stat-tile"><span class="stat-tile-label">' + ui.esc(label) + '</span>' +
      '<span class="stat-tile-value">' + value + '</span>' +
      (detail ? '<span class="stat-tile-detail">' + detail + '</span>' : '') + '</div>';
  }

  function splitBar(label, made, attempted) {
    const value = st.pct(made, attempted);
    const width = value === null ? 0 : Math.max(0, Math.min(100, value));
    return '<div class="split-row"><span class="split-label">' + ui.esc(label) + '</span>' +
      '<span class="split-track"><span class="split-fill" style="width:' + width.toFixed(1) + '%"></span></span>' +
      '<span class="split-value">' + ui.fmtInt(made) + '/' + ui.fmtInt(attempted) + ' · ' +
      ui.fmtPct(value) + '</span></div>';
  }

  function streakBadge(streak) {
    if (streak.label === 'hot') return ui.badge('Hot · ' + ui.fmt1(streak.recentAvg) + ' PPG', 'hot');
    if (streak.label === 'cold') return ui.badge('Cold · ' + ui.fmt1(streak.recentAvg) + ' PPG', 'cold');
    return ui.badge('Steady form', 'final');
  }

  function bodyHtml(state, player) {
    const team = teamOf(state, player.teamId);
    const agg = st.playerAggregate(player.id, state.games);
    const totals = agg.totals;
    const per = an.per36(agg);
    const streak = an.streaks(player.id, state.games);
    const pm = totalPlusMinus(state, player.id);
    const lineup = lineupMinutes(state, player.id);
    const log = gameLog(state, player);
    const shots = allShots(state, player.id);
    const splits = st.shooting(totals);

    const tiles = [
      statTile('Games', ui.fmtInt(agg.gp), ui.fmtInt(totals.min) + ' MIN total'),
      statTile('PPG', ui.fmt1(agg.ppg), ui.fmtInt(totals.pts) + ' PTS'),
      statTile('RPG', ui.fmt1(agg.rpg), ui.fmtInt(totals.reb) + ' REB'),
      statTile('APG', ui.fmt1(agg.apg), ui.fmtInt(totals.ast) + ' AST'),
      statTile('eFG%', ui.fmtPct(splits.efgPct), 'effective FG'),
      statTile('TS%', ui.fmtPct(splits.tsPct), 'true shooting'),
      statTile('+/−', pm.games ? ui.fmtSigned(pm.total) : '—',
        pm.games ? 'across ' + pm.games + ' tracked games' : 'no scoring plays yet'),
      statTile('MPG', ui.fmt1(agg.mpg), lineup.games
        ? 'lineup clock: ' + ui.fmtInt(lineup.minutes) + ' MIN'
        : 'from box scores')
    ].join('');

    const logRows = log.map(row => '<tr' +
      ' class="gamelog-row" data-action="open-game" data-id="' + ui.esc(row.game.id) + '" tabindex="0">' +
      '<td>' + ui.fmtDate(row.game.date) + '</td>' +
      '<td>' + (row.home ? 'vs ' : '@ ') + ui.esc(row.opponent) + '</td>' +
      '<td>' + ui.resultBadge(row.result) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.min) + '</td>' +
      '<td class="align-right"><strong>' + ui.fmtInt(row.line.pts) + '</strong></td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.reb) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.ast) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.stl) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.blk) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.tov) + '</td>' +
      '<td class="align-right">' + (an.plusMinus(row.game).tracked
        ? ui.fmtSigned(row.plusMinus) : '—') + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.fgm) + '/' + ui.fmtInt(row.line.fga) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.tpm) + '/' + ui.fmtInt(row.line.tpa) + '</td>' +
      '<td class="align-right">' + ui.fmtInt(row.line.ftm) + '/' + ui.fmtInt(row.line.fta) + '</td>' +
      '</tr>').join('');

    const zoneRows = shots.zones.map(z =>
      '<tr><td>' + ui.esc(z.zone) + '</td>' +
      '<td class="align-right">' + z.made + '</td>' +
      '<td class="align-right">' + z.attempts + '</td>' +
      '<td class="align-right">' + ui.fmtPct(z.pct) + '</td></tr>').join('');

    return '<div class="profile">' +
      '<div class="profile-head">' +
        '<div class="profile-avatar">' + ui.avatar(player, { size: 'xl', team: team }) + '</div>' +
        '<div class="profile-identity">' +
          '<h4 class="profile-name">' + ui.esc(player.name) +
            '<span class="profile-number">#' + ui.esc(player.number) + '</span></h4>' +
          '<div class="profile-meta">' +
            (team ? ui.teamTag(team) : '<span class="muted">No team</span>') +
            ' <span class="pill">' + ui.esc(player.position || 'No position') + '</span>' +
            (player.active === false ? ' ' + ui.badge('Inactive', 'other') : ' ' + ui.badge('Active', 'final')) +
            ' ' + streakBadge(streak) +
          '</div>' +
          '<div class="profile-actions">' +
            '<button type="button" class="btn btn-mini" data-action="edit-player">Edit details</button>' +
            '<button type="button" class="btn btn-mini" data-action="change-photo">' +
              ui.icon('camera') + (player.photo ? ' Replace photo' : ' Add photo') + '</button>' +
            (player.photo ? '<button type="button" class="btn btn-mini" data-action="remove-photo">Remove photo</button>' : '') +
            '<button type="button" class="btn btn-mini" data-action="print-player">' + ui.icon('print') + ' Print profile</button>' +
            '<button type="button" class="btn btn-mini" data-share-player="' + ui.esc(player.id) + '">Share summary</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="stat-tile-grid">' + tiles + '</div>' +
      '<div class="profile-columns">' +
        '<div class="profile-block">' +
          '<h5 class="profile-section-title">Shooting splits</h5>' +
          splitBar('FG', totals.fgm, totals.fga) +
          splitBar('3PT', totals.tpm, totals.tpa) +
          splitBar('FT', totals.ftm, totals.fta) +
          '<div class="per36-row"><span>Per 36 min</span><strong>' + ui.fmt1(per.pts) + ' PTS · ' +
            ui.fmt1(per.reb) + ' REB · ' + ui.fmt1(per.ast) + ' AST</strong></div>' +
          '<div class="per36-row"><span>Form</span><strong>' + (streak.label === 'neutral'
            ? 'steady' : streak.label) + ' · last five ' + ui.fmt1(streak.recentAvg) +
            ' PPG vs ' + ui.fmt1(streak.seasonAvg) + ' season</strong></div>' +
        '</div>' +
        '<div class="profile-block">' +
          '<h5 class="profile-section-title">Scoring form</h5>' +
          '<canvas id="profile-spark" class="chart-canvas" role="img" ' +
            'aria-label="Points per game over recent games"></canvas>' +
          '<p class="muted small" style="margin-top:.4rem">Points in each final game, oldest to newest.</p>' +
        '</div>' +
      '</div>' +
      '<h5 class="profile-section-title">Shot chart</h5>' +
      '<canvas id="profile-shots" class="chart-canvas shot-canvas" role="img" ' +
        'aria-label="Shot chart for ' + ui.esc(player.name) + '"></canvas>' +
      (zoneRows ? '<div class="profile-zone-table table-scroll"><table class="data-table"><thead><tr>' +
        '<th scope="col">Zone</th><th scope="col" class="align-right">Make</th>' +
        '<th scope="col" class="align-right">Att</th><th scope="col" class="align-right">%</th>' +
        '</tr></thead><tbody>' + zoneRows + '</tbody></table></div>' : '') +
      '<h5 class="profile-section-title">Game log <span class="muted small">(' +
        log.length + ' final games)</span></h5>' +
      (log.length ? '<div class="table-scroll"><table class="data-table gamelog">' +
        '<thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th>' +
        '<th scope="col" class="align-right">MIN</th><th scope="col" class="align-right">PTS</th>' +
        '<th scope="col" class="align-right">REB</th><th scope="col" class="align-right">AST</th>' +
        '<th scope="col" class="align-right">STL</th><th scope="col" class="align-right">BLK</th>' +
        '<th scope="col" class="align-right">TOV</th><th scope="col" class="align-right">+/−</th>' +
        '<th scope="col" class="align-right">FG</th><th scope="col" class="align-right">3PT</th>' +
        '<th scope="col" class="align-right">FT</th></tr></thead><tbody>' + logRows +
        '</tbody></table></div>'
        : ui.emptyState('No games logged yet', 'Finalize a game in the Live Console to build this player’s game log.')) +
      '<p class="footnote">+/− uses the play-by-play and the on-court lineup when substitutions are recorded; ' +
        'without substitution data every player who appears in the box score is treated as on court.</p>' +
      '</div>';
  }

  function drawCharts(overlay, player) {
    const state = TBS.app.getState();
    const streak = an.streaks(player.id, state.games);
    const spark = overlay.querySelector('#profile-spark');
    if (spark) TBS.shotchart.drawSparkline(spark, streak.series, { color: '#c8102e' });
    const chart = overlay.querySelector('#profile-shots');
    if (chart) {
      const team = teamOf(state, player.teamId);
      TBS.shotchart.drawShots(chart, allShots(state, player.id).shots, {
        color: (team && team.color) || '#c8102e'
      });
    }
  }

  function setPhoto(playerId, dataUrl) {
    const state = TBS.app.getState();
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;
    const previous = player.photo || '';
    if (dataUrl) {
      const warning = TBS.photos.quotaMessage(TBS.photos.bytesOf(dataUrl));
      if (warning) { ui.toast(warning, 'error'); return; }
    }
    const ok = TBS.app.commit(d => {
      const p = d.players.find(x => x.id === playerId);
      if (p) p.photo = dataUrl || '';
    });
    if (!ok) {
      TBS.app.commit(d => {
        const p = d.players.find(x => x.id === playerId);
        if (p) p.photo = previous;
      });
      ui.toast('Could not save that photo — browser storage is full. Remove another photo, ' +
        'export a backup, then try a smaller image.', 'error');
      return;
    }
    ui.toast(dataUrl ? 'Photo saved.' : 'Photo removed.', 'success');
    open(playerId);
  }

  function wire(overlay, close, player) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    input.setAttribute('aria-hidden', 'true');
    overlay.appendChild(input);
    TBS.photos.bindInput(input, {
      onPhoto: dataUrl => setPhoto(player.id, dataUrl),
      onError: message => ui.toast(message, 'error')
    });

    overlay.addEventListener('click', e => {
      const target = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'change-photo') { input.click(); return; }
      if (action === 'remove-photo') {
        if (ui.confirmDanger('Remove ' + player.name + '’s photo? Their initials avatar returns.')) {
          setPhoto(player.id, '');
        }
        return;
      }
      if (action === 'edit-player') {
        close();
        if (TBS.teams && TBS.teams.openEditPlayer) TBS.teams.openEditPlayer(player.id);
        return;
      }
      if (action === 'print-player') {
        close();
        if (TBS.reports && TBS.reports.printPlayer) TBS.reports.printPlayer(player.id);
        return;
      }
      if (action === 'open-game') {
        const id = target.dataset.id;
        close();
        if (TBS.boxscores && id) {
          TBS.boxscores.openGame(id);
          TBS.app.go('boxscores');
        }
      }
    });

    overlay.addEventListener('keydown', e => {
      const row = e.target.closest ? e.target.closest('[data-action="open-game"]') : null;
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        row.click();
      }
    });
  }

  function open(playerId) {
    const state = TBS.app.getState();
    const player = state.players.find(p => p.id === playerId);
    if (!player) { ui.toast('That player no longer exists.', 'error'); return; }
    if (activeClose) {
      const previous = activeClose;
      activeClose = null;
      previous();
    }
    const ref = { close: null };
    const close = ui.openDialog({
      title: 'Player profile',
      className: 'modal-wide',
      bodyHtml: bodyHtml(state, player),
      onMount: overlay => {
        drawCharts(overlay, player);
        wire(overlay, () => ref.close && ref.close(), player);
      },
      onClose: () => { if (activeClose === ref.close) activeClose = null; }
    });
    ref.close = close;
    activeClose = close;
  }

  function init() {
    document.addEventListener('click', e => {
      const trigger = e.target.closest ? e.target.closest('[data-profile]') : null;
      if (!trigger) return;
      const id = trigger.getAttribute('data-profile');
      if (!id) return;
      e.preventDefault();
      open(id);
    });
  }

  TBS.profiles = {
    render: function () { /* modal only — nothing to render on a tab */ },
    init: init,
    open: open,
    bodyHtml: bodyHtml,
    gameLog: gameLog,
    allShots: allShots,
    totalPlusMinus: totalPlusMinus,
    lineupMinutes: lineupMinutes
  };
})(window.TBS = window.TBS || {});
