// devTools/head.html storage stand-in and SugarCube's updateSettings, as in the DoL-localStorage mod
// (redcommand025/DoL-localStorage-copy): when localStorage/sessionStorage are missing or throw, an in-memory
// stand-in replaces them; IndexedDB is left alone.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const head = readFileSync(join(root, "devTools/head.html"), "utf8");
const scriptEnd = head.indexOf("</script>\n") + "</script>\n".length;
const headScript = head.slice(0, scriptEnd);
const source = headScript.slice("<script>".length, -"</script>\n".length);
/* SHA-256 of the first <script> block of DoL-localStorage-copy's index.html (commit 4480cfb1) */
const REFERENCE_SHA256 = "495e23437c0305c3ffc9353f2752525fd27713fed090f0d041358629c536f1b7";

function denied(name) {
	return () => {
		const e = new Error(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`);
		e.name = "SecurityError";
		throw e;
	};
}

function working() {
	const mem = {};
	return {
		getItem: k => (Object.hasOwn(mem, k) ? mem[k] : null),
		setItem: (k, v) => {
			mem[k] = String(v);
		},
		removeItem: k => {
			delete mem[k];
		},
		clear() {},
		key: () => null,
		get length() {
			return Object.keys(mem).length;
		},
	};
}

function run(setup) {
	const win = {};
	setup(win);
	win.window = win;
	vm.runInNewContext(source, win);
	return win;
}

describe("storage stand-in (devTools/head.html)", () => {
	it("is the first script in head.html and identical to the DoL-localStorage script", () => {
		assert.ok(head.startsWith("<script>\n/* Storage fallback for devices with no storage"));
		assert.equal(createHash("sha256").update(headScript).digest("hex"), REFERENCE_SHA256);
	});

	it("leaves working storage alone", () => {
		const ls = working();
		const ss = working();
		const win = run(w => Object.assign(w, { localStorage: ls, sessionStorage: ss }));
		assert.equal(win.localStorage, ls);
		assert.equal(win.sessionStorage, ss);
		assert.equal(ls.getItem("__dol_localStorage_test"), null, "probe key removed");
	});

	it("replaces storage whose getter throws with a working in-memory stand-in", () => {
		const win = run(w => {
			Object.defineProperty(w, "localStorage", { configurable: true, get: denied("localStorage") });
			Object.defineProperty(w, "sessionStorage", { configurable: true, get: denied("sessionStorage") });
		});
		for (const name of ["localStorage", "sessionStorage"]) {
			const s = win[name];
			s.setItem("a", 1);
			assert.equal(s.getItem("a"), "1");
			assert.equal(s.length, 1);
			assert.equal(s.key(0), "a");
			s.removeItem("a");
			assert.equal(s.getItem("a"), null);
			s.setItem("b", "x");
			s.clear();
			assert.equal(s.length, 0);
		}
		assert.notEqual(win.localStorage, win.sessionStorage, "separate stores");
	});

	it("replaces null storage and storage whose setItem throws (quota)", () => {
		const quota = working();
		quota.setItem = () => {
			const e = new Error("The quota has been exceeded.");
			e.name = "QuotaExceededError";
			throw e;
		};
		const win = run(w => Object.assign(w, { localStorage: null, sessionStorage: quota }));
		win.localStorage.setItem("k", "v");
		win.sessionStorage.setItem("k", "w");
		assert.equal(win.localStorage.getItem("k"), "v");
		assert.equal(win.sessionStorage.getItem("k"), "w");
	});

	it("does not touch IndexedDB", () => {
		const fakeIdb = { open() {} };
		const win = run(w => Object.assign(w, { localStorage: null, sessionStorage: null, indexedDB: fakeIdb }));
		assert.equal(win.indexedDB, fakeIdb);
		assert.doesNotMatch(source, /indexedDB/);
	});
});

describe("SugarCube updateSettings (story format)", () => {
	const format = readFileSync(join(root, "devTools/tweego/storyFormats/sugarcube-2/format.js"), "utf8");
	const formatSource = JSON.parse(format.slice(format.indexOf("{"), format.lastIndexOf("}") + 1)).source;
	const start = formatSource.indexOf("function updateSettings(setting,value){");
	const end = formatSource.indexOf("}}updateSettings();", start) + 2;
	const fn = formatSource.slice(start, end);

	function settings(win) {
		const ctx = { window: win, V: {}, console: { warn() {} }, _settings: null, _active: null };
		vm.runInNewContext(`${fn}; updateSettings(); this.result = { s: _settings, a: _active }; this.updateSettings = updateSettings;`, ctx);
		return ctx;
	}

	it("guards every localStorage access with try/catch", () => {
		assert.match(fn, /var ls=null;try\{ls=window\.localStorage\}catch\(e\)\{ls=null\}/);
		assert.match(fn, /try\{if\(ls&&typeof ls\.setItem==="function"\)ls\.setItem\("idb-settings",JSON\.stringify\(_settings\)\)\}catch\(e\)\{\}/);
	});

	it("falls back to defaults when localStorage is missing or throws, and saves when it works", () => {
		const nul = settings({ localStorage: null });
		assert.equal(nul.result.a, true);
		const throwing = {};
		Object.defineProperty(throwing, "localStorage", { get: denied("localStorage") });
		const t = settings(throwing);
		assert.equal(t.result.s.useDelta, true);
		t.updateSettings("warnSave", true);
		const ls = working();
		const ok = settings({ localStorage: ls });
		ok.updateSettings("active", false);
		assert.equal(JSON.parse(ls.getItem("idb-settings")).active, false);
	});
});
