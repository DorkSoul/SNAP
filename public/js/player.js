'use strict';

import { clog, formatTime, enc, icons } from './utils.js';

// Forward references resolved at call time (these modules are loaded in main.js before Player runs)
// MediaSessionManager, WakeLock, FileBrowser, QueuePanel, FullscreenPlayer are globals set by main.js
// To avoid circular imports they are accessed via window or a registry pattern.
// We use a simple deferred-reference approach: functions that call them look them up lazily.

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
  let _pendingRestorePosition = 0; // position to seek to on first play after restore

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
      // Clear the handler before clearing src — assigning src can itself fire
      // another error event, which would loop.
      img.onerror = () => { img.onerror = null; img.removeAttribute('src'); };
    });
  }

  // ── setMediaMode ──
  function setMediaMode(isVideo) {
    const vol = med.volume;
    currentIsVideo = isVideo;
    med = isVideo ? videoEl : audioEl;
    med.volume = vol; // carry the volume slider setting across audio↔video
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
        window._MediaSessionManager && window._MediaSessionManager.update({ title: meta.title || name, artist: meta.artist || '', artworkPath: path });
      })
      .catch(() => {
        window._MediaSessionManager && window._MediaSessionManager.update({ title: name, artist: '', artworkPath: path });
      });

    if (!currentIsVideo) syncArt(path);
    window._FileBrowser && window._FileBrowser.setPlaying(path);
    window._QueuePanel && window._QueuePanel.refresh();

    if (play) {
      try {
        await med.play();
        syncPlayIcon(true);
        window._WakeLock && window._WakeLock.acquire();
        if (isVideo) window._FullscreenPlayer && window._FullscreenPlayer.open();
      } catch (e) { console.warn('Playback failed:', e); }
    }
  }

  // ── Controls ──
  function playPause() {
    if (med.paused) {
      if (!med.src && currentPath) {
        // First play after page restore — load the track then seek to saved position
        const pos = _pendingRestorePosition;
        _pendingRestorePosition = 0;
        loadTrack(currentPath, false).then(() => {
          const doPlay = () => med.play().then(() => { syncPlayIcon(true); window._WakeLock && window._WakeLock.acquire(); }).catch(() => {});
          if (pos > 0) {
            if (med.readyState >= 1) { med.currentTime = pos; syncSeek(); doPlay(); }
            else med.addEventListener('loadedmetadata', () => { med.currentTime = pos; syncSeek(); doPlay(); }, { once: true });
          } else {
            doPlay();
          }
        });
      } else {
        med.play().then(() => { syncPlayIcon(true); window._WakeLock && window._WakeLock.acquire(); }).catch(() => {});
      }
    } else {
      med.pause();
      syncPlayIcon(false);
      window._WakeLock && window._WakeLock.release();
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
    window._QueuePanel && window._QueuePanel.refresh();
    saveState();
  }

  function addAfterCurrent(pathOrPaths) {
    const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
    queue.splice(queueIndex + 1, 0, ...paths);
    if (originalQueue) originalQueue.push(...paths);
    window._QueuePanel && window._QueuePanel.refresh();
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
    window._QueuePanel && window._QueuePanel.refresh();
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
    if (med.paused) window._WakeLock && window._WakeLock.release();
  });
  onBoth('pause',   function() { syncPlayIcon(false); window._MediaSessionManager && window._MediaSessionManager.setPlaying(false); clog('audio:pause',   { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition), hidden: document.hidden }); });
  onBoth('play',    function() { syncPlayIcon(true);  window._MediaSessionManager && window._MediaSessionManager.setPlaying(true);  clog('audio:play',    { t: Math.round(med.currentTime), lgp: Math.round(lastGoodPosition), hidden: document.hidden }); });
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
    if (!med.paused) window._MediaSessionManager && window._MediaSessionManager.setPosition(med.currentTime, med.duration, med.playbackRate);
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
    if (currentPath) window._FullscreenPlayer && window._FullscreenPlayer.open();
  });

  // Queue view button
  document.getElementById('btn-queue-view').addEventListener('click', () => window._QueuePanel && window._QueuePanel.open());

  // Fullscreen → queue
  document.getElementById('fs-btn-queue').addEventListener('click', () => {
    window._FullscreenPlayer && window._FullscreenPlayer.close();
    window._QueuePanel && window._QueuePanel.open();
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

      _pendingRestorePosition = s.position || 0;
      const restoreIsVideo = isVideoPath(currentPath);
      if (restoreIsVideo !== currentIsVideo) setMediaMode(restoreIsVideo);
      // Don't load media src here — deferred to first play to avoid browser "Continue playing" prompt

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
          window._MediaSessionManager && window._MediaSessionManager.update({ title: meta.title || name, artist: meta.artist || '', artworkPath: currentPath });
        })
        .catch(() => {
          window._MediaSessionManager && window._MediaSessionManager.update({ title: name, artist: '', artworkPath: currentPath });
        });

      window._FileBrowser && window._FileBrowser.setPlaying(currentPath);
      window._QueuePanel && window._QueuePanel.refresh();
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

    window._FileBrowser && window._FileBrowser.setPlaying(null);
    window._QueuePanel && window._QueuePanel.refresh();
    window._WakeLock && window._WakeLock.release();
    window._FullscreenPlayer && window._FullscreenPlayer.close();

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
    window._QueuePanel && window._QueuePanel.refresh();
  }

  function reorderQueue(fromIdx, toIdx) {
    if (fromIdx === toIdx || fromIdx === queueIndex) return;
    const [item] = queue.splice(fromIdx, 1);
    const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
    queue.splice(insertAt, 0, item);
    // Track the current item by index arithmetic — indexOf(currentPath) picks
    // the wrong entry when the queue holds duplicates. originalQueue keeps the
    // pre-shuffle order, so a reorder of the shuffled view must not clobber it.
    if (fromIdx < queueIndex && insertAt >= queueIndex) queueIndex--;
    else if (fromIdx > queueIndex && insertAt <= queueIndex) queueIndex++;
    saveState();
    window._QueuePanel && window._QueuePanel.refresh();
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
    isCurrentVideo:  () => currentIsVideo,
    getDuration:     () => isFinite(med.duration) ? med.duration : 0,
    getPosition:     () => isFinite(med.currentTime) ? med.currentTime : 0,
    syncPlayState:   (playing) => syncPlayIcon(playing),
    seekTo: (pos) => {
      if (isFinite(med.duration)) med.currentTime = Math.max(0, Math.min(med.duration, pos));
      else med.currentTime = Math.max(0, pos);
    },
    skip: (secs) => { med.currentTime = Math.max(0, Math.min(isFinite(med.duration) ? med.duration : Infinity, med.currentTime + secs)); },
    syncQueue(paths, idx) {
      if (!Array.isArray(paths) || !paths.length) return;
      queue = [...paths];
      originalQueue = null;
      queueIndex = typeof idx === 'number' ? Math.max(0, Math.min(idx, paths.length - 1)) : 0;
      const path = queue[queueIndex];
      if (path === currentPath) return;
      currentPath = path;
      lastGoodPosition = 0;

      // Non-active device: show artwork display only — never load video or audio stream
      if (currentIsVideo) setMediaMode(false); // switch away from video mode to show art
      syncArt(path);

      const name = path.split('/').pop().replace(/\.[^.]+$/, '');
      fsTitle.textContent  = name;
      fsArtist.textContent = '';
      fetch(`/api/metadata?path=${enc(path)}`)
        .then(r => r.json())
        .then(meta => {
          fsTitle.textContent  = meta.title || name;
          fsArtist.textContent = meta.artist || '';
          window._MediaSessionManager && window._MediaSessionManager.update({ title: meta.title || name, artist: meta.artist || '', artworkPath: path });
        })
        .catch(() => {
          window._MediaSessionManager && window._MediaSessionManager.update({ title: name, artist: '', artworkPath: path });
        });

      window._FileBrowser && window._FileBrowser.setPlaying(path);
      window._QueuePanel && window._QueuePanel.refresh();
      playerBar.hidden = false;
      document.body.classList.remove('player-hidden');
    },
    syncPositionDisplay(pos, totalDur) {
      if (!isFinite(pos) || pos < 0) return;
      const dur = (totalDur > 0 && isFinite(totalDur)) ? totalDur : (isFinite(med.duration) ? med.duration : 0);
      const pct = dur > 0 ? (pos / dur) * 100 : 0;
      if (!isSeeking) [seekBar, fsSeekBar].forEach(s => { s.value = pct; });
      const curStr = formatTime(pos);
      timeCurrent.textContent   = curStr;
      fsTimeCurrent.textContent = curStr;
      if (dur > 0) {
        const totStr = formatTime(dur);
        timeTotal.textContent   = totStr;
        fsTimeTotal.textContent = totStr;
      }
    },
  };
})();

// ── Wire Player.loadState ─────────────────────────────────────────────────────
Player.loadState = function({ queue, index, position }) {
  if (!Array.isArray(queue) || queue.length === 0) return;
  // Use startQueue at the right index and seek to position after metadata loads
  Player.startQueue(queue, typeof index === 'number' ? index : 0);
  if (position && position > 0) {
    // startQueue has already switched the active element for audio vs video
    const el = document.getElementById(Player.isCurrentVideo() ? 'video' : 'audio');
    const seek = () => { el.currentTime = position; };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
  }
};

export { Player };
