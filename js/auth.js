/* =========================================================================
 * auth.js — local sign-in gate for a TEAM account or a LEAGUE MANAGEMENT
 * account.
 *
 * There is no server in this app, so "authentication" is a local gate, not a
 * security boundary: passcodes are compared against hashes stored inside the
 * league document (league.access) or against the built-in demo passcodes.
 * The signed-in session is kept OUT of league data, in its own key:
 *   'bball_tm_session_v1'  (localStorage when "keep me signed in",
 *                           sessionStorage otherwise)
 *
 * Roles
 *   commissioner → league management: every tab, every action
 *   team         → one club: its roster, its fixtures, its games, its stats
 *
 * The gate is hidden as soon as a valid session exists, so a returning user
 * lands straight on the Overview tab.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const SESSION_KEY = 'bball_tm_session_v1';
  const ADMIN_DEFAULT = 'league';
  const TEAM_DEFAULT = 'team';
  const SALT = 'tbs::gate::v4::';

  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;

  let session = null;
  let wired = false;

  /* ----------------------------- safe storage ----------------------------- */

  function safeStore(name) {
    try {
      const store = win ? win[name] : null;
      return store || null;
    } catch (_) { return null; }
  }

  function readKey(key) {
    const candidates = [safeStore('localStorage'), safeStore('sessionStorage')];
    for (let i = 0; i < candidates.length; i++) {
      const store = candidates[i];
      if (!store) continue;
      try {
        const raw = store.getItem(key);
        if (raw) return raw;
      } catch (_) { /* private mode */ }
    }
    return null;
  }

  function removeKey(key) {
    [safeStore('localStorage'), safeStore('sessionStorage')].forEach(store => {
      if (!store) return;
      try { store.removeItem(key); } catch (_) { /* ignore */ }
    });
  }

  function writeKey(key, value, remember) {
    removeKey(key);
    const store = safeStore(remember ? 'localStorage' : 'sessionStorage');
    if (!store) return false;
    try { store.setItem(key, value); return true; } catch (_) { return false; }
  }

  /* -------------------------------- hashing ------------------------------- */

  /* FNV-1a + a cheap avalanche mix. Not cryptography — it keeps plaintext
   * passcodes out of localStorage and out of exported JSON backups. */
  function hash(code) {
    const text = SALT + String(code === null || code === undefined ? '' : code);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = (h2 + Math.imul(c, i + 7)) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    const hex = n => ('00000000' + n.toString(16)).slice(-8);
    return 'h1$' + hex(h1) + hex(h2);
  }

  /* league.access = { admin: 'h1$…', teams: { [teamId]: 'h1$…' } } */
  function accessOf(state) {
    const league = (state && state.league) || {};
    const access = league.access;
    return (access && typeof access === 'object') ? access : {};
  }

  function storedHash(state, role, teamId) {
    const access = accessOf(state);
    if (role === 'commissioner') {
      return typeof access.admin === 'string' ? access.admin : '';
    }
    const teams = (access.teams && typeof access.teams === 'object') ? access.teams : {};
    return typeof teams[teamId] === 'string' ? teams[teamId] : '';
  }

  function defaultFor(role) {
    return role === 'commissioner' ? ADMIN_DEFAULT : TEAM_DEFAULT;
  }

  function verify(state, role, teamId, code) {
    const input = String(code === null || code === undefined ? '' : code);
    if (!input.trim()) return false;
    if (role !== 'commissioner' && role !== 'team') return false;
    const stored = storedHash(state, role, teamId);
    if (stored) return hash(input) === stored;
    return input.trim() === defaultFor(role);
  }

  function hasCustomPasscode(state, role, teamId) {
    return !!storedHash(state, role, teamId);
  }

  function setPasscode(state, role, teamId, code) {
    const value = String(code || '').trim();
    if (!value) return false;
    const league = state.league = state.league || {};
    const access = league.access = (league.access && typeof league.access === 'object')
      ? league.access : {};
    if (role === 'commissioner') {
      access.admin = hash(value);
    } else {
      access.teams = (access.teams && typeof access.teams === 'object') ? access.teams : {};
      if (!teamId) return false;
      access.teams[teamId] = hash(value);
    }
    return true;
  }

  /* -------------------------------- session ------------------------------- */

  function sessionTeam(state, teamId) {
    return state && Array.isArray(state.teams)
      ? state.teams.find(t => t.id === teamId) || null
      : null;
  }

  function restore() {
    const raw = readKey(SESSION_KEY);
    if (!raw) return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { return null; }
    if (!parsed || (parsed.role !== 'commissioner' && parsed.role !== 'team')) return null;
    if (parsed.role === 'team' && !parsed.teamId) return null;
    session = {
      role: parsed.role,
      teamId: parsed.role === 'team' ? String(parsed.teamId) : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
      signedInAt: Number(parsed.signedInAt) || Date.now(),
      remember: !!readKeyFrom('localStorage', SESSION_KEY) || parsed.remember !== false
    };
    return session;
  }

  function readKeyFrom(storeName, key) {
    const store = safeStore(storeName);
    if (!store) return null;
    try { return store.getItem(key); } catch (_) { return null; }
  }

  function persist() {
    if (!session) { removeKey(SESSION_KEY); return false; }
    const payload = JSON.stringify({
      v: 1,
      role: session.role,
      teamId: session.teamId,
      name: session.name,
      signedInAt: session.signedInAt
    });
    return writeKey(SESSION_KEY, payload, session.remember !== false);
  }

  function current() { return session; }
  function isSignedIn() { return !!session; }
  function isAdmin() { return !!session && session.role === 'commissioner'; }
  function role() { return session ? session.role : null; }
  function myTeamId() { return session && session.role === 'team' ? session.teamId : ''; }

  function displayName(state) {
    if (!session) return '';
    if (session.role === 'commissioner') {
      return (state && state.league && state.league.name) || 'League management';
    }
    const team = sessionTeam(state, session.teamId);
    return team ? team.name : (session.name || 'Team');
  }

  function roleLabel() {
    if (!session) return '';
    return session.role === 'commissioner' ? 'League management' : 'Team account';
  }

  /* The team a view should centre on: the signed-in club, or the league's
   * own "primary" club for management. */
  function focusTeamId(state) {
    if (session && session.role === 'team') return session.teamId;
    return state && state.league ? state.league.primaryTeamId : '';
  }

  /* ------------------------------ permissions ----------------------------- */

  function canManageLeague() { return isAdmin(); }

  function canManageTeam(teamId) {
    if (!session) return false;
    if (isAdmin()) return true;
    return teamId === session.teamId;
  }

  function canEditPlayer(player) {
    if (!session) return false;
    if (isAdmin()) return true;
    return !!player && player.teamId === session.teamId;
  }

  function canScoreGame(game) {
    if (!session) return false;
    if (isAdmin()) return true;
    if (!game) return false;
    return game.homeTeamId === session.teamId || game.awayTeamId === session.teamId;
  }

  function canCreateFixture(homeTeamId, awayTeamId) {
    if (!session) return false;
    if (isAdmin()) return true;
    return homeTeamId === session.teamId || awayTeamId === session.teamId;
  }

  function canDeleteGame() { return isAdmin(); }
  function canDeleteTeam() { return isAdmin(); }
  function canResetData() { return isAdmin(); }

  /* -------------------------------- sign in ------------------------------- */

  /* creds: { role, teamId, passcode, remember } */
  function signIn(state, creds) {
    const c = creds || {};
    const targetRole = c.role === 'commissioner' ? 'commissioner' : 'team';
    let teamId = '';

    if (targetRole === 'team') {
      teamId = String(c.teamId || '');
      if (!teamId) return { ok: false, error: 'Choose the team you are signing in for.' };
      const team = sessionTeam(state, teamId);
      if (!team) return { ok: false, error: 'That team no longer exists in this league.' };
      if (!verify(state, 'team', teamId, c.passcode)) {
        return { ok: false, error: 'That passcode does not match this team.' };
      }
      session = {
        role: 'team', teamId: teamId, name: team.name,
        signedInAt: Date.now(), remember: c.remember !== false
      };
    } else {
      if (!verify(state, 'commissioner', '', c.passcode)) {
        return { ok: false, error: 'That passcode does not match league management.' };
      }
      session = {
        role: 'commissioner', teamId: '', name: 'League management',
        signedInAt: Date.now(), remember: c.remember !== false
      };
    }

    persist();
    return { ok: true, session: session };
  }

  function signOut(opts) {
    const options = opts || {};
    session = null;
    removeKey(SESSION_KEY);
    lock();
    if (TBS.app && TBS.app.activate) {
      try { TBS.app.activate('dashboard'); } catch (_) { /* not ready */ }
    }
    if (options.announce && TBS.ui) TBS.ui.toast('Signed out of this device.', 'info');
    if (options.silent) return;
    try {
      if (win && win.location) win.location.hash = 'dashboard';
    } catch (_) { /* file:// */ }
  }

  /* ------------------------------- gate paint ----------------------------- */

  function gateEl() { return doc ? doc.querySelector('#auth-gate') : null; }

  let gateRole = 'team';

  function paintTeamOptions(state) {
    const select = doc && doc.querySelector('#auth-team');
    if (!select) return;
    const previous = select.value;
    const teams = (state && state.teams) || [];
    select.innerHTML = teams.length
      ? teams.map(t => '<option value="' + escapeHtml(t.id) + '">' +
          escapeHtml(t.name) + '</option>').join('')
      : '<option value="">No teams in this league yet</option>';
    if (previous && teams.some(t => t.id === previous)) select.value = previous;
    else if (teams.length && session && session.teamId) select.value = session.teamId;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function paintGateRole(range) {
    if (!doc) return;
    gateRole = range === 'commissioner' ? 'commissioner' : 'team';
    Array.from(doc.querySelectorAll('#auth-gate .role-card')).forEach(card => {
      const on = card.dataset.role === gateRole;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const wrap = doc.querySelector('#auth-team-wrap');
    if (wrap) wrap.hidden = gateRole !== 'team';
    const hint = doc.querySelector('#auth-hint');
    if (hint) {
      hint.innerHTML = gateRole === 'team'
        ? 'Demo passcode for every team: <code>team</code> — change it in Data → Access &amp; roles.'
        : 'Demo passcode for league management: <code>league</code> — change it in Data → Access &amp; roles.';
    }
    const pass = doc.querySelector('#auth-passcode');
    if (pass) {
      pass.value = '';
      pass.setAttribute('aria-label', gateRole === 'team' ? 'Team passcode' : 'League management passcode');
    }
    const err = doc.querySelector('#auth-error');
    if (err) err.textContent = '';
  }

  function shellEl() { return doc ? doc.querySelector('.app-shell') : null; }

  function setShellInert(on) {
    const shell = shellEl();
    if (!shell) return;
    if (on) {
      shell.setAttribute('inert', '');
      shell.setAttribute('aria-hidden', 'true');
    } else {
      shell.removeAttribute('inert');
      shell.removeAttribute('aria-hidden');
    }
  }

  function showGate(state) {
    if (!doc) return;
    doc.documentElement.classList.remove('has-session');
    setShellInert(true);
    const gate = gateEl();
    if (gate && gate.hasAttribute('hidden')) gate.removeAttribute('hidden');
    paintTeamOptions(state || (TBS.app && TBS.app.getState ? TBS.app.getState() : null));
    paintGateRole(gateRole);
    const pass = doc.querySelector('#auth-passcode');
    if (pass && typeof pass.focus === 'function') {
      try { pass.focus({ preventScroll: true }); } catch (_) { pass.focus(); }
    }
  }

  function hideGate() {
    if (!doc) return;
    doc.documentElement.classList.add('has-session');
    const gate = gateEl();
    if (gate) gate.setAttribute('hidden', 'hidden');
    setShellInert(false);
    if (TBS.ui && TBS.ui.closeAllDialogs) TBS.ui.closeAllDialogs();
    if (doc.body) doc.body.style.overflow = '';
  }

  function lock() {
    session = null;
    if (TBS.ui && TBS.ui.closeAllDialogs) TBS.ui.closeAllDialogs();
    showGate(TBS.app && TBS.app.getState ? TBS.app.getState() : null);
    paintIdentity(TBS.app && TBS.app.getState ? TBS.app.getState() : null);
    if (TBS.app && TBS.app.renderAll) {
      try { TBS.app.renderAll(); } catch (_) { /* not initialised yet */ }
    }
  }

  function unlock(state) {
    hideGate();
    paintIdentity(state || (TBS.app && TBS.app.getState ? TBS.app.getState() : null));
  }

  /* ------------------------------- identity UI ---------------------------- */

  function icon(name) {
    return TBS.ui && TBS.ui.icon ? TBS.ui.icon(name) : '';
  }

  function paintIdentity(state) {
    if (!doc) return;
    const btn = doc.querySelector('#account-btn');
    if (btn) {
      if (!session) {
        btn.innerHTML = '<span class="account-avatar" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.6 20.2c.5-4 3.6-6.2 7.4-6.2s6.9 2.2 7.4 6.2"/></svg></span>' +
          '<span class="account-text"><strong>Sign in</strong><small>Team or league</small></span>';
        btn.setAttribute('aria-label', 'Sign in');
      } else {
        const team = session.role === 'team' ? sessionTeam(state, session.teamId) : null;
        const color = (team && team.color) || (session.role === 'commissioner' ? '#fdb927' : '#1d428a');
        const initials = (session.role === 'commissioner' ? 'LM' :
          String(displayName(state) || 'T').split(/\s+/).map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase());
        btn.innerHTML = '<span class="account-avatar" style="--account-color:' + escapeHtml(color) + '" aria-hidden="true">' +
          '<span>' + escapeHtml(initials) + '</span></span>' +
          '<span class="account-text"><strong>' + escapeHtml(displayName(state)) + '</strong>' +
          '<small>' + escapeHtml(roleLabel()) + '</small></span>';
        btn.setAttribute('aria-label', 'Signed in as ' + displayName(state) + ' — ' + roleLabel() + '. Open account.');
      }
    }

    const bandMeta = doc.querySelector('#band-meta');
    if (bandMeta) {
      const teams = state && Array.isArray(state.teams) ? state.teams.length : 0;
      const games = state && Array.isArray(state.games) ? state.games.length : 0;
      bandMeta.innerHTML = '<span>' + teams + ' teams</span><span class="band-dot">·</span>' +
        '<span>' + games + ' games</span>';
    }

    const chip = doc.querySelector('#header-record');
    if (chip) chip.title = session && session.role === 'team'
      ? 'Record for ' + displayName(state)
      : 'Record for the league’s own team';
  }

  function openAccount() {
    const state = TBS.app && TBS.app.getState ? TBS.app.getState() : null;
    if (!session || !TBS.ui) return;
    const team = session.role === 'team' ? sessionTeam(state, session.teamId) : null;
    const rows = [
      { label: 'Account', value: session.role === 'team' ? displayName(state) : 'League management' },
      { label: 'Role', value: roleLabel() },
      { label: 'League', value: (state && state.league && state.league.name) || '—' },
      { label: 'Scope', value: session.role === 'commissioner'
          ? 'Every team, game and setting in this league'
          : 'Your roster, fixtures, games and player stats' },
      { label: 'Passcode', value: hasCustomPasscode(state, session.role, session.teamId)
          ? 'Custom passcode set' : 'Demo passcode in use' }
    ];
    TBS.ui.openDialog({
      title: 'Account',
      bodyHtml:
        '<div class="account-sheet">' +
          (team
            ? '<div class="account-team">' + TBS.ui.teamLogo(team, 'lg') +
              '<div><strong>' + escapeHtml(team.name) + '</strong>' +
              '<span>' + escapeHtml(team.short || '') + (team.color ? ' · ' + team.color : '') + '</span></div></div>'
            : '<div class="account-team">' +
              '<span class="account-badge" aria-hidden="true">' + icon('trophy') + '</span>' +
              '<div><strong>' + escapeHtml(displayName(state)) + '</strong><span>League management</span></div></div>') +
          '<dl class="account-rows">' + rows.map(r =>
            '<div><dt>' + escapeHtml(r.label) + '</dt><dd>' + escapeHtml(r.value) + '</dd></div>').join('') +
          '</dl>' +
        '</div>',
      footerHtml:
        '<button type="button" class="btn btn-ghost" data-close>Close</button>' +
        (isAdmin() ? '<button type="button" class="btn btn-ghost" data-account="access">Access &amp; roles</button>' : '') +
        '<button type="button" class="btn btn-primary" data-account="switch">Switch account</button>',
      onMount: (overlay, close) => {
        overlay.addEventListener('click', e => {
          const btn = e.target.closest('[data-account]');
          if (!btn) return;
          close();
          if (btn.dataset.account === 'switch') signOut({ announce: true });
          else if (btn.dataset.account === 'access') {
            if (TBS.app) TBS.app.go('data');
            setTimeout(() => {
              const panel = doc.querySelector('#access-panel');
              if (panel) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (panel.classList) {
                  panel.classList.add('is-flash');
                  setTimeout(() => panel.classList.remove('is-flash'), 1600);
                }
              }
            }, 120);
          }
        });
      }
    });
  }

  /* -------------------------------- wiring -------------------------------- */

  function init() {
    restore();
    const state = TBS.app && TBS.app.getState ? TBS.app.getState() : null;

    /* A team account whose club was deleted can no longer be valid. */
    if (session && session.role === 'team' && !sessionTeam(state, session.teamId)) {
      session = null;
      removeKey(SESSION_KEY);
    }

    paintTeamOptions(state);
    paintGateRole('team');
    paintIdentity(state);

    if (session) hideGate();
    else showGate(state);

    if (wired || !doc) return;
    wired = true;

    const gate = gateEl();
    if (gate) {
      gate.addEventListener('click', e => {
        const card = e.target.closest('.role-card');
        if (card) { paintGateRole(card.dataset.role); return; }
        const peek = e.target.closest('[data-toggle-pass]');
        if (peek) {
          const input = doc.querySelector('#auth-passcode');
          if (!input) return;
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          peek.setAttribute('aria-pressed', show ? 'true' : 'false');
          peek.textContent = show ? 'Hide' : 'Show';
        }
      });

      /* Radio-group keyboard support: ←/→ (or ↑/↓) switch account type. */
      gate.addEventListener('keydown', e => {
        const card = e.target.closest && e.target.closest('.role-card');
        if (!card) return;
        const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        if (keys.indexOf(e.key) < 0) return;
        e.preventDefault();
        const next = gateRole === 'team' ? 'commissioner' : 'team';
        paintGateRole(next);
        const target = doc.querySelector('.role-card[data-role="' + next + '"]');
        if (target && target.focus) target.focus();
      });

      const form = doc.querySelector('#auth-form');
      if (form) {
        form.addEventListener('submit', e => {
          e.preventDefault();
          const err = doc.querySelector('#auth-error');
          const pass = doc.querySelector('#auth-passcode');
          const teamSelect = doc.querySelector('#auth-team');
          const remember = doc.querySelector('#auth-remember');
          const crew = TBS.app && TBS.app.getState ? TBS.app.getState() : null;
          const result = signIn(crew, {
            role: gateRole,
            teamId: teamSelect ? teamSelect.value : '',
            passcode: pass ? pass.value : '',
            remember: remember ? !!remember.checked : true
          });
          if (!result.ok) {
            if (err) err.textContent = result.error;
            if (pass) {
              pass.classList.add('is-invalid');
              pass.select();
            }
            return;
          }
          if (err) err.textContent = '';
          if (pass) { pass.classList.remove('is-invalid'); pass.value = ''; }
          unlock(crew);
          if (TBS.app) {
            TBS.app.renderAll();
            TBS.app.go('dashboard');
            TBS.app.activate('dashboard');
          }
          if (TBS.ui) {
            TBS.ui.toast(session.role === 'commissioner'
              ? 'Signed in as league management.'
              : 'Signed in as ' + displayName(crew) + '.', 'success');
          }
        });
      }
    }

    const accountBtn = doc.querySelector('#account-btn');
    if (accountBtn) accountBtn.addEventListener('click', openAccount);

    const demoNote = doc.querySelector('#auth-demo-note');
    if (demoNote) {
      demoNote.addEventListener('click', () => {
        const crew = TBS.app && TBS.app.getState ? TBS.app.getState() : null;
        const teams = (crew && crew.teams) || [];
        const custom = teams.filter(t => hasCustomPasscode(crew, 'team', t.id));
        TBS.ui.openDialog({
          title: 'How sign-in works',
          bodyHtml:
            '<p class="muted small">TeamBallStats has no server: this gate chooses <em>which account</em> ' +
              'you are working as on this device. League data stays in this browser.</p>' +
            '<div class="signin-grid">' +
              '<div class="signin-card"><strong>Team account</strong>' +
                '<p>One club: its roster, fixtures, games, box scores and player stats. ' +
                  'Other clubs are read-only.</p></div>' +
              '<div class="signin-card"><strong>League management</strong>' +
                '<p>Everything: every team, every game, settings, backups and passcodes.</p></div>' +
            '</div>' +
            '<table class="data-table signin-table"><thead><tr><th scope="col">Account</th>' +
              '<th scope="col">Demo passcode</th><th scope="col">Status</th></tr></thead><tbody>' +
              '<tr><td>League management</td><td><code>' + escapeHtml(ADMIN_DEFAULT) + '</code></td><td>' +
                (hasCustomPasscode(crew, 'commissioner', '') ? 'Custom passcode set' : 'Demo passcode active') +
              '</td></tr>' +
              '<tr><td>Team (each club)</td><td><code>' + escapeHtml(TEAM_DEFAULT) + '</code></td><td>' +
                (custom.length ? custom.length + ' club(s) with a custom passcode' : 'Demo passcode active') +
              '</td></tr>' +
            '</tbody></table>' +
            '<p class="footnote">League management can replace both demo passcodes in ' +
              '<strong>Data → Access &amp; roles</strong>. Passcodes are stored as salted hashes and never ' +
              'appear in a JSON backup. “Keep me signed in” persists only this device session ' +
              '(<code>' + escapeHtml(SESSION_KEY) + '</code>).</p>',
          footerHtml: '<button type="button" class="btn btn-primary" data-close>Got it</button>'
        });
      });
    }

    const signOutBtn = doc.querySelector('#sign-out-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => {
        if (TBS.ui && !TBS.ui.confirmDanger('Sign out of this device? Your league data stays saved.')) return;
        signOut({ announce: true });
      });
    }

    /* Keep sessions in sync across tabs: signing out here locks every tab. */
    if (win && win.addEventListener) {
      win.addEventListener('storage', e => {
        if (!e || e.key !== SESSION_KEY) return;
        const before = !!session;
        session = null;
        restore();
        if (!session) showGate(TBS.app && TBS.app.getState ? TBS.app.getState() : null);
        else hideGate();
        paintIdentity(TBS.app && TBS.app.getState ? TBS.app.getState() : null);
        if (before !== !!session && TBS.app) {
          try { TBS.app.renderAll(); } catch (_) { /* ignore */ }
        }
      });
    }

    /* Ctrl/⌘ + Shift + L: quick lock of the console. */
    doc.addEventListener('keydown', e => {
      if (!session) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'l') {
        e.preventDefault();
        signOut({ announce: true });
      }
    });
  }

  TBS.auth = {
    SESSION_KEY: SESSION_KEY,
    ADMIN_DEFAULT: ADMIN_DEFAULT,
    TEAM_DEFAULT: TEAM_DEFAULT,
    hash: hash,
    verify: verify,
    hasCustomPasscode: hasCustomPasscode,
    setPasscode: setPasscode,
    current: current,
    isSignedIn: isSignedIn,
    isAdmin: isAdmin,
    role: role,
    myTeamId: myTeamId,
    displayName: displayName,
    roleLabel: roleLabel,
    focusTeamId: focusTeamId,
    canManageLeague: canManageLeague,
    canManageTeam: canManageTeam,
    canEditPlayer: canEditPlayer,
    canScoreGame: canScoreGame,
    canCreateFixture: canCreateFixture,
    canDeleteGame: canDeleteGame,
    canDeleteTeam: canDeleteTeam,
    canResetData: canResetData,
    signIn: signIn,
    signOut: signOut,
    restore: restore,
    init: init,
    lock: lock,
    unlock: unlock,
    paintIdentity: paintIdentity,
    paintGateRole: paintGateRole,
    showGate: showGate,
    openAccount: openAccount
  };
})(window.TBS = window.TBS || {});
