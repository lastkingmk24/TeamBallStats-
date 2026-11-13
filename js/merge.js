/* =========================================================================
 * merge.js — PURE id-aware merge of two league documents. No DOM, so it is
 * unit-tested in Node (tests/smoke.js) and used by the JSON import (export.js)
 * and by the cloud conflict resolver (cloud.js).
 *
 * Rules:
 *   - players, teams and games are matched by id, then by identity (teams by
 *     name; players by team + number + name). Existing records are never
 *     overwritten: an incoming game with an id already present is skipped.
 *   - opponent aggregate lines (playerId '' and aggregate: true) are kept.
 *   - calendar events are skipped when id or date+title already exists.
 *   - league settings always come from the current document.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const storage = TBS.storage;

  function key(text) {
    return String(text || '').trim().toLowerCase();
  }

  /* Merge by stable identity, remapping ids when a duplicate name exists.
   * Photos, team colours, seasons and lineups travel with the imported data. */
  function mergeData(current, incoming) {
    const out = storage.withoutCredentials(current);
    const inc = storage.coerce(incoming);

    /* Teams: match on name, never import another "primary" flag. */
    const teamMap = {};
    inc.teams.forEach(t => {
      const existing = out.teams.find(x => key(x.name) === key(t.name)) ||
        out.teams.find(x => x.id === t.id);
      if (existing) {
        if (!existing.color && t.color) existing.color = t.color;
        teamMap[t.id] = existing.id;
      } else {
        const id = t.id && !out.teams.some(x => x.id === t.id) ? t.id : storage.uid('team');
        out.teams.push({
          id: id, name: t.name, short: t.short, color: t.color, primary: false
        });
        teamMap[t.id] = id;
      }
    });
    const mapTeam = id => teamMap[id] || (out.teams.some(t => t.id === id) ? id : out.league.primaryTeamId);

    /* Players: match on id, else on team + number + name. */
    const playerMap = {};
    inc.players.forEach(p => {
      const teamId = mapTeam(p.teamId);
      const existing = out.players.find(x => x.id === p.id) ||
        out.players.find(x => x.teamId === teamId && Number(x.number) === Number(p.number) &&
          key(x.name) === key(p.name));
      if (existing) {
        if (!existing.photo && p.photo) existing.photo = p.photo;
        playerMap[p.id] = existing.id;
      } else {
        const id = p.id && !out.players.some(x => x.id === p.id) ? p.id : storage.uid('player');
        out.players.push({
          id: id, teamId: teamId, name: p.name, number: p.number,
          position: p.position, active: p.active, photo: p.photo
        });
        playerMap[p.id] = id;
      }
    });
    const mapPlayer = id => playerMap[id] || (out.players.some(p => p.id === id) ? id : '');

    /* Games: skip exact id duplicates; otherwise remap and insert. */
    inc.games.forEach(g => {
      const homeTeamId = mapTeam(g.homeTeamId);
      const awayTeamId = mapTeam(g.awayTeamId);
      const duplicate = out.games.some(x =>
        x.id === g.id ||
        (x.date === g.date && x.homeTeamId === homeTeamId && x.awayTeamId === awayTeamId &&
         Number(x.homeScore) === Number(g.homeScore) && Number(x.awayScore) === Number(g.awayScore))
      );
      if (duplicate) return;
      const id = g.id && !out.games.some(x => x.id === g.id) ? g.id : storage.uid('game');
      out.games.push(Object.assign({}, g, {
        id: id,
        homeTeamId: homeTeamId,
        awayTeamId: awayTeamId,
        lineup: {
          home: ((g.lineup && g.lineup.home) || []).map(mapPlayer).filter(Boolean),
          away: ((g.lineup && g.lineup.away) || []).map(mapPlayer).filter(Boolean)
        },
        /* Player lines carry a playerId; opponent aggregate lines have none
         * and must survive the merge (they are team totals, not players). */
        stats: g.stats.map(s => Object.assign({}, s, {
          playerId: s.playerId ? mapPlayer(s.playerId) : '',
          teamId: mapTeam(s.teamId)
        })).filter(s => s.playerId || s.aggregate),
        events: g.events.map(e => Object.assign({}, e, {
          teamId: mapTeam(e.teamId),
          playerId: e.playerId ? mapPlayer(e.playerId) : ''
        }))
      }));
    });

    /* Calendar events: skip id or date+title duplicates. */
    inc.schedule.forEach(ev => {
      if (out.schedule.some(x => x.id === ev.id ||
        (x.date === ev.date && key(x.title) === key(ev.title)))) return;
      out.schedule.push(Object.assign({}, ev, {
        id: ev.id && !out.schedule.some(x => x.id === ev.id) ? ev.id : storage.uid('event')
      }));
    });

    /* League settings always come from the current install. */
    return storage.coerce(out);
  }

  TBS.merge = { mergeData: mergeData, key: key };
})(window.TBS = window.TBS || {});
