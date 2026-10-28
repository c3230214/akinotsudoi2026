// 3D venue map (requirements §18, §19). The venue is drawn as an axonometric
// view from diagonally above: each place is an extruded block whose top and
// visible sides are SVG polygons, so heights and depth are visible. Labels are
// HTML buttons over the SVG with a fixed font size, so they stay readable at
// any zoom; overlapping labels are hidden instead of shrunk, and every place
// stays reachable by tapping its block, by keyboard, or from the list.
// No library: the event venue has only tens of blocks.

const SVGNS = 'http://www.w3.org/2000/svg';
const UNIT = 20; // SVG user units per map unit
const YAW = (-18 * Math.PI) / 180;
const ELEV = (56 * Math.PI) / 180;
const TAP_SLOP = 8;
const MIN_K = 0.15;
const MAX_K = 6;

export const KIND_LABELS = { booth: 'ブース', stage: 'ステージ', facility: '施設', outdoor: '屋外', area: '区画' };
const KIND_COLORS = { stage: '#f3b27a', facility: '#e4ded6', outdoor: '#cfe6bd', area: '#eef4e6' };
const BOOTH_COLORS = ['#cfe8c8', '#cde3f5', '#f7d3dc', '#f8e6a8', '#e1d5f2'];

function hashIndex(s, n) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function colorOf(place) {
  if (place.color) return place.color;
  if (place.kind === 'booth') return BOOTH_COLORS[hashIndex(place.category ?? place.id, BOOTH_COLORS.length)];
  return KIND_COLORS[place.kind] ?? '#e4ded6';
}

export function createProjector(venue) {
  const cx = venue.width / 2;
  const cy = venue.depth / 2;
  const cos = Math.cos(YAW);
  const sin = Math.sin(YAW);
  return (x, y, z = 0) => {
    const X = x - cx;
    const Y = y - cy;
    const xr = X * cos - Y * sin;
    const yr = X * sin + Y * cos;
    return [xr * UNIT, (yr * Math.sin(ELEV) - z * Math.cos(ELEV)) * UNIT];
  };
}

const pts = (list) => list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

function el(name, attrs = {}) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Faces of a block in drawing order (sides, then top). */
export function blockFaces(project, p) {
  const { x, y, w, d } = p;
  const h = p.h ?? 0;
  const faces = [];
  if (h > 0) {
    if (Math.sin(YAW) < 0) faces.push(['side', [[x, y, 0], [x, y + d, 0], [x, y + d, h], [x, y, h]]]);
    if (Math.sin(YAW) > 0) faces.push(['side', [[x + w, y, 0], [x + w, y + d, 0], [x + w, y + d, h], [x + w, y, h]]]);
    faces.push(['front', [[x, y + d, 0], [x + w, y + d, 0], [x + w, y + d, h], [x, y + d, h]]]);
  }
  faces.push(['top', [[x, y, h], [x + w, y, h], [x + w, y + d, h], [x, y + d, h]]]);
  return faces.map(([kind, corners]) => [kind, corners.map(([a, b, c]) => project(a, b, c))]);
}

/** Painter's order: flat areas first, then blocks from back to front. */
export function drawOrder(places) {
  const depth = (p) => (p.x + p.w / 2) * Math.sin(YAW) + (p.y + p.d / 2) * Math.cos(YAW);
  return [...places].sort((a, b) => {
    const fa = (a.h ?? 0) === 0 ? 0 : 1;
    const fb = (b.h ?? 0) === 0 ? 0 : 1;
    return fa - fb || depth(a) - depth(b);
  });
}

