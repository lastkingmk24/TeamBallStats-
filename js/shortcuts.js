/* =========================================================================
 * shortcuts.js — keyboard shortcuts for the live scoring console, plus the
 * on-screen help legend.
 *
 * Shortcuts never fire while typing in a form control, while a dialog is
 * open, or on another tab. Ctrl/Cmd+Z always works as undo (except in a
 * text field, where the browser's own undo is preserved).
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;

  const BINDINGS = [
    { keys: ['1'], label: 'Free throw made', group: 'Scoring' },
    { keys: ['2'], label: '2-point field goal made', group: 'Scoring' },
    { keys: ['3'], label: '3-point field goal made', group: 'Scoring' },
    { keys: ['4'], label: 'Free throw missed', group: 'Scoring' },
    { keys: ['5'], label: '2-point miss', group: 'Scoring' },
    { keys: ['6'], label: '3-point miss', group: 'Scoring' },
    { keys: ['O'], label: 'Offensive rebound', group: 'Stats' },
    { keys: ['R'], label: 'Defensive rebound', group: 'Stats' },
    { keys: ['A'], label: 'Assist', group: 'Stats' },
    { keys: ['S'], label: 'Steal', group: 'Stats' },
    { keys: ['B'], label: 'Block', group: 'Stats' },
    { keys: ['T'], label: 'Turnover', group: 'Stats' },
    { keys: ['F'], label: 'Personal foul', group: 'Stats' },
    { keys: ['M'], label: 'Minute played', group: 'Stats' },
    { keys: ['Space'], label: 'Start / pause the game clock', group: 'Clock' },
    { keys: ['N'], label: 'Advance to the next quarter', group: 'Clock' },
    { keys: ['U', 'Ctrl/⌘ + Z'], label: 'Undo the last play', group: 'Clock' },
    { keys: ['↑', '↓'], label: 'Select the previous / next player', group: 'Selection' },
    { keys: ['?'], label: 'Show or hide this legend', group: 'Help' },
    { keys: ['Esc'], label: 'Close any dialog', group: 'Help' }
  ];

  const KEY_ACTIONS = {
    '1': 'ft_make',
    '2': 'fg2_make',
    '3': 'fg3_make',
    '4': 'ft_miss',
    '5': 'fg2_miss',
    '6': 'fg3_miss',
    o: 'oreb',
    r: 'dreb',
    a: 'ast',
    s: 'stl',
    b: 'blk',
    t: 'tov',
    f: 'pf',
    m: 'min'
  };

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    return target.isContentEditable === true;
  }

  function dialogOpen() {
    return !!document.querySelector('.modal-backdrop');
  }

  function onLiveTab() {
    return !!(TBS.app && TBS.app.activeTab && TBS.app.activeTab() === 'live');
  }

  function shortcutHtml() {
    const groups = [];
    BINDINGS.forEach(b => {
      let g = groups.find(x => x.group === b.group);
      if (!g) { g = { group: b.group, items: [] }; groups.push(g); }
      g.items.push(b);
    });
    return '<div class="shortcut-grid">' + groups.map(g =>
      '<div class="shortcut-group"><h4>' + ui.esc(g.group) + '</h4><ul>' +
      g.items.map(item => '<li><span class="shortcut-keys">' +
        item.keys.map(k => '<kbd>' + ui.esc(k) + '</kbd>').join('') +
        '</span><span class="shortcut-label">' + ui.esc(item.label) + '</span></li>').join('') +
      '</ul></div>').join('') + '</div>' +
      '<p class="footnote">Shortcuts apply to the Live Console only, and only while no dialog or ' +
      'form field has focus. Tap a roster chip first so a player is selected.</p>';
  }

  function help() {
    ui.openDialog({
      title: 'Live scoring shortcuts',
      className: 'modal-wide',
      bodyHtml: shortcutHtml(),
      footerHtml: '<button type="button" class="btn btn-primary" data-close>Got it</button>'
    });
  }

  function handle(e) {
    if (!TBS.app || !onLiveTab()) return;
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey) {
      if (String(e.key).toLowerCase() === 'z' && !isTyping(e.target)) {
        e.preventDefault();
        TBS.live.shortcutUndo();
      }
      return;
    }
    if (e.altKey) return;
    if (isTyping(e.target)) return;
    if (dialogOpen()) return;
    if (!TBS.live || !TBS.live.hasGame || !TBS.live.hasGame()) return;

    const key = String(e.key || '');
    const lower = key.toLowerCase();

    if (key === '?') { e.preventDefault(); help(); return; }
    if (key === ' ' || key === 'Spacebar') {
      e.preventDefault();
      TBS.live.shortcutClock();
      return;
    }
    if (lower === 'n') { e.preventDefault(); TBS.live.shortcutNextQuarter(); return; }
    if (lower === 'u') { e.preventDefault(); TBS.live.shortcutUndo(); return; }
    if (key === 'ArrowUp') { e.preventDefault(); TBS.live.cyclePlayer(-1); return; }
    if (key === 'ArrowDown') { e.preventDefault(); TBS.live.cyclePlayer(1); return; }
    if (KEY_ACTIONS[lower]) {
      e.preventDefault();
      TBS.live.shortcutPlay(KEY_ACTIONS[lower]);
    }
  }

  function init() {
    document.addEventListener('keydown', handle);
    document.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('[data-action="show-shortcuts"]') : null;
      if (!btn) return;
      e.preventDefault();
      help();
    });
  }

  TBS.shortcuts = {
    render: function () { /* no view of its own */ },
    init: init,
    help: help,
    handle: handle,
    BINDINGS: BINDINGS,
    KEY_ACTIONS: KEY_ACTIONS
  };
})(window.TBS = window.TBS || {});
