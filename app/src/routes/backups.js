const express = require('express');
const { runBackup, listBackups, stageRestore, applyRestore, backupExists } = require('../backup');

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
  // Everything that can fail runs BEFORE we answer "restarting", so a failure is reported
  // honestly (the Settings page otherwise sees the server still up and assumes it worked):
  //  1. a safety copy of the CURRENT state (a restore is otherwise unrecoverable), pruning
  //     taught never to delete the backup being restored;
  //  2. staging + integrity check of the chosen backup.
  let staged;
  try {
    runBackup(name);
    staged = stageRestore(name);
  } catch (err) {
    console.error('[backup] restore not started:', err.message);
    return res.status(500).json({ error: 'Restore could not be started and nothing was changed: ' + err.message });
  }
  // The swap itself waits for this response to finish (including express-session's own
  // post-response touch, which still needs the DB open) -- doing it inline raced that touch
  // against db.close().
  res.on('finish', () => {
    try {
      applyRestore(staged);
    } catch (err) {
      console.error('[backup] restore failed (rolled back):', err.message);
    }
    // Always restart: the DB connection was closed, so the process cannot keep serving.
    setTimeout(() => process.exit(1), 100);
  });
  res.json({ ok: true, restarting: true });
});

module.exports = router;
