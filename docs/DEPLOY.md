# Deploying TeamBallStats

TeamBallStats has two parts. You can run either one alone.

| Part | What it is | Where it runs |
|------|------------|---------------|
| **The app** | Static files: `index.html`, `css/`, `js/`, `sample-data.json`. Works fully offline with data on each device. | Any static host. GitHub Pages is set up in `.github/workflows/deploy.yml`. |
| **The sync server** (optional) | Node server in `server/`: accounts, cloud league sync with revisions, Pro analytics, billing webhook, operator CLI. It also serves the app files. | A machine or container with Node 22.13 or later and a writable data directory. |

The app keeps working without the server. When no server answers `/api/health`
on the same origin, the cloud panel reports that sync is off, and the rest of the
app works as before.

## 1. Requirements

* **Node.js 22.13 or later.** The server uses the built-in `node:sqlite` module,
  which needs no flag from 22.13 on. It prints an `ExperimentalWarning` on
  start-up. That warning is expected and harmless.
* **No npm install is needed.** The server and its tests use only Node built-ins.
* **Pin the Node major version** (22 or 24 LTS). Newer Node releases have
  renamed or changed the `node:sqlite` API. Check the server test suite before
  you move to a new major version.
* A writable directory for the database (`DATA_DIR`, default `data/`).
* HTTPS in front of the server for any real use (see section 4).

## 2. Configure

Copy `.env.example` to `.env` and set the values, or set the same variables in
your hosting platform. The server reads only the process environment. It does
not load `.env` itself, so either export the file before start-up
(`set -a; . ./.env; set +a`) or use your platform's settings.

The important values:

| Variable | Default | Production value |
|----------|---------|------------------|
| `PORT` | `8080` | Port your reverse proxy forwards to |
| `HOST` | `0.0.0.0` | Keep, or bind to `127.0.0.1` behind a proxy on the same host |
| `DATA_DIR` | `data` | Absolute path outside the code checkout, on persistent disk |
| `COOKIE_SECURE` | `0` | `1` whenever the site is served over HTTPS |
| `ALLOW_REGISTRATION` | `1` | `0` to close sign-up after your accounts exist |
| `BILLING_WEBHOOK_SECRET` | empty | Only if a billing bridge will call the webhook |

Full list and descriptions: `.env.example`.

## 3. Run

From the repository root:

```bash
node server/index.js
```

Start-up prints the URL, the database path, and the payment status:

```
TeamBallStats 1.0.0 listening on http://0.0.0.0:8080
Data file: data/teamballstats.db
Payments: not configured (Pro is granted by the operator, see docs/DEPLOY.md)
```

Check it:

```bash
curl -s http://127.0.0.1:8080/api/health
```

The app is served at `/`. The server refuses to serve `server/`, `tests/`,
`data/`, `node_modules/`, `.git/`, `.github/` and any dot-file. Those paths
return 404.

### Example systemd unit

```ini
[Unit]
Description=TeamBallStats sync server
After=network.target

[Service]
WorkingDirectory=/srv/teamballstats
EnvironmentFile=/srv/teamballstats/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
User=tbs

[Install]
WantedBy=multi-user.target
```

Run `chmod 600 /srv/teamballstats/.env`, because it may hold the billing secret.

## 4. HTTPS and the reverse proxy

Put the server behind a TLS-terminating proxy (Caddy, nginx, or a platform
load balancer) on the same origin. The browser must reach the app and `/api`
under one host name, so cookies and relative API calls work. Set
`COOKIE_SECURE=1` once the site is HTTPS.

Example Caddyfile:

```
stats.example.org {
  reverse_proxy 127.0.0.1:8080
}
```

## 5. Accounts and Pro access (operator)

Accounts are created by users in the app (**Sign in → Create account**) unless
`ALLOW_REGISTRATION=0`.

Pro is an entitlement on an account. No payment provider is bundled, so this
server takes no money. Grant Pro manually with the CLI:

```bash
node server/cli.js list-users
node server/cli.js grant-pro coach_lee            # 30 days (default)
node server/cli.js grant-pro coach_lee --days 90
node server/cli.js grant-pro coach_lee --forever
node server/cli.js revoke-pro coach_lee
```

