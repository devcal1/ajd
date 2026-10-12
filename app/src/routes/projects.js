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

const DEFAULT_PDF_SETTINGS = {
  showCosts: true,
  showImages: true,
  showApproval: true,
  showDetails: true,
  showSupplierColumn: true,
  headerText: '',
  grouping: 'room'
};

// Fill gaps and coerce types so a stored/posted value can never break the print page.
function normalizePdfSettings(raw) {
  let input = raw;
  if (typeof raw === 'string') {
    try { input = JSON.parse(raw); } catch (e) { input = {}; }
  }
  input = input && typeof input === 'object' ? input : {};
  const out = { ...DEFAULT_PDF_SETTINGS };
  ['showCosts', 'showImages', 'showApproval', 'showDetails', 'showSupplierColumn'].forEach(k => {
    if (typeof input[k] === 'boolean') out[k] = input[k];
  });
  if (typeof input.headerText === 'string') out.headerText = input.headerText.trim().slice(0, 120);
  if (input.grouping === 'supplier') out.grouping = 'supplier';
  return out;
}

function serialize(row) {
  return {
    pdfSettings: normalizePdfSettings(row.pdf_settings),
    id: row.id,
    name: row.name,
    clientName: row.client_name,
    status: row.status,
    budget: row.budget,
    notes: row.notes,
    coverImagePath: row.cover_image_path ? `/uploads/${row.cover_image_path}` : null,
    archived: !!row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fields(body) {
  return {
    name: String(body.name || '').trim(),
    clientName: body.clientName ? String(body.clientName).trim() : null,
    status: body.status ? String(body.status).trim() : 'active',
    budget: body.budget !== undefined && body.budget !== '' ? Number(body.budget) : null,
    notes: body.notes ? String(body.notes).trim() : null
  };
}

function deleteUpload(imagePath) {
  if (!imagePath) return;
  fs.unlink(path.join(UPLOADS_DIR, imagePath), () => {});
}

router.get('/api/projects', (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const rows = includeArchived
    ? db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all()
    : db.prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serialize));
});

router.get('/api/projects/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(serialize(row));
});

router.post('/api/projects', upload.single('coverImage'), (req, res) => {
  const data = fields(req.body);
  if (!data.name) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Name is required' });
  }
  const coverImagePath = req.file ? req.file.filename : null;
  const result = db.prepare(`
    INSERT INTO projects (name, client_name, status, budget, notes, cover_image_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.name, data.clientName, data.status, data.budget, data.notes, coverImagePath);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/api/projects/:id', upload.single('coverImage'), (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(404).json({ error: 'Not found' });
  }
  const data = fields(req.body);
  if (!data.name) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Name is required' });
  }
  // Absent field (e.g. the dashboard's edit form) keeps whatever is stored.
  const pdfSettings = req.body.pdfSettings !== undefined
    ? JSON.stringify(normalizePdfSettings(req.body.pdfSettings))
    : existing.pdf_settings;
  let coverImagePath = existing.cover_image_path;
  if (req.file) {
    deleteUpload(existing.cover_image_path);
    coverImagePath = req.file.filename;
  } else if (req.body.removeCoverImage === 'true') {
    deleteUpload(existing.cover_image_path);
    coverImagePath = null;
  }
  db.prepare(`
    UPDATE projects
    SET name = ?, client_name = ?, status = ?, budget = ?, notes = ?, cover_image_path = ?, pdf_settings = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(data.name, data.clientName, data.status, data.budget, data.notes, coverImagePath, pdfSettings, req.params.id);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.post('/api/projects/:id/archive', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const archive = req.body && req.body.archive !== false;
  db.prepare(`
    UPDATE projects SET archived_at = ?, updated_at = datetime('now') WHERE id = ?
  `).run(archive ? new Date().toISOString() : null, req.params.id);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/api/projects/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!existing.archived_at) {
    return res.status(400).json({ error: 'Archive the project before deleting it' });
  }
  deleteUpload(existing.cover_image_path);
  require('./revisions').deleteProjectRevisionFiles(existing.id);
  db.prepare(`
    SELECT image_path FROM document_selections
    WHERE room_id IN (SELECT id FROM document_rooms WHERE project_id = ?)
  `).all(existing.id).forEach(row => deleteUpload(row.image_path));
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
