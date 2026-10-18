// Small helpers shared by every tab: dates, formatting, pop-up sheets, toasts and icons.

// ---------- text ----------
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Accepts "82,5" as well as "82.5" (some iPhone keyboards show a comma)
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function fmt(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Trims trailing zeros: 80 -> "80", 82.5 -> "82.5"
export const kg = (n) => (n === null || n === undefined ? '–' : String(Math.round(n * 100) / 100));

// ---------- dates (all dates are local "YYYY-MM-DD" strings) ----------
export function isoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const today = () => isoDate();
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids daylight-saving edge cases
}
export function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
export function weekStart(iso) { // Monday
  const d = parseDate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}
export function fmtDate(iso, opts = { day: 'numeric', month: 'short' }) {
  return parseDate(iso).toLocaleDateString('en-GB', opts);
}
export function relDay(iso) {
  const diff = daysBetween(iso, today());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function weekLabel(start) {
  const end = addDays(start, 6);
  const a = parseDate(start), b = parseDate(end);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.getDate()}${sameMonth ? '' : ' ' + fmtDate(start, { month: 'short' })}–${fmtDate(end)}`;
}
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ---------- theme ----------
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', dark ? '#0f1115' : '#f6f7f9'));
}

// ---------- feedback ----------
export function buzz(ms = 10) { try { navigator.vibrate?.(ms); } catch { /* not supported on iPhone */ } }

let toastTimer;
export function toast(message, { undo, duration = 3500 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button class="toast-undo">Undo</button>' : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  if (undo) {
    el.querySelector('.toast-undo').onclick = async () => {
      el.classList.remove('show');
      await undo();
    };
  }
}

// ---------- bottom sheet (pop-up panel) ----------
// openSheet(title, html, onMount) -> { el, close }. onMount(el, close) wires up buttons.
export function openSheet(title, html, onMount) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="sheet-body">${html}</div>
    </div>`;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
  };
  wrap.querySelector('.sheet-backdrop').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  const body = wrap.querySelector('.sheet-body');
  onMount?.(body, close);
  return { el: body, close };
}

// A yes/no question using the sheet, so it looks like the rest of the app.
export function ask(title, message, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let answered = false;
    const s = openSheet(title, `
      <p>${esc(message)}</p>
      <div class="row-btns">
        <button class="btn" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button>
      </div>`, (el, close) => {
      el.querySelector('[data-no]').onclick = () => { answered = true; close(); resolve(false); };
      el.querySelector('[data-yes]').onclick = () => { answered = true; close(); resolve(true); };
    });
    s.el.closest('.sheet-wrap').querySelector('.sheet-backdrop').addEventListener('click', () => { if (!answered) resolve(false); });
    s.el.closest('.sheet-wrap').querySelector('[data-close]').addEventListener('click', () => { if (!answered) resolve(false); });
  });
}

// Segmented control: [{value,label}] -> html; read back with segValue(container, name)
export function seg(name, options, current) {
  return `<div class="seg" data-seg="${name}">${options.map(o =>
    `<button type="button" data-value="${esc(o.value)}" class="${String(o.value) === String(current) ? 'on' : ''}">${esc(o.label)}</button>`).join('')}</div>`;
}
export function wireSeg(container, onChange) {
  container.querySelectorAll('.seg').forEach(segEl => {
    segEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      segEl.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      onChange?.(segEl.dataset.seg, b.dataset.value);
    });
  });
}
export function segValue(container, name) {
  return container.querySelector(`.seg[data-seg="${name}"] button.on`)?.dataset.value ?? null;
}

// ---------- icons (inline SVG so they work offline) ----------
const ICONS = {
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  food: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v4H17"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0L12 13z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  habits: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 12.5l3 3 6-7"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.6L20.5 8H7"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>',
  flame: '<path d="M12 21c-4 0-6.5-2.6-6.5-6.2 0-3.8 3.3-5.6 3.8-9.8 2.4 1.5 3.4 3.8 3.3 6.1 1-.7 1.7-1.8 2-3.1 2 1.6 3.9 4 3.9 6.8 0 3.6-2.5 6.2-6.5 6.2z"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  chart: '<path d="M4 20V4M4 20h16M8 15l4-5 3 3 5-6"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// Page header used by sub-pages ("‹ Back   Title")
export function subHeader(title, backHash, right = '') {
  return `<div class="subhead"><a class="back" href="${backHash}">${icon('left')}<span>Back</span></a><h2>${esc(title)}</h2><div class="subhead-right">${right}</div></div>`;
}

// Download or share a file. iPhones get the share sheet ("Save to Files").
export async function saveFile(filename, text, mime) {
  const file = new File([text], filename, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false; // you closed the share sheet
      if (err.name === 'NotAllowedError') {
        // The browser wants a fresh tap before sharing: offer a button.
        return new Promise(resolve => {
          openSheet('File ready', `<p>${esc(filename)} is ready.</p><button class="btn primary block" data-go>${icon('share')} Save / share file</button>`, (el, close) => {
            el.querySelector('[data-go]').onclick = async () => {
              try { await navigator.share({ files: [file], title: filename }); resolve(true); } catch { resolve(false); }
              close();
            };
          });
        });
      }
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
