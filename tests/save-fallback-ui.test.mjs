// Saves menu as in the DoL-localStorage mod: the IndexedDB list is used only when window.indexedDB exists,
// otherwise the slot list ("localStorage copy/paste mode"); the copy/paste note is always shown, together with
// Save to file / Load from file. Headless check: tests/save-ui-fallback.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");
const NOTE =
	"localStorage saves are temporary and best used as a copy/paste method. Use the Export / Copy Text Area buttons below to back up your save string. Older browsers that lack IndexedDB will automatically use this method.<br><b>Tip:</b> On any browser, open the Export menu and use Copy Text Area to grab your save string, then paste it back later with Load from Text.";
const TOOLTIP =
	'If you can\'t find your saves, try toggling "Enable IndexedDB" below. On older browsers (no IndexedDB), use the Copy Text Area / Export buttons — localStorage is a temporary copy/paste method.';

describe("saves menu (DoL-localStorage copy/paste mode)", () => {
	const saves = read("game/base-system/overlays/saves.twee");
	const widget = read("game/base-system/overlays/saves-copy-paste.twee");

	it("uses the IndexedDB list only when window.indexedDB exists", () => {
		assert.ok(saves.includes('<<if idb.active and !$ironmanmode and !sessionStorage.getItem("noidb") and window.indexedDB>>'));
		assert.ok(saves.includes('<<run sessionStorage.setItem("noidb", true); idb.active = false>> /* localStorage copy/paste mode'));
		/* a comment inside <<run>> is a SugarCube syntax error (it broke the reference's no-IndexedDB path) */
		assert.doesNotMatch(saves, /<<run [^>]*\/\*/);
	});

	it("always shows the copy/paste note with Save to file and Load from file, above the save list", () => {
		const note = saves.indexOf("<<savesCopyPasteNote>>");
		assert.ok(note > 0 && note < saves.indexOf('<div id="saveList">'));
		assert.match(widget, /<<widget "savesCopyPasteNote">>/);
		assert.ok(widget.includes(`<p>${NOTE}</p>`));
		assert.doesNotMatch(widget, /<<if [^>]*(Storage|indexedDB|idb)/, "note is not conditional on storage");
		assert.match(widget, /id="savesExportFile"[^>]*value="Save to file"[^>]*onclick="SugarCube\.Save\.export\(/);
		assert.match(widget, /id="savesImportFile" type="file" onchange="importSave\(this\.files\)"/);
	});

	it("uses the DoL-localStorage tooltip", () => {
		assert.ok(saves.includes(TOOLTIP));
		assert.ok(!saves.includes("Saves here will be lost if your browser cache is cleared."));
	});

	it("has no leftovers of the old detection-based fallback", () => {
		assert.equal(existsSync(join(root, "game/03-JavaScript/storage-polyfill.js")), false);
		assert.equal(existsSync(join(root, "devTools/prepend-storage-fallback.py")), false);
		assert.equal(existsSync(join(root, "game/base-system/overlays/saves-storage-fallback.twee")), false);
		const walk = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
		const hits = walk("game")
			.filter(f => /\.(js|twee)$/.test(f))
			.filter(f => /DoLStorageFallback|storageFallbackSaves|applyToIdb/.test(read(f)));
		assert.deepEqual(hits, []);
		assert.doesNotMatch(read("devTools/head.html"), /DoLStorageFallback|disableIndexedDB/);
		assert.doesNotMatch(read("compile.sh"), /prepend-storage-fallback/);
		assert.doesNotMatch(read("compile.bat"), /prepend-storage-fallback/);
		assert.match(read("compile.sh"), /--head "devTools\/head\.html" --module "modules"/);
	});

	it("publishing checks for the stand-in", () => {
		assert.match(read("devTools/prepare-pages.sh"), /grep -q "Storage fallback for devices with no storage"/);
	});

	it("puts the stand-in before any storage use in the compiled game", { skip: !existsSync(join(root, "Degrees of Lewdity.html")) }, () => {
		const html = readFileSync(join(root, "Degrees of Lewdity.html"), "utf8");
		const stub = html.indexOf("/* Storage fallback for devices with no storage");
		assert.ok(stub > 0);
		const firstUse = Math.min(...["localStorage.", "sessionStorage."].map(k => html.indexOf(k, html.indexOf("<head"))).filter(i => i >= 0));
		assert.ok(stub < firstUse, `stand-in at ${stub}, first storage use at ${firstUse}`);
	});
});
