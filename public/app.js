'use strict';

// ── Remote logging (shows up in docker logs) ──────────────────────────────────
function clog(event, data) {
  try {
    const body = JSON.stringify({ event, data });
    navigator.sendBeacon('/api/clientlog', new Blob([body], { type: 'application/json' }));
  } catch (_) {}
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function enc(p) { return encodeURIComponent(p); }

// ── Icon SVGs ─────────────────────────────────────────────────────────────────
const S = 'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const icons = {
  play:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M5 3.5v17L20 12z"/></svg>`,
  pause:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="5" height="18" rx="2"/><rect x="14" y="3" width="5" height="18" rx="2"/></svg>`,
  prev:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M6 5h2.5v14H6zm2.5 7L19 5v14z"/></svg>`,
  next:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M15.5 5H18v14h-2.5zM5 5l10 7-10 7z"/></svg>`,
  shuffle:   `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  repeat:    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  repeatOne: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">1</text></svg>`,
  close:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="2" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  note:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  folder:    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  check:     `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="2.5" ${S} aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  drag:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg>`,
  menu:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>`,
  grid:      `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  volume:    `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke-width="1.75" ${S} aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  playSmall: `<svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M5 3.5v17L20 12z"/></svg>`,
};

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
    seekto:        d  => { const el = document.getElementById('video').hidden === false ? document.getElementById('video') : document.getElementById('audio'); el.currentTime = d.seekTime; },
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

// ── Player ────────────────────────────────────────────────────────────────────

