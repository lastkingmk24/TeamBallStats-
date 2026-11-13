/* =========================================================================
 * server/index.js — HTTP server for TeamBallStats.
 *
 *   node server/index.js          serves the app and /api on HOST:PORT
 *
 * Serves the static app from the repository root (never server/, tests/,
 * data/ or dotfiles) and mounts the JSON API under /api. Zero npm packages.
 * ========================================================================= */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { createApi } = require('./api');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const BLOCKED_TOP = new Set(['server', 'tests', 'data', 'node_modules', '.git', '.github']);

function staticFile(res, pathname, method) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send404(res); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p === '..' || p.charAt(0) === '.') || BLOCKED_TOP.has(parts[0])) return send404(res);
  const file = path.resolve(config.ROOT, '.' + path.posix.normalize('/' + parts.join('/')));
  if (file.indexOf(config.ROOT + path.sep) !== 0) return send404(res);
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return send404(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send404(res);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function createServer(options) {
  const opts = options || {};
  const database = opts.db || db.open(opts.dbFile || config.DB_FILE);
  const api = createApi(database, { audit: opts.audit });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (await api(req, res, pathname)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
        return res.end('Method not allowed');
      }
      staticFile(res, pathname, req.method);
    } catch (err) {
      console.error('[TeamBallStats] request failed:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Server error');
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.database = database;
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(config.PORT, config.HOST, () => {
    console.log('TeamBallStats ' + config.VERSION + ' listening on http://' + config.HOST + ':' + config.PORT);
    console.log('Data file: ' + config.DB_FILE);
    console.log('Payments: not configured (Pro is granted by the operator, see docs/DEPLOY.md)');
  });
}

module.exports = { createServer };
