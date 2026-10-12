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

// IPv6 text -> 16 bytes (null if malformed). The URL parser rewrites "::ffff:127.0.0.1" to the
// hex form "::ffff:7f00:1", so address checks must work on bytes, not on text patterns.
function ipv6ToBytes(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.some(n => !(n >= 0 && n <= 255))) return null;
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail];
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g || '0', 16);
    if (!(n >= 0 && n <= 0xffff)) return null;
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

// Only public, global-unicast addresses are allowed; anything that embeds an IPv4 address
// (mapped, NAT64, 6to4) is judged by the embedded address.
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const b = ipv6ToBytes(ip);
  if (!b) return true;
  const v4 = i => `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
  if (b.slice(0, 10).every(x => x === 0) && b[10] === 0xff && b[11] === 0xff) return isPrivateIPv4(v4(12)); // ::ffff:a.b.c.d
  if (b.slice(0, 12).every(x => x === 0)) return true; // ::, ::1, IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every(x => x === 0)) return isPrivateIPv4(v4(12)); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIPv4(v4(2)); // 6to4
  return (b[0] & 0xe0) !== 0x20; // 2000::/3 only
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
        clearTimeout(deadline);
        try {
          return resolve({ redirect: new URL(res.headers.location, url).href });
        } catch (e) {
          // a hostile site can send an unparseable Location; throwing here would crash the process
          return reject(new Error('The site sent an invalid redirect'));
        }
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(new Error('That file is too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => { clearTimeout(deadline); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: url.href }); });
      res.on('error', reject);
    });
    // Idle timeout plus an overall deadline, so a slow drip cannot hold the request open.
    const deadline = setTimeout(() => req.destroy(new Error('The site took too long to respond')), 15000);
    req.setTimeout(10000, () => req.destroy(new Error('The site took too long to respond')));
    // Backstop to guardedLookup: whatever we actually connected to must be public (IP-literal
    // hosts skip DNS lookup entirely).
    req.on('socket', socket => {
      const check = () => {
        if (socket.remoteAddress && isPrivateAddress(socket.remoteAddress)) req.destroy(new Error('That address is not allowed'));
      };
      if (socket.connecting) socket.once('connect', check); else check();
    });
    req.on('error', err => { clearTimeout(deadline); reject(err); });
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
  // fromCodePoint throws RangeError above U+10FFFF; a hostile "&#99999999;" must not fail the clip
  const cp = n => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
  return String(s || '')
    .replace(/&#(\d+);/g, (m, n) => cp(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => cp(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Linear tag scanner (indexOf, no regex over the whole page). A regex like /<meta\b[^>]*>/ goes
// QUADRATIC on a page full of unclosed "<meta " (measured: 128KB took 6s, a 2MB page would take
// ~25 minutes) and freezes the single-threaded server for every user. Here each position is
// visited once: the next '>' is cached and a "tag" longer than 4KB is skipped, not retried.
function scanTags(lower, html, name, limit) {
  const out = [];
  const needle = '<' + name;
  let i = 0;
  let gt = -1;
  while (out.length < limit) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) break;
    const c = lower.charCodeAt(idx + needle.length);
    // must be followed by whitespace, '>' or '/', so "<metadata" is not a "<meta"
    if (!(c === 32 || c === 9 || c === 10 || c === 13 || c === 62 || c === 47)) { i = idx + 1; continue; }
    if (gt < idx) {
      gt = lower.indexOf('>', idx);
      if (gt < 0) break;
    }
    if (gt - idx > 4096) { i = idx + needle.length; continue; }
    out.push({ end: gt + 1, tag: html.slice(idx, gt + 1) });
    i = gt + 1;
  }
  return out;
}

// Returns a function name -> content for the page's <meta property|name|itemprop=... content=...>.
function readMeta(lower, html) {
  const map = new Map();
  for (const { tag } of scanTags(lower, html, 'meta', 400)) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']{1,100})["']/i);
    if (!key) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const name = key[1].toLowerCase();
    if (content && !map.has(name)) map.set(name, decodeEntities(content[1] != null ? content[1] : content[2]).trim());
  }
  return name => map.get(name) || '';
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
  let s = ((String(raw || '').match(/\d[\d.,]*/) || [''])[0]).replace(/[.,]+$/, '');
  if (!s) return '';
  // "1.299" / "1,299" (exactly three digits after a single separator) is a thousands separator.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  // "1,299.00" -> 1299.00; "1.299,00" -> 1299.00; "1299,50" -> 1299.50
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

function extractProduct(html, pageUrl) {
  const lower = html.toLowerCase();
  const meta = readMeta(lower, html);
  let product = null;
  for (const { end, tag } of scanTags(lower, html, 'script', 60)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(tag)) continue;
    const close = lower.indexOf('</script', end);
    if (close < 0) break;
    try {
      product = findProduct(JSON.parse(html.slice(end, Math.min(close, end + 1000000))));
      if (product) break;
    } catch (e) { /* ignore malformed JSON-LD */ }
  }
  const p = product || {};
  const abs = u => { try { return new URL(u, pageUrl).href; } catch (e) { return ''; } };
  const offers = [].concat(p.offers || []);
  const offer = offers.find(o => o && (o.price || o.lowPrice)) || offers[0];
  let titleTag = '';
  const titleOpen = scanTags(lower, html, 'title', 1)[0];
  if (titleOpen) {
    const close = lower.indexOf('</title', titleOpen.end);
    if (close > 0) titleTag = html.slice(titleOpen.end, Math.min(close, titleOpen.end + 500));
  }
  const images = [];
  [].concat(p.image || [], meta('og:image'), meta('twitter:image')).forEach(i => {
    const raw = typeof i === 'object' && i ? (i.url || '') : i;
    const u = raw ? abs(raw) : '';
    if (/^https?:/.test(u) && !images.includes(u)) images.push(u);
  });
  return {
    url: pageUrl,
    title: decodeEntities(str(p.name) || meta('og:title') || (titleTag || '').trim()).replace(/\s+/g, ' ').trim(),
    supplier: decodeEntities(str(p.brand) || meta('og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '')),
    sku: str(p.sku) || str(p.mpn),
    category: str(p.category),
    price: parsePrice((offer && (offer.price || offer.lowPrice)) || meta('product:price:amount') || meta('og:price:amount')),
    notes: decodeEntities(str(p.description) || meta('og:description')).replace(/\s+/g, ' ').trim().slice(0, 500),
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
    // Don't echo raw resolver errors (they include the whole hostname).
    const unreachable = typeof err.code === 'string' && /^E[A-Z0-9_]+$/.test(err.code);
    res.status(400).json({ error: unreachable ? 'Could not reach that website' : (err.message || 'Could not read that page') });
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

// Express 4 does not catch rejections from async handlers, and on current Node an unhandled
// rejection kills the process, so every async route goes through this wrapper.
const safely = handler => (req, res) => {
  Promise.resolve(handler(req, res)).catch(err => {
    console.error('[clip] unexpected error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong' });
  });
};

router.post('/api/clip/save', safely(async (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const sourceUrl = cleanUrl(body.sourceUrl);
  const cost = body.cost !== undefined && body.cost !== '' && body.cost !== null ? Number(body.cost) : null;
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 1e9)) return res.status(400).json({ error: 'Cost must be a number between 0 and 1,000,000,000' });

  let room = null;
  if (body.roomId !== undefined && body.roomId !== null && body.roomId !== '') {
    const roomId = Number(body.roomId);
    if (!Number.isInteger(roomId) || roomId < 1) return res.status(400).json({ error: 'Invalid room' });
    room = db.prepare('SELECT id, project_id FROM document_rooms WHERE id = ?').get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
  }

  let imagePath = null;
  let imageFailed = false;
  if (body.imageUrl) {
    try { imagePath = await downloadImage(String(body.imageUrl), sourceUrl); } catch (e) { imageFailed = true; }
  }
  let selectionImage = null;

  try {
    // The selection gets its own copy of the photo, as every other selection image is its own file.
    if (room && imagePath) {
      selectionImage = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(imagePath)}`;
      fs.copyFileSync(path.join(UPLOADS_DIR, imagePath), path.join(UPLOADS_DIR, selectionImage));
    }
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
        const qty = Math.min(100000, Math.max(1, parseInt(body.qty, 10) || 1));
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
}));

module.exports = router;
module.exports.isPrivateAddress = isPrivateAddress;
module.exports.extractProduct = extractProduct;
