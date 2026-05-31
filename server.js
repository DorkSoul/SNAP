const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const app = express();
app.use(express.json({ limit: '2mb' }));
const PORT = process.env.PORT || 3000;
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media');

// ── Data directory setup ──────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
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

// ── Data helpers ──────────────────────────────────────────────────────────────
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return file.endsWith('userstate.json') ? {} : []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getUsers()    { return readJSON(USERS_FILE); }
function saveUsers(u)  { writeJSON(USERS_FILE, u); }
function getUserState()    { return readJSON(USERSTATE_FILE); }
function saveUserState(s)  { writeJSON(USERSTATE_FILE, s); }
function getPlaylists()    { return readJSON(PLAYLISTS_FILE); }
function savePlaylists(p)  { writeJSON(PLAYLISTS_FILE, p); }

// ── Session setup ─────────────────────────────────────────────────────────────
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, ttl: 30 * 24 * 3600, retries: 1, logFn: () => {} }),
  secret: (() => {
    const secretFile = path.join(DATA_DIR, 'session_secret');
    if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, s);
    return s;
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax' },
}));

// ── Input validation ──────────────────────────────────────────────────────────
function validUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8; }

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Not authenticated' }); }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

// ── Folder access check ───────────────────────────────────────────────────────
function canAccess(user, relPath) {
  if (user.role === 'admin') return true;
  if (!relPath) return true; // root is ok, we filter entries
  return user.allowedPaths.some(p => relPath === p || relPath.startsWith(p + '/'));
}

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4', '.aac', '.wav', '.opus', '.wma', '.m4b', '.mp4a']);
const VIDEO_EXTS = new Set(['.mkv', '.webm', '.avi', '.mov', '.m4v', '.mpg', '.mpeg', '.wmv']);
const ARTWORK_NAMES = ['folder.jpg', 'folder.jpeg', 'folder.png', 'cover.jpg', 'cover.jpeg', 'cover.png', 'album.jpg', 'album.png'];

function safePath(relPath) {
  const normalized = path.normalize(relPath || '');
  const full = path.join(MEDIA_ROOT, normalized);
  if (!full.startsWith(MEDIA_ROOT)) {
    throw new Error('Path traversal denied');
  }
  return full;
}

// ── Auth routes (no auth required for login/setup-check) ─────────────────────
app.get('/api/auth/setup-check', (req, res) => {
  const users = getUsers();
  res.json({ needsSetup: users.length === 0 });
});

app.post('/api/auth/setup', async (req, res) => {
  const users = getUsers();
  if (users.length > 0) return res.status(400).json({ error: 'Setup already done' });
  const { username, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Invalid username (3-32 chars, alphanumeric/underscore/dash)' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = { id: crypto.randomUUID(), username, passwordHash, role: 'admin', allowedPaths: [] };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ── Admin user management ─────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = getUsers().map(({ passwordHash, ...u }) => u);
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, role, allowedPaths } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const users = getUsers();
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    role,
    allowedPaths: Array.isArray(allowedPaths) ? allowedPaths : [],
  };
  users.push(user);
  saveUsers(users);
  const { passwordHash: _, ...out } = user;
  res.json(out);
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const users = getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const { password, role, allowedPaths } = req.body || {};
  if (password !== undefined) {
    if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    users[idx].passwordHash = await bcrypt.hash(password, 12);
  }
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    users[idx].role = role;
  }
  if (allowedPaths !== undefined) {
    users[idx].allowedPaths = Array.isArray(allowedPaths) ? allowedPaths : [];
  }
  saveUsers(users);
  const { passwordHash, ...out } = users[idx];
  res.json(out);
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const users = getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  saveUsers(users);
  res.json({ ok: true });
});

// ── User state sync ───────────────────────────────────────────────────────────
app.get('/api/state', requireAuth, (req, res) => {
  const state = getUserState();
  res.json(state[req.user.id] || {});
});

