"""End-to-end test of every feature, data persistence across restarts, and offline use.

Needs:  pip install playwright   (uses your installed Microsoft Edge)
Run a local server first:  python -m http.server 8765
Then:   python tests/e2e.py [base-url] [screenshot-dir]
"""
import json, os, re, shutil, sys, tempfile, datetime as dt
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(tempfile.gettempdir(), 'fitness-shots')
os.makedirs(SHOTS, exist_ok=True)
PROFILE = tempfile.mkdtemp(prefix='fitness-profile-')
TODAY = dt.date.today()
iso = lambda d: d.isoformat()
results = []


def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  -> ' + str(detail) if detail and not cond else ''}")


def launch(p, offline=False):
    ctx = p.chromium.launch_persistent_context(
        PROFILE, channel='msedge', headless=True, viewport={'width': 390, 'height': 844},
        has_touch=True, is_mobile=True, device_scale_factor=2, offline=offline, accept_downloads=True)
    # Force the "download" path for files (desktop Edge's share sheet can't be automated)
    ctx.add_init_script("try { Object.defineProperty(navigator, 'canShare', { value: undefined }); } catch (e) {}")
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    return ctx, page


def go(page, hash_):
    page.evaluate(f"location.hash = '{hash_}'")
    page.wait_for_timeout(250)


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, f'{name}.png'), full_page=True)


def db_put(page, store, rows):
    page.evaluate("""async ([store, rows]) => { const db = await import('./js/db.js'); await db.putMany(store, rows); }""", [store, rows])


