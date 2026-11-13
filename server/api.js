/* =========================================================================
 * server/api.js — JSON API. Every route is listed in docs/API.md.
 *
 *   Accounts     POST /api/auth/register · /login · /logout · GET /me
 *   Cloud sync   GET|PUT /api/league · GET /api/league/revisions[/:rev]
 *   Billing      GET /api/billing/status · POST /checkout (501 until a
 *                provider is configured) · POST /webhook (HMAC-verified)
 *   Insights (legacy paths)  POST /api/pro/recap · /api/pro/lineups
 *
 * Rules enforced here, not in the browser:
 *   - a league write must name the revision it was based on; a stale write
 *     gets 409 with the server copy and is never applied silently;
 *   - an empty league cannot replace a non-empty one unless explicitly allowed;
 *   - every accepted write runs inside one transaction and keeps a revision;
 *   - Insights require sign-in only; no subscription or entitlement is required.
 * ========================================================================= */
'use strict';

const crypto = require('crypto');
const config = require('./config');
const auth = require('./auth');
const engine = require('./engine');

const MAX_WEBHOOK_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

function createApi(db, options) {
  const opts = options || {};
  const log = opts.audit !== false ? (actor, action, detail) => {
    db.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), actor, action, detail ? JSON.stringify(detail) : null);
  } : () => {};

  function send(res, status, body, headers) {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(text)
    }, headers || {}));
    res.end(text);
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > limit) { reject(new HttpError(413, 'too_large', 'The request is larger than the server allows.')); return; }
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'too_large', 'The request is larger than the server allows.'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function readJson(req) {
    const type = String(req.headers['content-type'] || '');
    if (type.indexOf('application/json') < 0) {
      throw new HttpError(415, 'unsupported_media_type', 'Send the request as application/json.');
    }
    const raw = await readBody(req, config.MAX_BODY_BYTES);
    if (!raw.length) return {};
    try {
      const body = JSON.parse(raw.toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
      return body;
    } catch (_) {
      throw new HttpError(400, 'bad_json', 'The request body is not valid JSON.');
    }
  }

  /* ---- sessions and entitlements --------------------------------------- */

  function tokenFrom(req) {
    return auth.parseCookies(req.headers.cookie)[auth.COOKIE] || '';
  }

  function userFrom(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const row = db.prepare(`SELECT u.id AS id, u.username AS username, s.expires_at AS expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(auth.sha256(token));
    if (!row) return null;
    if (Date.parse(row.expires_at) < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.sha256(token));
      return null;
    }
    return { id: row.id, username: row.username };
  }

  function requireUser(req) {
    const user = userFrom(req);
    if (!user) throw new HttpError(401, 'sign_in_required', 'Sign in to use cloud sync.');
    return user;
  }

  function entitlementOf(userId) {
    const row = db.prepare('SELECT plan, status, source, period_end FROM entitlements WHERE user_id = ?').get(userId);
    if (!row) return { plan: 'free', active: false, status: 'none', source: null, periodEnd: null };
    const expired = row.period_end && Date.parse(row.period_end) < Date.now();
    return {
      plan: row.plan,
      active: row.plan === 'pro' && row.status === 'active' && !expired,
      status: expired ? 'expired' : row.status,
      source: row.source,
      periodEnd: row.period_end || null
    };
  }

  function createSession(res, userId) {
    const token = auth.newToken();
    const now = new Date();
    const expires = new Date(now.getTime() + config.SESSION_DAYS * 24 * 3600 * 1000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(auth.sha256(token), userId, now.toISOString(), expires.toISOString());
    return auth.sessionCookie(token, false);
  }

  /* ---- auth routes ------------------------------------------------------ */

  async function register(req, res) {
    if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'registration_closed', 'New accounts are not open on this server.');
    const body = await readJson(req);
    const username = auth.normalizeUsername(body.username);
    const bad = auth.validateUsername(username) || auth.validatePassword(body.password);
    if (bad) throw new HttpError(400, 'invalid_input', bad);
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, 'username_taken', 'That username is already taken.');
    }
    const id = crypto.randomUUID();
    const hash = await auth.hashPassword(body.password);
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, username, hash, new Date().toISOString());
    const cookie = createSession(res, id);
    log(username, 'account.register', null);
    send(res, 201, { user: { id: id, username: username }, entitlement: entitlementOf(id) }, { 'Set-Cookie': cookie });
  }

  async function login(req, res) {
    const body = await readJson(req);
    const username = auth.normalizeUsername(body.username);
    const ip = req.socket.remoteAddress || 'local';
    const now = Date.now();
    if (auth.isThrottled(ip, username, now)) {
      throw new HttpError(429, 'too_many_attempts', 'Too many sign-in attempts. Wait 15 minutes and try again.');
    }
    const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    const ok = row && typeof body.password === 'string' && await auth.verifyPassword(body.password, row.password_hash);
    if (!ok) {
      auth.recordFailure(ip, username, now);
      throw new HttpError(401, 'invalid_credentials', 'That username and password do not match.');
    }
    auth.clearFailures(ip, username);
    const cookie = createSession(res, row.id);
    send(res, 200, { user: { id: row.id, username: row.username }, entitlement: entitlementOf(row.id) }, { 'Set-Cookie': cookie });
  }

  function logout(req, res) {
    const token = tokenFrom(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(auth.sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', true) });
  }

  function me(req, res) {
    const user = requireUser(req);
    send(res, 200, { user: user, entitlement: entitlementOf(user.id) });
  }

  /* ---- league (cloud copy) --------------------------------------------- */

  function leagueRow(userId) {
    return db.prepare('SELECT revision, document, summary, updated_at FROM leagues WHERE user_id = ?').get(userId);
  }

  function getLeague(req, res) {
    const user = requireUser(req);
    const row = leagueRow(user.id);
    if (!row) { send(res, 200, { revision: 0, updatedAt: null, summary: null, document: null }); return; }
    send(res, 200, {
      revision: row.revision,
      updatedAt: row.updated_at,
      summary: JSON.parse(row.summary),
      document: JSON.parse(row.document)
    });
  }

  function isEmptySummary(s) {
    return !s || (s.players === 0 && s.games === 0);
  }

  /* One transaction: check the base revision, write, keep history, prune. */
  function writeLeague(userId, baseRevision, doc, summary, allowEmpty) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = leagueRow(userId);
      const current = row ? row.revision : 0;
      if (current !== baseRevision) {
        db.exec('ROLLBACK');
        return { conflict: true, revision: current, updatedAt: row ? row.updated_at : null,
          summary: row ? JSON.parse(row.summary) : null, document: row ? JSON.parse(row.document) : null };
      }
      if (row && !allowEmpty && isEmptySummary(summary) && !isEmptySummary(JSON.parse(row.summary))) {
        db.exec('ROLLBACK');
        return { emptyBlocked: true, revision: current };
      }
      const next = current + 1;
      const now = new Date().toISOString();
      const text = JSON.stringify(doc);
      const sum = JSON.stringify(summary);
      if (row) {
        const res = db.prepare('UPDATE leagues SET revision = ?, document = ?, summary = ?, updated_at = ? WHERE user_id = ? AND revision = ?')
          .run(next, text, sum, now, userId, current);
        if (res.changes !== 1) throw new Error('league row changed during write');
      } else {
        db.prepare('INSERT INTO leagues (user_id, revision, document, summary, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(userId, next, text, sum, now);
      }
      db.prepare('INSERT INTO league_revisions (user_id, revision, document, summary, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, next, text, sum, now);
      db.prepare('DELETE FROM league_revisions WHERE user_id = ? AND revision <= ?')
        .run(userId, next - config.REVISIONS_KEEP);
      db.exec('COMMIT');
      return { revision: next, updatedAt: now, summary: summary };
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw err;
    }
  }

  async function putLeague(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
      throw new HttpError(400, 'invalid_input', 'baseRevision must be a whole number (0 for a new cloud copy).');
    }
    let doc, summary;
    try {
      doc = engine.normalize(body.document);
      summary = engine.summarize(doc);
    } catch (err) {
      throw new HttpError(400, 'invalid_document', 'That is not a valid TeamBallStats league: ' + err.message);
    }
    const result = writeLeague(user.id, body.baseRevision, doc, summary, body.allowEmpty === true);
    if (result.conflict) {
      send(res, 409, {
        error: 'conflict',
        message: 'The cloud copy changed since this device last synced. Nothing was overwritten.',
        revision: result.revision, updatedAt: result.updatedAt, summary: result.summary, document: result.document
      });
      return;
    }
    if (result.emptyBlocked) {
      send(res, 409, {
        error: 'empty_overwrite',
        message: 'This device has no players or games, but the cloud copy has data. Nothing was overwritten.',
        revision: result.revision
      });
      return;
    }
    log(user.username, 'league.write', { revision: result.revision, games: summary.games });
    send(res, 200, { revision: result.revision, updatedAt: result.updatedAt, summary: result.summary });
  }

  function listRevisions(req, res) {
    const user = requireUser(req);
    const rows = db.prepare('SELECT revision, summary, created_at FROM league_revisions WHERE user_id = ? ORDER BY revision DESC LIMIT 50').all(user.id);
    send(res, 200, { revisions: rows.map(r => ({ revision: r.revision, createdAt: r.created_at, summary: JSON.parse(r.summary) })) });
  }

  function getRevision(req, res, revText) {
    const user = requireUser(req);
    const rev = Number(revText);
    if (!Number.isInteger(rev) || rev < 1) throw new HttpError(400, 'invalid_input', 'Revision must be a positive whole number.');
    const row = db.prepare('SELECT revision, document, created_at FROM league_revisions WHERE user_id = ? AND revision = ?').get(user.id, rev);
    if (!row) throw new HttpError(404, 'not_found', 'That revision is no longer kept.');
    send(res, 200, { revision: row.revision, createdAt: row.created_at, document: JSON.parse(row.document) });
  }

  /* ---- billing ---------------------------------------------------------- */

  function billingStatus(req, res) {
    const user = userFrom(req);
    send(res, 200, {
      signedIn: !!user,
      entitlement: user ? entitlementOf(user.id) : { plan: 'free', active: false, status: 'none', source: null, periodEnd: null },
      checkout: 'not_configured',
      webhook: config.BILLING_WEBHOOK_SECRET ? 'configured' : 'not_configured',
      message: 'No payment provider is connected to this server. Pro access can be granted by the server operator (see docs/DEPLOY.md). Nothing is charged.'
    });
  }

  function checkout(req, res) {
    requireUser(req);
    throw new HttpError(501, 'payments_not_configured',
      'Payments are not configured on this server, so nothing can be purchased. The operator can grant Pro with `node server/cli.js grant-pro <username>`.');
  }

  async function webhook(req, res) {
    if (!config.BILLING_WEBHOOK_SECRET) {
      throw new HttpError(501, 'payments_not_configured', 'No billing webhook secret is configured, so webhooks are refused.');
    }
    const raw = await readBody(req, MAX_WEBHOOK_BYTES);
    const given = String(req.headers['x-tbs-signature'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', config.BILLING_WEBHOOK_SECRET).update(raw).digest('hex');
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new HttpError(401, 'bad_signature', 'The webhook signature does not match.');
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch (_) { throw new HttpError(400, 'bad_json', 'Webhook body is not JSON.'); }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
      throw new HttpError(400, 'invalid_input', 'Webhook needs string id and type fields.');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const seen = db.prepare('SELECT event_id FROM billing_events WHERE event_id = ?').get(event.id);
      if (seen) { db.exec('ROLLBACK'); send(res, 200, { ok: true, duplicate: true }); return; }
      db.prepare('INSERT INTO billing_events (event_id, type, received_at, payload) VALUES (?, ?, ?, ?)')
        .run(event.id, event.type, new Date().toISOString(), raw.toString('utf8').slice(0, 4000));
      const data = event.data || {};
      const username = auth.normalizeUsername(data.username);
      const user = username ? db.prepare('SELECT id FROM users WHERE username = ?').get(username) : null;
      if (event.type === 'entitlement.activated' || event.type === 'entitlement.canceled') {
        if (!user) { db.exec('ROLLBACK'); throw new HttpError(404, 'user_not_found', 'No account has that username.'); }
        const active = event.type === 'entitlement.activated';
        db.prepare(`INSERT INTO entitlements (user_id, plan, status, source, period_end, updated_at) VALUES (?, 'pro', ?, 'webhook', ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', status = excluded.status, source = 'webhook',
          period_end = excluded.period_end, updated_at = excluded.updated_at`)
          .run(user.id, active ? 'active' : 'canceled', data.periodEnd || null, new Date().toISOString());
        log('webhook', event.type, { user: username });
      }
      db.exec('COMMIT');
      send(res, 200, { ok: true });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nothing open */ }
      throw err;
    }
  }

  /* ---- Game insights (legacy /pro paths) ------------------------------------------- */

  /* The client may send its current document (freshest). Otherwise the
   * cloud copy is used. Either way the document is validated first. */
  async function proDocument(req, body, user) {
    if (body.document !== undefined) {
      try { return engine.normalize(body.document); } catch (err) {
        throw new HttpError(400, 'invalid_document', 'That is not a valid TeamBallStats league: ' + err.message);
      }
    }
    const row = leagueRow(user.id);
    if (!row) throw new HttpError(404, 'no_cloud_league', 'There is no cloud copy yet. Sync this league first.');
    return JSON.parse(row.document);
  }

  async function proRecap(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    if (typeof body.gameId !== 'string' || !body.gameId) throw new HttpError(400, 'invalid_input', 'gameId is required.');
    const doc = await proDocument(req, body, user);
    let recap;
    try { recap = engine.gameRecap(doc, body.gameId); } catch (err) {
      throw new HttpError(404, 'game_not_found', 'No game with that id in this league.');
    }
    send(res, 200, recap);
  }

  async function proLineups(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    const doc = await proDocument(req, body, user);
    const minMinutes = Number.isFinite(Number(body.minMinutes)) ? Number(body.minMinutes) : undefined;
    send(res, 200, engine.lineupRankings(doc, minMinutes === undefined ? {} : { minMinutes: minMinutes }));
  }

  /* ---- router ----------------------------------------------------------- */

  const routes = [
    ['GET', /^\/api\/health$/, (req, res) => send(res, 200, {
      ok: true, version: config.VERSION, time: new Date().toISOString(),
      billing: { checkout: 'not_configured', webhook: config.BILLING_WEBHOOK_SECRET ? 'configured' : 'not_configured' }
    })],
    ['POST', /^\/api\/auth\/register$/, register],
    ['POST', /^\/api\/auth\/login$/, login],
    ['POST', /^\/api\/auth\/logout$/, logout],
    ['GET', /^\/api\/auth\/me$/, me],
    ['GET', /^\/api\/league$/, getLeague],
    ['PUT', /^\/api\/league$/, putLeague],
    ['GET', /^\/api\/league\/revisions$/, listRevisions],
    ['GET', /^\/api\/league\/revisions\/(\d+)$/, (req, res, m) => getRevision(req, res, m[1])],
    ['GET', /^\/api\/billing\/status$/, billingStatus],
    ['POST', /^\/api\/billing\/checkout$/, checkout],
    ['POST', /^\/api\/billing\/webhook$/, webhook],
    ['POST', /^\/api\/pro\/recap$/, proRecap],
    ['POST', /^\/api\/pro\/lineups$/, proLineups]
  ];

  /* Returns true when the request was an API request (handled or rejected). */
  return async function handleApi(req, res, pathname) {
    if (pathname.indexOf('/api/') !== 0 && pathname !== '/api') return false;
    const method = req.method.toUpperCase();
    let matched = null, pathMatched = false;
    for (const [m, re, fn] of routes) {
      const hit = re.exec(pathname);
      if (!hit) continue;
      pathMatched = true;
      if (m === method) { matched = { fn: fn, m: hit }; break; }
    }
    try {
      if (!matched) {
        if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'That method is not allowed here.');
        throw new HttpError(404, 'not_found', 'No such API route.');
      }
      await matched.fn(req, res, matched.m);
    } catch (err) {
      if (err instanceof HttpError) {
        send(res, err.status, Object.assign({ error: err.code, message: err.message }, err.extra || {}));
      } else {
        console.error('[TeamBallStats] API error on ' + method + ' ' + pathname + ':', err);
        send(res, 500, { error: 'server_error', message: 'Something went wrong on the server. Nothing was changed.' });
      }
    }
    return true;
  };
}

module.exports = { createApi, HttpError };