app.put('/api/state', requireAuth, (req, res) => {
  const { queue, index, position, sortKey, sortDir, deviceId } = req.body || {};
  const state = getUserState();
  state[req.user.id] = {
    queue: Array.isArray(queue) ? queue : (state[req.user.id]?.queue || []),
    index: typeof index === 'number' ? index : (state[req.user.id]?.index ?? -1),
    position: typeof position === 'number' ? position : (state[req.user.id]?.position || 0),
    sortKey: sortKey || state[req.user.id]?.sortKey || 'name',
    sortDir: sortDir || state[req.user.id]?.sortDir || 'asc',
    activeDeviceId: deviceId || state[req.user.id]?.activeDeviceId || null,
    activeDeviceAt: Date.now(),
  };
  saveUserState(state);
  res.json({ ok: true });
});

// ── Playlists ─────────────────────────────────────────────────────────────────
app.get('/api/playlists', requireAuth, (req, res) => {
  const playlists = getPlaylists().filter(p => p.userId === req.user.id);
  res.json(playlists);
});

app.post('/api/playlists', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const playlist = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name: name.trim().slice(0, 100),
    tracks: [],
    createdAt: new Date().toISOString(),
  };
  const playlists = getPlaylists();
  playlists.push(playlist);
  savePlaylists(playlists);
  res.json(playlist);
});

app.get('/api/playlists/:id', requireAuth, (req, res) => {
  const playlist = getPlaylists().find(p => p.id === req.params.id && p.userId === req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

app.put('/api/playlists/:id', requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const idx = playlists.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
  const { name, tracks } = req.body || {};
  if (name !== undefined) playlists[idx].name = String(name).trim().slice(0, 100);
  if (tracks !== undefined) playlists[idx].tracks = Array.isArray(tracks) ? tracks : [];
  savePlaylists(playlists);
  res.json(playlists[idx]);
});

app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const idx = playlists.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
  playlists.splice(idx, 1);
  savePlaylists(playlists);
  res.json({ ok: true });
});

