/* =========================================================================
 * app.js — application wiring: state, tab/hash routing, sticky header with
 * record + live ticker, cross-tab sync, theme boot and module initialisation.
 * Loaded LAST. Every module exposes {render, init} on window.TBS.
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
  let started = false;
  let tickerTimer = null;

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

  function teamOf(id) {
    return state.teams.find(t => t.id === id) || null;
  }

  function team(id) {
    return teamOf(id) || { id: id, name: 'Unknown team', short: 'UNK', color: '', primary: false };
  }

  function teamName(id) { return team(id).name; }

  function playersFor(teamId) {
    return state.players
      .filter(p => p.teamId === teamId && p.active !== false)
      .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
  }

  function remainingSeconds(game, now) {
    const base = Number(game.clockSeconds) || 0;
    if (!game.clockRunningSince) return base;
    return Math.max(0, base - ((now || Date.now()) - Number(game.clockRunningSince)) / 1000);
  }

  function updateHeader() {
    const rec = st.teamRecord(state.games, state.league.primaryTeamId);
    const el = ui.qs('#header-record');
    if (el) el.textContent = rec.w + '–' + rec.l + (rec.t ? '–' + rec.t : '');
    const sub = ui.qs('#header-subtitle');
    if (sub) sub.textContent = state.league.name + ' · Season ' + state.league.season +
      ' · all data stays in this browser';
    document.title = 'TeamBallStats — ' + state.league.name;
    updateTicker();
  }

  /* Sticky bar ticker: live game (with running clock) or the next fixture. */
  function updateTicker() {
    const host = ui.qs('#ticker');
    if (!host) return;
    const live = state.games.filter(g => g.status === 'live');
    if (live.length) {
      const g = live[0];
      const away = team(g.awayTeamId);
      const home = team(g.homeTeamId);
      const clock = g.clockRunningSince ? ui.fmtClock(remainingSeconds(g)) : ui.fmtClock(g.clockSeconds);
      host.innerHTML = '<span class="ticker-live">LIVE</span>' +
        '<span class="ticker-text">' + ui.esc(away.short || away.name) + ' ' + ui.fmtInt(g.awayScore) +
        ' @ ' + ui.esc(home.short || home.name) + ' ' + ui.fmtInt(g.homeScore) +
        ' · Q' + g.quarter + ' · ' + clock + '</span>';
      host.dataset.gameId = g.id;
      host.dataset.mode = 'live';
      host.setAttribute('aria-label', 'Live game: ' + away.name + ' at ' + home.name +
        '. Open the live console.');
      return;
    }
    const today = storage.todayISO();
    const next = state.games
      .filter(g => g.status === 'scheduled' && (g.date || '') >= today)
      .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))[0];
    if (next) {
      const away = team(next.awayTeamId);
      const home = team(next.homeTeamId);
      host.innerHTML = '<span class="ticker-label">NEXT</span>' +
        '<span class="ticker-text">' + ui.esc(away.short || away.name) + ' @ ' +
        ui.esc(home.short || home.name) + ' · ' + ui.fmtDate(next.date) +
        (next.time ? ' · ' + ui.fmtTime(next.time) : '') + '</span>';
      host.dataset.mode = 'next';
      host.dataset.gameId = next.id;
      host.setAttribute('aria-label', 'Next game: ' + away.name + ' at ' + home.name + '. Open the schedule.');
      return;
    }
    host.innerHTML = '<span class="ticker-label">LEAGUE</span>' +
      '<span class="ticker-text">No games scheduled — add a fixture or open the Live Console</span>';
    host.dataset.mode = 'idle';
    delete host.dataset.gameId;
    host.setAttribute('aria-label', 'No games scheduled. Open the schedule.');
  }

  function renderAll() {
    TABS.forEach(safeRender);
    updateHeader();
  }

  function saveFailureToast() {
    const reason = storage.getLastSaveError();
    const quota = reason === 'QuotaExceededError' || reason === 'NS_ERROR_DOM_QUOTA_REACHED';
    ui.toast(quota
      ? 'Browser storage is full (about 5 MB). Remove a player photo or two, export a JSON backup, ' +
        'then try again.'
      : 'Could not save — localStorage may be disabled in this browser or private window.', 'error');
  }

  function commit(mutator) {
    if (typeof mutator === 'function') mutator(state);
    const ok = storage.saveData(state);
    if (!ok) saveFailureToast();
    renderAll();
    return ok;
  }

  function replace(nextData) {
    state = storage.coerce(nextData);
    const ok = storage.saveData(state);
    if (!ok) saveFailureToast();
    if (TBS.theme) TBS.theme.refresh(state.league.theme);
    renderAll();
    return ok;
  }

  function activate(tab) {
    const target = TABS.indexOf(tab) >= 0 ? tab : 'dashboard';
    activeTab = target;
    ui.qsa('nav button[data-tab]').forEach(btn => {
      const on = btn.dataset.tab === target;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    ui.qsa('main > section.tab').forEach(section =>
      section.classList.toggle('active', section.id === target));
    safeRender(target);
    updateHeader();
    const nav = ui.qs('#main-nav');
    if (nav) nav.dataset.open = 'false';
    const toggle = ui.qs('#nav-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function go(tab) {
    const target = TABS.indexOf(tab) >= 0 ? tab : 'dashboard';
    const current = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
    if (current === target) activate(target);
    else location.hash = target;
  }

  function init() {
    /* Shared UI behaviour (sortable + searchable tables, delegated once). */
    ui.initSmartTables();

    /* Theme first: it only reads bball_tm_theme and can never touch data. */
    if (TBS.theme) TBS.theme.init(state.league.theme);

    /* Module event wiring (one-time, delegated listeners only). */
    TABS.forEach(tab => {
      const view = TBS[VIEWS[tab]];
      if (view && typeof view.init === 'function') {
        try { view.init(); }
        catch (err) { console.error('[TeamBallStats] init failed in ' + tab + ':', err); }
      }
    });
    ['profiles', 'shortcuts'].forEach(name => {
      const mod = TBS[name];
      if (mod && typeof mod.init === 'function') {
        try { mod.init(); }
        catch (err) { console.error('[TeamBallStats] init failed in ' + name + ':', err); }
      }
    });

    ui.qsa('nav button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => go(btn.dataset.tab));
    });

    const navToggle = ui.qs('#nav-toggle');
    const nav = ui.qs('#main-nav');
    if (navToggle && nav) {
      navToggle.addEventListener('click', () => {
        const open = nav.dataset.open !== 'true';
        nav.dataset.open = open ? 'true' : 'false';
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    const ticker = ui.qs('#ticker');
    if (ticker) {
      ticker.addEventListener('click', () => {
        if (ticker.dataset.mode === 'live' && ticker.dataset.gameId) {
          TBS.live.openGame(ticker.dataset.gameId);
          go('live');
        } else {
          go('schedule');
        }
      });
    }

    window.addEventListener('hashchange', () => {
      const tab = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      activate(TABS.indexOf(tab) >= 0 ? tab : 'dashboard');
    });

    /* Keep multiple browser tabs in sync (storage events skip the writer). */
    window.addEventListener('storage', e => {
      if (e.key === storage.DB_KEY && e.newValue) {
        state = storage.loadData();
        renderAll();
        ui.toast('Data changed in another tab — view refreshed.', 'info');
      }
    });

    /* Canvas charts use CSS variables, so a theme swap needs a redraw. */
    document.addEventListener('tbs:themechange', () => {
      if (started) renderAll();
    });

    renderAll();
    const initial = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
    activate(TABS.indexOf(initial) >= 0 ? initial : 'dashboard');
    started = true;

    if (tickerTimer) clearInterval(tickerTimer);
    tickerTimer = setInterval(updateTicker, 1000);

    const load = storage.getLastLoad ? storage.getLastLoad() : null;
    if (load && load.migrated) {
      const steps = 'v' + load.from + ' → v' + load.to;
      if (load.from === 1) {
        ui.toast('Upgraded your existing v1 data (' + steps + ') — every player, game and event was kept. ' +
          'The raw original is saved as a backup.', 'success');
      } else {
        ui.toast('League upgraded in place (' + steps + ') — nothing was removed.', 'success');
      }
    }
  }

  TBS.app = {
    TABS: TABS,
    VERSION: storage.SCHEMA_VERSION,
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
    playersFor: playersFor,
    updateTicker: updateTicker
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window.TBS = window.TBS || {});
