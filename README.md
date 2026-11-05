# 🏀 TeamBallStats

A **zero-dependency static app** for basketball coaches, scorekeepers and amateur
leagues. No React, no Next.js, no Vite, no build step, **no CDNs**, no backend and
no network calls: plain HTML, CSS and classic JavaScript files that run straight
from `index.html` (even via `file://`) and deploy unchanged to GitHub Pages.

All data lives in the browser's `localStorage`. Existing installs are migrated
in place, so your roster, game log and schedule survive the upgrade.

---

## Features (each one independently verifiable)

| # | Feature | Where to check |
|---|---------|----------------|
| 1 | **Live scoring console** — game clock (configurable quarters/minutes), start/pause, next quarter, reset, one-tap FT/2PT/3PT makes+misses, REB/AST/STL/BLK/TOV/PF/MIN, manual `+1/+2/+3/−1` score adjustments, play-by-play, exact undo, live box score, start/finalize/reopen | **Live Console** tab |
| 2 | **Box scores** — two-team tables with per-player lines, team totals, FG/3PT/FT splits, scoring by quarter, manual editing of every stat line and final score, delete game | **Box Scores** tab |
| 3 | **Standings** — W, L, PCT, GB, PF, PA, DIFF, PPG, opponent PPG, home/away splits, streak, last five; computed from final games only | **Standings** tab |
| 4 | **Schedule** — fixtures (home/away, date, time, location, notes, status) plus practice/other events, grouped upcoming vs. earlier, inline edit/delete, "Start live" and "Box score" shortcuts | **Schedule** tab |
| 5 | **Multi-team league + roster** — add/edit teams, assign/edit/deactivate players, jersey numbers and positions, team filters | **Teams & Roster** tab |
| 6 | **Player statistics** — GP, MIN, PTS, PPG, RPG, APG, SPG, BPG, TOV, FG%, 3P%, FT%, eFG%, TS%, PF, season leaders and properly escaped CSV export | **Player Stats** tab |
| 7 | **Printable reports** — PDF-style box score, standings + rosters, and a full-season report (every box score), using **only `window.print()`** — choose "Save as PDF" in the browser dialog | **Reports** tab, or any "Print / PDF" button |
| 8 | **Full JSON backup & restore** — one file containing league + teams + players + games + box scores + schedule; validate before import, **merge** or **replace**, accepts v1 and v2 files | **Data** tab |
| 9 | **Overview dashboard** — record, scoring averages, roster/teams counts, live-game banner, upcoming fixtures, recent results, team leaders | **Overview** tab |
| 10 | **League settings** — league name, season, my-team name, quarters, minutes per quarter | **Data** tab |
| 11 | **Migration & safety** — `bball_tm_v1` key preserved, automatic v1 → v2 upgrade, original data kept in a one-time backup key, reset with confirmation, cross-tab sync via `storage` events | **Data** tab / `js/storage.js` |
| 12 | **Offline & Pages-ready** — every asset is local; classic `<script>` tags (not ES modules) keep `file://` working; one GitHub Actions workflow deploys the repo root | open `index.html` with the network off |

---

## Quick start

```bash
# Option 1: just open the file (no server needed)
open index.html          # macOS
xdg-open index.html      # Linux
#   or double-click index.html on Windows

# Option 2: serve locally
python3 -m http.server 8000 --bind 0.0.0.0
# then visit http://localhost:8000
```

To explore a fully populated league immediately: open the **Data** tab →
choose `sample-data.json` → **Validate & import** (replace). Sample data
contains 4 teams, 15 players, 2 final games with box scores, 1 scheduled game
and 2 calendar events.

### Tests (no dependencies to install)

```bash
node tests/smoke.js                              # migration, data model, stats, CSV, sample data
for f in js/*.js tests/*.js; do node --check "$f"; done   # syntax check
```

The smoke suite uses only Node built-ins; it evaluates the real browser source
files in a `vm` context with a tiny `localStorage` stub, so the data contract
can be verified without a browser or an npm install.

---

