const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USERSTATE_FILE = path.join(DATA_DIR, 'userstate.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');

for (const dir of [DATA_DIR, SESSIONS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const file of [USERS_FILE, USERSTATE_FILE, PLAYLISTS_FILE]) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, file === USERS_FILE || file === PLAYLISTS_FILE ? '[]' : '{}');
  }
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return file.endsWith('userstate.json') ? {} : []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
  DATA_DIR, SESSIONS_DIR, USERS_FILE, USERSTATE_FILE, PLAYLISTS_FILE,
  getUsers: () => readJSON(USERS_FILE),
  saveUsers: u => writeJSON(USERS_FILE, u),
  getUserState: () => readJSON(USERSTATE_FILE),
  saveUserState: s => writeJSON(USERSTATE_FILE, s),
  getPlaylists: () => readJSON(PLAYLISTS_FILE),
  savePlaylists: p => writeJSON(PLAYLISTS_FILE, p),
};
