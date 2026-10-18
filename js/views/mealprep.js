// Meal prep: plan the week from saved meals/foods, then generate a grouped shopping list.
import { all, get, put, del, getKV, setKV } from '../db.js';
import { FOOD_CATEGORIES } from '../settings-store.js';
import {
  esc, icon, num, fmt, today, addDays, weekStart, weekLabel, fmtDate, openSheet, ask, toast, subHeader,
} from '../ui.js';
import { mealTotals } from './nutrition.js';

const byId = (rows) => Object.fromEntries(rows.map(r => [r.id, r]));

export async function render(el, params) {
  const [page, arg] = params;
  if (page === 'shopping') return renderShopping(el, weekStart(arg || today()));
  const start = page && /^\d{4}-\d{2}-\d{2}$/.test(page) ? weekStart(page) : weekStart(today());
  return renderPlan(el, start);
}

async function weekPlan(start) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const plans = await Promise.all(days.map(d => get('mealplan', d)));
  return days.map((d, i) => ({ date: d, items: plans[i]?.items || [] }));
}

async function renderPlan(el, start) {
  const [foods, meals, plan] = await Promise.all([all('foods'), all('meals'), weekPlan(start)]);
  const foodsById = byId(foods), mealsById = byId(meals);
  const itemInfo = (it) => {
    if (it.type === 'meal') {
      const m = mealsById[it.id];
      return m ? { name: m.name, ...mealTotals(m, foodsById) } : null;
    }
    const f = foodsById[it.id];
    return f ? { name: f.name, kcal: f.kcal, protein: f.protein } : null;
  };
  const totalItems = plan.reduce((n, d) => n + d.items.length, 0);

  el.innerHTML = `
    <div class="week-nav">
      <a class="icon-btn" href="#/prep/${addDays(start, -7)}" aria-label="Previous week">${icon('left')}</a>
      <div><b>${weekLabel(start)}</b>${start === weekStart(today()) ? '<span class="muted small"> · this week</span>' : ''}</div>
      <a class="icon-btn" href="#/prep/${addDays(start, 7)}" aria-label="Next week">${icon('right')}</a>
    </div>
    <a class="btn primary block big ${totalItems ? '' : 'disabled'}" href="#/prep/shopping/${start}">${icon('cart')} Shopping list</a>
    <div class="row-btns">
      <button class="btn" data-copy>Copy last week</button>
      <button class="btn ghost" data-clear ${totalItems ? '' : 'disabled'}>Clear week</button>
    </div>
    ${!meals.length && !foods.length ? `<div class="notice info">${icon('food')}<div>Save some foods and meals in <a class="link" href="#/nutrition/foods">Nutrition → Manage foods &amp; meals</a> first, then plan them here.</div></div>` : ''}
    ${plan.map(day => {
      const infos = day.items.map(it => ({ it, info: itemInfo(it) })).filter(x => x.info);
      const k = infos.reduce((s, x) => s + x.info.kcal * (x.it.portions || 1), 0);
      const p = infos.reduce((s, x) => s + x.info.protein * (x.it.portions || 1), 0);
      return `<div class="card plan-day ${day.date === today() ? 'is-today' : ''}">
        <div class="plan-day-head"><b>${fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'short' })}</b>
          <span class="muted small">${infos.length ? `${fmt(k)} kcal · ${fmt(p)} g` : ''}</span></div>
        <div class="plan-items">
          ${infos.map(({ it, info }) => `<button class="chip ${it.type}" data-item="${day.date}:${day.items.indexOf(it)}">${esc(info.name)}${(it.portions || 1) !== 1 ? ` ×${it.portions}` : ''}</button>`).join('')}
          <button class="chip add" data-add="${day.date}" ${meals.length || foods.length ? '' : 'disabled'}>${icon('plus')} Add</button>
        </div>
      </div>`;
    }).join('')}`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add) return pickItem(b.dataset.add, meals, foods, foodsById);
    if (b.dataset.item) {
      const [date, i] = b.dataset.item.split(':');
      return editItem(date, +i, itemInfo(plan.find(d => d.date === date).items[+i]).name);
    }
    if ('copy' in b.dataset) {
      const last = await weekPlan(addDays(start, -7));
      if (!last.some(d => d.items.length)) return toast('Nothing planned last week');
      if (totalItems && !await ask('Replace this week?', 'Copying last week replaces what is planned this week.', 'Copy', true)) return;
      for (let i = 0; i < 7; i++) {
        const date = addDays(start, i);
        last[i].items.length ? await put('mealplan', { date, items: last[i].items }) : await del('mealplan', date);
      }
      toast('Copied last week'); window.app.refresh();
    }
    if ('clear' in b.dataset) {
      if (!await ask('Clear week?', 'Remove every planned meal this week?', 'Clear', true)) return;
      for (let i = 0; i < 7; i++) await del('mealplan', addDays(start, i));
      window.app.refresh();
    }
  });
}

