'use strict';

import { enc } from './utils.js';
import { Player } from './player.js';

// ── Media Session (lock screen controls + OS background audio permission) ─────

const MediaSessionManager = (() => {
  const ms = navigator.mediaSession;
  if (!ms) return { update: () => {}, setPlaying: () => {}, setPosition: () => {} };

  // Wire OS lock-screen buttons → Player (forward refs resolved at call time)
  const actions = {
    play:          () => Player.playPause(),
    pause:         () => Player.playPause(),
    previoustrack: () => Player.playPrev(),
    nexttrack:     () => Player.playNext(),
    seekto:        d  => { Player.seekTo(d.seekTime); },
    seekbackward:  d  => { Player.skip(-(d.seekOffset || 10)); },
    seekforward:   d  => { Player.skip(d.seekOffset || 10); },
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { ms.setActionHandler(action, handler); } catch (_) {}
  }

  function update({ title, artist, artworkPath }) {
    const artwork = artworkPath
      ? [{ src: `/api/artwork?path=${enc(artworkPath)}`, sizes: '512x512', type: 'image/jpeg' }]
      : [];
    ms.metadata = new MediaMetadata({ title: title || 'Unknown', artist: artist || '', artwork });
  }

  function setPlaying(playing) {
    ms.playbackState = playing ? 'playing' : 'paused';
  }

  function setPosition(current, duration, rate) {
    if (!isFinite(duration) || duration <= 0) return;
    try {
      ms.setPositionState({ duration, playbackRate: rate || 1, position: current });
    } catch (_) {}
  }

  return { update, setPlaying, setPosition };
})();

// ── Wake Lock ─────────────────────────────────────────────────────────────────

const WakeLock = (() => {
  let lock = null;

  async function acquire() {
    if (!('wakeLock' in navigator)) return;
    try { lock = await navigator.wakeLock.request('screen'); }
    catch (e) { console.warn('Wake lock failed:', e); }
  }

  async function release() {
    if (lock) { await lock.release().catch(() => {}); lock = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !Player.paused()) acquire();
  });

  return { acquire, release };
})();

export { MediaSessionManager, WakeLock };
