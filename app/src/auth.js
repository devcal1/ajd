const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { SqliteSessionStore } = require('./sessionStore');

const sessionMiddleware = session({
  // A unique name: cookies are not separated by port, so another app on the same host using
  // express-session's default "connect.sid" would otherwise keep logging this one out.
  name: 'ajd.sid',
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

// Async compare: the sync version blocked the whole event loop (~70ms) per attempt.
async function checkPassword(candidate) {
  const row = db.prepare('SELECT password_hash FROM settings WHERE id = 1').get();
  if (!row || typeof candidate !== 'string' || candidate.length > 1024) return false;
  return bcrypt.compare(candidate, row.password_hash);
}

// Progressive delay per client address after failed logins (never a lockout: behind Umbrel's
// proxy every user can share one address, and a lockout would let anyone on the LAN lock the
// designer out). 0.3s per recent failure, capped at 3s; resets after 15 minutes or a success.
const failures = new Map();
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function loginDelayMs(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.last > FAILURE_WINDOW_MS) return 0;
  return Math.min(3000, f.count * 300);
}

function noteLogin(ip, ok) {
  if (ok) { failures.delete(ip); return; }
  const f = failures.get(ip);
  const fresh = !f || Date.now() - f.last > FAILURE_WINDOW_MS;
  failures.set(ip, { count: fresh ? 1 : f.count + 1, last: Date.now() });
  if (failures.size > 1000) failures.clear();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login.html');
}

module.exports = { sessionMiddleware, checkPassword, requireAuth, loginDelayMs, noteLogin };