with sync_playwright() as p:
    ctx, page = launch(p)
    page.goto(BASE)
    page.wait_for_selector('body.ready')

    # ---------------- Workouts ----------------
    check('starter templates: next up is Upper A', page.locator('.next-up h2').text_content() == 'Upper A')
    page.click('text=Start Upper A')
    page.wait_for_selector('.ex')
    check('session has 6 exercises', page.locator('.card.ex').count() == 6)
    check('first-time suggestion shown', 'First time' in page.locator('.ex').first.locator('.suggest').text_content())

    bench = page.locator('.card.ex').first
    bench.locator('.set-row[data-set="0"] .w').fill('80')
    check('weight change copies to later sets', bench.locator('.set-row[data-set="2"] .w').input_value() == '80')
    for i in range(3):
        bench.locator(f'.set-row[data-set="{i}"] .r').fill('8')
        bench.locator(f'.set-row[data-set="{i}"] .tick').click()
    check('ticked sets marked done', bench.locator('.set-row.done').count() == 3)
    check('rest timer started', page.locator('#timer-bar.show').count() == 1)
    t1 = page.locator('.timer-time').text_content()
    page.locator('#timer-bar button[data-t="15"]').click()
    check('rest timer +15s works', page.locator('.timer-time').text_content() != t1, t1)
    rpe = bench.locator('.set-row[data-set="2"] .rpe')
    rpe.select_option('8')

    row = page.locator('.card.ex').nth(1)
    row.locator('.set-row[data-set="0"] .w').fill('70')
    for i in range(3):
        row.locator(f'.set-row[data-set="{i}"] .r').fill('7')
        row.locator(f'.set-row[data-set="{i}"] .tick').click()
    page.wait_for_timeout(400)

    # Simulate closing the app mid-workout: reload and check the session + timer are still there
    page.reload(); page.wait_for_selector('body.ready')
    go(page, '#/workouts')
    check('in-progress session survives reload', page.locator('text=Session in progress').count() == 1)
    check('rest timer survives reload', page.locator('#timer-bar.show').count() == 1)
    page.click('a:has-text("Resume")')
    page.wait_for_selector('.ex')
    check('logged sets kept after reload', page.locator('.card.ex').first.locator('.set-row.done').count() == 3)
    shot(page, '01-workout-session')
    page.locator('[data-finish]').first.click()
    page.wait_for_selector('.sheet [data-save]')
    page.locator('.sheet .seg[data-seg="intensity"] button[data-value="hard"]').click()
    page.click('.sheet [data-save]')
    page.wait_for_selector('.next-up')
    check('after finishing, next up rotates to Lower A', page.locator('.next-up h2').text_content() == 'Lower A')

    # Progression: bench hit 8/8/8 at top of 6-8 -> +2.5 kg ; row 7/7/7 at 6-8 -> stay
    page.click('.list-row:has-text("Upper A")')
    page.wait_for_selector('.ex')
    b = page.locator('.card.ex').first
    check('progression: suggests +2.5 kg', 'Add 2.5 kg → 82.5 kg' in b.locator('.suggest').text_content(), b.locator('.suggest').text_content())
    check('progression: pre-filled 82.5 kg', b.locator('.set-row[data-set="0"] .w').input_value() == '82.5')
    check('progression: reps pre-filled at bottom of range', b.locator('.set-row[data-set="0"] .r').input_value() == '6')
    r = page.locator('.card.ex').nth(1)
    check('hold: row stays at 70 kg', 'Stay at 70 kg' in r.locator('.suggest').text_content())
    check('hold: reps pre-filled from last time', r.locator('.set-row[data-set="0"] .r').input_value() == '7')
    check('shows last performance', '80×8, 80×8, 80×8' in b.locator('.last').text_content())
    page.click('[data-discard]')
    page.click('.sheet [data-yes]')
    page.wait_for_selector('.next-up')

    # PR + history: add an older, lighter bench session so the chart has 2 points and the PR logic is exercised
    db_put(page, 'sessions', [{
        'id': 'old1', 'date': iso(TODAY - dt.timedelta(days=10)), 'templateId': None, 'name': 'Upper A', 'kind': 'upper',
        'intensity': 'moderate', 'finishedAt': 1, 'notes': '',
        'exercises': [{'name': 'Bench press', 'repMin': 6, 'repMax': 8, 'sets': [{'w': 77.5, 'r': 8, 'done': True}] * 3}]}])
    go(page, '#/workouts/exercise/Bench%20press')
    page.wait_for_selector('.tile')
    tiles = page.locator('.tile').all_text_contents()
    check('PR tile: best e1RM ≈ 101.3 kg', any('101.3' in t for t in tiles), tiles)
    check('progress chart drawn', page.locator('#ex-chart svg path').count() >= 2)
    shot(page, '02-exercise-prs')
    go(page, '#/workouts/history')
    check('history lists 2 sessions', page.locator('.list-row').count() == 2)

    # Template editing
    go(page, '#/workouts/templates')
    page.click('a:has-text("Upper A")')
    page.wait_for_selector('[name=tname]')
    page.fill('[name=tname]', 'Upper A1')
    page.click('[data-addex]')
    page.locator('.ex-edit').last.locator('[name=name]').fill('Cable fly')
    page.click('[data-save]')
    page.wait_for_timeout(300)
    check('template renamed and exercise added', page.locator('a:has-text("Upper A1")').count() == 1 and '7 exercises' in page.locator('.list-row', has_text='Upper A1').text_content())

    # ---------------- Nutrition ----------------
    go(page, '#/nutrition/foods')
    for name, serving, kcal, prot, cat in [('Chicken breast', '100 g', '165', '31', 'Meat & fish'), ('Rice', '100 g', '130', '2.7', 'Bakery & grains')]:
        page.click('[data-newfood]')
        page.fill('.sheet [name=name]', name); page.fill('.sheet [name=serving]', serving)
        page.fill('.sheet [name=kcal]', kcal); page.fill('.sheet [name=protein]', prot)
        page.select_option('.sheet [name=category]', cat)
        page.click('.sheet [data-save]'); page.wait_for_timeout(300)
    page.click('[data-newmeal]')
    page.fill('.sheet [name=name]', 'Chicken rice')
    page.select_option('.sheet [name=food]', label='Chicken breast (100 g)'); page.click('.sheet [data-additem]'); page.click('.sheet [data-additem]')
    page.select_option('.sheet [name=food]', label='Rice (100 g)'); page.click('.sheet [data-additem]')
    page.locator('.sheet .meal-item').nth(1).locator('[data-step="0.5"]').click()
    check('meal total computed', '525 kcal' in page.locator('.sheet .meal-total').text_content(), page.locator('.sheet .meal-total').text_content())
    page.click('.sheet [data-save]'); page.wait_for_timeout(300)

    go(page, '#/nutrition')
    page.click('.food-btn.meal:has-text("Chicken rice")'); page.wait_for_timeout(300)
    page.click('[data-quick]')
    page.fill('.sheet [name=kcal]', '500'); page.fill('.sheet [name=protein]', '30')
    page.click('.sheet [data-add]'); page.wait_for_timeout(400)
    meter = page.locator('.meter').first.text_content()
    check('calories total = 1,025 / 2,950', '1,025' in meter and '2,950' in meter, meter)
    check('protein total = 96 g', '96' in page.locator('.meter').nth(1).text_content(), page.locator('.meter').nth(1).text_content())
    page.click('.food-btn:has-text("Rice")'); page.wait_for_timeout(300)
    page.click('.toast-undo'); page.wait_for_timeout(300)
    check('undo removes the last logged food', page.locator('.list-row[data-entry]').count() == 2)
    check('weekly average card', '1,025' in page.locator('.stat-row.two').text_content())
    shot(page, '03-nutrition')

    # ---------------- Bodyweight ----------------
    weights = [{'date': iso(TODAY - dt.timedelta(days=i)), 'kg': round(80 + (20 - i) * 0.05 + (0.3 if i % 3 == 0 else -0.1), 2)} for i in range(1, 21)]
    db_put(page, 'weights', weights)
    go(page, '#/weight')
    page.fill('[name=kg]', '81.2')
    page.click('[data-save]'); page.wait_for_timeout(400)
    tiles = page.locator('.tile').all_text_contents()
    check('7-day average shown', re.search(r'8\d\.\d', tiles[0]) is not None, tiles)
    check('weekly change shown (kg and %)', '%' in tiles[1] and 'kg' in tiles[1], tiles)
    check('lean-bulk status shown', page.locator('.status').count() == 1, '')
    check('chart has dots + average line', page.locator('#bw-chart circle').count() >= 20 and page.locator('#bw-chart path').count() >= 1)
    go(page, '#/settings')
    m = re.search(r'Current protein target: (\d+) g', page.locator('.view').text_content())
    check('protein target now from bodyweight (2 g/kg of ~81 kg)', m and 158 <= int(m.group(1)) <= 166, m and m.group(1))
    go(page, '#/weight')
    shot(page, '04-bodyweight')

    # ---------------- Training load ----------------
    go(page, '#/load')
    page.click('[data-new="bouldering"]')
    page.click('.sheet [data-dur="120"]')
    page.click('.sheet .seg button[data-value="hard"]')
    page.fill('.sheet [name=notes]', 'Projecting')
    page.click('.sheet [data-save]'); page.wait_for_timeout(400)
    check('bouldering chip shows on calendar', page.locator('.chip.climb').count() == 1)
    warn_text = ' '.join(page.locator('.notice.warn').all_text_contents())
    check('warns: hard upper + climbing same day', 'same day' in warn_text, warn_text)
    # climbing yesterday too -> back-to-back
    db_put(page, 'activities', [{'id': 'b2', 'date': iso(TODAY - dt.timedelta(days=1)), 'type': 'bouldering', 'duration': 90, 'intensity': 'moderate', 'notes': ''}])
    page.evaluate('app.refresh()'); page.wait_for_timeout(400)
    warn_text = ' '.join(page.locator('.notice.warn').all_text_contents())
    check('warns: back-to-back pulling', 'Back-to-back' in warn_text, warn_text)
    shot(page, '05-training-load')
    y = page.evaluate("async () => (await import('./js/views/load.js')).pullingYesterday()")
    check('workouts tab knows you climbed yesterday', y and 'Bouldering' in y, y)

    # ---------------- Habits ----------------
    go(page, '#/habits')
    check('default habits', page.locator('.habit').count() == 4 and 'CS50' in page.locator('.habit-list').text_content())
    db_put(page, 'habitlog', [{'date': iso(TODAY - dt.timedelta(days=i)), 'done': {'creatine': True}} for i in range(1, 4)])
    page.evaluate('app.refresh()'); page.wait_for_timeout(300)
    page.click('.habit:has-text("Creatine")'); page.wait_for_timeout(300)
    check('habit ticked', page.locator('.habit.done').count() == 1)
    check('streak = 4 days', page.locator('.habit:has-text("Creatine") .streak').text_content().strip() == '4')
    check('protein hint on "Hit protein"', 'g so far' in page.locator('.habit:has-text("Hit protein")').text_content())
    check('monthly calendar rendered', page.locator('.cal-cell:not(.empty)').count() >= 28)
    page.click('[data-edit]')
    page.click('.sheet [data-add]')
    page.locator('.sheet .habit-edit-row').last.locator('input').fill('Stretch')
    page.click('.sheet [data-save]'); page.wait_for_timeout(300)
    check('habit added', page.locator('.habit').count() == 5)
    shot(page, '06-habits')

    # ---------------- Meal prep ----------------
    go(page, '#/prep')
    page.locator('[data-add]').first.click()
    page.click('.sheet [data-pick^="meal:"]'); page.wait_for_timeout(300)
    page.locator('[data-add]').nth(1).click()
    page.click('.sheet [data-pick^="meal:"]'); page.wait_for_timeout(300)
    check('meals planned on two days', page.locator('.plan-items .chip.meal').count() == 2)
    page.click('a:has-text("Shopping list")'); page.wait_for_timeout(300)
    txt = page.locator('.view').text_content()
    check('shopping list groups by type', 'Meat & fish' in txt and 'Bakery & grains' in txt, txt[:200])
    check('quantities summed (2 meals × 200 g chicken = 400 g; rice 300 g)', '400 g' in txt and '300 g' in txt, txt)
    page.locator('.list-row.shop').first.click(); page.wait_for_timeout(300)
    check('item ticks off', page.locator('.list-row.shop.got').count() == 1)
    shot(page, '07-shopping')

    # ---------------- Settings, export ----------------
    go(page, '#/settings')
    page.fill('[name=kcalTarget]', '3000')
    page.click('[data-save-settings]'); page.wait_for_timeout(300)
    go(page, '#/nutrition')
    check('calorie target editable', '3,000' in page.locator('.meter').first.text_content())
    go(page, '#/settings')
    with page.expect_download() as dl:
        page.click('[data-export-json]')
    backup_path = os.path.join(SHOTS, 'backup.json')
    dl.value.save_as(backup_path)
    data = json.load(open(backup_path, encoding='utf-8'))
    check('JSON backup contains all data', len(data['data']['sessions']) == 2 and len(data['data']['weights']) == 21 and len(data['data']['foods']) == 2)
    page.click('summary')
    with page.expect_download() as dl:
        page.click('[data-export-csv="workout_sets"]')
    csv_path = os.path.join(SHOTS, 'sets.csv'); dl.value.save_as(csv_path)
    csv = open(csv_path, encoding='utf-8').read()
    check('CSV export of workout sets', csv.startswith('date,session') and 'Bench press,1,80,8' in csv, csv[:200])
    with page.expect_download() as dl:
        page.click('[data-export-csv="bodyweight"]')
    bw_csv = os.path.join(SHOTS, 'bodyweight.csv'); dl.value.save_as(bw_csv)

    # ---------------- Erase, then restore from backup ----------------
    page.click('[data-erase]'); page.click('.sheet [data-yes]'); page.wait_for_timeout(300)
    page.locator('.sheet [data-yes]').last.click()
    page.wait_for_selector('body.ready'); page.wait_for_timeout(500)
    go(page, '#/weight')
    check('erase wiped data', page.locator('.list-row[data-edit]').count() == 0)
    go(page, '#/settings')
    page.set_input_files('#file-json', backup_path)
    page.click('.sheet [data-yes]'); page.wait_for_timeout(800)
    go(page, '#/weight')
    check('restore from JSON brings data back', page.locator('.list-row[data-edit]').count() == 14)
    # CSV import adds rows: delete weights, import bodyweight CSV
    page.evaluate("""async () => { const db = await import('./js/db.js'); for (const w of await db.all('weights')) await db.del('weights', w.date); }""")
    go(page, '#/settings'); page.click('summary')
    page.set_input_files('#file-csv', bw_csv); page.wait_for_timeout(600)
    check('CSV import recognised', 'Bodyweight: added 21' in page.locator('#toast').text_content(), page.locator('#toast').text_content())

    # ---------------- Offline + persistence across a full restart ----------------
    page.evaluate('navigator.serviceWorker.ready')
    page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=10000)
    check('no JS errors so far', not page.errors, page.errors)
    ctx.close()  # "close the app" completely

    ctx, page = launch(p, offline=True)  # reopen with NO network at all
    page.goto(BASE)
    page.wait_for_selector('body.ready', timeout=10000)
    check('app opens fully offline', page.locator('.next-up').count() == 1)
    go(page, '#/weight')
    check('data survives closing the app (weights)', page.locator('.list-row[data-edit]').count() == 14)
    go(page, '#/workouts/history')
    check('data survives closing the app (workouts)', page.locator('.list-row').count() == 2)
    go(page, '#/nutrition')
    page.click('.food-btn.meal:has-text("Chicken rice")'); page.wait_for_timeout(300)
    check('logging works offline', page.locator('.list-row[data-entry]').count() == 3)
    for tab in ['load', 'habits', 'prep', 'settings']:
        go(page, f'#/{tab}')
        check(f'{tab} tab works offline', page.locator('.notice.warn:has-text("Something went wrong")').count() == 0 and page.locator('.view').text_content().strip() != '')
    check('no JS errors offline', not page.errors, page.errors)

    # Screenshots in dark mode
    page.emulate_media(color_scheme='dark')
    for tab in ['workouts', 'nutrition', 'weight', 'habits']:
        go(page, f'#/{tab}'); page.wait_for_timeout(200); shot(page, f'dark-{tab}')
    ctx.close()

shutil.rmtree(PROFILE, ignore_errors=True)
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed. Screenshots: {SHOTS}')
sys.exit(1 if failed else 0)
