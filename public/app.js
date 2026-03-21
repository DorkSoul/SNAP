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
      })
      .catch(() => {});

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
  }

  function addAfterCurrent(path) {
    queue.splice(queueIndex + 1, 0, path);
    if (originalQueue) originalQueue.splice(originalQueue.length, 0, path);
    QueuePanel.refresh();
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
  }

  // ── Repeat ──
  function cycleRepeat() {
    if (repeatMode === 'off')   repeatMode = 'queue';
    else if (repeatMode === 'queue') repeatMode = 'one';
    else                        repeatMode = 'off';
    syncRepeatIcon();
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

  audio.addEventListener('timeupdate', syncSeek);
  audio.addEventListener('ended', () => {
    syncPlayIcon(false);
    playNext();
    if (audio.paused) WakeLock.release();
  });
  audio.addEventListener('pause', () => syncPlayIcon(false));
  audio.addEventListener('play',  () => syncPlayIcon(true));

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

  return {
    paused, isActive, getCurrentPath, getQueue, getQueueIndex,
    startQueue, addToEnd, addAfterCurrent, jumpTo,
    playPause, playNext, playPrev
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

  let pendingPath    = null;
  let pendingDirPaths = null;
  let pendingIdx     = null;

  function show(path, dirPaths, startIdx) {
    pendingPath     = path;
    pendingDirPaths = dirPaths;
    pendingIdx      = startIdx;
    trackName.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');
    overlay.hidden = false;
  }

  function hide() { overlay.hidden = true; }

  btnPlayNow.addEventListener('click', () => {
    Player.startQueue(pendingDirPaths, pendingIdx);
    hide();
  });

  btnNext.addEventListener('click', () => {
    Player.addAfterCurrent(pendingPath);
    hide();
  });

  btnAddEnd.addEventListener('click', () => {
    Player.addToEnd(pendingPath);
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
  const PREF_KEY = 'mplay_view';
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
  const browserEl   = document.getElementById('browser');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const searchEl    = document.getElementById('search');

  let currentPath  = '';
  let currentItems = [];
  let playingPath  = '';
  let searchQuery  = '';

  function navigate(p) {
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
    if (ViewToggle.get() === 'grid') renderGrid(items);
    else renderList(items);
  }

  function onFileClick(item) {
    const files   = currentItems.filter(i => i.type === 'file');
    const paths   = files.map(f => f.path);
    const idx     = paths.indexOf(item.path);

    if (Player.isActive()) {
      QueueModal.show(item.path, paths, idx);
    } else {
      Player.startQueue(paths, idx);
    }
  }

  function renderList(items) {
    const ul = document.createElement('div');
    ul.className = 'list-view';

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'list-item' +
        (item.name.startsWith('.') ? ' hidden-entry' : '') +
        (item.path === playingPath ? ' playing' : '');

      const icon = document.createElement('span');
      icon.className = 'list-icon';
      icon.textContent = item.type === 'dir' ? '📁' : '🎵';

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

      el.append(icon, name, meta);
      el.addEventListener('click', () => item.type === 'dir' ? navigate(item.path) : onFileClick(item));
      ul.appendChild(el);
    }

    browserEl.innerHTML = '';
    browserEl.appendChild(ul);
  }

  function renderGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'grid-view';

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'grid-item' +
        (item.name.startsWith('.') ? ' hidden-entry' : '') +
        (item.path === playingPath ? ' playing' : '');

      const thumb = document.createElement('div');
      thumb.className = 'grid-thumb';
      thumb.textContent = item.type === 'dir' ? '📁' : '🎵';

      const img = document.createElement('img');
      img.src = `/api/artwork?path=${enc(item.path)}`;
      img.setAttribute('data-loaded', 'false');
      img.onload = () => {
        img.setAttribute('data-loaded', 'true');
        thumb.textContent = '';
        thumb.appendChild(img);
      };
      img.onerror = () => {};

      const name = document.createElement('span');
      name.className = 'grid-name';
      name.textContent = item.name;

      el.append(thumb, name);
      el.addEventListener('click', () => item.type === 'dir' ? navigate(item.path) : onFileClick(item));
      grid.appendChild(el);
    }

    browserEl.innerHTML = '';
    browserEl.appendChild(grid);
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
