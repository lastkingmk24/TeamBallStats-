/* =========================================================================
 * export.js — Data tab: league settings (including the league default theme),
 * single-file JSON backup/restore and the reset switch.
 *
 * Imports run through storage.coerce(), i.e. the EXACT same migration path as
 * loadData(): v1, v2 and v3 documents are all accepted, and nothing is ever
 * truncated. Merge never overwrites an existing team, player or game.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const storage = TBS.storage;
  const qs = ui.qs;

  let pending = null;
  let pendingName = '';

  function summaryHtml(counts, label) {
    return '<strong>' + ui.esc(label) + '</strong><br />' +
      'Schema v' + counts.version + ' · ' + counts.teams + ' teams · ' +
      counts.players + ' players' + (counts.photos ? ' (' + counts.photos + ' with photos)' : '') + ' · ' +
      counts.games + ' games (' + counts.finalGames + ' final) · ' +
      counts.statLines + ' player box-score lines · ' + counts.playEvents + ' play-by-play events · ' +
      counts.events + ' calendar events';
  }

  function setIfIdle(selector, value) {
    const el = qs(selector);
    if (!el || document.activeElement === el) return;
    el.value = value;
  }


  function mergeData(current, incoming) {
    return TBS.merge.mergeData(current, incoming);
  }

  function migrationText(state) {
    const upgrades = (state.meta && Array.isArray(state.meta.upgrades)) ? state.meta.upgrades : [];
    if (!upgrades.length && !(state.meta && state.meta.migratedFrom)) {
      return 'Schema v3 (no legacy migration needed).';
    }
    const steps = upgrades.map(step => 'v' + step.from + ' → v' + step.to).join(', ');
    if (state.meta && state.meta.migratedFrom) {
      return 'Upgraded in place from ' + state.meta.migratedFrom + ' on ' +
        ui.fmtDate(String(state.meta.migratedAt || '').slice(0, 10)) +
        (steps ? ' · steps: ' + steps : '') + '.';
    }
    return 'Upgraded in place' + (steps ? ' · steps: ' + steps : '') + '.';
  }

  function render(state) {
    const primary = state.teams.find(t => t.id === state.league.primaryTeamId);
    setIfIdle('#setting-league-name', state.league.name);
    setIfIdle('#setting-season', state.league.season);
    setIfIdle('#setting-team-name', primary ? primary.name : '');
    setIfIdle('#setting-quarters', state.league.quarters);
    setIfIdle('#setting-quarter-minutes', state.league.quarterMinutes);
    setIfIdle('#setting-shot-clock', state.league.shotClock || 0);
    setIfIdle('#setting-theme', state.league.theme || 'system');

    const counts = storage.summarize(state);
    const usage = storage.usage();
    const themeChoice = TBS.theme && TBS.theme.readStored ? TBS.theme.readStored() : null;
    qs('#storage-info').innerHTML =
      'Stored under <code>' + storage.DB_KEY + '</code> · ~' + usage.database + ' KB league data · ' +
      usage.kb + ' KB total in this browser · ' + counts.players + ' players (' +
      counts.photos + ' photos), ' + counts.games + ' games, ' + counts.events + ' events. ' +
      migrationText(state) + ' ' +
      'Appearance: this device uses <strong>' + ui.esc(themeChoice || 'the OS preference') + '</strong>' +
      ' (league default: ' + ui.esc(state.league.theme || 'system') + '). ' +
      'Export a JSON backup before resetting. Accounts on this device are kept separately.';

    const legacyBtn = qs('#export-legacy');
    legacyBtn.hidden = !storage.legacyBackup();
    if (pending) qs('#import-summary').innerHTML = summaryHtml(storage.summarize(pending), 'Ready: ' + pendingName);
  }

  function readFile(file) {
    pending = null;
    pendingName = file ? file.name : '';
    qs('#import-summary').innerHTML = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not an object');
        if (!Array.isArray(parsed.players) && !Array.isArray(parsed.teams)) {
          throw new Error('Missing players/teams arrays');
        }
        pending = storage.withoutCredentials(parsed);
        const sourceVersion = storage.detectVersion(parsed);
        qs('#import-summary').innerHTML = summaryHtml(storage.summarize(parsed),
          'Ready: ' + pendingName + ' (source schema v' + sourceVersion + ')');
        ui.toast('Backup validated. Choose merge or replace, then import.', 'success');
      } catch (err) {
        pending = null;
        qs('#import-summary').textContent = 'Invalid backup: ' + err.message +
          '. Expected a TeamBallStats JSON file.';
        ui.toast('That file is not a valid backup.', 'error');
      }
    };
    reader.onerror = () => {
      pending = null;
      ui.toast('Could not read the file.', 'error');
    };
    reader.readAsText(file);
  }

  function init() {
    qs('#settings-form').addEventListener('submit', e => {
      e.preventDefault();
      const leagueName = qs('#setting-league-name').value.trim();
      const teamName = qs('#setting-team-name').value.trim();
      const season = qs('#setting-season').value.trim();
      const quarters = storage.num(qs('#setting-quarters').value, 4);
      const minutes = storage.num(qs('#setting-quarter-minutes').value, 10);
      const shotField = qs('#setting-shot-clock');
      const shotValue = shotField ? Math.max(0, Math.min(60, Math.round(storage.num(shotField.value, 0)))) : 0;
      const themeField = qs('#setting-theme');
      const themeValue = themeField ? storage.normalizeTheme(themeField.value) : 'system';
      if (!leagueName || !teamName) return;
      TBS.app.commit(d => {
        d.league.name = leagueName;
        d.league.season = season;
        d.league.quarters = Math.max(1, Math.min(8, Math.round(quarters)));
        d.league.quarterMinutes = Math.max(1, Math.min(60, Math.round(minutes)));
        d.league.shotClock = shotValue;
        d.league.theme = themeValue;
        const t = d.teams.find(x => x.id === d.league.primaryTeamId);
        if (t) {
          const previousAuto = t.name.slice(0, 3).toUpperCase();
          t.name = teamName;
          if (!t.short || t.short === previousAuto) t.short = teamName.slice(0, 3).toUpperCase();
        }
      });
      if (TBS.theme) TBS.theme.refresh(themeValue);
      qs('#settings-save-info').textContent = 'Saved just now.';
      ui.toast('League settings saved.', 'success');
    });

    qs('#export-json').addEventListener('click', () => {
      const state = TBS.app.getState();
      const payload = Object.assign({}, storage.withoutCredentials(state), {
        version: storage.SCHEMA_VERSION,
        app: 'TeamBallStats',
        schema: storage.DB_KEY,
        exportedAt: new Date().toISOString()
      });
      if (ui.download('teamballstats-backup-' + storage.todayISO() + '.json',
          JSON.stringify(payload, null, 2), 'application/json')) {
        ui.toast('Full JSON backup downloaded (schema v' + storage.SCHEMA_VERSION + ').', 'success');
      }
    });

    qs('#export-legacy').addEventListener('click', () => {
      const raw = storage.legacyBackup();
      if (!raw) return;
      ui.download('teamballstats-v1-original-' + storage.todayISO() + '.json', raw, 'application/json');
    });

    qs('#import-file').addEventListener('change', e => readFile(e.target.files[0]));

    qs('#import-btn').addEventListener('click', () => {
      if (!pending) { ui.toast('Choose a valid .json backup first.', 'error'); return; }
      const mode = (qs('input[name="import-mode"]:checked') || {}).value || 'merge';
      if (mode === 'replace') {
        if (!ui.confirmDanger('Replace ALL current data with this backup? ' +
          'This cannot be undone unless you export first.')) return;
        TBS.app.replace(storage.coerce(pending));
        ui.toast('Backup restored (replace) · migrated to schema v' + storage.SCHEMA_VERSION + '.', 'success');
      } else {
        const merged = mergeData(TBS.app.getState(), pending);
        TBS.app.replace(merged);
        ui.toast('Backup merged into current league.', 'success');
      }
      pending = null;
      qs('#import-file').value = '';
      qs('#import-summary').innerHTML = 'Import complete — check Standings and Box Scores.';
    });

    qs('#reset-data').addEventListener('click', () => {
      if (!ui.confirmDanger('Erase ALL data (teams, players, games, box scores, schedule and ' +
        'settings)? Accounts on this device are kept. Export a backup first. This cannot be undone.')) return;
      storage.resetData();
      TBS.app.replace(storage.defaultData());
      pending = null;
      qs('#import-summary').textContent = '';
      ui.toast('All data reset.', 'success');
    });
  }

  TBS.backup = {
    render: render, init: init, mergeData: mergeData, summaryHtml: summaryHtml
  };
})(window.TBS = window.TBS || {});
