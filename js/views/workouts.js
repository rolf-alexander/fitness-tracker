// Workouts: templates, live set logging, progression suggestions, history, PRs and charts.
import { all, get, put, del, getKV, setKV, delKV, uid } from '../db.js';
import { getSettings, makeTemplateExercise } from '../settings-store.js';
import {
  esc, icon, num, kg, fmt, today, fmtDate, relDay, daysBetween, parseDate,
  openSheet, ask, toast, seg, wireSeg, segValue, subHeader, buzz,
} from '../ui.js';
import { startRest, stopRest } from '../timer.js';
import { lineChart } from '../chart.js';
import { pullingYesterday } from './load.js';

const KINDS = [
  { value: 'upper', label: 'Upper' }, { value: 'lower', label: 'Lower' },
  { value: 'full', label: 'Full body' }, { value: 'other', label: 'Other' },
];
const INTENSITY = [{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }];
const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

// Estimated one-rep max (Epley formula)
export const e1rm = (w, r) => (!w || !r ? 0 : r === 1 ? w : w * (1 + r / 30));
const doneSets = (ex) => ex.sets.filter(s => s.done !== false && s.r);
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const fmtRest = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
const setsText = (sets) => sets.map(s => `${s.w ? kg(s.w) : 'BW'}×${s.r}`).join(', ');

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.finishedAt || 0) - (a.finishedAt || 0));
}

// Most recent performances of an exercise, newest first: [{date, sets}]
function performances(name, sessions, excludeId) {
  const out = [];
  for (const s of sortSessions(sessions)) {
    if (s.id === excludeId) continue;
    for (const ex of s.exercises) {
      if (sameName(ex.name, name)) {
        const sets = doneSets(ex);
        if (sets.length) out.push({ date: s.date, sets, sessionId: s.id });
      }
    }
  }
  return out;
}

// The progression rule ("double progression"):
// hit the top of the rep range on every set -> add weight next time; otherwise keep the weight and add reps.
export function suggest(t, perfs) {
  const last = perfs[0];
  if (!last) {
    return { weight: null, reps: [], up: false, text: `First time: pick a weight you could lift about ${t.repMax} times with 1–2 reps left in the tank.` };
  }
  const work = last.sets.slice(0, t.sets || last.sets.length);
  const top = Math.max(...work.map(s => s.w || 0));
  const lastReps = work.map(s => s.r);
  const allAtTop = work.length >= (t.sets || 1) && work.every(s => (s.w || 0) >= top && s.r >= t.repMax);
  const wText = top ? `${kg(top)} kg` : 'bodyweight';

  if (allAtTop && t.increment > 0) {
    const next = Math.round((top + t.increment) * 100) / 100;
    return { weight: next, reps: work.map(() => t.repMin), up: true, text: `Add ${kg(t.increment)} kg → ${kg(next)} kg. You hit ${t.repMax} reps on every set last time, so aim for ${t.repMin}+ now.` };
  }
  if (allAtTop) {
    return { weight: top || null, reps: lastReps, up: true, text: 'You hit the top of the range on every set: add reps, add weight, or use a harder variation.' };
  }
  // Stalled: below the bottom of the range at the same weight two sessions running -> suggest a 10% reset
  const prev = perfs[1];
  const under = (p) => p.sets.slice(0, t.sets || p.sets.length).some(s => s.r < t.repMin);
  if (prev && top > 0 && under(last) && under(prev) && Math.max(...prev.sets.map(s => s.w || 0)) === top) {
    const reset = Math.round(top * 0.9 / 2.5) * 2.5;
    return { weight: top, reps: lastReps, up: false, text: `Stuck below ${t.repMin} reps at ${wText} twice. Consider dropping to ${kg(reset)} kg and building back up.` };
  }
  if (work.some(s => s.r < t.repMin)) {
    return { weight: top || null, reps: lastReps, up: false, text: `Stay at ${wText} and get every set to at least ${t.repMin} reps.` };
  }
  return { weight: top || null, reps: lastReps, up: false, text: `Stay at ${wText} and beat last time: aim for ${t.repMax} reps on every set.` };
}

