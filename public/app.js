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
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch (e) {
      console.warn('Wake lock failed:', e);
    }
  }

  async function release() {
    if (lock) {
      await lock.release().catch(() => {});
      lock = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !Player.paused()) {
      acquire();
    }
  });

  return { acquire, release };
})();

// ── Player ────────────────────────────────────────────────────────────────────

const Player = (() => {
  const audio = document.getElementById('audio');
  const btnPlay = document.getElementById('btn-play');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const seekBar = document.getElementById('seek-bar');
  const volumeBar = document.getElementById('volume-bar');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const artImg = document.getElementById('player-art-img');
  const titleEl = document.getElementById('player-title');
  const artistEl = document.getElementById('player-artist');

  let queue = [];
  let queueIndex = -1;
  let isSeeking = false;

  function paused() { return audio.paused; }

  async function loadTrack(filePath, play = true) {
    audio.src = `/api/stream?path=${enc(filePath)}`;
    audio.load();

    // Reset UI
    artImg.src = '';
    titleEl.textContent = filePath.split('/').pop().replace(/\.[^.]+$/, '');
    artistEl.textContent = '';
    seekBar.value = 0;
    timeCurrent.textContent = '0:00';
    timeTotal.textContent = '0:00';

    // Fetch metadata
    fetch(`/api/metadata?path=${enc(filePath)}`)
      .then(r => r.json())
      .then(meta => {
        titleEl.textContent = meta.title || titleEl.textContent;
        artistEl.textContent = meta.artist || '';
        if (meta.duration) timeTotal.textContent = formatTime(meta.duration);
      })
      .catch(() => {});

    // Artwork
    artImg.src = `/api/artwork?path=${enc(filePath)}`;
    artImg.onerror = () => { artImg.src = ''; };

    // Update playing highlight in browser
    FileBrowser.setPlaying(filePath);

    if (play) {
      try {
        await audio.play();
        btnPlay.textContent = '⏸';
        WakeLock.acquire();
      } catch (e) {
        console.warn('Playback failed:', e);
      }
    }
  }

  function playPause() {
    if (audio.paused) {
      audio.play().then(() => {
        btnPlay.textContent = '⏸';
        WakeLock.acquire();
      }).catch(() => {});
    } else {
      audio.pause();
      btnPlay.textContent = '▶';
      WakeLock.release();
    }
  }

  function playNext() {
    if (queueIndex < queue.length - 1) {
      queueIndex++;
      loadTrack(queue[queueIndex]);
    }
  }

  function playPrev() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
    } else if (queueIndex > 0) {
      queueIndex--;
      loadTrack(queue[queueIndex]);
    }
  }

  function enqueueAndPlay(paths, startIndex = 0) {
    queue = paths;
    queueIndex = startIndex;
    loadTrack(queue[queueIndex]);
  }

  function enqueueOne(filePath) {
    // Find in queue or set as whole queue
    const idx = queue.indexOf(filePath);
    if (idx !== -1) {
      queueIndex = idx;
      loadTrack(filePath);
    } else {
      queue = [filePath];
      queueIndex = 0;
      loadTrack(filePath);
    }
  }

  // Events
  btnPlay.addEventListener('click', playPause);
  btnPrev.addEventListener('click', playPrev);
  btnNext.addEventListener('click', playNext);

  audio.addEventListener('timeupdate', () => {
    if (isSeeking || !isFinite(audio.duration)) return;
    seekBar.value = (audio.currentTime / audio.duration) * 100 || 0;
    timeCurrent.textContent = formatTime(audio.currentTime);
    if (isFinite(audio.duration)) timeTotal.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    btnPlay.textContent = '▶';
    playNext();
    if (queueIndex === queue.length - 1 && audio.paused) {
      WakeLock.release();
    }
  });

  audio.addEventListener('pause', () => {
    btnPlay.textContent = '▶';
  });

  audio.addEventListener('play', () => {
    btnPlay.textContent = '⏸';
  });

  seekBar.addEventListener('mousedown', () => { isSeeking = true; });
  seekBar.addEventListener('touchstart', () => { isSeeking = true; });
  seekBar.addEventListener('input', () => {
    if (isFinite(audio.duration)) {
      timeCurrent.textContent = formatTime((seekBar.value / 100) * audio.duration);
    }
  });
  seekBar.addEventListener('change', () => {
    if (isFinite(audio.duration)) {
      audio.currentTime = (seekBar.value / 100) * audio.duration;
    }
    isSeeking = false;
  });

  volumeBar.addEventListener('input', () => {
    audio.volume = volumeBar.value;
  });

  return { paused, enqueueOne, enqueueAndPlay };
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

  function get() { return current; }

  // Init button state
  btnList.classList.toggle('active', current === 'list');
  btnGrid.classList.toggle('active', current === 'grid');

  return { get };
})();

