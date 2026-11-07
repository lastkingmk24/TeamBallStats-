/* =========================================================================
 * ui.js — shared DOM helpers: escaping, formatting, icons, avatars, tables
 * (with search + sorting), rich dialogs, form modals, toasts and downloads.
 * No framework, no CDNs, no build step: plain browser APIs only.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt1(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '0.0';
  }

  function fmtInt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n)) : '0';
  }

  function fmtPct(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    return fmt1(value) + '%';
  }

  function fmtSigned(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    const text = digits ? fmt1(Math.abs(n)) : String(Math.round(Math.abs(n)));
    return (n > 0 ? '+' : (n < 0 ? '−' : '')) + text;
  }

  function fmtClock(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function parseLocal(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0));
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = parseLocal(value);
    if (!d) return esc(value);
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short', day: 'numeric', year: 'numeric'
      }).format(d);
    } catch (_) { return esc(value); }
  }

  function fmtTime(value) {
    const m = /^(\d{2}):(\d{2})/.exec(String(value || ''));
    if (!m) return '';
    const h = Number(m[1]);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = (h % 12) || 12;
    return hour + ':' + m[2] + ' ' + suffix;
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const date = fmtDate(value);
    const time = fmtTime(value);
    return time ? date + ' · ' + time : date;
  }

  function relativeDate(value) {
    const d = parseLocal(value);
    if (!d) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((target - today) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days < 14) return 'in ' + days + ' days';
    if (days < -1 && days > -14) return Math.abs(days) + ' days ago';
    return '';
  }

  function download(filename, content, mime) {
    try {
      const blob = new Blob([content], { type: mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (_) {
      toast('Could not create the download in this browser.', 'error');
      return false;
    }
  }

  /* ----------------------------- icons (inline SVG) ----------------------- */

  const ICONS = {
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12h9.4l.8-12M10 11v5M14 11v5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20V4M4 20h16M8 16v-5M12.5 16V7M17 16v-8"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M18 13.5h.01M9.5 14h5"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 9V4h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h9a5.5 5.5 0 1 1 0 11H7M4 9l4-4M4 9l4 4"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.6 19 12 8.5 18.4Z" fill="currentColor" stroke="none"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.4v2.4"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3h10v5a5 5 0 0 1-10 0Z"/><path d="M17 4.5h3v2a3 3 0 0 1-3 3M7 4.5H4v2a3 3 0 0 0 3 3"/><path d="M12 13v4M8.5 20h7"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.2 19.5 6v6.1c0 4.3-3.1 7.2-7.5 8.7-4.4-1.5-7.5-4.4-7.5-8.7V6Z"/><path d="m8.7 12 2.4 2.4 4.2-4.6"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.6 20.2c.5-4 3.6-6.2 7.4-6.2s6.9 2.2 7.4 6.2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5"/></svg>',
    basketball: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4.5 6 4.5 9s-1.5 6-4.5 9M12 3c-3 3-4.5 6-4.5 9s1.5 6 4.5 9"/></svg>'
  };

  function icon(name) {
    return ICONS[name] || '';
  }

  /* ------------------------------- avatars -------------------------------- */

  const AVATAR_HUES = [352, 12, 206, 224, 266, 152, 34, 188, 320];

  function hashString(text) {
    let h = 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function colorFor(seed) {
    const hue = AVATAR_HUES[hashString(seed) % AVATAR_HUES.length];
    return 'hsl(' + hue + ' 58% 40%)';
  }

  /* Circular avatar: photo when present, generated initials + jersey badge
   * otherwise. opts: {size: sm|md|lg|xl, team, showNumber, clickable} */
  function avatar(player, opts) {
    const o = opts || {};
    const p = player || {};
    const size = o.size || 'md';
    const teamColor = o.team && o.team.color ? o.team.color : '';
    const color = teamColor || o.color || colorFor(p.id || p.name || 'player');
    const num = (p.number === 0 || p.number) && p.number !== '—' ? String(p.number) : '';
    const inner = p.photo
      ? '<img src="' + esc(p.photo) + '" alt="" decoding="async" />'
      : '<span class="avatar-initials">' + esc(initials(p.name)) + '</span>';
    const badge = (o.showNumber !== false && num)
      ? '<span class="jnum" aria-hidden="true">' + esc(num) + '</span>' : '';
    const cls = 'avatar avatar-' + size + (p.photo ? ' has-photo' : '') + (o.className ? ' ' + o.className : '');
    if (o.clickable && p.id) {
      return '<button type="button" class="avatar-btn" data-profile="' + esc(p.id) +
        '" aria-label="Open profile for ' + esc(p.name || 'player') + '">' +
        '<span class="' + cls + '" style="--avatar-color:' + esc(color) + '">' + inner + badge + '</span>' +
        '</button>';
    }
    return '<span class="' + cls + '" style="--avatar-color:' + esc(color) + '">' + inner + badge + '</span>';
  }

  /* Avatar + player name; clickable opens the player profile modal. */
  function playerCell(player, opts) {
    const o = opts || {};
    if (!player) return '<span class="muted">Former player</span>';
    const label = '<span class="player-cell-name">' + esc(player.name) + '</span>' +
      (o.sub ? '<span class="player-cell-sub">' + esc(o.sub) + '</span>' : '');
    const body = avatar(player, { size: o.size || 'sm', team: o.team, showNumber: !!o.showNumber }) +
      '<span class="player-cell-text">' + label + '</span>';
    if (o.clickable === false || !player.id) {
      return '<span class="player-cell">' + body + '</span>';
    }
    return '<button type="button" class="player-cell player-cell-link" data-profile="' +
      esc(player.id) + '" aria-label="Open profile for ' + esc(player.name) + '">' + body + '</button>';
  }

  function teamTag(team) {
    if (!team) return '<span class="muted">Unknown team</span>';
    const color = team.color || '';
    return '<span class="team-tag"' + (color ? ' style="--team-color:' + esc(color) + '"' : '') + '>' +
      '<span class="team-swatch" aria-hidden="true"></span>' +
      '<span class="team-abbr">' + esc(team.short || '') + '</span>' +
      '<span class="team-name">' + esc(team.name) + '</span></span>';
  }

  /* ----------------------------- club marks ------------------------------- */

  /* Small deterministic hash so every club always gets the same shield. */
  function markSeed(team) {
    return hashString((team && (team.id || team.name)) || 'team');
  }

  function markPalette(team) {
    const seed = markSeed(team);
    const base = (team && team.color) || '';
    const fallback = ['#1d428a', '#c8102e', '#0f7b6c', '#7a3ec4', '#b35c00', '#0b6f9c', '#a11c4b'][seed % 7];
    const primary = base || fallback;
    const secondary = ['#fdb927', '#ffffff', '#cfe0ff', '#ffd9a8', '#e9f6f2'][seed % 5];
    return { primary: primary, secondary: secondary };
  }

  /* Square club logo: shield with abbreviation, or the uploaded crest. */
  function teamLogo(team, size) {
    const t = team || {};
    const palette = markPalette(t);
    const cls = 'club-logo club-logo-' + (size || 'md');
    if (t.logo) {
      return '<span class="' + cls + '" style="--club:' + esc(palette.primary) + '">' +
        '<img src="' + esc(t.logo) + '" alt="" decoding="async" /></span>';
    }
    const abbr = String(t.short || t.name || 'T').slice(0, 4).toUpperCase();
    const shape = markSeed(t) % 4;
    const shapes = [
      '<path d="M32 3 58 11v18c0 15-10.5 24-26 29C16 53 5.5 44 5.5 29V11Z"/>',
      '<circle cx="32" cy="32" r="28"/>',
      '<path d="M32 3 62 32 32 61 2 32Z"/>',
      '<path d="M8 8h48v38c0 8-11 14-24 14S8 54 8 46Z"/>'
    ];
    return '<span class="' + cls + '" style="--club:' + esc(palette.primary) +
      ';--club-2:' + esc(palette.secondary) + '">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
        '<g fill="var(--club)" stroke="var(--club-2)" stroke-width="2.5" stroke-opacity=".65">' +
          shapes[shape] + '</g>' +
        '<text x="32" y="39" text-anchor="middle" font-size="' +
          (abbr.length > 3 ? 17 : 21) + '" font-weight="800" fill="var(--club-2)" ' +
          'font-family="Arial Black, Helvetica, Arial, sans-serif" letter-spacing="-.5">' +
          esc(abbr) + '</text>' +
      '</svg></span>';
  }

  /* Logo + club name + record, used in score cards and hero blocks. */
  function teamMark(team, opts) {
    const o = opts || {};
    const t = team || {};
    return '<span class="club-mark' + (o.className ? ' ' + o.className : '') + '">' +
      teamLogo(t, o.size || 'md') +
      '<span class="club-mark-text"><strong>' + esc(t.name || 'Unknown team') + '</strong>' +
        (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span></span>';
  }

  /* -------------------------------- toasts -------------------------------- */

  function toast(message, type) {
    const host = qs('#toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', 'status');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 250);
    }, 3600);
  }

  function emptyState(title, body, actionHtml) {
    return '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 48 48" width="40" height="40" focusable="false"><circle cx="24" cy="24" r="17"/>' +
        '<path d="M7 24h34M24 7c5 5 7.5 11 7.5 17S29 36 24 41M24 7c-5 5-7.5 11-7.5 17S19 36 24 41"/></svg>' +
      '</div>' +
      '<h3>' + esc(title) + '</h3>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      (actionHtml || '') + '</div>';
  }

  /* -------------------------------- tables -------------------------------- */

  /* Generic table builder. columns: [{label, key?, align?, render?, sortValue?, sortable?}] */
  function table(columns, rows, opts) {
    const options = opts || {};
    const list = rows || [];
    const sort = options.sort || null;
    const head = columns.map(c => {
      const align = c.align ? ' class="align-' + c.align + '"' : '';
      const sortable = c.sortable !== false && (c.key || c.sortValue) && sort;
      if (!sortable) return '<th scope="col"' + align + '>' + esc(c.label) + '</th>';
      const active = sort.key === (c.key || c.label);
      const dir = active ? sort.dir : 'none';
      return '<th scope="col"' + align + ' aria-sort="' +
        (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') + '">' +
        '<button type="button" class="th-sort" data-smart-sort="' + esc(sort.id) +
        '" data-key="' + esc(c.key || c.label) + '">' + esc(c.label) +
        '<span class="sort-caret" aria-hidden="true">' +
        (active ? (dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
    }).join('');
    const body = list.length ? list.map((row, i) => {
      const cls = options.rowClass ? options.rowClass(row, i) : '';
      const cells = columns.map(c => {
        const content = c.render
          ? c.render(row, i)
          : esc(row[c.key] === undefined || row[c.key] === null ? '' : row[c.key]);
        return '<td' + (c.align ? ' class="align-' + c.align + '"' : '') + '>' + content + '</td>';
      }).join('');
      return '<tr' + (cls ? ' class="' + esc(cls) + '"' : '') + '>' + cells + '</tr>';
    }).join('') : '<tr><td class="empty-cell" colspan="' + columns.length + '">' +
      esc(options.empty || 'No data yet.') + '</td></tr>';
    const foot = options.foot
      ? '<tfoot><tr>' + options.foot.map((cell, i) =>
          '<td' + (columns[i] && columns[i].align ? ' class="align-' + columns[i].align + '"' : '') +
          '>' + cell + '</td>').join('') + '</tr></tfoot>'
      : '';
    return '<div class="table-scroll"><table class="data-table">' +
      (options.caption ? '<caption>' + esc(options.caption) + '</caption>' : '') +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + foot +
      '</table></div>';
  }

  /* ---------------------- searchable / sortable tables -------------------- */

  const smartState = {};
  let smartWired = false;

  function columnValue(col, row) {
    if (col.sortValue) return col.sortValue(row);
    if (col.key) return row[col.key];
    return '';
  }

  function compareValues(a, b) {
    const na = Number(a);
    const nb = Number(b);
    const bothNumeric = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb);
    if (bothNumeric) return na - nb;
    return String(a === undefined || a === null ? '' : a)
      .localeCompare(String(b === undefined || b === null ? '' : b), undefined, { numeric: true });
  }

  function rowsForSmart(state) {
    let rows = state.rows.slice();
    const q = state.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(row => {
        if (state.searchText) return String(state.searchText(row) || '').toLowerCase().indexOf(q) >= 0;
        return state.columns.some(col => String(columnValue(col, row) === undefined ? '' : columnValue(col, row))
          .toLowerCase().indexOf(q) >= 0);
      });
    }
    if (state.sortKey) {
      const col = state.columns.find(c => (c.key || c.label) === state.sortKey);
      if (col) {
        rows.sort((a, b) => {
          const cmp = compareValues(columnValue(col, a), columnValue(col, b));
          return state.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return rows;
  }

  function smartBodyHtml(id) {
    const state = smartState[id];
    if (!state) return '';
    return table(state.columns, rowsForSmart(state), {
      empty: state.empty,
      caption: state.caption,
      foot: state.foot,
      rowClass: state.rowClass,
      sort: { id: id, key: state.sortKey, dir: state.dir }
    });
  }

  function refreshSmart(id) {
    const state = smartState[id];
    if (!state) return;
    const body = qs('[data-smart-body="' + id + '"]');
    if (body) body.innerHTML = smartBodyHtml(id);
    const count = qs('[data-smart-count="' + id + '"]');
    if (count) {
      const shown = rowsForSmart(state).length;
      count.textContent = shown === state.rows.length
        ? state.rows.length + ' rows'
        : shown + ' of ' + state.rows.length + ' rows';
    }
  }

  function smartTable(cfg) {
    const id = cfg.id || ('smart-' + Math.random().toString(36).slice(2, 8));
    const prev = smartState[id] || {};
    const state = smartState[id] = {
      id: id,
      columns: cfg.columns || [],
      rows: cfg.rows || [],
      empty: cfg.empty,
      caption: cfg.caption,
      foot: cfg.foot,
      rowClass: cfg.rowClass,
      search: cfg.search !== false,
      searchText: cfg.searchText,
      placeholder: cfg.searchPlaceholder || 'Search…',
      searchLabel: cfg.searchLabel || 'Search table',
      query: typeof prev.query === 'string' ? prev.query : '',
      sortKey: prev.sortKey || cfg.sortKey || '',
      dir: prev.sortKey ? (prev.dir || 'desc') : (cfg.dir || 'desc')
    };
    return '<div class="smart-table" data-table-id="' + esc(id) + '">' +
      (state.search
        ? '<div class="table-toolbar">' +
            '<label class="search-field">' +
              '<span class="sr-only">' + esc(state.searchLabel) + '</span>' +
              '<input type="search" data-smart-search="' + esc(id) + '" value="' + esc(state.query) +
                '" placeholder="' + esc(state.placeholder) + '" autocomplete="off" />' +
            '</label>' +
            '<span class="table-count" data-smart-count="' + esc(id) + '">' +
              state.rows.length + ' rows</span>' +
          '</div>'
        : '') +
      '<div class="smart-table-body" data-smart-body="' + esc(id) + '">' +
        smartBodyHtml(id) + '</div>' +
      '</div>';
  }

  function initSmartTables() {
    if (smartWired) return;
    smartWired = true;
    document.addEventListener('input', e => {
      const input = e.target.closest ? e.target.closest('[data-smart-search]') : null;
      if (!input) return;
      const state = smartState[input.dataset.smartSearch];
      if (!state) return;
      state.query = input.value;
      refreshSmart(state.id);
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('[data-smart-sort]') : null;
      if (!btn) return;
      const state = smartState[btn.dataset.smartSort];
      if (!state) return;
      const key = btn.dataset.key;
      if (state.sortKey === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.dir = 'desc'; }
      refreshSmart(state.id);
      const again = qs('[data-smart-sort="' + state.id + '"][data-key="' + key + '"]');
      if (again && again.focus) again.focus();
    });
  }

  /* ------------------------------- selects -------------------------------- */

  function options(items, selectedId, placeholder) {
    let html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '';
    (items || []).forEach(item => {
      html += '<option value="' + esc(item.value) + '"' +
        (String(item.value) === String(selectedId) ? ' selected' : '') + '>' +
        esc(item.label) + '</option>';
    });
    return html;
  }

  function teamOptions(teams, selectedId, placeholder) {
    return options((teams || []).map(t => ({
      value: t.id, label: t.name + (t.primary ? ' (mine)' : '')
    })), selectedId, placeholder);
  }

  function gameOptions(games, teams, selectedId, placeholder) {
    const name = id => {
      const t = (teams || []).find(x => x.id === id);
      return t ? t.name : 'Unknown';
    };
    return options((games || []).map(g => ({
      value: g.id,
      label: fmtDate(g.date) + ' · ' + name(g.awayTeamId) + ' @ ' + name(g.homeTeamId) +
        ' · ' + String(g.status || '').toUpperCase()
    })), selectedId, placeholder);
  }

  function statusBadge(status) {
    const map = { scheduled: 'Scheduled', live: 'LIVE', final: 'Final' };
    return '<span class="badge badge-' + esc(status) + '">' + esc(map[status] || status) + '</span>';
  }

  function resultBadge(result) {
    const map = { W: 'badge-w', L: 'badge-l', T: 'badge-t' };
    return '<span class="badge ' + (map[result] || 'badge-t') + '">' + esc(result || '—') + '</span>';
  }

  function badge(label, kind) {
    return '<span class="badge badge-' + esc(kind || 'other') + '">' + esc(label) + '</span>';
  }

  /* ------------------------------- dialogs -------------------------------- */

  let openDialogs = 0;

  function trapFocus(overlay) {
    return function (e) {
      if (e.key !== 'Tab') return;
      const focusables = qsa('a[href], button:not([disabled]), input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', overlay)
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
  }

  /* Rich-content dialog. cfg: {title, bodyHtml, footerHtml, className, onMount,
   * onClose}. Returns a close() function. */
  function openDialog(config) {
    const cfg = config || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML =
      '<div class="modal ' + esc(cfg.className || '') + '" role="dialog" aria-modal="true" ' +
        'aria-labelledby="dialog-title">' +
        '<div class="modal-head"><h3 id="dialog-title">' + esc(cfg.title || 'Details') + '</h3>' +
          '<button type="button" class="icon-btn" data-close aria-label="Close dialog">' + icon('close') + '</button>' +
        '</div>' +
        '<div class="modal-body">' + (cfg.bodyHtml || '') + '</div>' +
        (cfg.footerHtml ? '<div class="modal-footer">' + cfg.footerHtml + '</div>' : '') +
      '</div>';

    const previousFocus = document.activeElement;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    body.appendChild(overlay);
    openDialogs++;

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    const trap = trapFocus(overlay);
    overlay.addEventListener('keydown', trap);

    function close() {
      if (!overlay.isConnected) return;
      overlay.removeEventListener('keydown', trap);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      openDialogs = Math.max(0, openDialogs - 1);
      if (!openDialogs) body.style.overflow = prevOverflow;
      if (previousFocus && previousFocus.focus) {
        try { previousFocus.focus(); } catch (_) {}
      }
      if (cfg.onClose) cfg.onClose();
    }

    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || (e.target.closest && e.target.closest('[data-close]'))) close();
    });
    overlay.close = close;

    if (cfg.onMount) cfg.onMount(overlay, close);
    const focusTarget = qs('[data-autofocus]', overlay) ||
      qs('input, select, textarea, button:not([data-close])', overlay);
    if (focusTarget && focusTarget.focus) {
      try { focusTarget.focus(); } catch (_) {}
    }
    return close;
  }

  function closeAllDialogs() {
    qsa('.modal-backdrop').forEach(el => {
      if (el.close) el.close();
      else el.remove();
    });
  }

  /* Reusable form modal. fields: [{name,label,type,options,value,required,...}] */
  function openModal(config) {
    const cfg = config || {};
    const fields = cfg.fields || [];

    const fieldHtml = fields.map(f => {
      const value = f.value === undefined || f.value === null ? '' : f.value;
      const attrs = 'name="' + esc(f.name) + '" id="modal-' + esc(f.name) + '"' +
        (f.required ? ' required' : '') +
        (f.min !== undefined ? ' min="' + esc(f.min) + '"' : '') +
        (f.max !== undefined ? ' max="' + esc(f.max) + '"' : '') +
        (f.step !== undefined ? ' step="' + esc(f.step) + '"' : '') +
        (f.maxlength !== undefined ? ' maxlength="' + esc(f.maxlength) + '"' : '') +
        (f.autocomplete ? ' autocomplete="' + esc(f.autocomplete) + '"' : '') +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
      let control;
      if (f.type === 'select') {
        control = '<select ' + attrs + '>' + options(f.options || [], value) + '</select>';
      } else if (f.type === 'textarea') {
        control = '<textarea ' + attrs + ' rows="3">' + esc(value) + '</textarea>';
      } else if (f.type === 'checkbox') {
        control = '<input type="checkbox" ' + attrs + (value ? ' checked' : '') + ' />';
      } else if (f.type === 'color') {
        control = '<input type="color" ' + attrs + ' value="' + esc(value || '#c8102e') + '" />';
      } else {
        control = '<input type="' + esc(f.type || 'text') + '" ' + attrs +
          ' value="' + esc(value) + '" />';
      }
      const id = 'modal-' + f.name;
      return '<div class="field' + (f.type === 'checkbox' ? ' field-inline' : '') + '">' +
        '<label for="' + esc(id) + '">' + esc(f.label) + '</label>' + control +
        (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
    }).join('');

    const bodyHtml =
      '<form class="modal-form" novalidate>' + fieldHtml +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
          '<button type="submit" class="btn btn-primary">' + esc(cfg.submitLabel || 'Save') + '</button>' +
        '</div>' +
      '</form>';

    function mount(overlay, close) {
      const form = qs('form', overlay);
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        const values = {};
        fields.forEach(f => {
          const input = form.elements[f.name];
          values[f.name] = f.type === 'checkbox'
            ? !!(input && input.checked)
            : (input ? input.value : '');
        });
        if (cfg.onSubmit) cfg.onSubmit(values, close);
        else close();
      });
      const first = qs('input, select, textarea', form);
      if (first && first.focus) first.focus();
    }

    return openDialog({
      title: cfg.title || 'Edit',
      bodyHtml: bodyHtml,
      className: cfg.className || '',
      onMount: mount
    });
  }

  function confirmDanger(message) {
    return window.confirm(message);
  }

  function debounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), ms || 150);
    };
  }

  TBS.ui = {
    qs: qs, qsa: qsa, esc: esc, icon: icon,
    fmt1: fmt1, fmtInt: fmtInt, fmtPct: fmtPct, fmtSigned: fmtSigned, fmtClock: fmtClock,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime,
    parseLocal: parseLocal, relativeDate: relativeDate,
    download: download, toast: toast, emptyState: emptyState,
    table: table, smartTable: smartTable, initSmartTables: initSmartTables,
    options: options, teamOptions: teamOptions, gameOptions: gameOptions,
    statusBadge: statusBadge, resultBadge: resultBadge, badge: badge,
    initials: initials, colorFor: colorFor, avatar: avatar, playerCell: playerCell,
    teamTag: teamTag, teamLogo: teamLogo, teamMark: teamMark, markPalette: markPalette,
    openModal: openModal, openDialog: openDialog, closeAllDialogs: closeAllDialogs,
    confirmDanger: confirmDanger, debounce: debounce,
    hashString: hashString
  };
})(window.TBS = window.TBS || {});
