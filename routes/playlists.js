const express = require('express');
const crypto = require('crypto');
const { getPlaylists, savePlaylists } = require('../lib/data.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(getPlaylists().filter(p => p.userId === req.user.id));
});

router.post('/', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const playlist = { id: crypto.randomUUID(), userId: req.user.id, name: name.trim().slice(0, 100), tracks: [], createdAt: new Date().toISOString() };
  const playlists = getPlaylists();
  playlists.push(playlist);
  savePlaylists(playlists);
  res.json(playlist);
});

router.get('/:id', requireAuth, (req, res) => {
  const playlist = getPlaylists().find(p => p.id === req.params.id && p.userId === req.user.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
  res.json(playlist);
});

router.put('/:id', requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const idx = playlists.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
  const { name, tracks } = req.body || {};
  if (name !== undefined) playlists[idx].name = String(name).trim().slice(0, 100);
  if (tracks !== undefined) playlists[idx].tracks = Array.isArray(tracks) ? tracks : [];
  savePlaylists(playlists);
  res.json(playlists[idx]);
});

router.delete('/:id', requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const idx = playlists.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
  playlists.splice(idx, 1);
  savePlaylists(playlists);
  res.json({ ok: true });
});

module.exports = router;
