// Main app wiring
let data = loadData();

// ---------- Tab switching ----------
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'stats') renderStats();
  });
});

// ---------- Roster ----------
const playerForm = document.getElementById('player-form');
playerForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('player-name').value.trim();
  const number = parseInt(document.getElementById('player-number').value, 10);
  const position = document.getElementById('player-position').value.trim().toUpperCase();
  if (!name || isNaN(number)) return;
  data.players.push({ id: crypto.randomUUID(), name, number, position });
  saveData(data);
  playerForm.reset();
  renderRoster();
});

function renderRoster() {
  const tbody = document.querySelector('#roster-table tbody');
  tbody.innerHTML = '';
  data.players.sort((a,b) => a.number - b.number).forEach(p => {
    const agg = playerAggregate(p.id, data.games);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.number}</td>
      <td>${p.name}</td>
      <td>${p.position || '—'}</td>
      <td>${agg.gp}</td>
      <td>${agg.ppg}</td>
      <td><button class="delete-btn" data-id="${p.id}">Remove</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.delete-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Remove this player and all their stats?')) return;
      data.players = data.players.filter(p => p.id !== b.dataset.id);
      data.games.forEach(g => { g.stats = g.stats.filter(s => s.playerId !== b.dataset.id); });
      saveData(data);
      renderRoster();
      renderGameForm();
    });
  });
}

// ---------- Game form ----------
function renderGameForm() {
  const container = document.getElementById('stat-inputs');
  container.innerHTML = '';
  if (data.players.length === 0) {
    container.innerHTML = '<p>Add players to the roster first.</p>';
    return;
  }
  const fields = ['pts','reb','ast','stl','blk','tov','fgm','fga'];
  const header = document.createElement('div');
  header.className = 'player-input-row';
  header.innerHTML = `<label>Player</label>${fields.map(f => `<label>${f.toUpperCase()}</label>`).join('')}`;
  container.appendChild(header);

  data.players.sort((a,b)=>a.number-b.number).forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-input-row';
    row.dataset.playerId = p.id;
    row.innerHTML = `<label>#${p.number} ${p.name}</label>` +
      fields.map(f => `<input type="number" min="0" data-stat="${f}" placeholder="0" />`).join('');
    container.appendChild(row);
  });
}

const gameForm = document.getElementById('game-form');
gameForm.addEventListener('submit', e => {
  e.preventDefault();
  const opponent = document.getElementById('opponent').value.trim();
  const date = document.getElementById('game-date').value;
  const stats = [];
  document.querySelectorAll('#stat-inputs .player-input-row[data-player-id]').forEach(row => {
    const statObj = { playerId: row.dataset.playerId };
    row.querySelectorAll('input[data-stat]').forEach(inp => {
      statObj[inp.dataset.stat] = Number(inp.value) || 0;
    });
    const total = Object.keys(statObj).filter(k => k !== 'playerId').reduce((a,k)=>a+statObj[k],0);
    if (total > 0) stats.push(statObj);
  });
  if (!opponent || !date) return alert('Opponent and date are required');
  if (stats.length === 0) return alert('Enter stats for at least one player');

  const teamScore = stats.reduce((a,s)=>a+s.pts,0);
  const oppScore = prompt('Opponent score:', '0');
  const game = {
    id: crypto.randomUUID(),
    opponent, date,
    teamScore,
    oppScore: Number(oppScore) || 0,
    stats
  };
  data.games.push(game);
  saveData(data);
  gameForm.reset();
  renderGameForm();
  renderGames();
});

function renderGames() {
  const list = document.getElementById('game-list');
  list.innerHTML = '';
  [...data.games].reverse().forEach(g => {
    const card = document.createElement('div');
    card.className = 'game-card';
    const result = g.teamScore > g.oppScore ? 'W' : g.teamScore < g.oppScore ? 'L' : 'T';
    card.innerHTML = `
      <h3>${result} vs ${g.opponent} — ${g.teamScore}–${g.oppScore}</h3>
      <p><small>${g.date}</small></p>
      <button class="delete-btn" data-id="${g.id}">Delete</button>
    `;
    card.querySelector('.delete-btn').addEventListener('click', () => {
      if (!confirm('Delete this game?')) return;
      data.games = data.games.filter(x => x.id !== g.id);
      saveData(data);
      renderGames();
      renderRoster();
    });
    list.appendChild(card);
  });
}

// ---------- Stats ----------
function renderStats() {
  const container = document.getElementById('stats-summary');
  const rec = teamRecord(data.games);
  container.innerHTML = `<p><strong>Record:</strong> ${rec.w}–${rec.l}</p>`;

  if (data.players.length === 0) {
    container.innerHTML += '<p>No players yet.</p>';
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr>
      <th>Player</th><th>GP</th><th>PPG</th><th>RPG</th><th>APG</th>
      <th>SPG</th><th>BPG</th><th>FG%</th><th>PTS</th>
    </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  data.players.sort((a,b)=>a.number-b.number).forEach(p => {
    const a = playerAggregate(p.id, data.games);
    const spg = a.gp ? (a.totals.stl/a.gp).toFixed(1) : '0.0';
    const bpg = a.gp ? (a.totals.blk/a.gp).toFixed(1) : '0.0';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${p.number} ${p.name}</td>
      <td>${a.gp}</td><td>${a.ppg}</td><td>${a.rpg}</td><td>${a.apg}</td>
      <td>${spg}</td><td>${bpg}</td><td>${a.fgPct}</td><td>${a.totals.pts}</td>`;
    tbody.appendChild(tr);
  });
  container.appendChild(table);
}

document.getElementById('export-csv').addEventListener('click', () => {
  const csv = toCSV(data.players, data.games);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `basketball-stats-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ---------- Schedule ----------
const schedForm = document.getElementById('schedule-form');
schedForm.addEventListener('submit', e => {
  e.preventDefault();
  const opponent = document.getElementById('sched-opponent').value.trim();
  const date = document.getElementById('sched-date').value;
  const location = document.getElementById('sched-location').value.trim();
  if (!opponent || !date) return;
  data.schedule.push({ id: crypto.randomUUID(), opponent, date, location });
  data.schedule.sort((a,b)=>new Date(a.date)-new Date(b.date));
  saveData(data);
  schedForm.reset();
  renderSchedule();
});

function renderSchedule() {
  const list = document.getElementById('schedule-list');
  list.innerHTML = '';
  data.schedule.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${new Date(s.date).toLocaleString()}</strong> — vs ${s.opponent}
      ${s.location ? ' @ ' + s.location : ''}
      <button class="delete-btn" data-id="${s.id}">×</button>`;
    li.querySelector('.delete-btn').addEventListener('click', () => {
      data.schedule = data.schedule.filter(x => x.id !== s.id);
      saveData(data);
      renderSchedule();
    });
    list.appendChild(li);
  });
}

// ---------- Reset ----------
document.getElementById('reset-data').addEventListener('click', () => {
  if (!confirm('Erase ALL data? This cannot be undone.')) return;
  resetData();
  data = loadData();
  renderAll();
});

// ---------- Init ----------
function renderAll() {
  renderRoster();
  renderGameForm();
  renderGames();
  renderSchedule();
  renderStats();
}
renderAll();
