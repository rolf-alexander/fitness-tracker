// Settings: theme, targets, backups (export/import), storage and app updates.
import { getSettings, saveSettings, proteinTarget } from '../settings-store.js';
import { exportJSON, importJSON, exportCSV, importCSV, CSV_TABLES, markBackedUp } from '../backup.js';
import { replaceAll, STORES } from '../db.js';
import { esc, icon, num, today, daysBetween, isoDate, seg, wireSeg, toast, ask, subHeader, saveFile, applyTheme } from '../ui.js';
import { APP_VERSION } from '../settings-store.js';

export async function render(el) {
  const s = await getSettings();
  const prot = await proteinTarget(s);
  const lastBackup = s.lastBackup ? daysBetween(isoDate(new Date(s.lastBackup)), today()) : null;
  const persisted = await navigator.storage?.persisted?.();

  el.innerHTML = `${subHeader('Settings', '#/workouts')}
    <div class="card">
      <div class="card-title">Appearance</div>
      ${seg('theme', [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], s.theme)}
    </div>

    <div class="card">
      <div class="card-title">Nutrition targets</div>
      <label class="field"><span>Daily calories (kcal)</span><input name="kcalTarget" inputmode="numeric" value="${s.kcalTarget}"></label>
      <div class="field"><span>Protein target</span>${seg('proteinMode', [{ value: 'auto', label: 'From bodyweight' }, { value: 'fixed', label: 'Fixed amount' }], s.proteinMode)}</div>
      <label class="field" data-show="auto"><span>Grams of protein per kg of bodyweight</span><input name="proteinPerKg" inputmode="decimal" value="${s.proteinPerKg}"></label>
      <label class="field" data-show="fixed"><span>Protein per day (g)</span><input name="proteinFixed" inputmode="numeric" value="${s.proteinFixed}"></label>
      <p class="muted small">Current protein target: <b>${prot} g</b>${s.proteinMode === 'auto' ? ' (from your 7 most recent weigh-ins; 160 g until you log one)' : ''}.</p>
    </div>

    <div class="card">
      <div class="card-title">Lean bulk target</div>
      <div class="grid2">
        <label class="field"><span>Min gain (% / week)</span><input name="gainMinPct" inputmode="decimal" value="${s.gainMinPct}"></label>
        <label class="field"><span>Max gain (% / week)</span><input name="gainMaxPct" inputmode="decimal" value="${s.gainMaxPct}"></label>
      </div>
      <p class="muted small">0.25–0.5% of bodyweight per week is a common lean-bulk range.</p>
    </div>

    <div class="card">
      <div class="card-title">Workouts</div>
      <label class="field"><span>Default rest timer (seconds)</span><input name="defaultRest" inputmode="numeric" value="${s.defaultRest}"></label>
    </div>

    <button class="btn primary block" data-save-settings>Save settings</button>

    <div class="card">
      <div class="card-title">${icon('share')} Backup</div>
      <p class="${lastBackup === null || lastBackup > 14 ? 'notice-text warn' : 'muted small'}">${lastBackup === null ? 'You have never made a backup.' : `Last full backup: ${lastBackup === 0 ? 'today' : lastBackup + ' days ago'}.`}
        Your data only lives on this phone, so back up every week or two (e.g. save to iCloud Drive in Files).</p>
      <button class="btn primary block" data-export-json>Back up everything (JSON)</button>
      <button class="btn block" data-import-json>Restore from JSON backup…</button>
      <details class="details">
        <summary>CSV export &amp; import (spreadsheets)</summary>
        <p class="muted small">CSV files open in Excel, Numbers or Google Sheets. Importing a CSV <b>adds</b> its rows (it does not replace data), so only import each file once.</p>
        <div class="btn-list">${Object.entries(CSV_TABLES).map(([k, t]) => `<button class="btn small" data-export-csv="${k}">${esc(t.label)}</button>`).join('')}</div>
        <button class="btn block" data-import-csv>Import a CSV file…</button>
      </details>
      <input type="file" id="file-json" accept=".json,application/json" hidden>
      <input type="file" id="file-csv" accept=".csv,text/csv" hidden>
    </div>

    <div class="card">
      <div class="card-title">Storage &amp; app</div>
      <p class="muted small">Storage: ${persisted ? 'protected (the browser won’t clear it to free space)' : 'standard. Installing to the Home Screen gives the app its own protected storage.'}</p>
      <p class="muted small">Version ${APP_VERSION}</p>
      <button class="btn block" data-update>Check for updates</button>
      <button class="btn danger block" data-erase>${icon('trash')} Erase all data</button>
    </div>`;

  const showProt = (mode) => el.querySelectorAll('[data-show]').forEach(x => { x.style.display = x.dataset.show === mode ? '' : 'none'; });
  showProt(s.proteinMode);
  wireSeg(el, async (name, value) => {
    if (name === 'theme') { await saveSettings({ theme: value }); applyTheme(value); }
    if (name === 'proteinMode') showProt(value);
  });

  const fileJson = el.querySelector('#file-json'), fileCsv = el.querySelector('#file-csv');
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('saveSettings' in d) {
      const v = (n) => num(el.querySelector(`[name=${n}]`).value);
      const patch = {
        kcalTarget: v('kcalTarget') || s.kcalTarget,
        proteinMode: el.querySelector('.seg[data-seg=proteinMode] .on').dataset.value,
        proteinPerKg: v('proteinPerKg') || s.proteinPerKg,
        proteinFixed: v('proteinFixed') || s.proteinFixed,
        gainMinPct: v('gainMinPct') ?? s.gainMinPct,
        gainMaxPct: v('gainMaxPct') ?? s.gainMaxPct,
        defaultRest: v('defaultRest') || s.defaultRest,
      };
      await saveSettings(patch);
      toast('Settings saved');
      window.app.refresh();
    } else if ('exportJson' in d) {
      const ok = await saveFile(`fitness-backup-${today()}.json`, await exportJSON(), 'application/json');
      if (ok) { await markBackedUp(); toast('Backup created'); window.app.refresh(); }
    } else if ('importJson' in d) {
      fileJson.click();
    } else if (d.exportCsv) {
      const { filename, text } = await exportCSV(d.exportCsv);
      await saveFile(filename, text, 'text/csv');
    } else if ('importCsv' in d) {
      fileCsv.click();
    } else if ('update' in d) {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) return toast('Updates are handled automatically');
      await reg.update();
      toast(reg.installing || reg.waiting ? 'Update found, see the banner' : 'You have the latest version');
    } else if ('erase' in d) {
      if (!await ask('Erase everything?', 'This permanently deletes all your workouts, food logs, weights, habits and settings on this device. Make a backup first!', 'Erase all', true)) return;
      if (!await ask('Are you sure?', 'This cannot be undone.', 'Yes, erase', true)) return;
      await replaceAll(Object.fromEntries(Object.keys(STORES).map(k => [k, []])));
      localStorage.clear();
      location.hash = '#/workouts';
      location.reload();
    }
  });

  fileJson.addEventListener('change', async () => {
    const f = fileJson.files[0];
    fileJson.value = '';
    if (!f) return;
    if (!await ask('Restore backup?', `This REPLACES all data on this device with the contents of "${f.name}".`, 'Restore', true)) return;
    try {
      const counts = await importJSON(await f.text());
      toast(`Restored: ${counts.sessions} workouts, ${counts.foodlog} food entries, ${counts.weights} weigh-ins`, { duration: 6000 });
      applyTheme((await getSettings()).theme);
      window.app.refresh();
    } catch (err) { toast(err.message, { duration: 6000 }); }
  });
  fileCsv.addEventListener('change', async () => {
    const f = fileCsv.files[0];
    fileCsv.value = '';
    if (!f) return;
    try { toast(await importCSV(await f.text()), { duration: 5000 }); } catch (err) { toast(err.message, { duration: 6000 }); }
  });
}
