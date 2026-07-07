const path = require('path');
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media');
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4', '.aac', '.wav', '.opus', '.wma', '.m4b', '.mp4a']);
const VIDEO_EXTS = new Set(['.mkv', '.webm', '.avi', '.mov', '.m4v', '.mpg', '.mpeg', '.wmv']);
const ARTWORK_NAMES = ['folder.jpg', 'folder.jpeg', 'folder.png', 'cover.jpg', 'cover.jpeg', 'cover.png', 'album.jpg', 'album.png'];

function safePath(relPath) {
  const normalized = path.normalize(relPath || '');
  const full = path.join(MEDIA_ROOT, normalized);
  if (!full.startsWith(MEDIA_ROOT)) throw new Error('Path traversal denied');
  return full;
}
function canAccess(user, relPath) {
  if (user.role === 'admin') return true;
  if (!relPath) return true;
  return user.allowedPaths.some(p => relPath === p || relPath.startsWith(p + '/'));
}

module.exports = { MEDIA_ROOT, AUDIO_EXTS, VIDEO_EXTS, ARTWORK_NAMES, safePath, canAccess };
