/* =========================================================================
 * cloud.js — optional cloud sync with the TeamBallStats server.
 *
 * The app works fully offline without this module. When the page is served
 * by `node server/index.js`, this module detects the API and offers:
 *   - a cloud account (separate from the on-device sign-in);
 *   - push after each change (debounced), pull when the tab regains focus;
 *   - optimistic concurrency: every write names the revision it was based on.
 *     A stale write is NEVER applied silently. The user chooses merge, keep
 *     this device, use the cloud copy, or decide later. Each destructive
 *     choice first downloads a JSON backup of the copy being replaced;
 *   - an offline queue: changes stay pending and retry with backoff;
 *   - a guard against pushing an empty league over data.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const ui = TBS.ui;
  const qs = ui.qs;
  const META_KEY = 'bball_tm_cloud_v1';
  const DEBOUNCE_MS = 1500;
  const PULL_EVERY_MS = 60000;

  const st = {
    checked: false,
    available: false,
    user: null,
    entitlement: null,
    revision: 0,
    lastSyncedAt: null,
    pending: false,
    seq: 0,
    sending: false,
    queued: false,
    retry: 0,
    status: 'off',
    message: '',
    conflictOpen: false,
    allowEmptyOnce: false
  };
  let meta = { userId: null, revision: 0, lastSyncedAt: null };
  let timer = null;
  let applying = false;
  let dialogChoice = null;

  /* ---- persistence of the sync position (never league data) ------------ */

  function loadMeta() {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      meta = { userId: m.userId || null, revision: Number(m.revision) || 0, lastSyncedAt: m.lastSyncedAt || null };
    } catch (_) {
      meta = { userId: null, revision: 0, lastSyncedAt: null };
    }
  }

  function saveMeta() {
    meta = { userId: st.user ? st.user.id : null, revision: st.revision, lastSyncedAt: st.lastSyncedAt };
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* storage full: sync still works this session */ }
  }

  /* ---- API client (relative URLs only) ---------------------------------- */

  async function api(method, url, body) {
    const opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch('api/' + url, opts);
    } catch (_) {
      const err = new Error('The server cannot be reached.');
      err.offline = true;
      throw err;
    }
    let json = {};
    try { json = await res.json(); } catch (_) { json = {}; }
    return { status: res.status, json: json || {} };
  }

  /* ---- status ----------------------------------------------------------- */

  function setStatus(status, message) {
    st.status = status;
    st.message = message || '';
    render();
  }

  function signedIn() { return !!st.user; }

  function hasLocalData() {
    const s = TBS.app.getState();
    return !!s && ((s.players || []).length > 0 || (s.games || []).length > 0);
  }

  function summaryOf(doc) {
    const games = (doc && doc.games) || [];
    const players = (doc && doc.players) || [];
    const teams = (doc && doc.teams) || [];
    return { teams: teams.length, players: players.length, games: games.length };
  }

  function timeText(iso) {
    if (!iso) return 'never';
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  }

  /* ---- sign-in / sign-up ------------------------------------------------ */

  async function detect() {
    try {
      const r = await api('GET', 'health');
      st.available = r.status === 200 && r.json.ok === true;
    } catch (_) {
      st.available = false;
    }
    st.checked = true;
    if (!st.available) {
      setStatus('off', 'Cloud sync is off. Start the server with `node server/index.js` to enable it. The app keeps working offline.');
      return;
    }
    await refreshMe();
  }

  async function refreshMe() {
    let r;
    try { r = await api('GET', 'auth/me'); } catch (err) {
      setStatus('offline', 'Offline. Changes stay on this device and sync when the server is reachable.');
      return;
    }
    if (r.status === 200) {
      applyUser(r.json.user, r.json.entitlement);
      await pull(true);
    } else {
      applyUser(null, null);
      setStatus('idle', 'Sign in to sync this league across devices.');
    }
  }

  function applyUser(user, entitlement) {
    const previous = st.user ? st.user.id : null;
    st.user = user || null;
    st.entitlement = entitlement || null;
    loadMeta();
    if (st.user && meta.userId !== st.user.id) {
      /* A different account than the one this device last synced: start fresh. */
      st.revision = 0;
      st.lastSyncedAt = null;
    } else if (st.user) {
      st.revision = meta.revision;
      st.lastSyncedAt = meta.lastSyncedAt;
    } else if (previous) {
      st.revision = 0;
      st.lastSyncedAt = null;
      st.pending = false;
    }
    if (TBS.proui && TBS.proui.refresh) TBS.proui.refresh();
  }

  async function signIn(mode, username, password) {
    const path = mode === 'register' ? 'auth/register' : 'auth/login';
    const r = await api('POST', path, { username: username, password: password });
    if (r.status >= 200 && r.status < 300) {
      applyUser(r.json.user, r.json.entitlement);
      ui.toast(mode === 'register' ? 'Cloud account created.' : 'Signed in to cloud sync.', 'success');
      await pull(true);
      return true;
    }
    ui.toast(r.json.message || 'Could not sign in.', 'error');
    return false;
  }

  async function signOut() {
    try { await api('POST', 'auth/logout', {}); } catch (_) { /* offline: the server session expires on its own */ }
    clearTimeout(timer);
    applyUser(null, null);
    st.pending = false;
    setStatus('idle', 'Signed out. Changes on this device stay local.');
    ui.toast('Signed out of cloud sync.', 'success');
  }

  /* ---- change tracking and push ----------------------------------------- */

  function notify() {
    if (applying || !st.available || !signedIn()) return;
    st.pending = true;
    st.seq += 1;
    if (!st.conflictOpen) setStatus('pending', 'Changes waiting to sync…');
    schedule(DEBOUNCE_MS);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }

  async function push() {
    if (!signedIn() || !st.pending || st.conflictOpen) return;
    if (st.sending) { st.queued = true; return; }
    st.sending = true;
    const seqAtSend = st.seq;
    const doc = TBS.app.getState();
    const allowEmpty = st.allowEmptyOnce === true;
    st.allowEmptyOnce = false;
    setStatus('syncing', 'Syncing…');
    let r = null, failure = null;
    try {
      r = await api('PUT', 'league', { baseRevision: st.revision, document: doc, allowEmpty: allowEmpty });
    } catch (err) {
      failure = err;
    }
    st.sending = false;

    if (failure) {
      st.retry = Math.min(st.retry + 1, 6);
      setStatus('offline', 'Offline. ' + (st.pending ? 'Changes are queued and will retry.' : ''));
      schedule(Math.min(60000, 2000 * Math.pow(2, st.retry - 1)));
      return;
    }
    if (r.status === 200) {
      st.revision = r.json.revision;
      st.lastSyncedAt = new Date().toISOString();
      st.retry = 0;
      saveMeta();
      st.pending = st.seq !== seqAtSend;
      setStatus(st.pending ? 'pending' : 'saved', 'Synced as revision ' + st.revision + ' at ' + timeText(st.lastSyncedAt));
      if (st.pending) schedule(300);
      return;
    }
    if (r.status === 409 && r.json.error === 'conflict') { openConflict(r.json, 'push'); return; }
    if (r.status === 409 && r.json.error === 'empty_overwrite') { openEmptyGuard(r.json); return; }
    if (r.status === 401) { applyUser(null, null); setStatus('idle', 'Your cloud session ended. Sign in again to resume sync.'); return; }
    setStatus('error', r.json.message || 'Sync failed. Your data is still saved on this device.');
    if (st.queued) { st.queued = false; schedule(300); }
  }

  /* ---- pull ------------------------------------------------------------- */

  function applyCloud(cloud) {
    applying = true;
    try { TBS.app.replace(cloud.document); } finally { applying = false; }
    st.revision = cloud.revision;
    st.pending = false;
    st.lastSyncedAt = new Date().toISOString();
    saveMeta();
    setStatus('saved', 'Pulled revision ' + st.revision + ' from the cloud at ' + timeText(st.lastSyncedAt));
  }

  async function pull(initial) {
    if (!signedIn() || st.conflictOpen) return;
    if (st.sending) return;
    let r;
    try { r = await api('GET', 'league'); } catch (_) {
      setStatus('offline', 'Offline. Showing this device’s copy.');
      return;
    }
    if (r.status === 401) { applyUser(null, null); setStatus('idle', 'Your cloud session ended. Sign in again to resume sync.'); return; }
    if (r.status !== 200) { setStatus('error', r.json.message || 'Could not read the cloud copy.'); return; }
    const cloud = r.json;
    if (!cloud.document) {
      if (hasLocalData() && st.revision === 0) { st.pending = true; schedule(0); }
      else setStatus('idle', 'No cloud copy yet. Changes will create one.');
      return;
    }
    if (cloud.revision === st.revision && !st.pending) {
      setStatus('saved', 'Up to date at revision ' + st.revision + '.');
      return;
    }
    if (st.pending || (st.revision === 0 && hasLocalData())) {
      openConflict(cloud, st.revision === 0 ? 'first' : 'pull');
      return;
    }
    applyCloud(cloud);
  }

  /* ---- conflict handling ------------------------------------------------ */

  function downloadBackup(label, doc) {
    const stamp = TBS.storage.todayISO();
    const name = 'teamballstats-' + label + '-backup-' + stamp + '.json';
    ui.download(name, JSON.stringify(doc, null, 2), 'application/json');
  }

  function openConflict(server, reason) {
    if (st.conflictOpen) return;
    st.conflictOpen = true;
    const local = summaryOf(TBS.app.getState());
    const cloud = server.summary || summaryOf(server.document);
    const cloudRev = server.revision;
    const text = {
      push: 'Another device saved changes to the cloud copy after this device last synced.',
      pull: 'The cloud copy changed while this device also has unsynced changes.',
      first: 'This device already has league data, and the cloud copy also has data.'
    }[reason] || 'The cloud copy differs from this device.';
    setStatus('conflict', 'Conflict: choose how to combine the two copies. Nothing was overwritten.');

    const row = (label, s) => '<tr><th scope="row">' + label + '</th><td>' + (s.teams || 0) + '</td><td>' +
      (s.players || 0) + '</td><td>' + (s.games || 0) + '</td></tr>';
    const bodyHtml =
      '<p>' + ui.esc(text) + ' Nothing has been overwritten yet.</p>' +
      '<table class="data-table"><thead><tr><th></th><th>Teams</th><th>Players</th><th>Games</th></tr></thead><tbody>' +
      row('This device', local) + row('Cloud (revision ' + cloudRev + ')', cloud) + '</tbody></table>' +
      '<p class="muted small">Before any replacement, a JSON backup of the copy being replaced is downloaded.</p>';
    const footerHtml =
      '<button type="button" class="btn btn-ghost" data-cf="later">Decide later</button>' +
      '<button type="button" class="btn btn-ghost" data-cf="cloud">Use cloud copy</button>' +
      '<button type="button" class="btn btn-ghost" data-cf="device">Keep this device</button>' +
      '<button type="button" class="btn btn-primary" data-cf="merge">Merge both</button>';

    const close = ui.openDialog({ title: 'Sync conflict', bodyHtml: bodyHtml, footerHtml: footerHtml,
      onClose: () => dismissed('Sync paused. Resolve the conflict to continue.') });
    dialogChoice = function (choice) {
      close();
      st.conflictOpen = false;
      if (choice === 'later') { setStatus('conflict', 'Sync paused. Resolve the conflict to continue.'); return; }
      resolve(choice, server);
    };
  }

  /* Closed with X or Escape: nothing was chosen, so sync stays paused. */
  function dismissed(message) {
    if (!dialogChoice) return;
    dialogChoice = null;
    st.conflictOpen = false;
    setStatus('conflict', message);
  }

  /* Canonical JSON (sorted keys) so equal games compare equal. */
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  /* The last revision this device synced is the common ancestor. */
  async function baseDocument() {
    if (!st.revision) return null;
    try {
      const r = await api('GET', 'league/revisions/' + st.revision);
      return r.status === 200 ? r.json.document : null;
    } catch (_) { return null; }
  }

  /* Three-way merge at game level, using the base revision when it is kept:
   *   changed only on the cloud  -> take the cloud version
   *   changed only on this device -> keep this device's version
   *   changed on both             -> keep this device's version and REPORT it
   * Players, teams and games that exist on one side only are merged by
   * TBS.backup.mergeData (the existing, id-aware merge). */
  async function mergeCopies(server) {
    const local = TBS.app.getState();
    const base = await baseDocument();
    const merged = TBS.backup.mergeData(local, server.document);
    const report = { fromCloud: [], both: [], baseKept: !!base };
    const byId = list => { const o = {}; (list || []).forEach(g => { o[g.id] = g; }); return o; };
    const baseG = byId(base && base.games), localG = byId(local.games), cloudG = byId(server.document.games);
    merged.games = merged.games.map(g => {
      const L = localG[g.id], C = cloudG[g.id];
      if (!L || !C || same(L, C)) return g;
      const B = baseG[g.id];
      if (B && same(L, B)) { report.fromCloud.push(g.id); return C; }
      if (B && same(C, B)) return L;
      report.both.push(g.id);
      return L;
    });
    return { merged: merged, report: report };
  }

  async function resolve(choice, server) {
    const cloudRev = server.revision;
    if (choice === 'merge') {
      downloadBackup('device', TBS.app.getState());
      downloadBackup('cloud', server.document);
      st.conflictOpen = true;   /* block pushes while the ancestor is fetched */
      let result;
      try { result = await mergeCopies(server); } finally { st.conflictOpen = false; }
      applying = true;
      try { TBS.app.replace(result.merged); } finally { applying = false; }
      st.revision = cloudRev;
      st.pending = true;
      saveMeta();
      const r = result.report;
      const parts = [];
      if (r.fromCloud.length) parts.push(r.fromCloud.length + ' game(s) changed only on the cloud were taken from the cloud');
      if (r.both.length) parts.push(r.both.length + ' game(s) changed on both devices: this device’s version was kept, and the cloud version is in the downloaded cloud backup');
      if (!r.baseKept) parts.push('the common ancestor is no longer kept, so every shared game that differs kept this device’s version');
      setStatus('pending', 'Merged. ' + (parts.join('. ') || 'No game conflicts.') + '.');
      ui.toast('Merged both copies. ' + (parts.join('. ') || 'No game conflicts.') + '.', r.both.length ? 'error' : 'success');
      schedule(0);
      return;
    }
    if (choice === 'cloud') {
      downloadBackup('device', TBS.app.getState());
      applyCloud({ document: server.document, revision: cloudRev });
      ui.toast('Using the cloud copy. Your device copy was downloaded first.', 'success');
      return;
    }
    if (choice === 'device') {
      downloadBackup('cloud', server.document);
      st.revision = cloudRev;
      st.pending = true;
      saveMeta();
      setStatus('pending', 'Keeping this device’s copy. It will replace the cloud copy (the old one stays in history).');
      schedule(0);
      return;
    }
  }

  function openEmptyGuard(info) {
    if (st.conflictOpen) return;
    st.conflictOpen = true;
    setStatus('conflict', 'This device is empty, so nothing was pushed.');
    const bodyHtml = '<p>' + ui.esc(info.message || 'This device has no players or games.') +
      '</p><p class="muted small">If you cleared the league on purpose, you can replace the cloud copy. The old copy stays in revision history.</p>';
    const footerHtml =
      '<button type="button" class="btn btn-ghost" data-cf="later">Cancel</button>' +
      '<button type="button" class="btn btn-danger-ghost" data-cf="replace">Replace cloud with empty league</button>' +
      '<button type="button" class="btn btn-primary" data-cf="pull">Pull cloud copy</button>';
    const close = ui.openDialog({ title: 'Empty league', bodyHtml: bodyHtml, footerHtml: footerHtml,
      onClose: () => dismissed('Changes stay on this device. Sync is paused until you choose.') });
    dialogChoice = function (choice) {
      close();
      st.conflictOpen = false;
      if (choice === 'replace') {
        if (!ui.confirmDanger('Replace the cloud copy with an empty league? The previous copy stays in revision history.')) {
          setStatus('pending', 'Changes stay on this device. Sync is paused until you choose.');
          return;
        }
        st.allowEmptyOnce = true; st.pending = true; schedule(0); return;
      }
      if (choice === 'pull') { pull(false); return; }
      setStatus('pending', 'Changes stay on this device. Sync is paused until you choose.');
    };
  }

  /* ---- revision history (restore) --------------------------------------- */

  async function restoreRevision(rev) {
    const r = await api('GET', 'league/revisions/' + encodeURIComponent(rev));
    if (r.status !== 200) { ui.toast(r.json.message || 'That revision is not available.', 'error'); return; }
    if (!ui.confirmDanger('Restore revision ' + rev + '? This device will show that copy and it becomes the newest cloud revision. Your current copy stays in history.')) return;
    downloadBackup('before-restore', TBS.app.getState());
    applying = true;
    try { TBS.app.replace(r.json.document); } finally { applying = false; }
    st.pending = true;
    st.seq += 1;
    schedule(0);
    ui.toast('Revision ' + rev + ' restored and syncing.', 'success');
  }

  async function showHistory() {
    const r = await api('GET', 'league/revisions');
    if (r.status !== 200) { ui.toast(r.json.message || 'History is not available.', 'error'); return; }
    const list = r.json.revisions || [];
    const rows = list.length ? list.map(x => '<tr><td>' + x.revision + '</td><td>' + ui.esc(timeText(x.createdAt)) +
      '</td><td>' + (x.summary ? x.summary.games : 0) + ' games · ' + (x.summary ? x.summary.players : 0) + ' players</td>' +
      '<td><button type="button" class="btn btn-mini" data-restore="' + x.revision + '">Restore</button></td></tr>').join('')
      : '<tr><td colspan="4">No revisions yet.</td></tr>';
    ui.openDialog({
      title: 'Cloud history',
      bodyHtml: '<p class="muted small">The newest 50 revisions are kept. Restoring creates a new revision, so nothing is lost.</p>' +
        '<table class="data-table"><thead><tr><th>Rev</th><th>Saved</th><th>Contents</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
    });
  }

  /* ---- panel ------------------------------------------------------------ */

  function render() {
    const host = qs('#cloud-panel');
    if (!host) return;
    const chip = qs('#cloud-status-chip');
    if (chip) {
      const label = !st.available ? 'Offline app' : (!signedIn() ? 'Not signed in' :
        ({ saved: 'Synced', pending: 'Pending', syncing: 'Syncing', offline: 'Offline', conflict: 'Conflict', error: 'Error' }[st.status] || 'Ready'));
      chip.textContent = label;
      chip.dataset.state = st.status;
    }
    if (!st.checked) { host.innerHTML = '<p class="muted">Checking for the sync server…</p>'; return; }
    const head = '<h3>Cloud sync &amp; accounts</h3>';
    if (!st.available) {
      host.innerHTML = head + '<p class="muted">' + ui.esc(st.message) + '</p>' +
        '<p class="muted small">Everything in TeamBallStats works without the server: scoring, box scores, CSV, PDF and sharing. Cloud sync and Pro analytics need the server.</p>';
      return;
    }
    if (!signedIn()) {
      host.innerHTML = head +
        '<p class="muted">Create a cloud account to keep this league in sync across devices. Passwords are hashed on the server.</p>' +
        '<form id="cloud-form" class="form-grid" autocomplete="on">' +
          '<label class="field"><span>Username</span><input id="cloud-user" type="text" autocomplete="username" required minlength="3" maxlength="32" /></label>' +
          '<label class="field"><span>Password</span><input id="cloud-pass" type="password" autocomplete="current-password" required minlength="8" /></label>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn btn-primary" data-cloud="signin">Sign in</button>' +
            '<button type="button" class="btn btn-ghost" data-cloud="register">Create account</button>' +
          '</div>' +
        '</form>' +
        '<p class="form-hint" id="cloud-msg">' + ui.esc(st.message) + '</p>';
      return;
    }
    const ent = st.entitlement || { plan: 'free', active: false };
    const planText = ent.active ? 'Pro (' + (ent.source === 'webhook' ? 'subscription' : 'granted by operator') + ')' : 'Free';
    host.innerHTML = head +
      '<p><strong>' + ui.esc(st.user.username) + '</strong> · plan: ' + ui.esc(planText) + '</p>' +
      '<p class="muted small" id="cloud-state" data-state="' + ui.esc(st.status) + '">' + ui.esc(st.message) + '</p>' +
      '<p class="muted small">Last synced: ' + ui.esc(timeText(st.lastSyncedAt)) + ' · revision ' + st.revision + '</p>' +
      '<div class="toolbar">' +
        '<button type="button" class="btn btn-primary" data-cloud="sync">Sync now</button>' +
        '<button type="button" class="btn btn-ghost" data-cloud="pull">Pull cloud copy</button>' +
        '<button type="button" class="btn btn-ghost" data-cloud="history">History &amp; restore</button>' +
        '<button type="button" class="btn btn-ghost" data-cloud="signout">Sign out</button>' +
      '</div>';
  }

  function syncNow() {
    if (!signedIn()) return;
    if (st.pending) { st.seq += 1; schedule(0); return; }
    pull(false);
  }

  function init() {
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const cf = t.closest('[data-cf]');
      if (cf && dialogChoice) {
        const handler = dialogChoice;
        dialogChoice = null;
        handler(cf.dataset.cf);
        return;
      }
      const rs = t.closest('[data-restore]');
      if (rs) restoreRevision(Number(rs.dataset.restore));
    });
    const host = qs('#cloud-panel');
    if (host) {
      host.addEventListener('click', e => {
        const btn = e.target.closest ? e.target.closest('[data-cloud]') : null;
        if (!btn) return;
        const action = btn.dataset.cloud;
        if (action === 'signin' || action === 'register') {
          const u = qs('#cloud-user', host), p = qs('#cloud-pass', host);
          if (!u || !p || !u.value.trim() || !p.value) { ui.toast('Enter a username and password.', 'error'); return; }
          signIn(action, u.value.trim(), p.value).then(ok => { if (!ok) { p.value = ''; } }).catch(() => {
            ui.toast('The server cannot be reached. Try again when you are online.', 'error');
          });
        } else if (action === 'sync') { syncNow(); }
        else if (action === 'pull') { pull(false); }
        else if (action === 'history') { showHistory(); }
        else if (action === 'signout') { signOut(); }
      });
    }
    window.addEventListener('online', () => { if (st.available) refreshMe(); });
    window.addEventListener('offline', () => { if (st.available) setStatus('offline', 'Offline. Changes stay on this device.'); });
    const idlePull = () => { if (signedIn() && !st.pending && !st.conflictOpen && !st.sending) pull(false); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') idlePull(); });
    window.addEventListener('focus', idlePull);
    setInterval(idlePull, PULL_EVERY_MS);
    render();
    detect();
  }

  TBS.cloud = {
    init: init,
    notify: notify,
    state: function () {
      return { available: st.available, checked: st.checked, user: st.user, entitlement: st.entitlement,
        revision: st.revision, status: st.status, pending: st.pending };
    },
    refreshMe: refreshMe,
    request: api,
    isApplying: function () { return applying; }
  };
})(window.TBS = window.TBS || {});