function pickItem(date, meals, foods, foodsById) {
  const sorted = (a, b) => a.name.localeCompare(b.name);
  openSheet(`Add to ${fmtDate(date, { weekday: 'long' })}`, `
    ${meals.length ? `<h3 class="section">Meals</h3><div class="food-grid">${[...meals].sort(sorted).map(m => {
      const t = mealTotals(m, foodsById);
      return `<button class="food-btn meal" data-pick="meal:${m.id}"><b>${esc(m.name)}</b><span>${fmt(t.kcal)} kcal · ${fmt(t.protein)} g</span></button>`;
    }).join('')}</div>` : ''}
    ${foods.length ? `<h3 class="section">Foods</h3><div class="food-grid">${[...foods].sort(sorted).map(f =>
      `<button class="food-btn" data-pick="food:${f.id}"><b>${esc(f.name)}</b><span>${fmt(f.kcal)} kcal · ${esc(f.serving || '')}</span></button>`).join('')}</div>` : ''}`,
  (el, close) => {
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const [type, id] = b.dataset.pick.split(':');
      const rec = (await get('mealplan', date)) || { date, items: [] };
      rec.items.push({ type, id, portions: 1 });
      await put('mealplan', rec);
      close(); window.app.refresh();
    });
  });
}

function editItem(date, index, name) {
  get('mealplan', date).then(rec => {
    const it = rec.items[index];
    openSheet(name, `
      <div class="field"><span>Portions</span>
        <div class="stepper"><button type="button" data-step="-0.5">−</button><input name="portions" inputmode="decimal" value="${it.portions || 1}"><button type="button" data-step="0.5">+</button></div>
      </div>
      <div class="row-btns">
        <button class="btn danger" data-rm>${icon('trash')} Remove</button>
        <button class="btn primary" data-save>Save</button>
      </div>`, (el, close) => {
      const input = el.querySelector('[name=portions]');
      el.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { input.value = Math.max(0.5, (num(input.value) || 1) + Number(b.dataset.step)); });
      el.querySelector('[data-save]').onclick = async () => {
        it.portions = num(input.value) || 1;
        await put('mealplan', rec); close(); window.app.refresh();
      };
      el.querySelector('[data-rm]').onclick = async () => {
        rec.items.splice(index, 1);
        rec.items.length ? await put('mealplan', rec) : await del('mealplan', date);
        close(); window.app.refresh();
      };
    });
  });
}

// "100 g" x 3 -> "300 g"; "1 scoop" x 3 -> "3 × 1 scoop"
export function quantityText(serving, servings) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i.exec(serving || '');
  const n = Math.round(servings * 100) / 100;
  if (m) {
    let total = num(m[1]) * servings, unit = m[2].toLowerCase();
    if (unit === 'g' && total >= 1000) { total /= 1000; unit = 'kg'; }
    if (unit === 'ml' && total >= 1000) { total /= 1000; unit = 'l'; }
    return `${Math.round(total * 100) / 100} ${unit}`;
  }
  return `${n} × ${serving || 'serving'}`;
}

export async function shoppingList(start) {
  const [foods, meals, plan] = await Promise.all([all('foods'), all('meals'), weekPlan(start)]);
  const foodsById = byId(foods), mealsById = byId(meals);
  const totals = {};
  const addFood = (id, servings) => { if (foodsById[id]) totals[id] = (totals[id] || 0) + servings; };
  for (const day of plan) {
    for (const it of day.items) {
      const portions = it.portions || 1;
      if (it.type === 'food') addFood(it.id, portions);
      else mealsById[it.id]?.items.forEach(mi => addFood(mi.foodId, mi.servings * portions));
    }
  }
  const groups = {};
  for (const [id, servings] of Object.entries(totals)) {
    const f = foodsById[id];
    (groups[f.category || 'Other'] ||= []).push({ id, name: f.name, qty: quantityText(f.serving, servings) });
  }
  return FOOD_CATEGORIES.filter(c => groups[c]).map(c => ({ category: c, items: groups[c].sort((a, b) => a.name.localeCompare(b.name)) }))
    .concat(Object.keys(groups).filter(c => !FOOD_CATEGORIES.includes(c)).map(c => ({ category: c, items: groups[c] })));
}

async function renderShopping(el, start) {
  const groups = await shoppingList(start);
  const key = `shop:${start}`;
  const checked = await getKV(key, {});
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const got = groups.reduce((n, g) => n + g.items.filter(i => checked[i.id]).length, 0);
  el.innerHTML = `${subHeader('Shopping list', `#/prep/${start}`, `<button class="icon-btn" data-share aria-label="Share list">${icon('share')}</button>`)}
    <p class="muted small pad">${weekLabel(start)} · ${got}/${count} in the basket</p>
    ${groups.length ? groups.map(g => `
      <h3 class="section">${esc(g.category)}</h3>
      <div class="list">${g.items.map(i => `
        <button class="list-row shop ${checked[i.id] ? 'got' : ''}" data-id="${i.id}" aria-pressed="${!!checked[i.id]}">
          <span class="habit-check">${icon('check')}</span><div class="grow"><b>${esc(i.name)}</b></div><span class="qty">${esc(i.qty)}</span>
        </button>`).join('')}</div>`).join('') + (got ? '<button class="btn ghost block" data-reset>Untick everything</button>' : '')
      : '<p class="empty">Nothing planned this week yet.</p>'}`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.id) {
      checked[b.dataset.id] = !checked[b.dataset.id];
      await setKV(key, checked);
      window.app.refresh();
    } else if ('reset' in b.dataset) {
      await setKV(key, {}); window.app.refresh();
    } else if ('share' in b.dataset) {
      const text = `Shopping list (${weekLabel(start)})\n\n` + groups.map(g => `${g.category}\n${g.items.map(i => `- ${i.name}: ${i.qty}`).join('\n')}`).join('\n\n');
      try {
        if (navigator.share) await navigator.share({ title: 'Shopping list', text });
        else { await navigator.clipboard.writeText(text); toast('List copied'); }
      } catch (err) { if (err.name !== 'AbortError') toast('Could not share the list'); }
    }
  });
}