const Player = (() => {
  const audioEl = document.getElementById('audio');
  const videoEl = document.getElementById('video');
  let med = audioEl;  // currently active media element
  let currentIsVideo = false;

  const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.avi', '.mov', '.mpg', '.mpeg', '.wmv']);
  function isVideoPath(p) {
    const i = p.lastIndexOf('.');
    return i !== -1 && VIDEO_EXTS.has(p.slice(i).toLowerCase());
  }

  // Attach a handler to both elements; fires only when that element is the active one
  function onBoth(event, fn) {
    [audioEl, videoEl].forEach(el => el.addEventListener(event, function(e) {
      if (this !== med) return;
      fn.call(this, e);
    }));
  }

  // Player bar
  const playerBar     = document.getElementById('player-bar');
  const artImg        = document.getElementById('player-art-img');
  const btnPlay       = document.getElementById('btn-play');
  const btnPrev       = document.getElementById('btn-prev');
  const btnNext       = document.getElementById('btn-next');
  const btnShuffle    = document.getElementById('btn-shuffle');
  const btnRepeat     = document.getElementById('btn-repeat');
  const seekBar       = document.getElementById('seek-bar');
  const timeCurrent   = document.getElementById('time-current');
  const timeTotal     = document.getElementById('time-total');
  const volumeBar     = document.getElementById('volume-bar');

  // Fullscreen
  const fsArtImg      = document.getElementById('fs-art-img');
  const fsArtFallback = document.querySelector('.fs-art-fallback');
  const playerArtBtn  = document.getElementById('player-art-btn');
  const fsBtnRotate   = document.getElementById('fs-btn-rotate');
  const fsTitle       = document.getElementById('fs-title');
  const fsArtist      = document.getElementById('fs-artist');
  const fsBtnPlay     = document.getElementById('fs-btn-play');
  const fsBtnPrev     = document.getElementById('fs-btn-prev');
  const fsBtnNext     = document.getElementById('fs-btn-next');
  const fsBtnShuffle  = document.getElementById('fs-btn-shuffle');
  const fsBtnRepeat   = document.getElementById('fs-btn-repeat');
  const fsSeekBar     = document.getElementById('fs-seek-bar');
  const fsTimeCurrent = document.getElementById('fs-time-current');
  const fsTimeTotal   = document.getElementById('fs-time-total');

  let queue         = [];
  let originalQueue = null;   // saved copy when shuffle is on
  let queueIndex    = -1;
  let shuffleMode   = false;
  let repeatMode    = 'off'; // 'off' | 'queue' | 'one'
  let isSeeking     = false;
  let currentPath   = null;

  // ── Persistence ──
  const STORAGE_KEY = 'snap_state';
  let lastSaveAt = 0;
  let lastGoodPosition = 0; // last currentTime > 1s, survives connection resets

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        queue, originalQueue, queueIndex,
        shuffleMode, repeatMode, currentPath,
        position: isFinite(med.currentTime) ? med.currentTime : 0,
      }));
    } catch (_) {}
  }

  // ── Queries ──
  function paused()         { return med.paused; }
  function isActive()       { return queue.length > 0; }
  function getQueue()       { return [...queue]; }
  function getQueueIndex()  { return queueIndex; }
  function getCurrentPath() { return currentPath; }

  // ── UI sync ──
  function syncPlayIcon(playing) {
    btnPlay.innerHTML   = playing ? icons.pause : icons.play;
    fsBtnPlay.innerHTML = playing ? icons.pause : icons.play;
  }

  function syncShuffleIcon() {
    [btnShuffle, fsBtnShuffle].forEach(b => {
      b.classList.toggle('active', shuffleMode);
      b.blur();
    });
  }

  function syncRepeatIcon() {
    const active = repeatMode !== 'off';
    [btnRepeat, fsBtnRepeat].forEach(b => {
      b.classList.toggle('active', active);
      b.innerHTML = repeatMode === 'one' ? icons.repeatOne : icons.repeat;
      b.blur();
    });
  }

  function syncSeek() {
    if (isSeeking) return;
    const pct = isFinite(med.duration) ? (med.currentTime / med.duration) * 100 : 0;
    [seekBar, fsSeekBar].forEach(s => { s.value = pct; });
    const cur = formatTime(med.currentTime);
    timeCurrent.textContent   = cur;
    fsTimeCurrent.textContent = cur;
    if (isFinite(med.duration)) {
      const tot = formatTime(med.duration);
      timeTotal.textContent   = tot;
      fsTimeTotal.textContent = tot;
    }
  }

  function syncArt(path) {
    const url = `/api/artwork?path=${enc(path)}`;
    [artImg, fsArtImg].forEach(img => {
      img.src = url;
      img.onerror = () => { img.src = ''; };
    });
  }

  // ── setMediaMode ──
  function setMediaMode(isVideo) {
    currentIsVideo = isVideo;
    med = isVideo ? videoEl : audioEl;
    if (isVideo) {
      audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();
      fsArtImg.style.display = 'none';
      fsArtFallback.style.display = 'none';
      videoEl.style.display = 'block';
      playerArtBtn.classList.add('video-mode');
      fsBtnRotate.hidden = false;
      document.getElementById('fullscreen-player').classList.add('video-mode');
    } else {
      videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load();
      videoEl.style.display = 'none';
      fsArtImg.style.display = '';
      fsArtFallback.style.display = '';
      playerArtBtn.classList.remove('video-mode');
      fsBtnRotate.hidden = true;
      document.getElementById('fullscreen-player').classList.remove('video-mode');
    }
  }

  // ── Load & play ──
  async function loadTrack(path, play = true) {
    const isVideo = isVideoPath(path);
    if (isVideo !== currentIsVideo) setMediaMode(isVideo);

    playerBar.hidden = false;
    document.body.classList.remove('player-hidden');
    currentPath = path;
    lastGoodPosition = 0; // new track - don't restore old position on play events
    clearTimeout(loadTimeoutTimer); loadTimeoutTimer = null;
    saveState();
    med.src = `/api/stream?path=${enc(path)}`;
    med.load();

    [seekBar, fsSeekBar].forEach(s => { s.value = 0; });
    [timeCurrent, fsTimeCurrent, timeTotal, fsTimeTotal].forEach(t => { t.textContent = '0:00'; });

    const name = path.split('/').pop().replace(/\.[^.]+$/, '');
    fsTitle.textContent  = name;
    fsArtist.textContent = '';

    fetch(`/api/metadata?path=${enc(path)}`)
      .then(r => r.json())
      .then(meta => {
        fsTitle.textContent  = meta.title || name;
        fsArtist.textContent = meta.artist || '';
        if (meta.duration) {
          const tot = formatTime(meta.duration);
          timeTotal.textContent   = tot;
          fsTimeTotal.textContent = tot;
        }
        MediaSessionManager.update({ title: meta.title || name, artist: meta.artist || '', artworkPath: path });
      })
      .catch(() => {
        MediaSessionManager.update({ title: name, artist: '', artworkPath: path });
      });

    if (!currentIsVideo) syncArt(path);
    FileBrowser.setPlaying(path);
    QueuePanel.refresh();

    if (play) {
      try {
        await med.play();
        syncPlayIcon(true);
        WakeLock.acquire();
        if (isVideo) FullscreenPlayer.open();
      } catch (e) { console.warn('Playback failed:', e); }
    }
  }

  // ── Controls ──
  function playPause() {
    if (med.paused) {
      med.play().then(() => { syncPlayIcon(true); WakeLock.acquire(); }).catch(() => {});
    } else {
      med.pause();
      syncPlayIcon(false);
      WakeLock.release();
    }
  }

  function playNext() {
    if (repeatMode === 'one') { med.currentTime = 0; med.play(); return; }
    if (queueIndex < queue.length - 1) {
      queueIndex++;
    } else if (repeatMode === 'queue') {
      queueIndex = 0;
    } else {
      return;
    }
    loadTrack(queue[queueIndex]);
  }

  function playPrev() {
    if (med.currentTime > 3) { med.currentTime = 0; return; }
    if (queueIndex > 0) {
      queueIndex--;
      loadTrack(queue[queueIndex]);
    } else if (repeatMode === 'queue') {
      queueIndex = queue.length - 1;
      loadTrack(queue[queueIndex]);
    } else {
      med.currentTime = 0;
    }
  }

  // ── Queue management ──
  function startQueue(paths, startIndex) {
    queue = [...paths];
    originalQueue = null;
    if (shuffleMode) {
      originalQueue = [...queue];
      doShuffle(startIndex);
    } else {
      queueIndex = startIndex;
    }
    loadTrack(queue[queueIndex]);
  }

  function addToEnd(path) {
    queue.push(path);
    if (originalQueue) originalQueue.push(path);
    QueuePanel.refresh();
    saveState();
  }

  function addAfterCurrent(path) {
    queue.splice(queueIndex + 1, 0, path);
    if (originalQueue) originalQueue.splice(originalQueue.length, 0, path);
    QueuePanel.refresh();
    saveState();
  }

  function jumpTo(index) {
    queueIndex = index;
    loadTrack(queue[queueIndex]);
  }

  // ── Shuffle ──
  function doShuffle(currentIdx) {
    const current = queue[currentIdx];
    const rest = queue.filter((_, i) => i !== currentIdx);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    queue = [current, ...rest];
    queueIndex = 0;
  }

  function toggleShuffle() {
    shuffleMode = !shuffleMode;
    if (shuffleMode) {
      originalQueue = [...queue];
      if (queueIndex >= 0) doShuffle(queueIndex);
    } else if (originalQueue) {
      const cur = queue[queueIndex];
      queue = originalQueue;
      originalQueue = null;
      queueIndex = Math.max(0, queue.indexOf(cur));
    }
    syncShuffleIcon();
    QueuePanel.refresh();
    saveState();
  }

  // ── Repeat ──
  function cycleRepeat() {
    if (repeatMode === 'off')   repeatMode = 'queue';
    else if (repeatMode === 'queue') repeatMode = 'one';
    else                        repeatMode = 'off';
    syncRepeatIcon();
    saveState();
  }

  // ── Event wiring ──
  btnPlay.addEventListener('click', playPause);
  fsBtnPlay.addEventListener('click', playPause);
  btnPrev.addEventListener('click', playPrev);
  fsBtnPrev.addEventListener('click', playPrev);
  btnNext.addEventListener('click', playNext);
  fsBtnNext.addEventListener('click', playNext);
  btnShuffle.addEventListener('click', toggleShuffle);
  fsBtnShuffle.addEventListener('click', toggleShuffle);
  btnRepeat.addEventListener('click', cycleRepeat);
  fsBtnRepeat.addEventListener('click', cycleRepeat);

  onBoth('timeupdate', function() {
    if (med.currentTime > 1) lastGoodPosition = med.currentTime;
    if (med.currentTime > 1 && loadTimeoutTimer) { clearTimeout(loadTimeoutTimer); loadTimeoutTimer = null; }
    syncSeek();
    const now = Date.now();
    if (now - lastSaveAt > 5000) { saveState(); lastSaveAt = now; }
  });
  // Keep lastGoodPosition honest after explicit seeks (including seek-to-0)
  onBoth('seeked', function() { lastGoodPosition = med.currentTime; });
  onBoth('ended', function() {
    syncPlayIcon(false);
    playNext();
    if (med.paused) WakeLock.release();
  });
  onBoth('pause',   function() { syncPlayIcon(false); MediaSessionManager.setPlaying(false); clog('audio:pause',   { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition), hidden: document.hidden }); });
  onBoth('play',    function() { syncPlayIcon(true);  MediaSessionManager.setPlaying(true);  clog('audio:play',    { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition), hidden: document.hidden }); });
  onBoth('stalled', function() { clog('audio:stalled', { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition) }); });
  onBoth('waiting', function() { clog('audio:waiting', { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition) }); });
  audioEl.addEventListener('error',   () => clog('audio:error',   { code: audioEl.error?.code, msg: audioEl.error?.message, t: Math.round(audioEl.currentTime) }));

  // Reconnect if the stream drops (e.g. phone locked, NAS timeout, Android throttling)
  let stallTimer = null;
  let lastStallTime = -1;
  let loadTimeoutTimer = null;

  function doReconnect(pos) {
    if (med !== audioEl) return;
    clearInterval(stallTimer);
    clearTimeout(loadTimeoutTimer);
    stallTimer = null;
    loadTimeoutTimer = null;
    clog('reconnect', { pos: Math.round(pos), lgp: Math.round(lastGoodPosition), hidden: document.hidden });
    if (pos > 0) audioEl.addEventListener('loadedmetadata', () => { audioEl.currentTime = pos; }, { once: true });
    // audioEl.load() aborts the existing HTTP request and frees the browser's
    // connection slot before we open a fresh one — without it, rapid reconnects
    // exhaust all 6 HTTP/1.1 slots and every subsequent request stalls immediately.
    audioEl.load();
    audioEl.play().catch(() => {
      // play() rejected while screen is off — retry when screen wakes
      if (document.hidden) {
        document.addEventListener('visibilitychange', function retryPlay() {
          if (!document.hidden) {
            document.removeEventListener('visibilitychange', retryPlay);
            audioEl.play().catch(() => {});
          }
        });
      }
    });
    // If audio doesn't advance past 1 s within 20 s, the reconnect itself stalled
    loadTimeoutTimer = setTimeout(() => {
      loadTimeoutTimer = null;
      if (currentPath && !audioEl.paused && audioEl.currentTime < 1) {
        clog('reconnect:timeout', { lgp: Math.round(lastGoodPosition) });
        doReconnect(lastGoodPosition);
      }
    }, 20000);
  }

  function startStallWatch() {
    if (med !== audioEl) return;
    clearInterval(stallTimer);
    lastStallTime = audioEl.currentTime;
    stallTimer = setInterval(() => {
      if (audioEl.paused || !currentPath || isSeeking) { lastStallTime = audioEl.currentTime; return; }
      if (isFinite(audioEl.duration) && audioEl.currentTime >= audioEl.duration - 0.5) return;
      // Require currentTime > 0 to avoid triggering during the loading phase after a
      // fresh reconnect (the element sits at t=0 while buffering the new response).
      if (audioEl.currentTime > 0 && audioEl.currentTime === lastStallTime) {
        if (document.hidden) {
          // The stream is still TCP-alive but Firefox throttles background media
          // downloads while the screen is locked. Reconnecting just aborts a good
          // stream and opens a new one Firefox won't buffer either. Skip it — the
          // visibilitychange handler will reconnect if the stream doesn't resume
          // naturally when the screen turns on.
          clog('stall:hidden-skip', { t: Math.round(audioEl.currentTime), lgp: Math.round(lastGoodPosition) });
          return;
        }
        const pos = audioEl.currentTime > 1 ? audioEl.currentTime : lastGoodPosition;
        clog('stall:reconnect', { t: Math.round(audioEl.currentTime), pos: Math.round(pos), lgp: Math.round(lastGoodPosition), hidden: document.hidden });
        doReconnect(pos);
      } else {
        lastStallTime = audioEl.currentTime;
      }
    }, 4000);
  }
  audioEl.addEventListener('play',  startStallWatch);
  audioEl.addEventListener('pause', () => {
    clearInterval(stallTimer);
    clearTimeout(loadTimeoutTimer);
    loadTimeoutTimer = null;
  });

  // Reload from saved position on network errors (connection dropped by router)
  audioEl.addEventListener('error', () => {
    if (!currentPath) return;
    const code = audioEl.error && audioEl.error.code;
    clog('error:handler', { code, t: Math.round(audioEl.currentTime), lgp: Math.round(lastGoodPosition) });
    if (code !== 2 && code !== 3) return; // MEDIA_ERR_NETWORK or MEDIA_ERR_DECODE only
    doReconnect(audioEl.currentTime > 1 ? audioEl.currentTime : lastGoodPosition);
  });

  // Tick MediaSession position so the OS lock screen scrubber stays accurate
  setInterval(() => {
    if (!med.paused) MediaSessionManager.setPosition(med.currentTime, med.duration, med.playbackRate);
  }, 1000);

  function setupSeekBar(bar, localTimeEl) {
    bar.addEventListener('mousedown', () => { isSeeking = true; });
    bar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
    bar.addEventListener('input', () => {
      if (!isFinite(med.duration)) return;
      const t = (bar.value / 100) * med.duration;
      const str = formatTime(t);
      timeCurrent.textContent   = str;
      fsTimeCurrent.textContent = str;
      [seekBar, fsSeekBar].forEach(s => { s.value = bar.value; });
    });
    bar.addEventListener('change', () => {
      if (isFinite(med.duration)) med.currentTime = (bar.value / 100) * med.duration;
      isSeeking = false;
    });
  }
  setupSeekBar(seekBar, timeCurrent);
  setupSeekBar(fsSeekBar, fsTimeCurrent);

  volumeBar.addEventListener('input', () => { med.volume = volumeBar.value; });

  // Art thumbnail → fullscreen
  document.getElementById('player-art-btn').addEventListener('click', () => {
    if (currentPath) FullscreenPlayer.open();
  });

  // Queue view button
  document.getElementById('btn-queue-view').addEventListener('click', () => QueuePanel.open());

  // Fullscreen → queue
  document.getElementById('fs-btn-queue').addEventListener('click', () => {
    FullscreenPlayer.close();
    QueuePanel.open();
  });

  // Skip ±30s
  document.getElementById('fs-btn-skip-back').addEventListener('click', () => {
    med.currentTime = Math.max(0, med.currentTime - 30);
  });
  document.getElementById('fs-btn-skip-fwd').addEventListener('click', () => {
    if (isFinite(med.duration)) med.currentTime = Math.min(med.duration, med.currentTime + 30);
    else med.currentTime += 30;
  });

  // ── Restore persisted state on page load ──
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s.currentPath || !Array.isArray(s.queue) || s.queue.length === 0) return;

      queue         = s.queue;
      originalQueue = s.originalQueue || null;
      queueIndex    = s.queueIndex    ?? -1;
      shuffleMode   = s.shuffleMode   || false;
      repeatMode    = s.repeatMode    || 'off';
      currentPath   = s.currentPath;

      syncShuffleIcon();
      syncRepeatIcon();

      const savedPos = s.position || 0;
      const restoreIsVideo = isVideoPath(currentPath);
      if (restoreIsVideo !== currentIsVideo) setMediaMode(restoreIsVideo);
      med.src = `/api/stream?path=${enc(currentPath)}`;
      med.load();

      if (savedPos > 0) {
        med.addEventListener('loadedmetadata', () => {
          med.currentTime = savedPos;
          syncSeek();
        }, { once: true });
      }

      if (!currentIsVideo) syncArt(currentPath);

      const name = currentPath.split('/').pop().replace(/\.[^.]+$/, '');
      fsTitle.textContent  = name;
      fsArtist.textContent = '';

      fetch(`/api/metadata?path=${enc(currentPath)}`)
        .then(r => r.json())
        .then(meta => {
          fsTitle.textContent  = meta.title || name;
          fsArtist.textContent = meta.artist || '';
          if (meta.duration) {
            const tot = formatTime(meta.duration);
            timeTotal.textContent   = tot;
            fsTimeTotal.textContent = tot;
          }
          MediaSessionManager.update({ title: meta.title || name, artist: meta.artist || '', artworkPath: currentPath });
        })
        .catch(() => {
          MediaSessionManager.update({ title: name, artist: '', artworkPath: currentPath });
        });

      FileBrowser.setPlaying(currentPath);
      QueuePanel.refresh();
      playerBar.hidden = false;
      document.body.classList.remove('player-hidden');
    } catch (_) {}
  }

  function clear() {
    audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load();
    videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load();
    if (currentIsVideo) setMediaMode(false);
    queue = [];
    originalQueue = null;
    queueIndex = -1;
    currentPath = null;

    syncPlayIcon(false);
    artImg.src = '';
    fsArtImg.src = '';
    [seekBar, fsSeekBar].forEach(s => { s.value = 0; });
    [timeCurrent, fsTimeCurrent, timeTotal, fsTimeTotal].forEach(t => { t.textContent = '0:00'; });
    fsTitle.textContent = '';
    fsArtist.textContent = '';

    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}

    FileBrowser.setPlaying(null);
    QueuePanel.refresh();
    WakeLock.release();
    FullscreenPlayer.close();

    playerBar.hidden = true;
    document.body.classList.add('player-hidden');
  }

  document.getElementById('btn-clear').addEventListener('click', clear);

  function removeFromQueue(idx) {
    if (idx === queueIndex) return;
    const path = queue[idx];
    queue.splice(idx, 1);
    if (originalQueue) {
      const oi = originalQueue.indexOf(path);
      if (oi !== -1) originalQueue.splice(oi, 1);
    }
    if (idx < queueIndex) queueIndex--;
    saveState();
    QueuePanel.refresh();
  }

  function reorderQueue(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx === queueIndex) return;
    const [item] = queue.splice(fromIdx, 1);
    queue.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, item);
    queueIndex = currentPath ? queue.indexOf(currentPath) : queueIndex;
    originalQueue = queue.slice();
    saveState();
    QueuePanel.refresh();
  }

  let wifiKeepAlive = null;
  let bufferMonitor = null;
  document.addEventListener('visibilitychange', () => {
    clog('visibility', { hidden: document.hidden, paused: med.paused, t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition) });
    if (document.hidden) {
      if (!med.paused) {
        // Log fetch success/fail to prove network access works while locked
        wifiKeepAlive = setInterval(() => {
          fetch('/api/browse?path=', { signal: AbortSignal.timeout(5000) })
            .then(() => clog('keepalive:ok'))
            .catch(() => clog('keepalive:fail'));
        }, 15000);
        // Log Firefox's audio buffer state every 10s to see how much it buffered
        bufferMonitor = setInterval(() => {
          if (med.paused || !currentPath) return;
          const buf = med.buffered;
          const end = buf.length > 0 ? buf.end(buf.length - 1) : med.currentTime;
          clog('buffer', { t: Math.round(med.currentTime), end: Math.round(end), ahead: Math.round(end - med.currentTime) });
        }, 10000);
      }
    } else {
      clearInterval(wifiKeepAlive);
      clearInterval(bufferMonitor);
      wifiKeepAlive = null;
      bufferMonitor = null;

      // When the screen turns on, Firefox resumes buffering the paused stream.
      // Give it 2 seconds to advance on its own before deciding it needs a reconnect.
      if (!med.paused && currentPath) {
        const posAtWake = med.currentTime;
        setTimeout(() => {
          if (!med.paused && med.currentTime === posAtWake) {
            // Still frozen — stream must have actually died while locked
            clog('wake:reconnect', { pos: Math.round(posAtWake), lgp: Math.round(lastGoodPosition) });
            doReconnect(posAtWake > 1 ? posAtWake : lastGoodPosition);
          } else {
            clog('wake:ok', { t: Math.round(med.currentTime) });
          }
        }, 2000);
      }
    }
  });
  audioEl.addEventListener('pause', () => { clearInterval(wifiKeepAlive); clearInterval(bufferMonitor); wifiKeepAlive = null; bufferMonitor = null; });

  // When the browser resets the audio element to position 0 after a dropped
  // connection and then auto-resumes (the "started from the beginning" bug),
  // lastGoodPosition holds the last real position and we jump back to it.
  // This fires only when currentTime < 1 AND we had been > 1s into the track.
  audioEl.addEventListener('play', () => {
    if (audioEl.currentTime < 1 && lastGoodPosition > 1) {
      clog('play:restore', { lgp: Math.round(lastGoodPosition) });
      if (audioEl.readyState >= 1) {
        audioEl.currentTime = lastGoodPosition;
      } else {
        audioEl.addEventListener('loadedmetadata', () => { audioEl.currentTime = lastGoodPosition; }, { once: true });
      }
    }
  });

  return {
    paused, isActive, getCurrentPath, getQueue, getQueueIndex,
    startQueue, addToEnd, addAfterCurrent, jumpTo,
    playPause, playNext, playPrev, restore, removeFromQueue, reorderQueue,
    isCurrentVideo: () => currentIsVideo,
    skip: (secs) => { med.currentTime = Math.max(0, Math.min(isFinite(med.duration) ? med.duration : Infinity, med.currentTime + secs)); },
  };
})();

