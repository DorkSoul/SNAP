const express = require('express');
const crypto = require('crypto');
const { getUserState, saveUserState } = require('../lib/data.js');
const { requireAuth } = require('../middleware/auth.js');
const router = express.Router();

const ACTIVE_FRESH_MS = 5 * 60 * 1000;
const COMMAND_TTL_MS = 10 * 1000;

const num = v => typeof v === 'number' && Number.isFinite(v);

router.get('/state', requireAuth, (req, res) => {
  const state = getUserState();
  const s = state[req.user.id];
  // Lazily expire commands nobody executed (active device gone away)
  if (s?.pendingCommand && Date.now() - (s.pendingCommand.sentAt || 0) > COMMAND_TTL_MS) {
    s.pendingCommand = null;
    saveUserState(state);
  }
  res.json(s || {});
});

router.put('/state', requireAuth, (req, res) => {
  const { queue, index, position, duration, playing, deviceId, claimActive } = req.body || {};
  const state = getUserState();
  const prev = state[req.user.id] || {};
  const clearing = Array.isArray(queue) && queue.length === 0;
  const activeFresh = prev.activeDeviceId &&
    Date.now() - (prev.activeDeviceAt || 0) < ACTIVE_FRESH_MS;

  // Only the current active device may update live playback state. A takeover
  // (claimActive) or an explicit queue-clear is a deliberate user action and
  // goes through; any other push from a non-active device is ignored so a
  // stray push can't steal active status or clobber the live position.
  if (!clearing && activeFresh && deviceId !== prev.activeDeviceId && claimActive !== true) {
    return res.json({ ok: true, ignored: true });
  }

  state[req.user.id] = {
    queue: Array.isArray(queue) ? queue : (prev.queue || []),
    index: num(index) ? index : (prev.index ?? -1),
    position: num(position) ? position : (prev.position || 0),
    duration: num(duration) ? duration : (prev.duration || 0),
    playing: typeof playing === 'boolean' ? playing : (prev.playing || false),
    activeDeviceId: clearing ? null : (deviceId || prev.activeDeviceId || null),
    activeDeviceAt: clearing ? 0 : Date.now(),
    // Commands are cleared only by ack (or TTL), never by a state push — a
    // push racing a fresh command must not wipe it before it executes.
    pendingCommand: clearing ? null : (prev.pendingCommand || null),
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
  state[req.user.id].pendingCommand = { id: crypto.randomUUID(), type, data, sentAt: Date.now() };
  saveUserState(state);
  res.json({ ok: true });
});

router.post('/command/ack', requireAuth, (req, res) => {
  const { id } = req.body || {};
  const state = getUserState();
  const s = state[req.user.id];
  if (id && s?.pendingCommand?.id === id) {
    s.pendingCommand = null;
    saveUserState(state);
  }
  res.json({ ok: true });
});

module.exports = router;
