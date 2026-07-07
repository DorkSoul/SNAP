'use strict';

import { Player } from './player.js';

// ── Fullscreen Player ─────────────────────────────────────────────────────────

const FullscreenPlayer = (() => {
  const el      = document.getElementById('fullscreen-player');
  const fsArtEl = document.querySelector('.fs-art');

  let controlsHideTimer = null;
  let tapTimer = null;

  function showControls() {
    el.classList.remove('controls-hidden');
    clearTimeout(controlsHideTimer);
    if (!Player.paused()) {
      controlsHideTimer = setTimeout(() => {
        if (Player.isCurrentVideo() && !Player.paused()) el.classList.add('controls-hidden');
      }, 3000);
    }
  }

  function hideControls() {
    clearTimeout(controlsHideTimer);
    el.classList.add('controls-hidden');
  }

  function open() {
    history.pushState({ type: 'fullscreen' }, '');
    el.hidden = false;
    if (Player.isCurrentVideo()) showControls();
  }

  function close() {
    el.hidden = true;
    el.classList.remove('controls-hidden');
    clearTimeout(controlsHideTimer);
    clearTimeout(tapTimer);
    controlsHideTimer = null;
    tapTimer = null;
  }

  function isOpen() { return !el.hidden; }

  document.getElementById('fs-close').addEventListener('click', () => history.back());

  // Rotate button
  document.getElementById('fs-btn-rotate').addEventListener('click', async () => {
    try {
      const type = screen.orientation.type;
      if (type.startsWith('landscape')) {
        await screen.orientation.lock('portrait-primary');
      } else {
        await screen.orientation.lock('landscape-primary');
      }
    } catch (_) {}
  });

  // Fullscreen button — toggles browser native fullscreen
  const fsFullscreenBtn  = document.getElementById('fs-btn-fullscreen');
  const fsFullscreenIcon = document.getElementById('fs-fullscreen-icon');
  const ICON_EXPAND   = `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`;
  const ICON_COLLAPSE = `<path d="M8 3v5H3"/><path d="M21 8h-5V3"/><path d="M3 16h5v5"/><path d="M16 21v-5h5"/>`;
  fsFullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fsFullscreenIcon.innerHTML = document.fullscreenElement ? ICON_COLLAPSE : ICON_EXPAND;
  });

  // ── Video tap zone — only fires on .fs-art (the video background layer) ──
  // Tap zones split into thirds:
  //   Single tap (any zone): toggle show/hide controls
  //   Double tap left third:   seek -30 s
  //   Double tap middle third: play/pause
  //   Double tap right third:  seek +30 s
  function handleTap(x) {
    const third = el.clientWidth / 3;
    const zone = x < third ? 'left' : x < third * 2 ? 'mid' : 'right';

    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      if (zone === 'left')       Player.skip(-30);
      else if (zone === 'right') Player.skip(30);
      else                       Player.playPause();
    } else {
      tapTimer = setTimeout(() => {
        tapTimer = null;
        if (el.classList.contains('controls-hidden')) showControls();
        else hideControls();
      }, 220);
    }
  }

  // touchend on .fs-art — fast, no 300 ms delay, no button interference
  fsArtEl.addEventListener('touchend', e => {
    if (!Player.isCurrentVideo()) return;
    e.preventDefault();
    handleTap(e.changedTouches[0].clientX);
  }, { passive: false });

  // click on .fs-art — desktop fallback
  fsArtEl.addEventListener('click', e => {
    if (!Player.isCurrentVideo()) return;
    handleTap(e.clientX);
  });

  // Re-show controls when the seek bar is touched
  el.addEventListener('input', () => { if (Player.isCurrentVideo()) showControls(); });

  return { open, close, isOpen };
})();

export { FullscreenPlayer };