function exerciseFromTemplate(t, sessions, settings) {
  const perfs = performances(t.name, sessions);
  const sug = suggest(t, perfs);
  const n = t.sets || 3;
  return {
    name: t.name, repMin: t.repMin, repMax: t.repMax, increment: t.increment ?? 2.5,
    rest: t.rest || settings.defaultRest, targetSets: n,
    suggestion: sug.text, up: sug.up,
    lastText: perfs[0] ? `${fmtDate(perfs[0].date)} · ${setsText(perfs[0].sets)}` : '',
    sets: Array.from({ length: n }, (_, i) => ({
      w: sug.weight, r: sug.reps[i] ?? sug.reps[sug.reps.length - 1] ?? null, rpe: null, done: false,
    })),
  };
}

async function knownExerciseNames() {
  const [templates, sessions] = await Promise.all([all('templates'), all('sessions')]);
  const names = new Map();
  templates.forEach(t => t.exercises.forEach(e => e.name && names.set(e.name.toLowerCase(), e.name)));
  sessions.forEach(s => s.exercises.forEach(e => names.set(e.name.toLowerCase(), e.name)));
  return [...names.values()].sort();
}
const datalist = (names) => `<datalist id="ex-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;

// ---------------- routing ----------------
export async function render(el, params) {
  const [page, arg] = params;
  if (page === 'session') return renderActive(el);
  if (page === 'history') return arg ? renderPast(el, arg) : renderHistory(el);
  if (page === 'exercises') return renderExercises(el);
  if (page === 'exercise') return renderExercise(el, decodeURIComponent(arg || ''));
  if (page === 'templates') return renderTemplates(el);
  if (page === 'template') return renderTemplateEditor(el, arg);
  return renderHome(el);
}

// ---------------- home ----------------
async function renderHome(el) {
  const [templates, sessions, active, pulledYesterday] = await Promise.all([
    all('templates'), all('sessions'), getKV('activeSession'), pullingYesterday(),
  ]);
  templates.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const sorted = sortSessions(sessions);
  const lastFor = (t) => sorted.find(s => s.templateId === t.id);
  const lastTemplated = sorted.find(s => templates.some(t => t.id === s.templateId));
  const next = lastTemplated
    ? templates[(templates.findIndex(t => t.id === lastTemplated.templateId) + 1) % templates.length]
    : templates[0];
  const ago = (t) => {
    const s = lastFor(t);
    if (!s) return 'not done yet';
    const d = daysBetween(s.date, today());
    return d === 0 ? 'done today' : d === 1 ? 'done yesterday' : `done ${d} days ago`;
  };

  el.innerHTML = `
    ${active ? `<div class="card highlight">
      <div class="card-title">${icon('timer')} Session in progress</div>
      <p><b>${esc(active.name)}</b> · started ${new Date(active.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${active.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)} sets done</p>
      <div class="row-btns"><button class="btn ghost" data-discard>Discard</button><a class="btn primary" href="#/workouts/session">Resume</a></div>
    </div>` : ''}
    ${pulledYesterday && next && (next.kind === 'upper' || next.kind === 'full') ? `<div class="notice warn">${icon('warn')}<div>Yesterday: ${esc(pulledYesterday)}. ${esc(next.name)} is pull-heavy — consider a lower-body day first.</div></div>` : ''}
    ${next ? `<div class="card next-up">
      <div class="eyebrow">Next up</div>
      <h2>${esc(next.name)}</h2>
      <p class="muted small">${esc(next.exercises.map(e => e.name).join(' · '))}</p>
      <button class="btn primary block big" data-start="${next.id}">Start ${esc(next.name)}</button>
    </div>` : ''}
    <div class="list">
      ${templates.filter(t => t !== next).map(t => `
        <button class="list-row" data-start="${t.id}">
          <div><b>${esc(t.name)}</b><span class="muted small">${t.exercises.length} exercises · ${ago(t)}</span></div>${icon('right')}
        </button>`).join('')}
      <button class="list-row" data-start="">
        <div><b>Empty session</b><span class="muted small">Add exercises as you go</span></div>${icon('right')}
      </button>
    </div>
    <div class="quick-grid three">
      <a class="quick" href="#/workouts/history">${icon('calendar')}<span>History</span></a>
      <a class="quick" href="#/workouts/exercises">${icon('trophy')}<span>PRs &amp; charts</span></a>
      <a class="quick" href="#/workouts/templates">${icon('edit')}<span>Templates</span></a>
    </div>
    ${sorted.length ? `<h3 class="section">Recent</h3><div class="list">${sorted.slice(0, 3).map(sessionRow).join('')}</div>` : ''}`;

  el.addEventListener('click', async (e) => {
    const start = e.target.closest('[data-start]');
    if (start) {
      if (active && !await ask('Replace session?', `You have "${active.name}" in progress. Discard it and start a new one?`, 'Discard & start', true)) return;
      const t = templates.find(x => x.id === start.dataset.start) || null;
      return startSession(t, sessions);
    }
    if (e.target.closest('[data-discard]')) {
      if (await ask('Discard session?', 'Everything logged in this session will be lost.', 'Discard', true)) {
        await delKV('activeSession'); stopRest(); window.app.refresh();
      }
    }
  });
}

async function startSession(t, sessions) {
  const settings = await getSettings();
  const state = {
    id: uid(), date: today(), templateId: t?.id || null, name: t?.name || 'Workout', kind: t?.kind || 'other',
    startedAt: Date.now(), notes: '',
    exercises: (t?.exercises || []).filter(e => e.name).map(e => exerciseFromTemplate(e, sessions, settings)),
  };
  await setKV('activeSession', state);
  location.hash = '#/workouts/session';
}

function sessionRow(s) {
  const sets = s.exercises.reduce((n, e) => n + doneSets(e).length, 0);
  const vol = s.exercises.reduce((n, e) => n + doneSets(e).reduce((m, x) => m + (x.w || 0) * x.r, 0), 0);
  return `<a class="list-row" href="#/workouts/history/${s.id}">
    <div><b>${esc(s.name)}</b><span class="muted small">${relDay(s.date)} · ${sets} sets · ${fmt(vol)} kg volume${s.intensity ? ' · ' + s.intensity : ''}</span></div>${icon('right')}</a>`;
}

// ---------------- the session editor (live and past sessions) ----------------
async function renderActive(el) {
  const state = await getKV('activeSession');
  if (!state) { location.hash = '#/workouts'; return; }
  renderEditor(el, state, { mode: 'active', persist: (s) => setKV('activeSession', s) });
}

async function renderPast(el, id) {
  const s = await get('sessions', id);
  if (!s) { el.innerHTML = subHeader('Session', '#/workouts/history') + '<p class="pad">Session not found.</p>'; return; }
  renderEditor(el, s, { mode: 'past', persist: (x) => put('sessions', x) });
}

async function renderEditor(el, state, { mode, persist }) {
  const names = await knownExerciseNames();
  let timer;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => persist(state), 250); };
  const saveNow = () => { clearTimeout(timer); return persist(state); };
  // Save immediately if you leave the page mid-typing
  const flush = () => { if (timer) saveNow(); };
  window.addEventListener('hashchange', flush, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const setRow = (s, i, j) => `
    <div class="set-row ${s.done ? 'done' : ''}" data-ex="${i}" data-set="${j}">
      <span class="set-n">${j + 1}</span>
      <input class="w" type="text" inputmode="decimal" value="${s.w ?? ''}" placeholder="kg" aria-label="Set ${j + 1} weight in kg">
      <input class="r" type="text" inputmode="numeric" value="${s.r ?? ''}" placeholder="reps" aria-label="Set ${j + 1} reps">
      <select class="rpe" aria-label="Set ${j + 1} RPE (optional)"><option value="">–</option>${RPES.map(r => `<option ${s.rpe === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <button class="tick" aria-label="Mark set ${j + 1} done" aria-pressed="${s.done ? 'true' : 'false'}">${icon('check')}</button>
    </div>`;

  const exCard = (ex, i) => `
    <div class="card ex" data-ex="${i}">
      <div class="ex-head">
        <div><h3>${esc(ex.name)}</h3><span class="muted small">${ex.targetSets ? `${ex.targetSets} × ` : ''}${ex.repMin}–${ex.repMax} reps · rest ${fmtRest(ex.rest || 120)}</span></div>
        <button class="icon-btn" data-exmenu="${i}" aria-label="Exercise options">${icon('edit')}</button>
      </div>
      ${mode === 'active' && ex.suggestion ? `<div class="suggest ${ex.up ? 'up' : ''}">${ex.up ? icon('up') : ''}<span>${esc(ex.suggestion)}</span></div>` : ''}
      ${mode === 'active' && ex.lastText ? `<div class="muted small last">Last time: ${esc(ex.lastText)}</div>` : ''}
      <div class="sets">
        <div class="set-row head"><span>Set</span><span>kg</span><span>Reps</span><span>RPE</span><span>Done</span></div>
        ${ex.sets.map((s, j) => setRow(s, i, j)).join('')}
      </div>
      <div class="ex-actions">
        <button class="btn small" data-addset="${i}">${icon('plus')} Set</button>
        ${ex.sets.length ? `<button class="btn small ghost" data-rmset="${i}">Remove last set</button>` : ''}
      </div>
    </div>`;

  const draw = () => {
    const y = window.scrollY;
    const head = mode === 'active'
      ? `<div class="session-head"><div><h2>${esc(state.name)}</h2><span class="muted small">${relDay(state.date)} · started ${new Date(state.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>
          <button class="btn primary" data-finish>Finish</button></div>`
      : `${subHeader('Edit session', '#/workouts/history')}
         <div class="card">
           <label class="field"><span>Name</span><input name="sname" value="${esc(state.name)}"></label>
           <label class="field"><span>Date</span><input type="date" name="sdate" value="${state.date}"></label>
           <div class="field"><span>Type</span>${seg('kind', KINDS, state.kind)}</div>
           <div class="field"><span>How hard was it?</span>${seg('intensity', INTENSITY, state.intensity || 'moderate')}</div>
         </div>`;
    el.innerHTML = `${head}${datalist(names)}
      ${state.exercises.map(exCard).join('')}
      <button class="btn block" data-addex>${icon('plus')} Add exercise</button>
      <label class="field pad-top"><span>Session notes</span><textarea name="snotes" rows="2">${esc(state.notes || '')}</textarea></label>
      ${mode === 'active'
        ? `<button class="btn primary block big" data-finish>Finish session</button>
           <button class="btn ghost block" data-discard>Discard session</button>`
        : `<button class="btn danger block" data-delete>${icon('trash')} Delete session</button>`}`;
    window.scrollTo(0, y);
    if (mode === 'past') wireSeg(el, (name, value) => { state[name] = value; save(); });
  };
  draw();

  el.addEventListener('input', (e) => {
    const row = e.target.closest('.set-row');
    if (row && !row.classList.contains('head')) {
      const ex = state.exercises[+row.dataset.ex], j = +row.dataset.set, s = ex.sets[j];
      if (e.target.classList.contains('w')) {
        const old = s.w;
        s.w = num(e.target.value);
        // Changing a weight also updates later, unfinished sets that had the same weight
        ex.sets.forEach((later, k) => {
          if (k > j && !later.done && later.w === old) {
            later.w = s.w;
            const input = el.querySelector(`.set-row[data-ex="${row.dataset.ex}"][data-set="${k}"] .w`);
            if (input) input.value = s.w ?? '';
          }
        });
      }
      if (e.target.classList.contains('r')) s.r = num(e.target.value);
      return save();
    }
    if (e.target.name === 'snotes') state.notes = e.target.value;
    if (e.target.name === 'sname') state.name = e.target.value;
    if (e.target.name === 'sdate' && e.target.value) state.date = e.target.value;
    save();
  });
  el.addEventListener('change', (e) => {
    if (!e.target.classList.contains('rpe')) return;
    const row = e.target.closest('.set-row');
    state.exercises[+row.dataset.ex].sets[+row.dataset.set].rpe = num(e.target.value);
    save();
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('tick')) {
      const row = b.closest('.set-row');
      const ex = state.exercises[+row.dataset.ex], s = ex.sets[+row.dataset.set];
      if (!s.done && !s.r) { toast('Enter your reps first'); row.querySelector('.r').focus(); return; }
      s.done = !s.done;
      row.classList.toggle('done', s.done);
      b.setAttribute('aria-pressed', s.done);
      buzz(15);
      if (s.done && mode === 'active') startRest(ex.rest || 120);
      return save();
    }
    if (b.dataset.addset) {
      const ex = state.exercises[+b.dataset.addset];
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ w: last?.w ?? null, r: last?.r ?? null, rpe: null, done: false });
      draw(); return save();
    }
    if (b.dataset.rmset) {
      state.exercises[+b.dataset.rmset].sets.pop();
      draw(); return save();
    }
    if (b.dataset.exmenu) return exerciseMenu(+b.dataset.exmenu);
    if ('addex' in b.dataset) return addExercise();
    if ('finish' in b.dataset) return finish();
    if ('discard' in b.dataset) {
      if (await ask('Discard session?', 'Everything logged in this session will be lost.', 'Discard', true)) {
        clearTimeout(timer); await delKV('activeSession'); stopRest(); location.hash = '#/workouts';
      }
    }
    if ('delete' in b.dataset) {
      if (await ask('Delete session?', 'This removes the session from your history and charts.', 'Delete', true)) {
        clearTimeout(timer); await del('sessions', state.id); location.hash = '#/workouts/history';
      }
    }
  });

  function exerciseMenu(i) {
    const ex = state.exercises[i];
    openSheet(ex.name, `
      <label class="field"><span>Exercise name</span><input name="name" list="ex-names" value="${esc(ex.name)}"></label>
      <div class="grid2">
        <label class="field"><span>Rep range min</span><input name="repMin" inputmode="numeric" value="${ex.repMin}"></label>
        <label class="field"><span>Rep range max</span><input name="repMax" inputmode="numeric" value="${ex.repMax}"></label>
      </div>
      <div class="field"><span>Rest timer</span>${seg('rest', [60, 90, 120, 150, 180, 240].map(v => ({ value: v, label: fmtRest(v) })), ex.rest)}</div>
      <div class="row-btns">
        <button class="btn" data-move="-1" ${i === 0 ? 'disabled' : ''}>${icon('up')} Move up</button>
        <button class="btn" data-move="1" ${i === state.exercises.length - 1 ? 'disabled' : ''}>${icon('down')} Move down</button>
      </div>
      <div class="row-btns">
        <button class="btn danger" data-remove>${icon('trash')} Remove</button>
        <button class="btn primary" data-save>Done</button>
      </div>`, (sh, close) => {
      wireSeg(sh);
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.move) {
          const j = i + Number(b.dataset.move);
          [state.exercises[i], state.exercises[j]] = [state.exercises[j], state.exercises[i]];
        } else if ('remove' in b.dataset) {
          if (!await ask('Remove exercise?', `Remove ${ex.name} from this session?`, 'Remove', true)) return;
          state.exercises.splice(i, 1);
        } else if ('save' in b.dataset) {
          ex.name = sh.querySelector('[name=name]').value.trim() || ex.name;
          ex.repMin = num(sh.querySelector('[name=repMin]').value) ?? ex.repMin;
          ex.repMax = num(sh.querySelector('[name=repMax]').value) ?? ex.repMax;
          ex.rest = Number(segValue(sh, 'rest')) || ex.rest;
        } else return;
        close(); draw(); saveNow();
      });
    });
  }

  function addExercise() {
    openSheet('Add exercise', `
      <label class="field"><span>Exercise</span><input name="name" list="ex-names" placeholder="e.g. Cable fly" autocomplete="off"></label>
      <div class="grid3">
        <label class="field"><span>Sets</span><input name="sets" inputmode="numeric" value="3"></label>
        <label class="field"><span>Reps min</span><input name="repMin" inputmode="numeric" value="8"></label>
        <label class="field"><span>Reps max</span><input name="repMax" inputmode="numeric" value="12"></label>
      </div>
      <button class="btn primary block" data-add>Add</button>`, (sh, close) => {
      sh.querySelector('[name=name]').focus();
      sh.querySelector('[data-add]').onclick = async () => {
        const name = sh.querySelector('[name=name]').value.trim();
        if (!name) return toast('Give the exercise a name');
        const t = makeTemplateExercise(name, num(sh.querySelector('[name=sets]').value) || 3,
          num(sh.querySelector('[name=repMin]').value) || 8, num(sh.querySelector('[name=repMax]').value) || 12,
          /squat|deadlift|leg press|hip thrust/i.test(name) ? 5 : 2.5);
        const ex = exerciseFromTemplate(t, await all('sessions'), await getSettings());
        if (mode === 'past') { ex.suggestion = ''; ex.lastText = ''; }
        state.exercises.push(ex);
        close(); draw(); saveNow();
        window.scrollTo(0, document.body.scrollHeight);
      };
    });
  }

  function finish() {
    const ticked = state.exercises.reduce((n, ex) => n + ex.sets.filter(s => s.done).length, 0);
    const untickedWithData = state.exercises.reduce((n, ex) => n + ex.sets.filter(s => !s.done && s.r).length, 0);
    openSheet('Finish session', `
      <p>${ticked} sets ticked${untickedWithData ? ` · <b>${untickedWithData} unticked sets will not be saved</b>` : ''}.</p>
      <div class="field"><span>How hard was it overall?</span>${seg('intensity', INTENSITY, 'moderate')}</div>
      <label class="field"><span>Date</span><input type="date" name="date" value="${state.date}"></label>
      <button class="btn primary block big" data-save>Save session</button>`, (sh, close) => {
      wireSeg(sh);
      sh.querySelector('[data-save]').onclick = async () => {
        if (!ticked && !await ask('No sets ticked', 'Nothing was ticked as done. Save an empty session?', 'Save anyway')) return;
        const sessions = await all('sessions');
        const record = {
          id: state.id, date: sh.querySelector('[name=date]').value || state.date,
          templateId: state.templateId, name: state.name, kind: state.kind,
          startedAt: state.startedAt, finishedAt: Date.now(),
          intensity: segValue(sh, 'intensity'), notes: state.notes || '',
          exercises: state.exercises
            .map(ex => ({
              name: ex.name, repMin: ex.repMin, repMax: ex.repMax, increment: ex.increment, rest: ex.rest, targetSets: ex.targetSets,
              sets: ex.sets.filter(s => s.done).map(({ w, r, rpe }) => ({ w, r, rpe, done: true })),
            }))
            .filter(ex => ex.sets.length),
        };
        const prs = findPRs(record, sessions);
        clearTimeout(timer);
        await put('sessions', record);
        await delKV('activeSession');
        stopRest();
        close();
        location.hash = '#/workouts';
        toast(prs.length ? `Saved! New PR: ${prs.join(', ')}` : 'Session saved. Nice work!', { duration: prs.length ? 7000 : 3500 });
      };
    });
  }
}

