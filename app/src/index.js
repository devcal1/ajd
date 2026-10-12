const path = require('path');
const express = require('express');
const { UPLOADS_DIR } = require('./db');
const { sessionMiddleware, requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const projectsRoutes = require('./routes/projects');
const documentsRoutes = require('./routes/documents');
const revisionsRoutes = require('./routes/revisions');
const clipRoutes = require('./routes/clip');
const pdfRoutes = require('./routes/pdf');
const backupsRoutes = require('./routes/backups');
const passwordRoutes = require('./routes/password');
const { startSchedule } = require('./backup');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
// JSON bodies are flat key/values everywhere in this app; reject nested values up front.
app.use((req, res, next) => {
  try { require('./validate').assertFlat(req.body); } catch (err) { return next(err); }
  next();
});
app.use(sessionMiddleware);

// Public, unauthenticated: the login page's own assets, and the login/logout endpoints.
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
app.get('/login.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.use(authRoutes);

// Everything below this line requires an authenticated session.
app.use(requireAuth);

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(libraryRoutes);
app.use(projectsRoutes);
app.use(documentsRoutes);
app.use(revisionsRoutes);
app.use(clipRoutes);
app.use(pdfRoutes);
app.use(backupsRoutes);
app.use(passwordRoutes);
app.use(express.static(PUBLIC_DIR));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Last-resort error handler: bad JSON, oversize uploads and unexpected throws come back as
// JSON (the frontend's api() reads `error`), never as an HTML stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message = status < 500 ? err.message : 'Something went wrong';
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'That file is too large (8MB maximum)'; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON'; }
  else if (err.name === 'MulterError') { status = 400; message = 'Upload problem: ' + err.message; }
  if (status >= 500) console.error('[ajd] unhandled error:', err);
  res.status(status).json({ error: message });
});

// One bad request must never take the whole server (and every other session) down.
process.on('unhandledRejection', err => console.error('[ajd] unhandled rejection:', err));

app.listen(PORT, () => {
  console.log(`[ajd] listening on http://localhost:${PORT}`);
});

startSchedule();
