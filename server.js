const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2kb' }));
const PORT = process.env.PORT || 3000;
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media');

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4', '.aac', '.wav', '.opus', '.wma', '.m4b', '.mp4a']);
const ARTWORK_NAMES = ['folder.jpg', 'folder.jpeg', 'folder.png', 'cover.jpg', 'cover.jpeg', 'cover.png', 'album.jpg', 'album.png'];

function safePath(relPath) {
  const normalized = path.normalize(relPath || '');
  const full = path.join(MEDIA_ROOT, normalized);
  if (!full.startsWith(MEDIA_ROOT)) {
    throw new Error('Path traversal denied');
  }
  return full;
}

// Browse directory
app.get('/api/browse', (req, res) => {
  let full;
  try {
    full = safePath(req.query.path);
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
    const rel = path.join(req.query.path || '', entry.name);

    if (entry.isDirectory()) {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(full, entry.name)).mtimeMs; } catch {}
      dirs.push({ name: entry.name, type: 'dir', path: rel, mtime });
    } else if (AUDIO_EXTS.has(ext)) {
      let size = 0, mtime = 0;
      try {
        const s = fs.statSync(path.join(full, entry.name));
        size = s.size;
        mtime = s.mtimeMs;
      } catch {}
      files.push({ name: entry.name, type: 'file', path: rel, size, ext, mtime });
    }
  }

  res.json({ path: req.query.path || '', items: [...dirs, ...files] });
});

// Stream audio with range support
app.get('/api/stream', (req, res) => {
  let full;
  try {
    full = safePath(req.query.path);
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
app.get('/api/artwork', async (req, res) => {
  let full;
  try {
    full = safePath(req.query.path);
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
app.get('/api/metadata', async (req, res) => {
  let full;
  try {
    full = safePath(req.query.path);
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
