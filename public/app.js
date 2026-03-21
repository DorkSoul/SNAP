'use strict';

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
    seekto:        d  => { document.getElementById('audio').currentTime = d.seekTime; },
    seekbackward:  d  => { document.getElementById('audio').currentTime -= (d.seekOffset || 10); },
    seekforward:   d  => { document.getElementById('audio').currentTime += (d.seekOffset || 10); },
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
  const audio = document.getElementById('audio');

  // Player bar
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

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        queue, originalQueue, queueIndex,
        shuffleMode, repeatMode, currentPath,
        position: isFinite(audio.currentTime) ? audio.currentTime : 0,
      }));
    } catch (_) {}
  }

  // ── Queries ──
  function paused()         { return audio.paused; }
  function isActive()       { return queue.length > 0; }
  function getQueue()       { return [...queue]; }
  function getQueueIndex()  { return queueIndex; }
  function getCurrentPath() { return currentPath; }

  // ── UI sync ──
  function syncPlayIcon(playing) {
    const icon = playing ? '\u2759\u2759' : '\u25B6'; // ❙❙ or ▶ — no emoji rendering
    btnPlay.textContent   = icon;
    fsBtnPlay.textContent = icon;
  }

  function syncShuffleIcon() {
    [btnShuffle, fsBtnShuffle].forEach(b => {
      b.classList.toggle('active', shuffleMode);
      b.blur();
    });
  }

  function syncRepeatIcon() {
    const active = repeatMode !== 'off';
    const icon   = repeatMode === 'one' ? '1\u21BB' : '\u21BB';
    [btnRepeat, fsBtnRepeat].forEach(b => {
      b.classList.toggle('active', active);
      b.textContent = icon;
      b.blur();
    });
  }

  function syncSeek() {
    if (isSeeking) return;
    const pct = isFinite(audio.duration) ? (audio.currentTime / audio.duration) * 100 : 0;
    [seekBar, fsSeekBar].forEach(s => { s.value = pct; });
    const cur = formatTime(audio.currentTime);
    timeCurrent.textContent   = cur;
    fsTimeCurrent.textContent = cur;
    if (isFinite(audio.duration)) {
      const tot = formatTime(audio.duration);
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

  // ── Load & play ──
  async function loadTrack(path, play = true) {
    currentPath = path;
    saveState();
    audio.src = `/api/stream?path=${enc(path)}`;
    audio.load();

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

    syncArt(path);
    FileBrowser.setPlaying(path);
    QueuePanel.refresh();

    if (play) {
      try {
        await audio.play();
        syncPlayIcon(true);
        WakeLock.acquire();
      } catch (e) { console.warn('Playback failed:', e); }
    }
  }

  // ── Controls ──
  function playPause() {
    if (audio.paused) {
      audio.play().then(() => { syncPlayIcon(true); WakeLock.acquire(); }).catch(() => {});
    } else {
      audio.pause();
      syncPlayIcon(false);
      WakeLock.release();
    }
  }

  function playNext() {
    if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }
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
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (queueIndex > 0) {
      queueIndex--;
      loadTrack(queue[queueIndex]);
    } else if (repeatMode === 'queue') {
      queueIndex = queue.length - 1;
      loadTrack(queue[queueIndex]);
    } else {
      audio.currentTime = 0;
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

  audio.addEventListener('timeupdate', () => {
    syncSeek();
    const now = Date.now();
    if (now - lastSaveAt > 5000) { saveState(); lastSaveAt = now; }
  });
  audio.addEventListener('ended', () => {
    syncPlayIcon(false);
    playNext();
    if (audio.paused) WakeLock.release();
  });
  audio.addEventListener('pause', () => { syncPlayIcon(false); MediaSessionManager.setPlaying(false); });
  audio.addEventListener('play',  () => { syncPlayIcon(true);  MediaSessionManager.setPlaying(true); });

  // Tick MediaSession position so the OS lock screen scrubber stays accurate
  setInterval(() => {
    if (!audio.paused) MediaSessionManager.setPosition(audio.currentTime, audio.duration, audio.playbackRate);
  }, 1000);

  function setupSeekBar(bar, localTimeEl) {
    bar.addEventListener('mousedown', () => { isSeeking = true; });
    bar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
    bar.addEventListener('input', () => {
      if (!isFinite(audio.duration)) return;
      const t = (bar.value / 100) * audio.duration;
      const str = formatTime(t);
      timeCurrent.textContent   = str;
      fsTimeCurrent.textContent = str;
      [seekBar, fsSeekBar].forEach(s => { s.value = bar.value; });
    });
    bar.addEventListener('change', () => {
      if (isFinite(audio.duration)) audio.currentTime = (bar.value / 100) * audio.duration;
      isSeeking = false;
    });
  }
  setupSeekBar(seekBar, timeCurrent);
  setupSeekBar(fsSeekBar, fsTimeCurrent);

  volumeBar.addEventListener('input', () => { audio.volume = volumeBar.value; });

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
      audio.src = `/api/stream?path=${enc(currentPath)}`;
      audio.load();

      if (savedPos > 0) {
        audio.addEventListener('loadedmetadata', () => {
          audio.currentTime = savedPos;
          syncSeek();
        }, { once: true });
      }

      syncArt(currentPath);

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
    } catch (_) {}
  }

  return {
    paused, isActive, getCurrentPath, getQueue, getQueueIndex,
    startQueue, addToEnd, addAfterCurrent, jumpTo,
    playPause, playNext, playPrev, restore
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
  const panel     = document.getElementById('queue-panel');
  const listEl    = document.getElementById('queue-list');
  const closeBtn  = document.getElementById('queue-close');

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
      const item = document.createElement('div');
      item.className = 'queue-item' + (i === idx ? ' current' : '');

      const num = document.createElement('span');
      num.className = 'queue-item-num';
      if (i !== idx) num.textContent = i + 1;

      const thumb = document.createElement('div');
      thumb.className = 'queue-item-thumb';
      thumb.textContent = '\uD83C\uDFB5';
      const tImg = document.createElement('img');
      tImg.src = `/api/artwork?path=${enc(path)}`;
      tImg.onload = () => { thumb.textContent = ''; thumb.appendChild(tImg); };
      tImg.onerror = () => {};

      const name = document.createElement('span');
      name.className = 'queue-item-name';
      name.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');

      item.append(num, thumb, name);
      item.addEventListener('click', () => { Player.jumpTo(i); close(); });
      listEl.appendChild(item);
    });

    // Scroll current into view
    const cur = listEl.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  closeBtn.addEventListener('click', close);

  return { open, close, refresh };
})();

