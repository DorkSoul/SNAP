'use strict';

import { clog } from './utils.js';
import { Player } from './player.js';
import { MediaSessionManager, WakeLock } from './media-session.js';
import { QueueModal, QueuePanel } from './queue.js';
import { FullscreenPlayer } from './fullscreen.js';
import { ViewToggle } from './view-toggle.js';
import { FileBrowser } from './file-browser.js';
import { Auth } from './auth.js';
import { UserMenu } from './user-menu.js';
import { AdminPanel } from './admin.js';
import { SyncManager } from './sync-manager.js';
import { Playlists } from './playlists.js';

// Expose modules on window so that lazily-resolved cross-module references work.
// (Player, FileBrowser, QueuePanel, etc. reference each other via window._X at call time
//  to avoid circular import issues.)
window._MediaSessionManager = MediaSessionManager;
window._WakeLock = WakeLock;
window._QueueModal = QueueModal;
window._QueuePanel = QueuePanel;
window._FullscreenPlayer = FullscreenPlayer;
window._ViewToggle = ViewToggle;
window._FileBrowser = FileBrowser;

// Keep --player-h in sync with the actual rendered player bar height
new ResizeObserver(entries => {
  const h = entries[0].target.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--player-h', h + 'px');
}).observe(document.getElementById('player-bar'));

// Keep the phone's WiFi radio alive via server-sent WebSocket pings.
// Android puts the WiFi adapter into deep power-save when no inbound traffic
// arrives; the server pings every 8 s prevents that — same mechanism as
// WireGuard PersistentKeepalive. Only active while screen is locked + playing.
(() => {
  const _audio = document.getElementById('audio');
  const _video = document.getElementById('video');
  let _sock = null;

  function _isPlaying() { return !_audio.paused || !_video.paused; }

  function _open() {
    if (_sock && _sock.readyState < 2) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    _sock = new WebSocket(`${proto}//${location.host}/_ws`);
    _sock.addEventListener('open',  () => clog('ws:open'));
    _sock.addEventListener('close', () => {
      clog('ws:close');
      _sock = null;
      if (document.hidden && _isPlaying()) setTimeout(_open, 3000);
    });
    _sock.addEventListener('error', () => {});
  }

  function _close() { if (_sock) { _sock.close(); _sock = null; } }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _isPlaying()) _open(); else _close();
  });
  _audio.addEventListener('pause', () => { if (!_isPlaying()) _close(); });
  _video.addEventListener('pause', () => { if (!_isPlaying()) _close(); });
  _audio.addEventListener('play',  () => { if (document.hidden) _open(); });
  _video.addEventListener('play',  () => { if (document.hidden) _open(); });
})();

// Pull to refresh
(() => {
  const browserEl  = document.getElementById('browser');
  const indicator  = document.getElementById('ptr-indicator');
  const IND_H      = 52;
  const THRESHOLD  = 72;
  let startY = 0, startX = 0, active = false, pull = 0;

  browserEl.addEventListener('touchstart', e => {
    if (browserEl.scrollTop === 0) {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = true;
      pull = 0;
      browserEl.style.transition = '';
      indicator.style.transition = '';
    }
  }, { passive: true });

  browserEl.addEventListener('touchmove', e => {
    if (!active) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (dy <= 0 || dx > dy) { active = false; return; }
    e.preventDefault();
    pull = Math.min(IND_H + THRESHOLD * 0.6, dy * 0.45);
    browserEl.style.transform = `translateY(${pull}px)`;
    indicator.style.transform = `translateY(${pull - IND_H}px)`;
    indicator.style.opacity   = String(Math.min(1, pull / IND_H * 1.5));
    indicator.classList.toggle('ptr-ready', pull >= THRESHOLD);
  }, { passive: false });

  function release() {
    if (!active) return;
    active = false;
    const doRefresh = pull >= THRESHOLD;
    pull = 0;
    browserEl.style.transition  = 'transform 0.25s ease';
    indicator.style.transition  = 'transform 0.25s ease, opacity 0.25s ease';
    browserEl.style.transform   = '';
    indicator.style.transform   = `translateY(-${IND_H}px)`;
    indicator.style.opacity     = '0';
    indicator.classList.remove('ptr-ready');
    if (doRefresh) FileBrowser.reload();
  }

  browserEl.addEventListener('touchend',    release, { passive: true });
  browserEl.addEventListener('touchcancel', release, { passive: true });
})();

// Back button: close fullscreen or navigate up the file tree
window.addEventListener('popstate', e => {
  // A programmatic FullscreenPlayer.close() consumes its own history entry
  // via history.back(); that pop must not trigger a browse navigation.
  if (FullscreenPlayer.consumePendingPop()) return;
  const state = e.state;
  if (!state) return;
  if (FullscreenPlayer.isOpen()) {
    FullscreenPlayer.close();
  } else if (state.type === 'browse') {
    FileBrowser.navigate(state.path, false);
  }
});

// ── Route track selection through active device ───────────────────────────────
// When another device is playing, selecting a track sends it to that device
// instead of playing locally. The takeover banner appears so the user can
// optionally switch playback to this device.
const _origStartQueue = Player.startQueue;
Player.startQueue = function(paths, idx) {
  if (SyncManager.hasActiveDevice()) {
    SyncManager.sendCommand('loadqueue', { queue: paths, index: idx || 0 });
    SyncManager.showTakeover();
    return;
  }
  _origStartQueue.call(this, paths, idx);
};

// ── Wire "add to playlist" buttons ───────────────────────────────────────────
document.getElementById('select-add-playlist').addEventListener('click', () => {
  Playlists.showAddModal(FileBrowser.getSelectedPaths ? FileBrowser.getSelectedPaths() : []);
});

document.getElementById('qm-add-playlist').addEventListener('click', () => {
  // get pending paths from QueueModal
  const paths = QueueModal.getPendingPaths ? QueueModal.getPendingPaths() : [];
  document.getElementById('queue-modal').hidden = true;
  Playlists.showAddModal(paths);
});

// ── Password eye-toggle (global, works on any .pw-eye button) ────────────────

document.addEventListener('click', e => {
  const btn = e.target.closest('.pw-eye');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.querySelector('.eye-show').hidden = show;
  btn.querySelector('.eye-hide').hidden = !show;
});

// ── App startup ───────────────────────────────────────────────────────────────

let _appReady = false;
function onReady() {
  const user = Auth.currentUser();
  if (!user) return;
  if (_appReady) {
    // Re-login after session expiry: the app is already initialized and may be
    // mid-playback — just refresh the listing instead of re-running init.
    FileBrowser.reload();
    return;
  }
  UserMenu.setup(user);
  // Load the file browser (first real load after auth)
  FileBrowser.reload();
  // Restore queue from localStorage
  Player.restore();
  if (!Player.isActive()) document.body.classList.add('player-hidden');
  // Init cross-device sync
  SyncManager.init();
  _appReady = true;
}

Auth.init(onReady);
