'use strict';

import { Player } from './player.js';
import { clog, formatTime, formatSize, enc, icons } from './utils.js';

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

  let currentPath   = '';
  let currentItems  = [];
  let playingPath   = '';
  let searchQuery   = '';
  let searchResults = null; // non-null when a full-library search is active
  let searchDebounce = null;
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
    currentPath   = p;
    searchEl.value = '';
    searchQuery   = '';
    searchResults = null;
    load();
  }

  async function load() {
    browserEl.innerHTML = '<div class="browser-empty">Loading…</div>';
    renderBreadcrumb();

    let data;
    try {
      const res = await fetch(`/api/browse?path=${enc(currentPath)}`);
      if (res.status === 401) return; // login overlay will appear via fetch interceptor
      if (!res.ok) throw new Error(res.statusText);
      data = await res.json();
    } catch (e) {
      if (!document.getElementById('login-overlay').hidden) return;
      browserEl.innerHTML = `<div class="browser-empty">Error: ${e.message}</div>`;
      return;
    }

    currentItems = data.items;
    render();
  }

  function refresh() { render(); }

  function renderSearchResults() {
    if (searchResults.length === 0) {
      browserEl.innerHTML = '<div class="browser-empty">No results found</div>';
      return;
    }
    const isGrid = window._ViewToggle ? window._ViewToggle.get() === 'grid' : false;
    const container = document.createElement('div');
    container.className = isGrid ? 'grid-view' : 'list-view';
    for (const item of searchResults) {
      const dir = item.path.includes('/') ? item.path.split('/').slice(0, -1).join('/') : '';
      container.appendChild(isGrid ? makeGridItem(item, dir) : makeListItem(item, dir));
    }
    browserEl.innerHTML = '';
    browserEl.appendChild(container);
  }

  function render() {
    if (searchResults !== null) {
      renderSearchResults();
      return;
    }
    let items = currentItems;
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
          window._QueueModal && window._QueueModal.show(`${audioFiles.length} songs in folder`, paths, 0);
        } else {
          Player.startQueue(paths, 0);
        }
      });

      header.append(label, playAll);
      frag.appendChild(header);
    }

    const container = document.createElement('div');
    const isGrid = window._ViewToggle ? window._ViewToggle.get() === 'grid' : false;
    if (isGrid) {
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
      window._QueueModal && window._QueueModal.show(displayName, [item.path], 0);
    } else {
      Player.startQueue([item.path], 0);
    }
  }

  function makeListItem(item, pathSubtitle) {
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

    if (pathSubtitle !== undefined) {
      const sub = document.createElement('span');
      sub.className = 'list-path';
      sub.textContent = pathSubtitle || '/';
      el.append(name, sub, meta);
    } else {
      el.append(name, meta);
    }

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

  function makeGridItem(item, pathSubtitle) {
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

    if (pathSubtitle !== undefined) {
      const sub = document.createElement('span');
      sub.className = 'grid-path';
      sub.textContent = pathSubtitle || '/';
      el.append(thumb, name, sub);
    } else {
      el.append(thumb, name);
    }

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
    const q = searchEl.value.trim();
    searchQuery = q;
    clearTimeout(searchDebounce);
    if (q.length < 2) {
      searchResults = null;
      render();
      return;
    }
    browserEl.innerHTML = '<div class="browser-empty">Searching…</div>';
    searchDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${enc(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (searchEl.value.trim() === q) { // ignore stale responses
          searchResults = data;
          render();
        }
      } catch {}
    }, 300);
  });

  history.replaceState({ type: 'browse', path: '' }, '');
  load();

  function reload() { load(); }

  function getSelectedPaths() { return [...selectedPaths]; }

  return { navigate, setPlaying, refresh, reload, getSelectedPaths };
})();

export { FileBrowser };
