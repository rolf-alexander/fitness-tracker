// Tiny SVG chart helpers (no libraries, so everything works offline).
// Tap or drag on a chart to see exact values.
import { esc } from './ui.js';

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

const shortDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const charts = new Set();
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => charts.forEach(c => c.el.isConnected ? c.draw() : charts.delete(c)), 150);
});

/**
 * lineChart(el, {
 *   series: [{ name, color: 'var(--series-1)', type: 'line'|'dots', points: [{x: ms, y}] }],
 *   height, yFormat(v), tooltip(xMs, rows) -> html
 * })
 */
export function lineChart(el, opts) {
  const chart = { el, draw: () => drawLine(el, opts) };
  charts.add(chart);
  chart.draw();
}

function drawLine(el, { series, height = 210, yFormat = v => String(v), tooltip }) {
  const all = series.flatMap(s => s.points);
  if (all.length === 0) {
    el.innerHTML = '<div class="chart-empty">No data yet</div>';
    return;
  }
  const W = Math.max(el.clientWidth, 260), H = height;
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  let xMin = Math.min(...all.map(p => p.x)), xMax = Math.max(...all.map(p => p.x));
  if (xMin === xMax) { xMin -= 86400000 * 3; xMax += 86400000 * 3; }
  const ys = all.map(p => p.y);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const X = x => pad.l + (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
  const Y = y => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  const grid = ticks.map(t => `
    <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/>
    <text class="axis" x="${pad.l - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(yFormat(t))}</text>`).join('');

  const nX = Math.max(2, Math.min(5, Math.floor((W - pad.l - pad.r) / 80)));
  const xLabels = Array.from({ length: nX }, (_, i) => xMin + (xMax - xMin) * i / (nX - 1)).map((x, i) =>
    `<text class="axis" x="${X(x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle'}">${shortDate(x)}</text>`).join('');

  const marks = series.map(s => {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (s.type === 'dots') {
      return pts.map(p => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="${s.color}" opacity="0.75"/>`).join('');
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    const lastDot = pts.length === 1 ? `<circle cx="${X(pts[0].x)}" cy="${Y(pts[0].y)}" r="4" fill="${s.color}"/>` : '';
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${lastDot}`;
  }).join('');

  const legend = series.length > 1
    ? `<div class="legend">${series.map(s => `<span><i class="${s.type === 'dots' ? 'dot' : 'line'}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`
    : '';

  el.innerHTML = `${legend}<div class="chart-box" style="height:${H}px">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} chart">
      ${grid}${xLabels}${marks}
      <g class="hover" style="display:none"><line class="crosshair" y1="${pad.t}" y2="${H - pad.b}"/></g>
      <rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
    </svg><div class="tip" style="display:none"></div></div>`;

  // Hover / tap layer: snap to the nearest date and show every series' value there.
  const svg = el.querySelector('svg'), hover = svg.querySelector('.hover'), tip = el.querySelector('.tip');
  const xs = [...new Set(all.map(p => p.x))].sort((a, b) => a - b);
  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const xVal = xMin + (px - pad.l) / (W - pad.l - pad.r) * (xMax - xMin);
    let best = xs[0];
    for (const x of xs) if (Math.abs(x - xVal) < Math.abs(best - xVal)) best = x;
    const rows = series.map(s => ({ s, p: s.points.find(p => p.x === best) })).filter(r => r.p);
    hover.style.display = '';
    hover.querySelectorAll('circle').forEach(c => c.remove());
    hover.querySelector('line').setAttribute('x1', X(best));
    hover.querySelector('line').setAttribute('x2', X(best));
    rows.forEach(r => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', X(best)); c.setAttribute('cy', Y(r.p.y)); c.setAttribute('r', 5);
      c.setAttribute('fill', r.s.color); c.setAttribute('class', 'hover-dot');
      hover.appendChild(c);
    });
    tip.innerHTML = tooltip ? tooltip(best, rows) :
      `<b>${shortDate(best)}</b>${rows.map(r => `<div><i style="background:${r.s.color}"></i>${esc(r.s.name)}: ${esc(yFormat(r.p.y))}</div>`).join('')}`;
    tip.style.display = '';
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(X(best) - tw / 2, 0), W - tw) + 'px';
  };
  const hide = () => { hover.style.display = 'none'; tip.style.display = 'none'; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}

/**
 * barChart(el, { bars: [{label, value, tip}], target, height })
 * Shows a dashed target line; tap a bar for its value.
 */
export function barChart(el, opts) {
  const chart = { el, draw: () => drawBars(el, opts) };
  charts.add(chart);
  chart.draw();
}

function drawBars(el, { bars, target, height = 140 }) {
  const W = Math.max(el.clientWidth, 240), H = height;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const max = Math.max(target || 0, ...bars.map(b => b.value || 0)) * 1.08 || 1;
  const slot = (W - pad.l - pad.r) / bars.length;
  const bw = Math.min(28, slot * 0.6);
  const Y = v => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const base = H - pad.b;
  const rects = bars.map((b, i) => {
    const cx = pad.l + slot * (i + 0.5);
    const h = b.value ? base - Y(b.value) : 0;
    const r = Math.min(4, bw / 2, h);
    // rounded top, square bottom on the baseline
    const path = h > 0
      ? `M${cx - bw / 2},${base} V${base - h + r} Q${cx - bw / 2},${base - h} ${cx - bw / 2 + r},${base - h} H${cx + bw / 2 - r} Q${cx + bw / 2},${base - h} ${cx + bw / 2},${base - h + r} V${base} Z`
      : '';
    return `<g class="bar" data-i="${i}">
      <rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" fill="transparent"/>
      ${path ? `<path d="${path}" fill="var(--series-1)"/>` : `<line x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${base}" y2="${base}" stroke="var(--border)" stroke-width="2"/>`}
      <text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text></g>`;
  }).join('');
  const tLine = target ? `<line class="target" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(target)}" y2="${Y(target)}"/>` : '';
  el.innerHTML = `<div class="chart-box" style="height:${H}px"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
    <line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${base}" y2="${base}"/>${rects}${tLine}</svg><div class="tip" style="display:none"></div></div>`;
  const tip = el.querySelector('.tip');
  el.querySelectorAll('.bar').forEach(g => {
    const showTip = () => {
      const b = bars[+g.dataset.i];
      tip.innerHTML = b.tip;
      tip.style.display = '';
      const cx = pad.l + slot * (+g.dataset.i + 0.5);
      tip.style.left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth) + 'px';
    };
    g.addEventListener('pointerdown', showTip);
    g.addEventListener('pointerenter', showTip);
  });
  el.querySelector('svg').addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') tip.style.display = 'none'; });
}
