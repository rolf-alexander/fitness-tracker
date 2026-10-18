// Bodyweight: morning weigh-ins, 7-day rolling average, and weekly rate of change for a lean bulk.
import { all, put, del } from '../db.js';
import { getSettings } from '../settings-store.js';
import {
  esc, icon, num, kg, fmt, today, addDays, relDay, fmtDate, parseDate, weekStart,
  openSheet, ask, toast, seg, wireSeg, buzz,
} from '../ui.js';
import { lineChart } from '../chart.js';

// Average of all weigh-ins in the 7 days ending on `date` (needs at least 3 to be meaningful)
export function rollingAvg(byDate, date, minCount = 3) {
  const vals = [];
  for (let i = 0; i < 7; i++) { const w = byDate[addDays(date, -i)]; if (w !== undefined) vals.push(w); }
  return vals.length >= minCount ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function weeklyRate(byDate, date) {
  const now = rollingAvg(byDate, date);
  const before = rollingAvg(byDate, addDays(date, -7));
  if (now === null || before === null) return null;
  return { kgPerWeek: now - before, pctPerWeek: ((now - before) / before) * 100, avg: now };
}

export async function render(el) {
  const [rows, settings] = await Promise.all([all('weights'), getSettings()]);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const byDate = Object.fromEntries(rows.map(r => [r.date, r.kg]));
  const latest = rows[rows.length - 1];
  const todayRow = byDate[today()];
  const rate = latest ? weeklyRate(byDate, latest.date) : null;
  const { gainMinPct: lo, gainMaxPct: hi } = settings;

  let status = '';
  if (rate) {
    const p = rate.pctPerWeek;
    const band = `${lo}–${hi}% per week`;
    const [cls, txt] = p < lo
      ? (p < 0 ? ['bad', `Losing weight. A lean bulk targets ${band}: add ~200–300 kcal/day.`] : ['warn', `Slower than your target of ${band}: consider ~150–200 kcal/day more.`])
      : p > hi ? ['warn', `Faster than your target of ${band}: consider ~150–200 kcal/day less to limit fat gain.`]
      : ['good', `On track for your lean bulk (${band}).`];
    status = `<div class="status ${cls}">${icon(cls === 'good' ? 'check' : 'warn')}<span>${txt}</span></div>`;
  }

  // Weekly summary table (Mon–Sun weeks)
  const weeks = [];
  if (rows.length) {
    for (let ws = weekStart(today()); ws >= weekStart(rows[0].date) && weeks.length < 10; ws = addDays(ws, -7)) {
      const vals = rows.filter(r => r.date >= ws && r.date <= addDays(ws, 6)).map(r => r.kg);
      if (vals.length) weeks.push({ ws, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length });
    }
  }

  el.innerHTML = `
    <div class="card weigh-in">
      <div class="card-title">${icon('scale')} ${todayRow !== undefined ? 'Today’s weight (logged)' : 'Morning weigh-in'}</div>
      <div class="weigh-row">
        <button class="round-btn" data-step="-0.1" aria-label="Minus 0.1 kg">−</button>
        <input class="big-input" name="kg" type="text" inputmode="decimal" value="${todayRow ?? latest?.kg ?? ''}" placeholder="kg" aria-label="Weight in kg">
        <button class="round-btn" data-step="0.1" aria-label="Plus 0.1 kg">+</button>
      </div>
      <label class="field inline"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <button class="btn primary block big" data-save>${todayRow !== undefined ? 'Update' : 'Save'} weight</button>
    </div>
    <div class="tiles">
      <div class="tile"><span>7-day average</span><b>${rate ? kg(Math.round(rate.avg * 10) / 10) : latest ? kg(Math.round((rollingAvg(byDate, latest.date, 1)) * 10) / 10) : '–'} kg</b><small>${latest ? `last: ${kg(latest.kg)} kg, ${relDay(latest.date).toLowerCase()}` : 'no weigh-ins yet'}</small></div>
      <div class="tile"><span>Weekly change</span><b>${rate ? `${rate.kgPerWeek >= 0 ? '+' : ''}${fmt(rate.kgPerWeek, 2)} kg` : '–'}</b><small>${rate ? `${rate.pctPerWeek >= 0 ? '+' : ''}${fmt(rate.pctPerWeek, 2)}% of bodyweight` : 'needs ~2 weeks of data'}</small></div>
    </div>
    ${status}
    <div class="card">
      <div class="card-title-row"><div class="card-title">${icon('chart')} Trend</div>
        ${seg('range', [{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 180, label: '6M' }, { value: 365, label: '1Y' }, { value: 0, label: 'All' }], 90)}</div>
      <div class="chart" id="bw-chart"></div>
      <p class="muted small">Dots are daily weigh-ins; the line is the 7-day average, which smooths out water and food swings. Weekly change compares today’s average with the one 7 days earlier.</p>
    </div>
    ${weeks.length ? `<div class="card"><div class="card-title">Weekly averages</div>
      <table class="table"><thead><tr><th>Week of</th><th>Average</th><th>Change</th></tr></thead><tbody>
      ${weeks.map((w, i) => {
        const prev = weeks[i + 1];
        const d = prev ? w.avg - prev.avg : null;
        return `<tr><td>${fmtDate(w.ws)}</td><td>${fmt(w.avg, 1)} kg <span class="muted small">(${w.n}×)</span></td><td>${d === null ? '–' : `${d >= 0 ? '+' : ''}${fmt(d, 2)}`}</td></tr>`;
      }).join('')}</tbody></table></div>` : ''}
    ${rows.length ? `<h3 class="section">Recent weigh-ins</h3><div class="list">${[...rows].reverse().slice(0, 14).map(r => `
      <button class="list-row" data-edit="${r.date}"><div><b>${kg(r.kg)} kg</b><span class="muted small">${relDay(r.date)}</span></div>${icon('edit')}</button>`).join('')}</div>` : ''}`;

  const drawChart = (days) => {
    const cutoff = days ? addDays(today(), -days) : '0000';
    const inRange = rows.filter(r => r.date >= cutoff);
    const avgPts = inRange.map(r => ({ x: parseDate(r.date).getTime(), y: rollingAvg(byDate, r.date, 1) }));
    lineChart(el.querySelector('#bw-chart'), {
      series: [
        { name: 'Daily', type: 'dots', color: 'var(--muted-series)', points: inRange.map(r => ({ x: parseDate(r.date).getTime(), y: r.kg })) },
        { name: '7-day average', color: 'var(--series-1)', points: avgPts.map(p => ({ ...p, y: Math.round(p.y * 100) / 100 })) },
      ],
      yFormat: v => kg(Math.round(v * 10) / 10),
      tooltip: (x, rws) => `<b>${new Date(x).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b>${rws.map(r => `<div><i style="background:${r.s.color}"></i>${esc(r.s.name)}: ${fmt(r.p.y, r.s.type === 'dots' ? 1 : 2)} kg</div>`).join('')}`,
    });
  };
  drawChart(90);
  wireSeg(el, (n, v) => drawChart(Number(v)));

  const input = el.querySelector('[name=kg]');
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.step) {
      input.value = (Math.round(((num(input.value) || latest?.kg || 70) + Number(b.dataset.step)) * 10) / 10).toFixed(1);
      buzz(5);
    } else if ('save' in b.dataset) {
      const v = num(input.value);
      if (!v || v < 20 || v > 400) return toast('Enter your weight in kg');
      const date = el.querySelector('[name=date]').value || today();
      await put('weights', { date, kg: v });
      buzz(15);
      toast(`Saved ${kg(v)} kg for ${relDay(date).toLowerCase()}`);
      window.app.refresh();
    } else if (b.dataset.edit) {
      editWeight(b.dataset.edit, byDate[b.dataset.edit]);
    }
  });
}

function editWeight(date, value) {
  openSheet(`Weigh-in · ${relDay(date)}`, `
    <label class="field"><span>Weight (kg)</span><input name="kg" inputmode="decimal" value="${value}"></label>
    <div class="row-btns">
      <button class="btn danger" data-del>${icon('trash')} Delete</button>
      <button class="btn primary" data-save>Save</button>
    </div>`, (el, close) => {
    el.querySelector('[data-save]').onclick = async () => {
      const v = num(el.querySelector('[name=kg]').value);
      if (!v) return toast('Enter a weight');
      await put('weights', { date, kg: v });
      close(); window.app.refresh();
    };
    el.querySelector('[data-del]').onclick = async () => {
      if (!await ask('Delete weigh-in?', `Delete ${kg(value)} kg on ${fmtDate(date)}?`, 'Delete', true)) return;
      await del('weights', date);
      close(); window.app.refresh();
    };
  });
}
