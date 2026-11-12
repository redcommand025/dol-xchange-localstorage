/* Late safety net for no-storage mode.
 * The primary fallback lives in devTools/head.html and is prepended before
 * SugarCube so indexedDB can be nulled before SugarCube's adapter IIFE runs.
 * This copy covers user-script evaluation if head insertion was skipped. */
(function () {
	"use strict";
	function makeMemoryStorage() {
		let store = {};
		return {
			getItem(k) {
				return Object.hasOwn(store, k) ? store[k] : null;
			},
			setItem(k, v) {
				store[k] = String(v);
			},
			removeItem(k) {
				delete store[k];
			},
			clear() {
				store = {};
			},
			key(i) {
				return Object.keys(store)[i] || null;
			},
			get length() {
				return Object.keys(store).length;
			},
		};
	}
	function works(s) {
		try {
			if (!s || typeof s.getItem !== "function" || typeof s.setItem !== "function") return false;
			const t = "__dol_store_test__";
			s.setItem(t, "1");
			const ok = s.getItem(t) === "1";
			s.removeItem(t);
			return ok;
		} catch (e) {
			return false;
		}
	}
	function ensure(name, stub) {
		try {
			if (works(window[name])) return true;
		} catch (e) {}
		try {
			delete window[name];
		} catch (e) {}
		try {
			Object.defineProperty(window, name, { value: stub, configurable: true, writable: true });
			if (works(window[name])) return true;
		} catch (e) {}
		try {
			window[name] = stub;
		} catch (e) {}
		return false;
	}
	let nativeLS = false;
	let nativeSS = false;
	try {
		nativeLS = works(window.localStorage);
	} catch (e) {}
	try {
		nativeSS = works(window.sessionStorage);
	} catch (e) {}
	try {
		window.localStorage.getItem("__test");
	} catch (e) {
		ensure("localStorage", makeMemoryStorage());
	}
	try {
		window.sessionStorage.getItem("__test");
	} catch (e) {
		ensure("sessionStorage", makeMemoryStorage());
	}
	if (!nativeLS) ensure("localStorage", makeMemoryStorage());
	if (!nativeSS) ensure("sessionStorage", makeMemoryStorage());
	function disableIndexedDB() {
		try {
			Object.defineProperty(window, "indexedDB", { value: null, configurable: true, writable: true });
		} catch (e) {
			try {
				window.indexedDB = null;
			} catch (e2) {}
		}
	}
	function idbUnusable() {
		try {
			if (window.indexedDB == null) return true;
			if (typeof window.indexedDB.open !== "function") return true;
		} catch (e) {
			return true;
		}
		try {
			window.indexedDB.open("__dol_idb_probe__");
		} catch (e) {
			return true;
		}
		return false;
	}
	if (!nativeLS || !nativeSS || idbUnusable()) {
		disableIndexedDB();
	}
	/* The head fallback normally creates this; keep a minimal copy for builds that skipped it. */
	if (!window.DoLStorageFallback) {
		window.DoLStorageFallback = {
			localStorage: nativeLS ? "native" : "memory",
			sessionStorage: nativeSS ? "native" : "memory",
			indexedDB: window.indexedDB == null ? "disabled" : "native",
			memoryOnly: !nativeLS,
			active() {
				return this.memoryOnly || this.indexedDB !== "native";
			},
			applyToIdb() {},
		};
	}
	/* DoL resets idb.active from its settings (idb.updateSettings) during startup, so re-apply a
	   detected IndexedDB denial before each passage; save/autosave paths read idb.active. */
	if (window.jQuery) {
		jQuery(document).on(":passagestart.storagefallback", () => {
			try {
				window.DoLStorageFallback.applyToIdb();
			} catch (e) {}
		});
	}
})();
