"""Opens every page and reports JavaScript errors. Needs: pip install playwright, and a local server on :8765."""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/'
PAGES = ['workouts', 'workouts/history', 'workouts/exercises', 'workouts/templates', 'nutrition', 'nutrition/foods',
         'weight', 'load', 'habits', 'prep', 'prep/shopping/2026-10-12', 'settings']

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'console: {m.text}'))
    page.goto(BASE)
    page.wait_for_selector('body.ready')
    for path in PAGES:
        page.evaluate(f"location.hash = '#/{path}'")
        page.wait_for_timeout(300)
        bad = page.locator('.notice.warn:has-text("Something went wrong")').count()
        print(f'{path:28} {"ERROR" if bad else "ok"}  title={page.text_content("#page-title")}')
    print('\n'.join(errors) or 'no JS errors')
    b.close()
