/* =========================================================================
 * storage.js — data model, validation, persistence, theme key and the
 * NON-DESTRUCTIVE migration chain v1 -> v2 -> v3.
 *
 * The localStorage key is UNCHANGED: 'bball_tm_v1'. Existing installs are
 * upgraded in place; the raw v1 document is preserved one time in
 * 'bball_tm_v1_pre_v2_backup'. The theme choice is NOT league data: it lives
 * in its own key, 'bball_tm_theme' (see js/theme.js).
 *
 * SCHEMA v3
 * {
 *   version: 3,
 *   league:   { name, season, primaryTeamId, quarters, quarterMinutes, theme },
 *   teams:    [{ id, name, short, color, primary }],
 *   players:  [{ id, teamId, name, number, position, active, photo }],
 *   games:    [{ id, date, time, location, season, status, homeTeamId,
 *                awayTeamId, homeScore, awayScore, quarter, clockSeconds,
 *                clockRunningSince, lineup: { home:[id], away:[id] },
 *                stats: [statLine], events: [event], notes, createdAt }],
 *   schedule: [{ id, date, time, title, type, location, gameId, notes }],
 *   meta:     { createdAt, migratedFrom, migratedAt, migratedTo,
 *               legacyCounts, upgrades: [{from,to,at}] }
 * }
 *
 * statLine = { playerId, teamId, pts, reb, ast, stl, blk, tov,
 *              fgm, fga, tpm, tpa, ftm, fta, pf, min }
 * event    = { id, type, label, teamId, playerId, statDeltas, scoreDelta,
 *              shot: {x,y}|null, quarter, clockSeconds, ts }
 * status   = 'scheduled' | 'live' | 'final'
 * theme    = 'system' | 'dark' | 'light'
 *
 * Every normalizer copies unknown keys from the source object, so documents
 * written by a future version survive a load/save round-trip untouched.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const DB_KEY = 'bball_tm_v1';
  const BACKUP_KEY = 'bball_tm_v1_pre_v2_backup';
  const THEME_KEY = 'bball_tm_theme';
  const SCHEMA_VERSION = 3;
  const STATUSES = ['scheduled', 'live', 'final'];
  const EVENT_TYPES = ['game', 'practice', 'other'];
  const THEMES = ['system', 'dark', 'light'];
  const STAT_FIELDS = [
    'pts', 'reb', 'ast', 'stl', 'blk', 'tov',
    'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pf', 'min'
  ];
  const PLAYER_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

  /* ---------- small primitives (no dependencies, works on file://) ---------- */

  function uid(prefix) {
    let id = null;
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        id = globalThis.crypto.randomUUID();
      }
    } catch (_) { /* some file:// contexts lack crypto.randomUUID */ }
    if (!id) {
      id = Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 10) +
        Math.random().toString(36).slice(2, 10);
    }
    return prefix ? prefix + '-' + id : id;
  }

  const clone = value => JSON.parse(JSON.stringify(value));

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function str(value, fallback) {
    if (typeof value === 'string' && value !== '') return value;
    if (value === null || value === undefined || value === '') return fallback || '';
    return String(value);
  }

  function bool(value, fallback) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback === undefined ? false : fallback;
  }

  function todayISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
  }

  function blankStats(playerId, teamId) {
    const line = { playerId: playerId, teamId: teamId };
    STAT_FIELDS.forEach(f => { line[f] = 0; });
    return line;
  }

  function blankLineup() {
    return { home: [], away: [] };
  }

  function primaryTeamStub() {
    return { id: 'team-primary', name: 'My Team', short: 'MY', color: '', primary: true };
  }

  function defaultData() {
    const team = primaryTeamStub();
    return {
      version: SCHEMA_VERSION,
      league: {
        name: 'My League',
        season: '2026-27',
        primaryTeamId: team.id,
        quarters: 4,
        quarterMinutes: 10,
        theme: 'system'
      },
      teams: [team],
      players: [],
      games: [],
      schedule: [],
      meta: {
        createdAt: new Date().toISOString(),
        migratedFrom: null,
        migratedAt: null,
        migratedTo: null,
        legacyCounts: null,
        upgrades: []
      }
    };
  }

  /* ---------- v3 field normalizers ---------------------------------------- */

  /* A photo is an inline data URL produced by js/photos.js (canvas WebP/JPEG).
   * Anything else (remote URL, javascript:, blob:) is rejected so the app
   * stays 100% offline and XSS-safe. */
  function normalizePhoto(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim();
    if (!s) return '';
    if (!/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.test(s)) return '';
    return s;
  }

  function normalizeColor(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) {
      return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return /^#[0-9a-f]{6}$/.test(s) ? s : '';
  }

  function normalizeShot(value) {
    if (!value || typeof value !== 'object') return null;
    const x = num(value.x, NaN);
    const y = num(value.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000,
      y: Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000
    };
  }

  function normalizeTheme(value) {
    const s = String(value || '').toLowerCase();
    return THEMES.indexOf(s) >= 0 ? s : 'system';
  }

  function normalizeIdList(value) {
    const out = [];
    (Array.isArray(value) ? value : []).forEach(id => {
      const s = str(id, '');
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function normalizeLineup(value) {
    const src = (value && typeof value === 'object') ? value : {};
    return {
      home: normalizeIdList(src.home),
      away: normalizeIdList(src.away)
    };
  }

  /* Copies unknown keys from a source document so future schema additions are
   * never silently destroyed by a load/save round-trip. */
  function keepExtras(raw, normalized) {
    if (!raw || typeof raw !== 'object') return normalized;
    return Object.assign({}, raw, normalized);
  }

  function ensureTeamByName(teams, name) {
    const clean = String(name || '').trim() || 'Opponent';
    const key = clean.toLowerCase();
    let team = teams.find(t => String(t.name || '').trim().toLowerCase() === key);
    if (!team) {
      team = {
        id: uid('team'),
        name: clean,
        short: clean.slice(0, 3).toUpperCase(),
        color: '',
        primary: false
      };
      teams.push(team);
    }
    return team;
  }

  function ensureTeamById(teams, id, name) {
    let team = teams.find(t => t.id === id);
    if (!team) {
      team = {
        id: id || uid('team'),
        name: name || 'Unknown Team',
        short: (name || 'UNK').slice(0, 3).toUpperCase(),
        color: '',
        primary: false
      };
      teams.push(team);
    }
    return team;
  }

  /* ---------- canonical v3 normalizer (load + import + merge) ------------- */

  function normalizeEvent(raw) {
    const e = raw || {};
    const deltas = {};
    STAT_FIELDS.forEach(f => {
      const v = num(e.statDeltas ? e.statDeltas[f] : 0, 0);
      if (v) deltas[f] = v;
    });
    return keepExtras(e, {
      id: str(e.id, '') || uid('event'),
      type: str(e.type, 'custom'),
      label: str(e.label, 'Play'),
      teamId: str(e.teamId, ''),
      playerId: str(e.playerId, ''),
      statDeltas: deltas,
      scoreDelta: num(e.scoreDelta, 0),
      shot: normalizeShot(e.shot),
      quarter: Math.max(1, Math.round(num(e.quarter, 1))),
      clockSeconds: Math.max(0, num(e.clockSeconds, 0)),
      ts: num(e.ts, Date.now())
    });
  }

  function normalizeGame(raw, ctx) {
    const g = raw || {};
    let homeTeamId = str(g.homeTeamId, ctx.league.primaryTeamId);
    let awayTeamId = str(g.awayTeamId, '');

    if (!ctx.teams.some(t => t.id === homeTeamId)) {
      homeTeamId = ensureTeamById(ctx.teams, homeTeamId, 'Team ' + homeTeamId.slice(0, 4)).id;
    }
    if (!awayTeamId || !ctx.teams.some(t => t.id === awayTeamId)) {
      awayTeamId = ensureTeamByName(ctx.teams, str(g.opponent, 'Opponent')).id;
    }
    if (awayTeamId === homeTeamId) {
      awayTeamId = ensureTeamById(ctx.teams, uid('team'), 'Opponent').id;
    }

    const stats = records(g.stats).filter(rawLine => str(rawLine.playerId, '')).map(s => {
      const playerId = str(s.playerId, '');
      const player = ctx.players.find(p => p.id === playerId);
      const line = blankStats(playerId, str(s.teamId, player ? player.teamId : homeTeamId));
      STAT_FIELDS.forEach(f => { line[f] = Math.max(0, num(s[f], 0)); });
      return keepExtras(s, line);
    });

    const computedHome = stats
      .filter(s => s.teamId === homeTeamId)
      .reduce((a, s) => a + s.pts, 0);
    const homeScore = Math.max(0, num(g.homeScore, num(g.teamScore, computedHome)));
    const awayScore = Math.max(0, num(g.awayScore, num(g.oppScore, 0)));
    const status = STATUSES.indexOf(g.status) >= 0
      ? g.status
      : ((stats.length || homeScore || awayScore) ? 'final' : 'scheduled');

    const lineup = normalizeLineup(g.lineup);
    /* Drop lineup ids that no longer exist, keeping bench order intact. */
    lineup.home = lineup.home.filter(id => ctx.players.some(p => p.id === id));
    lineup.away = lineup.away.filter(id => ctx.players.some(p => p.id === id));

    return keepExtras(g, {
      id: str(g.id, '') || uid('game'),
      date: str(g.date, todayISO()),
      time: str(g.time, ''),
      location: str(g.location, ''),
      season: str(g.season, ''),
      status: status,
      homeTeamId: homeTeamId,
      awayTeamId: awayTeamId,
      homeScore: homeScore,
      awayScore: awayScore,
      quarter: Math.min(ctx.league.quarters, Math.max(1, Math.round(num(g.quarter, 1)))),
      clockSeconds: Math.max(0, num(g.clockSeconds, status === 'final' ? 0 : ctx.league.quarterMinutes * 60)),
      clockRunningSince: g.clockRunningSince ? num(g.clockRunningSince, 0) : null,
      lineup: lineup,
      stats: stats,
      events: (Array.isArray(g.events) ? g.events : []).map(normalizeEvent),
      notes: str(g.notes, ''),
      createdAt: str(g.createdAt, new Date().toISOString())
    });
  }

  function normalizeUpgrades(meta) {
    const list = Array.isArray(meta.upgrades) ? meta.upgrades : [];
    return list.map(step => {
      const s = step || {};
      return Object.assign({}, s, {
        from: Math.max(1, Math.round(num(s.from, 1))),
        to: Math.max(1, Math.round(num(s.to, 2))),
        at: str(s.at, new Date().toISOString())
      });
    });
  }

  /* options: { from: <detected source version>, recordUpgrade: bool } */
  function normalizeV3(raw, options) {
    const opts = options || {};
    const out = defaultData();
    const src = raw || {};
    const league = (src.league && typeof src.league === 'object') ? src.league : {};

    out.league = keepExtras(league, {
      name: str(league.name, out.league.name),
      season: str(league.season, out.league.season),
      primaryTeamId: str(league.primaryTeamId, ''),
      quarters: Math.max(1, Math.min(8, Math.round(num(league.quarters, 4)))),
      quarterMinutes: Math.max(1, Math.min(60, Math.round(num(league.quarterMinutes, 10)))),
      theme: normalizeTheme(league.theme)
    });

    const seenTeamIds = new Set();
    out.teams = records(src.teams)
      .filter(t => str(t.name, '') || str(t.id, ''))
      .map(item => {
        let id = str(item.id, '') || uid('team');
        if (seenTeamIds.has(id)) id = uid('team');
        seenTeamIds.add(id);
        /* id-only teams are kept so their players and games stay attached */
        const name = str(item.name, 'Team');
        return keepExtras(item, {
          id: id,
          name: name,
          short: str(item.short, name.slice(0, 3).toUpperCase()) || 'T',
          color: normalizeColor(item.color),
          primary: item.primary === true
        });
      });
    if (!out.teams.length) out.teams = [primaryTeamStub()];

    const primary = out.teams.find(t => t.id === out.league.primaryTeamId) ||
      out.teams.find(t => t.primary) || out.teams[0];
    out.teams.forEach(t => { t.primary = (t.id === primary.id); });
    out.league.primaryTeamId = primary.id;

    const seenPlayerIds = new Set();
    out.players = records(src.players)
      .filter(p => str(p.name, '') || str(p.id, ''))
      .map(item => {
        let id = str(item.id, '') || uid('player');
        if (seenPlayerIds.has(id)) id = uid('player');
        seenPlayerIds.add(id);
        let teamId = str(item.teamId, out.league.primaryTeamId);
        if (!out.teams.some(t => t.id === teamId)) teamId = out.league.primaryTeamId;
        return keepExtras(item, {
          id: id,
          teamId: teamId,
          name: str(item.name, 'Unnamed player'),
          number: Math.max(0, Math.min(99, Math.round(num(item.number, 0)))),
          position: str(item.position, '').toUpperCase(),
          active: item.active !== false,
          photo: normalizePhoto(item.photo)
        });
      });

    out.games = records(src.games)
      .filter(g => str(g.id, '') || str(g.date, '') || str(g.homeTeamId, '') ||
        str(g.awayTeamId, '') || str(g.opponent, '') ||
        records(g.stats).length || records(g.events).length)
      .map(g => normalizeGame(g, out));

    const seenGameIds = new Set();
    out.games.forEach(g => {
      if (seenGameIds.has(g.id)) g.id = uid('game');
      seenGameIds.add(g.id);
    });

    out.schedule = records(src.schedule)
      .filter(s => str(s.title, '') || str(s.opponent, '') || str(s.gameId, '') || str(s.date, ''))
      .map(item => keepExtras(item, {
        id: str(item.id, '') || uid('event'),
        date: str(item.date, todayISO()),
        time: str(item.time, ''),
        title: str(item.title, str(item.opponent, 'Event')),
        type: EVENT_TYPES.indexOf(item.type) >= 0 ? item.type : 'other',
        location: str(item.location, ''),
        gameId: str(item.gameId, '') || null,
        notes: str(item.notes, '')
      }));

    const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
    const upgrades = normalizeUpgrades(meta);
    const fromVersion = Math.max(1, Math.round(num(opts.from, SCHEMA_VERSION)));
    if (opts.recordUpgrade && fromVersion < SCHEMA_VERSION) {
      for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
        upgrades.push({ from: v, to: v + 1, at: new Date().toISOString() });
      }
    }
    out.meta = keepExtras(meta, {
      createdAt: str(meta.createdAt, new Date().toISOString()),
      migratedFrom: meta.migratedFrom || null,
      migratedAt: meta.migratedAt || null,
      migratedTo: fromVersion < SCHEMA_VERSION ? 'v' + SCHEMA_VERSION : (meta.migratedTo || null),
      legacyCounts: meta.legacyCounts || null,
      upgrades: upgrades
    });

    out.version = SCHEMA_VERSION;
    /* Extra top-level keys (app, schema, exportedAt, ...) survive too. */
    return keepExtras(src, out);
  }

  /* ---------- v1 -> v2 migration ------------------------------------------
   * v1 shape: { players:[{id,name,number,position}],
   *             games:[{id,opponent,date,teamScore,oppScore,
   *                     stats:[{playerId,pts,reb,ast,stl,blk,tov,fgm,fga}]}],
   *             schedule:[{id,opponent,date,location}] }
   * Produces a v2-shaped document; normalizeV3() then adds the v3 fields.
   * ------------------------------------------------------------------------ */

  function legacyV1ToV2(raw) {
    const v1 = (raw && typeof raw === 'object') ? raw : {};
    const out = defaultData();
    out.version = 2;
    const l = (v1.league && typeof v1.league === 'object') ? v1.league : {};

    const teamName = str(l.teamName, str(v1.teamName, 'My Team'));
    out.league.name = str(l.name, out.league.name);
    out.league.season = str(l.season, out.league.season);
    out.league.quarters = Math.max(1, Math.min(8, Math.round(num(l.quarters, 4))));
    out.league.quarterMinutes = Math.max(1, Math.min(60, Math.round(num(l.quarterMinutes, 10))));
    out.teams[0].name = teamName;
    out.teams[0].short = teamName.slice(0, 3).toUpperCase() || 'MY';
    const primaryId = out.teams[0].id;

    records(v1.players).forEach(item => {
      /* Keep identified players even if the name was lost; drop bare junk. */
      if (!str(item.name, '') && !str(item.id, '')) return;
      out.players.push(keepExtras(item, {
        id: str(item.id, '') || uid('player'),
        teamId: primaryId,
        name: str(item.name, 'Unnamed player'),
        number: Math.max(0, Math.min(99, Math.round(num(item.number, 0)))),
        position: str(item.position, '').toUpperCase(),
        active: true,
        photo: ''
      }));
    });

    records(v1.games).forEach(item => {
      if (!str(item.id, '') && !str(item.opponent, '') && !str(item.date, '') &&
          !str(item.teamScore, '') && !records(item.stats).length) return;
      const opponentName = str(item.opponent, 'Opponent');
      const away = ensureTeamByName(out.teams, opponentName);
      const stats = records(item.stats).filter(src => str(src.playerId, '')).map(src => {
        const line = blankStats(str(src.playerId, ''), primaryId);
        STAT_FIELDS.forEach(f => { line[f] = Math.max(0, num(src[f], 0)); });
        return keepExtras(src, line);
      });
      const fallbackScore = stats.reduce((a, s) => a + s.pts, 0);
      out.games.push(keepExtras(item, {
        id: str(item.id, '') || uid('game'),
        date: str(item.date, todayISO()),
        time: '',
        location: '',
        season: str(item.season, ''),
        status: 'final',
        homeTeamId: primaryId,
        awayTeamId: away.id === primaryId
          ? ensureTeamById(out.teams, uid('team'), opponentName + ' (Away)').id
          : away.id,
        homeScore: Math.max(0, num(item.teamScore, fallbackScore)),
        awayScore: Math.max(0, num(item.oppScore, 0)),
        quarter: out.league.quarters,
        clockSeconds: 0,
        clockRunningSince: null,
        lineup: blankLineup(),
        stats: stats,
        events: [],
        notes: '',
        createdAt: new Date().toISOString()
      }));
    });

    records(v1.schedule).forEach(item => {
      if (!str(item.opponent, '') && !str(item.title, '') && !str(item.date, '')) return;
      const opponent = str(item.opponent, '');
      out.schedule.push(keepExtras(item, {
        id: str(item.id, '') || uid('event'),
        date: str(item.date, todayISO()),
        time: '',
        title: str(item.title, opponent ? 'vs ' + opponent : 'Event'),
        type: 'game',
        location: str(item.location, ''),
        gameId: null,
        notes: ''
      }));
    });

    out.meta = {
      createdAt: new Date().toISOString(),
      migratedFrom: 'v1',
      migratedAt: new Date().toISOString(),
      migratedTo: null,
      legacyCounts: {
        players: out.players.length,
        games: out.games.length,
        events: out.schedule.length
      },
      upgrades: []
    };
    return out;
  }

  function migrateV1(raw) {
    return normalizeV3(legacyV1ToV2(raw), { from: 1, recordUpgrade: true });
  }

  /* 1 = legacy (no teams array), 2 = has teams but version < 3, 3 = current */
  function detectVersion(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 1;
    const v = num(raw.version, 0);
    if (v >= SCHEMA_VERSION) return 3;
    if (v === 2 || Array.isArray(raw.teams)) return 2;
    return 1;
  }

  /* Accept a v1, v2 or v3 document. Used by loadData AND by every import. */
  function coerce(raw) {
    const from = detectVersion(raw);
    if (from === 1) return migrateV1(raw);
    return normalizeV3(raw, { from: from, recordUpgrade: from < SCHEMA_VERSION });
  }

  /* Account credentials never belong in a league backup. Old league.access
   * passcode hashes are kept in existing local documents only long enough for
   * a one-time account upgrade; exports and restored documents omit them. */
  function withoutCredentials(raw) {
    const out = clone(raw || {});
    if (out.league && typeof out.league === 'object') delete out.league.access;
    delete out.accounts;
    return out;
  }

  /* ---------- persistence -------------------------------------------------- */

  function rawStored() {
    try { return localStorage.getItem(DB_KEY); } catch (_) { return null; }
  }

  function safeParse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  /* Only real objects are records: nulls, strings and arrays are never
   * promoted into placeholder teams/players/games during a migration. */
  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function records(value) {
    return (Array.isArray(value) ? value : []).filter(isRecord);
  }

  /* Refuse to overwrite the stored document if an upgrade would drop rows.
   * This is a belt-and-braces guard on top of the non-destructive coercers. */
  function preservesEverything(before, after) {
    if (!before || typeof before !== 'object') return true;
    const statLines = raw => records(raw.games)
      .reduce((a, g) => a + records(g.stats).length, 0);
    const playEvents = raw => records(raw.games)
      .reduce((a, g) => a + records(g.events).length, 0);
    return records(after.players).length >= records(before.players).length &&
      records(after.teams).length >= records(before.teams).length &&
      records(after.games).length >= records(before.games).length &&
      records(after.schedule).length >= records(before.schedule).length &&
      records(after.games).reduce((a, g) => a + records(g.stats).length, 0) >= statLines(before) &&
      records(after.games).reduce((a, g) => a + records(g.events).length, 0) >= playEvents(before);
  }

  let lastLoad = { from: SCHEMA_VERSION, to: SCHEMA_VERSION, migrated: false, persisted: false };

  function loadData() {
    const rawText = rawStored();
    if (!rawText) {
      lastLoad = { from: SCHEMA_VERSION, to: SCHEMA_VERSION, migrated: false, persisted: false };
      return defaultData();
    }

    const parsed = safeParse(rawText);
    if (!parsed || typeof parsed !== 'object') {
      lastLoad = { from: SCHEMA_VERSION, to: SCHEMA_VERSION, migrated: false, persisted: false };
      return defaultData();
    }

    const fromVersion = detectVersion(parsed);
    const wasLegacy = fromVersion === 1;
    const wasOlder = fromVersion < SCHEMA_VERSION;
    const data = coerce(parsed);
    lastLoad = { from: fromVersion, to: SCHEMA_VERSION, migrated: wasOlder, persisted: false };

    if (wasOlder) {
      /* One-time, non-destructive safety net before rewriting the old shape. */
      if (wasLegacy) {
        try {
          if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, rawText);
        } catch (_) { /* storage full — migration still proceeds */ }
      }
      if (preservesEverything(parsed, data)) {
        if (saveData(data)) {
          lastLoad.persisted = true;
        } else {
          console.warn('[TeamBallStats] upgraded data could not be persisted (storage full?). ' +
            'The in-memory league is still complete.');
        }
      } else {
        console.warn('[TeamBallStats] upgrade guard blocked a lossy write; original document kept.');
      }
    }
    return data;
  }

  function saveData(data) {
    try {
      data.version = SCHEMA_VERSION;
      localStorage.setItem(DB_KEY, JSON.stringify(data));
      lastSaveError = null;
      return true;
    } catch (err) {
      lastSaveError = err && err.name ? err.name : 'Error';
      return false;
    }
  }

  let lastSaveError = null;

  function resetData() {
    try {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(BACKUP_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function legacyBackup() {
    try { return localStorage.getItem(BACKUP_KEY); } catch (_) { return null; }
  }

  function usage() {
    let bytes = 0;
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = key ? (localStorage.getItem(key) || '') : '';
        const size = (String(key).length + value.length) * 2; /* UTF-16 estimate */
        bytes += size;
        keys.push({ key: key, bytes: size });
      }
    } catch (_) { /* private mode */ }
    return {
      bytes: bytes,
      kb: Math.round((bytes / 1024) * 10) / 10,
      keys: keys,
      database: (() => {
        const raw = rawStored();
        return raw ? Math.round((raw.length * 2 / 1024) * 10) / 10 : 0;
      })(),
      error: lastSaveError
    };
  }

  function summarize(data) {
    const d = coerce(data);
    const seasons = [];
    d.games.forEach(g => {
      const s = g.season || d.league.season;
      if (s && seasons.indexOf(s) < 0) seasons.push(s);
    });
    return {
      version: d.version,
      teams: d.teams.length,
      players: d.players.length,
      games: d.games.length,
      finalGames: d.games.filter(g => g.status === 'final').length,
      events: d.schedule.length,
      statLines: d.games.reduce((a, g) => a + g.stats.length, 0),
      playEvents: d.games.reduce((a, g) => a + g.events.length, 0),
      photos: d.players.filter(p => !!p.photo).length,
      seasons: seasons,
      theme: d.league.theme
    };
  }

  TBS.storage = {
    DB_KEY: DB_KEY,
    BACKUP_KEY: BACKUP_KEY,
    THEME_KEY: THEME_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STAT_FIELDS: STAT_FIELDS,
    STATUSES: STATUSES,
    EVENT_TYPES: EVENT_TYPES,
    THEMES: THEMES,
    PLAYER_POSITIONS: PLAYER_POSITIONS,
    uid: uid,
    clone: clone,
    num: num,
    str: str,
    bool: bool,
    todayISO: todayISO,
    blankStats: blankStats,
    blankLineup: blankLineup,
    defaultData: defaultData,
    normalizePhoto: normalizePhoto,
    normalizeColor: normalizeColor,
    normalizeShot: normalizeShot,
    normalizeTheme: normalizeTheme,
    normalizeLineup: normalizeLineup,
    normalizeV3: normalizeV3,
    migrateV1: migrateV1,
    detectVersion: detectVersion,
    coerce: coerce,
    withoutCredentials: withoutCredentials,
    preservesEverything: preservesEverything,
    loadData: loadData,
    saveData: saveData,
    resetData: resetData,
    legacyBackup: legacyBackup,
    usage: usage,
    summarize: summarize,
    getLastLoad: function () { return lastLoad; },
    getLastSaveError: function () { return lastSaveError; }
  };
})(window.TBS = window.TBS || {});
