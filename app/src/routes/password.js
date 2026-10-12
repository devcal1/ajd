const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { checkPassword } = require('../auth');

const router = express.Router();
const MIN_LENGTH = 8;

// Wrong current password is a 400, not a 401: shared.js's api() treats any 401 as "session
// expired" and bounces to the login page, which would hide this message.
router.post('/api/password', async (req, res, next) => {
  try {
  const { currentPassword, newPassword } = req.body || {};
  if (!(await checkPassword(currentPassword))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (typeof newPassword !== 'string' || newPassword.trim().length < MIN_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_LENGTH} characters (not counting spaces at either end)` });
  }
  // bcrypt only uses the first 72 bytes, so a longer password would silently match any
  // password sharing its first 72 bytes.
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ error: 'New password can be at most 72 characters long' });
  }
  db.prepare(`UPDATE settings SET password_hash = ?, password_source = 'user' WHERE id = 1`)
    .run(bcrypt.hashSync(newPassword, 10));
  // Sign every other browser out; this one stays signed in.
  db.prepare('DELETE FROM sessions WHERE sid != ?').run(req.sessionID);
  res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
