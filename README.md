# TeamBallStats

A **zero-dependency basketball team manager that runs entirely in the browser.**
Plain HTML, plain CSS, plain `<script>` tags — no framework, no bundler, no build
step, no `package.json`, no CDN, no network requests. Open `index.html` from
`file://`, or push the repository to GitHub Pages exactly as it is.

Everything you enter — teams, players, jersey numbers, photos, games, box
scores, play-by-play events, schedule items and settings — is stored in this
browser's `localStorage` under the key **`bball_tm_v1`** and can be exported as a
single JSON file at any time. Username/password accounts are kept separately in
**`bball_tm_accounts_v1`** and are never included in a league backup.

TeamBallStats ships no images, fonts or icons at all — not even in this README —
so there is nothing to download and nothing that can break offline. The UI,
including the court graphics and charts, is pure CSS and `<canvas>`.

---

## Contents

1. [Quick start](#quick-start)
2. [Sign-in: team account or league management](#sign-in-team-account-or-league-management)
3. [The nine tabs](#the-nine-tabs)
4. [Design system and themes](#design-system-and-themes)
5. [Player photos](#player-photos)
6. [Advanced analytics](#advanced-analytics)
7. [Keyboard shortcuts](#keyboard-shortcuts)
8. [File layout](#file-layout)
9. [Data model (schema v3)](#data-model-schema-v3)
10. [Migration contract (v1 → v2 → v3)](#migration-contract-v1--v2--v3)
11. [Testing](#testing)
12. [Deployment](#deployment)
13. [Accessibility, privacy and offline use](#accessibility-privacy-and-offline-use)
14. [Troubleshooting](#troubleshooting)
15. [What changed in v3](#what-changed-in-v3)

---

## Quick start

**Locally**

1. Download or clone the repository.
2. Double-click `index.html` (it works from `file://`).
3. Go to **Data** → **Reset all data** if you want a clean league, or
   **Data** → *Choose a backup file* → pick `sample-data.json` →
   **Validate & import** → **Replace** to load the demo league.

**Importing the sample league.** `sample-data.json` is a valid **schema v3**
backup: 4 teams with custom colours, 15 players (2 with embedded 128 px photos),
3 games — two finished games with full box scores plus **564 play-by-play
events** and shot coordinates, and one scheduled game — and 2 calendar items.
Importing it exercises every chart, the shot chart, the +/− numbers, the recap
and the printable reports.

**First visit.** You land on the account gate. Choose **Create account**, then
**Team** to make a username/password for one club, or **League** to make the
league management account. The league starts empty but functional: one team,
no players, no games. League management can add clubs in **Teams & Roster**;
each club can then create its own account from the gate. Add players, fixtures
and score games as before. Accounts are local to this browser and device.

---

## Sign-in: team account or league management

The gate has **Sign in** and **Create account** modes. Registration asks for a
username, password and password confirmation. Team registration also asks which
existing club the account belongs to. Usernames are unique on this device
(case-insensitive), 3–32 characters, and may use letters, numbers, dots,
underscores and hyphens. Passwords are 8–128 characters.

| Account | How it is created | What it can do |
| --- | --- | --- |
| **Team** | Create account → Team → choose an unclaimed club | Manage its own roster, fixtures and games. View every other club's statistics, standings, roster stats and box scores read-only. Its username and password are private to that account. |
| **League management** | Create account → League | View league-wide statistics and manage league settings/data. It cannot see team usernames, view password hashes in the UI, or reset/change another account's password. |

There is one account per club and one league management account on this device.
League management can add more clubs in **Teams & Roster**; those clubs can then
create their own accounts. Existing signed-in users change their own password
from **Account → Change password**; the current password is required.

**Where credentials live.** `bball_tm_accounts_v1` stores usernames and
PBKDF2-SHA-256 password credentials (310,000 iterations, random 16-byte salt).
Plaintext passwords are never stored. The account registry is separate from
`bball_tm_v1`, so JSON league backups do not contain usernames or password
credentials. Old `league.access` passcode hashes are accepted only once, as proof
while creating a replacement account; after registration the old passcode cannot
sign in. Shared demo passcodes no longer grant access.

**Sessions.** Signing in writes a small v2 session object to
`bball_tm_session_v1` in `localStorage` when *Keep me signed in* is checked,
otherwise in `sessionStorage`. Changing a password invalidates older sessions
for that account. **Account → Switch account** (or `Ctrl/⌘ + Shift + L`) locks
the console without deleting accounts or league data. Sessions and account
changes synchronise across tabs.

**It is a device-local gate, not a server.** There is no backend, cloud account
or cross-device sync. Anyone with browser dev tools can edit local data, so this
is not a production authentication boundary. The UI states this limitation.
For real multi-device accounts you would need a backend identity provider and
server-side authorization.

**Role-aware UI.** Team accounts keep their existing write scope and can read
other teams' stats. League management sees **Data → Access & roles**, now a
league-wide statistics directory with shortcuts to each team's player stats and
roster stats. It shows no team usernames and no password-reset controls.

---

## The nine tabs

| Tab | What it does |
| --- | --- |
| **Overview** (dashboard) | Season KPIs (record, win %, points for/against, streak), a live-game banner, a compact **last-game recap** (score, result, top performers, FG%/3P%/REB/TOV comparison, quarter line), upcoming fixtures, recent results and team leader lines. |
| **Live Console** | Pick a game, choose team → player, then tap scoring buttons (FT / 2PT / 3PT, makes and misses, rebounds, assists, steals, blocks, turnovers, fouls, minutes). Game clock with start/pause/reset, quarter advance, manual score corrections, undo, optional shot spot, and a filterable play-by-play log. **Start / Reopen / Finalize** control whether a game counts. |
| **Schedule** | One timeline for fixtures and calendar events (game, practice, other). Add, edit, delete, start a game in the console. |
| **Box Scores** | Full box score per game: both teams, every stat line, shooting splits, quarter-by-quarter table, team totals, plus a game-flow chart and a shot chart. **Edit box score** opens an inline editor (add/remove lines, correct any stat, scores, status, notes). |
| **Standings** | Win/loss table with pct, games back, points for/against and differential, form badges (W/L streak), plus a roster card per team with avatars. |
| **Teams & Roster** | Add teams (name, abbreviation, **custom colour**) and players (name, jersey number, position, team, **photo**). Edit/delete teams and players, deactivate players without deleting their history. Roster table is searchable and sortable. |
| **Player Stats** | Season/team filters, summary cards (league leaders), leader cards (PPG/RPG/APG/eFG%/TS%/+−/per-36), an **analytics** panel (hot/cold streaks, pace, starter sets) and a searchable, sortable full stat table. **Export CSV** downloads the filtered table. |
| **Reports** | Four printable reports built in the page, then `window.print()`: single-game box score, standings + rosters, player profile sheet (with photo, season averages, shooting splits, game log, shot chart) and a full-season report with every box score. Print always uses the **light** palette. |
| **Data** | League settings (name, season, team name, quarters, minutes per quarter, default theme), full **JSON backup download**, restore (**merge** or **replace**), one-time **pre-upgrade v1 backup** download, storage usage summary, sample-data guidance, **Access & roles** (league stats directory) and **Reset all data**. |

Toasts confirm every action, and destructive actions ask for confirmation first.

**Scope per role.** A **team account** sees Games (Overview), Live Console,
Schedule, Box Scores, Standings, Teams, Players and Reports — the **Data** tab
belongs to league management, and within Teams/Live/Schedule/Box Scores the
writes are limited to that club. League management sees all nine tabs and
league-wide stats, but never another account's credentials.

---

## Design system and themes

The visual language is court-inspired and broadcast-flavoured, built from CSS
custom properties in `css/style.css`:

* deep navy/charcoal surfaces, hardwood-red accent (`#c8102e`), gold and blue
  team accents, subtle court-line gradients and glass stat tiles;
* bold scoreboard typography using **system fonts only** (an Arial-Black display
  stack plus a monospace stack for numbers and clocks);
* circular avatars with jersey-number badges, colour dots per team, status pills
  (`live`, `final`, `scheduled`), sticky top bar with record and a live ticker;
* hover/focus motion, `:focus-visible` rings, a skip link and `aria-*` state on
  every interactive control;
* responsive at 1080 px, 860 px (mobile nav) and 640 px, with horizontally
  scrollable tables on small screens.

**Broadcast layout (the league-site look)**

* Account gate: dark court backdrop, a League Pass blue/gold accent, Sign in /
  Create account modes, and a Team / League role picker for registration.
* Header: black chrome with a ball mark, the league wordmark, a flat
  hover-underlined nav, a gold **League Pass** pill, the team record, a
  scores grid button and the account button.
* Cup band + ticker under the nav (`League Cup` / your league name), then a
  **score strip**: horizontally scrolling result cards with club crests, a
  winner emphasis, `FINAL` / `LIVE · Q3` / tip-off time and the "My team"
  marker; clicking a card opens that box score.
* Overview: a featured-game **hero** (blue banner, score line with club
  crests, big uppercase headline, WATCH / BOX SCORE buttons, related content)
  next to a **Headlines** rail that is generated from the league's own results,
  standings and leaderboards — no network, no editorial database.
* Round club crests are generated from the club's colour + abbreviation (an
  optional uploaded crest, `teams[].logo`, is used when present).

**Dark and light themes**

* `<html data-theme="dark">` / `<html data-theme="light">` swaps the token set.
* The header toggle writes the explicit choice to its **own** key,
  `bball_tm_theme`; it is *never* written into the league document. Toggling the
  theme therefore cannot change, reorder or drop any team, player or game.
* First visit: an inline bootstrap script (before first paint) resolves the OS
  preference with `prefers-color-scheme` so there is no flash of the wrong
  theme.
* `league.theme` (`system` | `dark` | `light`) is only a fallback default for
  devices that have never chosen.
* Changing the theme redraws the canvas charts (they read CSS variables) and is
  synchronised across browser tabs.
* **Print always forces the light palette**, even when the screen is dark.

---

## Player photos

Upload a photo in **Teams & Roster** (add-player form) or in the **edit player**
dialog.

* The file is read locally with `FileReader`, centre-cropped and resized to
  **128 × 128** on a `<canvas>`, encoded as WebP (JPEG fallback) and stored as a
  `data:` URL in `players[].photo`.
* Nothing is uploaded, fetched or cached anywhere else.
* Replace or remove a photo at any time; removing falls back to generated
  initials with the jersey number.
* Photos appear in the roster, player stats, standings rosters, live-console
  player chips, box scores, the player profile dialog and printable reports.
* Photos round-trip through JSON backup/restore. **CSV exports never include
  photos.**
* Only values matching `data:image/(png|jpeg|webp|gif);base64,…` are accepted, so
  a hand-edited backup cannot inject a remote URL or a `javascript:` payload.
* `localStorage` is small (~5 MB). Before saving, the app estimates the new size
  and shows a clear error toast when the quota would be exceeded
  (“Storage is almost full… remove a photo or two, or export a JSON backup
  first”). Save failures at any other time also surface a toast.

---

## Advanced analytics

Everything here is derived at render time — no extra fields are stored, so the
data model stays small and migration-safe.

| Metric | Definition |
| --- | --- |
| **FG%** | `FGM / FGA` |
| **3P%** | `3PM / 3PA` |
| **FT%** | `FTM / FTA` |
| **eFG%** | `(FGM + 0.5 × 3PM) / FGA` |
| **TS%** | `PTS / (2 × (FGA + 0.44 × FTA))` |
| **Per-36** | any counting stat `× 36 / MIN` (only shown when minutes exist) |
| **+/−** | net point margin while the player is on the floor, reconstructed from scoring events and substitutions (`sub_in` / `sub_out`, plus the game's starting lineup) |
| **On-court minutes** | accumulated from lineup events against the quarter clock |
| **Hot / cold streaks** | last-five scoring trend compared with the player's own season baseline |
| **Game flow** | cumulative margin after every scoring event (canvas line chart, zero line included) |
| **Shot zones** | shots classified into Paint, Mid-range, Corner 3, Wing 3 and Top 3 from normalised court coordinates (`x` 0–1 across, `y` 0–1 from baseline) |
| **Pace** | game length in minutes plus combined points per minute |
| **Starter sets** | the first five players recorded on court for each game (box score lines, refined by `lineup`) |

Charts are drawn on `<canvas>` at device-pixel-ratio resolution with colours
read from the active theme tokens:

* game-flow line chart and shot chart in **Box Scores**;
* mini shot spot in the **Live Console** (tap/drag to attach a location to the
  next shot);
* shot chart and per-zone table in the **player profile** and printable player
  report;
* sparklines for recent form.

---

## Keyboard shortcuts

Shortcuts work on the **Live Console** only, never while typing in a field,
never while a dialog is open. Press **?** for the in-app legend.

| Key | Action |
| --- | --- |
| `1` | Free throw made |
| `2` | 2-point field goal made |
| `3` | 3-point field goal made |
| `4` | Free throw missed |
| `5` | 2-point miss |
| `6` | 3-point miss |
| `R` | Rebound |
| `A` | Assist |
| `S` | Steal |
| `B` | Block |
| `T` | Turnover |
| `F` | Personal foul |
| `M` | Minute played |
| `Space` | Start / pause the game clock |
| `N` | Advance to the next quarter |
| `U` or `Ctrl/⌘ + Z` | Undo the last play |
| `↑` / `↓` | Select previous / next player |
| `?` | Show or hide the legend |
| `Esc` | Close any dialog |

Every control is also a real button, so nothing here is keyboard-only.

---

## File layout

Load order is fixed in `index.html` (classic scripts, no modules, so `file://`
works):

```
index.html              markup for all nine tabs, sign-in gate, score strip, dialogs,
                        toast host, inline theme + session bootstrap
css/style.css           design tokens (light + dark), components, responsive rules, @media print

js/storage.js           schema v3, normalizers, migration chain, saving, quota reporting
js/stats.js             pure stats: aggregates, shooting splits, records, standings, CSV
js/analytics.js         pure analytics: per-36, +/-, lineup minutes, streaks, flow, shot zones
js/ui.js                DOM helpers: escaping, formatting, icons, avatars, smart tables,
                        dialogs/modals, toasts, downloads, empty states
js/theme.js             bball_tm_theme persistence, resolve/apply/toggle, cross-tab sync
js/auth.js              username/password accounts, PBKDF2 credentials, sessions,
                        role permissions, account dialog, cross-tab lock
js/photos.js            canvas photo compression, quota guard, upload binding
js/shotchart.js         canvas drawing: shot chart, game flow, sparkline (DPR aware)
js/shortcuts.js         live-console key bindings + help legend
js/dashboard.js         Overview tab
js/teams.js             Teams & Roster tab (team colour, player photos, edit dialogs)
js/schedule.js          Schedule tab (fixtures + calendar events)
js/live.js              Live Console (scoring, clock, undo, play-by-play, shot spot)
js/boxscores.js         Box Scores tab (view, inline editor, charts)
js/standings.js         Standings tab (table, form, rosters)
js/leaders.js           Player Stats tab (filters, leaders, analytics, table, CSV)
js/profiles.js          player profile dialog (averages, game log, splits, shot chart)
js/reports.js           printable reports via window.print()
js/export.js            Data tab: settings, JSON backup/restore, legacy backup, reset
js/access.js            Data tab: league-wide stats directory; no team credentials
js/app.js               boot, tab routing, state/commit, header record, ticker, cross-tab sync

sample-data.json        importable demo league (schema v3, includes photos + colours)
tests/smoke.js          zero-dependency test suite (Node built-ins only)
.github/workflows/deploy.yml   GitHub Pages deployment (repo root, no build)
```

Each module is a small IIFE that attaches one namespace to the global `TBS`
object (`TBS.storage`, `TBS.stats`, `TBS.ui`, …). There is no 3,000-line
`app.js`: views are `{ render(state), init() }` and talk to each other only
through `TBS.app`, `TBS.storage` and the pure helpers.

---

## Data model (schema v3)

Stored in `localStorage` under **`bball_tm_v1`** (key unchanged since v1) and
exported verbatim by **Data → Download full JSON backup**.

```jsonc
{
  "version": 3,
  "app": "TeamBallStats",
  "schema": "bball_tm_v1",
  "league": {
    "name": "Riverside Community League",
    "season": "2026-27",
    "primaryTeamId": "team-hawks",
    "quarters": 4,
    "quarterMinutes": 10,
    "theme": "system"            // "system" | "dark" | "light" (device choice lives elsewhere)
  },
  "teams": [
    { "id": "team-hawks", "name": "Riverside Hawks", "short": "HAW",
      "color": "#c8102e",        // "" = default styling
      "primary": true }
  ],
  "players": [
    { "id": "p1", "teamId": "team-hawks", "name": "Jordan Smith",
      "number": 23, "position": "SG", "active": true,
      "photo": "data:image/webp;base64,…"   // "" = initials fallback
    }
  ],
  "games": [
    {
      "id": "game-1", "date": "2026-10-03", "time": "19:00",
      "location": "Riverside Gym", "season": "2026-27",
      "status": "final",               // "scheduled" | "live" | "final"
      "homeTeamId": "team-hawks", "awayTeamId": "team-lions",
      "homeScore": 68, "awayScore": 61,
      "quarter": 4, "clockSeconds": 0, "clockRunningSince": null,
      "lineup": { "home": ["p1", "..."], "away": ["q1", "..."] },
      "stats": [
        { "playerId": "p1", "teamId": "team-hawks",
          "pts": 22, "reb": 8, "ast": 5, "stl": 2, "blk": 1, "tov": 3,
          "fgm": 9, "fga": 17, "tpm": 1, "tpa": 4, "ftm": 3, "fta": 4,
          "pf": 2, "min": 30 }
      ],
      "events": [
        { "id": "e1", "type": "fg3_make", "label": "Jordan Smith — 3PT made",
          "teamId": "team-hawks", "playerId": "p1",
          "statDeltas": { "fgm": 1, "fga": 1, "tpm": 1, "tpa": 1, "pts": 3 },
          "scoreDelta": 3,
          "shot": { "x": 0.5, "y": 0.88 },     // null when not a shot
          "quarter": 2, "clockSeconds": 431, "ts": 1790000000000 }
      ],
      "notes": "", "createdAt": "2026-10-03T09:12:00.000Z"
    }
  ],
  "schedule": [
    { "id": "ev1", "date": "2026-10-06T18:00", "time": "18:00",
      "title": "Practice", "type": "practice",   // "game" | "practice" | "other"
      "location": "Riverside Gym", "gameId": null, "notes": "" }
  ],
  "meta": {
    "createdAt": "2026-10-01T00:00:00.000Z",
    "migratedFrom": "v2", "migratedAt": "2026-10-02T…", "migratedTo": "v3",
    "legacyCounts": { "players": 15, "games": 3 },
    "upgrades": [{ "from": 2, "to": 3, "at": "2026-10-02T…" }]
  }
}
```

**Stat lines always carry exactly 14 metrics** — `pts, reb, ast, stl, blk, tov,
fgm, fga, tpm, tpa, ftm, fta, pf, min` — plus `playerId` and `teamId`
(16 keys). Every efficiency number (eFG%, TS%, per-36, +/−) is derived at render
time and never stored.

Every normalizer **copies unknown keys through**, so a document written by a
future version survives a load/save round-trip untouched.

### Storage keys

| Key | Contents | Notes |
| --- | --- | --- |
| `bball_tm_v1` | the whole league (schema v3) | unchanged key since v1 |
| `bball_tm_v1_pre_v2_backup` | raw text of the original **v1** document | written once, never overwritten, never deleted by an upgrade; downloadable from **Data** |
| `bball_tm_theme` | `dark` or `light` | **device** preference; never part of the league JSON; absent = follow the OS |
| `bball_tm_accounts_v1` | `{version: 1, accounts: [...]}` | usernames + salted PBKDF2-SHA-256 credentials; device-local; never part of league JSON |
| `bball_tm_session_v1` | `{v: 2, accountId, sessionVersion, signedInAt}` | sign-in session; `localStorage` when *Keep me signed in*, otherwise `sessionStorage`; never part of league JSON |
| `league.access` (legacy, inside old league documents) | `{admin: hash, teams: {teamId: hash}}` | old passcode hashes used only for one-time account upgrade; omitted from exports and restored documents |

---

## Migration contract (v1 → v2 → v3)

Upgrading is **non-destructive by construction** and applies to both loading
from storage and importing a backup file.

1. **Detect** — `storage.detectVersion(raw)`:
   * `1` — unversioned legacy document, or a bare array of old games;
   * `2` — `version === 2`, or a document with a bare `teams` array and no
     version;
   * `3` — `version >= 3`.
2. **Coerce** — `storage.coerce(raw)` runs the same chain for every source:
   * v1 → `migrateV1` (players, games, per-game stat lines, opponents become
     real teams, legacy schedule items become calendar events) → `normalizeV3`;
   * v2 → `normalizeV3` directly;
   * v3 → `normalizeV3` (idempotent).
3. **Normalize v3** — every collection is validated, ids are filled in,
   references repaired, and **new v3 fields get safe defaults**:
   * `players[].photo = ''`
   * `teams[].color = ''`
   * `league.theme = 'system'`
   * `games[].season = ''`, `games[].lineup = { home: [], away: [] }`,
     `games[].events = []`, `events[].shot = null`
   * `meta.migratedFrom / migratedTo / migratedAt`, `meta.legacyCounts` and
     `meta.upgrades[]` are recorded (e.g. `[{from:1,to:2},{from:2,to:3}]`).
   Malformed input is handled defensively: `null`/string entries in legacy
   arrays are skipped instead of becoming placeholder records, and anything
   that still carries an id or a name is kept (an id-only player becomes
   “Unnamed player” rather than disappearing).
5. **Back up** — when a legacy (v1) document is detected, its **raw text** is
   copied to `bball_tm_v1_pre_v2_backup` **once**, and only if that key is empty.
6. **Guard** — before persisting an upgrade, `storage.preservesEverything()`
   asserts that no team, player, game, stat line, play event or schedule item
   disappeared. If the check fails, the original document is kept and nothing is
   overwritten.
7. **Persist** — otherwise the upgraded document is written back to
   `bball_tm_v1`. `storage.getLastLoad()` reports
   `{ from, to, migrated, persisted }` and the app shows a one-time toast
   (“Upgraded your existing v1 data — every player, game and event was kept”).

Imports use the **identical** path: a v1, v2 or v3 JSON file is coerced, then
**merged** (default — de-duplicates teams by name, players by team + number +
name, games by id or by date + teams + score) or **replaced**. Merged imports
never promote an imported team to “my team”, and league settings always come
from the current install.

---

## Testing

No dependencies, no install step:

```bash
node tests/smoke.js
for f in js/*.js tests/*.js; do node --check "$f"; done
```

`tests/smoke.js` runs in Node with a `localStorage` stub and covers, among other
things:

* v1 → v3 and v2 → v3 migration, including upgrade records, the raw backup,
  preserved counts, unknown-key passthrough and idempotent `coerce()`;
* the lossy-write guard (`preservesEverything`);
* `photo` / `color` / `theme` validation and round-trips;
* theme resolution and persistence: `bball_tm_theme` changes while
  `bball_tm_v1` stays byte-identical;
* the pure stats helpers (records, standings, aggregates, shooting splits,
  `toCSV` quoting without photos, season filters);
* analytics: per-36, +/− attribution with substitutions, lineup minutes,
  streaks, game flow, shot zones;
* `sample-data.json`: v3 shape, photo/colour validity, and the invariant that
  the events of each finished game add up to its final score;
* **accounts & roles**: team and league registration, username/password sign-in,
  validation, salted PBKDF2 credentials in a separate key, private team accounts,
  league-wide stats permission, owner-only password changes, legacy passcode
  upgrade, session restoration/invalidation and deleted-club rejection.

The same files run unchanged in the browser — the pure modules
(`storage.js`, `stats.js`, `analytics.js`, `theme.js`) never touch the DOM at
load time.

---

## Deployment

`.github/workflows/deploy.yml` publishes the **repository root** to GitHub
Pages with no build step (no `npm install`, no `next build`, no artifact other
than the checkout). Because every path is relative and every asset is local, the
same files work from `file://` and from any static host.

---

## Accessibility, privacy and offline use

* Semantic landmarks, a skip link, labelled form controls, `aria-live` toast
  host, `aria-sort` on sortable columns, `aria-current` on the active tab,
  `aria-pressed` on the theme toggle, keyboard-operable rows and dialogs, and
  visible `:focus-visible` rings.
* Reduced-motion preferences are respected.
* **No network calls at all** — no fonts, icons, images, scripts, styles or
  analytics. Disconnect the network (or open the file from disk) and every
  feature still works.
* Your data lives only in this browser until you export it. Clearing site data,
  a private window or a different browser profile means a different league:
  export a JSON backup first.

---

## Troubleshooting

**“Browser storage is full.”** Each photo is ~3–15 KB, but `localStorage`
caps at roughly 5 MB. Remove a photo or two in **Teams & Roster**, export a
backup, then retry.

**“Could not save — localStorage may be disabled.”** Private/incognito windows
and strict site-data settings can block storage. Try a normal window, or export
the backup and continue elsewhere.

**My old data looks different after upgrading.** It should not — every record is
preserved and new fields simply default. If a v1 install was upgraded, the
original file is downloadable from **Data → Download pre-upgrade v1 backup**.

**The theme is wrong on a new device.** The device choice lives in
`bball_tm_theme`; a fresh browser follows the OS preference (or
`league.theme`). Toggle once and it sticks.

**Print is missing parts of the page.** Only the report sheet prints — build a
report in **Reports**, then print.

**“Username or password is incorrect.”** Use the username created on this
browser/device. Old shared demo passcodes no longer sign in. If you previously
had a custom passcode, choose **Create account** and enter that passcode once to
upgrade. Passwords cannot be recovered from the stored hash; there is no cloud
reset. Clearing site data removes local accounts, so export league data first.

**The sign-in gate keeps coming back.** *Keep me signed in* writes the session
to `localStorage`; without it the session lives in `sessionStorage` and ends
when the tab closes. A private window cannot persist either.

---

## What changed in v3

**New features**

* **Dark / light themes** with a header toggle, OS-preference first visit,
  separate persistence key and print-safe light output.
* **Player photos** — canvas-compressed 128 px data URLs, replaceable and
  removable, with initials + jersey-number fallbacks everywhere.
* **Player profile dialog** — season averages, shooting splits, per-36, +/−,
  streak badge, game log, shot chart.
* **Advanced analytics** — per-36, eFG%, TS%, +/− reconstructed from events,
  hot/cold streaks, game-flow chart, canvas shot chart, shot zones, pace,
  starter sets, lineup minutes.
* **Compact “last game” recap** on the dashboard.
* **Play-by-play filters**, **shot spot** entry, **keyboard shortcuts** with an
  in-app legend.
* **Custom team colours and abbreviations**, **sortable + searchable tables**,
  **season/team filters**.
* **Inline box-score editor** with add/remove stat lines.
* **Four printable reports**, including a player sheet with a photo.
* Cross-tab sync, storage-usage summary and quota-aware error toasts.

**Schema** — `version: 3`. New fields: `players[].photo` (`''`),
`teams[].color` (`''`), `league.theme` (`'system'`), `games[].season`,
`games[].lineup` (`{home:[],away:[]}`) and `games[].events[]` (with optional
`shot`), plus `meta.migratedFrom/migratedTo/migratedAt/legacyCounts/upgrades`.
The `bball_tm_v1` key, all 14 stat fields and every v1/v2 record are unchanged.

**Non-destructive guarantee** — one shared migration path for storage loads and
JSON imports, a one-time raw `bball_tm_v1_pre_v2_backup`, and a
`preservesEverything()` write guard that refuses to persist a lossy upgrade.

---

MIT licensed. See `LICENSE (MIT)`.

---

## What changed in v4 (broadcast UI + sign-in)

v4 is a presentation and access layer on top of the same schema v3 document —
no migration is needed and every existing install keeps working.

* **Account gate** (`js/auth.js`): Team and League username/password creation,
  PBKDF2-SHA-256 credentials, device-scoped sessions and cross-tab lock.
* **Access & roles** (`js/access.js`): management-only league stats directory;
  team usernames and password controls stay private.
* **Broadcast chrome**: black header with a League Pass pill, cup band, league
  ticker, account button and a horizontally scrolling score strip with
  generated club crests.
* **Overview**: featured-game hero (banner, score line, headline, WATCH /
  BOX SCORE, related content) beside a Headlines rail built from the league's
  own results, standings and leaderboards.
* **Role-aware views**: the Live Console lists only your games for a team
  account, the Schedule form locks your club as home team, Box Scores hides
  delete for non-management, the Teams tab is scoped to your roster and the
  Data tab is hidden.
* **Tests**: account/role checks cover registration, privacy, password changes,
  legacy upgrade and sessions (48 smoke tests total); `js/auth.js` runs in the
  existing Node harness with Web Crypto.
