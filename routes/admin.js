const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getUsers, saveUsers } = require('../lib/data.js');
const { validUsername, validPassword, requireAdmin } = require('../middleware/auth.js');
const router = express.Router();

router.get('/users', requireAdmin, (req, res) => {
  res.json(getUsers().map(({ passwordHash, ...u }) => u));
});

router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, role, allowedPaths } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const users = getUsers();
  if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = { id: crypto.randomUUID(), username, passwordHash, role, allowedPaths: Array.isArray(allowedPaths) ? allowedPaths : [] };
  users.push(user);
  saveUsers(users);
  const { passwordHash: _, ...out } = user;
  res.json(out);
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
  const users = getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  const { password, role, allowedPaths } = req.body || {};

  // Validate everything before mutating: getUsers() returns the in-memory
  // cache, so a partial mutation followed by an early return would leave the
  // cache out of sync with disk.
  if (password !== undefined && !validPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (role !== undefined) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (users[idx].role === 'admin' && role !== 'admin' &&
        !users.some(u => u.role === 'admin' && u.id !== users[idx].id)) {
      return res.status(400).json({ error: 'Cannot demote the last admin' });
    }
  }

  if (password !== undefined) users[idx].passwordHash = await bcrypt.hash(password, 12);
  if (role !== undefined) users[idx].role = role;
  if (allowedPaths !== undefined) users[idx].allowedPaths = Array.isArray(allowedPaths) ? allowedPaths : [];
  saveUsers(users);
  const { passwordHash, ...out } = users[idx];
  res.json(out);
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.user.id === req.params.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  const users = getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  saveUsers(users);
  res.json({ ok: true });
});

module.exports = router;
