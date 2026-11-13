# TeamBallStats — Upgrade Inspection & Plan

Branch: `arena/032c710f-teamballstats` (base `main` @ `0029baf`).
Project name is unchanged: **TeamBallStats**.

## 1. Inspection (what exists today)

| Area | Current state |
| --- | --- |
| Languages / runtime | Vanilla HTML, CSS and ES2015+ JavaScript. Classic `<script>` tags, no bundler, no framework, no npm dependencies. |
| Persistence | Browser `localStorage`, key `bball_tm_v1`, schema v3 (documented in README). JSON backup/restore with a merge/replace path. |
| Accounts | Device-local username/password accounts (PBKDF2-SHA-256, `bball_tm_accounts_v1`). Explicitly *not* a server. |
| Backend | **None.** No API, no database server, no sync. |
| Live scoring | `js/live.js`: player-first flow (pick a team, pick a player, tap a stat). Undo reverses the last play exactly. Game clock, quarters, manual score, shot spot, play-by-play filters, roster on-court toggles. |
| Stats | `js/stats.js` (box score, standings, aggregates, CSV) and `js/analytics.js` (per-36, +/−, lineup minutes, streaks, flow, shot zones, pace). |
| Reports | `js/reports.js` prints via `window.print()`. |
| Export | JSON backup; player-stats CSV (CRLF, no BOM, no formula-injection guard); no box-score CSV. |
| Tests | `tests/smoke.js` (48 Node tests, no framework). |
| Deploy | `.github/workflows/deploy.yml` publishes the repo root to GitHub Pages. |

### Gaps against the requested specification

1. **Two-tap entry** does not exist. The live console is player-first (two taps for a player, then a stat). Requested order is stat → jersey number.
2. **Rebounds** are a single total (`reb`). Offensive and defensive rebounds are missing.
3. **Opponent aggregate tracking** does not exist. Every stat needs a roster player. Opponent team totals are only derived from opponent players.
4. **Game phases**: pre-game, live, halftime, final. Only `scheduled | live | final` exist. No halftime state.
5. **Team fouls** per quarter are not shown on the scoreboard.
6. **Undo** works for the last play but cannot reverse aggregate (non-player) entries and is keyed by player id only.
7. **Shot clock** does not exist (listed as optional in the spec).
8. **Exports**: no box-score CSV. Player CSV lacks a BOM (Excel mis-reads UTF-8 names) and has no spreadsheet formula-injection guard. No PDF game report (only print). No share or e-mail actions.
9. **Pro tier and lineup rankings** do not exist. Shot chart, minutes and +/− exist locally but are approximate (see §4).
10. **AI recap** does not exist.
11. **Authentication / cloud sync / multi-device** do not exist. Accounts are device-local.
12. **Subscriptions** do not exist. Payment integration is not configured.
13. **Shareable summaries and player sharing** do not exist.
14. **Pre-existing defect**: `stats.normalizeGame` drops any stat line without a `playerId`. Any aggregate (team-level) line would be lost on reload. This must be fixed before aggregates can be stored.

## 2. Environment constraints (decided up front)

* The sandbox can reach only GitHub, npm and PyPI. **No** payment provider, managed cloud database, transactional e-mail service or hosted LLM API is reachable.
* Consequences, stated plainly:
  * **Payments are not processed.** Billing endpoints return `501 payments_not_configured` until a provider is configured. A signed webhook path exists (HMAC-SHA256 verification) so a real provider can be wired in. Pro access can be granted only by an operator through the server CLI, and that grant is labelled as a manual grant, not a payment.
  * **E-mail is delivered by the user's own mail client** (`mailto:`), not by the server.
  * **AI recaps are rule-based analysis** computed from measured stats. They are clearly labelled as analysis, not a language-model output.
  * **Database**: SQLite via the built-in `node:sqlite` module (Node ≥ 22.13, zero npm packages). The schema is plain SQL so it ports to Postgres.
  * **GitHub Pages cannot run a server.** The app still works fully offline from GitHub Pages or `file://`. Cloud sync needs `node server/index.js`, which also serves the app.

## 3. Architecture decisions

* Keep the zero-dependency browser app and its single-document data model. The data model gains additive fields only (no breaking schema change):
  * `players`: unchanged.
  * stat lines: new `oreb`, `dreb` fields, default 0.
  * opponent aggregate lines: `{ playerId: '', teamId, aggregate: true, ...stats }`.
  * games: `halftime` boolean (default false).
* One pure play engine (`js/plays.js`) used by classic entry, two-tap entry, keyboard shortcuts and undo. It is unit-tested in Node.
* Server (`server/`): zero npm dependencies, `node:http` + `node:sqlite` + `crypto.scrypt`.
  * Accounts, HttpOnly session cookies (token hash stored, not the token).
  * Cloud league document with **optimistic concurrency** (`baseRevision`). A stale write gets `409 Conflict` and the server copy. Nothing is overwritten silently.
  * Server-side revision history (restore point) on every accepted write.
  * Subscription entitlement table, enforced on every Pro endpoint.
  * Pro computation endpoints run the same pure modules (`storage.js`, `stats.js`, `analytics.js`, `recap.js`) through `vm`, so server and browser results are identical.
* Browser sync (`js/cloud.js`): debounced push, pull on focus, offline queue with backoff, conflict dialog with *merge* (existing merge code), *keep this device*, or *use cloud* (each keeps a downloadable backup first), and a guard against pushing an empty league over data.

## 4. Pro tier decision

* **FREE** (works with no account, fully local): live scoring (classic and two-tap), opponent aggregates, box score, standings, schedule, player stats, basic CSV (player and box score), JSON backup, printable reports, PDF game report, share and e-mail.
* **PRO** (requires a cloud account with an active entitlement, enforced server-side): lineup rankings, AI-style game recap (measured stats + labelled analysis), advanced season analytics report.
* **Existing analytics kept free.** Shot charts, minutes, +/− and streaks were already free in this codebase and the instructions say not to remove working features. The Pro gate is a single config list (`server/config.js`, `PRO_FEATURES`) so this can be changed to gate them as well.
* Known limitation of existing +/−: starters are inferred from box-score participation plus the on-court list, not recorded tip-off lineups. The minutes model counts only substitution-tracked time. Both are documented, not hidden.

## 5. Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Inspect, plan, this document | done |
| 2 | Live dashboard: phases (pre-game / live / halftime / final), team fouls per quarter, scoreboard | in progress |
| 3 | Two-tap stat entry (stat → jersey), 1/2/3-point buttons, undo for all entry types | in progress |
| 4 | Player stats (OREB/DREB added), opponent aggregate tracking, box score, undo of aggregates | in progress |
| 5 | Pro analytics: lineup rankings, AI-style recap, server-enforced gate | planned |
| 6 | Exports and sharing: CSV (BOM + injection guard, box score CSV), PDF game report, share, e-mail | planned |
| 7 | Accounts and cloud sync (server + browser client, conflicts, offline) | planned |
| 8 | Subscription: entitlements, webhook, CLI grant, payments reported as not configured | planned |
| 9 | Tests (Node unit + server integration + browser DOM test), bug fixes | planned |
| 10 | Documentation: README, `.env.example`, install / dev / deploy guides | planned |
