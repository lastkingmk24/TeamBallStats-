/* =========================================================================
 * server/db.js — SQLite via the built-in node:sqlite module (Node >= 22.13,
 * no npm packages). Migrations are append-only: each one runs once inside a
 * transaction and is recorded in schema_migrations. The SQL is plain enough
 * to port to PostgreSQL later.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE leagues (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0,
        document TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE league_revisions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        document TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, revision)
      );
      CREATE TABLE entitlements (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
        status TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
        source TEXT NOT NULL CHECK (source IN ('manual', 'webhook')),
        period_end TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE billing_events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT
      );
    `
  }
];

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => Number(r.id)));
  MIGRATIONS.forEach(m => {
    if (applied.has(m.id)) return;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });
}

/* file may be ':memory:' for tests. */
function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

module.exports = { open: open, migrate: migrate, MIGRATIONS: MIGRATIONS };
