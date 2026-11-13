/* Game insights: local, free recap and lineup analytics. No cloud account,
 * API connection or entitlement is required. Measured and rule-based output
 * are labelled separately. Internal pro names are retained for compatibility. */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const qs = ui.qs;
  let lastGame = null;
  let busy = false;

  function host() { return qs('#pro-panel'); }

  function row(label, a, b, fmt) {
    const f = fmt || (x => (x === undefined || x === null ? '—' : x));
    return '<tr><td>' + ui.esc(label) + '</td><td class="align-right">' + f(a) + '</td><td class="align-right">' + f(b) + '</td></tr>';
  }

  function renderRecap(r) {
    const m = r.measured || {};
    const sc = m.score || {};
    const q = m.quarters || {};
    const qHeaders = (q.home || []).map((_, i) => '<th class="align-right">Q' + (i + 1) + '</th>').join('');
    const qRow = side => (q[side] || []).map((v, i) => '<td class="align-right">' + (q.tracked && q.tracked[i] ? v : '—') + '</td>').join('');
    const t = m.teams || {};
    const h = t.home || {}, a = t.away || {};
    const pct = x => (x === undefined || x === null ? '—' : x + '%');
    const top = (m.topPerformers || []).map(p =>
      '<li><strong>' + ui.esc(p.name) + '</strong> #' + ui.esc(p.number || '') + ' (' + ui.esc(p.team) + '): ' +
      p.pts + ' pts, ' + p.reb + ' reb, ' + p.ast + ' ast</li>').join('');
    const analysis = (r.analysis || []).map(item =>
      '<li>' + ui.esc(item.text) + ' <span class="muted small">Basis: ' + ui.esc(item.basis) + '</span></li>').join('');
    const labels = r.labels || {};
    return '' +
      '<div class="pro-block"><h4>Measured</h4>' +
        '<p class="muted small">' + ui.esc(labels.measured || '') + '</p>' +
        '<p><strong>' + ui.esc(sc.homeName || 'Home') + ' ' + ui.fmtInt(sc.home) + ' – ' + ui.fmtInt(sc.away) + ' ' +
          ui.esc(sc.awayName || 'Away') + '</strong> · ' + ui.esc(m.status || '') +
          (m.winner ? ' · ' + ui.esc(m.winner) + ' by ' + Math.abs(m.margin || 0) : '') +
          (m.leadChanges !== undefined ? ' · lead changes: ' + m.leadChanges : '') +
          (m.largestRun && m.largestRun.points ? ' · largest run: ' + ui.esc(m.largestRun.team) + ' ' + m.largestRun.points + '–0' : '') +
        '</p>' +
        (q.count ? '<div class="quarter-table"><table class="data-table"><thead><tr><th>Team</th>' + qHeaders + '</tr></thead><tbody>' +
          '<tr><th scope="row">' + ui.esc(sc.homeName || 'Home') + '</th>' + qRow('home') + '</tr>' +
          '<tr><th scope="row">' + ui.esc(sc.awayName || 'Away') + '</th>' + qRow('away') + '</tr>' +
          '</tbody></table></div>' : '') +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Team stat</th><th class="align-right">' + ui.esc(h.name || 'Home') +
          '</th><th class="align-right">' + ui.esc(a.name || 'Away') + '</th></tr></thead><tbody>' +
          row('Field goal %', pct(h.fg), pct(a.fg)) +
          row('FG made / att', h.fgm !== undefined ? h.fgm + ' / ' + h.fga : undefined, a.fgm !== undefined ? a.fgm + ' / ' + a.fga : undefined) +
          row('3-point %', pct(h.tp), pct(a.tp)) +
          row('Free throw %', pct(h.ft), pct(a.ft)) +
          row('Rebounds', h.reb, a.reb) +
          row('Assists', h.ast, a.ast) +
          row('Turnovers', h.tov, a.tov) +
          row('Steals', h.stl, a.stl) +
          row('Blocks', h.blk, a.blk) +
        '</tbody></table></div>' +
        (top ? '<h5>Top performers</h5><ul class="plain-list">' + top + '</ul>' : '') +
      '</div>' +
      '<div class="pro-block"><h4>Analysis <span class="badge badge-t">rule-based</span></h4>' +
        '<p class="muted small">' + ui.esc(labels.analysis || '') + '</p>' +
        (analysis ? '<ul class="plain-list">' + analysis + '</ul>' : '<p class="muted">Nothing stood out under the rules.</p>') +
      '</div>';
  }

  function renderLineups(r) {
    if (!r.tracked || !(r.rankings || []).length) {
      return '<div class="pro-block"><h4>Lineup rankings</h4><p class="muted">' +
        ui.esc(r.note || 'Not enough substitution data yet. Record substitutions in the live console (Lineup).') + '</p></div>';
    }
    const rows = r.rankings.map(x => '<tr><td>' + x.rank + '</td><td>' + ui.esc((x.names || []).join(', ')) +
      '</td><td class="align-right">' + ui.esc(Number(x.minutes).toFixed(1)) + '</td><td class="align-right">' +
      (x.net > 0 ? '+' : '') + ui.esc(x.net) + '</td><td class="align-right">' +
      (x.netPer10 > 0 ? '+' : '') + ui.esc(x.netPer10) + '</td></tr>').join('');
    return '<div class="pro-block"><h4>Lineup rankings <span class="badge badge-t">measured</span></h4>' +
      '<p class="muted small">Five-player units with at least ' + ui.esc(r.minMinutes) + ' minutes, ranked by net points per 10 minutes. ' +
      ui.esc(r.note || '') + '</p>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Lineup</th><th class="align-right">Min</th>' +
      '<th class="align-right">Net</th><th class="align-right">Net / 10</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></div>';
  }

  function render(game) {
    if (game !== undefined) lastGame = game;
    const el = host();
    if (!el) return;
    el.hidden = !lastGame;
    if (!lastGame) { el.innerHTML = ''; return; }
    const head = '<div class="section-head"><div><h3>Game insights</h3>' +
      '<p class="muted small">Measured figures and rule-based analysis are labelled separately. Analysis is not a language-model summary.</p></div></div>';
    el.innerHTML = head +
      '<div class="toolbar">' +
        '<button type="button" class="btn btn-primary" data-pro="recap">Generate game recap</button>' +
        '<button type="button" class="btn btn-ghost" data-pro="lineups">Lineup rankings</button>' +
      '</div>' +
      '<div id="pro-output" aria-live="polite"></div>';
  }

  async function run(kind) {
    if (busy || !lastGame) return;
    const out = qs('#pro-output');
    if (out) out.innerHTML = '<p class="muted">Computing from recorded plays…</p>';
    busy = true;
    try {
      const doc = TBS.app.getState();
      const result = kind === 'recap'
        ? TBS.pro.gameRecap(doc, lastGame.id)
        : TBS.pro.lineupRankings(doc);
      if (out) out.innerHTML = kind === 'recap' ? renderRecap(result) : renderLineups(result);
    } catch (err) {
      if (out) out.innerHTML = '<p class="muted">Could not compute these insights from the recorded game data.</p>';
    } finally { busy = false; }
  }

  function init() {
    const el = host();
    if (!el) return;
    el.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('[data-pro]') : null;
      if (!btn) return;
      run(btn.dataset.pro);
    });
  }

  TBS.proui = { init: init, render: render, refresh: function () { render(); } };
})(window.TBS = window.TBS || {});
