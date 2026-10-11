const express = require('express');
const { runBackup, listBackups, restoreBackup, backupExists } = require('../backup');

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

router.post('/api/backups/:name/restore', (req, res) => {
  const name = req.params.name;
  if (!backupExists(name)) {
    return res.status(400).json({ error: 'Backup not found: ' + name });
  }
  // Do the actual file swap + DB close only once this response has fully
  // finished (including express-session's own post-response touch, which
  // still needs the DB open) -- doing it inline during the handler raced
  // that touch against restoreBackup()'s db.close().
  res.on('finish', () => {
    try {
      restoreBackup(name);
    } catch (err) {
      console.error('[backup] restore failed:', err.message);
    }
    setTimeout(() => process.exit(1), 100);
  });
  res.json({ ok: true, restarting: true });
});

module.exports = router;
