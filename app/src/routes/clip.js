const fs = require('fs');
const path = require('path');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const express = require('express');
const { db, transaction, UPLOADS_DIR } = require('../db');
const { snapshotOf } = require('./documents');

const router = express.Router();

// Web clipper. Two ways in, one review screen (clip.html):
//  - the "Clip to AJD" bookmarklet reads product details in the browser and hands them to
//    clip.html itself;
//  - "paste a URL" has this server fetch the page (POST /api/clip/fetch) and read the same
//    details from its markup.
// POST /api/clip/save then stores the item in the library and, optionally, in a room.
//
// The server fetching arbitrary URLs is the one new outbound use of the network, so every
// connection (including redirects) refuses private/internal addresses: the app must not be
// usable to probe the LAN it is hosted on.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

// Validates at connect time (not just before), so a DNS answer that changes between a check
// and the connection cannot slip a private address through.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddress(a.address))) {
      return callback(new Error('That address is not allowed'));
    }
    callback(null, address, family);
  });
}

function parseHttpUrl(raw) {
  let url;
  try { url = new URL(raw); } catch (e) { throw new Error('That is not a valid web address'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https addresses can be clipped');
  if (url.username || url.password) throw new Error('Addresses with a username or password are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error('That address is not allowed');
  return url;
}

function request(url, { maxBytes, accept, referer }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET',
      lookup: guardedLookup,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: accept,
        'Accept-Language': 'en-AU,en;q=0.9',
        'Accept-Encoding': 'identity',
        ...(referer ? { Referer: referer } : {})
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).href });
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error('That file is too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: url.href }));
      res.on('error', reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error('The site took too long to respond')));
    req.on('error', reject);
    req.end();
  });
}

async function safeFetch(rawUrl, opts) {
  let url = parseHttpUrl(rawUrl);
  for (let hops = 0; hops < 5; hops++) {
    const out = await request(url, opts);
    if (!out.redirect) return out;
    url = parseHttpUrl(out.redirect);
  }
  throw new Error('Too many redirects');
}

// ---- Page parsing (the server-side twin of the bookmarklet in library.html) ----

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function metaContent(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i);
    if (!key || key[1].toLowerCase() !== name) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (content) return decodeEntities(content[1] != null ? content[1] : content[2]).trim();
  }
  return '';
}

function findProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const found = findProduct(n); if (found) return found; }
    return null;
  }
  if (node['@type'] && String(node['@type']).includes('Product')) return node;
  return node['@graph'] ? findProduct(node['@graph']) : null;
}

function str(v) {
  if (v == null) return '';
  return typeof v === 'object' ? String(v.name || v.url || '') : String(v);
}