function findPRs(record, sessions) {
  const out = [];
  for (const ex of record.exercises) {
    const before = performances(ex.name, sessions).flatMap(p => p.sets);
    if (!before.length) continue;
    const prevBest = Math.max(...before.map(s => e1rm(s.w, s.r)));
    const best = ex.sets.reduce((a, s) => (e1rm(s.w, s.r) > e1rm(a.w, a.r) ? s : a), ex.sets[0]);
    if (e1rm(best.w, best.r) > prevBest + 0.01) out.push(`${ex.name} ${kg(best.w)}×${best.r}`);
  }
  return out;
}

// ---------------- history ----------------
async function renderHistory(el) {
  const sessions = sortSessions(await all('sessions'));
  let lastMonth = '';
  const rows = sessions.map(s => {
    const month = fmtDate(s.date, { month: 'long', year: 'numeric' });
    const headerHtml = month !== lastMonth ? `<h3 class="section">${month}</h3>` : '';
    lastMonth = month;
    return headerHtml + `<div class="list">${sessionRow(s)}</div>`;
  }).join('');
  el.innerHTML = subHeader('History', '#/workouts') + (rows || '<p class="empty">No sessions yet. Finish a workout and it will show up here.</p>');
}

// ---------------- exercises, PRs and charts ----------------
function exerciseStats(sessions) {
  const map = new Map();
  for (const s of sortSessions(sessions).reverse()) {
    for (const ex of s.exercises) {
      const sets = doneSets(ex);
      if (!sets.length) continue;
      const key = ex.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { name: ex.name, entries: [] });
      map.get(key).entries.push({ date: s.date, sets, sessionId: s.id });
    }
  }
  return map;
}

