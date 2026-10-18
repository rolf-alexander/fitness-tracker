// Rest timer. It stores the moment your rest ENDS (not a countdown), so it stays
// correct if you switch apps, lock the phone, or even close and reopen the app.
import { icon, buzz } from './ui.js';

const KEY = 'restTimer';
let tick, audioCtx, doneShownUntil = 0;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save(state) {
  try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

// iPhones only allow sound after a tap, so we "unlock" audio when the timer is started by a tap.
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}

function beep() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(offset => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + offset);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + offset + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + offset); o.stop(t0 + offset + 0.2);
    });
  } catch { /* ignore */ }
}

export function startRest(seconds) {
  unlockAudio();
  save({ endAt: Date.now() + seconds * 1000, total: seconds, alerted: false });
  run();
}

export function adjustRest(deltaSeconds) {
  const s = load();
  if (!s) return;
  s.endAt += deltaSeconds * 1000;
  s.total = Math.max(1, s.total + deltaSeconds);
  if (s.endAt > Date.now()) s.alerted = false;
  save(s);
  render();
}

export function stopRest() {
  save(null);
  doneShownUntil = 0;
  render();
}

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function render() {
  const bar = document.getElementById('timer-bar');
  const s = load();
  if (!s) {
    bar.classList.remove('show', 'done');
    document.body.classList.remove('has-timer');
    clearInterval(tick); tick = null;
    return;
  }
  const left = s.endAt - Date.now();
  if (left <= 0 && !s.alerted) {
    s.alerted = true;
    save(s);
    // Only make noise if the app is on screen right now
    if (document.visibilityState === 'visible' && left > -5000) { beep(); buzz([200, 100, 200]); }
    doneShownUntil = Date.now() + 8000;
  }
  if (left <= 0 && Date.now() > doneShownUntil && left < -8000) {
    stopRest();
    return;
  }
  const pct = Math.max(0, Math.min(100, (left / (s.total * 1000)) * 100));
  bar.classList.add('show');
  bar.classList.toggle('done', left <= 0);
  document.body.classList.add('has-timer');
  bar.innerHTML = `
    <div class="timer-progress" style="width:${pct}%"></div>
    <div class="timer-label">${icon('timer')}<span class="timer-time">${left > 0 ? mmss(left) : 'Rest done'}</span></div>
    <div class="timer-btns">
      <button data-t="-15" aria-label="15 seconds less">−15</button>
      <button data-t="15" aria-label="15 seconds more">+15</button>
      <button data-t="stop" aria-label="Stop timer">${icon('x')}</button>
    </div>`;
}

function run() {
  render();
  if (!tick) tick = setInterval(render, 250);
}

export function initTimer() {
  const bar = document.getElementById('timer-bar');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t === 'stop') stopRest();
    else adjustRest(Number(b.dataset.t));
  });
  // When you come back to the app, update straight away
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && load()) run(); });
  if (load()) run();
}
