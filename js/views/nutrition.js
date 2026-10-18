// Nutrition: daily calorie/protein targets, one-tap logging of saved foods & meals, weekly average.
import { all, get, put, del, uid } from '../db.js';
import { getSettings, proteinTarget, FOOD_CATEGORIES } from '../settings-store.js';
import {
  esc, icon, num, fmt, today, addDays, relDay, fmtDate, parseDate,
  openSheet, ask, toast, subHeader, buzz,
} from '../ui.js';
import { barChart } from '../chart.js';

// Calories & protein for one portion of a meal, worked out from its foods
export function mealTotals(meal, foodsById) {
  return meal.items.reduce((t, it) => {
    const f = foodsById[it.foodId];
    if (f) { t.kcal += f.kcal * it.servings; t.protein += f.protein * it.servings; }
    return t;
  }, { kcal: 0, protein: 0 });
}

const byId = (rows) => Object.fromEntries(rows.map(r => [r.id, r]));
const entryKcal = (e) => e.kcal * e.servings;
const entryProtein = (e) => e.protein * e.servings;

export async function dayTotals(date) {
  const log = (await all('foodlog')).filter(e => e.date === date);
  return {
    kcal: log.reduce((s, e) => s + entryKcal(e), 0),
    protein: log.reduce((s, e) => s + entryProtein(e), 0),
  };
}

export async function render(el, params) {
  const [page, arg] = params;
  if (page === 'foods') return renderLibrary(el);
  const date = page && /^\d{4}-\d{2}-\d{2}$/.test(page) ? page : today();
  return renderDay(el, date);
}

async function logItem(date, item, servings = 1) {
  const entry = {
    id: uid(), date, time: Date.now(), name: item.name,
    kcal: item.kcal, protein: item.protein, servings,
    refType: item.refType, refId: item.refId || null,
  };
  await put('foodlog', entry);
  buzz(15);
  toast(`Logged ${item.name}`, { undo: async () => { await del('foodlog', entry.id); window.app.refresh(); } });
  window.app.refresh();
}

