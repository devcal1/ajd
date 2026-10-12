const path = require('path');
const multer = require('multer');
const { UPLOADS_DIR } = require('./db');
const { InputError } = require('./validate');

// The stored file's extension comes from the verified-by-multer MIME type, never from the
// client-supplied filename: otherwise "x.html" sent as image/png would be saved as .html and
// served back by /uploads as an HTML page. SVG is deliberately not accepted (scriptable).
const IMAGE_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif'
};

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename(req, file, cb) {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${IMAGE_EXT[file.mimetype] || path.extname('')}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Say so instead of silently saving without the photo.
    if (!IMAGE_EXT[file.mimetype]) return cb(new InputError('Photos must be JPEG, PNG, WebP, GIF or AVIF images'));
    cb(null, true);
  }
});

module.exports = { imageUpload, IMAGE_EXT };