export function mountMap(root, data, { onSelect }) {
  const { venue, places } = data;
  const project = createProjector(venue);
  root.classList.add('map3d');
  root.innerHTML = '';
  const svg = el('svg', { class: 'map3d-svg', role: 'group', 'aria-label': `${venue.name}の立体マップ。ブースやステージを選ぶと詳細が開きます` });
  const labelLayer = document.createElement('div');
  labelLayer.className = 'map3d-labels';
  root.append(svg, labelLayer);

  // Base plate with a visible thickness.
  const base = el('g', { class: 'map3d-base', 'aria-hidden': 'true' });
  const pad = 1.2;
  const plate = { x: -pad, y: -pad, w: venue.width + pad * 2, d: venue.depth + pad * 2, h: 0.6 };
  for (const [kind, poly] of blockFaces((a, b, c) => project(a, b, c - 0.6), plate)) {
    base.append(el('polygon', { points: pts(poly), class: `plate plate-${kind}` }));
  }
  const floor = blockFaces(project, { x: 0, y: 0, w: venue.width, d: venue.depth, h: 0 })[0][1];
  base.append(el('polygon', { points: pts(floor), class: 'floor' }));
  svg.append(base);

  const shapes = new Map();
  for (const p of drawOrder(places)) {
    const g = el('g', {
      class: `place place-${p.kind}`, 'data-place': p.id, tabindex: '0', role: 'button',
      'aria-label': `${KIND_LABELS[p.kind] ?? ''} ${p.name}`,
    });
    const color = colorOf(p);
    for (const [kind, poly] of blockFaces(project, p)) {
      const fill = kind === 'top' ? color : shade(color, kind === 'front' ? 0.86 : 0.74);
      g.append(el('polygon', { points: pts(poly), fill, class: `face face-${kind}` }));
    }
    svg.append(g);
    shapes.set(p.id, g);
  }

  const labels = places.filter((p) => p.kind !== 'area' || p.shortName).map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `map3d-label label-${p.kind}`;
    b.dataset.place = p.id;
    b.tabIndex = -1; // the block is the keyboard target; this is a larger tap target
    b.setAttribute('aria-hidden', 'true');
    b.textContent = p.shortName || p.name;
    labelLayer.append(b);
    const anchor = project(p.x + p.w / 2, p.y + p.d / 2, p.h ?? 0);
    const priority = (p.kind === 'stage' ? 1e6 : 0) + (p.kind === 'booth' ? 1e3 : 0) + p.w * p.d;
    return { p, b, anchor, priority, size: null };
  });

  // Bounding box of everything for "全体表示".
  const all = blockFaces(project, plate).flatMap(([, poly]) => poly);
  const minX = Math.min(...all.map((q) => q[0]));
  const maxX = Math.max(...all.map((q) => q[0]));
  const minY = Math.min(...all.map((q) => q[1])) - 30;
  const maxY = Math.max(...all.map((q) => q[1])) + 10;

  const view = { cx: 0, cy: 0, k: 1 };
  let selected = null;
  let frame = 0;

  function size() {
    const r = root.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function fit() {
    const { w, h } = size();
    view.k = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.96;
    view.cx = (minX + maxX) / 2;
    view.cy = (minY + maxY) / 2;
    apply();
  }

  function apply() {
    const { w, h } = size();
    view.k = Math.min(MAX_K, Math.max(MIN_K, view.k));
    svg.setAttribute('viewBox', `${view.cx - w / 2 / view.k} ${view.cy - h / 2 / view.k} ${w / view.k} ${h / view.k}`);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(layoutLabels);
  }

  function toScreen([sx, sy]) {
    const { w, h } = size();
    return [(sx - view.cx) * view.k + w / 2, (sy - view.cy) * view.k + h / 2];
  }

  function layoutLabels() {
    const { w, h } = size();
    const placed = [];
    const order = [...labels].sort((a, b) => (b.p.id === selected) - (a.p.id === selected) || b.priority - a.priority);
    for (const l of order) {
      if (!l.size) l.size = { w: l.b.offsetWidth || 60, h: l.b.offsetHeight || 24 };
      const [x, y] = toScreen(l.anchor);
      const rect = { x: x - l.size.w / 2, y: y - l.size.h / 2, w: l.size.w, h: l.size.h };
      const off = rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > w || rect.y > h;
      const hit = placed.some((q) => rect.x < q.x + q.w + 2 && q.x < rect.x + rect.w + 2 && rect.y < q.y + q.h + 2 && q.y < rect.y + rect.h + 2);
      const show = !off && (!hit || l.p.id === selected);
      l.b.classList.toggle('is-hidden', !show);
      l.b.classList.toggle('is-selected', l.p.id === selected);
      if (show) {
        placed.push(rect);
        l.b.style.transform = `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`;
      }
    }
  }

  function select(id, { notify = true } = {}) {
    selected = id;
    for (const [pid, g] of shapes) g.classList.toggle('is-selected', pid === id);
    layoutLabels();
    if (notify && id) onSelect(places.find((p) => p.id === id));
  }

  function zoom(factor, atX, atY) {
    const { w, h } = size();
    const px = atX ?? w / 2;
    const py = atY ?? h / 2;
    const wx = view.cx + (px - w / 2) / view.k;
    const wy = view.cy + (py - h / 2) / view.k;
    view.k = Math.min(MAX_K, Math.max(MIN_K, view.k * factor));
    view.cx = wx - (px - w / 2) / view.k;
    view.cy = wy - (py - h / 2) / view.k;
    apply();
  }

  // Pointer handling: a short press without movement is a tap; anything else pans or pinches.
  const pointers = new Map();
  let gesture = null;
  root.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture?.(e.pointerId);
    const ids = [...pointers.values()];
    if (pointers.size === 1) gesture = { kind: 'maybe-tap', start: { x: e.clientX, y: e.clientY }, view: { ...view }, target: e.target };
    else if (pointers.size === 2) {
      const [a, b] = ids;
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  });
  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = root.getBoundingClientRect();
      const factor = (Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist) * (gesture.k / view.k);
      zoom(factor, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    const dx = e.clientX - gesture.start.x;
    const dy = e.clientY - gesture.start.y;
    if (gesture.kind === 'maybe-tap' && Math.hypot(dx, dy) > TAP_SLOP) gesture.kind = 'pan';
    if (gesture.kind === 'pan') {
      view.cx = gesture.view.cx - dx / view.k;
      view.cy = gesture.view.cy - dy / view.k;
      apply();
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture?.kind === 'maybe-tap' && e.type === 'pointerup') {
      const hit = gesture.target?.closest?.('[data-place]');
      if (hit) select(hit.dataset.place);
    }
    if (pointers.size === 0) gesture = null;
    else if (gesture?.kind === 'pinch') gesture = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    const g = e.target.closest?.('[data-place]');
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      select(g.dataset.place);
    }
  });

  const ro = new ResizeObserver(() => apply());
  ro.observe(root);
  fit();

  return {
    zoomIn: () => zoom(1.4),
    zoomOut: () => zoom(1 / 1.4),
    fit,
    select,
    focus(id) {
      const p = places.find((q) => q.id === id);
      if (!p) return;
      const [sx, sy] = project(p.x + p.w / 2, p.y + p.d / 2, p.h ?? 0);
      view.cx = sx;
      view.cy = sy;
      view.k = Math.max(view.k, 1.2);
      apply();
      select(id, { notify: false });
    },
    destroy() { ro.disconnect(); },
  };
}