async function renderDay(el, date) {
  const [settings, foods, meals, log, plan] = await Promise.all([
    getSettings(), all('foods'), all('meals'), all('foodlog'), get('mealplan', date),
  ]);
  const protTarget = await proteinTarget(settings);
  const foodsById = byId(foods);
  const dayLog = log.filter(e => e.date === date).sort((a, b) => a.time - b.time);
  const kcal = dayLog.reduce((s, e) => s + entryKcal(e), 0);
  const prot = dayLog.reduce((s, e) => s + entryProtein(e), 0);

  // Last 7 days ending on the selected date
  const week = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map(d => {
    const items = log.filter(e => e.date === d);
    return { d, logged: items.length > 0, kcal: items.reduce((s, e) => s + entryKcal(e), 0), protein: items.reduce((s, e) => s + entryProtein(e), 0) };
  });
  const logged = week.filter(w => w.logged);
  const avgK = logged.length ? logged.reduce((s, w) => s + w.kcal, 0) / logged.length : null;
  const avgP = logged.length ? logged.reduce((s, w) => s + w.protein, 0) / logged.length : null;

  // Usage counts so your most-used items come first
  const uses = {};
  log.forEach(e => { if (e.refId) uses[e.refId] = (uses[e.refId] || 0) + 1; });
  const mealItems = meals.map(m => ({ ...mealTotals(m, foodsById), name: m.name, refType: 'meal', refId: m.id }))
    .sort((a, b) => (uses[b.refId] || 0) - (uses[a.refId] || 0) || a.name.localeCompare(b.name));
  const foodItems = foods.map(f => ({ name: f.name, kcal: f.kcal, protein: f.protein, refType: 'food', refId: f.id, serving: f.serving }))
    .sort((a, b) => (uses[b.refId] || 0) - (uses[a.refId] || 0) || a.name.localeCompare(b.name));
  const planned = (plan?.items || []).map(it => {
    if (it.type === 'meal') { const m = meals.find(x => x.id === it.id); return m && { ...mealTotals(m, foodsById), name: m.name, refType: 'meal', refId: m.id, portions: it.portions || 1 }; }
    const f = foodsById[it.id]; return f && { name: f.name, kcal: f.kcal, protein: f.protein, refType: 'food', refId: f.id, portions: it.portions || 1 };
  }).filter(Boolean);
  const plannedDone = (p) => dayLog.some(e => e.refId === p.refId);

  const bar = (val, target, unit, label) => {
    const pct = Math.min(100, (val / target) * 100);
    const left = target - val;
    return `<div class="meter">
      <div class="meter-top"><span>${label}</span><span><b>${fmt(val)}</b> / ${fmt(target)} ${unit}</span></div>
      <div class="meter-track"><div class="meter-fill ${val > target * 1.05 ? 'over' : ''}" style="width:${pct}%"></div></div>
      <div class="muted small">${left >= 0 ? `${fmt(left)} ${unit} to go` : `${fmt(-left)} ${unit} over`}</div>
    </div>`;
  };
  const itemBtn = (it, cls = '') => `<button class="food-btn ${cls}" data-log="${it.refType}:${it.refId}">
      <b>${esc(it.name)}</b><span>${fmt(it.kcal)} kcal · ${fmt(it.protein)} g${it.serving ? ` · ${esc(it.serving)}` : ''}</span></button>`;

  el.innerHTML = `
    <div class="week-nav">
      <a class="icon-btn" href="#/nutrition/${addDays(date, -1)}" aria-label="Previous day">${icon('left')}</a>
      <div><b>${relDay(date)}</b></div>
      ${date < today() ? `<a class="icon-btn" href="#/nutrition/${addDays(date, 1)}" aria-label="Next day">${icon('right')}</a>` : '<span class="icon-btn"></span>'}
    </div>
    <div class="card">
      ${bar(kcal, settings.kcalTarget, 'kcal', 'Calories')}
      ${bar(prot, protTarget, 'g', 'Protein')}
    </div>
    ${planned.length ? `<h3 class="section">From your meal plan</h3><div class="food-grid">${planned.map(p => `
      <button class="food-btn planned ${plannedDone(p) ? 'logged' : ''}" data-log="${p.refType}:${p.refId}" data-portions="${p.portions}">
        <b>${plannedDone(p) ? '✓ ' : ''}${esc(p.name)}${p.portions !== 1 ? ` ×${p.portions}` : ''}</b><span>${fmt(p.kcal * p.portions)} kcal · ${fmt(p.protein * p.portions)} g</span></button>`).join('')}</div>` : ''}
    <div class="section-row"><h3 class="section">Log food</h3><a class="link" href="#/nutrition/foods">Manage foods &amp; meals</a></div>
    ${mealItems.length + foodItems.length > 8 ? '<input class="search" type="search" placeholder="Search foods & meals" aria-label="Search foods and meals">' : ''}
    <div class="food-grid" id="food-grid">
      <button class="food-btn add" data-quick>${icon('plus')}<b>Quick add</b><span>Type in calories</span></button>
      ${mealItems.map(m => itemBtn(m, 'meal')).join('')}
      ${foodItems.map(f => itemBtn(f)).join('')}
    </div>
    ${!mealItems.length && !foodItems.length ? `<p class="muted small pad">Save the foods you eat often (and meals made from them) so each one becomes a one-tap button here. <a class="link" href="#/nutrition/foods">Add foods</a></p>` : ''}
    <h3 class="section">${date === today() ? 'Eaten today' : 'Eaten'}</h3>
    ${dayLog.length ? `<div class="list">${dayLog.map(e => `
      <button class="list-row" data-entry="${e.id}">
        <div><b>${esc(e.name)}${e.servings !== 1 ? ` <span class="muted">×${fmt(e.servings, e.servings % 1 ? 1 : 0)}</span>` : ''}</b>
        <span class="muted small">${new Date(e.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${fmt(entryKcal(e))} kcal · ${fmt(entryProtein(e))} g protein</span></div>${icon('edit')}
      </button>`).join('')}</div>` : '<p class="empty">Nothing logged yet.</p>'}
    <div class="card">
      <div class="card-title">${icon('chart')} Last 7 days</div>
      <div class="stat-row two">
        <div class="stat"><b>${avgK === null ? '–' : fmt(avgK)}</b><span>avg kcal / day</span></div>
        <div class="stat"><b>${avgP === null ? '–' : fmt(avgP)}</b><span>avg protein (g)</span></div>
      </div>
      <div class="chart" id="kcal-week"></div>
      <p class="muted small">Averages only count days with something logged (${logged.length} of 7). Dashed line = calorie target.</p>
    </div>`;

  barChart(el.querySelector('#kcal-week'), {
    target: settings.kcalTarget,
    bars: week.map(w => ({
      label: fmtDate(w.d, { weekday: 'narrow' }),
      value: w.kcal,
      tip: `<b>${fmtDate(w.d, { weekday: 'short', day: 'numeric', month: 'short' })}</b><div>${w.logged ? `${fmt(w.kcal)} kcal · ${fmt(w.protein)} g protein` : 'Nothing logged'}</div>`,
    })),
  });

  el.querySelector('.search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll('#food-grid .food-btn:not(.add)').forEach(b => { b.style.display = b.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.log) {
      const [type, id] = b.dataset.log.split(':');
      const it = (type === 'meal' ? mealItems : foodItems).find(x => x.refId === id);
      if (it) await logItem(date, it, Number(b.dataset.portions) || 1);
    } else if ('quick' in b.dataset) {
      quickAdd(date);
    } else if (b.dataset.entry) {
      editEntry(dayLog.find(x => x.id === b.dataset.entry));
    }
  });
}

