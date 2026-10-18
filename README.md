# Fitness Tracker

A personal workout, nutrition, bodyweight, training-load, habit and meal-prep tracker.
It's an installable web app (PWA): it works fully offline and **all data stays on your phone** (in IndexedDB).

Live app: https://rolf-alexander.github.io/fitness-tracker/

## Add it to your iPhone home screen
1. Open the link above in **Safari** (it must be Safari).
2. Tap the **Share** button (square with an arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open it from the new icon. It runs full-screen and works offline from then on.

## Back up your data (do this every week or two)
Your data exists only on your phone. Deleting the app icon deletes the data too.
1. Open the app, tap the ⚙️ (top right) and choose **Back up everything (JSON)**.
2. In the share sheet choose **Save to Files**, then pick iCloud Drive.
3. To restore (e.g. on a new phone), go to ⚙️ and choose **Restore from JSON backup…** and pick the file.

CSV export (for spreadsheets) is under ⚙️ → *CSV export & import*.

## Update the app
1. Edit the files (or ask Claude to).
2. **Bump the version number** in `sw.js` (`VERSION`) and in `js/settings-store.js` (`APP_VERSION`).
   If you add a new file, add it to the `ASSETS` list in `sw.js` too.
3. Publish it:
   ```
   git add -A
   git commit -m "Describe the change"
   git push
   ```
4. GitHub Pages republishes within about a minute. Next time you open the app, an **Update now** banner appears.
   Updating never touches your data.

## Test it locally
```
python -m http.server 8765        # then open http://127.0.0.1:8765
pip install playwright
python tests/e2e.py               # end-to-end tests, including offline + restart (uses Microsoft Edge)
```

## How it's organised
- `index.html`: the page. `css/styles.css`: the design, including dark mode.
- `js/app.js`: tabs and page switching. `js/db.js`: on-device storage.
- `js/views/*.js`: one file per tab. `js/backup.js`: export/import. `js/timer.js`: rest timer.
- `sw.js`: the service worker, which saves the app on your phone so it works offline.
