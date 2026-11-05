/* =========================================================================
 * storage.js — data model, persistence, validation and v1 -> v2 migration
 *
 * The localStorage key is UNCHANGED: 'bball_tm_v1'. Existing installs are
 * migrated in place (and the raw legacy JSON is preserved in a one-time
 * backup key) so no roster, game, box score or schedule entry is lost.
 *
 * SCHEMA v2
 * {
 *   version: 2,
 *   league:   { name, season, primaryTeamId, quarters, quarterMinutes },
 *   teams:    [{ id, name, short, primary }],
 *   players:  [{ id, teamId, name, number, position, active }],
 *   games:    [{ id, date, time, location, status, homeTeamId, awayTeamId,
 *                homeScore, awayScore, quarter, clockSeconds,
 *                clockRunningSince, stats: [statLine], events: [event],
 *                notes, createdAt }],
 *   schedule: [{ id, date, time, title, type, location, gameId, notes }],
 *   meta:     { createdAt, migratedFrom, migratedAt, legacyCounts }
 * }
 *
 * statLine = { playerId, teamId, pts, reb, ast, stl, blk, tov,
 *              fgm, fga, tpm, tpa, ftm, fta, pf, min }
 * event    = { id, type, label, teamId, playerId, statDeltas, scoreDelta,
 *              quarter, clockSeconds, ts }
 * status   = 'scheduled' | 'live' | 'final'
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const DB_KEY = 'bball_tm_v1';
  const BACKUP_KEY = 'bball_tm_v1_pre_v2_backup';
  const SCHEMA_VERSION = 2;
  const STATUSES = ['scheduled', 'live', 'final'];
  const EVENT_TYPES = ['game', 'practice', 'other'];
  const STAT_FIELDS = [
    'pts', 'reb', 'ast', 'stl', 'blk', 'tov',
    'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pf', 'min'
  ];

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

  function primaryTeamStub() {
    return { id: 'team-primary', name: 'My Team', short: 'MY', primary: true };
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
        quarterMinutes: 10
      },
      teams: [team],
      players: [],
      games: [],
      schedule: [],
      meta: { createdAt: new Date().toISOString(), migratedFrom: null, migratedAt: null, legacyCounts: null }
    };
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
        primary: false
      };
      teams.push(team);
    }
    return team;
  }

  /* ---------- canonical v2 normalizer (also validates imported backups) ---- */

  function normalizeEvent(raw) {
    const e = raw || {};
    const deltas = {};
    STAT_FIELDS.forEach(f => {
      const v = num(e.statDeltas ? e.statDeltas[f] : 0, 0);
      if (v) deltas[f] = v;
    });
    return {
      id: str(e.id, '') || uid('event'),
      type: str(e.type, 'custom'),
      label: str(e.label, 'Play'),
      teamId: str(e.teamId, ''),
      playerId: str(e.playerId, ''),
      statDeltas: deltas,
      scoreDelta: num(e.scoreDelta, 0),
      quarter: Math.max(1, Math.round(num(e.quarter, 1))),
      clockSeconds: Math.max(0, num(e.clockSeconds, 0)),
      ts: num(e.ts, Date.now())
    };
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

    const stats = (Array.isArray(g.stats) ? g.stats : []).map(rawLine => {
      const s = rawLine || {};
      const playerId = str(s.playerId, '');
      const player = ctx.players.find(p => p.id === playerId);
      const line = blankStats(playerId, str(s.teamId, player ? player.teamId : homeTeamId));
      STAT_FIELDS.forEach(f => { line[f] = Math.max(0, num(s[f], 0)); });
      return line;
    });

    const computedHome = stats
      .filter(s => s.teamId === homeTeamId)
      .reduce((a, s) => a + s.pts, 0);
    const homeScore = Math.max(0, num(g.homeScore, num(g.teamScore, computedHome)));
    const awayScore = Math.max(0, num(g.awayScore, num(g.oppScore, 0)));
    const status = STATUSES.indexOf(g.status) >= 0
      ? g.status
      : ((stats.length || homeScore || awayScore) ? 'final' : 'scheduled');

    return {
      id: str(g.id, '') || uid('game'),
      date: str(g.date, todayISO()),
      time: str(g.time, ''),
      location: str(g.location, ''),
      status: status,
      homeTeamId: homeTeamId,
      awayTeamId: awayTeamId,
      homeScore: homeScore,
      awayScore: awayScore,
      quarter: Math.min(ctx.league.quarters, Math.max(1, Math.round(num(g.quarter, 1)))),
      clockSeconds: Math.max(0, num(g.clockSeconds, status === 'final' ? 0 : ctx.league.quarterMinutes * 60)),
      clockRunningSince: g.clockRunningSince ? num(g.clockRunningSince, 0) : null,
      stats: stats,
      events: (Array.isArray(g.events) ? g.events : []).map(normalizeEvent),
      notes: str(g.notes, ''),
      createdAt: str(g.createdAt, new Date().toISOString())
    };
  }

  function normalizeV2(raw) {
    const out = defaultData();
    const src = raw || {};
    const league = (src.league && typeof src.league === 'object') ? src.league : {};

    out.league = {
      name: str(league.name, out.league.name),
      season: str(league.season, out.league.season),
      primaryTeamId: str(league.primaryTeamId, ''),
      quarters: Math.max(1, Math.min(8, Math.round(num(league.quarters, 4)))),
      quarterMinutes: Math.max(1, Math.min(60, Math.round(num(league.quarterMinutes, 10))))
    };

    const seenTeamIds = new Set();
    out.teams = (Array.isArray(src.teams) ? src.teams : []).map(t => {
      const item = t || {};
      let id = str(item.id, '') || uid('team');
      if (seenTeamIds.has(id)) id = uid('team');
      seenTeamIds.add(id);
      const name = str(item.name, 'Team');
      return {
        id: id,
        name: name,
        short: str(item.short, name.slice(0, 3).toUpperCase()) || 'T',
        primary: item.primary === true
      };
    });
    if (!out.teams.length) out.teams = [primaryTeamStub()];

    const primary = out.teams.find(t => t.id === out.league.primaryTeamId) ||
      out.teams.find(t => t.primary) || out.teams[0];
    out.teams.forEach(t => { t.primary = (t.id === primary.id); });
    out.league.primaryTeamId = primary.id;

    const seenPlayerIds = new Set();
    out.players = (Array.isArray(src.players) ? src.players : []).map(p => {
      const item = p || {};
      let id = str(item.id, '') || uid('player');
      if (seenPlayerIds.has(id)) id = uid('player');
      seenPlayerIds.add(id);
      let teamId = str(item.teamId, out.league.primaryTeamId);
      if (!out.teams.some(t => t.id === teamId)) teamId = out.league.primaryTeamId;
      return {
        id: id,
        teamId: teamId,
        name: str(item.name, 'Player'),
        number: Math.max(0, num(item.number, 0)),
        position: str(item.position, '').toUpperCase(),
        active: item.active !== false
      };
    });

    out.games = (Array.isArray(src.games) ? src.games : []).map(g => normalizeGame(g, out));

    const seenGameIds = new Set();
    out.games.forEach(g => {
      if (seenGameIds.has(g.id)) g.id = uid('game');
      seenGameIds.add(g.id);
    });

    out.schedule = (Array.isArray(src.schedule) ? src.schedule : []).map(s => {
      const item = s || {};
      return {
        id: str(item.id, '') || uid('event'),
        date: str(item.date, todayISO()),
        time: str(item.time, ''),
        title: str(item.title, str(item.opponent, 'Event')),
        type: EVENT_TYPES.indexOf(item.type) >= 0 ? item.type : 'other',
        location: str(item.location, ''),
        gameId: str(item.gameId, '') || null,
        notes: str(item.notes, '')
      };
    });

    const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
    out.meta = {
      createdAt: str(meta.createdAt, new Date().toISOString()),
      migratedFrom: meta.migratedFrom || null,
      migratedAt: meta.migratedAt || null,
      legacyCounts: meta.legacyCounts || null
    };
    return out;
  }

  /* ---------- v1 -> v2 migration ------------------------------------------
   * v1 shape: { players:[{id,name,number,position}],
   *             games:[{id,opponent,date,teamScore,oppScore,
   *                     stats:[{playerId,pts,reb,ast,stl,blk,tov,fgm,fga}]}],
   *             schedule:[{id,opponent,date,location}] }
   * ------------------------------------------------------------------------ */

  function migrateV1(raw) {
    const v1 = raw || {};
    const out = defaultData();
    const l = (v1.league && typeof v1.league === 'object') ? v1.league : {};

    const teamName = str(l.teamName, str(v1.teamName, 'My Team'));
    out.league.name = str(l.name, out.league.name);
    out.league.season = str(l.season, out.league.season);
    out.league.quarters = Math.max(1, Math.min(8, Math.round(num(l.quarters, 4))));
    out.league.quarterMinutes = Math.max(1, Math.min(60, Math.round(num(l.quarterMinutes, 10))));
    out.teams[0].name = teamName;
    out.teams[0].short = teamName.slice(0, 3).toUpperCase() || 'MY';
    const primaryId = out.teams[0].id;

    (Array.isArray(v1.players) ? v1.players : []).forEach(p => {
      const item = p || {};
      out.players.push({
        id: str(item.id, '') || uid('player'),
        teamId: primaryId,
        name: str(item.name, 'Player'),
        number: Math.max(0, num(item.number, 0)),
        position: str(item.position, '').toUpperCase(),
        active: true
      });
    });

    (Array.isArray(v1.games) ? v1.games : []).forEach(g => {
      const item = g || {};
      const opponentName = str(item.opponent, 'Opponent');
      const away = ensureTeamByName(out.teams, opponentName);
      const stats = (Array.isArray(item.stats) ? item.stats : []).map(s => {
        const src = s || {};
        const line = blankStats(str(src.playerId, ''), primaryId);
        STAT_FIELDS.forEach(f => { line[f] = Math.max(0, num(src[f], 0)); });
        return line;
      });
      const fallbackScore = stats.reduce((a, s) => a + s.pts, 0);
      out.games.push({
        id: str(item.id, '') || uid('game'),
        date: str(item.date, todayISO()),
        time: '',
        location: '',
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
        stats: stats,
        events: [],
        notes: '',
        createdAt: new Date().toISOString()
      });
    });

    (Array.isArray(v1.schedule) ? v1.schedule : []).forEach(s => {
      const item = s || {};
      const opponent = str(item.opponent, '');
      out.schedule.push({
        id: str(item.id, '') || uid('event'),
        date: str(item.date, todayISO()),
        time: '',
        title: str(item.title, opponent ? 'vs ' + opponent : 'Event'),
        type: 'game',
        location: str(item.location, ''),
        gameId: null,
        notes: ''
      });
    });

    out.meta = {
      createdAt: new Date().toISOString(),
      migratedFrom: 'v1',
      migratedAt: new Date().toISOString(),
      legacyCounts: {
        players: out.players.length,
        games: out.games.length,
        events: out.schedule.length
      }
    };
    return normalizeV2(out);
  }

  /* Accept either a v1 document or a v2 document. Used by load AND import. */
  function coerce(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
        num(raw.version, 1) >= SCHEMA_VERSION && Array.isArray(raw.teams)) {
      return normalizeV2(raw);
    }
    return migrateV1(raw);
  }

  /* ---------- persistence -------------------------------------------------- */

  function loadData() {
    let rawText = null;
    try { rawText = localStorage.getItem(DB_KEY); } catch (_) { return defaultData(); }
    if (!rawText) return defaultData();

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) { return defaultData(); }
    const wasV1 = !(parsed && num(parsed.version, 1) >= SCHEMA_VERSION && Array.isArray(parsed.teams));
    const data = coerce(parsed);

    if (wasV1) {
      /* One-time, non-destructive safety net before rewriting the old shape. */
      try {
        if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, rawText);
      } catch (_) { /* storage full — migration still proceeds */ }
      saveData(data);
    }
    return data;
  }

  function saveData(data) {
    try {
      data.version = SCHEMA_VERSION;
      localStorage.setItem(DB_KEY, JSON.stringify(data));
      return true;
    } catch (_) {
      return false;
    }
  }

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

  function summarize(data) {
    const d = coerce(data);
    return {
      version: d.version,
      teams: d.teams.length,
      players: d.players.length,
      games: d.games.length,
      finalGames: d.games.filter(g => g.status === 'final').length,
      events: d.schedule.length,
      statLines: d.games.reduce((a, g) => a + g.stats.length, 0)
    };
  }

  TBS.storage = {
    DB_KEY: DB_KEY,
    BACKUP_KEY: BACKUP_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    STAT_FIELDS: STAT_FIELDS,
    STATUSES: STATUSES,
    EVENT_TYPES: EVENT_TYPES,
    uid: uid,
    clone: clone,
    num: num,
    str: str,
    todayISO: todayISO,
    blankStats: blankStats,
    defaultData: defaultData,
    normalizeV2: normalizeV2,
    migrateV1: migrateV1,
    coerce: coerce,
    loadData: loadData,
    saveData: saveData,
    resetData: resetData,
    legacyBackup: legacyBackup,
    summarize: summarize
  };
})(window.TBS = window.TBS || {});
