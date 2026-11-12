# Storage fallback (localStorage / sessionStorage / IndexedDB)

Some browsers block web storage for a page: `file://` with strict settings, sandboxed iframes, private
windows, or "block site data" policies. Reading `window.localStorage` then throws `SecurityError`, and
`indexedDB.open()` fails. Unpatched, SugarCube aborts at boot with
"A fatal error has occurred. Aborting. Error: Failed to read the 'localStorage' property ...".

This fork adds an in-memory fallback so the game still starts in that situation. Saves made while
storage is blocked last only for the session; export saves to keep them.

| File | Role |
| --- | --- |
| `devTools/head.html` | First `<script>`: probes storage, installs in-memory `localStorage`/`sessionStorage` stubs when the real ones throw, wraps `Storage.prototype` methods, and sets `window.indexedDB = null` when storage or IndexedDB is unusable so SugarCube/DoL fall back to the slot-save system. |
| `devTools/prepend-storage-fallback.py` | Tweego appends `--head` content after SugarCube's libraries, which is too late. After each build this copies the fallback script to the very top of `<head>` (idempotent). |
| `compile.sh` / `compile.bat` | Run the prepend step after tweego (`compile.bat` needs Python 3 on PATH and warns if it is missing). |
| `game/03-JavaScript/storage-polyfill.js` | Late safety net with the same logic, for builds where the prepend step was skipped. |
| `tests/storage-startup.mjs` | Headless Chrome check of the compiled HTML in strict (blocked storage) and normal modes: boot, StoryInit, new game, slot save/load. `node tests/storage-startup.mjs` (needs `puppeteer-core`). |
| `tests/prepend-storage-fallback.check.mjs` | `node --test` unit check for the prepend script. |

With storage available, nothing changes: the stubs are not installed and IndexedDB stays active.
