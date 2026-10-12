// Small input validators shared by the data routes. Failures throw an InputError, which the
// error middleware in index.js turns into a 400 with the message (status < 500 is shown as-is).
class InputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const MAX_MONEY = 1e9;

// '' / undefined / null -> null (not set). Anything else must be a finite number in range.
function parseMoney(raw, label) {
  if (raw === undefined || raw === null || raw === '') return null;
  // Only real numbers or plain decimal strings: Number() would also accept ' ', true, '0x10', '1e3'.
  const plain = typeof raw === 'number' || (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw));
  if (!plain) throw new InputError(`${label} must be a number`);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) {
    throw new InputError(`${label} must be a number between 0 and 1,000,000,000`);
  }
  return n;
}

function parseQty(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  // parseInt would silently truncate "3.7" to 3 and read "1e2" as 1.
  const n = typeof raw === 'number' ? raw : (/^\s*\d+\s*$/.test(String(raw)) ? Number(raw) : NaN);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new InputError('Quantity must be a whole number between 1 and 100,000');
  return n;
}

function parseChoice(raw, allowed, fallback, label) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim();
  if (!allowed.includes(value)) throw new InputError(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
}

// Request bodies here are flat key/values. Arrays and objects (repeated multipart fields, JSON
// nesting) would otherwise be stringified into junk like "a,b" or "[object Object]".
function assertFlat(body) {
  for (const [key, value] of Object.entries(body || {})) {
    if (value !== null && typeof value === 'object') throw new InputError(`Invalid value for "${key}"`);
  }
}

module.exports = { assertFlat, InputError, parseMoney, parseQty, parseChoice };
