const path = require('path');
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media');
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4', '.aac', '.wav', '.opus', '.wma', '.m4b', '.mp4a']);
const VIDEO_EXTS = new Set(['.mkv', '.webm', '.avi', '.mov', '.m4v', '.mpg', '.mpeg', '.wmv']);
const ARTWORK_NAMES = ['folder.jpg', 'folder.jpeg', 'folder.png', 'cover.jpg', 'cover.jpeg', 'cover.png', 'album.jpg', 'album.png'];

function safePath(relPath) {
  const normalized = path.normalize(relPath || '');
  const full = path.join(MEDIA_ROOT, normalized);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) throw new Error('Path traversal denied');
  return full;
}

// Full access: relPath is one of the user's grants or inside one.
function canAccess(user, relPath) {
  if (user.role === 'admin') return true;
  return user.allowedPaths.some(p => relPath === p || relPath.startsWith(p + '/'));
}

// Browsable: full access, or an ancestor of a grant (so nested grants like
// "Music/Rock" can be reached by navigating through "Music").
function canBrowse(user, relPath) {
  if (canAccess(user, relPath)) return true;
  if (!relPath) return user.allowedPaths.length > 0;
  return user.allowedPaths.some(p => p.startsWith(relPath + '/'));
}

module.exports = { MEDIA_ROOT, AUDIO_EXTS, VIDEO_EXTS, ARTWORK_NAMES, safePath, canAccess, canBrowse };
