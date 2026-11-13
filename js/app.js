/* =========================================================================
 * app.js — application wiring: state, tab/hash routing, sticky header with
 * record + live ticker, the score strip, cross-tab sync, theme boot, the
 * local sign-in gate and module initialisation.
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

  /* A team account gets a focused league: management-only areas are hidden. */
  const ADMIN_ONLY = ['data'];

  let state = storage.loadData();
  let activeTab = 'dashboard';
  let started = false;
  let tickerTimer = null;

  function getState() { return state; }
  function activeTabName() { return activeTab; }

  function auth() { return TBS.auth || null; }
  function isAdmin() { return !!(auth() && auth().isAdmin()); }

  function allowedTabs() {
    if (isAdmin() || !auth()) return TABS.slice();
    return TABS.filter(t => ADMIN_ONLY.indexOf(t) < 0);
  }

  /* Extra panels owned by a tab (Data hosts the Access & roles card). */
  const EXTRA_VIEWS = { data: ['access'] };

  function safeRender(tab) {
    const targets = [VIEWS[tab]].concat(EXTRA_VIEWS[tab] || []);
    targets.forEach(name => {
      const view = TBS[name];
      if (!view || typeof view.render !== 'function') return;
      try { view.render(state); }
      catch (err) {
        console.error('[TeamBallStats] render failed in ' + tab + ':', err);
        ui.toast('Could not render ' + tab + ': ' + err.message, 'error');
      }
    });
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

  /* Team a view should centre on: the signed-in club, or the league's own. */
  function focusTeamId() {
    if (auth()) return auth().focusTeamId(state);
    return state.league.primaryTeamId;
  }

  function updateHeader() {
    const rec = st.teamRecord(state.games, focusTeamId());
    const el = ui.qs('#header-record');
    if (el) el.textContent = rec.w + '–' + rec.l + (rec.t ? '–' + rec.t : '');
    const sub = ui.qs('#header-subtitle');
    if (sub) {
      const who = auth() && auth().isSignedIn() ? auth().displayName(state) + ' · ' : '';
      sub.textContent = who + state.league.name + ' · ' + (state.league.season || '');
    }
    const cup = ui.qs('#cup-title');
    if (cup) cup.textContent = state.league.name + ' Cup';
    document.title = 'TeamBallStats — ' + state.league.name;
    if (auth()) auth().paintIdentity(state);
    updateTicker();
    renderScoreStrip();
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

  /* ---------------------------- score strip ------------------------------- */

  /* Horizontally scrolling result cards, the way a league site surfaces the
   * night's scores. Cards open the box score. */
  function renderScoreStrip() {
    const host = ui.qs('#score-strip');
    if (!host) return;
    const myId = focusTeamId();
    const rank = g => (g.status === 'live' ? 0 : (g.status === 'final' ? 1 : 2));
    const games = state.games.slice().sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(b.date + b.time).localeCompare(String(a.date + a.time));
    }).slice(0, 12);

    if (!games.length) {
      host.innerHTML =
        '<div class="score-strip-empty">' +
          '<span class="strip-date"><span>No games</span><small>yet</small></span>' +
          '<p>Add a fixture on the Schedule tab and the scores appear here.</p>' +
          '<button type="button" class="btn btn-mini" data-strip="schedule">+ New fixture</button>' +
        '</div>';
      return;
    }

    const dayLabel = value => {
      const d = ui.parseLocal(value);
      if (!d) return { top: '—', bottom: '' };
      try {
        return {
          top: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d),
          bottom: new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(d)
        };
      } catch (_) { return { top: '', bottom: '' }; }
    };

    host.innerHTML =
      '<span class="strip-date" aria-hidden="true">' +
        '<span>' + ui.esc(dayLabel(games[0].date).top) + '</span>' +
        '<small>' + ui.esc(dayLabel(games[0].date).bottom) + '</small>' +
      '</span>' +
      games.map(g => {
        const home = team(g.homeTeamId);
        const away = team(g.awayTeamId);
        const win = side => {
          if (g.status !== 'final') return '';
          return Number(g[side + 'Score']) > Number(g[side === 'home' ? 'awayScore' : 'homeScore'])
            ? ' is-winner' : '';
        };
        const row = (t, scoreSide, tag) =>
          '<div class="strip-team' + win(scoreSide) + '">' +
            ui.teamLogo(t, 'sm') +
            '<span class="strip-abbr">' + ui.esc(t.short || t.name) + '</span>' +
            (tag ? '<span class="strip-tag">' + ui.esc(tag) + '</span>' : '') +
            '<span class="strip-score">' +
              (g.status === 'scheduled' ? '–' : ui.fmtInt(g[scoreSide + 'Score'])) + '</span>' +
          '</div>';
        const isMine = g.homeTeamId === myId || g.awayTeamId === myId;
        return '<button type="button" class="strip-card' + (isMine ? ' is-mine' : '') + '" data-strip="game" data-id="' +
            ui.esc(g.id) + '" aria-label="' + ui.esc(away.name + ' at ' + home.name + ', ' +
              (g.status === 'live' ? 'live, Q' + g.quarter + ', ' : '') +
              'score ' + ui.fmtInt(g.homeScore) + ' to ' + ui.fmtInt(g.awayScore)) + '">' +
          '<span class="strip-head">' +
            (g.status === 'live'
              ? '<span class="strip-live"><span class="live-dot" aria-hidden="true"></span>LIVE · Q' + g.quarter + '</span>'
              : '<span class="strip-status">' + ui.esc(g.status === 'final' ? 'FINAL' : ui.fmtTime(g.time) || 'SCHEDULED') + '</span>') +
            (isMine ? '<span class="strip-mine">MY TEAM</span>' : '') +
          '</span>' +
          row(away, 'away', 'A') + row(home, 'home', 'H') +
          '<span class="strip-foot">' +
            '<span class="strip-pass">League Pass</span>' +
          '</span>' +
        '</button>';
      }).join('') +
      '<button type="button" class="strip-card strip-all" data-strip="boxscores">' +
        '<span class="strip-all-text">All<br />scores</span>' + ui.icon('arrow') +
      '</button>';
  }

  function renderAll() {
    TABS.forEach(safeRender);
    if (auth() && auth().isSignedIn()) paintTabs();
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
    state = storage.coerce(storage.withoutCredentials(nextData));
    const ok = storage.saveData(state);
    if (!ok) saveFailureToast();
    if (TBS.theme) TBS.theme.refresh(state.league.theme);
    if (auth() && auth().syncSession) auth().syncSession(state);
    renderAll();
    return ok;
  }

  function paintTabs() {
    const allowed = allowedTabs();
    ui.qsa('nav button[data-tab]').forEach(btn => {
      const on = btn.dataset.tab === activeTab;
      const visible = allowed.indexOf(btn.dataset.tab) >= 0;
      btn.classList.toggle('active', on);
      btn.hidden = !visible;
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  function activate(tab) {
    let target = TABS.indexOf(tab) >= 0 ? tab : 'dashboard';
    if (!auth() || !auth().isSignedIn()) return; /* the gate owns the screen */
    if (allowedTabs().indexOf(target) < 0) target = 'dashboard';
    activeTab = target;
    paintTabs();
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
    if (auth() && !auth().isSignedIn()) { auth().showGate(state); return; }
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

    /* Sign-in gate before any module paints a view. */
    if (auth()) auth().init();

    /* Module event wiring (one-time, delegated listeners only). */
    TABS.forEach(tab => {
      const view = TBS[VIEWS[tab]];
      if (view && typeof view.init === 'function') {
        try { view.init(); }
        catch (err) { console.error('[TeamBallStats] init failed in ' + tab + ':', err); }
      }
    });
    ['profiles', 'shortcuts', 'access', 'share'].forEach(name => {
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

    /* Score strip: a card opens its box score, "all scores" jumps to the tab. */
    const strip = ui.qs('#score-strip');
    if (strip) {
      strip.addEventListener('click', e => {
        const btn = e.target.closest('[data-strip]');
        if (!btn) return;
        const kind = btn.dataset.strip;
        if (kind === 'game' && btn.dataset.id) {
          if (TBS.boxscores && TBS.boxscores.openGame) TBS.boxscores.openGame(btn.dataset.id);
          go('boxscores');
        } else if (kind === 'schedule') {
          go('schedule');
        } else {
          go('boxscores');
        }
      });
    }

    /* "League Pass" in the header: the season's fixtures in one panel. */
    const passBtn = ui.qs('#league-pass-btn');
    if (passBtn) {
      passBtn.addEventListener('click', () => {
        const live = state.games.filter(g => g.status === 'live');
        const upcoming = state.games.filter(g => g.status === 'scheduled')
          .sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)))
          .slice(0, 6);
        const row = g => '<div class="pass-row">' +
          '<span class="pass-date">' + ui.esc(ui.fmtDate(g.date)) + '</span>' +
          '<span class="pass-matchup">' + ui.esc(team(g.awayTeamId).short || team(g.awayTeamId).name) + ' @ ' +
            ui.esc(team(g.homeTeamId).short || team(g.homeTeamId).name) + '</span>' +
          ui.statusBadge(g.status, g.halftime) + '</div>';
        ui.openDialog({
          title: state.league.name + ' · League Pass',
          bodyHtml:
            '<p class="muted small">Season ' + ui.esc(state.league.season || '—') + ' · ' +
              state.teams.length + ' clubs · ' + state.games.length + ' games</p>' +
            (live.length ? '<h4 class="pass-head">Live now</h4>' + live.map(row).join('') : '') +
            '<h4 class="pass-head">Next up</h4>' +
            (upcoming.length ? upcoming.map(row).join('')
              : '<p class="muted small">No scheduled games yet — add a fixture on the Schedule tab.</p>') +
            '<p class="footnote">Everything is stored locally: sign in from the header to switch accounts.</p>',
          footerHtml: '<button type="button" class="btn btn-ghost" data-close>Close</button>' +
            '<button type="button" class="btn btn-primary" data-pass-go="schedule">Open schedule</button>',
          onMount: (overlay, close) => {
            overlay.addEventListener('click', e => {
              if (e.target.closest('[data-pass-go]')) { close(); go('schedule'); }
            });
          }
        });
      });
    }

    const gridBtn = ui.qs('#scores-grid-btn');
    if (gridBtn) gridBtn.addEventListener('click', () => go('boxscores'));

    /* Dashboard quick actions in the section head. */
    const dash = ui.qs('#dashboard');
    if (dash) {
      dash.addEventListener('click', e => {
        const btn = e.target.closest('[data-quick]');
        if (!btn) return;
        go(btn.dataset.quick === 'live' ? 'live' : 'schedule');
      });
    }

    window.addEventListener('hashchange', () => {
      const tab = decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
      if (auth() && !auth().isSignedIn()) { auth().showGate(state); return; }
      activate(TABS.indexOf(tab) >= 0 ? tab : 'dashboard');
    });

    /* Keep multiple browser tabs in sync (storage events skip the writer). */
    window.addEventListener('storage', e => {
      if (e.key === storage.DB_KEY && e.newValue) {
        state = storage.loadData();
        if (auth() && auth().syncSession) auth().syncSession(state);
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
    ADMIN_ONLY: ADMIN_ONLY,
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
    updateTicker: updateTicker,
    renderScoreStrip: renderScoreStrip,
    focusTeamId: focusTeamId,
    isAdmin: isAdmin
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window.TBS = window.TBS || {});