function quickAdd(date) {
  openSheet('Quick add', `
    <label class="field"><span>Name (optional)</span><input name="name" placeholder="e.g. Restaurant dinner"></label>
    <div class="grid2">
      <label class="field"><span>Calories</span><input name="kcal" inputmode="numeric" placeholder="kcal"></label>
      <label class="field"><span>Protein (g)</span><input name="protein" inputmode="decimal" placeholder="g"></label>
    </div>
    <label class="check-field"><input type="checkbox" name="save"><span>Also save as a food for one-tap logging</span></label>
    <button class="btn primary block big" data-add>Log it</button>`, (el, close) => {
    el.querySelector('[name=kcal]').focus();
    el.querySelector('[data-add]').onclick = async () => {
      const kcal = num(el.querySelector('[name=kcal]').value);
      const protein = num(el.querySelector('[name=protein]').value) || 0;
      if (kcal === null) return toast('Enter the calories');
      const name = el.querySelector('[name=name]').value.trim() || 'Quick add';
      let refId = null, refType = 'quick';
      if (el.querySelector('[name=save]').checked) {
        const f = { id: uid(), name, kcal, protein, serving: '1 serving', category: 'Other' };
        await put('foods', f);
        refId = f.id; refType = 'food';
      }
      close();
      await logItem(date, { name, kcal, protein, refType, refId });
    };
  });
}

function editEntry(entry) {
  openSheet(entry.name, `
    <div class="field"><span>Servings</span>
      <div class="stepper"><button type="button" data-step="-0.5">−</button><input name="servings" inputmode="decimal" value="${entry.servings}"><button type="button" data-step="0.5">+</button></div>
    </div>
    <div class="grid2">
      <label class="field"><span>kcal per serving</span><input name="kcal" inputmode="numeric" value="${Math.round(entry.kcal)}"></label>
      <label class="field"><span>Protein per serving (g)</span><input name="protein" inputmode="decimal" value="${Math.round(entry.protein * 10) / 10}"></label>
    </div>
    <label class="field"><span>Date</span><input type="date" name="date" value="${entry.date}"></label>
    <div class="row-btns">
      <button class="btn danger" data-del>${icon('trash')} Delete</button>
      <button class="btn primary" data-save>Save</button>
    </div>`, (el, close) => {
    const s = el.querySelector('[name=servings]');
    el.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
      s.value = Math.max(0.5, (num(s.value) || 1) + Number(b.dataset.step));
    });
    el.querySelector('[data-save]').onclick = async () => {
      await put('foodlog', {
        ...entry, servings: num(s.value) || 1,
        kcal: num(el.querySelector('[name=kcal]').value) ?? entry.kcal,
        protein: num(el.querySelector('[name=protein]').value) ?? entry.protein,
        date: el.querySelector('[name=date]').value || entry.date,
      });
      close(); window.app.refresh();
    };
    el.querySelector('[data-del]').onclick = async () => {
      await del('foodlog', entry.id);
      close();
      toast(`Removed ${entry.name}`, { undo: async () => { await put('foodlog', entry); window.app.refresh(); } });
      window.app.refresh();
    };
  });
}

