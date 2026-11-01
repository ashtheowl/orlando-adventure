# Magical Orlando Adventure

A holiday tick list, bravery score and diary for a tablet. It works with no
internet, and everything entered stays on the tablet. There is no account, no
login and no tracking. The printed book is still the main copy.

## Files

| File | What it does |
|---|---|
| `index.html` | The page itself |
| `app.js` | The screens |
| `storage.js` | Saving, loading, backup and restore |
| `styles.css` | Colours and layout, matching the book |
| `fonts.css` | The two fonts, built in so they work offline |
| `content.json` | Every ride and diary day. The ids must never change, saved entries depend on them |
| `sw.js` | Keeps the app's files on the tablet for offline use |
| `tests/storage-test.html` | Storage tests, in their own storage so they cannot touch real entries |

The name of the adventurer is typed into the app and stays on the tablet. It is
deliberately not in this public repo, and backup files stay out of it too.

## Pushing a fix during the trip

1. Change `CACHE_VERSION` in `sw.js` and `APP_VERSION` in `app.js`, both up by one.
2. Commit and push.
3. On hotel wifi, open the app, close it, and open it again.

Saved entries are not touched by an update.
