// Backups: export/import everything as JSON (full restore) or individual tables as CSV.
import { dumpAll, replaceAll, all, put, putMany, uid, STORES } from './db.js';
import { getSettings } from './settings-store.js';
import { today } from './ui.js';

const APP_ID = 'fitness-tracker';

export async function exportJSON() {
  const data = await dumpAll();
  return JSON.stringify({ app: APP_ID, version: 1, exportedAt: new Date().toISOString(), data }, null, 1);
}

// Replaces ALL data on this device with the backup.
export async function importJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (parsed?.app !== APP_ID || !parsed.data) throw new Error('That file is not a Fitness Tracker backup.');
  const data = {};
  for (const name of Object.keys(STORES)) data[name] = Array.isArray(parsed.data[name]) ? parsed.data[name] : [];
  // Never import a half-finished session timer state; keep the rest of kv
  await replaceAll(data);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
}

// ---------- CSV ----------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCSV = (header, rows) => [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

const n = (v) => (v === '' || v === undefined ? null : Number(String(v).replace(',', '.')));

export const CSV_TABLES = {
  workout_sets: {
    label: 'Workout sets',
    header: ['date', 'session', 'type', 'intensity', 'exercise', 'set', 'weight_kg', 'reps', 'rpe'],
    async rows() {
      const sessions = (await all('sessions')).sort((a, b) => a.date.localeCompare(b.date));
      return sessions.flatMap(s => s.exercises.flatMap(ex => ex.sets.filter(x => x.done !== false).map((x, i) =>
        [s.date, s.name, s.kind, s.intensity, ex.name, i + 1, x.w, x.r, x.rpe])));
    },
    async import(objs) {
      const groups = new Map();
      for (const o of objs) {
        const key = `${o.date}|${o.session}`;
        if (!groups.has(key)) groups.set(key, { id: uid(), date: o.date, name: o.session || 'Workout', kind: o.type || 'other', intensity: o.intensity || 'moderate', templateId: null, finishedAt: Date.parse(o.date) || Date.now(), notes: '', exercises: [] });
        const s = groups.get(key);
        let ex = s.exercises.find(e => e.name === o.exercise);
        if (!ex) { ex = { name: o.exercise, repMin: 8, repMax: 12, increment: 2.5, sets: [] }; s.exercises.push(ex); }
        ex.sets.push({ w: n(o.weight_kg), r: n(o.reps), rpe: n(o.rpe), done: true });
      }
      await putMany('sessions', [...groups.values()]);
      return groups.size + ' sessions';
    },
  },
  nutrition_log: {
    label: 'Nutrition log',
    header: ['date', 'time', 'name', 'servings', 'kcal_per_serving', 'protein_per_serving', 'kcal_total', 'protein_total'],
    async rows() {
      return (await all('foodlog')).sort((a, b) => a.time - b.time).map(e => [
        e.date, new Date(e.time).toTimeString().slice(0, 5), e.name, e.servings, e.kcal, e.protein,
        Math.round(e.kcal * e.servings), Math.round(e.protein * e.servings * 10) / 10]);
    },
    async import(objs) {
      await putMany('foodlog', objs.map(o => ({
        id: uid(), date: o.date, time: Date.parse(`${o.date}T${o.time || '12:00'}`) || Date.now(), name: o.name || 'Imported',
        servings: n(o.servings) || 1, kcal: n(o.kcal_per_serving) ?? n(o.kcal_total) ?? 0,
        protein: n(o.protein_per_serving) ?? n(o.protein_total) ?? 0, refType: 'quick', refId: null,
      })));
      return objs.length + ' entries';
    },
  },
  bodyweight: {
    label: 'Bodyweight',
    header: ['date', 'weight_kg'],
    async rows() { return (await all('weights')).sort((a, b) => a.date.localeCompare(b.date)).map(w => [w.date, w.kg]); },
    async import(objs) {
      const rows = objs.filter(o => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && n(o.weight_kg)).map(o => ({ date: o.date, kg: n(o.weight_kg) }));
      await putMany('weights', rows);
      return rows.length + ' weigh-ins';
    },
  },
  activities: {
    label: 'Activities',
    header: ['date', 'type', 'name', 'duration_min', 'intensity', 'upper_body', 'elevation_m', 'notes'],
    async rows() {
      return (await all('activities')).sort((a, b) => a.date.localeCompare(b.date)).map(a =>
        [a.date, a.type, a.name || '', a.duration, a.intensity, a.upperBody ? 'yes' : '', a.elevation, a.notes]);
    },
    async import(objs) {
      await putMany('activities', objs.map(o => ({
        id: uid(), date: o.date, type: o.type || 'sport', name: o.name || '', duration: n(o.duration_min),
        intensity: o.intensity || 'moderate', upperBody: o.upper_body === 'yes', elevation: n(o.elevation_m), notes: o.notes || '',
      })));
      return objs.length + ' activities';
    },
  },
  habits: {
    label: 'Habits',
    header: ['date', 'habit', 'done'],
    async rows() {
      const names = Object.fromEntries((await getSettings()).habits.map(h => [h.id, h.name]));
      return (await all('habitlog')).sort((a, b) => a.date.localeCompare(b.date)).flatMap(l =>
        Object.keys(l.done).filter(k => l.done[k]).map(k => [l.date, names[k] || k, 'yes']));
    },
    async import(objs) {
      const settings = await getSettings();
      const idFor = (name) => settings.habits.find(h => h.name === name || h.id === name)?.id || name;
      const byDate = Object.fromEntries((await all('habitlog')).map(l => [l.date, l]));
      for (const o of objs) {
        if (o.done !== 'yes') continue;
        (byDate[o.date] ||= { date: o.date, done: {} }).done[idFor(o.habit)] = true;
      }
      await putMany('habitlog', Object.values(byDate));
      return objs.length + ' habit ticks';
    },
  },
  foods: {
    label: 'Saved foods',
    header: ['name', 'serving', 'kcal', 'protein', 'category'],
    async rows() { return (await all('foods')).map(f => [f.name, f.serving, f.kcal, f.protein, f.category]); },
    async import(objs) {
      await putMany('foods', objs.filter(o => o.name).map(o => ({
        id: uid(), name: o.name, serving: o.serving || '1 serving', kcal: n(o.kcal) || 0, protein: n(o.protein) || 0, category: o.category || 'Other',
      })));
      return objs.length + ' foods';
    },
  },
};

export async function exportCSV(table) {
  const t = CSV_TABLES[table];
  return { filename: `fitness-${table.replace('_', '-')}-${today()}.csv`, text: toCSV(t.header, await t.rows()) };
}

// Works out which table a CSV belongs to from its header row, then adds the rows.
export async function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 1) throw new Error('That CSV file is empty.');
  const header = rows[0].map(h => h.trim().toLowerCase());
  const entry = Object.entries(CSV_TABLES).find(([, t]) => t.header.every(h => header.includes(h)));
  if (!entry) throw new Error('Unrecognised CSV. Use a file exported from this app (the column names must match).');
  const objs = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  const result = await entry[1].import(objs);
  return `${entry[1].label}: added ${result}`;
}

export async function markBackedUp() {
  const s = await getSettings();
  await put('kv', { key: 'settings', value: { ...s, lastBackup: new Date().toISOString() } });
}
