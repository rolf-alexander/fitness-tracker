// The app shell: tab bar, page routing (#/tab/...), theme, offline support and updates.
import { seedIfNeeded, getSettings } from './settings-store.js';
import { icon, applyTheme } from './ui.js';
import { initTimer } from './timer.js';
import * as workouts from './views/workouts.js';
import * as nutrition from './views/nutrition.js';
import * as bodyweight from './views/bodyweight.js';
import * as load from './views/load.js';
import * as habits from './views/habits.js';
import * as mealprep from './views/mealprep.js';
import * as settings from './views/settings.js';

const TABS = [
  { id: 'workouts', label: 'Train', title: 'Workouts', icon: 'dumbbell', view: workouts },
  { id: 'nutrition', label: 'Food', title: 'Nutrition', icon: 'food', view: nutrition },
  { id: 'weight', label: 'Weight', title: 'Bodyweight', icon: 'scale', view: bodyweight },
  { id: 'load', label: 'Load', title: 'Training load', icon: 'calendar', view: load },
  { id: 'habits', label: 'Habits', title: 'Habits', icon: 'habits', view: habits },
  { id: 'prep', label: 'Prep', title: 'Meal prep', icon: 'cart', view: mealprep },
];
const PAGES = { ...Object.fromEntries(TABS.map(t => [t.id, t])), settings: { id: 'settings', title: 'Settings', view: settings } };

let rendering = Promise.resolve();

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const page = PAGES[parts[0]] ? parts[0] : 'workouts';
  return { page, params: parts.slice(1) };
}

async function route({ keepScroll = false } = {}) {
  const { page, params } = parseHash();
  const def = PAGES[page];
  document.getElementById('page-title').textContent = def.title;
  document.querySelectorAll('.tabbar a').forEach(a => {
    const on = a.dataset.tab === page;
    a.classList.toggle('on', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  const y = window.scrollY;
  // Each render gets a fresh container, so old event listeners disappear with it.
  // It's built invisibly inside the page (so charts can measure their width), then swapped in.
  const main = document.getElementById('main');
  const view = document.createElement('div');
  view.className = 'view building';
  main.appendChild(view);
  try {
    await def.view.render(view, params);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="notice warn">${icon('warn')}<div>Something went wrong showing this page: ${String(err.message || err)}</div></div>`;
  }
  [...main.children].forEach(c => { if (c !== view) c.remove(); });
  view.classList.remove('building');
  window.scrollTo(0, keepScroll ? y : 0);
}

// Views call window.app.refresh() after saving something, to redraw the current page in place.
window.app = {
  refresh: () => (rendering = rendering.then(() => route({ keepScroll: true }))),
};

function buildShell() {
  document.getElementById('settings-link').innerHTML = icon('gear');
  document.querySelector('.tabbar').innerHTML = TABS.map(t =>
    `<a href="#/${t.id}" data-tab="${t.id}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  // Tapping the current tab again takes you to its main page
  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && location.hash.startsWith(`#/${a.dataset.tab}/`)) { e.preventDefault(); location.hash = `#/${a.dataset.tab}`; }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const offerUpdate = (worker) => {
      const banner = document.getElementById('update-banner');
      banner.hidden = false;
      banner.querySelector('button').onclick = () => worker.postMessage('skipWaiting');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
  }).catch(err => console.warn('Offline support unavailable:', err));
  // Reload only after you tap "Update now" (an old version was running). On the very first
  // visit the offline copy installs in the background and must NOT reload the page mid-use.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}

async function start() {
  buildShell();
  await seedIfNeeded();
  applyTheme((await getSettings()).theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', async () => applyTheme((await getSettings()).theme));
  // Ask the browser to protect our storage from automatic clean-up
  navigator.storage?.persist?.().catch(() => {});
  initTimer();
  window.addEventListener('hashchange', () => { rendering = rendering.then(() => route()); });
  await (rendering = route());
  document.body.classList.add('ready');
  registerServiceWorker();
}

start();
