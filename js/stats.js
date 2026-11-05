// Pure stats calculation helpers

function playerAggregate(playerId, games) {
  const playerGames = games.filter(g =>
    g.stats.some(s => s.playerId === playerId)
  );
  const totals = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0 };
  playerGames.forEach(g => {
    const s = g.stats.find(x => x.playerId === playerId);
    if (!s) return;
    Object.keys(totals).forEach(k => { totals[k] += Number(s[k] || 0); });
  });
  const gp = playerGames.length;
  return {
    gp,
    totals,
    ppg: gp ? (totals.pts / gp).toFixed(1) : '0.0',
    rpg: gp ? (totals.reb / gp).toFixed(1) : '0.0',
    apg: gp ? (totals.ast / gp).toFixed(1) : '0.0',
    fgPct: totals.fga ? ((totals.fgm / totals.fga) * 100).toFixed(1) + '%' : '—'
  };
}

function teamRecord(games) {
  let w = 0, l = 0;
  games.forEach(g => {
    if (g.teamScore > g.oppScore) w++;
    else if (g.teamScore < g.oppScore) l++;
  });
  return { w, l };
}

function toCSV(players, games) {
  const header = ['Player','#','Position','GP','PPG','RPG','APG','FG%','Total PTS'];
  const rows = players.map(p => {
    const a = playerAggregate(p.id, games);
    return [p.name, p.number, p.position || '', a.gp, a.ppg, a.rpg, a.apg, a.fgPct, a.totals.pts];
  });
  return [header, ...rows].map(r => r.join(',')).join('\n');
}
