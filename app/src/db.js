const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'ajd.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function transaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Stage 1 only creates `settings` + the migration-tracking table itself.
// Later stages (library_items, projects, document_rooms, document_selections,
// sessions) each add one migration here rather than editing earlier ones.
const MIGRATIONS = [
  {
    id: '001_settings',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          password_hash TEXT NOT NULL,
          practice_name TEXT NOT NULL DEFAULT 'AJ Interiors'
        );
      `);
    }
  },
  {
    id: '002_sessions',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
    }
  },
  {
    id: '003_library_items',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS library_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          category TEXT,
          supplier TEXT,
          sku TEXT,
          dimensions TEXT,
          finish TEXT,
          cost REAL,
          notes TEXT,
          image_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
  }
];

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    transaction(() => {
      migration.up();
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id);
    });
    console.log(`[db] applied migration ${migration.id}`);
  }
}

function ensureSettingsSeeded() {
  const row = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (row) return;
  const initialPassword = process.env.APP_PASSWORD;
  if (!initialPassword) {
    throw new Error(
      'No settings row exists yet and APP_PASSWORD is not set. ' +
      'Set APP_PASSWORD in the environment for first boot so an initial app password can be created.'
    );
  }
  const hash = bcrypt.hashSync(initialPassword, 10);
  db.prepare('INSERT INTO settings (id, password_hash) VALUES (1, ?)').run(hash);
  console.log('[db] seeded initial app password from APP_PASSWORD env var');
}

runMigrations();
ensureSettingsSeeded();

module.exports = { db, transaction, DATA_DIR, UPLOADS_DIR };
