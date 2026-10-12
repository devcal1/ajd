const express = require('express');
const { checkPassword, loginDelayMs, noteLogin } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const delay = loginDelayMs(req.ip);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const ok = await checkPassword(password);
    noteLogin(req.ip, ok);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    // fresh session id on login (prevents session fixation)
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.authed = true;
      res.json({ ok: true });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
