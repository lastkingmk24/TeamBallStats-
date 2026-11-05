# 🏀 Basketball Team Manager

A lightweight, browser-based team management and stats app for basketball coaches, scorekeepers, and amateur leagues. **No backend required** — all data is stored in your browser's localStorage.

## Features

- ✅ Roster management (name, number, position)
- ✅ Game logging with per-player box scores
- ✅ Auto-calculated stats: PPG, RPG, APG, SPG, BPG, FG%
- ✅ Team record (W–L)
- ✅ CSV export of full player statistics
- ✅ Practice/game schedule
- ✅ Zero dependencies, zero build step
- ✅ Deployable to GitHub Pages in one click

## Local Development

```bash
git clone https://github.com/YOUR_USERNAME/basketball-team-manager.git
cd basketball-team-manager
# Option 1: just open index.html
# Option 2: serve locally
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Source**, select **GitHub Actions**.
4. Push to `main` — the included workflow auto-deploys.
5. Your app will be live at `https://YOUR_USERNAME.github.io/basketball-team-manager/`.

## Data Storage

All data lives in `localStorage` under the key `bball_tm_v1`. Clearing browser data or using **Reset All Data** will wipe it. For multi-device sync, see "Roadmap" below.

## Roadmap

- [ ] Optional Flask/FastAPI backend with SQLite or Postgres
- [ ] Authentication (player vs. coach roles)
- [ ] Video embed links per game
- [ ] Advanced analytics (eFG%, TS%, +/-)
- [ ] PDF box score export
- [ ] PWA / offline install

## License

MIT — see `LICENSE`.