Each grant or revoke is written to the `audit_log` table with the actor `cli`.
A manual grant has `source: manual`. It is not a payment.

Run the CLI on the same host and with the same `DATA_DIR` as the server.

## 6. Billing webhook (optional)

`POST /api/billing/checkout` returns `501 payments_not_configured` on purpose.
The app never shows a purchase flow that cannot complete.

If you connect a payment provider later, have a small bridge call the webhook:

1. Set `BILLING_WEBHOOK_SECRET` to a long random value. Until it is set, every
   webhook request gets `501`.
2. Send `POST /api/billing/webhook` with a JSON body containing `id`, `type`
   (`entitlement.activated` or `entitlement.canceled`) and `data.username`.
3. Sign the raw body with HMAC-SHA256 and the secret. Send the result as
   `X-TBS-Signature: sha256=<hex>`.

Events are applied once, keyed by `id`. See [API.md](API.md#billing) for the
exact contract.

## 7. Backups

The database uses SQLite in WAL mode. Do **not** copy `teamballstats.db` while
the server runs, because recent writes may be in the `-wal` file. Use
`VACUUM INTO`, which produces one consistent file while the server keeps
running:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); \
  new DatabaseSync('data/teamballstats.db').exec(\"VACUUM INTO 'backups/tbs-$(date +%F).db'\")"
```

Create the `backups/` directory first, and keep copies off the host. Test a
restore by starting the server against a copy of the backup in a temporary
`DATA_DIR`.

The server keeps the last 50 accepted writes per league in `league_revisions`,
so users can recover from a bad sync without a backup. Revisions are not a
substitute for backups.

## 8. GitHub Pages (static app)

`.github/workflows/deploy.yml` publishes the **repository root** on every push
to `main`. It runs `node tests/smoke.js` first. Pages only serves static files,
so there is no `/api` there. The app then runs without cloud sync, and the
cloud and Pro panels say the server is unavailable.

The published site includes the server source code and tests. They contain no
secrets: all configuration is read from the environment, and `.env` is ignored
by git. Data in `data/` is never committed (it is listed in `.gitignore`).

## 9. Before you deploy

Run the test suites from the repository root:

```bash
node tests/smoke.js                 # 59 checks, Node built-ins only
node tests/engine.js                # 16 checks: server-side engine
timeout 120 node tests/server.js    # 25 checks: API, auth, sync, billing, CLI (temp DB)
node --check js/*.js server/*.js    # syntax check
```

The browser tests need `jsdom`, which is not a repository dependency. Install
it outside the checkout and point `NODE_PATH` at it:

```bash
mkdir -p /tmp/tbs-dom && cd /tmp/tbs-dom && npm init -y >/dev/null && npm i jsdom@24
cd /home/user/TeamBallStats-
NODE_PATH=/tmp/tbs-dom/node_modules node tests/dom/dom-test.js     # 26 checks
NODE_PATH=/tmp/tbs-dom/node_modules node tests/dom/cloud-test.js   # 13 checks, starts the real server
```

## 10. Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `EADDRINUSE` on start | Another process has the port. Change `PORT`. |
| Cloud panel says "Cloud sync is off" | The app is on static hosting, or the proxy does not forward `/api`. Check `curl <origin>/api/health`. |
| Sign-in fails with `invalid_credentials` | Wrong username or password. The message is intentionally generic. |
| `429 too_many_attempts` | Ten failed sign-ins in 15 minutes for one username from one IP. Wait 15 minutes. |
| Sign-in works locally but not over HTTPS | Cookies are `Secure` when `COOKIE_SECURE=1`, so the site must really be HTTPS. |
| Recap or lineups say `403 pro_required` | The account has no active Pro entitlement. Grant it with the CLI (section 5). |
| `Sync conflict` dialog | Another device saved since this one last synced. **Merge both** combines the changes and downloads backups of both copies. **Use cloud copy** or **Keep this device** take one side. **Decide later** pauses sync. Nothing is overwritten until you choose. |
| `ExperimentalWarning: SQLite` on start | Expected on Node 22 and 24. It is not an error. |
