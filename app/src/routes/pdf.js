const fs = require('fs');
const express = require('express');
const puppeteer = require('puppeteer-core');
const { db } = require('../db');

const router = express.Router();

// Dockerfile installs system Chromium and sets PUPPETEER_EXECUTABLE_PATH for
// the packaged app; these extra candidates just let Stage 5 be exercised
// from a plain local dev checkout (no Docker) on any of the three platforms.
const LOCAL_DEV_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ]
};

function findBrowserExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = LOCAL_DEV_CANDIDATES[process.platform] || [];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function slugifyFilename(name) {
  return String(name || 'design-document').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design-document';
}

router.get('/api/projects/:id/document.pdf', async (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    return res.status(500).json({
      error: 'No Chromium/Chrome executable found for PDF rendering. Set PUPPETEER_EXECUTABLE_PATH, or use the Export PDF page\'s own Print dialog instead.'
    });
  }

  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    if (req.headers.cookie) {
      await page.setExtraHTTPHeaders({ cookie: req.headers.cookie });
    }
    // Navigate via the app's own loopback port, not req.get('host') — behind
    // Umbrel's app_proxy (or any reverse proxy) that Host header points at
    // a public domain/port the container may not be able to reach itself.
    const port = process.env.PORT || 3000;
    await page.goto(`http://127.0.0.1:${port}/document-print.html?id=${req.params.id}`, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '28px', bottom: '28px', left: '28px', right: '28px' }
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slugifyFilename(project.name)}-design-document.pdf"`
    });
    // page.pdf() returns a Uint8Array, not a Buffer instance — express's
    // res.send would otherwise fail Buffer.isBuffer() and JSON-serialize it.
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error('[pdf] generation failed:', err.message);
    res.status(500).json({ error: 'PDF generation failed' });
  } finally {
    if (browser) await browser.close();
  }
});

module.exports = router;
