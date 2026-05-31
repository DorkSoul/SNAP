const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const { DATA_DIR, SESSIONS_DIR } = require('./lib/data.js');

const app = express();
app.use(express.json({ limit: '2mb' }));
const PORT = process.env.PORT || 3000;

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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth.js'));
app.use('/api/admin', require('./routes/admin.js'));
app.use('/api', require('./routes/state.js'));
app.use('/api/playlists', require('./routes/playlists.js'));
app.use('/api', require('./routes/media.js'));

// ── Serve frontend ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, () => {
  const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';
  console.log(`SNAP listening on http://0.0.0.0:${PORT}`);
  console.log(`Media root: ${MEDIA_ROOT}`);
});

// ── WebSocket keepalive endpoint (/_ws) ───────────────────────────────────────
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

// ── Disable timeouts that would cut long-running audio streams ────────────────
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
