const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, UPLOADS_DIR } = require('../db');
const { assertFlat, parseMoney } = require('../validate');

const router = express.Router();

const { imageUpload: upload } = require('../uploads');

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    supplier: row.supplier,
    sku: row.sku,
    dimensions: row.dimensions,
    finish: row.finish,
    cost: row.cost,
    notes: row.notes,
    sourceUrl: row.source_url || null,
    imagePath: row.image_path ? `/uploads/${row.image_path}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fields(body) {
  return {
    title: String(body.title || '').trim(),
    category: body.category ? String(body.category).trim() : null,
    supplier: body.supplier ? String(body.supplier).trim() : null,
    sku: body.sku ? String(body.sku).trim() : null,
    dimensions: body.dimensions ? String(body.dimensions).trim() : null,
    finish: body.finish ? String(body.finish).trim() : null,
    cost: parseMoney(body.cost, 'Cost'),
    notes: body.notes ? String(body.notes).trim() : null
  };
}

function deleteUpload(imagePath) {
  if (!imagePath) return;
  const full = path.join(UPLOADS_DIR, imagePath);
  fs.unlink(full, () => {});
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

router.get('/api/library', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM library_items
      WHERE title LIKE ? OR category LIKE ? OR supplier LIKE ?
      ORDER BY updated_at DESC
    `).all(like, like, like);
  } else {
    rows = db.prepare('SELECT * FROM library_items ORDER BY updated_at DESC').all();
  }
  res.json(rows.map(serialize));
});

router.post('/api/library', upload.single('image'), (req, res) => {
  const data = parseBody(fields, req);
  if (!data.title) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(400).json({ error: 'Title is required' });
  }
  const imagePath = req.file ? req.file.filename : null;
  const result = db.prepare(`
    INSERT INTO library_items (title, category, supplier, sku, dimensions, finish, cost, notes, image_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.title, data.category, data.supplier, data.sku, data.dimensions, data.finish, data.cost, data.notes, imagePath);
  const row = db.prepare('SELECT * FROM library_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(serialize(row));
});

router.put('/api/library/:id', upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM library_items WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) deleteUpload(req.file.filename);
    return res.status(404).json({ error: 'Not found' });
  }
  const data = parseBody(fields, req);
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
    UPDATE library_items
    SET title = ?, category = ?, supplier = ?, sku = ?, dimensions = ?, finish = ?, cost = ?, notes = ?,
        image_path = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(data.title, data.category, data.supplier, data.sku, data.dimensions, data.finish, data.cost, data.notes, imagePath, req.params.id);
  const row = db.prepare('SELECT * FROM library_items WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/api/library/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM library_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  deleteUpload(existing.image_path);
  db.prepare('DELETE FROM library_items WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
