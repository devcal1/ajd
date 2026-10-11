const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, UPLOADS_DIR } = require('./db');

// Backups live inside DATA_DIR, the same directory both app/docker-compose.yml
// and umbrel-app-store's compose file already mount as a persistent volume
// (${APP_DATA_DIR}/data on Umbrel) -- so a scheduled snapshot here is
// automatically covered by Umbrel's own host-level backup feature with no
// extra wiring, as long as that directory is included in what gets backed up.
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'ajd.db');

// Fixed local hour (0-23) to run the nightly backup -- not an interval timer,
// so it actually lands at a predictable, low-traffic time every night rather
// than drifting to whatever moment the container happened to last boot. Set
// TZ in the environment (Dockerfile installs tzdata for this) so "night"
// means the practice's own local time, not UTC.
const BACKUP_HOUR = (() => {
  const n = Number(process.env.BACKUP_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 2;
})();
// Default 14 = two weeks of nightly backups.
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

function msUntilNextRun() {
  const next = new Date();
  next.setHours(BACKUP_HOUR, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.now();
}

// Recursive setTimeout (not setInterval) so each run recomputes "next
// BACKUP_HOUR local time" from the real clock -- immune to drift and correct
// across DST changes, unlike a fixed 24h interval anchored to boot time.
function scheduleNext() {
  const delay = msUntilNextRun();
  setTimeout(() => {
    safeRun();
    scheduleNext();
  }, delay);
  console.log(`[backup] next nightly run in ${(delay / 3600000).toFixed(1)}h, at ${BACKUP_HOUR}:00 local time`);
}

// Zero designer interaction required: starts automatically with the app, no
// setup step. A brand-new install also gets one quick backup shortly after
// first boot so it isn't left with zero backups for up to 24h waiting for
// the first nightly run.
function startSchedule() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (listBackups().length === 0) {
    setTimeout(safeRun, 60 * 1000);
  }
  scheduleNext();
  console.log(`[backup] nightly at ${BACKUP_HOUR}:00 local time, keeping last ${RETENTION}`);
}

function assertSafeName(name) {
  if (typeof name !== 'string' || !name || path.basename(name) !== name) {
    throw new Error('Invalid backup name');
  }
  const dir = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(path.join(dir, 'ajd.db'))) {
    throw new Error('Backup not found: ' + name);
  }
  return dir;
}

function backupExists(name) {
  try {
    assertSafeName(name);
    return true;
  } catch {
    return false;
  }
}

// Restores a chosen backup over the live data, then exits the process so the
// container's restart policy (restart: unless-stopped / on-failure in both
// compose files) brings the app back up reading the restored files. There's
// no safe way to hot-swap the DB file under the one open node:sqlite
// connection every route shares, so a deliberate restart is the mechanism,
// not a bug -- the API response tells the caller to expect it.
function restoreBackup(name) {
  const dir = assertSafeName(name);
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_FILE + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  fs.copyFileSync(path.join(dir, 'ajd.db'), DB_FILE);
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  const backupUploads = path.join(dir, 'uploads');
  if (fs.existsSync(backupUploads)) {
    fs.cpSync(backupUploads, UPLOADS_DIR, { recursive: true });
  } else {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  console.log(`[backup] restored ${name} -- exiting for a clean restart`);
}

module.exports = { runBackup, listBackups, restoreBackup, backupExists, startSchedule, BACKUPS_DIR };
