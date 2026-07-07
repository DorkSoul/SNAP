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
// Write to a temp file then rename so a crash mid-write can't corrupt the store.
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// requireAuth looks up the user on every request (including the 1 s sync
// polls), so users.json is cached in memory; saves write through immediately.
let usersCache = null;
function getUsers() {
  if (usersCache === null) usersCache = readJSON(USERS_FILE);
  return usersCache;
}
function saveUsers(u) {
  usersCache = u;
  writeJSON(USERS_FILE, u);
}

// User state changes every second while a device is playing, so it lives in
// memory and flushes to disk on a debounce (and on shutdown via flushUserState).
const FLUSH_MS = 5000;
let userStateCache = null;
let flushTimer = null;

function getUserState() {
  if (userStateCache === null) userStateCache = readJSON(USERSTATE_FILE);
  return userStateCache;
}
function saveUserState(s) {
  userStateCache = s;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      writeJSON(USERSTATE_FILE, userStateCache);
    }, FLUSH_MS);
  }
}
function flushUserState() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (userStateCache !== null) {
    try { writeJSON(USERSTATE_FILE, userStateCache); } catch {}
  }
}

module.exports = {
  DATA_DIR, SESSIONS_DIR, USERS_FILE, USERSTATE_FILE, PLAYLISTS_FILE,
  getUsers, saveUsers,
  getUserState, saveUserState, flushUserState,
  getPlaylists: () => readJSON(PLAYLISTS_FILE),
  savePlaylists: p => writeJSON(PLAYLISTS_FILE, p),
};
