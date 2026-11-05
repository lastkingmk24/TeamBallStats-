// Simple localStorage-backed persistence layer
const DB_KEY = 'bball_tm_v1';

const defaultData = {
  players: [],
  games: [],
  schedule: []
};

function loadData() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : structuredClone(defaultData);
  } catch {
    return structuredClone(defaultData);
  }
}

function saveData(data) {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

function resetData() {
  localStorage.removeItem(DB_KEY);
}