## Deploy to GitHub Pages

1. Push the repo to GitHub (`main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. `.github/workflows/deploy.yml` uploads the repository root and deploys it.
4. Your app is live at `https://<user>.github.io/<repo>/`.

There is **one** deploy workflow (the old duplicate `static.yml` was removed so
two jobs no longer race for the same `pages` concurrency group). No base-path
config is required because every asset is referenced relatively.

---

## File layout

```
index.html              Tab skeleton + all script tags (classic scripts, load order)
css/style.css           Design system, responsive layout, @media print report styles
js/storage.js           Data model, validation, persistence, v1 -> v2 migration
js/stats.js             Pure calculations: aggregates, records, standings, box scores, CSV
js/ui.js                DOM helpers: escaping, formatting, tables, modals, toasts, downloads
js/dashboard.js         Overview cards, live banner, upcoming/recent, leaders
js/teams.js             Team + player CRUD and roster filter
js/schedule.js          Fixtures + calendar events timeline and editing
js/live.js              Live console: clock, plays, undo, play-by-play, live box score
js/boxscores.js         Full box scores, manual stat editing, quarter breakdown
js/standings.js         League standings table and league KPIs
js/leaders.js           Player stats tab, leaders, CSV export
js/reports.js           Printable reports via window.print() (no PDF library)
js/export.js            League settings, JSON backup/restore/merge, reset
js/app.js               State, tab/hash routing, shared helpers, bootstrap (loaded last)
tests/smoke.js          Zero-dependency Node tests for migration + stats (no npm install)
sample-data.json        Importable example league (v2)
.github/workflows/      Single GitHub Pages deploy workflow
```

Every module attaches to the single global namespace `window.TBS` and exposes
`{ render(state), init() }`. `init()` wires **delegated** listeners once;
`render(state)` only updates its own containers, so forms never lose typed
input. `TBS.app.commit(fn)` mutates state, saves and re-renders all views.

---

## Explicit data model

Stored as one JSON document under the **unchanged** key `bball_tm_v1`:

```jsonc
{
  "version": 2,
  "league":   { "name": "My League", "season": "2026-27",
                "primaryTeamId": "team-primary", "quarters": 4, "quarterMinutes": 10 },
  "teams":    [{ "id": "team-primary", "name": "My Team", "short": "MY", "primary": true }],
  "players":  [{ "id": "p1", "teamId": "team-primary", "name": "Jordan Smith",
                 "number": 23, "position": "SG", "active": true }],
  "games":    [{
      "id": "game-1", "date": "2026-11-05", "time": "19:30", "location": "Main gym",
      "status": "scheduled | live | final",
      "homeTeamId": "team-primary", "awayTeamId": "team-lions",
      "homeScore": 0, "awayScore": 0,
      "quarter": 1, "clockSeconds": 600, "clockRunningSince": null,
      "stats":  [{ "playerId": "p1", "teamId": "team-primary",
                   "pts":0,"reb":0,"ast":0,"stl":0,"blk":0,"tov":0,
                   "fgm":0,"fga":0,"tpm":0,"tpa":0,"ftm":0,"fta":0,"pf":0,"min":0 }],
      "events": [{ "id": "event-1", "type": "fg3_make", "label": "Jordan Smith — 3PT made",
                   "teamId": "team-primary", "playerId": "p1",
                   "statDeltas": {"fgm":1,"fga":1,"tpm":1,"tpa":1,"pts":3},
                   "scoreDelta": 3, "quarter": 1, "clockSeconds": 512, "ts": 1699999999999 }],
      "notes": "", "createdAt": "2026-11-05T12:00:00.000Z"
  }],
  "schedule": [{ "id": "event-2", "date": "2026-11-06T18:00", "time": "18:00",
                 "title": "Shootaround", "type": "game | practice | other",
                 "location": "Main gym", "gameId": null, "notes": "" }],
  "meta":     { "createdAt": "...", "migratedFrom": null, "migratedAt": null,
                "legacyCounts": null }
}
```

Notes:

* `stats` holds one line per player per game; `events` is the live play-by-play
  and the source for undo and quarter totals.
* Only `status: "final"` games count toward records, standings and averages.
* `clockRunningSince` is a timestamp, so a running clock survives a page reload.
* `coerce()` normalizes any document before use (imports included): missing
  fields are filled, IDs are deduplicated, dangling team references are
  repaired and all stat values are clamped to non-negative numbers.

### Migration (v1 → v2)

The original app stored `{ players, games, schedule }` under `bball_tm_v1`.
On first load, `storage.js`:

1. Copies the **raw legacy JSON** to `bball_tm_v1_pre_v2_backup` (one time only).
2. Creates the primary team (`My Team`, configurable in Data settings) and
   assigns every legacy player to it.
3. Converts every legacy game into a v2 fixture: `opponent` becomes a real
   team (deduplicated by name), `teamScore/oppScore` become `homeScore/awayScore`,
   status becomes `final`, and each old 8-field stat line is expanded into the
   full 14-field line (new fields default to `0`).
4. Converts legacy schedule items into calendar events titled `vs <opponent>`,
   preserving `date` (`datetime-local` strings included) and `location`.
5. Writes the upgraded document back under the **same key** and records
   `meta.migratedFrom = "v1"`.

Nothing is dropped. The pre-upgrade original can be downloaded from the
**Data** tab. JSON imports go through the exact same migration path, so a v1
backup is a valid restore file.

---

## Printing reports

Open **Reports**, choose a report type, and click **Print / Save as PDF**
(or press Ctrl/Cmd+P from any tab — the print stylesheet hides the app UI and
shows only the report sheet). Reports are pure DOM + CSS: no jsPDF, no fonts
from a CDN, no network request. The full-season report page-breaks between
box scores.

## Backing up

**Data → Download full JSON backup** produces one file. To restore, select it,
review the validation summary, choose **Merge** (adds missing teams/players/
games, never overwrites existing ones) or **Replace**, then click
**Validate & import**. Export a backup before using **Reset all data**.

---

## What changed in this upgrade

* **Architecture** — replaced one 228-line `js/app.js` monolith plus 2 helpers
  with 13 focused modules under `window.TBS`; added a design-system stylesheet,
  hash-based tab routing, delegated events, shared modal/table/toast helpers
  and consistent HTML escaping for all user-entered names.
* **Data model** — single-team → multi-team league with versioned schema,
  explicit game/status/clock/events/stat-line shapes, and non-destructive
  v1 migration that keeps the `bball_tm_v1` key (plus a raw backup).
* **Live scoring** — new console with clock, quarters, 13 stat actions, manual
  score adjustments, undo, play-by-play, live box score and finalization.
* **Box scores** — new full two-team box scores with shooting splits, quarter
  scoring and an inline editor (previously games were just a score card).
* **Standings** — new league table with GB, differential, splits, streak and
  last-five form.
* **Schedule** — fixtures are now game records that can be started live;
  practices/other events are supported; editing and deletion added.
* **Roster/stats** — multi-team CRUD, active/inactive players, leaderboards,
  advanced efficiency (eFG%, TS%) and a properly escaped CSV export.
* **Reports** — printable box score, standings and full-season PDF-style
  reports using only `window.print()`.
* **Backup/restore** — full JSON export, validated import with merge/replace,
  sample league file, league settings and a safer reset.
* **Ops** — duplicate Pages workflows consolidated into one; stray
  JSON-named file renamed to `sample-data.json` and expanded into an importable
  v2 example; README rewritten with the data model, file layout and migration
  contract.
* **Still true** — zero dependencies, zero build step, no CDNs, offline-capable,
  `file://`-friendly, GitHub Pages deploy unchanged.

---

## Roadmap

- [ ] Optional per-quarter substitution / +− tracking
- [ ] Shot chart drawn on a local `<canvas>`
- [ ] PWA install prompt and offline cache (service worker, still no build step)
- [ ] Optional backend sync with authentication

## License

MIT — see `LICENSE (MIT)`.
