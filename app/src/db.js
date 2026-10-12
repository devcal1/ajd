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
  },
  {
    id: '004_projects',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          client_name TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          budget REAL,
          notes TEXT,
          cover_image_path TEXT,
          archived_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
  },
  {
    id: '005_document_rooms_selections',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_document_rooms_project ON document_rooms(project_id);

        CREATE TABLE IF NOT EXISTS document_selections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER NOT NULL REFERENCES document_rooms(id) ON DELETE CASCADE,
          library_item_id INTEGER REFERENCES library_items(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          category TEXT,
          supplier TEXT,
          sku TEXT,
          dimensions TEXT,
          finish TEXT,
          cost REAL,
          qty INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'proposed',
          notes TEXT,
          image_path TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_document_selections_room ON document_selections(room_id);
      `);
    }
  },
  {
    id: '006_password_source',
    up() {
      // 'env' until the practice sets its own password in Settings, then 'user'. See
      // ensureSettingsSeeded for why the distinction matters.
      db.exec(`ALTER TABLE settings ADD COLUMN password_source TEXT NOT NULL DEFAULT 'env'`);
    }
  },
  {
    id: '007_selection_library_snapshot',
    up() {
      // JSON copy of the linked library item's spec fields as of the last import/refresh, so a
      // later library edit can be detected. Existing linked selections are snapshotted from the
      // library's current values, i.e. they start out "up to date".
      db.exec(`
        ALTER TABLE document_selections ADD COLUMN library_snapshot TEXT;
        UPDATE document_selections
        SET library_snapshot = (
          SELECT json_object('title', l.title, 'category', l.category, 'supplier', l.supplier,
                             'sku', l.sku, 'dimensions', l.dimensions, 'finish', l.finish,
                             'cost', l.cost, 'imagePath', l.image_path)
          FROM library_items l WHERE l.id = document_selections.library_item_id
        )
        WHERE library_item_id IS NOT NULL;
      `);
    }
  },
  {
    id: '008_project_pdf_settings',
    up() {
      // JSON of per-project document display options; NULL = defaults. See routes/projects.js.
      db.exec(`ALTER TABLE projects ADD COLUMN pdf_settings TEXT`);
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
  const row = db.prepare('SELECT password_hash, password_source FROM settings WHERE id = 1').get();
  const initialPassword = process.env.APP_PASSWORD;
  if (row) {
    // Until the practice picks its own password in Settings, APP_PASSWORD stays the source of
    // truth, so a corrected or rotated value in the environment (e.g. Umbrel's generated one)
    // takes effect on the next start instead of leaving the app locked behind a stale hash. Once
    // the password has been changed in the app ('user'), the environment is never read again.
    if (row.password_source === 'env' && initialPassword && !bcrypt.compareSync(initialPassword, row.password_hash)) {
      db.prepare('UPDATE settings SET password_hash = ? WHERE id = 1').run(bcrypt.hashSync(initialPassword, 10));
      console.log('[db] re-synced the app password from APP_PASSWORD (not yet changed in Settings)');
    }
    return;
  }
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
