const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { requireAuth } = require('../middleware/auth.js');
const { MEDIA_ROOT, AUDIO_EXTS, VIDEO_EXTS, ARTWORK_NAMES, safePath, canAccess } = require('../lib/media.js');
const router = express.Router();

// ── Search ────────────────────────────────────────────────────────────────────
router.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  const results = [];
  const LIMIT = 200;

  function walk(relPath) {
    if (results.length >= LIMIT) return;
    let entries;
    try { entries = fs.readdirSync(path.join(MEDIA_ROOT, relPath), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= LIMIT) return;
      const rel = relPath ? path.join(relPath, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!canAccess(req.user, rel)) continue;
        walk(rel);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue;
        if (!canAccess(req.user, relPath || '')) continue;
        if (!entry.name.toLowerCase().includes(q)) continue;
        let size = 0, mtime = 0;
        try { const s = fs.statSync(path.join(MEDIA_ROOT, rel)); size = s.size; mtime = s.mtimeMs; } catch {}
        results.push({ name: entry.name, type: 'file', path: rel, size, ext, mtime });
      }
    }
  }

  walk('');
  res.json(results);
});

// ── Browse directory ──────────────────────────────────────────────────────────
router.get('/browse', requireAuth, (req, res) => {
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

// ── Stream audio with range support ──────────────────────────────────────────
router.get('/stream', requireAuth, (req, res) => {
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

// ── Artwork: embedded → folder image → 404 ───────────────────────────────────
router.get('/artwork', requireAuth, async (req, res) => {
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

// ── Metadata ──────────────────────────────────────────────────────────────────
router.get('/metadata', requireAuth, async (req, res) => {
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

// ── Client-side event log ─────────────────────────────────────────────────────
router.post('/clientlog', (req, res) => {
  const { event, data } = req.body || {};
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const extra = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[client ${ts}] ${event}${extra}`);
  res.json({ ok: true });
});

module.exports = router;