// ── Queue Action Modal ────────────────────────────────────────────────────────

const QueueModal = (() => {
  const overlay    = document.getElementById('queue-modal');
  const trackName  = document.getElementById('modal-track-name');
  const btnPlayNow = document.getElementById('qm-play-now');
  const btnNext    = document.getElementById('qm-play-next');
  const btnAddEnd  = document.getElementById('qm-add-end');
  const btnCancel  = document.getElementById('qm-cancel');

  // paths: array of paths to queue. startIdx: which to start at.
  // For single file: paths=[file], startIdx=0.
  // For play-all: paths=allFiles, startIdx=0.
  let pendingPaths = [];
  let pendingIdx   = 0;
  // The "add next/add end" target is always pendingPaths[pendingIdx]
  function pendingPath() { return pendingPaths[pendingIdx]; }

  function show(title, paths, startIdx) {
    pendingPaths = paths;
    pendingIdx   = startIdx;
    trackName.textContent = title;
    overlay.hidden = false;
  }

  function hide() { overlay.hidden = true; }

  btnPlayNow.addEventListener('click', () => {
    Player.startQueue(pendingPaths, pendingIdx);
    hide();
  });

  btnNext.addEventListener('click', () => {
    // For multi-file (play all) add all after current; for single just add one
    if (pendingPaths.length > 1) {
      pendingPaths.forEach(p => Player.addToEnd(p));
    } else {
      Player.addAfterCurrent(pendingPath());
    }
    hide();
  });

  btnAddEnd.addEventListener('click', () => {
    pendingPaths.forEach(p => Player.addToEnd(p));
    hide();
  });

  btnCancel.addEventListener('click', hide);
  overlay.addEventListener('click', e => { if (e.target === overlay) hide(); });

  return { show };
})();

