/**
 * Headless startup check for the compiled game, with and without browser storage.
 *
 *   node tests/storage-startup.mjs [path-to-compiled.html] [--mode=strict|normal|both]
 *
 * strict: localStorage/sessionStorage getters throw SecurityError and indexedDB.open() is denied
 *         (what Chrome does for file:// pages or sandboxed iframes with storage blocked).
 * normal: browser storage left untouched.
 *
 * Storage follows the DoL-localStorage method (devTools/head.html stand-in; IndexedDB untouched).
 * For each mode it checks: no page errors (other than SugarCube's reported IndexedDB denial), no alerts, no SugarCube error views, StoryInit ran,
 * a new game can be started (Start -> Start2 -> Orphanage Intro), and a slot save/load round-trips.
 * Requires puppeteer-core and a Chrome binary (CHROME_PATH, default /usr/bin/google-chrome).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const modeArg = (args.find(a => a.startsWith("--mode=")) || "--mode=both").slice(7);
const htmlPath = resolve(args.find(a => !a.startsWith("--")) || join(root, "Degrees of Lewdity.html"));
if (!existsSync(htmlPath)) {
	console.error("Compiled HTML not found:", htmlPath);
	process.exit(1);
}

const require = createRequire(import.meta.url);
let puppeteer;
for (const id of ["puppeteer-core", "puppeteer", "/tmp/dol-diag/node_modules/puppeteer-core"]) {
	try {
		puppeteer = require(id);
		break;
	} catch (e) {}
}
if (!puppeteer) {
	console.error("puppeteer-core is required to run this check");
	process.exit(1);
}

function denyStorage() {
	const deny = name => () => {
		throw new DOMException(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`, "SecurityError");
	};
	for (const name of ["localStorage", "sessionStorage"]) {
		for (const target of [Window.prototype, window]) {
			try {
				Object.defineProperty(target, name, { configurable: true, enumerable: true, get: deny(name), set: deny(name) });
			} catch (e) {}
		}
	}
	const denied = () => {
		const req = {
			result: undefined,
			error: new DOMException("The user denied permission to access the database.", "UnknownError"),
			onerror: null,
			onsuccess: null,
			onupgradeneeded: null,
			onblocked: null,
			addEventListener(type, fn) {
				if (type === "error") this.onerror = fn;
			},
		};
		setTimeout(() => {
			try {
				if (typeof req.onerror === "function") req.onerror({ type: "error", target: req });
			} catch (e) {}
		}, 0);
		return req;
	};
	const fakeIDB = {
		open: denied,
		deleteDatabase: denied,
		cmp: () => 0,
		databases: () => Promise.reject(new DOMException("The user denied permission to access the database.", "UnknownError")),
	};
	try {
		Object.defineProperty(window, "indexedDB", { configurable: true, enumerable: true, get: () => fakeIDB });
	} catch (e) {}
}

async function run(browser, mode) {
	const page = await browser.newPage();
	const alerts = [];
	const pageErrors = [];
	const consoleErrors = [];
	page.on("dialog", async d => {
		alerts.push(d.message());
		try {
			await d.accept();
		} catch (e) {}
	});
	page.on("pageerror", err => pageErrors.push(String(err && err.message ? err.message : err)));
	page.on("console", msg => {
		if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
	});
	if (mode === "strict") await page.evaluateOnNewDocument(denyStorage);

	await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "domcontentloaded", timeout: 180000 });
	await page
		.waitForFunction(() => window.SugarCube && SugarCube.State && SugarCube.State.passage === "Start" && document.querySelector("#passages .passage"), {
			timeout: 120000,
		})
		.catch(() => {});

	const result = await page.evaluate(async () => {
		const out = { steps: {} };
		const sleep = ms => new Promise(r => setTimeout(r, ms));
		const probe = name => {
			try {
				const s = window[name];
				s.setItem("__probe__", "1");
				const ok = s.getItem("__probe__") === "1";
				s.removeItem("__probe__");
				return ok;
			} catch (e) {
				return "error: " + e;
			}
		};
		const errorViews = () => Array.from(document.querySelectorAll(".error-view, .error")).map(el => (el.textContent || "").trim().slice(0, 300));
		out.sugarcube = !!(window.SugarCube && SugarCube.State);
		out.finalErrors = errorViews();
		out.steps = {};
		if (!out.sugarcube) return out;
		out.passage = window.SugarCube && SugarCube.State ? SugarCube.State.passage : null;
		out.localStorage = probe("localStorage");
		out.sessionStorage = probe("sessionStorage");
		out.indexedDBNull = window.indexedDB == null;
		out.idbActive = window.idb ? !!idb.active : null;
		const V = SugarCube.State.variables;
		/* StoryInit ran if its core variables exist. */
		out.storyInit = V.options !== undefined && V.money !== undefined && Array.isArray(V.NPCNameList);
		out.steps.start = { passage: out.passage, errors: errorViews() };
		try {
			SugarCube.Engine.play("Start2");
			await sleep(1500);
			out.steps.start2 = { passage: SugarCube.State.passage, errors: errorViews() };
			SugarCube.Engine.play("Orphanage Intro");
			await sleep(1500);
			out.steps.intro = { passage: SugarCube.State.passage, errors: errorViews() };
		} catch (e) {
			out.newGameError = String(e);
		}
		try {
			const S = SugarCube.State.variables;
			/* Commit the probe into a history moment: saves serialise moments, not the working copy. */
			S.storageProbe = "before-save";
			SugarCube.Engine.play("Orphanage Intro");
			await sleep(1000);
			const saved = SugarCube.Save.slots.save(0, "storage probe");
			out.slotSaveReturn = saved === undefined ? "undefined" : String(saved);
			out.slotOk = SugarCube.Save.slots.has(0);
			SugarCube.State.variables.storageProbe = "changed";
			SugarCube.Save.slots.load(0);
			await sleep(1500);
			out.slotLoadedValue = SugarCube.State.variables.storageProbe;
			out.slotLoadedPassage = SugarCube.State.passage;
			const blob = SugarCube.Save.serialize();
			SugarCube.State.variables.storageProbe = "changed-again";
			SugarCube.Save.deserialize(blob);
			await sleep(500);
			out.serializeValue = SugarCube.State.variables.storageProbe;
		} catch (e) {
			out.saveError = String(e && e.stack ? e.stack : e);
		}
		out.finalErrors = errorViews();
		return out;
	});
	await page.close();

	const problems = [];
	if (!result.sugarcube) problems.push("SugarCube did not load");
	if (result.sugarcube) {
		if (result.passage !== "Start") problems.push(`initial passage was ${result.passage}`);
		if (!result.storyInit) problems.push("StoryInit variables missing");
		if (result.localStorage !== true) problems.push("localStorage unusable: " + result.localStorage);
		if (result.sessionStorage !== true) problems.push("sessionStorage unusable: " + result.sessionStorage);
		if (result.newGameError) problems.push("new game: " + result.newGameError);
		if (!result.steps.intro || result.steps.intro.passage !== "Orphanage Intro") problems.push("new game did not reach Orphanage Intro");
		if (result.saveError) problems.push("save/load: " + result.saveError);
		if (!result.slotOk) problems.push("slot save missing");
		if (result.slotLoadedValue !== "before-save") problems.push("slot load did not restore state: " + result.slotLoadedValue);
		if (result.serializeValue !== "before-save") problems.push("serialize round-trip failed: " + result.serializeValue);
		for (const [k, s] of Object.entries(result.steps)) if (s.errors && s.errors.length) problems.push(`${k} error views: ${s.errors.join(" | ")}`);
	}
	if (result.finalErrors.length) problems.push("error views: " + result.finalErrors.join(" | "));
	if (alerts.length) problems.push("alerts: " + alerts.map(a => a.slice(0, 200)).join(" | "));
	/* DoL-localStorage method: IndexedDB is left alone, so a denied open() surfaces as SugarCube's uncaught idb
	   rejection. Reported (idbDenialErrors), not failed; any other page error fails. */
	const idbDenialErrors = pageErrors.filter(m => /denied permission to access the database|indexeddb/i.test(m));
	const otherPageErrors = pageErrors.filter(m => !idbDenialErrors.includes(m));
	result.idbDenialErrors = idbDenialErrors;
	if (otherPageErrors.length) problems.push("page errors: " + otherPageErrors.join(" | "));
	return { mode, ok: problems.length === 0, problems, consoleErrors, result };
}

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
	headless: "new",
	args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});
const modes = modeArg === "both" ? ["strict", "normal"] : [modeArg];
const results = [];
try {
	for (const mode of modes) results.push(await run(browser, mode));
} finally {
	await browser.close();
}
console.log(JSON.stringify(results, null, 2));
if (!results.every(r => r.ok)) process.exit(1);
