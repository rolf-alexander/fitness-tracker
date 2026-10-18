// All app data lives in IndexedDB, a database built into the browser on your phone.
// Nothing is ever sent to a server.

const DB_NAME = 'fitness-tracker';
const DB_VERSION = 1;

// store name -> the field that uniquely identifies each record
export const STORES = {
  kv: 'key',          // settings and small bits of app state
  templates: 'id',    // workout templates
  sessions: 'id',     // finished workout sessions
  activities: 'id',   // bouldering, ski touring, other sport, rest days
  foods: 'id',        // saved foods
  meals: 'id',        // saved meals (made of foods)
  foodlog: 'id',      // what you ate, one record per logged item
  weights: 'date',    // one bodyweight per day
  habitlog: 'date',   // which habits were done each day
  mealplan: 'date',   // planned meals per day
};

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', t => t.objectStore(store).get(key));
export const all = (store) => tx(store, 'readonly', t => t.objectStore(store).getAll());
export const del = (store, key) => tx(store, 'readwrite', t => { t.objectStore(store).delete(key); });
export const put = (store, value) =>
  tx(store, 'readwrite', t => { t.objectStore(store).put(value); }).then(() => value);

export const putMany = (store, values) =>
  tx(store, 'readwrite', t => { const s = t.objectStore(store); values.forEach(v => s.put(v)); });

// Wipe every store and write `data` ({storeName: [records]}) in one go. Used by backup restore.
export function replaceAll(data) {
  const names = Object.keys(STORES);
  return tx(names, 'readwrite', t => {
    for (const name of names) {
      const s = t.objectStore(name);
      s.clear();
      (data[name] || []).forEach(v => s.put(v));
    }
  });
}

export async function dumpAll() {
  const out = {};
  for (const name of Object.keys(STORES)) out[name] = await all(name);
  return out;
}

// Small key/value helpers for settings and app state
export async function getKV(key, fallback = null) {
  const row = await get('kv', key);
  return row ? row.value : fallback;
}
export const setKV = (key, value) => put('kv', { key, value });
export const delKV = (key) => del('kv', key);

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
