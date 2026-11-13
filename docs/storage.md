# Storage (DoL-localStorage method)

Follows redcommand025/DoL-localStorage-copy:

- `devTools/head.html` starts with the DoL-localStorage stand-in: if `localStorage` or `sessionStorage` is missing,
  or reading/writing a test key throws, it is replaced with an in-memory object. Saves made then last only until the
  tab is closed. IndexedDB is not touched.
- `devTools/tweego/storyFormats/sugarcube-2/format.js`: SugarCube's `updateSettings` wraps its `idb-settings`
  read/write in try/catch, so a broken localStorage cannot stop the game loading.
- Saves menu (`game/base-system/overlays/saves.twee`): the IndexedDB save list is used only when
  `window.indexedDB` exists; otherwise the slot list ("localStorage copy/paste mode"). Browsers that have IndexedDB
  but block it are not detected, so the IndexedDB list may stay empty there (accepted).
- Every player sees the copy/paste note plus "Save to file" / "Load from file" (`saves-copy-paste.twee`). The save
  string (Export menu: Get Save Data / Copy Text Area / Load Save Data) and save files work without storage.

Build: `bash compile.sh` (tweego `--head devTools/head.html --module modules`). The stand-in sits in `<head>` before
any game code uses storage, so no post-build step is needed.

Tests: `tests/storage-fallback.test.mjs`, `tests/save-fallback-ui.test.mjs` (node --test);
`node tests/no-storage-startup.mjs`, `node tests/save-ui-fallback.mjs <url> --mode=all` (headless).