async function renderExercises(el) {
  const stats = [...exerciseStats(await all('sessions')).values()];
  stats.sort((a, b) => b.entries[b.entries.length - 1].date.localeCompare(a.entries[a.entries.length - 1].date));
  el.innerHTML = subHeader('PRs & charts', '#/workouts') + (stats.length ? `
    <input class="search" type="search" placeholder="Search exercises" aria-label="Search exercises">
    <div class="list ex-list">${stats.map(x => {
      const best = Math.max(...x.entries.flatMap(e => e.sets.map(s => e1rm(s.w, s.r))));
      return `<a class="list-row" href="#/workouts/exercise/${encodeURIComponent(x.name)}" data-name="${esc(x.name.toLowerCase())}">
        <div><b>${esc(x.name)}</b><span class="muted small">${x.entries.length} sessions · best e1RM ${best ? kg(Math.round(best * 10) / 10) + ' kg' : '–'} · last ${relDay(x.entries[x.entries.length - 1].date)}</span></div>${icon('right')}</a>`;
    }).join('')}</div>` : '<p class="empty">Log some workouts and your exercises, records and charts will appear here.</p>');
  el.querySelector('.search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll('.ex-list .list-row').forEach(r => { r.style.display = r.dataset.name.includes(q) ? '' : 'none'; });
  });
}

