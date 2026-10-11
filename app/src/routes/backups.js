const express = require('express');
const { runBackup, listBackups } = require('../backup');

const router = express.Router();

router.get('/api/backups', (req, res) => {
  res.json(listBackups());
});

router.post('/api/backups/run', (req, res) => {
  try {
    const dir = runBackup();
    res.status(201).json({ ok: true, dir });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

module.exports = router;
