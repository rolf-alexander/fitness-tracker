// Default settings, the starter workout programme, and helpers to read/write settings.
import { getKV, setKV, all, putMany, uid } from './db.js';

// Bump this together with VERSION in sw.js whenever you publish a change.
export const APP_VERSION = '1.0.0';

export const DEFAULT_SETTINGS = {
  theme: 'auto',            // 'auto' follows the phone, or 'light' / 'dark'
  kcalTarget: 2950,
  proteinMode: 'auto',      // 'auto' = grams per kg of bodyweight, 'fixed' = a set number
  proteinPerKg: 2,
  proteinFixed: 160,
  proteinFallback: 160,     // used in auto mode until you log a bodyweight
  gainMinPct: 0.25,         // lean bulk target: % of bodyweight gained per week
  gainMaxPct: 0.5,
  defaultRest: 120,         // seconds
  habits: [
    { id: 'creatine', name: 'Creatine' },
    { id: 'protein', name: 'Hit protein' },
    { id: 'sleep', name: '8h sleep' },
    { id: 'cs50', name: 'CS50' },
  ],
  lastBackup: null,
};

export const FOOD_CATEGORIES = [
  'Produce', 'Meat & fish', 'Dairy & eggs', 'Bakery & grains',
  'Tins, jars & dry goods', 'Frozen', 'Snacks & drinks', 'Supplements', 'Other',
];

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await getKV('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await setKV('settings', next);
  return next;
}

// Protein target in grams: either fixed, or grams-per-kg of your recent average bodyweight.
export async function proteinTarget(settings) {
  settings = settings || await getSettings();
  if (settings.proteinMode === 'fixed') return Math.round(settings.proteinFixed);
  const weights = (await all('weights')).sort((a, b) => a.date.localeCompare(b.date));
  if (!weights.length) return settings.proteinFallback;
  const recent = weights.slice(-7);
  const avg = recent.reduce((s, w) => s + w.kg, 0) / recent.length;
  return Math.round(avg * settings.proteinPerKg);
}

// exercise: [name, sets, repMin, repMax, incrementKg, restSeconds]
const STARTER = [
  ['Upper A', 'upper', [
    ['Bench press', 3, 6, 8, 2.5, 180],
    ['Barbell row', 3, 6, 8, 2.5, 180],
    ['Overhead press', 3, 8, 10, 2.5, 150],
    ['Lat pulldown', 3, 8, 12, 2.5, 120],
    ['Lateral raise', 3, 12, 15, 1, 60],
    ['Triceps pushdown', 2, 10, 15, 2.5, 60],
  ]],
  ['Lower A', 'lower', [
    ['Back squat', 3, 5, 8, 5, 180],
    ['Romanian deadlift', 3, 8, 10, 5, 150],
    ['Leg press', 3, 10, 12, 5, 120],
    ['Lying leg curl', 3, 10, 15, 2.5, 90],
    ['Standing calf raise', 3, 10, 15, 5, 60],
  ]],
  ['Upper B', 'upper', [
    ['Incline dumbbell press', 3, 8, 10, 2, 150],
    ['Weighted pull-up', 3, 6, 10, 2.5, 150],
    ['Seated cable row', 3, 10, 12, 2.5, 120],
    ['Dumbbell shoulder press', 3, 8, 12, 2, 120],
    ['Dumbbell curl', 3, 10, 12, 1, 60],
    ['Face pull', 2, 12, 15, 2.5, 60],
  ]],
  ['Lower B', 'lower', [
    ['Deadlift', 3, 4, 6, 5, 180],
    ['Bulgarian split squat', 3, 8, 10, 2, 120],
    ['Hip thrust', 3, 8, 12, 5, 120],
    ['Leg extension', 3, 10, 15, 2.5, 90],
    ['Hanging leg raise', 3, 10, 15, 0, 60],
  ]],
];

export function makeTemplateExercise(name = '', sets = 3, repMin = 8, repMax = 12, increment = 2.5, rest = 120) {
  return { id: uid(), name, sets, repMin, repMax, increment, rest };
}

// Runs once, the first time the app opens on a device.
export async function seedIfNeeded() {
  if (await getKV('seeded')) return;
  const templates = STARTER.map(([name, kind, exs], order) => ({
    id: uid(), name, kind, order,
    exercises: exs.map(e => makeTemplateExercise(...e)),
  }));
  await putMany('templates', templates);
  await setKV('settings', DEFAULT_SETTINGS);
  await setKV('seeded', true);
}
