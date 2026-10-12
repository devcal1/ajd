const path = require('path');
const fs = require('fs');
const express = require('express');
const { db, UPLOADS_DIR } = require('../db');
const { assertFlat, parseMoney, parseQty, parseChoice } = require('../validate');

const router = express.Router();

const { imageUpload: upload } = require('../uploads');

function deleteUpload(imagePath) {
  if (!imagePath) return;
  fs.unlink(path.join(UPLOADS_DIR, imagePath), () => {});
}

const SYNC_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'category', label: 'Category' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'sku', label: 'SKU' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'finish', label: 'Finish' },
  { key: 'cost', label: 'Cost' }
];

function snapshotOf(lib) {
  const snap = { imagePath: lib.image_path || null };
  SYNC_FIELDS.forEach(f => { snap[f.key] = lib[f.key] == null ? null : lib[f.key]; });
  return JSON.stringify(snap);
}

function sameValue(a, b) {
  return (a == null || a === '' ? null : a) === (b == null || b === '' ? null : b);
}

// Compares a selection with its library item. status: 'none' (never linked), 'current',
// 'changed' (library differs from what was imported/last refreshed) or 'removed'
// (library item deleted). diff lists what "Update from library" would change.
function libraryState(row) {
  if (!row.library_snapshot) return { status: 'none', diff: [] };
  if (!row.library_item_id) return { status: 'removed', diff: [] };
  const lib = db.prepare('SELECT * FROM library_items WHERE id = ?').get(row.library_item_id);
  if (!lib) return { status: 'removed', diff: [] };
  const snap = JSON.parse(row.library_snapshot);
  const photoChanged = (lib.image_path || null) !== (snap.imagePath || null);
  const changed = photoChanged || SYNC_FIELDS.some(f => !sameValue(lib[f.key], snap[f.key]));
  if (!changed) return { status: 'current', diff: [] };
  const diff = SYNC_FIELDS
    .filter(f => !sameValue(lib[f.key], row[f.key]))
    .map(f => ({ field: f.key, label: f.label, mine: row[f.key] == null ? null : row[f.key], library: lib[f.key] == null ? null : lib[f.key] }));
  if (photoChanged) {
    diff.push({
      field: 'image',
      label: 'Photo',
      mine: row.image_path ? 'Current photo' : null,
      library: lib.image_path ? 'Library photo' : null
    });
  }
  return { status: 'changed', diff };
}

function serializeSelection(row) {
  const state = libraryState(row);
  return {
    libraryStatus: state.status,
    libraryDiff: state.diff,
    id: row.id,
    roomId: row.room_id,
    libraryItemId: row.library_item_id,
    title: row.title,
    category: row.category,
    supplier: row.supplier,
    sku: row.sku,
    dimensions: row.dimensions,
    finish: row.finish,
    cost: row.cost,
    qty: row.qty,
    status: row.status,
    notes: row.notes,
    sourceUrl: row.source_url || null,
    imagePath: row.image_path ? `/uploads/${row.image_path}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeRoom(row, selections) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    selections: selections.map(serializeSelection)
  };
}

function selectionFields(body) {
  return {
    title: String(body.title || '').trim(),
    category: body.category ? String(body.category).trim() : null,
    supplier: body.supplier ? String(body.supplier).trim() : null,
    sku: body.sku ? String(body.sku).trim() : null,
    dimensions: body.dimensions ? String(body.dimensions).trim() : null,
    finish: body.finish ? String(body.finish).trim() : null,
    cost: parseMoney(body.cost, 'Cost'),
    qty: parseQty(body.qty),
    status: parseChoice(body.status, ['proposed', 'approved', 'rejected'], 'proposed', 'Status'),
    notes: body.notes ? String(body.notes).trim() : null,
    libraryItemId: body.libraryItemId ? Number(body.libraryItemId) : null
  };
}


// Validate the body; on failure also remove the file multer already wrote for this request.
function parseBody(parser, req) {
  try {
    assertFlat(req.body);
    return parser(req.body || {});
  } catch (err) {
    if (req.file) deleteUpload(req.file.filename);
    throw err;
  }
}

function getProjectOr404(projectId, res) {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
}

function getRoomOr404(roomId, res) {
  const room = db.prepare('SELECT * FROM document_rooms WHERE id = ?').get(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  return room;
}

// Rooms (nested under a project), each with its selections, for the project's
// room-by-room FF&E design document.
router.get('/api/projects/:projectId/rooms', (req, res) => {
  if (!getProjectOr404(req.params.projectId, res)) return;
  const rooms = db.prepare('SELECT * FROM document_rooms WHERE project_id = ? ORDER BY id ASC').all(req.params.projectId);
  const selectionsStmt = db.prepare('SELECT * FROM document_selections WHERE room_id = ? ORDER BY id ASC');
  res.json(rooms.map(room => serializeRoom(room, selectionsStmt.all(room.id))));
});

router.post('/api/projects/:projectId/rooms', (req, res) => {
  if (!getProjectOr404(req.params.projectId, res)) return;
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  const result = db.prepare('INSERT INTO document_rooms (project_id, name) VALUES (?, ?)').run(req.params.projectId, name);
  const room = db.prepare('SELECT * FROM document_rooms WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serializeRoom(room, []));
});

router.put('/api/rooms/:id', (req, res) => {
  const existing = getRoomOr404(req.params.id, res);
  if (!existing) return;
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  db.prepare(`UPDATE document_rooms SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, req.params.id);
  const room = db.prepare('SELECT * FROM document_rooms WHERE id = ?').get(req.params.id);
  const selections = db.prepare('SELECT * FROM document_selections WHERE room_id = ? ORDER BY id ASC').all(room.id);
  res.json(serializeRoom(room, selections));
});

