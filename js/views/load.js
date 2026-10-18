// Training load: weekly calendar of gym, climbing, ski touring, other sport and rest days,
// plus a warning when hard pulling sessions and climbing land on back-to-back days.
import { all, put, del, get, uid } from '../db.js';
import {
  esc, icon, today, addDays, weekStart, weekLabel, relDay, fmtDate,
  openSheet, seg, wireSeg, segValue, toast, ask, num,
} from '../ui.js';

export const ACTIVITY_TYPES = {
  bouldering: { label: 'Bouldering', cls: 'climb' },
  ski: { label: 'Ski touring', cls: 'ski' },
  sport: { label: 'Other sport', cls: 'sport' },
  rest: { label: 'Rest day', cls: 'rest' },
};
const INTENSITY = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
];
const intensityLabel = (v) => INTENSITY.find(i => i.value === v)?.label || '';
const GYM_KIND_LABEL = { upper: 'Upper', lower: 'Lower', full: 'Full body', other: 'Gym' };

// Everything that happened on each date, tagged with whether it was hard pulling / climbing.
export async function loadDays() {
  const [sessions, activities] = await Promise.all([all('sessions'), all('activities')]);
  const days = {};
  const add = (date, item) => (days[date] ||= []).push(item);
  for (const s of sessions) {
    add(s.date, {
      kind: 'gym', id: s.id, label: s.name, intensity: s.intensity || 'moderate',
      pull: (s.kind === 'upper' || s.kind === 'full') && s.intensity !== 'easy',
      climb: false,
    });
  }
  for (const a of activities) {
    const climbing = a.type === 'bouldering' || (a.type === 'sport' && a.upperBody);
    add(a.date, {
      kind: a.type, id: a.id, label: a.type === 'sport' && a.name ? a.name : ACTIVITY_TYPES[a.type]?.label,
      intensity: a.intensity, duration: a.duration, notes: a.notes, elevation: a.elevation,
      pull: climbing && a.intensity !== 'easy',
      climb: climbing && a.intensity !== 'easy',
    });
  }
  return days;
}

const isPull = (items = []) => items.some(i => i.pull);
const hasClimb = (items = []) => items.some(i => i.climb);
const describe = (items) => items.filter(i => i.pull).map(i => `${i.label} (${intensityLabel(i.intensity) || 'hard'})`).join(' + ');

// Warnings for dates in [from, to]
export function warningsFor(days, from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const a = days[d] || [];
    const pulls = a.filter(i => i.pull);
    if (pulls.some(i => i.kind === 'gym') && hasClimb(a)) {
      out.push({ date: d, sameDay: true, text: `${relDay(d)}: ${describe(a)} on the same day.` });
    }
    const next = addDays(d, 1);
    const b = days[next] || [];
    if (next <= to && isPull(a) && isPull(b) && (hasClimb(a) || hasClimb(b))) {
      out.push({ date: d, text: `${relDay(d)} → ${relDay(next)}: ${describe(a)}, then ${describe(b)}. Back-to-back pulling — give fingers, elbows and lats ~48h.` });
    }
  }
  return out;
}

// Used by the Workouts tab: was there hard pulling/climbing yesterday?
export async function pullingYesterday() {
  const days = await loadDays();
  const y = days[addDays(today(), -1)] || [];
  return isPull(y) ? describe(y) : null;
}

export async function render(el, params) {
  const start = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? weekStart(params[0]) : weekStart(today());
  const end = addDays(start, 6);
  const days = await loadDays();
  const warnings = warningsFor(days, addDays(start, -1), end).filter(w => !(w.sameDay && w.date < start));
  const todayItems = days[today()] || [];

  let gym = 0, climbs = 0, minutes = 0, rest = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const i of days[d] || []) {
      if (i.kind === 'gym') gym++;
      if (i.kind === 'bouldering') climbs++;
      if (i.kind === 'rest') rest++;
      minutes += i.duration || 0;
    }
  }

  const dayRows = Array.from({ length: 7 }, (_, n) => {
    const d = addDays(start, n);
    const items = days[d] || [];
    const chips = items.length ? items.map(i => `
      <button class="chip ${i.kind === 'gym' ? 'gym' : ACTIVITY_TYPES[i.kind]?.cls}" data-item="${i.kind}:${i.id}">
        ${esc(i.label)}${i.duration ? ` · ${i.duration} min` : ''}${i.kind !== 'rest' && i.intensity ? ` · ${esc(intensityLabel(i.intensity) || i.intensity)}` : ''}
      </button>`).join('') : '<span class="muted small">—</span>';
    return `<div class="day-row ${d === today() ? 'is-today' : ''}">
      <div class="day-name"><b>${fmtDate(d, { weekday: 'short' })}</b><span>${fmtDate(d, { day: 'numeric' })}</span></div>
      <div class="day-items">${chips}</div>
      <button class="icon-btn" data-add-day="${d}" aria-label="Add activity on ${fmtDate(d)}">${icon('plus')}</button>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="quick-grid four">
      <button class="quick climb" data-new="bouldering">${icon('plus')}<span>Bouldering</span></button>
      <button class="quick ski" data-new="ski">${icon('plus')}<span>Ski touring</span></button>
      <button class="quick sport" data-new="sport">${icon('plus')}<span>Other sport</span></button>
      <button class="quick rest" data-new="rest">${icon('plus')}<span>Rest day</span></button>
    </div>
    ${isPull(todayItems) ? `<div class="notice info">${icon('warn')}<div>You've done hard pulling today (${esc(describe(todayItems))}). Keep tomorrow free of hard climbing and heavy upper-body pulling if you can.</div></div>` : ''}
    <div class="week-nav">
      <a class="icon-btn" href="#/load/${addDays(start, -7)}" aria-label="Previous week">${icon('left')}</a>
      <div><b>${weekLabel(start)}</b>${start === weekStart(today()) ? '<span class="muted small"> · this week</span>' : ''}</div>
      <a class="icon-btn" href="#/load/${addDays(start, 7)}" aria-label="Next week">${icon('right')}</a>
    </div>
    ${warnings.map(w => `<div class="notice warn">${icon('warn')}<div>${esc(w.text)}</div></div>`).join('')}
    <div class="stat-row">
      <div class="stat"><b>${gym}</b><span>gym</span></div>
      <div class="stat"><b>${climbs}</b><span>climbing</span></div>
      <div class="stat"><b>${(minutes / 60).toFixed(1)}</b><span>hours sport</span></div>
      <div class="stat"><b>${rest}</b><span>rest days</span></div>
    </div>
    <div class="card flush">${dayRows}</div>
    <p class="muted small pad">Gym sessions appear here automatically when you finish them in Workouts. Upper/full-body sessions count as hard pulling unless you mark them Easy.</p>`;

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-new],[data-add-day],[data-item]');
    if (!t) return;
    if (t.dataset.new) return activitySheet({ type: t.dataset.new, date: today() });
    if (t.dataset.addDay) return chooseType(t.dataset.addDay);
    const [kind, id] = t.dataset.item.split(':');
    if (kind === 'gym') location.hash = `#/workouts/history/${id}`;
    else activitySheet(await get('activities', id));
  });
}