// ---------------- foods & meals library ----------------
async function renderLibrary(el) {
  const [foods, meals] = await Promise.all([all('foods'), all('meals')]);
  const foodsById = byId(foods);
  foods.sort((a, b) => a.name.localeCompare(b.name));
  meals.sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `${subHeader('Foods & meals', '#/nutrition')}
    <div class="section-row"><h3 class="section">Meals</h3><button class="btn small" data-newmeal ${foods.length ? '' : 'disabled'}>${icon('plus')} New meal</button></div>
    ${meals.length ? `<div class="list">${meals.map(m => {
      const t = mealTotals(m, foodsById);
      return `<button class="list-row" data-meal="${m.id}"><div><b>${esc(m.name)}</b><span class="muted small">${fmt(t.kcal)} kcal · ${fmt(t.protein)} g · ${m.items.length} items</span></div>${icon('edit')}</button>`;
    }).join('')}</div>` : `<p class="muted small pad">${foods.length ? 'Combine foods into a meal (e.g. "Overnight oats") to log it in one tap.' : 'Add some foods first, then combine them into meals.'}</p>`}
    <div class="section-row"><h3 class="section">Foods</h3><button class="btn small" data-newfood>${icon('plus')} New food</button></div>
    ${foods.length ? `<div class="list">${foods.map(f => `
      <button class="list-row" data-food="${f.id}"><div><b>${esc(f.name)}</b><span class="muted small">${fmt(f.kcal)} kcal · ${fmt(f.protein, f.protein % 1 ? 1 : 0)} g · per ${esc(f.serving || 'serving')} · ${esc(f.category || 'Other')}</span></div>${icon('edit')}</button>`).join('')}</div>`
      : '<p class="muted small pad">Add the foods you eat regularly, with calories and protein per serving.</p>'}`;

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('newfood' in b.dataset) foodSheet({});
    if (b.dataset.food) foodSheet(foodsById[b.dataset.food]);
    if ('newmeal' in b.dataset) mealSheet({ name: '', items: [] }, foods);
    if (b.dataset.meal) mealSheet(structuredClone(meals.find(m => m.id === b.dataset.meal)), foods);
  });
}

