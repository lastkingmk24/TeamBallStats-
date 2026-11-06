/* =========================================================================
 * ui.js — shared DOM helpers, formatting, tables, modals and toasts.
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
    }, 3400);
  }

  function emptyState(title, body, actionHtml) {
    return '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">🏀</div>' +
      '<h3>' + esc(title) + '</h3>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      (actionHtml || '') + '</div>';
  }

  /* Generic table builder. columns: [{label, key?, align?, render?, headClass?}] */
  function table(columns, rows, opts) {
    const options = opts || {};
    const list = rows || [];
    const head = columns.map(c =>
      '<th scope="col"' + (c.align ? ' class="align-' + c.align + '"' : '') + '>' +
      esc(c.label) + '</th>'
    ).join('');
    const body = list.length ? list.map((row, i) => {
      const cls = options.rowClass ? options.rowClass(row, i) : '';
      const cells = columns.map(c => {
        const content = c.render ? c.render(row, i) : esc(row[c.key] === undefined || row[c.key] === null ? '' : row[c.key]);
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
        ' · ' + g.status.toUpperCase()
    })), selectedId, placeholder);
  }

  function statusBadge(status) {
    const map = { scheduled: 'Scheduled', live: 'LIVE', final: 'Final' };
    return '<span class="badge badge-' + esc(status) + '">' + esc(map[status] || status) + '</span>';
  }

  /* Reusable form modal. fields: [{name,label,type,options,value,required,...}] */
  function openModal(config) {
    const cfg = config || {};
    const fields = cfg.fields || [];
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';

    const fieldHtml = fields.map(f => {
      const value = f.value === undefined || f.value === null ? '' : f.value;
      const attrs = 'name="' + esc(f.name) + '" id="modal-' + esc(f.name) + '"' +
        (f.required ? ' required' : '') +
        (f.min !== undefined ? ' min="' + esc(f.min) + '"' : '') +
        (f.max !== undefined ? ' max="' + esc(f.max) + '"' : '') +
        (f.step !== undefined ? ' step="' + esc(f.step) + '"' : '') +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
      let control;
      if (f.type === 'select') {
        control = '<select ' + attrs + '>' + options(f.options || [], value) + '</select>';
      } else if (f.type === 'textarea') {
        control = '<textarea ' + attrs + ' rows="3">' + esc(value) + '</textarea>';
      } else if (f.type === 'checkbox') {
        control = '<input type="checkbox" ' + attrs + (value ? ' checked' : '') + ' />';
      } else {
        control = '<input type="' + esc(f.type || 'text') + '" ' + attrs +
          ' value="' + esc(value) + '" />';
      }
      return '<div class="field' + (f.type === 'checkbox' ? ' field-inline' : '') + '">' +
        '<label for="modal-' + esc(f.name) + '">' + esc(f.label) + '</label>' + control +
        (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
    }).join('');

    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        '<div class="modal-head"><h3 id="modal-title">' + esc(cfg.title || 'Edit') + '</h3>' +
        '<button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>' +
        '<form class="modal-form">' + fieldHtml +
          '<div class="modal-actions">' +
            '<button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
            '<button type="submit" class="btn btn-primary">' + esc(cfg.submitLabel || 'Save') + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    const previousFocus = document.activeElement;
    document.body.appendChild(overlay);

    function close() {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) close();
    });

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
    if (first) first.focus();
    return close;
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
    qs: qs, qsa: qsa, esc: esc,
    fmt1: fmt1, fmtInt: fmtInt, fmtPct: fmtPct, fmtClock: fmtClock,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime,
    parseLocal: parseLocal, relativeDate: relativeDate,
    download: download, toast: toast, emptyState: emptyState,
    table: table, options: options, teamOptions: teamOptions,
    gameOptions: gameOptions, statusBadge: statusBadge,
    openModal: openModal, confirmDanger: confirmDanger, debounce: debounce
  };
})(window.TBS = window.TBS || {});
