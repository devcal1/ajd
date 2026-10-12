function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function money(n) {
  const v = Number(n || 0);
  const d = Number.isInteger(v) ? 0 : 2;
  return '$' + v.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function guard(fn) {
  let busy = false;
  return async function (...args) {
    if (args[0] && typeof args[0].preventDefault === 'function') args[0].preventDefault();
    if (busy) return;
    busy = true;
    try {
      return await fn.apply(this, args);
    } finally {
      busy = false;
    }
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  const menu = document.querySelector('details.menu[open]');
  if (menu) { menu.removeAttribute('open'); return; }
  const m = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!m) return;
  m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function logout() {
  await fetch('/logout', { method: 'POST' });
  window.location.href = '/login.html';
}