// ── Fullscreen Player ─────────────────────────────────────────────────────────

const FullscreenPlayer = (() => {
  const el = document.getElementById('fullscreen-player');

  function open()  { el.hidden = false; }
  function close() { el.hidden = true; }

  document.getElementById('fs-close').addEventListener('click', close);

  return { open, close };
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

  // ── Navigation ──
  function navigate(p) {
    if (selectMode) exitSelectMode();
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

    const frag = document.createDocumentFragment();

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
      playAll.textContent = '\u25B6 Play all';
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
      chk.textContent = selectedPaths.has(item.path) ? '\u2713' : '\u25CB';
      el.appendChild(chk);
    } else {
      const icon = document.createElement('span');
      icon.className = 'list-icon';
      icon.textContent = item.type === 'dir' ? '\uD83D\uDCC1' : '\uD83C\uDFB5';
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
      fetchDuration(item.path).then(d => { if (d) dur.textContent = formatTime(d); });
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
    thumb.textContent = item.type === 'dir' ? '\uD83D\uDCC1' : '\uD83C\uDFB5';

    if (selectMode && item.type === 'file') {
      const overlay = document.createElement('div');
      overlay.className = 'grid-select-overlay';
      overlay.textContent = selectedPaths.has(item.path) ? '\u2713' : '';
      thumb.appendChild(overlay);
    } else {
      const img = document.createElement('img');
      img.src = `/api/artwork?path=${enc(item.path)}`;
      img.setAttribute('data-loaded', 'false');
      img.onload = () => { img.setAttribute('data-loaded', 'true'); thumb.textContent = ''; thumb.appendChild(img); };
      img.onerror = () => {};
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

  load();

  return { navigate, setPlaying, refresh };
})();

// Restore queue + position after all modules are initialised
Player.restore();