async function renderExercise(el, name) {
  const x = exerciseStats(await all('sessions')).get(name.trim().toLowerCase());
  if (!x) { el.innerHTML = subHeader(name, '#/workouts/exercises') + '<p class="empty">No data for this exercise yet.</p>'; return; }
  const allSets = x.entries.flatMap(e => e.sets.map(s => ({ ...s, date: e.date })));
  const bestE = allSets.reduce((a, s) => (e1rm(s.w, s.r) > e1rm(a.w, a.r) ? s : a));
  const heaviest = allSets.reduce((a, s) => ((s.w || 0) > (a.w || 0) || ((s.w || 0) === (a.w || 0) && s.r > a.r) ? s : a));
  const vols = x.entries.map(e => ({ date: e.date, v: e.sets.reduce((m, s) => m + (s.w || 0) * s.r, 0) }));
  const bestVol = vols.reduce((a, v) => (v.v > a.v ? v : a));
  const repTargets = [1, 3, 5, 8, 10, 12, 15];
  const repRecords = repTargets.map(r => {
    const c = allSets.filter(s => s.r >= r);
    if (!c.length) return null;
    const b = c.reduce((a, s) => ((s.w || 0) > (a.w || 0) ? s : a));
    return { r, w: b.w, date: b.date, actual: b.r };
  }).filter(Boolean);

  el.innerHTML = `${subHeader(x.name, '#/workouts/exercises')}
    <div class="tiles">
      <div class="tile"><span>Best est. 1RM</span><b>${kg(Math.round(e1rm(bestE.w, bestE.r) * 10) / 10)} kg</b><small>${kg(bestE.w)}×${bestE.r} · ${fmtDate(bestE.date)}</small></div>
      <div class="tile"><span>Heaviest set</span><b>${heaviest.w ? kg(heaviest.w) + ' kg' : 'BW'}</b><small>×${heaviest.r} · ${fmtDate(heaviest.date)}</small></div>
      <div class="tile"><span>Best session volume</span><b>${fmt(bestVol.v)} kg</b><small>${fmtDate(bestVol.date)}</small></div>
    </div>
    <div class="card">
      <div class="card-title-row"><div class="card-title">${icon('chart')} Progress</div>
        ${seg('range', [{ value: 90, label: '3M' }, { value: 180, label: '6M' }, { value: 365, label: '1Y' }, { value: 0, label: 'All' }], 180)}</div>
      <div class="chart" id="ex-chart"></div>
      <p class="muted small">Estimated 1RM uses the Epley formula: weight × (1 + reps ÷ 30).</p>
    </div>
    <div class="card">
      <div class="card-title">${icon('trophy')} Rep records</div>
      <table class="table"><thead><tr><th>Reps</th><th>Best weight</th><th>Date</th></tr></thead><tbody>
      ${repRecords.map(r => `<tr><td>${r.r}${r.actual > r.r ? '+' : ''}</td><td>${r.w ? kg(r.w) + ' kg' : 'BW'} × ${r.actual}</td><td>${fmtDate(r.date)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <h3 class="section">Sessions</h3>
    <div class="list">${[...x.entries].reverse().map(e => `
      <a class="list-row" href="#/workouts/history/${e.sessionId}"><div><b>${relDay(e.date)}</b><span class="muted small">${esc(setsText(e.sets))}</span></div>${icon('right')}</a>`).join('')}</div>`;

  const drawChart = (days) => {
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    const pts = x.entries.map(e => ({
      x: parseDate(e.date).getTime(),
      e: Math.max(...e.sets.map(s => e1rm(s.w, s.r))),
      top: Math.max(...e.sets.map(s => s.w || 0)),
    })).filter(p => p.x >= cutoff);
    lineChart(el.querySelector('#ex-chart'), {
      series: [
        { name: 'Est. 1RM', color: 'var(--series-1)', points: pts.map(p => ({ x: p.x, y: Math.round(p.e * 10) / 10 })) },
        { name: 'Top set weight', color: 'var(--series-2)', points: pts.map(p => ({ x: p.x, y: p.top })) },
      ],
      yFormat: v => `${kg(v)}`,
    });
  };
  drawChart(180);
  wireSeg(el, (n, v) => drawChart(Number(v)));
}

// ---------------- templates ----------------
async function renderTemplates(el) {
  const templates = (await all('templates')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  el.innerHTML = `${subHeader('Templates', '#/workouts')}
    <p class="muted small pad">The order here is the rotation used for "Next up".</p>
    <div class="list">${templates.map((t, i) => `
      <div class="list-row static">
        <a href="#/workouts/template/${t.id}" class="grow"><b>${esc(t.name)}</b><span class="muted small">${KINDS.find(k => k.value === t.kind)?.label || ''} · ${t.exercises.length} exercises</span></a>
        <button class="icon-btn" data-move="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
        <button class="icon-btn" data-move="${i}:1" ${i === templates.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
      </div>`).join('')}</div>
    <a class="btn block" href="#/workouts/template/new">${icon('plus')} New template</a>`;
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    const [i, d] = b.dataset.move.split(':').map(Number);
    [templates[i], templates[i + d]] = [templates[i + d], templates[i]];
    for (const [order, t] of templates.entries()) await put('templates', { ...t, order });
    window.app.refresh();
  });
}

async function renderTemplateEditor(el, id) {
  const existing = id !== 'new' ? await get('templates', id) : null;
  const count = (await all('templates')).length;
  const t = existing ? structuredClone(existing)
    : { id: uid(), name: '', kind: 'upper', order: count, exercises: [makeTemplateExercise()] };
  const names = await knownExerciseNames();

  const exRow = (e, i) => `
    <div class="card ex-edit" data-i="${i}">
      <div class="ex-edit-head">
        <input name="name" list="ex-names" value="${esc(e.name)}" placeholder="Exercise name" aria-label="Exercise name">
        <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
        <button class="icon-btn" data-down="${i}" ${i === t.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
        <button class="icon-btn" data-rm="${i}" aria-label="Remove exercise">${icon('trash')}</button>
      </div>
      <div class="grid5">
        <label><span>Sets</span><input name="sets" inputmode="numeric" value="${e.sets}"></label>
        <label><span>Min reps</span><input name="repMin" inputmode="numeric" value="${e.repMin}"></label>
        <label><span>Max reps</span><input name="repMax" inputmode="numeric" value="${e.repMax}"></label>
        <label><span>+kg</span><input name="increment" inputmode="decimal" value="${e.increment}"></label>
        <label><span>Rest s</span><input name="rest" inputmode="numeric" value="${e.rest}"></label>
      </div>
    </div>`;

  const draw = () => {
    el.innerHTML = `${subHeader(existing ? 'Edit template' : 'New template', '#/workouts/templates')}${datalist(names)}
      <div class="card">
        <label class="field"><span>Template name</span><input name="tname" value="${esc(t.name)}" placeholder="e.g. Upper A"></label>
        <div class="field"><span>Type</span>${seg('kind', KINDS, t.kind)}</div>
      </div>
      <p class="muted small pad"><b>+kg</b> is how much weight to add once you hit max reps on every set.</p>
      ${t.exercises.map(exRow).join('')}
      <button class="btn block" data-addex>${icon('plus')} Add exercise</button>
      <button class="btn primary block big" data-save>Save template</button>
      ${existing ? `<button class="btn danger block" data-delete>${icon('trash')} Delete template</button>` : ''}`;
    wireSeg(el, (n, v) => { t.kind = v; });
  };
  draw();

  el.addEventListener('input', (e) => {
    if (e.target.name === 'tname') { t.name = e.target.value; return; }
    const card = e.target.closest('.ex-edit');
    if (!card) return;
    const ex = t.exercises[+card.dataset.i];
    ex[e.target.name] = e.target.name === 'name' ? e.target.value : num(e.target.value);
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.up) { const i = +d.up; [t.exercises[i - 1], t.exercises[i]] = [t.exercises[i], t.exercises[i - 1]]; draw(); }
    else if (d.down) { const i = +d.down; [t.exercises[i + 1], t.exercises[i]] = [t.exercises[i], t.exercises[i + 1]]; draw(); }
    else if (d.rm) { t.exercises.splice(+d.rm, 1); draw(); }
    else if ('addex' in d) { t.exercises.push(makeTemplateExercise()); draw(); el.querySelectorAll('[name=name]').forEach((x, i, a) => i === a.length - 1 && x.focus()); }
    else if ('save' in d) {
      if (!t.name.trim()) return toast('Give the template a name');
      t.exercises = t.exercises.filter(x => x.name && x.name.trim()).map(x => ({
        ...x, name: x.name.trim(), sets: x.sets || 3, repMin: x.repMin || 8,
        repMax: Math.max(x.repMax || 12, x.repMin || 8), increment: x.increment ?? 2.5, rest: x.rest || 120,
      }));
      await put('templates', t);
      toast('Template saved');
      location.hash = '#/workouts/templates';
    } else if ('delete' in d) {
      if (!await ask('Delete template?', `Delete "${t.name}"? Your logged sessions are kept.`, 'Delete', true)) return;
      await del('templates', t.id);
      location.hash = '#/workouts/templates';
    }
  });
}
