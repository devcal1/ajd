const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, transaction, UPLOADS_DIR } = require('../db');

const router = express.Router();

// A revision is a frozen copy of a project's room-by-room document as it stood when it was
// issued (e.g. Rev A to the client). The snapshot is JSON in document_revisions.snapshot and
// its images are *copies* in uploads/, so later edits or deletes of the live document can
// never alter an issued revision.

const SELECTION_FIELDS = ['title', 'category', 'supplier', 'sku', 'dimensions', 'finish', 'cost', 'qty', 'status', 'notes', 'source_url'];
const COMPARE_FIELDS = [
  { key: 'category', label: 'Category' }, { key: 'supplier', label: 'Supplier' }, { key: 'sku', label: 'SKU' },
  { key: 'dimensions', label: 'Dimensions' }, { key: 'finish', label: 'Finish' }, { key: 'cost', label: 'Cost' },
  { key: 'qty', label: 'Qty' }, { key: 'status', label: 'Status' }, { key: 'notes', label: 'Notes' }
];

function revisionLabel(seq) {
  return seq <= 26 ? `Rev ${String.fromCharCode(64 + seq)}` : `Rev ${seq}`;
}

function copyUpload(filename) {
  if (!filename) return null;
  const copy = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(filename)}`;
  try {
    fs.copyFileSync(path.join(UPLOADS_DIR, filename), path.join(UPLOADS_DIR, copy));
    return copy;
  } catch (e) {
    return null; // source file missing: keep the row, drop the image
  }
}

function deleteUpload(filename) {
  if (filename) fs.unlink(path.join(UPLOADS_DIR, filename), () => {});
}

function snapshotImages(snapshot) {
  return snapshot.rooms.flatMap(r => r.selections.map(s => s.imagePath)).filter(Boolean);
}

// The live document in snapshot shape (image names still point at the live files).
function liveSnapshot(projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  let pdfSettings = {};
  try { pdfSettings = project.pdf_settings ? JSON.parse(project.pdf_settings) : {}; } catch (e) { /* defaults */ }
  const rooms = db.prepare('SELECT * FROM document_rooms WHERE project_id = ? ORDER BY id ASC').all(projectId);
  const selStmt = db.prepare('SELECT * FROM document_selections WHERE room_id = ? ORDER BY id ASC');
  return {
    project: { name: project.name, clientName: project.client_name, pdfSettings },
    rooms: rooms.map(room => ({
      name: room.name,
      selections: selStmt.all(room.id).map(sel => {
        const out = { imagePath: sel.image_path || null };
        SELECTION_FIELDS.forEach(f => { out[f] = sel[f]; });
        return out;
      })
    }))
  };
}

function createRevision(projectId, note) {
  const snapshot = liveSnapshot(projectId);
  snapshot.rooms.forEach(r => r.selections.forEach(s => { s.imagePath = copyUpload(s.imagePath); }));
  const seq = (db.prepare('SELECT MAX(seq) AS m FROM document_revisions WHERE project_id = ?').get(projectId).m || 0) + 1;
  const result = db.prepare(`
    INSERT INTO document_revisions (project_id, seq, label, note, snapshot) VALUES (?, ?, ?, ?, ?)
  `).run(projectId, seq, revisionLabel(seq), note || null, JSON.stringify(snapshot));
  return db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(result.lastInsertRowid);
}

function summary(row) {
  const snapshot = JSON.parse(row.snapshot);
  return {
    id: row.id,
    projectId: row.project_id,
    seq: row.seq,
    label: row.label,
    note: row.note,
    createdAt: row.created_at,
    roomCount: snapshot.rooms.length,
    selectionCount: snapshot.rooms.reduce((n, r) => n + r.selections.length, 0)
  };
}

// Same shape as the live /rooms API plus project fields, so document-print.html can render it.
function fullView(row) {
  const snapshot = JSON.parse(row.snapshot);
  return {
    ...summary(row),
    project: { id: row.project_id, ...snapshot.project },
    rooms: snapshot.rooms.map((room, i) => ({
      id: i + 1,
      name: room.name,
      selections: room.selections.map((sel, j) => ({
        ...sel,
        id: j + 1,
        sourceUrl: sel.source_url || null,
        imagePath: sel.imagePath ? `/uploads/${sel.imagePath}` : null
      }))
    }))
  };
}

function itemMap(snapshot) {
  const map = new Map();
  const seen = new Map();
  snapshot.rooms.forEach(room => room.selections.forEach(sel => {
    const base = `${room.name.toLowerCase()}|${String(sel.title).toLowerCase()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    map.set(`${base}|${n}`, { room: room.name, sel });
  }));
  return map;
}

