const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, UPLOADS_DIR } = require('./db');

// Backups live inside DATA_DIR, the same directory both app/docker-compose.yml
// and umbrel-app-store's compose file already mount as a persistent volume
// (${APP_DATA_DIR}/data on Umbrel) -- so a scheduled snapshot here is
// automatically covered by Umbrel's own host-level backup feature with no
// extra wiring, as long as that directory is included in what gets backed up.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS) > 0
  ? Number(process.env.BACKUP_INTERVAL_HOURS)
  : 24;
const RETENTION = Number(process.env.BACKUP_RETENTION) > 0
  ? Number(process.env.BACKUP_RETENTION)
  : 14;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR)
    .filter(name => fs.statSync(path.join(BACKUPS_DIR, name)).isDirectory())
    .sort() // ISO-ish timestamp names sort chronologically
    .reverse()
    .map(name => ({ name, bytes: dirSize(path.join(BACKUPS_DIR, name)) }));
}

function prune() {
  const all = listBackups().map(b => b.name).sort(); // oldest first
  const excess = all.length - RETENTION;
  if (excess <= 0) return;
  for (const name of all.slice(0, excess)) {
    fs.rmSync(path.join(BACKUPS_DIR, name), { recursive: true, force: true });
    console.log(`[backup] pruned ${name} (retention ${RETENTION})`);
  }
}

// A full backup is a timestamped directory containing a VACUUM INTO snapshot
// of the live SQLite DB (safe to run while the app is serving requests, even
// under WAL mode -- it's a point-in-time copy, not a raw file copy of a file
// that may be mid-write) plus a copy of the uploads directory.
function runBackup() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const dir = path.join(BACKUPS_DIR, timestamp());
  fs.mkdirSync(dir, { recursive: true });
  db.prepare('VACUUM INTO ?').run(path.join(dir, 'ajd.db'));
  if (fs.existsSync(UPLOADS_DIR)) {
    fs.cpSync(UPLOADS_DIR, path.join(dir, 'uploads'), { recursive: true });
  }
  console.log(`[backup] wrote ${dir}`);
  prune();
  return dir;
}

function safeRun() {
  try {
    runBackup();
  } catch (err) {
    console.error('[backup] failed:', err.message);
  }
}

// Simplest reliable "schedule" for a long-running single container: no cron
// syntax to parse, just a fixed interval timer, with one run shortly after
// boot so a freshly-deployed instance doesn't wait a full interval for its
// first backup.
function startSchedule() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  setTimeout(safeRun, 60 * 1000);
  setInterval(safeRun, INTERVAL_HOURS * 60 * 60 * 1000);
  console.log(`[backup] scheduled every ${INTERVAL_HOURS}h, keeping last ${RETENTION}`);
}

module.exports = { runBackup, listBackups, startSchedule, BACKUPS_DIR };
