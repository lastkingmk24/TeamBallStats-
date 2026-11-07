/* =========================================================================
 * theme.js — dark / light appearance.
 *
 * Rules implemented here:
 *   • <html data-theme="dark|light"> swaps the whole token set in style.css
 *   • the explicit choice is persisted in its OWN key: 'bball_tm_theme'
 *     (never inside the league document, so toggling cannot change data)
 *   • first visit honours prefers-color-scheme; an explicit choice always wins
 *   • league.theme ('system' | 'dark' | 'light') is only a fallback default
 *   • the print stylesheet always forces the light palette
 *   • a header toggle switches theme and stays in sync across browser tabs
 *
 * No network, no fonts, no CDNs: system fonts + CSS variables only.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const KEY = 'bball_tm_theme';
  const MODES = ['dark', 'light'];
  const META_COLORS = { dark: '#070b13', light: '#0d1220' };

  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;

  let mode = 'light';
  let leagueDefault = 'system';
  let wired = false;

  function readStored() {
    try {
      const value = win.localStorage.getItem(KEY);
      return MODES.indexOf(value) >= 0 ? value : null;
    } catch (_) { return null; }
  }

  function writeStored(choice) {
    try {
      if (MODES.indexOf(choice) >= 0) win.localStorage.setItem(KEY, choice);
      else win.localStorage.removeItem(KEY);
      return true;
    } catch (_) { return false; }
  }

  function systemPrefers() {
    try {
      if (win && typeof win.matchMedia === 'function') {
        if (win.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        if (win.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      }
    } catch (_) { /* very old browsers */ }
    return 'light';
  }

  /* Pure resolver — exposed for tests and for the early head bootstrap. */
  function resolve(choice, leagueTheme, systemDark) {
    if (MODES.indexOf(choice) >= 0) return choice;
    if (MODES.indexOf(leagueTheme) >= 0) return leagueTheme;
    return systemDark ? 'dark' : 'light';
  }

  function currentLeagueDefault() {
    return leagueDefault;
  }

  function metaColor(m) {
    if (!doc) return;
    const tag = doc.querySelector('meta[name="theme-color"]');
    if (tag) tag.setAttribute('content', META_COLORS[m] || META_COLORS.light);
  }

  function paint(m) {
    mode = MODES.indexOf(m) >= 0 ? m : 'light';
    if (doc && doc.documentElement) {
      doc.documentElement.setAttribute('data-theme', mode);
      doc.documentElement.style.colorScheme = mode;
    }
    metaColor(mode);
    updateToggle();
    try {
      if (doc && typeof doc.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        doc.dispatchEvent(new CustomEvent('tbs:themechange', { detail: { mode: mode } }));
      }
    } catch (_) { /* CustomEvent unavailable */ }
  }

  function updateToggle() {
    if (!doc) return;
    const btn = doc.querySelector('#theme-toggle');
    if (!btn) return;
    const next = mode === 'dark' ? 'light' : 'dark';
    btn.innerHTML = (TBS.ui && TBS.ui.icon ? TBS.ui.icon(next === 'dark' ? 'moon' : 'sun') : '') +
      '<span class="theme-toggle-text">' + (mode === 'dark' ? 'Light' : 'Dark') + '</span>';
    btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    btn.setAttribute('title', 'Switch to ' + next + ' theme (appearance is saved on this device)');
    btn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    btn.setAttribute('data-current', mode);
  }

  /* Apply a mode without persisting it. */
  function apply(m) {
    paint(m);
  }

  function applyStored() {
    paint(resolve(readStored(), leagueDefault, systemPrefers() === 'dark'));
  }

  /* Explicit user choice: persisted only in bball_tm_theme. */
  function set(choice, opts) {
    const options = opts || {};
    if (MODES.indexOf(choice) < 0) return false;
    const ok = writeStored(choice);
    paint(choice);
    if (options.announce && TBS.ui) {
      TBS.ui.toast(choice === 'dark' ? 'Dark theme on.' : 'Light theme on.', 'info');
    }
    return ok;
  }

  function toggle() {
    const next = mode === 'dark' ? 'light' : 'dark';
    set(next, { announce: true });
    return next;
  }

  function onSystemChange() {
    if (readStored()) return; /* explicit choice wins */
    if (MODES.indexOf(leagueDefault) >= 0) return;
    paint(systemPrefers());
  }

  function init(leagueTheme) {
    leagueDefault = leagueTheme || 'system';
    applyStored();
    if (wired) return;
    wired = true;

    const btn = doc && doc.querySelector('#theme-toggle');
    if (btn) btn.addEventListener('click', toggle);

    try {
      if (win && typeof win.matchMedia === 'function') {
        const mq = win.matchMedia('(prefers-color-scheme: dark)');
        if (mq && typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', onSystemChange);
        } else if (mq && typeof mq.addListener === 'function') {
          mq.addListener(onSystemChange);
        }
      }
    } catch (_) { /* no matchMedia */ }

    /* Cross-tab sync: another tab toggled the theme. */
    if (win && win.addEventListener) {
      win.addEventListener('storage', e => {
        if (!e || e.key !== KEY) return;
        paint(resolve(readStored(), leagueDefault, systemPrefers() === 'dark'));
      });
    }
    updateToggle();
  }

  function refresh(leagueTheme) {
    if (leagueTheme !== undefined) leagueDefault = leagueTheme || 'system';
    paint(resolve(readStored(), leagueDefault, systemPrefers() === 'dark'));
  }

  TBS.theme = {
    KEY: KEY,
    MODES: MODES,
    META_COLORS: META_COLORS,
    readStored: readStored,
    writeStored: writeStored,
    systemPrefers: systemPrefers,
    resolve: resolve,
    current: function () { return mode; },
    leagueDefault: currentLeagueDefault,
    apply: apply,
    applyStored: applyStored,
    set: set,
    toggle: toggle,
    init: init,
    refresh: refresh,
    updateToggle: updateToggle
  };
})(window.TBS = window.TBS || {});