// ── Queue Panel ───────────────────────────────────────────────────────────────

const QueuePanel = (() => {
  const panel    = document.getElementById('queue-panel');
  const listEl   = document.getElementById('queue-list');
  const closeBtn = document.getElementById('queue-close');

  let dragFromIdx     = null;
  let insertBeforeIdx = null;

  function clearDropIndicators() {
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  function setupDragHandle(handle, fromIdx) {
    handle.addEventListener('pointerdown', e => {
      if (e.button > 1) return;
      e.preventDefault();
      e.stopPropagation();
      dragFromIdx     = fromIdx;
      insertBeforeIdx = null;
      handle.setPointerCapture(e.pointerId);
      handle.closest('.queue-item').classList.add('queue-dragging');
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onCancel);
    });
    handle.addEventListener('click', e => e.stopPropagation());

    function onMove(e) {
      const qIdx = Player.getQueueIndex();
      const minInsert = qIdx + 1;
      clearDropIndicators();
      const items = Array.from(listEl.querySelectorAll('.queue-item'));
      let placed = false;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          const clamped = Math.max(i, minInsert);
          if (items[clamped]) items[clamped].classList.add('drop-before');
          insertBeforeIdx = clamped;
          placed = true;
          break;
        }
      }
      if (!placed) {
        if (items.length) items[items.length - 1].classList.add('drop-after');
        insertBeforeIdx = items.length;
      }
    }

    function onUp() {
      if (dragFromIdx !== null && insertBeforeIdx !== null)
        Player.reorderQueue(dragFromIdx, insertBeforeIdx);
      cleanup();
    }

    function onCancel() { cleanup(); }

    function cleanup() {
      const el = listEl.querySelector('.queue-dragging');
      if (el) el.classList.remove('queue-dragging');
      clearDropIndicators();
      dragFromIdx     = null;
      insertBeforeIdx = null;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
    }
  }

  function open()  { panel.hidden = false; refresh(); }
  function close() { panel.hidden = true; }

  function refresh() {
    if (panel.hidden) return;
    const q   = Player.getQueue();
    const idx = Player.getQueueIndex();
    listEl.innerHTML = '';

    if (q.length === 0) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">Queue is empty</div>';
      return;
    }

    q.forEach((path, i) => {
      const isCurrent = i === idx;
      const item = document.createElement('div');
      item.className = 'queue-item' + (isCurrent ? ' current' : '');

      const canDrag = i > idx;
      const handle = document.createElement('span');
      handle.className = 'queue-drag-handle' + (!canDrag ? ' queue-drag-handle--disabled' : '');
      handle.innerHTML = icons.drag;
      if (canDrag) setupDragHandle(handle, i);

      const num = document.createElement('span');
      num.className = 'queue-item-num';
      if (isCurrent) num.innerHTML = icons.playSmall;
      else num.textContent = i + 1;

      const thumb = document.createElement('div');
      thumb.className = 'queue-item-thumb';
      thumb.innerHTML = icons.note;
      const tImg = document.createElement('img');
      tImg.src = `/api/artwork?path=${enc(path)}`;
      tImg.onload = () => { thumb.textContent = ''; thumb.appendChild(tImg); };
      tImg.onerror = () => {};

      const name = document.createElement('span');
      name.className = 'queue-item-name';
      name.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-item-remove';
      removeBtn.innerHTML = icons.close;
      removeBtn.title = 'Remove from queue';
      if (isCurrent) {
        removeBtn.disabled = true;
      } else {
        removeBtn.addEventListener('click', e => { e.stopPropagation(); Player.removeFromQueue(i); });
      }

      item.append(handle, num, thumb, name, removeBtn);
      item.addEventListener('click', () => { Player.jumpTo(i); close(); });
      listEl.appendChild(item);
    });

    const cur = listEl.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  closeBtn.addEventListener('click', close);
  return { open, close, refresh };
})();

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
      showControls();
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