router.delete('/api/rooms/:id', (req, res) => {
  const existing = getRoomOr404(req.params.id, res);
  if (!existing) return;
  const images = db.prepare('SELECT image_path FROM document_selections WHERE room_id = ?').all(req.params.id);
  db.prepare('DELETE FROM document_rooms WHERE id = ?').run(req.params.id);
  images.forEach(row => deleteUpload(row.image_path));
  res.status(204).end();
});

// Selections (FF&E items) within a room.
router.post('/api/rooms/:roomId/selections', upload.single('image'), (req, res) => {
  const room = getRoomOr404(req.params.roomId, res);
  if (!room) {
    if (req.file) deleteUpload(req.file.filename);
    return;
  }
  const data = parseBody(selectionFields, req);
  if (!data.title) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  const imagePath = req.file ? req.file.filename : null;
  const lib = data.libraryItemId ? db.prepare('SELECT * FROM library_items WHERE id = ?').get(data.libraryItemId) : null;
  const result = db.prepare(`
    INSERT INTO document_selections
      (room_id, library_item_id, library_snapshot, title, category, supplier, sku, dimensions, finish, cost, qty, status, notes, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.roomId, lib ? lib.id : null, lib ? snapshotOf(lib) : null, data.title, data.category, data.supplier, data.sku,
    data.dimensions, data.finish, data.cost, data.qty, data.status, data.notes, imagePath
  );
  const row = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serializeSelection(row));
});

router.put('/api/selections/:id', upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(404).json({ error: 'Selection not found' });
  }
  const data = parseBody(selectionFields, req);
  if (!data.title) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  let imagePath = existing.image_path;
  if (req.file) {
    deleteUpload(existing.image_path);
    imagePath = req.file.filename;
  } else if (req.body.removeImage === 'true') {
    deleteUpload(existing.image_path);
    imagePath = null;
  }
  // Re-linking to a different library item takes a fresh snapshot; the same link keeps its
  // snapshot (so editing a selection never hides a pending library change); a deleted library
  // item keeps its snapshot so the "removed" state survives.
  let libraryItemId = existing.library_item_id;
  let snapshot = existing.library_snapshot;
  if (data.libraryItemId && data.libraryItemId !== existing.library_item_id) {
    const lib = db.prepare('SELECT * FROM library_items WHERE id = ?').get(data.libraryItemId);
    libraryItemId = lib ? lib.id : null;
    snapshot = lib ? snapshotOf(lib) : null;
  } else if (!data.libraryItemId && existing.library_item_id) {
    libraryItemId = null;
    snapshot = null;
  }
  db.prepare(`
    UPDATE document_selections
    SET library_item_id = ?, library_snapshot = ?, title = ?, category = ?, supplier = ?, sku = ?, dimensions = ?, finish = ?,
        cost = ?, qty = ?, status = ?, notes = ?, image_path = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    libraryItemId, snapshot, data.title, data.category, data.supplier, data.sku, data.dimensions, data.finish,
    data.cost, data.qty, data.status, data.notes, imagePath, req.params.id
  );
  const row = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  res.json(serializeSelection(row));
});

// Resolve a "library item changed" warning. action: 'update' copies the library's spec fields
// (and photo) into the selection; 'keep' accepts the selection as-is; 'dismiss' clears the
// "library item deleted" notice. All three refresh/clear the snapshot. qty, status and notes
// are never touched.
router.post('/api/selections/:id/library-sync', (req, res) => {
  const row = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Selection not found' });
  const action = req.body && req.body.action;
  const lib = row.library_item_id ? db.prepare('SELECT * FROM library_items WHERE id = ?').get(row.library_item_id) : null;

  if (action === 'dismiss') {
    if (lib) return res.status(400).json({ error: 'Library item still exists' });
    db.prepare(`UPDATE document_selections SET library_snapshot = NULL WHERE id = ?`).run(row.id);
  } else if (action === 'keep' || action === 'update') {
    if (!lib) return res.status(400).json({ error: 'Library item no longer exists' });
    if (action === 'keep') {
      db.prepare(`UPDATE document_selections SET library_snapshot = ? WHERE id = ?`).run(snapshotOf(lib), row.id);
    } else {
      const snap = row.library_snapshot ? JSON.parse(row.library_snapshot) : {};
      let imagePath = row.image_path;
      if ((lib.image_path || null) !== (snap.imagePath || null)) {
        if (lib.image_path) {
          // Copy rather than share the file, so deleting either record can't orphan the other.
          const ext = path.extname(lib.image_path);
          const copy = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
          try {
            fs.copyFileSync(path.join(UPLOADS_DIR, lib.image_path), path.join(UPLOADS_DIR, copy));
            deleteUpload(row.image_path);
            imagePath = copy;
          } catch (e) { /* library file missing: leave the selection's photo alone */ }
        } else {
          deleteUpload(row.image_path);
          imagePath = null;
        }
      }
      db.prepare(`
        UPDATE document_selections
        SET title = ?, category = ?, supplier = ?, sku = ?, dimensions = ?, finish = ?, cost = ?,
            image_path = ?, library_snapshot = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(lib.title, lib.category, lib.supplier, lib.sku, lib.dimensions, lib.finish, lib.cost,
        imagePath, snapshotOf(lib), row.id);
    }
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
  res.json(serializeSelection(db.prepare('SELECT * FROM document_selections WHERE id = ?').get(row.id)));
});

router.delete('/api/selections/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Selection not found' });
  deleteUpload(existing.image_path);
  db.prepare('DELETE FROM document_selections WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
module.exports.snapshotOf = snapshotOf;
