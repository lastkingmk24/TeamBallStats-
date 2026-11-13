/* =========================================================================
 * server/auth.js — password hashing (scrypt), session tokens and login
 * throttling. Only a SHA-256 hash of each session token is stored, so a
 * database leak does not reveal live sessions.
 * ========================================================================= */
'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function validateUsername(name) {
  if (!USERNAME_RE.test(name)) {
    return 'Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.';
  }
  return null;
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Passwords need at least 8 characters.';
  if (pw.length > 200) return 'Passwords can be at most 200 characters.';
  return null;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const key = await scrypt(password, salt, expected.length, { N: N, r: r, p: p });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/* In-memory login throttle: per client address and username. Resets on
 * restart, which is acceptable for a single-process deployment. */
const attempts = new Map();

function throttleKey(ip, username) {
  return ip + '|' + username;
}

function isThrottled(ip, username, now) {
  const rec = attempts.get(throttleKey(ip, username));
  if (!rec) return false;
  if (now - rec.first > config.LOGIN_WINDOW_MS) { attempts.delete(throttleKey(ip, username)); return false; }
  return rec.count >= config.LOGIN_MAX_ATTEMPTS;
}

function recordFailure(ip, username, now) {
  const key = throttleKey(ip, username);
  const rec = attempts.get(key);
  if (!rec || now - rec.first > config.LOGIN_WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else rec.count += 1;
}

function clearFailures(ip, username) {
  attempts.delete(throttleKey(ip, username));
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { /* ignore bad cookie */ }
  });
  return out;
}

const COOKIE = 'tbs_session';

function sessionCookie(token, clear) {
  const parts = [COOKIE + '=' + (clear ? '' : encodeURIComponent(token)), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push('Max-Age=' + (clear ? 0 : config.SESSION_DAYS * 24 * 3600));
  if (config.COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

module.exports = {
  normalizeUsername, validateUsername, validatePassword,
  hashPassword, verifyPassword, sha256, newToken,
  isThrottled, recordFailure, clearFailures,
  parseCookies, sessionCookie, COOKIE
};
