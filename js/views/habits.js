// Habits: editable daily checklist, streaks and a monthly calendar.
import { all, get, put, uid } from '../db.js';
import { getSettings, saveSettings, proteinTarget } from '../settings-store.js';
import { esc, icon, today, addDays, relDay, fmtDate, parseDate, isoDate, openSheet, ask, toast, buzz, DAY_LETTERS } from '../ui.js';
import { dayTotals } from './nutrition.js';

// Current streak counts back from today; if today isn't ticked yet, it counts from yesterday.
export function streaks(habitId, logByDate) {
  const done = (d) => !!logByDate[d]?.done?.[habitId];
  let d = done(today()) ? today() : addDays(today(), -1);
  let current = 0;
  while (done(d)) { current++; d = addDays(d, -1); }
  const dates = Object.keys(logByDate).filter(done).sort();
  let best = 0, run = 0, prev = null;
  for (const x of dates) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best };
}

export async function render(el, params) {
  const date = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : today();
  const month = (params[1] && /^\d{4}-\d{2}$/.test(params[1])) ? params[1] : date.slice(0, 7);
  const [settings, logs] = await Promise.all([getSettings(), all('habitlog')]);
  const habits = settings.habits;
  const logByDate = Object.fromEntries(logs.map(l => [l.date, l]));
  const dayLog = logByDate[date] || { date, done: {} };

  // Protein hint, so you can see whether "hit protein" is earned
  let proteinHint = '';
  if (habits.some(h => /protein/i.test(h.name))) {
    const [t, target] = [await dayTotals(date), await proteinTarget(settings)];
    proteinHint = `${Math.round(t.protein)} / ${target} g so far`;
  }

  // Month calendar
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1, 12);
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const prevMonth = isoDate(new Date(y, m - 2, 1, 12)).slice(0, 7);
  const nextMonth = isoDate(new Date(y, m, 1, 12)).slice(0, 7);
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell empty"></span>');
  let monthDone = 0, monthPossible = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = `${month}-${String(day).padStart(2, '0')}`;
    const n = habits.filter(h => logByDate[d]?.done?.[h.id]).length;
    const frac = habits.length ? n / habits.length : 0;
    if (d <= today()) { monthDone += n; monthPossible += habits.length; }
    const level = d > today() ? 'future' : frac === 0 ? 'l0' : frac < 0.5 ? 'l1' : frac < 1 ? 'l2' : 'l3';
    cells.push(`<a class="cal-cell ${level} ${d === date ? 'sel' : ''} ${d === today() ? 'today' : ''}" href="#/habits/${d}/${month}" aria-label="${fmtDate(d)}: ${n} of ${habits.length} done">${day}</a>`);
  }
  const perHabitMonth = habits.map(h => {
    let n = 0;
    for (let day = 1; day <= daysInMonth; day++) if (logByDate[`${month}-${String(day).padStart(2, '0')}`]?.done?.[h.id]) n++;
    return n;
  });
  const elapsed = month === today().slice(0, 7) ? Number(today().slice(8)) : month < today().slice(0, 7) ? daysInMonth : 0;

  el.innerHTML = `
    <div class="week-nav">
      <a class="icon-btn" href="#/habits/${addDays(date, -1)}" aria-label="Previous day">${icon('left')}</a>
      <div><b>${relDay(date)}</b></div>
      ${date < today() ? `<a class="icon-btn" href="#/habits/${addDays(date, 1)}" aria-label="Next day">${icon('right')}</a>` : '<span class="icon-btn"></span>'}
    </div>
    <div class="habit-list">
      ${habits.map(h => {
        const done = !!dayLog.done[h.id];
        const s = streaks(h.id, logByDate);
        return `<button class="habit ${done ? 'done' : ''}" data-habit="${h.id}" aria-pressed="${done}">
          <span class="habit-check">${icon('check')}</span>
          <span class="habit-name"><b>${esc(h.name)}</b>${/protein/i.test(h.name) && proteinHint ? `<small>${proteinHint}</small>` : ''}</span>
          <span class="streak ${s.current ? 'on' : ''}" title="Current streak">${icon('flame')}${s.current}</span>
        </button>`;
      }).join('')}
    </div>
    <button class="btn ghost block" data-edit>${icon('edit')} Edit habits</button>
    <div class="card">
      <div class="week-nav tight">
        <a class="icon-btn" href="#/habits/${date}/${prevMonth}" aria-label="Previous month">${icon('left')}</a>
        <b>${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
        <a class="icon-btn" href="#/habits/${date}/${nextMonth}" aria-label="Next month">${icon('right')}</a>
      </div>
      <div class="cal">${DAY_LETTERS.map(l => `<span class="cal-head">${l}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span><i class="l0"></i>none</span><span><i class="l1"></i>some</span><span><i class="l2"></i>most</span><span><i class="l3"></i>all</span></div>
      <p class="muted small">${monthPossible ? `${Math.round(monthDone / monthPossible * 100)}% of habits done this month` : ''}</p>
    </div>
    <div class="card">
      <div class="card-title">Streaks</div>
      <table class="table"><thead><tr><th>Habit</th><th>Now</th><th>Best</th><th>This month</th></tr></thead><tbody>
      ${habits.map((h, i) => { const s = streaks(h.id, logByDate); return `<tr><td>${esc(h.name)}</td><td>${s.current}</td><td>${s.best}</td><td>${perHabitMonth[i]}/${elapsed}</td></tr>`; }).join('')}
      </tbody></table>
    </div>`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.habit) {
      const rec = (await get('habitlog', date)) || { date, done: {} };
      rec.done[b.dataset.habit] = !rec.done[b.dataset.habit];
      if (!rec.done[b.dataset.habit]) delete rec.done[b.dataset.habit];
      await put('habitlog', rec);
      buzz(15);
      window.app.refresh();
    }
    if ('edit' in b.dataset) editHabits(habits);
  });
}

function editHabits(habits) {
  const list = habits.map(h => ({ ...h }));
  openSheet('Edit habits', `<div class="habit-edit"></div>
    <button class="btn block" data-add>${icon('plus')} Add habit</button>
    <button class="btn primary block" data-save>Save</button>
    <p class="muted small">Removing a habit hides it; its history stays in your backups.</p>`, (el, close) => {
    const box = el.querySelector('.habit-edit');
    const draw = () => {
      box.innerHTML = list.map((h, i) => `<div class="habit-edit-row" data-i="${i}">
        <input value="${esc(h.name)}" aria-label="Habit name">
        <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
        <button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon('trash')}</button></div>`).join('');
    };
    draw();
    box.addEventListener('input', (e) => { list[+e.target.closest('[data-i]').dataset.i].name = e.target.value; });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.up) { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }
      else if (b.dataset.rm) {
        const i = +b.dataset.rm;
        if (await ask('Remove habit?', `Remove "${list[i].name}" from your checklist?`, 'Remove', true)) { list.splice(i, 1); draw(); }
      } else if ('add' in b.dataset) {
        list.push({ id: uid(), name: '' }); draw();
        box.querySelector('.habit-edit-row:last-child input').focus();
      } else if ('save' in b.dataset) {
        await saveSettings({ habits: list.filter(h => h.name.trim()).map(h => ({ ...h, name: h.name.trim() })) });
        close(); toast('Habits saved'); window.app.refresh();
      }
    });
  });
}

