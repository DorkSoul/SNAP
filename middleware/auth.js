const { getUsers } = require('../lib/data.js');

function validUsername(u) { return typeof u === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8; }

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const users = getUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Not authenticated' }); }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { validUsername, validPassword, requireAuth, requireAdmin };