export function foodSheet(food, onSaved) {
  const isNew = !food.id;
  openSheet(isNew ? 'New food' : 'Edit food', `
    <label class="field"><span>Name</span><input name="name" value="${esc(food.name || '')}" placeholder="e.g. Chicken breast"></label>
    <label class="field"><span>Serving</span><input name="serving" value="${esc(food.serving || '')}" placeholder="e.g. 100 g, 1 scoop, 1 egg"></label>
    <div class="grid2">
      <label class="field"><span>Calories per serving</span><input name="kcal" inputmode="numeric" value="${food.kcal ?? ''}"></label>
      <label class="field"><span>Protein per serving (g)</span><input name="protein" inputmode="decimal" value="${food.protein ?? ''}"></label>
    </div>
    <label class="field"><span>Shopping list group</span><select name="category">${FOOD_CATEGORIES.map(c => `<option ${c === (food.category || 'Other') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="row-btns">
      ${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button>`}
      <button class="btn primary" data-save>Save</button>
    </div>`, (el, close) => {
    if (isNew) el.querySelector('[name=name]').focus();
    el.querySelector('[data-save]').onclick = async () => {
      const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
      if (!v('name')) return toast('Give the food a name');
      if (num(v('kcal')) === null) return toast('Enter calories per serving');
      await put('foods', {
        ...food, id: food.id || uid(), name: v('name'), serving: v('serving') || '1 serving',
        kcal: num(v('kcal')), protein: num(v('protein')) || 0, category: v('category'),
      });
      close(); toast('Food saved');
      onSaved ? onSaved() : window.app.refresh();
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const usedIn = (await all('meals')).filter(m => m.items.some(i => i.foodId === food.id));
      if (!await ask('Delete food?', usedIn.length ? `"${food.name}" is used in ${usedIn.map(m => m.name).join(', ')}. It will be removed from those meals.` : `Delete "${food.name}"? Past log entries are kept.`, 'Delete', true)) return;
      for (const m of usedIn) await put('meals', { ...m, items: m.items.filter(i => i.foodId !== food.id) });
      await del('foods', food.id);
      close(); window.app.refresh();
    });
  });
}

function mealSheet(meal, foods) {
  const isNew = !meal.id;
  const foodsById = byId(foods);
  const options = foods.map(f => `<option value="${f.id}">${esc(f.name)} (${esc(f.serving || 'serving')})</option>`).join('');
  openSheet(isNew ? 'New meal' : 'Edit meal', `
    <label class="field"><span>Meal name</span><input name="name" value="${esc(meal.name)}" placeholder="e.g. Chicken rice bowl"></label>
    <div class="meal-items"></div>
    <div class="add-item">
      <select name="food" aria-label="Food to add">${options}</select>
      <button class="btn" data-additem>${icon('plus')} Add</button>
    </div>
    <div class="meal-total muted"></div>
    <div class="row-btns">
      ${isNew ? '' : `<button class="btn danger" data-del>${icon('trash')} Delete</button>`}
      <button class="btn primary" data-save>Save meal</button>
    </div>`, (el, close) => {
    const list = el.querySelector('.meal-items');
    const draw = () => {
      list.innerHTML = meal.items.map((it, i) => {
        const f = foodsById[it.foodId];
        return `<div class="meal-item" data-i="${i}">
          <div class="grow"><b>${esc(f?.name || 'Deleted food')}</b><span class="muted small">${esc(f?.serving || '')}</span></div>
          <div class="stepper small"><button type="button" data-step="-0.5">−</button><input inputmode="decimal" value="${it.servings}" aria-label="Servings"><button type="button" data-step="0.5">+</button></div>
          <button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon('x')}</button></div>`;
      }).join('') || '<p class="muted small">No foods yet: pick one below and tap Add.</p>';
      const t = mealTotals(meal, foodsById);
      el.querySelector('.meal-total').textContent = `Total: ${fmt(t.kcal)} kcal · ${fmt(t.protein)} g protein`;
    };
    draw();
    list.addEventListener('input', (e) => {
      const i = +e.target.closest('.meal-item').dataset.i;
      meal.items[i].servings = num(e.target.value) || 0;
      const t = mealTotals(meal, foodsById);
      el.querySelector('.meal-total').textContent = `Total: ${fmt(t.kcal)} kcal · ${fmt(t.protein)} g protein`;
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.step) {
        const i = +b.closest('.meal-item').dataset.i;
        meal.items[i].servings = Math.max(0.5, (meal.items[i].servings || 0) + Number(b.dataset.step));
        draw();
      } else if (b.dataset.rm) { meal.items.splice(+b.dataset.rm, 1); draw(); }
      else if ('additem' in b.dataset) {
        const id = el.querySelector('[name=food]').value;
        const existing = meal.items.find(i => i.foodId === id);
        existing ? existing.servings += 1 : meal.items.push({ foodId: id, servings: 1 });
        draw();
      } else if ('save' in b.dataset) {
        meal.name = el.querySelector('[name=name]').value.trim();
        if (!meal.name) return toast('Give the meal a name');
        if (!meal.items.length) return toast('Add at least one food');
        await put('meals', { ...meal, id: meal.id || uid(), items: meal.items.filter(i => i.servings > 0) });
        close(); toast('Meal saved'); window.app.refresh();
      } else if ('del' in b.dataset) {
        if (!await ask('Delete meal?', `Delete "${meal.name}"? Past log entries are kept.`, 'Delete', true)) return;
        await del('meals', meal.id);
        close(); window.app.refresh();
      }
    });
  });
}

