const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

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
      dirs.push({ name: entry.name, type: 'dir', path: rel });
    } else if (AUDIO_EXTS.has(ext)) {
      let size = 0;
      try {
        size = fs.statSync(path.join(full, entry.name)).size;
      } catch {}
      files.push({ name: entry.name, type: 'file', path: rel, size, ext });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

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
