'use strict';

import { Player } from './player.js';
import { FullscreenPlayer } from './fullscreen.js';

// ── Playlists ─────────────────────────────────────────────────────────────────

const Playlists = (() => {
  const panel      = document.getElementById('playlists-panel');
  const listEl     = document.getElementById('playlist-list');
  const closeBtn   = document.getElementById('playlists-close');
  const newBtn     = document.getElementById('new-playlist-btn');
  const topbarBtn  = document.getElementById('btn-playlists');
  const fsBtnPl    = document.getElementById('fs-btn-playlists');
  const addModal   = document.getElementById('add-playlist-modal');
  const addListEl  = document.getElementById('add-playlist-list');
  const apmNew     = document.getElementById('apm-new');
  const apmCancel  = document.getElementById('apm-cancel');

  let _playlists   = [];
  let _addCallback = null; // { paths } pending add

  async function load() {
    try {
      const res = await fetch('/api/playlists');
      if (!res.ok) return;
      _playlists = await res.json();
    } catch {}
  }

  function open() {
    panel.hidden = false;
    topbarBtn.classList.add('active');
    load().then(render);
  }

  function close() {
    panel.hidden = true;
    topbarBtn.classList.remove('active');
  }

  function render() {
    listEl.innerHTML = '';
    if (_playlists.length === 0) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No playlists yet</div>';
      return;
    }
    for (const pl of _playlists) {
      const item = document.createElement('div');
      item.className = 'playlist-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'playlist-item-name';
      nameEl.textContent = pl.name;

      const countEl = document.createElement('span');
      countEl.className = 'playlist-item-count';
      countEl.textContent = `${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}`;

      const actions = document.createElement('span');
      actions.className = 'playlist-item-actions';

      const playBtn = document.createElement('button');
      playBtn.className = 'admin-btn';
      playBtn.textContent = 'Play';
      playBtn.addEventListener('click', e => { e.stopPropagation(); playPlaylist(pl); });

      const delBtn = document.createElement('button');
      delBtn.className = 'admin-btn danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deletePlaylist(pl.id); });

      actions.append(playBtn, delBtn);
      item.append(nameEl, countEl, actions);

      // Expand/collapse tracks
      let expanded = false;
      let tracksEl = null;
      item.addEventListener('click', () => {
        expanded = !expanded;
        if (expanded) {
          tracksEl = document.createElement('div');
          tracksEl.className = 'playlist-tracks';
          if (pl.tracks.length === 0) {
            tracksEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Empty playlist</span>';
          }
          for (const t of pl.tracks) {
            const tr = document.createElement('div');
            tr.className = 'playlist-track';
            tr.textContent = (t.name || t.path.split('/').pop().replace(/\.[^.]+$/, ''));
            tr.addEventListener('click', e => { e.stopPropagation(); Player.startQueue([t.path], 0); close(); });
            tracksEl.appendChild(tr);
          }
          item.after(tracksEl);
        } else {
          if (tracksEl) { tracksEl.remove(); tracksEl = null; }
        }
      });

      listEl.appendChild(item);
    }
  }

  function playPlaylist(pl) {
    if (pl.tracks.length === 0) return;
    const paths = pl.tracks.map(t => t.path);
    Player.startQueue(paths, 0);
    close();
  }

  async function deletePlaylist(id) {
    try {
      await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
      await load();
      render();
    } catch {}
  }

  async function createPlaylist(name) {
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const pl = await res.json();
      await load();
      render();
      return pl;
    } catch { return null; }
  }

  newBtn.addEventListener('click', async () => {
    const name = prompt('Playlist name:');
    if (!name || !name.trim()) return;
    await createPlaylist(name.trim());
  });

  // Add-to-playlist modal
  async function showAddModal(paths) {
    _addCallback = paths;
    await load();
    addListEl.innerHTML = '';
    if (_playlists.length === 0) {
      addListEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No playlists yet — create one below.</div>';
    }
    for (const pl of _playlists) {
      const btn = document.createElement('button');
      btn.className = 'modal-btn';
      btn.textContent = `${pl.name} (${pl.tracks.length} tracks)`;
      btn.addEventListener('click', () => { addToPlaylist(pl, paths); addModal.hidden = true; });
      addListEl.appendChild(btn);
    }
    addModal.hidden = false;
  }

  async function addToPlaylist(pl, paths) {
    const newTracks = paths.map(p => ({ path: p, name: p.split('/').pop().replace(/\.[^.]+$/, '') }));
    const tracks = [...pl.tracks, ...newTracks];
    try {
      await fetch(`/api/playlists/${pl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks }),
      });
    } catch {}
  }

  apmNew.addEventListener('click', async () => {
    addModal.hidden = true;
    const name = prompt('Playlist name:');
    if (!name || !name.trim()) return;
    const pl = await createPlaylist(name.trim());
    if (pl && _addCallback) await addToPlaylist(pl, _addCallback);
    _addCallback = null;
  });
  apmCancel.addEventListener('click', () => { addModal.hidden = true; _addCallback = null; });
  addModal.addEventListener('click', e => { if (e.target === addModal) { addModal.hidden = true; _addCallback = null; } });

  closeBtn.addEventListener('click', close);
  topbarBtn.addEventListener('click', () => { panel.hidden ? open() : close(); });
  fsBtnPl.addEventListener('click', () => { FullscreenPlayer.close(); open(); });

  return { open, close, showAddModal, createPlaylist };
})();

export { Playlists };