// ── Browse directory ──────────────────────────────────────────────────────────
app.get('/api/browse', requireAuth, (req, res) => {
  const relPath = req.query.path || '';

  if (!canAccess(req.user, relPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let full;
  try {
    full = safePath(relPath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let entries;
  try {
    entries = fs.readdirSync(full, { withFileTypes: true });
  } catch (e) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  const dirs = [];
  const files = [];

  for (const entry of entries) {
    const ext = path.extname(entry.name).toLowerCase();
    const rel = path.join(relPath, entry.name);

    if (entry.isDirectory()) {
      // At root level, filter by allowedPaths for non-admins
      if (!relPath && req.user.role !== 'admin') {
        if (!req.user.allowedPaths.includes(entry.name)) continue;
      }
      let mtime = 0;
      try { mtime = fs.statSync(path.join(full, entry.name)).mtimeMs; } catch {}
      dirs.push({ name: entry.name, type: 'dir', path: rel, mtime });
    } else if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
      let size = 0, mtime = 0;
      try {
        const s = fs.statSync(path.join(full, entry.name));
        size = s.size;
        mtime = s.mtimeMs;
      } catch {}
      files.push({ name: entry.name, type: 'file', path: rel, size, ext, mtime });
    }
  }

  res.json({ path: relPath, items: [...dirs, ...files] });
});

// Stream audio with range support
app.get('/api/stream', requireAuth, (req, res) => {
  const relPath = req.query.path || '';
  if (!canAccess(req.user, relPath)) return res.status(403).json({ error: 'Access denied' });

  let full;
  try {
    full = safePath(relPath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  const mimeType = mime.lookup(full) || 'application/octet-stream';
  const fileSize = stat.size;
  const range = req.headers.range;
  const name = path.basename(full);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    console.log(`[stream] "${name}" bytes=${start}-${end}/${fileSize}`);
    const stream = fs.createReadStream(full, { start, end });
    stream.on('close', () => console.log(`[stream] "${name}" closed at ${start}-${end}`));
    stream.on('error', e => console.log(`[stream] "${name}" error: ${e.message}`));

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    stream.pipe(res);
  } else {
    console.log(`[stream] "${name}" full (no range), size=${fileSize}`);
    const stream = fs.createReadStream(full);
    stream.on('close', () => console.log(`[stream] "${name}" closed (full)`));
    stream.on('error', e => console.log(`[stream] "${name}" error: ${e.message}`));

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    stream.pipe(res);
  }
});

// Artwork: embedded → folder image → 404
app.get('/api/artwork', requireAuth, async (req, res) => {
  const relPath = req.query.path || '';
  if (!canAccess(req.user, relPath)) return res.status(403).json({ error: 'Access denied' });

  let full;
  try {
    full = safePath(relPath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Try embedded art
  const ext = path.extname(full).toLowerCase();
  if (AUDIO_EXTS.has(ext)) {
    try {
      const { parseFile } = await import('music-metadata');
      const meta = await parseFile(full, { skipCovers: false, duration: false });
      const pic = meta.common.picture && meta.common.picture[0];
      if (pic) {
        res.set('Content-Type', pic.format);
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(pic.data));
      }
    } catch {}
  }

  // Try folder images
  const dir = path.extname(full) ? path.dirname(full) : full;
  for (const name of ARTWORK_NAMES) {
    const imgPath = path.join(dir, name);
    if (fs.existsSync(imgPath)) {
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(imgPath);
    }
  }

  res.status(404).json({ error: 'No artwork' });
});

// Metadata
app.get('/api/metadata', requireAuth, async (req, res) => {
  const relPath = req.query.path || '';
  if (!canAccess(req.user, relPath)) return res.status(403).json({ error: 'Access denied' });

  let full;
  try {
    full = safePath(relPath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const { parseFile } = await import('music-metadata');
    const meta = await parseFile(full, { skipCovers: true, duration: true });
    res.json({
      title: meta.common.title || path.basename(full, path.extname(full)),
      artist: meta.common.artist || meta.common.albumartist || '',
      album: meta.common.album || '',
      duration: meta.format.duration || 0,
      size: stat.size,
    });
  } catch {
    res.json({
      title: path.basename(full, path.extname(full)),
      artist: '',
      album: '',
      duration: 0,
      size: stat.size,
    });
  }
});

// Client-side event log (audio lifecycle, visibility changes, reconnects)
app.post('/api/clientlog', (req, res) => {
  const { event, data } = req.body || {};
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[client ${ts}] ${event}${extra}`);
  res.json({ ok: true });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  console.log(`SNAP listening on http://0.0.0.0:${PORT}`);
  console.log(`Media root: ${MEDIA_ROOT}`);
});
// WebSocket keepalive endpoint (/_ws)
// Server → client pings every 8 s keep the phone's WiFi radio out of Android's
// deep power-save mode while audio plays with screen locked — same role as
// WireGuard PersistentKeepalive. No npm dependency; uses built-in crypto.
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_PING  = Buffer.from([0x89, 0x00]); // FIN=1, opcode=ping, no payload
const WS_CLOSE = Buffer.from([0x88, 0x00]); // FIN=1, opcode=close, no payload

server.on('upgrade', (req, socket) => {
  if (req.url !== '/_ws') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const ping = setInterval(() => { if (!socket.destroyed) socket.write(WS_PING); }, 8000);
  const cleanup = () => clearInterval(ping);

  socket.on('data', data => {
    if ((data[0] & 0x0f) === 0x8) { socket.write(WS_CLOSE); socket.end(); cleanup(); }
  });
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

// Disable timeouts that would cut long-running audio streams
server.timeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 30000;
// Send TCP keepalive probes on idle connections so home routers don't
// evict them from their NAT table when the audio buffer fills and the
// download pauses (the symptom: stream stops after a few minutes on LAN
// but works fine over VPN where the router never sees the raw TCP).
server.on('connection', socket => {
  socket.setKeepAlive(true, 10000); // probe after 10 s idle
});
