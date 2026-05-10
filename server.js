const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

const app = express();
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

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(full).pipe(res);
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
