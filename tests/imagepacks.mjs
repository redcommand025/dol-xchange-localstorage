/**
 * Image pack selector check (Options > Images > Image pack / Mysterious combat sprites).
 *
 *   node tests/imagepacks.mjs <http(s)://site/> [--mode=both|normal|strict]
 *
 * Needs an HTTP(S) URL whose folder has index.html (compiled game), img/ and imagepacks/{au,aumasc,mysterious}.
 * strict = localStorage/sessionStorage throw and indexedDB.open() is denied.
 * For each pack chosen through the options UI it checks that the sidebar doll is redrawn from
 * imagepacks/<id>/ (requests 200, image differs from default), that Mysterious remaps combat sprites,
 * that switching back to Default restores the default doll, and that there are no page errors or
 * pack 404s.
 */
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith("--"));
const modeArg = (args.find(a => a.startsWith("--mode=")) || "--mode=both").slice(7);
if (!url || !/^https?:\/\//.test(url)) {
	console.error("usage: node tests/imagepacks.mjs <http(s)://site/> [--mode=both|normal|strict]");
	process.exit(2);
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
	console.error("puppeteer-core is required");
	process.exit(1);
}

function blockStorage() {
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
	const denied = () => {
		const req = { error: new DOMException("The user denied permission to access the database.", "UnknownError"), onerror: null };
		setTimeout(() => {
			try {
				if (req.onerror) req.onerror({ type: "error", target: req, preventDefault() {} });
			} catch (e) {}
		}, 0);
		return req;
	};
	const fake = { open: denied, deleteDatabase: denied, cmp: () => 0, databases: () => Promise.reject(new Error("denied")) };
	try {
		Object.defineProperty(window, "indexedDB", { configurable: true, enumerable: true, get: () => fake });
	} catch (e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, mode) {
	const page = await browser.newPage();
	const pageErrors = [];
	const packRequests = [];
	const bad = [];
	page.on("pageerror", e => pageErrors.push(String(e.message || e)));
	page.on("response", r => {
		const u = decodeURIComponent(r.url());
		if (u.includes("/imagepacks/")) packRequests.push({ status: r.status(), path: u.split("/imagepacks/")[1] });
		if (r.status() >= 400 && !/usettings\.js$/.test(u)) bad.push(`${r.status()} ${u}`);
	});
	if (mode === "strict") await page.evaluateOnNewDocument(blockStorage);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
	await page.waitForFunction(() => window.SugarCube && SugarCube.State && SugarCube.State.passage === "Start", { timeout: 120000 });

	const problems = [];
	const ev = (fn, ...a) => page.evaluate(fn, ...a);
	const dollHash = () =>
		ev(() => {
			const c = document.querySelector("canvas.mainCanvas") || document.querySelector("#img canvas");
			if (!c || !c.toDataURL) return null;
			let h = 0;
			const s = c.toDataURL();
			for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
			return `${c.width}x${c.height}:${h}`;
		});

	await ev(async () => {
		const s = ms => new Promise(r => setTimeout(r, ms));
		document.getElementById("dol-password-gate")?.remove();
		SugarCube.Engine.play("Start2");
		await s(1000);
		Object.assign(SugarCube.State.variables.options, { sidebarAnimations: false, blinkingEnabled: false });
		SugarCube.Engine.play("Orphanage Intro");
		await s(1000);
		SugarCube.Engine.play("Bedroom");
		await s(3000);
	});
	const results = { default: await dollHash() };
	if (!results.default) problems.push("no sidebar doll canvas");

	const openPerformance = async () => {
		await ev(() => {
			$.wiki('<<overlayReplace "options">>');
			$.wiki("<<replace #customOverlayContent>><<optionsperformance>><</replace>>");
		});
		await sleep(800);
	};
	/* SugarCube listbox option values are indices; pick by label like a player would */
	const LABELS = { default: "Default", au: "Aoki Utage (Fem)", aumasc: "Aoki Utage (Masc)" };
	const choosePack = id =>
		ev(label => {
			const sel = document.getElementById("listbox-optionsimagepack");
			const opt = Array.from(sel.options).find(o => o.textContent.trim() === label);
			sel.value = opt.value;
			sel.dispatchEvent(new Event("change", { bubbles: true }));
		}, LABELS[id]);
	const closeOverlay = () => ev(() => $.wiki("<<closeOverlay>>")).catch(() => {});
	await openPerformance();
	const ui = await ev(() => {
		const sel = document.getElementById("listbox-optionsimagepack");
		return {
			select: !!sel,
			options: sel ? Array.from(sel.options).map(o => o.textContent.trim()) : [],
			mysterious: !!document.getElementById("checkbox-optionsimagepackmysterious"),
		};
	});
	results.ui = ui;
	if (!ui.select || !ui.options.includes("Aoki Utage (Fem)") || !ui.options.includes("Aoki Utage (Masc)"))
		problems.push("Image pack listbox missing or incomplete: " + JSON.stringify(ui));
	if (!ui.mysterious) problems.push("Mysterious checkbox missing");

	for (const id of ["au", "aumasc"]) {
		const before = packRequests.length;
		await openPerformance();
		await choosePack(id);
		await sleep(500);
		await closeOverlay();
		await ev(() => new Wikifier(null, "<<updatesidebarimg>>"));
		await sleep(3000);
		results[id] = await dollHash();
		const reqs = packRequests.slice(before).filter(r => r.path.startsWith(id + "/"));
		results[id + "Requests"] = {
			ok: reqs.filter(r => r.status === 200).length,
			failed: reqs.filter(r => r.status !== 200).length,
			sample: reqs[0] && reqs[0].path,
		};
		if (!reqs.some(r => r.status === 200)) problems.push(`${id}: no sprites loaded from imagepacks/${id}/`);
		if (reqs.some(r => r.status !== 200)) problems.push(`${id}: pack requests failed`);
		if (results[id] === results.default) problems.push(`${id}: sidebar doll unchanged from default`);
	}
	if (results.au && results.au === results.aumasc) problems.push("au and aumasc rendered identically");

	/* Mysterious through the UI, then a combat sprite through the renderer's loader */
	await openPerformance();
	await ev(() => document.getElementById("checkbox-optionsimagepackmysterious").click());
	await sleep(500);
	await closeOverlay();
	const before = packRequests.length;
	results.optionAfterSelect = await ev(() => SugarCube.State.variables.options.imagePack);
	results.mysterious = await ev(async () => {
		const src = "img/sex/doggy/body/base.png";
		const load = path =>
			new Promise(res =>
				Renderer.ImageLoader.loadImage(
					path,
					{},
					(s, l, img) => res({ s, w: img.width, h: img.height, img }),
					() => res(null)
				)
			);
		const pixels = img => {
			const c = document.createElement("canvas");
			c.width = img.width;
			c.height = img.height;
			const x = c.getContext("2d");
			x.drawImage(img, 0, 0);
			return Array.from(x.getImageData(0, 0, c.width, c.height).data).join(",").length + ":" + c.toDataURL().length;
		};
		const mapped = ImagePacks.resolve(src);
		const viaPack = await load(src);
		const vanilla = await new Promise(res => {
			const i = new Image();
			i.onload = () => res(i);
			i.onerror = () => res(null);
			i.src = src + "?vanilla";
		});
		return {
			option: SugarCube.State.variables.options.imagePackMysterious,
			mapped,
			reportedSrc: viaPack && viaPack.s,
			differs: !!(viaPack && vanilla && pixels(viaPack.img) !== pixels(vanilla)),
		};
	});
	const mysReqs = packRequests.slice(before).filter(r => r.path.startsWith("mysterious/"));
	if (results.mysterious.option !== true) problems.push("Mysterious checkbox did not set the option");
	if (results.mysterious.mapped !== "imagepacks/mysterious/sex/doggy/body/base.png")
		problems.push("Mysterious did not remap combat sprite: " + results.mysterious.mapped);
	if (results.mysterious.reportedSrc !== "img/sex/doggy/body/base.png") problems.push("loader did not report the original src");
	if (!mysReqs.some(r => r.status === 200)) problems.push("Mysterious sprite not loaded from imagepacks/mysterious/");
	if (!results.mysterious.differs) problems.push("Mysterious sprite identical to default");

	/* back to Default */
	await openPerformance();
	await choosePack("default");
	await ev(() => document.getElementById("checkbox-optionsimagepackmysterious").click());
	await sleep(500);
	await closeOverlay();
	await ev(() => new Wikifier(null, "<<updatesidebarimg>>"));
	await sleep(3000);
	results.backToDefault = await dollHash();
	if (results.backToDefault !== results.default) problems.push("Default doll not restored after switching back");
	if (await ev(() => ImagePacks.resolve("img/body/basenoarms/basenoarms-classic.png") !== "img/body/basenoarms/basenoarms-classic.png"))
		problems.push("Default still remaps");

	results.errorViews = await ev(() => Array.from(document.querySelectorAll(".error-view")).map(e => e.textContent.slice(0, 200)));
	if (results.errorViews.length) problems.push("error views: " + results.errorViews.join(" | "));
	if (pageErrors.length) problems.push("page errors: " + pageErrors.join(" | "));
	const packBad = bad.filter(b => b.includes("/imagepacks/"));
	if (packBad.length) problems.push("pack 404s: " + packBad.slice(0, 5).join(" | "));
	await page.close();
	return { mode, ok: problems.length === 0, problems, otherHttpErrors: bad.filter(b => !b.includes("/imagepacks/")).slice(0, 10), results };
}

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
	headless: "new",
	args: ["--no-sandbox", "--disable-gpu"],
});
const out = [];
try {
	for (const m of modeArg === "both" ? ["normal", "strict"] : [modeArg]) out.push(await run(browser, m));
} finally {
	await browser.close();
}
console.log(JSON.stringify(out, null, 2));
if (!out.every(r => r.ok)) process.exit(1);
