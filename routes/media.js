const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { requireAuth } = require('../middleware/auth.js');
const { MEDIA_ROOT, AUDIO_EXTS, VIDEO_EXTS, ARTWORK_NAMES, safePath, canAccess, canBrowse } = require('../lib/media.js');
const router = express.Router();

// Query params arrive as arrays when a key is repeated (?path=a&path=b);
// treat anything that isn't a plain string as absent.
function qstr(v) { return typeof v === 'string' ? v : ''; }

// Resolve an entry's kind, following symlinks (a symlinked dir reports
// isDirectory() === false on the Dirent itself).
function entryIsDir(entry, parentDir) {
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(path.join(parentDir, entry.name)).isDirectory(); } catch { return null; }
  }
  return entry.isDirectory();
}

// ── Search ────────────────────────────────────────────────────────────────────
router.get('/search', requireAuth, (req, res) => {
  const q = qstr(req.query.q).trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  const results = [];
  const LIMIT = 200;

  function walk(relPath) {
    if (results.length >= LIMIT) return;
    const dir = path.join(MEDIA_ROOT, relPath);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= LIMIT) return;
      const rel = relPath ? path.join(relPath, entry.name) : entry.name;
      const isDir = entryIsDir(entry, dir);
      if (isDir === null) continue; // broken symlink
      if (isDir) {
        if (!canBrowse(req.user, rel)) continue;
        walk(rel);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue;
        if (!canAccess(req.user, rel)) continue;
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
  const relPath = qstr(req.query.path);

  if (!canBrowse(req.user, relPath)) {
    // A user with no grants gets an empty root rather than an error page
    if (!relPath) return res.json({ path: '', items: [] });
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
    const isDir = entryIsDir(entry, full);
    if (isDir === null) continue; // broken symlink

    if (isDir) {
      if (!canBrowse(req.user, rel)) continue;
      let mtime = 0;
      try { mtime = fs.statSync(path.join(full, entry.name)).mtimeMs; } catch {}
      dirs.push({ name: entry.name, type: 'dir', path: rel, mtime });
    } else if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
      if (!canAccess(req.user, rel)) continue;
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
  const relPath = qstr(req.query.path);
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
  // A directory here would pass statSync, send 200 headers, then hang when
  // createReadStream fails with EISDIR after headers are already out.
  if (!stat.isFile()) return res.status(404).json({ error: 'File not found' });

  const mimeType = mime.lookup(full) || 'application/octet-stream';
  const fileSize = stat.size;
  const range = req.headers.range;
  const name = path.basename(full);

  // Parse bytes=A-B, bytes=A-, or the suffix form bytes=-N (last N bytes).
  // Malformed or multi-range headers are ignored per RFC 7233 (fall through
  // to a full 200 response); parseable-but-unsatisfiable ranges get a 416.
  let parsed = null; // { start, end } | 'unsatisfiable' | null
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start, end;
      if (m[1] === '') {
        const suffixLen = parseInt(m[2], 10);
        start = fileSize - suffixLen; // suffixLen 0 → start === fileSize → unsatisfiable
        if (start < 0) start = 0;
        end = fileSize - 1;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] !== '' ? Math.min(parseInt(m[2], 10), fileSize - 1) : fileSize - 1;
      }
      parsed = (start >= fileSize || start > end) ? 'unsatisfiable' : { start, end };
    }
  }

  if (parsed === 'unsatisfiable') {
    return res.status(416)
      .set('Content-Range', `bytes */${fileSize}`)
      .json({ error: 'Range not satisfiable' });
  }

  if (parsed) {
    const { start, end } = parsed;
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
  const relPath = qstr(req.query.path);
  if (!canAccess(req.user, relPath)) return res.status(403).json({ error: 'Access denied' });

  let full;
  try {
    full = safePath(relPath);
  } catch {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let isDir = false;
  try { isDir = fs.statSync(full).isDirectory(); } catch {
    return res.status(404).json({ error: 'Not found' });
  }

  // Try embedded art
  const ext = path.extname(full).toLowerCase();
  if (!isDir && AUDIO_EXTS.has(ext)) {
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
  const dir = isDir ? full : path.dirname(full);
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
  const relPath = qstr(req.query.path);
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
router.post('/clientlog', requireAuth, (req, res) => {
  const { event, data } = req.body || {};
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const ev = String(event || '').replace(/[\r\n]/g, ' ').slice(0, 200);
  let extra = '';
  if (data !== undefined) {
    try { extra = ' ' + JSON.stringify(data).replace(/[\r\n]/g, ' ').slice(0, 500); } catch {}
  }
  console.log(`[client ${ts}] ${ev}${extra}`);
  res.json({ ok: true });
});

module.exports = router;