function parsePrice(raw) {
  let s = String(raw || '').replace(/[^0-9.,]/g, '');
  if (!s) return '';
  // "1,299.00" -> 1299.00; "1.299,00" -> 1299.00; "1299,50" -> 1299.50
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function extractProduct(html, pageUrl) {
  let product = null;
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of scripts) {
    try {
      const json = JSON.parse(block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, ''));
      product = findProduct(json);
      if (product) break;
    } catch (e) { /* ignore malformed JSON-LD */ }
  }
  const p = product || {};
  const abs = u => { try { return new URL(u, pageUrl).href; } catch (e) { return ''; } };
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const images = [];
  [].concat(p.image || [], metaContent(html, 'og:image'), metaContent(html, 'twitter:image')).forEach(i => {
    const raw = typeof i === 'object' && i ? (i.url || '') : i;
    const u = raw ? abs(raw) : '';
    if (/^https?:/.test(u) && !images.includes(u)) images.push(u);
  });
  return {
    url: pageUrl,
    title: decodeEntities(str(p.name) || metaContent(html, 'og:title') || (titleTag || '').trim()).replace(/\s+/g, ' ').trim(),
    supplier: decodeEntities(str(p.brand) || metaContent(html, 'og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '')),
    sku: str(p.sku) || str(p.mpn),
    category: str(p.category),
    price: parsePrice((offer && (offer.price || offer.lowPrice)) || metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount')),
    notes: decodeEntities(str(p.description) || metaContent(html, 'og:description')).replace(/\s+/g, ' ').trim().slice(0, 500),
    images: images.slice(0, 8)
  };
}

router.post('/api/clip/fetch', async (req, res) => {
  try {
    const out = await safeFetch(String((req.body && req.body.url) || '').trim(), {
      maxBytes: PAGE_MAX_BYTES,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
    });
    if (out.status >= 400) {
      return res.status(502).json({ error: `The site refused the request (${out.status}). Try the "Clip to AJD" bookmark on the page instead, or enter the details by hand.` });
    }
    res.json(extractProduct(out.body.toString('utf8'), out.url));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not read that page' });
  }
});

// Is this page already in the library? (warns before a duplicate is made)
router.get('/api/clip/existing', (req, res) => {
  const url = String(req.query.url || '');
  const row = url ? db.prepare('SELECT id, title FROM library_items WHERE source_url = ? LIMIT 1').get(url) : null;
  res.json({ existing: row || null });
});

async function downloadImage(imageUrl, referer) {
  const out = await safeFetch(imageUrl, { maxBytes: IMAGE_MAX_BYTES, accept: 'image/*', referer });
  const type = String(out.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (out.status >= 400 || !IMAGE_TYPES[type]) throw new Error('Not a usable image');
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${IMAGE_TYPES[type]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), out.body);
  return filename;
}

function cleanUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) { return null; }
}

const text = v => (v == null || String(v).trim() === '' ? null : String(v).trim());

router.post('/api/clip/save', async (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const sourceUrl = cleanUrl(body.sourceUrl);
  const cost = body.cost !== undefined && body.cost !== '' && body.cost !== null ? Number(body.cost) : null;
  if (cost !== null && !Number.isFinite(cost)) return res.status(400).json({ error: 'Cost must be a number' });

  let room = null;
  if (body.roomId) {
    room = db.prepare('SELECT id, project_id FROM document_rooms WHERE id = ?').get(body.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
  }

  let imagePath = null;
  let imageFailed = false;
  if (body.imageUrl) {
    try { imagePath = await downloadImage(String(body.imageUrl), sourceUrl); } catch (e) { imageFailed = true; }
  }
  // The selection gets its own copy of the photo, as every other selection image is its own file.
  let selectionImage = null;
  if (room && imagePath) {
    selectionImage = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(imagePath)}`;
    fs.copyFileSync(path.join(UPLOADS_DIR, imagePath), path.join(UPLOADS_DIR, selectionImage));
  }

  try {
    let libraryId;
    let selectionId = null;
    transaction(() => {
      libraryId = db.prepare(`
        INSERT INTO library_items (title, category, supplier, sku, dimensions, finish, cost, notes, image_path, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, text(body.category), text(body.supplier), text(body.sku), text(body.dimensions),
        text(body.finish), cost, text(body.notes), imagePath, sourceUrl).lastInsertRowid;
      if (room) {
        const lib = db.prepare('SELECT * FROM library_items WHERE id = ?').get(libraryId);
        const qty = Math.max(1, parseInt(body.qty, 10) || 1);
        selectionId = db.prepare(`
          INSERT INTO document_selections
            (room_id, library_item_id, library_snapshot, title, category, supplier, sku, dimensions, finish,
             cost, qty, status, notes, image_path, source_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
        `).run(room.id, libraryId, snapshotOf(lib), lib.title, lib.category, lib.supplier, lib.sku, lib.dimensions,
          lib.finish, lib.cost, qty, lib.notes, selectionImage, sourceUrl).lastInsertRowid;
      }
    });
    res.status(201).json({ libraryItemId: libraryId, selectionId, projectId: room ? room.project_id : null, imageFailed });
  } catch (err) {
    [imagePath, selectionImage].forEach(f => { if (f) fs.unlink(path.join(UPLOADS_DIR, f), () => {}); });
    res.status(500).json({ error: 'Could not save the clip' });
  }
});

module.exports = router;
module.exports.isPrivateAddress = isPrivateAddress;
module.exports.extractProduct = extractProduct;
