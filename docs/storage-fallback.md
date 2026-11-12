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
| `game/base-system/overlays/saves-storage-fallback.twee` | `<<storageFallbackSaves>>`, shown at the top of the saves menu only when the fallback is active: a short notice (memory-only saves vanish on tab close / IndexedDB blocked) plus "Save to file" and "Load from file". |
| `tests/save-ui-fallback.mjs` | Headless check of the saves menu in `normal`, `strict`, `idbonly` and `quota` modes: enabled Save buttons, slot save/load, Save to file download, import restores. |
| `tests/prepend-storage-fallback.check.mjs` | `node --test` unit check for the prepend script. |

### IndexedDB denied after startup

Some browsers (e.g. Firefox private windows, storage-blocking policies) keep `window.indexedDB` but fail
`indexedDB.open()` asynchronously. SugarCube has already chosen IndexedDB by then and leaves `idb.active`
on, so the saves menu rendered an empty list with no Save buttons and an uncaught rejection. The head
script now watches its probe request; on failure it marks `DoLStorageFallback.indexedDB = "denied"`, sets
`idb.active = false` (not persisted), re-applies that before each passage (DoL resets it from settings),
and the saves menu switches to the slot list. `window.DoLStorageFallback` reports what the fallback did.

With storage available, nothing changes: the stubs are not installed and IndexedDB stays active.

## Publishing (audio is in Git LFS)

`audio/**` is a Git LFS path upstream. Without git-lfs, a checkout has 131-byte pointer files, and
GitHub Pages also serves LFS-tracked files as pointers, so music and sound silently fail to decode.
To make a Pages copy, run `./compile.sh` and then `devTools/prepare-pages.sh <output-dir>`. That copies
the HTML and images, downloads the real audio for each pointer from the upstream LFS server (checking
SHA-256 and size), and refuses to finish if any audio file is still a pointer
(`devTools/lfs-audio.py check <dir>`). Commit the result as plain files; do not use LFS there.
