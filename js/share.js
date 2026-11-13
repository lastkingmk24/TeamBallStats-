/* =========================================================================
 * share.js — export and sharing actions (DOM glue over summary.js / pdf.js).
 *
 *   Box Scores toolbar:  Box CSV · Game PDF · Share · E-mail
 *   Player Stats:        Player CSV (BOM + formula-safe) · player Share
 *
 * Everything is created on this device. "Share" uses the Web Share API when
 * the browser has it, otherwise copies the text, otherwise shows it in a
 * dialog. "E-mail" opens the user's own mail client (mailto:); TeamBallStats
 * does not send mail itself.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const qs = ui.qs;

  function stamp() {
    return TBS.storage.todayISO();
  }

  function slug(text) {
    return String(text || 'game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';
  }

  function gameFileBase(game, state) {
    const home = state.teams.find(t => t.id === game.homeTeamId);
    const away = state.teams.find(t => t.id === game.awayTeamId);
    return 'teamballstats-' + (game.date || stamp()) + '-' + slug((home ? home.name : 'home') + '-vs-' + (away ? away.name : 'away'));
  }

  function downloadBoxCSV(game) {
    const state = TBS.app.getState();
    const csv = TBS.summary.csvFile(TBS.summary.boxScoreCSV(game, state.players, state.teams, state.league));
    if (ui.download(gameFileBase(game, state) + '-box-score.csv', csv, 'text/csv;charset=utf-8')) {
      ui.toast('Box score CSV downloaded — opens in Excel and Google Sheets.', 'success');
    }
  }

  function downloadGamePDF(game) {
    const state = TBS.app.getState();
    const model = TBS.summary.reportModel(game, state.players, state.teams, state.league,
      { title: 'Game report', generatedAt: stamp() });
    const bytes = TBS.pdf.build(model);
    if (ui.download(gameFileBase(game, state) + '-report.pdf', bytes, 'application/pdf')) {
      ui.toast('Game report PDF downloaded.', 'success');
    }
  }

  function showText(title, text) {
    ui.openModal({
      title: title,
      fields: [{ name: 'text', label: 'Summary (select and copy)', type: 'textarea', value: text }],
      submitLabel: 'Close',
      onSubmit: (values, close) => close()
    });
  }

  /* Share with the platform sheet, else clipboard, else a dialog. */
  function shareText(title, text) {
    if (navigator.share) {
      navigator.share({ title: title, text: text }).catch(err => {
        if (err && err.name === 'AbortError') return;
        copyOrShow(title, text);
      });
      return;
    }
    copyOrShow(title, text);
  }

  function copyOrShow(title, text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => ui.toast('Summary copied to the clipboard.', 'success'),
        () => showText(title, text));
      return;
    }
    showText(title, text);
  }

  function shareGame(game) {
    const state = TBS.app.getState();
    const text = TBS.summary.gameSummaryText(game, state.players, state.teams, state.league);
    shareText('Game summary', text);
  }

  function emailGame(game) {
    const state = TBS.app.getState();
    const subject = 'Game report: ' + (state.teams.find(t => t.id === game.homeTeamId) || { name: 'Home' }).name +
      ' vs ' + (state.teams.find(t => t.id === game.awayTeamId) || { name: 'Away' }).name + ' (' + (game.date || '') + ')';
    const body = TBS.summary.gameSummaryText(game, state.players, state.teams, state.league);
    const href = TBS.summary.mailtoHref(subject, body);
    window.location.href = href;
  }

  function sharePlayer(playerId) {
    const state = TBS.app.getState();
    const player = state.players.find(p => p.id === playerId);
    if (!player) { ui.toast('Player not found.', 'error'); return; }
    const text = TBS.summary.playerSummaryText(player, state.games, state.teams, state.league);
    shareText(player.name + ' — player summary', text);
  }

  function downloadPlayersCSV(players, games, teams) {
    const csv = TBS.summary.csvFile(TBS.stats.toCSV(players, games, teams));
    return ui.download('teamballstats-player-stats-' + stamp() + '.csv', csv, 'text/csv;charset=utf-8');
  }

  function selectedBoxGame() {
    const state = TBS.app.getState();
    const id = TBS.boxscores && TBS.boxscores.selected ? TBS.boxscores.selected() : null;
    return state.games.find(g => g.id === id) || null;
  }

  function init() {
    const bind = (id, fn) => {
      const el = qs(id);
      if (el) el.addEventListener('click', () => {
        const game = selectedBoxGame();
        if (!game) { ui.toast('Choose a game first.', 'error'); return; }
        fn(game);
      });
    };
    bind('#box-csv-btn', downloadBoxCSV);
    bind('#box-pdf-btn', downloadGamePDF);
    bind('#box-share-btn', shareGame);
    bind('#box-email-btn', emailGame);

    /* Delegated: player share buttons in the Player Stats table and profile. */
    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('[data-share-player]');
      if (btn) sharePlayer(btn.dataset.sharePlayer);
    });
  }

  TBS.share = {
    init: init,
    downloadBoxCSV: downloadBoxCSV,
    downloadGamePDF: downloadGamePDF,
    shareGame: shareGame,
    emailGame: emailGame,
    sharePlayer: sharePlayer,
    downloadPlayersCSV: downloadPlayersCSV,
    shareText: shareText
  };
})(window.TBS = window.TBS || {});
