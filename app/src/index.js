const path = require('path');
const express = require('express');
const { UPLOADS_DIR } = require('./db');
const { sessionMiddleware, requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const libraryRoutes = require('./routes/library');
const projectsRoutes = require('./routes/projects');
const documentsRoutes = require('./routes/documents');
const pdfRoutes = require('./routes/pdf');
const backupsRoutes = require('./routes/backups');
const passwordRoutes = require('./routes/password');
const { startSchedule } = require('./backup');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
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
app.use(pdfRoutes);
app.use(backupsRoutes);
app.use(passwordRoutes);
app.use(express.static(PUBLIC_DIR));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[ajd] listening on http://localhost:${PORT}`);
});

startSchedule();
