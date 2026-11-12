/* Run with: node --test tests/prepend-storage-fallback.check.mjs (named .check so Playwright skips it). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("prepend-storage-fallback.py", () => {
	it("inserts the fallback immediately after <head> and is idempotent", () => {
		const dir = mkdtempSync(join(tmpdir(), "dol-prepend-"));
		const htmlPath = join(dir, "out.html");
		writeFileSync(
			htmlPath,
			`<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8" />\n<script id="script-libraries">window.__late = true;</script>\n</head>\n<body></body>\n</html>\n`
		);
		execFileSync("python3", [join(root, "devTools/prepend-storage-fallback.py"), htmlPath], { stdio: "pipe" });
		const once = readFileSync(htmlPath, "utf8");
		const headAt = once.indexOf("<head>");
		const scriptAt = once.indexOf("Storage fallback: localStorage/sessionStorage/indexedDB");
		const librariesAt = once.indexOf('id="script-libraries"');
		assert.ok(scriptAt > headAt, "fallback should appear after <head>");
		assert.ok(scriptAt < librariesAt, "fallback should appear before SugarCube libraries");
		execFileSync("python3", [join(root, "devTools/prepend-storage-fallback.py"), htmlPath], { stdio: "pipe" });
		const twice = readFileSync(htmlPath, "utf8");
		assert.equal(twice.split("Storage fallback: localStorage/sessionStorage/indexedDB").length - 1, 1);
	});
});