function chooseType(date) {
  openSheet(`Add to ${relDay(date)}`, `
    <div class="quick-grid">
      ${Object.entries(ACTIVITY_TYPES).map(([k, v]) => `<button class="quick ${v.cls}" data-type="${k}">${esc(v.label)}</button>`).join('')}
      <a class="quick gym" href="#/workouts">Gym session</a>
    </div>`, (el, close) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (b) { close(); activitySheet({ type: b.dataset.type, date }); }
      else if (e.target.closest('a')) close();
    });
  });
}

export function activitySheet(a, onSaved) {
  const isNew = !a.id;
  a = { duration: a.type === 'ski' ? 180 : a.type === 'rest' ? null : 90, intensity: 'moderate', notes: '', ...a };
  const durations = a.type === 'ski' ? [120, 180, 240, 300, 360] : [45, 60, 90, 120, 150];
  const html = `
    <label class="field"><span>Date</span><input type="date" name="date" value="${a.date}"></label>
    ${a.type === 'sport' ? `<label class="field"><span>Sport</span><input name="name" value="${esc(a.name || '')}" placeholder="e.g. Running, football"></label>
      <label class="check-field"><input type="checkbox" name="upperBody" ${a.upperBody ? 'checked' : ''}><span>Hard on fingers / pulling muscles (counts like climbing)</span></label>` : ''}
    ${a.type !== 'rest' ? `
      <div class="field"><span>Duration (minutes)</span>
        <div class="chips-select">${durations.map(d => `<button type="button" data-dur="${d}" class="${a.duration === d ? 'on' : ''}">${d}</button>`).join('')}</div>
        <input name="duration" inputmode="numeric" value="${a.duration ?? ''}" placeholder="minutes">
      </div>
      <div class="field"><span>Intensity</span>${seg('intensity', INTENSITY, a.intensity)}</div>
      ${a.type === 'ski' ? `<label class="field"><span>Elevation gain (m, optional)</span><input name="elevation" inputmode="numeric" value="${a.elevation ?? ''}"></label>` : ''}` : ''}
    <label class="field"><span>Notes (optional)</span><textarea name="notes" rows="2" placeholder="${a.type === 'bouldering' ? 'e.g. projected V5, fingers a bit sore' : ''}">${esc(a.notes || '')}</textarea></label>
    <div class="row-btns">
      ${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button>`}
      <button class="btn primary" data-save>Save</button>
    </div>`;
  openSheet(`${isNew ? 'Log' : 'Edit'} ${ACTIVITY_TYPES[a.type].label.toLowerCase()}`, html, (el, close) => {
    wireSeg(el);
    const durInput = el.querySelector('[name=duration]');
    el.querySelectorAll('[data-dur]').forEach(b => b.onclick = () => {
      el.querySelectorAll('[data-dur]').forEach(x => x.classList.toggle('on', x === b));
      durInput.value = b.dataset.dur;
    });
    durInput?.addEventListener('input', () => el.querySelectorAll('[data-dur]').forEach(x => x.classList.toggle('on', x.dataset.dur === durInput.value)));
    el.querySelector('[data-save]').onclick = async () => {
      const f = (n) => el.querySelector(`[name=${n}]`);
      const rec = {
        id: a.id || uid(), type: a.type,
        date: f('date').value || today(),
        duration: f('duration') ? num(f('duration').value) : null,
        intensity: a.type === 'rest' ? null : segValue(el, 'intensity'),
        notes: f('notes').value.trim(),
      };
      if (a.type === 'sport') { rec.name = f('name').value.trim(); rec.upperBody = f('upperBody').checked; }
      if (a.type === 'ski') rec.elevation = num(f('elevation').value);
      await put('activities', rec);
      close();
      toast(`${ACTIVITY_TYPES[a.type].label} saved`);
      onSaved ? onSaved() : window.app.refresh();
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await ask('Delete?', 'Delete this activity?', 'Delete', true)) return;
      await del('activities', a.id);
      close();
      onSaved ? onSaved() : window.app.refresh();
    });
  });
}
