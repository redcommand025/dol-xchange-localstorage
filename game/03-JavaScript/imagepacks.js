/* Selectable image packs (Options > Images > Image pack).
 *
 * A pack is an overlay of img/ kept in imagepacks/<id>/ next to the game. Instead of copying it over
 * img/, the renderer loads imagepacks/<id>/<path> for any img/<path> the pack contains (per the
 * generated window.ImagePackManifest) and the normal img/ sprite otherwise. If a pack file fails to
 * load (e.g. the folder was not shipped), the img/ sprite is used.
 *
 *   $options.imagePack      "default" | "au" | "aumasc"   main sprite pack
 *   $options.imagePackMysterious  true | false            Mysterious combat sprites on top
 */
window.ImagePacks = (() => {
	"use strict";

	const MAIN = ["au", "aumasc"];
	const sets = {};

	function files(id) {
		if (sets[id]) return sets[id];
		const entry = window.ImagePackManifest && window.ImagePackManifest[id];
		const set = new Set();
		if (entry) for (const [dir, names] of Object.entries(entry.files)) for (const name of names) set.add(dir ? `${dir}/${name}` : name);
		sets[id] = set;
		return set;
	}

	function available(id) {
		return files(id).size > 0;
	}

	/* Highest priority first: Mysterious is applied after Aoki Utage in upstream's combined build. */
	function active() {
		const options = (window.V && V.options) || {};
		const list = [];
		if (options.imagePackMysterious && available("mysterious")) list.push("mysterious");
		if (MAIN.includes(options.imagePack) && available(options.imagePack)) list.push(options.imagePack);
		return list;
	}

	function resolve(src) {
		if (typeof src !== "string" || !src.startsWith("img/")) return src;
		const rel = src.slice(4);
		for (const id of active()) {
			if (files(id).has(rel)) return window.ImagePackManifest[id].dir + rel;
		}
		return src;
	}

	function install() {
		if (!window.Renderer || !Renderer.ImageLoader || Renderer.ImageLoader.__imagePacks) return;
		const base = Renderer.ImageLoader;
		Renderer.ImageLoader = {
			__imagePacks: true,
			loadImage(src, layer, onLoad, onError) {
				const mapped = resolve(src);
				if (mapped === src) return base.loadImage(src, layer, onLoad, onError);
				/* report the original path so caching and size rules keyed on img/ paths still apply */
				base.loadImage(
					mapped,
					layer,
					(_src, l, image) => onLoad(src, l, image),
					() => base.loadImage(src, layer, onLoad, onError)
				);
			},
		};
	}

	/* Call after the setting changes: drop cached sprites and redraw the sidebar doll. */
	function changed() {
		if (window.Renderer) {
			Renderer.ImageCaches = {};
			Renderer.ImageErrors = {};
			/* cached models (sidebar doll, combat) keep their loaded layer images */
			for (const slots of Object.values(Renderer.CanvasModelCaches || {})) {
				for (const model of Object.values(slots)) {
					try {
						if (model && model.layerList) Renderer.invalidateLayerCaches(model.layerList);
					} catch (e) {}
				}
			}
		}
		try {
			new Wikifier(null, "<<updatesidebarimg>>");
		} catch (e) {}
	}

	install();
	return Object.freeze({ resolve, active, available, changed, install, files });
})();
