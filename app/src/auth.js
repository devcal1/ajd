const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { SqliteSessionStore } = require('./sessionStore');

const sessionMiddleware = session({
  store: new SqliteSessionStore(),
  secret: process.env.SESSION_SECRET || 'ajd-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax'
  }
});

function checkPassword(candidate) {
  const row = db.prepare('SELECT password_hash FROM settings WHERE id = 1').get();
  if (!row) return false;
  return bcrypt.compareSync(candidate || '', row.password_hash);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

module.exports = { sessionMiddleware, checkPassword, requireAuth };