// ── File Browser ──────────────────────────────────────────────────────────────

const FileBrowser = (() => {
  const browserEl = document.getElementById('browser');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const searchEl = document.getElementById('search');

  let currentPath = '';
  let currentItems = [];
  let playingPath = '';
  let searchQuery = '';

  function navigate(p) {
    currentPath = p;
    searchEl.value = '';
    searchQuery = '';
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
      browserEl.innerHTML = `<div class="browser-empty">Error loading directory: ${e.message}</div>`;
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

    const view = ViewToggle.get();
    if (view === 'grid') renderGrid(items);
    else renderList(items);
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
        // Fetch duration lazily
        fetchDuration(item.path).then(d => { if (d) dur.textContent = formatTime(d); });

        const sz = document.createElement('span');
        sz.textContent = item.size ? formatSize(item.size) : '';

        meta.append(dur, sz);
      }

      el.append(icon, name, meta);

      el.addEventListener('click', () => {
        if (item.type === 'dir') {
          navigate(item.path);
        } else {
          const files = currentItems.filter(i => i.type === 'file');
          const paths = files.map(f => f.path);
          const idx = paths.indexOf(item.path);
          Player.enqueueAndPlay(paths, idx);
        }
      });

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

      if (item.type === 'dir') {
        thumb.textContent = '📁';
        // Try folder art
        const img = document.createElement('img');
        img.src = `/api/artwork?path=${enc(item.path)}`;
        img.setAttribute('data-loaded', 'false');
        img.onload = () => {
          img.setAttribute('data-loaded', 'true');
          thumb.textContent = '';
          thumb.appendChild(img);
        };
        img.onerror = () => {};
      } else {
        thumb.textContent = '🎵';
        const img = document.createElement('img');
        img.src = `/api/artwork?path=${enc(item.path)}`;
        img.setAttribute('data-loaded', 'false');
        img.onload = () => {
          img.setAttribute('data-loaded', 'true');
          thumb.textContent = '';
          thumb.appendChild(img);
        };
        img.onerror = () => {};
      }

      const name = document.createElement('span');
      name.className = 'grid-name';
      name.textContent = item.name;

      el.append(thumb, name);

      el.addEventListener('click', () => {
        if (item.type === 'dir') {
          navigate(item.path);
        } else {
          const files = currentItems.filter(i => i.type === 'file');
          const paths = files.map(f => f.path);
          const idx = paths.indexOf(item.path);
          Player.enqueueAndPlay(paths, idx);
        }
      });

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
    // Update highlights without full re-render
    document.querySelectorAll('.list-item, .grid-item').forEach(el => {
      el.classList.remove('playing');
    });
    // Re-render is simplest since items may have changed
    render();
  }

  // Duration cache to avoid refetching
  const durCache = new Map();
  async function fetchDuration(filePath) {
    if (durCache.has(filePath)) return durCache.get(filePath);
    try {
      const res = await fetch(`/api/metadata?path=${enc(filePath)}`);
      const meta = await res.json();
      durCache.set(filePath, meta.duration);
      return meta.duration;
    } catch {
      return null;
    }
  }

  // Search
  searchEl.addEventListener('input', () => {
    searchQuery = searchEl.value.trim();
    render();
  });

  // Initial load
  load();

  return { navigate, setPlaying, refresh };
})();
