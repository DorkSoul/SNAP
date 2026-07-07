const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getUsers, saveUsers } = require('../lib/data.js');
const { validUsername, validPassword, requireAuth } = require('../middleware/auth.js');
const router = express.Router();

router.get('/setup-check', (req, res) => {
  res.json({ needsSetup: getUsers().length === 0 });
});

router.post('/setup', async (req, res) => {
  const users = getUsers();
  if (users.length > 0) return res.status(400).json({ error: 'Setup already done' });
  const { username, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'Invalid username (3-32 chars, alphanumeric/underscore/dash)' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = { id: crypto.randomUUID(), username, passwordHash, role: 'admin', allowedPaths: [] };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, role: user.role });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

module.exports = router;
