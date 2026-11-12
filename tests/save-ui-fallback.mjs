/**
 * Saves menu regression check under blocked storage.
 *
 *   node tests/save-ui-fallback.mjs [compiled.html | https://url] [--mode=all|normal|strict|idbonly|quota]
 *
 * normal  - browser storage untouched
 * strict  - localStorage/sessionStorage getters throw, indexedDB.open() denied
 * idbonly - localStorage works, indexedDB.open() fails asynchronously (e.g. Firefox private windows)
 * quota   - Storage.setItem always throws QuotaExceededError
 *
 * In every mode the saves menu must show enabled Save buttons, saving to a slot and loading it must
 * restore state, "Save to file" must download a save, importing that file must restore it, and there
 * must be no page errors, alerts or SugarCube error views.
 * Requires puppeteer-core and Chrome (CHROME_PATH, default /usr/bin/google-chrome).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const modeArg = (args.find(a => a.startsWith("--mode=")) || "--mode=all").slice(7);
const target = args.find(a => !a.startsWith("--")) || join(root, "Degrees of Lewdity.html");
let url = target;
if (!/^https?:\/\//.test(target)) {
	const p = resolve(target);
	if (!existsSync(p)) {
		console.error("Compiled HTML not found:", p);
		process.exit(1);
	}
	url = pathToFileURL(p).href;
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

function blockStorage(variant) {
	if (variant === "quota") {
		Storage.prototype.setItem = function () {
			throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
		};
		return;
	}
	if (variant === "strict") {
		const deny = name => () => {
			throw new DOMException(`Failed to read the '${name}' property from 'Window': Access is denied for this document.`, "SecurityError");
		};
		for (const name of ["localStorage", "sessionStorage"]) {
			for (const t of [Window.prototype, window]) {
				try {
					Object.defineProperty(t, name, { configurable: true, enumerable: true, get: deny(name), set: deny(name) });
				} catch (e) {}
			}
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
				if (typeof req.onerror === "function") req.onerror({ type: "error", target: req, preventDefault() {} });
			} catch (e) {}
		}, 0);
		return req;
	};
	const fake = { open: denied, deleteDatabase: denied, cmp: () => 0, databases: () => Promise.reject(new DOMException("denied", "UnknownError")) };
	try {
		Object.defineProperty(window, "indexedDB", { configurable: true, enumerable: true, get: () => fake });
	} catch (e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, mode) {
	const page = await browser.newPage();
	const downloadDir = mkdtempSync(join(tmpdir(), "dol-save-dl-"));
	const cdp = await page.createCDPSession();
	await cdp
		.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir })
		.catch(() => cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir }));
	const alerts = [];
	const pageErrors = [];
	const notFound = [];
	page.on("dialog", async d => {
		alerts.push(d.message());
		try {
			await d.accept();
		} catch (e) {}
	});
	page.on("pageerror", err => pageErrors.push(String(err && err.message ? err.message : err)));
	page.on("response", r => {
		if (r.status() >= 400) notFound.push(r.status() + " " + r.url());
	});
	if (mode !== "normal") await page.evaluateOnNewDocument(blockStorage, mode);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
	await page.waitForFunction(() => window.SugarCube && SugarCube.State && SugarCube.State.passage === "Start", { timeout: 120000 }).catch(() => {});

	const problems = [];
	const info = {};
	const ev = (fn, ...a) => page.evaluate(fn, ...a);

	info.boot = await ev(() => {
		/* compiled test builds may carry a password overlay; it is not part of what is tested here */
		document.getElementById("dol-password-gate")?.remove();
		return {
			sugarcube: !!(window.SugarCube && SugarCube.State),
			passage: window.SugarCube && SugarCube.State ? SugarCube.State.passage : null,
			fallback: window.DoLStorageFallback
				? { ls: DoLStorageFallback.localStorage, idb: DoLStorageFallback.indexedDB, memoryOnly: DoLStorageFallback.memoryOnly }
				: null,
			saveOk: window.SugarCube && SugarCube.Save.ok ? SugarCube.Save.ok() : null,
		};
	});
	if (!info.boot.sugarcube || info.boot.passage !== "Start") {
		problems.push("game did not boot to Start");
		await page.close();
		return { mode, ok: false, problems, alerts, pageErrors, info };
	}

	await ev(async () => {
		const s = ms => new Promise(r => setTimeout(r, ms));
		SugarCube.Engine.play("Start2");
		await s(1200);
		SugarCube.State.variables.saveProbe = "slot";
		SugarCube.Engine.play("Orphanage Intro");
		await s(1200);
		/* no confirmation prompts: the test clicks buttons directly */
		Object.assign(SugarCube.State.variables, { confirmSave: false, confirmLoad: false, confirmDelete: false });
		try {
			if (window.idb && idb.updateSettings && idb.active) ["warnSave", "warnLoad", "warnDelete"].forEach(k => idb.updateSettings(k, false));
		} catch (e) {}
	});

	const openSaves = async () => {
		await ev(() => $.wiki('<<overlayReplace "saves">>'));
		await sleep(1800);
		return ev(() => {
			const c = document.getElementById("customOverlayContent");
			const btns = Array.from(c ? c.querySelectorAll("input[type=button],button") : []);
			return {
				save: btns.filter(b => (b.value || b.textContent).trim() === "Save").map(b => !b.disabled),
				load: btns.filter(b => (b.value || b.textContent).trim() === "Load").map(b => !b.disabled),
				notice: !!document.getElementById("storageFallbackNotice"),
				noticeExport: !!(document.getElementById("storageFallbackExport") && !document.getElementById("storageFallbackExport").disabled),
				idbActive: window.idb ? idb.active : null,
			};
		});
	};
	const clickButton = (label, enabledIndex = 0) =>
		ev(
			(label, i) => {
				const c = document.getElementById("customOverlayContent");
				const b = Array.from(c.querySelectorAll("input[type=button],button")).filter(x => (x.value || x.textContent).trim() === label && !x.disabled)[i];
				if (!b) return false;
				b.click();
				return true;
			},
			label,
			enabledIndex
		);

	info.menu = await openSaves();
	if (!info.menu.save.some(Boolean)) problems.push("saves menu has no enabled Save button");
	if (mode !== "normal" && !info.menu.notice) problems.push("storage fallback notice missing");
	if (mode === "normal" && info.menu.notice) problems.push("storage fallback notice shown with working storage");
	if (mode !== "normal" && !info.menu.noticeExport) problems.push("notice Save to file button missing or disabled");

	/* slot save -> change -> load */
	if (!(await clickButton("Save"))) problems.push("could not click Save");
	await sleep(2000);
	await ev(() => {
		SugarCube.State.variables.saveProbe = "changed";
	});
	info.afterSave = await openSaves();
	if (!info.afterSave.load.some(Boolean)) problems.push("no enabled Load button after saving");
	if (!(await clickButton("Load"))) problems.push("could not click Load");
	await sleep(2500);
	info.slotValue = await ev(() => SugarCube.State.variables.saveProbe);
	if (info.slotValue !== "slot") problems.push("slot load did not restore state: " + info.slotValue);
	await ev(() => SugarCube.Dialog && SugarCube.Dialog.isOpen && SugarCube.Dialog.isOpen() && SugarCube.Dialog.close());

	/* Save to file -> change -> import */
	await ev(async () => {
		const s = ms => new Promise(r => setTimeout(r, ms));
		SugarCube.State.variables.saveProbe = "file";
		SugarCube.Engine.play("Orphanage Intro");
		await s(1200);
		$.wiki('<<overlayReplace "export">>');
		await s(800);
	});
	const exported = await ev(() => {
		const b = Array.from(document.querySelectorAll("#customOverlayContent input[type=button]")).find(x => x.value === "Save to file" && !x.disabled);
		if (!b) return false;
		b.click();
		return true;
	});
	if (!exported) problems.push("Export/Import tab has no enabled Save to file button");
	let file = null;
	for (let i = 0; i < 40 && !file; i++) {
		await sleep(250);
		const f = readdirSync(downloadDir).filter(n => !n.endsWith(".crdownload"));
		if (f.length) file = join(downloadDir, f[0]);
	}
	if (!file) problems.push("Save to file produced no download");
	else {
		info.download = { name: file.split("/").pop(), bytes: statSync(file).size };
		if (!info.download.bytes) problems.push("downloaded save is empty");
		await ev(() => {
			SugarCube.State.variables.saveProbe = "changed";
		});
		const input = await page.$("#saveImport");
		if (!input) problems.push("Load from file input missing");
		else {
			await input.uploadFile(file);
			await sleep(3000);
			info.importValue = await ev(() => SugarCube.State.variables.saveProbe);
			if (info.importValue !== "file") problems.push("import did not restore state: " + info.importValue);
		}
		info.downloadHead = readFileSync(file, "utf8").slice(0, 16);
	}

	info.errorViews = await ev(() => Array.from(document.querySelectorAll(".error-view")).map(e => (e.textContent || "").slice(0, 200)));
	if (info.errorViews.length) problems.push("error views: " + info.errorViews.join(" | "));
	if (alerts.length) problems.push("alerts: " + alerts.map(a => a.slice(0, 200)).join(" | "));
	if (pageErrors.length) problems.push("page errors: " + pageErrors.join(" | "));
	await page.close();
	return { mode, ok: problems.length === 0, problems, notFound, info };
}

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
	headless: "new",
	args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
});
const modes = modeArg === "all" ? ["normal", "strict", "idbonly", "quota"] : modeArg.split(",");
const results = [];
try {
	for (const m of modes) results.push(await run(browser, m));
} finally {
	await browser.close();
}
console.log(JSON.stringify(results, null, 2));
if (!results.every(r => r.ok)) process.exit(1);
