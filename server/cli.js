/* =========================================================================
 * server/cli.js — operator commands. Run on the server, not over HTTP.
 *
 *   node server/cli.js list-users
 *   node server/cli.js grant-pro <username> [--days 30 | --forever]
 *   node server/cli.js revoke-pro <username>
 *
 * grant-pro is a MANUAL grant. It is recorded with source "manual" and is
 * not a payment. No money changes hands through this command.
 * ========================================================================= */
'use strict';

const config = require('./config');
const db = require('./db');
const auth = require('./auth');

function usage() {
  console.log('Usage:\n  node server/cli.js list-users\n  node server/cli.js grant-pro <username> [--days N | --forever]\n  node server/cli.js revoke-pro <username>');
}

function main(argv) {
  const [cmd, name, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return 0; }
  const database = db.open(config.DB_FILE);
  const now = new Date();
  const audit = (action, detail) => database.prepare('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)')
    .run(now.toISOString(), 'cli', action, JSON.stringify(detail));

  if (cmd === 'list-users') {
    const rows = database.prepare(`SELECT u.username AS username, u.created_at AS created,
      COALESCE(e.plan, 'free') AS plan, COALESCE(e.status, 'none') AS status, e.period_end AS period_end
      FROM users u LEFT JOIN entitlements e ON e.user_id = u.id ORDER BY u.username`).all();
    if (!rows.length) console.log('No accounts yet.');
    rows.forEach(r => console.log([r.username, r.plan, r.status, r.period_end || '-', r.created].join('\t')));
    return 0;
  }

  const username = auth.normalizeUsername(name);
  const user = username ? database.prepare('SELECT id, username FROM users WHERE username = ?').get(username) : null;
  if (!user) { console.error('No account named "' + (name || '') + '".'); return 1; }

  if (cmd === 'grant-pro') {
    let periodEnd = null;
    if (rest.indexOf('--forever') < 0) {
      const i = rest.indexOf('--days');
      const days = i >= 0 ? Number(rest[i + 1]) : 30;
      if (!Number.isInteger(days) || days < 1 || days > 3660) { console.error('--days must be a whole number from 1 to 3660.'); return 1; }
      periodEnd = new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString();
    }
    database.prepare(`INSERT INTO entitlements (user_id, plan, status, source, period_end, updated_at) VALUES (?, 'pro', 'active', 'manual', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan = 'pro', status = 'active', source = 'manual', period_end = excluded.period_end, updated_at = excluded.updated_at`)
      .run(user.id, periodEnd, now.toISOString());
    audit('entitlement.manual_grant', { user: user.username, periodEnd: periodEnd });
    console.log('Pro granted to ' + user.username + ' (manual grant' + (periodEnd ? ', until ' + periodEnd : ', no end date') + '). No payment was taken.');
    return 0;
  }

  if (cmd === 'revoke-pro') {
    database.prepare(`INSERT INTO entitlements (user_id, plan, status, source, period_end, updated_at) VALUES (?, 'free', 'canceled', 'manual', NULL, ?)
      ON CONFLICT(user_id) DO UPDATE SET plan = 'free', status = 'canceled', source = 'manual', period_end = NULL, updated_at = excluded.updated_at`)
      .run(user.id, now.toISOString());
    audit('entitlement.manual_revoke', { user: user.username });
    console.log('Pro removed from ' + user.username + '.');
    return 0;
  }

  usage();
  return 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
