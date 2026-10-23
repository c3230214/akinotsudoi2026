const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes every interpolation unless wrapped with raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x?.__raw ? x.value : esc(x))).join('');
    else out += v?.__raw ? v.value : esc(v);
    out += strings[i + 1];
  });
  return { __raw: true, value: out, toString() { return out; } };
}

export const raw = (value) => ({ __raw: true, value: String(value), toString() { return String(value); } });

export function render(el, content) {
  el.innerHTML = String(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const COLOR_LABELS = { red: '赤', green: '緑', lightblue: '水色', white: '白' };
export const COLORS = ['red', 'green', 'lightblue', 'white'];

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let toastTimer = null;
export function toast(text, { kind = 'info', ms = 3500 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `toast show toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
/** Display only. The server recomputes lines and N from its own data. */
export function previewDraws(marks) {
  const lines = LINES.filter((l) => l.every((i) => marks[i] === true)).length;
  const n = lines === 0 ? 0 : lines <= 2 ? 1 : lines <= 7 ? 2 : 3;
  return { lines, n };
}