// ── View Toggle ───────────────────────────────────────────────────────────────

const ViewToggle = (() => {
  const PREF_KEY = 'snap_view';
  let current = localStorage.getItem(PREF_KEY) || 'list';

  const btnList = document.getElementById('btn-list');
  const btnGrid = document.getElementById('btn-grid');

  function setView(v) {
    current = v;
    localStorage.setItem(PREF_KEY, v);
    btnList.classList.toggle('active', v === 'list');
    btnGrid.classList.toggle('active', v === 'grid');
    FileBrowser.refresh();
  }

  btnList.addEventListener('click', () => setView('list'));
  btnGrid.addEventListener('click', () => setView('grid'));

  btnList.classList.toggle('active', current === 'list');
  btnGrid.classList.toggle('active', current === 'grid');

  function get() { return current; }
  return { get };
})();

// ── File Browser ──────────────────────────────────────────────────────────────

const FileBrowser = (() => {
  const browserEl    = document.getElementById('browser');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const searchEl     = document.getElementById('search');
  const selectBar    = document.getElementById('select-bar');
  const selectCount  = document.getElementById('select-count');
  const selectPlayNow  = document.getElementById('select-play-now');
  const selectAddQueue = document.getElementById('select-add-queue');
  const selectCancel   = document.getElementById('select-cancel');

  let currentPath  = '';
  let currentItems = [];
  let playingPath  = '';
  let searchQuery  = '';
  let sortKey = localStorage.getItem('snap_sort_key') || 'name';
  let sortDir = localStorage.getItem('snap_sort_dir') || 'asc';

  const durationObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      durationObserver.unobserve(el);
      fetchDuration(el.dataset.durPath).then(d => { if (d) el.textContent = formatTime(d); });
    }
  }, { rootMargin: '200px' });

  const artworkObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const thumb = entry.target;
      artworkObserver.unobserve(thumb);
      const img = document.createElement('img');
      img.src = `/api/artwork?path=${enc(thumb.dataset.artPath)}`;
      img.onload = () => { thumb.textContent = ''; thumb.appendChild(img); };
      img.onerror = () => {};
    }
  }, { rootMargin: '400px' });

  // Multi-select state
  let selectMode    = false;
  let selectedPaths = new Set();

  // ── Multi-select bar ──
  function enterSelectMode(path) {
    selectMode = true;
    selectedPaths = new Set([path]);
    selectBar.hidden = false;
    updateSelectCount();
    render();
  }

  function exitSelectMode() {
    selectMode = false;
    selectedPaths.clear();
    selectBar.hidden = true;
    render();
  }

  function updateSelectCount() {
    selectCount.textContent = `${selectedPaths.size} selected`;
  }

  selectPlayNow.addEventListener('click', () => {
    const paths = [...selectedPaths];
    if (paths.length === 0) return;
    Player.startQueue(paths, 0);
    exitSelectMode();
  });

  selectAddQueue.addEventListener('click', () => {
    [...selectedPaths].forEach(p => Player.addToEnd(p));
    exitSelectMode();
  });

  selectCancel.addEventListener('click', exitSelectMode);

  // ── Long press detection ──
  function addLongPress(el, onLong, onClick) {
    let timer  = null;
    let didLong = false;
    let moved   = false;

    const start = () => {
      didLong = false;
      moved   = false;
      timer = setTimeout(() => {
        didLong = true;
        onLong();
      }, 500);
    };

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    let wasTouch = false;

    el.addEventListener('touchstart', () => { wasTouch = true; start(); }, { passive: true });
    el.addEventListener('touchmove', () => { moved = true; cancel(); }, { passive: true });
    el.addEventListener('touchend', e => {
      cancel();
      if (!didLong && !moved) {
        e.preventDefault(); // suppress synthetic mousedown/click that would double-fire
        onClick(e);
      }
      // reset wasTouch after a frame so the click guard below doesn't persist
      setTimeout(() => { wasTouch = false; }, 600);
    });

    // Mouse fallback for desktop (skip if touch already handled it)
    el.addEventListener('mousedown', () => { if (!wasTouch) start(); });
    el.addEventListener('mouseup',   () => { if (!wasTouch) cancel(); });
    el.addEventListener('mouseleave',() => { if (!wasTouch) cancel(); });
    el.addEventListener('click', e => {
      if (wasTouch) return; // already handled by touchend
      if (!didLong) onClick(e);
      didLong = false;
    });
  }

  // ── Sorting ──
  function applySort(items) {
    const dirs  = items.filter(i => i.type === 'dir');
    const files = items.filter(i => i.type === 'file');
    const cmp = (a, b) => {
      if (sortKey === 'name') {
        const r = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        return sortDir === 'asc' ? r : -r;
      }
      if (sortKey === 'date') {
        const r = (a.mtime || 0) - (b.mtime || 0);
        return sortDir === 'asc' ? r : -r;
      }
      // size — dirs fall back to name
      const r = ((a.size || 0) - (b.size || 0)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return sortDir === 'asc' ? r : -r;
    };
    return [...dirs.sort(cmp), ...files.sort(cmp)];
  }

  // ── Navigation ──
  function navigate(p, push = true) {
    if (selectMode) exitSelectMode();
    if (push) history.pushState({ type: 'browse', path: p }, '');
    currentPath  = p;
    searchEl.value = '';
    searchQuery  = '';
    load();
  }

  async function load() {
    browserEl.innerHTML = '<div class="browser-empty">Loading…</div>';
    renderBreadcrumb();

    let data;
    try {
      const res = await fetch(`/api/browse?path=${enc(currentPath)}`);
      if (!res.ok) throw new Error(res.statusText);
      data = await res.json();
    } catch (e) {
      browserEl.innerHTML = `<div class="browser-empty">Error: ${e.message}</div>`;
      return;
    }

    currentItems = data.items;
    render();
  }

  function refresh() { render(); }

  function render() {
    let items = currentItems;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q));
    }
    if (items.length === 0) {
      browserEl.innerHTML = '<div class="browser-empty">No files found</div>';
      return;
    }

    items = applySort(items);

    const frag = document.createDocumentFragment();

    // Sort bar
    const sortBar = document.createElement('div');
    sortBar.className = 'sort-bar';
    for (const { key, label } of [{ key: 'name', label: 'Name' }, { key: 'date', label: 'Date' }, { key: 'size', label: 'Size' }]) {
      const btn = document.createElement('button');
      const isActive = sortKey === key;
      btn.className = 'sort-btn' + (isActive ? ' active' : '');
      btn.textContent = label + (isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
      btn.addEventListener('click', () => {
        if (sortKey === key) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          sortDir = key === 'date' || key === 'size' ? 'desc' : 'asc';
        }
        localStorage.setItem('snap_sort_key', sortKey);
        localStorage.setItem('snap_sort_dir', sortDir);
        render();
      });
      sortBar.appendChild(btn);
    }
    frag.appendChild(sortBar);

    // Play all / folder actions header (only when there are audio files)
    const audioFiles = items.filter(i => i.type === 'file');
    if (audioFiles.length > 0 && !selectMode) {
      const header = document.createElement('div');
      header.className = 'folder-actions';

      const label = document.createElement('span');
      label.className = 'folder-actions-label';
      label.textContent = `${audioFiles.length} song${audioFiles.length !== 1 ? 's' : ''}`;

      const playAll = document.createElement('button');
      playAll.className = 'play-all-btn';
      playAll.innerHTML = icons.play + ' Play all';
      playAll.addEventListener('click', () => {
        const paths = audioFiles.map(f => f.path);
        if (Player.isActive()) {
          QueueModal.show(`${audioFiles.length} songs in folder`, paths, 0);
        } else {
          Player.startQueue(paths, 0);
        }
      });

      header.append(label, playAll);
      frag.appendChild(header);
    }

    const container = document.createElement('div');
    if (ViewToggle.get() === 'grid') {
      container.className = 'grid-view';
      for (const item of items) container.appendChild(makeGridItem(item));
    } else {
      container.className = 'list-view';
      for (const item of items) container.appendChild(makeListItem(item));
    }
    frag.appendChild(container);

    browserEl.innerHTML = '';
    browserEl.appendChild(frag);
  }

  function onFileClick(item) {
    if (selectMode) {
      // Toggle selection
      if (selectedPaths.has(item.path)) {
        selectedPaths.delete(item.path);
        if (selectedPaths.size === 0) { exitSelectMode(); return; }
      } else {
        selectedPaths.add(item.path);
      }
      updateSelectCount();
      render();
      return;
    }

    // Normal click: single file only
    if (Player.isActive()) {
      const displayName = item.name.replace(/\.[^.]+$/, '');
      QueueModal.show(displayName, [item.path], 0);
    } else {
      Player.startQueue([item.path], 0);
    }
  }

  function makeListItem(item) {
    const el = document.createElement('div');
    el.className = 'list-item' +
      (item.name.startsWith('.') ? ' hidden-entry' : '') +
      (item.path === playingPath ? ' playing' : '') +
      (selectMode && selectedPaths.has(item.path) ? ' selected' : '');

    if (selectMode && item.type === 'file') {
      const chk = document.createElement('span');
      chk.className = 'select-check';
      chk.innerHTML = selectedPaths.has(item.path) ? icons.check : '';
      el.appendChild(chk);
    } else {
      const icon = document.createElement('span');
      icon.className = 'list-icon';
      icon.innerHTML = item.type === 'dir' ? icons.folder : icons.note;
      el.appendChild(icon);
    }

    const name = document.createElement('span');
    name.className = 'list-name';
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'list-meta';

    if (item.type === 'file') {
      const dur = document.createElement('span');
      dur.textContent = '—';
      dur.dataset.durPath = item.path;
      durationObserver.observe(dur);
      const sz = document.createElement('span');
      sz.textContent = item.size ? formatSize(item.size) : '';
      meta.append(dur, sz);
    }

    el.append(name, meta);

    if (item.type === 'dir') {
      el.addEventListener('click', () => navigate(item.path));
    } else {
      addLongPress(
        el,
        () => { // long press
          if (!selectMode) enterSelectMode(item.path);
          else { selectedPaths.add(item.path); updateSelectCount(); render(); }
        },
        () => onFileClick(item) // normal click
      );
    }

    return el;
  }

  function makeGridItem(item) {
    const el = document.createElement('div');
    el.className = 'grid-item' +
      (item.name.startsWith('.') ? ' hidden-entry' : '') +
      (item.path === playingPath ? ' playing' : '') +
      (selectMode && selectedPaths.has(item.path) ? ' selected' : '');

    const thumb = document.createElement('div');
    thumb.className = 'grid-thumb';
    thumb.innerHTML = item.type === 'dir' ? icons.folder : icons.note;

    if (selectMode && item.type === 'file') {
      const overlay = document.createElement('div');
      overlay.className = 'grid-select-overlay';
      overlay.innerHTML = selectedPaths.has(item.path) ? icons.check : '';
      thumb.appendChild(overlay);
    } else if (item.type === 'file') {
      thumb.dataset.artPath = item.path;
      artworkObserver.observe(thumb);
    }

    const name = document.createElement('span');
    name.className = 'grid-name';
    name.textContent = item.name;

    el.append(thumb, name);

    if (item.type === 'dir') {
      el.addEventListener('click', () => navigate(item.path));
    } else {
      addLongPress(
        el,
        () => {
          if (!selectMode) enterSelectMode(item.path);
          else { selectedPaths.add(item.path); updateSelectCount(); render(); }
        },
        () => onFileClick(item)
      );
    }

    return el;
  }

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';

    const home = document.createElement('button');
    home.className = 'crumb' + (currentPath === '' ? ' active' : '');
    home.textContent = 'Home';
    home.addEventListener('click', () => navigate(''));
    breadcrumbEl.appendChild(home);

    if (currentPath) {
      const parts = currentPath.split('/').filter(Boolean);
      parts.forEach((part, i) => {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = ' / ';
        breadcrumbEl.appendChild(sep);

        const crumb = document.createElement('button');
        const isLast = i === parts.length - 1;
        crumb.className = 'crumb' + (isLast ? ' active' : '');
        crumb.textContent = part;
        if (!isLast) {
          const crumbPath = parts.slice(0, i + 1).join('/');
          crumb.addEventListener('click', () => navigate(crumbPath));
        }
        breadcrumbEl.appendChild(crumb);
      });
    }
  }

  function setPlaying(filePath) {
    playingPath = filePath;
    render();
  }

  const durCache = new Map();
  async function fetchDuration(filePath) {
    if (durCache.has(filePath)) return durCache.get(filePath);
    try {
      const res = await fetch(`/api/metadata?path=${enc(filePath)}`);
      const meta = await res.json();
      durCache.set(filePath, meta.duration);
      return meta.duration;
    } catch { return null; }
  }

  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value.trim();
    render();
  });

  history.replaceState({ type: 'browse', path: '' }, '');
  load();

  function reload() { load(); }

  return { navigate, setPlaying, refresh, reload };
})();

// Keep --player-h in sync with the actual rendered player bar height
new ResizeObserver(entries => {
  const h = entries[0].target.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--player-h', h + 'px');
}).observe(document.getElementById('player-bar'));

// Restore queue + position after all modules are initialised
Player.restore();
if (!Player.isActive()) document.body.classList.add('player-hidden');

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
  const state = e.state;
  if (!state) return;
  if (FullscreenPlayer.isOpen()) {
    FullscreenPlayer.close();
  } else if (state.type === 'browse') {
    FileBrowser.navigate(state.path, false);
  }
});
