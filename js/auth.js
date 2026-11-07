/* =========================================================================
 * auth.js — local username/password accounts for TEAM and LEAGUE MANAGEMENT.
 *
 * This offline app has no server. Accounts are a device-local working gate,
 * not a production security boundary: anyone with browser dev tools can edit
 * local data. The UI states this limitation explicitly.
 *
 * Credentials live in their own key, never in league data or JSON backups:
 *   bball_tm_accounts_v1  { version: 1, accounts: [account] }
 *   account = { id, username, role, teamId, credential, sessionVersion, ... }
 *   credential = { algorithm: 'PBKDF2-SHA-256', iterations, salt, hash }
 *
 * Passwords use Web Crypto PBKDF2-SHA-256 with a random 16-byte salt and
 * 310,000 iterations. Plaintext passwords are never persisted or exported.
 * Sessions live in bball_tm_session_v1 (local or session storage).
 *
 * Roles
 *   commissioner → league-wide stats and league settings, but NO access to
 *                  another account's username/password or password changes
 *   team         → one club's writes, plus read-only stats for every club
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const SESSION_KEY = 'bball_tm_session_v1';
  const ACCOUNTS_KEY = 'bball_tm_accounts_v1';
  const PBKDF2_ITERATIONS = 310000;
  const PASSWORD_MIN = 8;
  const PASSWORD_MAX = 128;
  const LEGACY_SALT = 'tbs::gate::v4::';

  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  let session = null;
  let wired = false;
  let gateRole = 'team';
  let gateMode = 'signin';
  let gateBusy = false;

  /* ----------------------------- safe storage ----------------------------- */

  function safeStore(name) {
    try { return win ? win[name] : null; } catch (_) { return null; }
  }

  function readKeyFrom(storeName, key) {
    const store = safeStore(storeName);
    if (!store) return null;
    try { return store.getItem(key); } catch (_) { return null; }
  }

  function readKey(key) {
    return readKeyFrom('localStorage', key) || readKeyFrom('sessionStorage', key);
  }

  function removeKey(key) {
    [safeStore('localStorage'), safeStore('sessionStorage')].forEach(store => {
      if (!store) return;
      try { store.removeItem(key); } catch (_) { /* private mode */ }
    });
  }

  function writeSession(key, value, remember) {
    removeKey(key);
    const store = safeStore(remember ? 'localStorage' : 'sessionStorage');
    if (!store) return false;
    try { store.setItem(key, value); return true; } catch (_) { return false; }
  }

  /* SetItem is atomic in browsers: on quota failure the old registry remains. */
  function writeRegistry(registry) {
    const store = safeStore('localStorage');
    if (!store) return false;
    try {
      store.setItem(ACCOUNTS_KEY, JSON.stringify(registry));
      return true;
    } catch (_) { return false; }
  }

  function validCredential(credential) {
    return !!credential && credential.algorithm === 'PBKDF2-SHA-256' &&
      Number(credential.iterations) >= 100000 && Number(credential.iterations) <= 1000000 &&
      typeof credential.salt === 'string' && typeof credential.hash === 'string';
  }

  function validAccount(account) {
    return !!account && typeof account.id === 'string' &&
      typeof account.username === 'string' &&
      (account.role === 'commissioner' || account.role === 'team') &&
      (account.role !== 'team' || !!account.teamId) &&
      validCredential(account.credential);
  }

  function readRegistry() {
    const raw = readKeyFrom('localStorage', ACCOUNTS_KEY);
    if (!raw) return { version: 1, accounts: [] };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.accounts) ||
          !parsed.accounts.every(validAccount)) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function findAccount(username) {
    const registry = readRegistry();
    if (!registry) return null;
    const key = String(username || '').trim().toLowerCase();
    return registry.accounts.find(a => a.username.toLowerCase() === key) || null;
  }

  function accountFor(role, teamId) {
    const registry = readRegistry();
    if (!registry) return null;
    return registry.accounts.find(a => a.role === role &&
      (role !== 'team' || a.teamId === teamId)) || null;
  }

  function hasAccount(role, teamId) { return !!accountFor(role, teamId); }

  function availableTeams(state) {
    const teams = state && Array.isArray(state.teams) ? state.teams : [];
    return teams.filter(t => !hasAccount('team', t.id));
  }

  /* ------------------------------- passwords ------------------------------ */

  function cryptoApi() {
    try { return globalThis.crypto || (win && win.crypto) || null; } catch (_) { return null; }
  }

  function hasPasswordSupport() {
    const crypto = cryptoApi();
    return !!(crypto && crypto.subtle && crypto.getRandomValues &&
      typeof TextEncoder !== 'undefined');
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2];
      out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
      out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
      out += c === undefined ? '=' : B64[c & 63];
    }
    return out;
  }

  function fromBase64(text) {
    if (typeof text !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
      throw new Error('Invalid credential encoding');
    }
    const clean = text.replace(/=+$/, '');
    const bytes = [];
    let buffer = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
      buffer = (buffer << 6) | B64.indexOf(clean[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
    }
    return new Uint8Array(bytes);
  }

  async function derivePassword(password, salt) {
    const crypto = cryptoApi();
    if (!hasPasswordSupport()) {
      throw new Error('Account security needs Web Crypto. Use a current browser over HTTPS, localhost, or a local file.');
    }
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256'
    }, key, 256);
    return new Uint8Array(bits);
  }

  async function makeCredential(password) {
    const salt = cryptoApi().getRandomValues(new Uint8Array(16));
    const hash = await derivePassword(password, salt);
    return {
      algorithm: 'PBKDF2-SHA-256', iterations: PBKDF2_ITERATIONS,
      salt: toBase64(salt), hash: toBase64(hash)
    };
  }

  async function verifyPassword(account, password) {
    if (!validCredential(account && account.credential)) return false;
    try {
      const expected = fromBase64(account.credential.hash);
      const actual = await derivePassword(String(password || ''), fromBase64(account.credential.salt));
      if (expected.length !== actual.length) return false;
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
      return diff === 0;
    } catch (_) { return false; }
  }

  function normalizeUsername(value) {
    return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  }

  function validateUsername(value) {
    const username = normalizeUsername(value);
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      return { ok: false, error: 'Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens, starting with a letter or number.' };
    }
    return { ok: true, username: username };
  }

  function validatePassword(password, confirmation) {
    const value = String(password === null || password === undefined ? '' : password);
    if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX || !value.trim()) {
      return { ok: false, error: 'Password must be 8–128 characters and cannot be only spaces.' };
    }
    if (value !== String(confirmation === null || confirmation === undefined ? '' : confirmation)) {
      return { ok: false, error: 'The two passwords do not match.' };
    }
    return { ok: true };
  }

  /* ------------------- legacy passcode upgrade (one time) ------------------ */
  /* Old installs stored an FNV gate hash in league.access. It is accepted only
   * as proof while creating the replacement username/password account. Once an
   * account exists, legacy passcodes can no longer sign in. */

  function legacyHash(code) {
    const text = LEGACY_SALT + String(code === null || code === undefined ? '' : code);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = ((h1 ^ c) * 16777619) >>> 0;
      h2 = (h2 + Math.imul(c, i + 7)) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    const hex = n => ('00000000' + n.toString(16)).slice(-8);
    return 'h1$' + hex(h1) + hex(h2);
  }

  function legacyHashOf(state, role, teamId) {
    const access = state && state.league && state.league.access;
    if (!access || typeof access !== 'object') return '';
    if (role === 'commissioner') return typeof access.admin === 'string' ? access.admin : '';
    const teams = access.teams && typeof access.teams === 'object' ? access.teams : {};
    return typeof teams[teamId] === 'string' ? teams[teamId] : '';
  }

  function hasLegacyPasscode(state, role, teamId) {
    return !hasAccount(role, teamId) && !!legacyHashOf(state, role, teamId);
  }

  function verifyLegacy(state, role, teamId, passcode) {
    const stored = legacyHashOf(state, role, teamId);
    const input = String(passcode || '');
    return !!stored && !!input.trim() && legacyHash(input) === stored;
  }

  /* -------------------------------- accounts ------------------------------ */

  function sessionTeam(state, teamId) {
    return state && Array.isArray(state.teams)
      ? state.teams.find(t => t.id === teamId) || null : null;
  }

  function establishSession(account, remember) {
    session = {
      accountId: account.id,
      role: account.role,
      teamId: account.role === 'team' ? account.teamId : '',
      username: account.username,
      sessionVersion: Number(account.sessionVersion) || 1,
      signedInAt: Date.now(),
      remember: remember !== false
    };
    persistSession();
    return session;
  }

  /* creds: { role, teamId, username, password, confirmPassword,
   *          legacyPasscode?, remember? } */
  async function register(state, creds) {
    const c = creds || {};
    const role = c.role === 'commissioner' ? 'commissioner' : c.role === 'team' ? 'team' : '';
    if (!role) return { ok: false, error: 'Choose Team or League management.' };
    if (!hasPasswordSupport()) {
      return { ok: false, error: 'Account security needs Web Crypto. Use a current browser over HTTPS, localhost, or a local file.' };
    }
    const registry = readRegistry();
    if (!registry) return { ok: false, error: 'Account storage on this device is unavailable or damaged. Existing accounts were not changed.' };

    let teamId = '';
    if (role === 'team') {
      teamId = String(c.teamId || '');
      if (!sessionTeam(state, teamId)) return { ok: false, error: 'Choose an existing team in this league.' };
    }
    if (accountFor(role, teamId)) {
      return { ok: false, error: role === 'team'
        ? 'This team already has an account on this device. Sign in with its username instead.'
        : 'League management already has an account on this device. Sign in instead.' };
    }
    const nameCheck = validateUsername(c.username);
    if (!nameCheck.ok) return nameCheck;
    if (findAccount(nameCheck.username)) return { ok: false, error: 'That username is already taken on this device. Choose another.' };
    const passwordCheck = validatePassword(c.password, c.confirmPassword);
    if (!passwordCheck.ok) return passwordCheck;
    if (hasLegacyPasscode(state, role, teamId) && !verifyLegacy(state, role, teamId, c.legacyPasscode)) {
      return { ok: false, error: 'Enter the existing custom passcode once to upgrade this access to an account.' };
    }

    try {
      const credential = await makeCredential(String(c.password));
      /* Re-read after the async derivation so a second tab cannot slip in the
       * same username or claim the same club while this form was open. */
      const latest = readRegistry();
      if (!latest) return { ok: false, error: 'Account storage changed unexpectedly. Try again.' };
      if (latest.accounts.some(a => a.username.toLowerCase() === nameCheck.username)) {
        return { ok: false, error: 'That username is already taken on this device. Choose another.' };
      }
      if (latest.accounts.some(a => a.role === role && (role !== 'team' || a.teamId === teamId))) {
        return { ok: false, error: 'This access already has an account. Sign in instead.' };
      }
      const account = {
        id: TBS.storage.uid('account'), username: nameCheck.username,
        role: role, teamId: teamId, credential: credential, sessionVersion: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      latest.accounts.push(account);
      if (!writeRegistry(latest)) {
        return { ok: false, error: 'Could not save the account. Browser storage may be full or disabled.' };
      }
      establishSession(account, c.remember);
      return { ok: true, session: session };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Could not create the account. Try again.' };
    }
  }

  /* Username determines the role; callers cannot elevate by sending a role. */
  async function signIn(state, creds) {
    const c = creds || {};
    const username = normalizeUsername(c.username);
    const password = String(c.password === null || c.password === undefined ? '' : c.password);
    if (!username || !password) return { ok: false, error: 'Enter your username and password.' };
    const account = findAccount(username);
    if (!account || !(await verifyPassword(account, password))) {
      return { ok: false, error: 'Username or password is incorrect.' };
    }
    if (account.role === 'team' && !sessionTeam(state, account.teamId)) {
      return { ok: false, error: 'That team no longer exists in this league.' };
    }
    establishSession(account, c.remember);
    return { ok: true, session: session };
  }

  async function changePassword(creds) {
    if (!session) return { ok: false, error: 'Sign in first.' };
    const c = creds || {};
    const registry = readRegistry();
    const account = registry && registry.accounts.find(a => a.id === session.accountId);
    if (!account) return { ok: false, error: 'This account is no longer available on this device.' };
    if (!(await verifyPassword(account, c.currentPassword))) {
      return { ok: false, error: 'Current password is incorrect.' };
    }
    const check = validatePassword(c.password, c.confirmPassword);
    if (!check.ok) return check;
    try {
      account.credential = await makeCredential(String(c.password));
      account.sessionVersion = (Number(account.sessionVersion) || 1) + 1;
      account.updatedAt = new Date().toISOString();
      if (!writeRegistry(registry)) return { ok: false, error: 'Could not save the new password. Browser storage may be full or disabled.' };
      session.sessionVersion = account.sessionVersion;
      persistSession();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Could not change the password.' };
    }
  }

  /* -------------------------------- session ------------------------------- */

  function restore(state) {
    const raw = readKey(SESSION_KEY);
    if (!raw) { session = null; return null; }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { session = null; removeKey(SESSION_KEY); return null; }
    const registry = readRegistry();
    const account = parsed && parsed.v === 2 && registry
      ? registry.accounts.find(a => a.id === parsed.accountId) : null;
    if (!account || (Number(account.sessionVersion) || 1) !== Number(parsed.sessionVersion) ||
        (account.role === 'team' && state && !sessionTeam(state, account.teamId))) {
      session = null;
      removeKey(SESSION_KEY);
      return null;
    }
    session = {
      accountId: account.id, role: account.role,
      teamId: account.role === 'team' ? account.teamId : '',
      username: account.username, sessionVersion: Number(account.sessionVersion) || 1,
      signedInAt: Number(parsed.signedInAt) || Date.now(),
      remember: !!readKeyFrom('localStorage', SESSION_KEY)
    };
    return session;
  }

  function persistSession() {
    if (!session) { removeKey(SESSION_KEY); return false; }
    return writeSession(SESSION_KEY, JSON.stringify({
      v: 2, accountId: session.accountId, sessionVersion: session.sessionVersion,
      signedInAt: session.signedInAt
    }), session.remember !== false);
  }

  function current() { return session; }
  function isSignedIn() { return !!session; }
  function isAdmin() { return !!session && session.role === 'commissioner'; }
  function role() { return session ? session.role : null; }
  function myTeamId() { return session && session.role === 'team' ? session.teamId : ''; }
  function myUsername() { return session ? session.username : ''; }

  function displayName(state) {
    if (!session) return '';
    if (session.role === 'commissioner') return 'League management';
    const team = sessionTeam(state, session.teamId);
    return team ? team.name : 'Team';
  }

  function roleLabel() {
    if (!session) return '';
    return session.role === 'commissioner' ? 'League management' : 'Team account';
  }

  function focusTeamId(state) {
    if (session && session.role === 'team') return session.teamId;
    return state && state.league ? state.league.primaryTeamId : '';
  }

  /* ------------------------------ permissions ----------------------------- */

  function canManageLeague() { return isAdmin(); }
  function canViewTeamStats(teamId) { return !!session && !!teamId; }
  function canManageAccount(accountId) { return !!session && session.accountId === accountId; }
  function canManageTeam(teamId) { return !!session && (isAdmin() || teamId === session.teamId); }
  function canEditPlayer(player) { return !!session && (isAdmin() || (!!player && player.teamId === session.teamId)); }
  function canScoreGame(game) {
    return !!session && !!game && (isAdmin() || game.homeTeamId === session.teamId || game.awayTeamId === session.teamId);
  }
  function canCreateFixture(homeTeamId, awayTeamId) {
    return !!session && (isAdmin() || homeTeamId === session.teamId || awayTeamId === session.teamId);
  }
  function canDeleteGame() { return isAdmin(); }
  function canDeleteTeam() { return isAdmin(); }
  function canResetData() { return isAdmin(); }

  function signOut(opts) {
    const options = opts || {};
    session = null;
    removeKey(SESSION_KEY);
    lock();
    if (options.announce && TBS.ui) TBS.ui.toast('Signed out of this device.', 'info');
    if (options.silent) return;
    try { if (win && win.location) win.location.hash = 'dashboard'; } catch (_) { /* file:// */ }
  }

  /* ------------------------------- gate paint ----------------------------- */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function gateEl() { return doc ? doc.querySelector('#auth-gate') : null; }
  function shellEl() { return doc ? doc.querySelector('.app-shell') : null; }
  function currentState() { return TBS.app && TBS.app.getState ? TBS.app.getState() : null; }

  function setShellInert(on) {
    const shell = shellEl();
    if (!shell) return;
    if (on) { shell.setAttribute('inert', ''); shell.setAttribute('aria-hidden', 'true'); }
    else { shell.removeAttribute('inert'); shell.removeAttribute('aria-hidden'); }
  }

  function setFieldHidden(id, hidden) {
    if (!doc) return;
    const wrap = doc.querySelector('#' + id);
    if (!wrap) return;
    wrap.hidden = hidden;
    Array.from(wrap.querySelectorAll('input, select')).forEach(input => { input.disabled = hidden; });
  }

  function paintTeamOptions(state) {
    if (!doc) return;
    const select = doc.querySelector('#auth-team');
    if (!select) return;
    const previous = select.value;
    const teams = gateMode === 'register' ? availableTeams(state) : ((state && state.teams) || []);
    select.innerHTML = '<option value="">Choose your team</option>' + teams.map(t =>
      '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>').join('');
    if (previous && teams.some(t => t.id === previous)) select.value = previous;
  }

  function registrationTarget() {
    const state = currentState();
    const select = doc && doc.querySelector('#auth-team');
    const teamId = gateRole === 'team' && select ? select.value : '';
    return { state: state, teamId: teamId };
  }

  function paintRegistrationFields() {
    if (!doc) return;
    const registering = gateMode === 'register';
    const target = registrationTarget();
    const claimed = registering && hasAccount(gateRole, target.teamId);
    const needsLegacy = registering && !claimed && (gateRole !== 'team' || !!target.teamId) &&
      hasLegacyPasscode(target.state, gateRole, target.teamId);
    setFieldHidden('auth-team-wrap', !registering || gateRole !== 'team');
    setFieldHidden('auth-confirm-wrap', !registering);
    setFieldHidden('auth-legacy-wrap', !needsLegacy);
    const confirm = doc.querySelector('#auth-password-confirm');
    if (confirm) confirm.required = registering;
    const legacy = doc.querySelector('#auth-legacy-passcode');
    if (legacy) legacy.required = needsLegacy;
    const password = doc.querySelector('#auth-password');
    if (password) {
      password.autocomplete = registering ? 'new-password' : 'current-password';
      password.minLength = registering ? PASSWORD_MIN : 1;
      password.placeholder = registering ? 'Create a password' : 'Enter password';
    }
    const usernameLabel = doc.querySelector('label[for="auth-username"]');
    if (usernameLabel) usernameLabel.textContent = registering
      ? (gateRole === 'team' ? 'Team username' : 'League username') : 'Username';
    const usernameHint = doc.querySelector('#auth-username-hint');
    if (usernameHint) usernameHint.hidden = !registering;
    const submit = doc.querySelector('#auth-submit');
    const noTeam = registering && gateRole === 'team' && !target.teamId;
    if (submit) {
      submit.disabled = gateBusy || claimed || (registering && gateRole === 'team' && availableTeams(target.state).length === 0);
      submit.textContent = gateBusy ? (registering ? 'Creating account…' : 'Signing in…')
        : (registering ? 'Create account' : 'Sign in');
    }
    const hint = doc.querySelector('#auth-hint');
    if (hint) {
      if (claimed) hint.textContent = 'This access already has an account on this device. Use Sign in instead.';
      else if (noTeam && registering) hint.textContent = 'Choose your team, or ask league management to add a club in Teams & Roster.';
      else if (registering) hint.textContent = 'Passwords are 8–128 characters. One account per team and one league management account on this device.';
      else hint.textContent = 'Use your team or league username. Upgrading an old custom passcode? Use Create account first.';
    }
  }

  function paintGateRole(range) {
    if (!doc) return;
    gateRole = range === 'commissioner' ? 'commissioner' : 'team';
    Array.from(doc.querySelectorAll('#auth-gate .role-card')).forEach(card => {
      const on = card.dataset.role === gateRole;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    paintRegistrationFields();
  }

  function resetPasswordVisibility() {
    if (!doc) return;
    ['#auth-password', '#auth-password-confirm', '#auth-legacy-passcode'].forEach(selector => {
      const input = doc.querySelector(selector);
      if (input) input.type = 'password';
    });
    Array.from(doc.querySelectorAll('#auth-gate [data-toggle-pass]')).forEach(btn => {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Show';
    });
  }

  function paintGateMode(mode) {
    if (!doc) return;
    gateMode = mode === 'register' ? 'register' : 'signin';
    Array.from(doc.querySelectorAll('[data-auth-mode]')).forEach(btn => {
      const on = btn.dataset.authMode === gateMode;
      btn.classList.toggle('is-selected', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const rolePicker = doc.querySelector('#auth-role-picker');
    if (rolePicker) rolePicker.hidden = gateMode !== 'register';
    const title = doc.querySelector('#auth-title');
    const kicker = doc.querySelector('#auth-kicker');
    const intro = doc.querySelector('#auth-intro');
    if (title) title.textContent = gateMode === 'register' ? 'Create your account' : 'Sign in';
    if (kicker) kicker.textContent = gateMode === 'register' ? 'GET STARTED' : 'WELCOME BACK';
    if (intro) intro.textContent = gateMode === 'register'
      ? 'Choose a team username or create the league management account.'
      : 'Sign in with your team or league management username.';
    ['#auth-password', '#auth-password-confirm', '#auth-legacy-passcode'].forEach(selector => {
      const input = doc.querySelector(selector);
      if (input) input.value = '';
    });
    resetPasswordVisibility();
    const err = doc.querySelector('#auth-error');
    if (err) err.textContent = '';
    paintTeamOptions(currentState());
    paintGateRole(gateRole);
  }

  function showGate(state) {
    if (!doc) return;
    doc.documentElement.classList.remove('has-session');
    setShellInert(true);
    const gate = gateEl();
    if (gate && gate.hasAttribute('hidden')) gate.removeAttribute('hidden');
    paintTeamOptions(state || currentState());
    paintGateMode(gateMode);
    const username = doc.querySelector('#auth-username');
    if (username && typeof username.focus === 'function') {
      try { username.focus({ preventScroll: true }); } catch (_) { username.focus(); }
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
    showGate(currentState());
    paintIdentity(currentState());
    if (TBS.app && TBS.app.renderAll) {
      try { TBS.app.renderAll(); } catch (_) { /* not initialised yet */ }
    }
  }

  function unlock(state) {
    hideGate();
    paintIdentity(state || currentState());
  }

  function syncSession(state) {
    if (session && !restore(state)) lock();
    else if (session) paintIdentity(state);
    else showGate(state);
  }

  /* ------------------------------- identity UI ---------------------------- */

  function icon(name) { return TBS.ui && TBS.ui.icon ? TBS.ui.icon(name) : ''; }

  function paintIdentity(state) {
    if (!doc) return;
    const btn = doc.querySelector('#account-btn');
    if (btn) {
      if (!session) {
        btn.innerHTML = '<span class="account-avatar" aria-hidden="true">' + icon('lock') + '</span>' +
          '<span class="account-text"><strong>Sign in</strong><small>Team or league</small></span>';
        btn.setAttribute('aria-label', 'Sign in or create an account');
      } else {
        const team = session.role === 'team' ? sessionTeam(state, session.teamId) : null;
        const color = (team && team.color) || (session.role === 'commissioner' ? '#fdb927' : '#1d428a');
        const initials = session.role === 'commissioner' ? 'LM'
          : String(displayName(state) || 'T').split(/\s+/).map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
        btn.innerHTML = '<span class="account-avatar" style="--account-color:' + escapeHtml(color) + '" aria-hidden="true">' +
          '<span>' + escapeHtml(initials) + '</span></span>' +
          '<span class="account-text"><strong>' + escapeHtml(displayName(state)) + '</strong>' +
          '<small>' + escapeHtml(session.username) + '</small></span>';
        btn.setAttribute('aria-label', 'Signed in as ' + session.username + ' — ' + roleLabel() + '. Open account.');
      }
    }
    const bandMeta = doc.querySelector('#band-meta');
    if (bandMeta) {
      const teams = state && Array.isArray(state.teams) ? state.teams.length : 0;
      const games = state && Array.isArray(state.games) ? state.games.length : 0;
      bandMeta.innerHTML = '<span>' + teams + ' teams</span><span class="band-dot">·</span><span>' + games + ' games</span>';
    }
    const chip = doc.querySelector('#header-record');
    if (chip) chip.title = session && session.role === 'team'
      ? 'Record for ' + displayName(state) : 'Record for the league’s own team';
  }

  function openPasswordDialog() {
    if (!session || !TBS.ui) return;
    TBS.ui.openDialog({
      title: 'Change your password',
      bodyHtml:
        '<form id="account-password-form" class="modal-form" novalidate>' +
          '<p class="muted small">Only you can change this password. League management cannot view or reset another account’s credentials.</p>' +
          '<div class="field"><label for="account-current-password">Current password</label>' +
            '<input id="account-current-password" name="currentPassword" type="password" autocomplete="current-password" required /></div>' +
          '<div class="field"><label for="account-new-password">New password</label>' +
            '<input id="account-new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required />' +
            '<small>8–128 characters.</small></div>' +
          '<div class="field"><label for="account-confirm-password">Confirm new password</label>' +
            '<input id="account-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></div>' +
          '<p class="auth-error" id="account-password-error" role="alert"></p>' +
          '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button>' +
            '<button type="submit" class="btn btn-primary" id="account-password-submit">Save password</button></div>' +
        '</form>',
      onMount: (overlay, close) => {
        const form = overlay.querySelector('#account-password-form');
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const button = overlay.querySelector('#account-password-submit');
          const error = overlay.querySelector('#account-password-error');
          button.disabled = true;
          button.textContent = 'Saving…';
          error.textContent = '';
          const result = await changePassword({
            currentPassword: form.elements.currentPassword.value,
            password: form.elements.password.value,
            confirmPassword: form.elements.confirmPassword.value
          });
          button.disabled = false;
          button.textContent = 'Save password';
          if (!result.ok) { error.textContent = result.error; return; }
          form.reset();
          close();
          TBS.ui.toast('Password changed. Other sessions for this account must sign in again.', 'success');
        });
      }
    });
  }

  function openAccount() {
    const state = currentState();
    if (!session || !TBS.ui) return;
    const team = session.role === 'team' ? sessionTeam(state, session.teamId) : null;
    const rows = [
      { label: 'Username', value: session.username },
      { label: 'Role', value: roleLabel() },
      { label: 'League', value: (state && state.league && state.league.name) || '—' },
      { label: 'Stats access', value: session.role === 'commissioner'
        ? 'Every team’s stats; team accounts stay private' : 'Every team’s stats; writes only for your club' },
      { label: 'Password', value: 'Private to this account' }
    ];
    TBS.ui.openDialog({
      title: 'Your account',
      bodyHtml:
        '<div class="account-sheet">' +
          (team ? '<div class="account-team">' + TBS.ui.teamLogo(team, 'lg') +
            '<div><strong>' + escapeHtml(team.name) + '</strong><span>' + escapeHtml(team.short || '') + '</span></div></div>'
            : '<div class="account-team"><span class="account-badge" aria-hidden="true">' + icon('trophy') + '</span>' +
              '<div><strong>League management</strong><span>' + escapeHtml(session.username) + '</span></div></div>') +
          '<dl class="account-rows">' + rows.map(r =>
            '<div><dt>' + escapeHtml(r.label) + '</dt><dd>' + escapeHtml(r.value) + '</dd></div>').join('') + '</dl>' +
          '<p class="footnote">This account works only in this browser on this device. There is no cloud account or cross-device sync.</p>' +
        '</div>',
      footerHtml:
        '<button type="button" class="btn btn-ghost" data-close>Close</button>' +
        '<button type="button" class="btn btn-ghost" data-account="password">Change password</button>' +
        (isAdmin() ? '<button type="button" class="btn btn-ghost" data-account="access">Access &amp; roles</button>' : '') +
        '<button type="button" class="btn btn-primary" data-account="switch">Switch account</button>',
      onMount: (overlay, close) => {
        overlay.addEventListener('click', e => {
          const btn = e.target.closest('[data-account]');
          if (!btn) return;
          close();
          if (btn.dataset.account === 'switch') signOut({ announce: true });
          else if (btn.dataset.account === 'password') openPasswordDialog();
          else if (btn.dataset.account === 'access' && TBS.app) {
            TBS.app.go('data');
            setTimeout(() => {
              const panel = doc.querySelector('#access-panel');
              if (panel) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
                panel.classList.add('is-flash');
                setTimeout(() => panel.classList.remove('is-flash'), 1600);
              }
            }, 120);
          }
        });
      }
    });
  }

  function openHelp() {
    if (!TBS.ui) return;
    TBS.ui.openDialog({
      title: 'Accounts on this device',
      bodyHtml:
        '<p class="muted small">TeamBallStats is offline-first. Creating an account here does not create a cloud login; it works only in this browser on this device.</p>' +
        '<div class="signin-grid">' +
          '<div class="signin-card"><strong>Team account</strong><p>Choose your club, create a team username and password. Manage your own roster and games; view every other team’s stats read-only.</p></div>' +
          '<div class="signin-card"><strong>League management</strong><p>Create the league username and password. View league-wide stats and settings. Other accounts’ usernames and passwords are not shown or editable here.</p></div>' +
        '</div>' +
        '<p class="footnote">One account per team and one league management account are available on this device. Passwords are stored as salted PBKDF2-SHA-256 hashes, separate from league data and JSON backups.</p>' +
        '<p class="footnote">Previously used a custom passcode? Choose Create account and enter that passcode once to upgrade. Old shared demo passcodes no longer sign in.</p>',
      footerHtml: '<button type="button" class="btn btn-primary" data-close>Got it</button>'
    });
  }

  /* -------------------------------- wiring -------------------------------- */

  function init() {
    const state = currentState();
    restore(state);
    paintIdentity(state);
    if (session) hideGate();
    else showGate(state);
    if (wired || !doc) return;
    wired = true;

    const gate = gateEl();
    if (gate) {
      gate.addEventListener('click', e => {
        const mode = e.target.closest('[data-auth-mode]');
        if (mode && !gateBusy) { paintGateMode(mode.dataset.authMode); return; }
        const card = e.target.closest('.role-card');
        if (card && !gateBusy) { paintGateRole(card.dataset.role); return; }
        const peek = e.target.closest('[data-toggle-pass]');
        if (peek) {
          const input = doc.querySelector(peek.dataset.togglePass);
          if (!input) return;
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          peek.setAttribute('aria-pressed', show ? 'true' : 'false');
          peek.textContent = show ? 'Hide' : 'Show';
        }
      });
      gate.addEventListener('change', e => {
        if (e.target.id === 'auth-team') paintRegistrationFields();
      });
      gate.addEventListener('keydown', e => {
        const card = e.target.closest && e.target.closest('.role-card');
        if (!card || gateBusy) return;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        e.preventDefault();
        const next = gateRole === 'team' ? 'commissioner' : 'team';
        paintGateRole(next);
        const target = doc.querySelector('.role-card[data-role="' + next + '"]');
        if (target && target.focus) target.focus();
      });
      const form = doc.querySelector('#auth-form');
      if (form) form.addEventListener('submit', async e => {
        e.preventDefault();
        if (gateBusy) return;
        gateBusy = true;
        form.setAttribute('aria-busy', 'true');
        paintRegistrationFields();
        const err = doc.querySelector('#auth-error');
        if (err) err.textContent = '';
        const value = id => { const el = doc.querySelector('#' + id); return el && !el.disabled ? el.value : ''; };
        const creds = {
          role: gateRole, teamId: value('auth-team'), username: value('auth-username'),
          password: value('auth-password'), confirmPassword: value('auth-password-confirm'),
          legacyPasscode: value('auth-legacy-passcode'),
          remember: !!doc.querySelector('#auth-remember').checked
        };
        const result = gateMode === 'register'
          ? await register(currentState(), creds) : await signIn(currentState(), creds);
        gateBusy = false;
        form.setAttribute('aria-busy', 'false');
        paintRegistrationFields();
        if (!result.ok) {
          if (err) err.textContent = result.error;
          const password = doc.querySelector('#auth-password');
          if (password) { password.classList.add('is-invalid'); password.focus(); }
          return;
        }
        ['#auth-password', '#auth-password-confirm', '#auth-legacy-passcode'].forEach(selector => {
          const input = doc.querySelector(selector);
          if (input) { input.value = ''; input.classList.remove('is-invalid'); }
        });
        resetPasswordVisibility();
        unlock(currentState());
        if (TBS.app) { TBS.app.renderAll(); TBS.app.go('dashboard'); TBS.app.activate('dashboard'); }
        if (TBS.ui) TBS.ui.toast((gateMode === 'register' ? 'Account created. Signed in as ' : 'Signed in as ') + session.username + '.', 'success');
      });
    }

    const accountBtn = doc.querySelector('#account-btn');
    if (accountBtn) accountBtn.addEventListener('click', openAccount);
    const help = doc.querySelector('#auth-help');
    if (help) help.addEventListener('click', openHelp);
    const signOutBtn = doc.querySelector('#sign-out-btn');
    if (signOutBtn) signOutBtn.addEventListener('click', () => {
      if (TBS.ui && !TBS.ui.confirmDanger('Sign out of this device? Your account and league data stay saved.')) return;
      signOut({ announce: true });
    });

    if (win && win.addEventListener) {
      win.addEventListener('storage', e => {
        if (!e || (e.key !== SESSION_KEY && e.key !== ACCOUNTS_KEY && e.key !== null)) return;
        const before = session ? session.accountId + ':' + session.sessionVersion : '';
        restore(currentState());
        const after = session ? session.accountId + ':' + session.sessionVersion : '';
        if (!session) showGate(currentState());
        else hideGate();
        paintIdentity(currentState());
        if (gateEl() && !gateEl().hasAttribute('hidden')) paintGateMode(gateMode);
        if (before !== after && TBS.app) {
          try { TBS.app.renderAll(); } catch (_) { /* ignore */ }
        }
      });
    }
    doc.addEventListener('keydown', e => {
      if (!session) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'l') {
        e.preventDefault();
        signOut({ announce: true });
      }
    });
  }

  TBS.auth = {
    SESSION_KEY: SESSION_KEY, ACCOUNTS_KEY: ACCOUNTS_KEY,
    PBKDF2_ITERATIONS: PBKDF2_ITERATIONS, PASSWORD_MIN: PASSWORD_MIN, PASSWORD_MAX: PASSWORD_MAX,
    hasPasswordSupport: hasPasswordSupport,
    normalizeUsername: normalizeUsername, validateUsername: validateUsername,
    validatePassword: validatePassword, hasAccount: hasAccount, availableTeams: availableTeams,
    hasLegacyPasscode: hasLegacyPasscode,
    register: register, signIn: signIn, changePassword: changePassword,
    current: current, isSignedIn: isSignedIn, isAdmin: isAdmin, role: role,
    myTeamId: myTeamId, myUsername: myUsername, displayName: displayName, roleLabel: roleLabel,
    focusTeamId: focusTeamId, canManageLeague: canManageLeague, canViewTeamStats: canViewTeamStats,
    canManageAccount: canManageAccount, canManageTeam: canManageTeam, canEditPlayer: canEditPlayer,
    canScoreGame: canScoreGame, canCreateFixture: canCreateFixture,
    canDeleteGame: canDeleteGame, canDeleteTeam: canDeleteTeam, canResetData: canResetData,
    signOut: signOut, restore: restore, syncSession: syncSession,
    init: init, lock: lock, unlock: unlock, paintIdentity: paintIdentity,
    paintGateRole: paintGateRole, paintGateMode: paintGateMode, showGate: showGate,
    openAccount: openAccount, openPasswordDialog: openPasswordDialog
  };
})(window.TBS = window.TBS || {});
