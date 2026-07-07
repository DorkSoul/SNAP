const express = require('express');
const { getUserState, saveUserState } = require('../lib/data.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.get('/state', requireAuth, (req, res) => {
  const state = getUserState();
  res.json(state[req.user.id] || {});
});

router.put('/state', requireAuth, (req, res) => {
  const { queue, index, position, duration, playing, sortKey, sortDir, deviceId } = req.body || {};
  const state = getUserState();
  state[req.user.id] = {
    queue: Array.isArray(queue) ? queue : (state[req.user.id]?.queue || []),
    index: typeof index === 'number' ? index : (state[req.user.id]?.index ?? -1),
    position: typeof position === 'number' ? position : (state[req.user.id]?.position || 0),
    duration: typeof duration === 'number' ? duration : (state[req.user.id]?.duration || 0),
    playing: typeof playing === 'boolean' ? playing : (state[req.user.id]?.playing || false),
    sortKey: sortKey || state[req.user.id]?.sortKey || 'name',
    sortDir: sortDir || state[req.user.id]?.sortDir || 'asc',
    activeDeviceId: Array.isArray(queue) && queue.length === 0 ? null : (deviceId || state[req.user.id]?.activeDeviceId || null),
    activeDeviceAt: Array.isArray(queue) && queue.length === 0 ? 0 : Date.now(),
    pendingCommand: null,
  };
  saveUserState(state);
  res.json({ ok: true });
});

router.post('/command', requireAuth, (req, res) => {
  const { type, data } = req.body || {};
  const valid = ['playpause', 'next', 'prev', 'seek', 'skip', 'loadqueue'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const state = getUserState();
  if (!state[req.user.id]) return res.status(404).json({ error: 'No active state' });
  state[req.user.id].pendingCommand = { type, data, sentAt: Date.now() };
  saveUserState(state);
  res.json({ ok: true });
});

module.exports = router;
