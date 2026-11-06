/* =========================================================================
 * app.js — application wiring, state, tab routing and shared helpers.
 * Loaded LAST. All modules expose {render, init} on window.TBS.
 * There is no build step, no framework, no CDN and no network access.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const storage = TBS.storage;
  const st = TBS.stats;

  const TABS = ['dashboard', 'live', 'schedule', 'boxscores', 'standings',
    'teams', 'stats', 'reports', 'data'];

  const VIEWS = {
    dashboard: 'dashboard',
    live: 'live',
    schedule: 'schedule',
    boxscores: 'boxscores',
    standings: 'standings',
    teams: 'teams',
    stats: 'leaders',
    reports: 'reports',
    data: 'backup'
  };

  let state = storage.loadData();
  let activeTab = 'dashboard';

  function getState() { return state; }
  function activeTabName() { return activeTab; }

  function safeRender(tab) {
    const view = TBS[VIEWS[tab]];
    if (!view || typeof view.render !== 'function') return;
    try { view.render(state); }
    catch (err) {
      console.error('[TeamBallStats] render failed in ' + tab + ':', err);
      ui.toast('Could not render ' + tab + ': ' + err.message, 'error');
    }
  }

  function updateHeader() {
    const rec = st.teamRecord(state.games, state.league.primaryTeamId);
    const el = ui.qs('#header-record');
    if (el) el.textContent = rec.w + '–' + rec.l + (rec.t ? '–' + rec.t : '');
    const sub = ui.qs('#header-subtitle');
    if (sub) sub.textContent = state.league.name + ' · Season ' + state.league.season +
      ' · all data stays in this browser';
    document.title = 'TeamBallStats — ' + state.league.name;
  }

  function renderAll() {
    TABS.forEach(safeRender);
    updateHeader();
  }

  function commit(mutator) {
    if (typeof mutator === 'function') mutator(state);
    const ok = storage.saveData(state);
    if (!ok) ui.toast('Could not save — localStorage may be full or disabled.', 'error');
    renderAll();
    return ok;
  }

  function replace(nextData) {
    state = storage.coerce(nextData);
    const ok = storage.saveData(state);
    if (!ok) ui.toast('Could not save the restored data.', 'error');
    renderAll();
    return ok;
  }

  function activate(tab) {
    const target = TABS.indexOf(tab) >= 0 ? tab : 'dashboard';
    activeTab = target;
    ui.qsa('nav button[data-tab]').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === target));
    ui.qsa('main > section.tab').forEach(section =>
      section.classList.toggle('active', section.id === target));
    safeRender(target);
    updateHeader();
  }

  function go(tab) {
    const target = TABS.indexOf(tab) >= 0 ? tab : 'dashboard';
    const current = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
    if (current === target) activate(target);
    else location.hash = target;
  }

  function team(id) {
    return state.teams.find(t => t.id === id) ||
      { id: id, name: 'Unknown team', short: 'UNK', primary: false };
  }

  function teamName(id) { return team(id).name; }

  function playersFor(teamId) {
    return state.players
      .filter(p => p.teamId === teamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
  }

  function init() {
    /* Module event wiring (one-time, delegated listeners only). */
    TABS.forEach(tab => {
      const view = TBS[VIEWS[tab]];
      if (view && typeof view.init === 'function') {
        try { view.init(); }
        catch (err) { console.error('[TeamBallStats] init failed in ' + tab + ':', err); }
      }
    });

    ui.qsa('nav button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => go(btn.dataset.tab));
    });

    window.addEventListener('hashchange', () => {
      const tab = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      activate(TABS.indexOf(tab) >= 0 ? tab : 'dashboard');
    });

    /* Keep multiple browser tabs in sync (storage events skip the writer). */
    window.addEventListener('storage', e => {
      if (e.key !== storage.DB_KEY || !e.newValue) return;
      state = storage.loadData();
      renderAll();
      ui.toast('Data changed in another tab — view refreshed.', 'info');
    });

    renderAll();
    const initial = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
    activate(TABS.indexOf(initial) >= 0 ? initial : 'dashboard');

    if (state.meta && state.meta.migratedFrom === 'v1') {
      ui.toast('Upgraded your existing v1 data (players, games, schedule) — original saved as a backup.', 'success');
    }
  }

  TBS.app = {
    TABS: TABS,
    init: init,
    getState: getState,
    commit: commit,
    replace: replace,
    renderAll: renderAll,
    refresh: renderAll,
    go: go,
    activate: activate,
    activeTab: activeTabName,
    team: team,
    teamName: teamName,
    playersFor: playersFor
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window.TBS = window.TBS || {});
