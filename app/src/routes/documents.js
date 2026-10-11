const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { db, UPLOADS_DIR } = require('../db');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    cb(null, /^image\//.test(file.mimetype));
  }
});

function deleteUpload(imagePath) {
  if (!imagePath) return;
  fs.unlink(path.join(UPLOADS_DIR, imagePath), () => {});
}

function serializeSelection(row) {
  return {
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
    cost: body.cost !== undefined && body.cost !== '' ? Number(body.cost) : null,
    qty: body.qty !== undefined && body.qty !== '' ? Math.max(1, parseInt(body.qty, 10) || 1) : 1,
    status: body.status ? String(body.status).trim() : 'proposed',
    notes: body.notes ? String(body.notes).trim() : null,
    libraryItemId: body.libraryItemId ? Number(body.libraryItemId) : null
  };
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
  const data = selectionFields(req.body);
  if (!data.title) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  const imagePath = req.file ? req.file.filename : null;
  const result = db.prepare(`
    INSERT INTO document_selections
      (room_id, library_item_id, title, category, supplier, sku, dimensions, finish, cost, qty, status, notes, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.roomId, data.libraryItemId, data.title, data.category, data.supplier, data.sku,
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
  const data = selectionFields(req.body);
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
  db.prepare(`
    UPDATE document_selections
    SET library_item_id = ?, title = ?, category = ?, supplier = ?, sku = ?, dimensions = ?, finish = ?,
        cost = ?, qty = ?, status = ?, notes = ?, image_path = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.libraryItemId, data.title, data.category, data.supplier, data.sku, data.dimensions, data.finish,
    data.cost, data.qty, data.status, data.notes, imagePath, req.params.id
  );
  const row = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  res.json(serializeSelection(row));
});

router.delete('/api/selections/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM document_selections WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Selection not found' });
  deleteUpload(existing.image_path);
  db.prepare('DELETE FROM document_selections WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