function diffSnapshots(from, to) {
  const a = itemMap(from);
  const b = itemMap(to);
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;
  b.forEach((item, key) => {
    const old = a.get(key);
    if (!old) { added.push({ room: item.room, title: item.sel.title }); return; }
    const changes = [];
    COMPARE_FIELDS.forEach(f => {
      const x = old.sel[f.key] == null || old.sel[f.key] === '' ? null : old.sel[f.key];
      const y = item.sel[f.key] == null || item.sel[f.key] === '' ? null : item.sel[f.key];
      if (x !== y) changes.push({ field: f.key, label: f.label, from: x, to: y });
    });
    if (!!old.sel.imagePath !== !!item.sel.imagePath) {
      changes.push({ field: 'image', label: 'Photo', from: old.sel.imagePath ? 'has photo' : null, to: item.sel.imagePath ? 'has photo' : null });
    }
    if (changes.length) changed.push({ room: item.room, title: item.sel.title, changes });
    else unchanged++;
  });
  a.forEach((item, key) => { if (!b.has(key)) removed.push({ room: item.room, title: item.sel.title }); });
  return { added, removed, changed, unchanged };
}

function getRevisionOr404(id, res) {
  const row = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(id);
  if (!row) res.status(404).json({ error: 'Revision not found' });
  return row;
}

router.get('/api/projects/:projectId/revisions', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const rows = db.prepare('SELECT * FROM document_revisions WHERE project_id = ? ORDER BY seq DESC').all(req.params.projectId);
  res.json(rows.map(summary));
});

router.post('/api/projects/:projectId/revisions', (req, res) => {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const note = String((req.body && req.body.note) || '').trim().slice(0, 200);
  res.status(201).json(summary(createRevision(project.id, note)));
});

router.get('/api/revisions/:id', (req, res) => {
  const row = getRevisionOr404(req.params.id, res);
  if (row) res.json(fullView(row));
});

// Compare a revision with the live document (to=live, the default) or another revision.
router.get('/api/revisions/:id/compare', (req, res) => {
  const row = getRevisionOr404(req.params.id, res);
  if (!row) return;
  let target;
  let targetLabel = 'Current document';
  if (!req.query.to || req.query.to === 'live') {
    target = liveSnapshot(row.project_id);
  } else {
    const other = db.prepare('SELECT * FROM document_revisions WHERE id = ? AND project_id = ?').get(req.query.to, row.project_id);
    if (!other) return res.status(404).json({ error: 'Revision to compare with not found' });
    target = JSON.parse(other.snapshot);
    targetLabel = other.label;
  }
  res.json({ from: row.label, to: targetLabel, ...diffSnapshots(JSON.parse(row.snapshot), target) });
});

// Replace the live document with a revision's contents. The current document is first saved
// as its own revision (if it has any content) so a restore can always be undone. Library links
// are not restored: restored selections are plain copies.
router.post('/api/revisions/:id/restore', (req, res) => {
  const row = getRevisionOr404(req.params.id, res);
  if (!row) return;
  const snapshot = JSON.parse(row.snapshot);
  const liveImages = [];
  let backup = null;
  transaction(() => {
    const live = liveSnapshot(row.project_id);
    if (live.rooms.length) backup = createRevision(row.project_id, `Saved automatically before restoring ${row.label}`);
    db.prepare('SELECT image_path FROM document_selections WHERE room_id IN (SELECT id FROM document_rooms WHERE project_id = ?)')
      .all(row.project_id).forEach(r => { if (r.image_path) liveImages.push(r.image_path); });
    db.prepare('DELETE FROM document_rooms WHERE project_id = ?').run(row.project_id);
    const insRoom = db.prepare('INSERT INTO document_rooms (project_id, name) VALUES (?, ?)');
    const insSel = db.prepare(`
      INSERT INTO document_selections
        (room_id, title, category, supplier, sku, dimensions, finish, cost, qty, status, notes, source_url, image_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    snapshot.rooms.forEach(room => {
      const roomId = insRoom.run(row.project_id, room.name).lastInsertRowid;
      room.selections.forEach(s => {
        insSel.run(roomId, s.title, s.category, s.supplier, s.sku, s.dimensions, s.finish, s.cost, s.qty,
          s.status, s.notes, s.source_url || null, copyUpload(s.imagePath));
      });
    });
  });
  liveImages.forEach(deleteUpload);
  res.json({ restored: row.label, backup: backup ? summary(backup) : null });
});

router.delete('/api/revisions/:id', (req, res) => {
  const row = getRevisionOr404(req.params.id, res);
  if (!row) return;
  const images = snapshotImages(JSON.parse(row.snapshot));
  db.prepare('DELETE FROM document_revisions WHERE id = ?').run(row.id);
  images.forEach(deleteUpload);
  res.status(204).end();
});

// Called before a project is hard-deleted: its rows cascade, but the image copies would remain.
function deleteProjectRevisionFiles(projectId) {
  db.prepare('SELECT snapshot FROM document_revisions WHERE project_id = ?').all(projectId)
    .forEach(r => snapshotImages(JSON.parse(r.snapshot)).forEach(deleteUpload));
}

module.exports = router;
module.exports.deleteProjectRevisionFiles = deleteProjectRevisionFiles;
