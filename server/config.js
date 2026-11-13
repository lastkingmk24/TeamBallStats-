/* =========================================================================
 * server/config.js — every setting comes from the environment (see
 * .env.example). Nothing secret is committed. Defaults are safe for local
 * development; set COOKIE_SECURE=1 behind HTTPS in production.
 * ========================================================================= */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function flag(name) {
  return /^(1|true|yes|on)$/i.test(String(env(name, '')));
}

const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', 'data'));

module.exports = Object.freeze({
  ROOT: ROOT,
  VERSION: '1.0.0',
  HOST: env('HOST', '0.0.0.0'),
  PORT: Number(env('PORT', 8080)),
  DATA_DIR: DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'teamballstats.db'),
  COOKIE_SECURE: flag('COOKIE_SECURE'),
  SESSION_DAYS: 30,
  ALLOW_REGISTRATION: env('ALLOW_REGISTRATION', '1') !== '0',
  MAX_BODY_BYTES: Number(env('MAX_BODY_BYTES', 8 * 1024 * 1024)),
  REVISIONS_KEEP: 50,
  LOGIN_WINDOW_MS: 15 * 60 * 1000,
  LOGIN_MAX_ATTEMPTS: 10,
  /* Billing: no payment provider is bundled. Checkout stays disabled until
   * a provider is configured; the webhook needs this shared secret. */
  BILLING_WEBHOOK_SECRET: env('BILLING_WEBHOOK_SECRET', ''),
  /* Server-enforced Pro features (route names under /api/pro/). */
  PRO_FEATURES: Object.freeze(['recap', 'lineups'])
});
